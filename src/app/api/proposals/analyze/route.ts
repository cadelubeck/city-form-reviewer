import { NextResponse } from "next/server";
import { structuredResponse } from "@/lib/openai";
import { authenticatedSupabase } from "@/lib/server-supabase";

export const maxDuration = 300;

const sectionSchema = {
  type: "object",
  additionalProperties: false,
  required: ["score", "summary", "concerns", "recommendations"],
  properties: {
    score: { type: "string", enum: ["green", "yellow", "red"] },
    summary: { type: "string" },
    concerns: { type: "array", items: { type: "string" } },
    recommendations: { type: "array", items: { type: "string" } }
  }
};

const diagramSchema = {
  type: "object",
  additionalProperties: false,
  required: ["overallCompliance", "summary", "diagrams", "missingInformation"],
  properties: {
    overallCompliance: { type: "string", enum: ["green", "yellow", "red"] },
    summary: { type: "string" },
    diagrams: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["title", "type", "observations", "concerns"],
        properties: {
          title: { type: "string" },
          type: { type: "string" },
          observations: { type: "array", items: { type: "string" } },
          concerns: { type: "array", items: { type: "string" } }
        }
      }
    },
    missingInformation: { type: "array", items: { type: "string" } }
  }
};

const deepReviewSchema = {
  type: "object",
  additionalProperties: false,
  required: ["overallCompliance", "executiveSummary", "pages", "globalMissingInformation"],
  properties: {
    overallCompliance: { type: "string", enum: ["green", "yellow", "red"] },
    executiveSummary: { type: "string" },
    pages: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["page", "pageTitle", "pageType", "summary", "visualObservations", "findings"],
        properties: {
          page: { type: "integer" },
          pageTitle: { type: "string" },
          pageType: { type: "string" },
          summary: { type: "string" },
          visualObservations: { type: "array", items: { type: "string" } },
          findings: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              required: [
                "id", "category", "title", "severity", "proposalEvidence", "proposalPage",
                "standardRequirement", "standardId", "standardTitle", "standardPage",
                "explanation", "recommendedCorrection"
              ],
              properties: {
                id: { type: "string" },
                category: { type: "string" },
                title: { type: "string" },
                severity: { type: "string", enum: ["pass", "warning", "fail", "missing", "engineer-review"] },
                proposalEvidence: { type: "string" },
                proposalPage: { type: "integer" },
                standardRequirement: { type: "string" },
                standardId: { type: ["string", "null"] },
                standardTitle: { type: "string" },
                standardPage: { type: ["integer", "null"] },
                explanation: { type: "string" },
                recommendedCorrection: { type: "string" }
              }
            }
          }
        }
      }
    },
    globalMissingInformation: { type: "array", items: { type: "string" } }
  }
};

export async function POST(request: Request) {
  const auth = await authenticatedSupabase(request);
  if (!auth) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  try {
    const body = await request.json();
    const mode = body.mode === "deep" ? "deep" : body.mode === "diagrams" ? "diagrams" : "section";
    if (mode === "deep") {
      const proposalId = String(body.proposalId ?? "");
      const { data: proposal, error: proposalError } = await auth.client
        .from("proposals").select("*").eq("id", proposalId).single();
      if (proposalError || !proposal) {
        return NextResponse.json({ error: proposalError?.message ?? "Proposal not found." }, { status: 404 });
      }
      const { data: documents, error: documentsError } = await auth.client
        .from("engineering_documents")
        .select("id,title,document_type,jurisdiction,client_id,project_types,source_url,requirements")
        .is("archived_at", null);
      if (documentsError) throw new Error(documentsError.message);
      const location = String(proposal.location ?? "").toLowerCase();
      const client = String(proposal.client ?? "").toLowerCase();
      const applicable = (documents ?? []).filter((document) =>
        (!document.jurisdiction || location.includes(String(document.jurisdiction).toLowerCase())) &&
        (!document.client_id || client.includes(String(document.client_id).toLowerCase()))
      );
      const standards = applicable.flatMap((document) =>
        (document.requirements ?? []).map((requirement: Record<string, unknown>) => ({
          ...requirement,
          documentId: document.id,
          documentTitle: document.title,
          documentType: document.document_type,
          sourceUrl: requirement.sourceUrl ?? document.source_url
        }))
      ).slice(0, 600);

      let documentInput: Record<string, unknown>;
      if (proposal.file_path) {
        const { data: file, error: fileError } = await auth.client.storage
          .from("proposal-files").download(proposal.file_path);
        if (fileError || !file) throw new Error(fileError?.message ?? "The original proposal file could not be loaded.");
        documentInput = {
          type: "input_file",
          filename: proposal.original_name ?? "proposal.pdf",
          file_data: `data:${file.type || "application/pdf"};base64,${Buffer.from(await file.arrayBuffer()).toString("base64")}`
        };
      } else {
        documentInput = { type: "input_text", text: String(proposal.text_content ?? "").slice(0, 180000) };
      }
      const result = await structuredResponse<Record<string, unknown>>({
        name: "deep_civil_page_review",
        schema: deepReviewSchema,
        reasoningEffort: "high",
        maxOutputTokens: 16000,
        timeoutMs: 180_000,
        instructions: `You are an AI civil proposal review assistant, not the approving engineer.
Inspect every page in order, including every visible word, note, table, callout, plan, profile,
detail, section, schedule, symbol, dimension, legend, stamp, and diagram. Return one page record
for every page, even if it has no deficiency. Do not infer unreadable values.

Compare only against the supplied standards library. The city/client standard is the baseline;
a site-specific requirement controls only when it is demonstrably stricter. Cite the proposal
page and the exact standard title/page for every finding. standardId must exactly match a supplied
requirement id, or null when no supplied standard supports the finding. Never invent a law, URL,
page, requirement, or citation. Mark missing or ambiguous information explicitly and reserve
engineering judgment for the licensed human reviewer.`,
        input: [{
          role: "user",
          content: [
            documentInput,
            {
              type: "input_text",
              text: `PROJECT\nName: ${proposal.name}\nClient: ${proposal.client}\nJurisdiction: ${proposal.location}\nScope: ${(proposal.project_scope ?? []).join(", ")}

CONTROLLING-STANDARD CANDIDATES (authoritative supplied library only)
${JSON.stringify(standards)}`
            }
          ]
        }]
      });
      const requirementById = new Map<string, Record<string, unknown>>(
        standards.map((requirement) => [String(requirement.id ?? ""), requirement])
      );
      const pages = (result.data.pages as Array<Record<string, unknown>> ?? []).map((page) => ({
        ...page,
        findings: (page.findings as Array<Record<string, unknown>> ?? []).map((finding) => {
          const requirement = requirementById.get(String(finding.standardId ?? ""));
          return {
            ...finding,
            standardTitle: requirement ? String(requirement.documentTitle ?? requirement.sourceTitle ?? finding.standardTitle) : String(finding.standardTitle),
            standardPage: requirement?.page ?? finding.standardPage ?? null,
            standardUrl: requirement?.sourceUrl ?? null
          };
        })
      }));
      const review = { ...result.data, pages };
      const { error: updateError } = await auth.client.from("proposals").update({
        page_reviews: pages,
        diagram_analysis: review,
        status: "in_review"
      }).eq("id", proposalId);
      if (updateError) throw new Error(updateError.message);
      await auth.client.from("proposal_history").insert({
        proposal_id: proposalId,
        company_id: auth.companyId,
        actor_id: auth.user.id,
        event_type: "deep_review_saved",
        status: "in_review",
        summary: `Saved page-by-page AI review for ${pages.length} pages.`,
        snapshot: review
      });
      return NextResponse.json({ data: review, responseId: result.responseId, model: result.model });
    }
    const text = String(body.text ?? "").slice(0, 90000);
    const result = await structuredResponse<Record<string, unknown>>({
      name: mode === "diagrams" ? "civil_plan_analysis" : "civil_section_review",
      schema: mode === "diagrams" ? diagramSchema : sectionSchema,
      instructions: mode === "diagrams"
        ? "Identify plan, detail, profile, section, schedule, and diagram references in the supplied civil proposal text. Flag missing dimensions, labels, conflicts, and items requiring engineer review. Do not claim to see graphics that are not represented in the text."
        : "Act as a civil engineering review assistant. Assess this proposal section against explicit cited information only. Green means no identified concern, yellow means incomplete or engineer judgment is needed, and red means a clear conflict or deficiency. Give concise actionable recommendations. You assist; the engineer is final authority.",
      input: `PROJECT: ${String(body.projectName ?? "")}\nSECTION: ${String(body.sectionTitle ?? "")}\n\n${text}`,
      maxOutputTokens: 3000
    });
    return NextResponse.json({ data: result.data, responseId: result.responseId, model: result.model });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Analysis failed." }, { status: 500 });
  }
}
