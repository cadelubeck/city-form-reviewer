import { NextResponse } from "next/server";
import {
  parseStructuredResponse,
  retrieveBackgroundResponse,
  startBackgroundStructuredResponse,
  structuredResponse
} from "@/lib/openai";
import { authenticatedSupabase } from "@/lib/server-supabase";
import { reviewProposal } from "@/lib/review-engine";
import type {
  Comparator, ProposalMeasurement, ProposalSubmission, Requirement, RequirementSourceType,
  SiteFinding, SourceRegistryItem
} from "@/lib/types";

export const maxDuration = 300;

type StandardRequirement = Record<string, unknown>;

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
  required: [
    "overallCompliance", "executiveSummary", "detectedJurisdiction", "projectScope",
    "extractedRequirements", "pages", "globalMissingInformation"
  ],
  properties: {
    overallCompliance: { type: "string", enum: ["green", "yellow", "red"] },
    executiveSummary: { type: "string" },
    detectedJurisdiction: {
      type: "object",
      additionalProperties: false,
      required: ["city", "county", "state", "confidence", "evidence"],
      properties: {
        city: { type: ["string", "null"] },
        county: { type: ["string", "null"] },
        state: { type: ["string", "null"] },
        confidence: { type: "number" },
        evidence: { type: "string" }
      }
    },
    projectScope: { type: "array", items: { type: "string" } },
    extractedRequirements: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["topic", "metric", "description", "comparator", "value", "unit", "page", "excerpt"],
        properties: {
          topic: { type: "string" },
          metric: { type: "string" },
          description: { type: "string" },
          comparator: { type: "string", enum: ["minimum", "maximum", "exact", "presence"] },
          value: { type: ["number", "string", "boolean"] },
          unit: { type: ["string", "null"] },
          page: { type: ["integer", "null"] },
          excerpt: { type: "string" }
        }
      }
    },
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

async function loadProposalAndStandards(auth: NonNullable<Awaited<ReturnType<typeof authenticatedSupabase>>>, proposalId: string) {
  const { data: proposal, error: proposalError } = await auth.client
    .from("proposals").select("*").eq("id", proposalId).single();
  if (proposalError || !proposal) throw new Error(proposalError?.message ?? "Proposal not found.");
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
    (document.requirements ?? []).map((requirement: StandardRequirement) => ({
      ...requirement,
      documentId: document.id,
      documentTitle: document.title,
      documentType: document.document_type,
      sourceUrl: requirement.sourceUrl ?? document.source_url
    }))
  ).slice(0, 600);
  return { proposal, standards };
}

function compactStandardsForModel(standards: StandardRequirement[]) {
  return standards.map((requirement) => ({
    id: requirement.id,
    topic: requirement.topic,
    metric: requirement.metric,
    comparator: requirement.comparator,
    value: requirement.value,
    unit: requirement.unit,
    sourceTitle: requirement.documentTitle ?? requirement.sourceTitle,
    page: requirement.page,
    citation: requirement.citation ?? requirement.excerpt,
    sourceUrl: requirement.sourceUrl,
    documentType: requirement.documentType
  }));
}

function deterministicReview(
  proposal: Record<string, unknown>,
  review: Record<string, unknown>,
  standards: StandardRequirement[]
) {
  const clientId = String(proposal.client ?? "").trim().toLowerCase().replaceAll(/[^a-z0-9]+/g, "-");
  const jurisdiction = String(proposal.location ?? "").trim();
  const commonScope = ["applicable"];
  const measurements = (review.extractedRequirements as Array<Record<string, unknown>> ?? []).map<ProposalMeasurement>((item) => ({
    metric: String(item.metric ?? ""),
    value: item.value as number | string | boolean,
    unit: item.unit ? String(item.unit) : undefined,
    citation: String(item.excerpt ?? "")
  }));
  const normalized = standards.map((item) => ({
    id: String(item.id ?? crypto.randomUUID()),
    clientId,
    jurisdiction,
    topic: String(item.topic ?? item.metric ?? "Requirement"),
    metric: String(item.metric ?? ""),
    comparator: String(item.comparator ?? "exact") as Comparator,
    value: item.value as number | string | boolean,
    unit: item.unit ? String(item.unit) : undefined,
    sourceType: String(item.documentType ?? item.sourceType ?? "city-standard") as RequirementSourceType,
    sourceTitle: String(item.documentTitle ?? item.sourceTitle ?? "Standards library"),
    citation: String(item.citation ?? item.excerpt ?? ""),
    sourceUrl: item.sourceUrl ? String(item.sourceUrl) : undefined,
    scopeTags: commonScope,
    rationale: String(item.rationale ?? item.description ?? ""),
    page: typeof item.page === "number" ? item.page : null,
    excerpt: item.excerpt ? String(item.excerpt) : undefined,
    embedding: Array.isArray(item.embedding) ? item.embedding as number[] : undefined
  }));
  const baselineTypes = new Set(["city-standard", "client-standard", "manual"]);
  const baseline = normalized.filter((item) => baselineTypes.has(item.sourceType)) as Requirement[];
  const site = normalized.filter((item) => !baselineTypes.has(item.sourceType)) as SiteFinding[];
  const submission: ProposalSubmission = {
    projectName: String(proposal.name ?? "Untitled proposal"),
    clientId,
    jurisdiction,
    address: jurisdiction,
    scopeTags: commonScope,
    measurements,
    uploadedFiles: proposal.original_name ? [String(proposal.original_name)] : []
  };
  const sources = Array.from(new Map(normalized.map((item) => [item.sourceTitle, {
    id: item.sourceTitle,
    name: item.sourceTitle,
    type: item.sourceType,
    url: item.sourceUrl,
    use: "Applicable company standards or site-specific source."
  } satisfies SourceRegistryItem])).values());
  return reviewProposal(submission, baseline, site, sources);
}

function enrichReview(data: Record<string, unknown>, standards: StandardRequirement[]): Record<string, unknown> {
  const requirementById = new Map<string, StandardRequirement>(
    standards.map((requirement) => [String(requirement.id ?? ""), requirement])
  );
  const pages = (data.pages as Array<Record<string, unknown>> ?? []).map((page) => ({
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
  return { ...data, pages };
}

export async function GET(request: Request) {
  const auth = await authenticatedSupabase(request);
  if (!auth) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  try {
    const proposalId = new URL(request.url).searchParams.get("proposalId") ?? "";
    const { proposal, standards } = await loadProposalAndStandards(auth, proposalId);
    const job = proposal.diagram_analysis as { responseId?: string; status?: string } | null;
    if (!job?.responseId) {
      return NextResponse.json({ error: "No deep review is currently running." }, { status: 404 });
    }
    const response = await retrieveBackgroundResponse(job.responseId);
    if (response.status === "queued" || response.status === "in_progress") {
      return NextResponse.json({ status: response.status, responseId: response.id }, { status: 202 });
    }
    if (response.status !== "completed") {
      const message = response.error?.message ?? `Deep review ended with status ${response.status ?? "unknown"}.`;
      await auth.client.from("proposals").update({
        diagram_analysis: { responseId: response.id, status: response.status ?? "failed", error: message }
      }).eq("id", proposalId);
      return NextResponse.json({ error: message, status: response.status }, { status: 500 });
    }
    const review = enrichReview(parseStructuredResponse<Record<string, unknown>>(response), standards);
    const pages = review.pages as Array<Record<string, unknown>>;
    const complianceReview = deterministicReview(proposal, review, standards);
    const extractedRequirements = review.extractedRequirements as Array<Record<string, unknown>> ?? [];
    const { error: updateError } = await auth.client.from("proposals").update({
      page_reviews: pages,
      diagram_analysis: review,
      compliance_review: complianceReview,
      detected_jurisdiction: review.detectedJurisdiction ?? {},
      project_scope: review.projectScope ?? [],
      extracted_requirements: extractedRequirements,
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
    return NextResponse.json({
      status: "completed",
      data: review,
      complianceReview,
      extractedRequirements,
      responseId: response.id,
      model: response.model
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to check review status." }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const auth = await authenticatedSupabase(request);
  if (!auth) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  try {
    const body = await request.json();
    const mode = body.mode === "deep" ? "deep" : body.mode === "diagrams" ? "diagrams" : "section";
    if (mode === "deep") {
      const proposalId = String(body.proposalId ?? "");
      const { proposal, standards } = await loadProposalAndStandards(auth, proposalId);

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
      const modelStandards = compactStandardsForModel(standards);
      const result = await startBackgroundStructuredResponse({
        name: "deep_civil_page_review",
        schema: deepReviewSchema,
        reasoningEffort: "high",
        maxOutputTokens: 16000,
        instructions: `You are an AI civil proposal review assistant, not the approving engineer.
Inspect every page in order, including every visible word, note, table, callout, plan, profile,
detail, section, schedule, symbol, dimension, legend, stamp, and diagram. Return one page record
for every page, even if it has no deficiency. Do not infer unreadable values.

Also extract every explicit submitted civil-engineering value once into extractedRequirements.
Use stable snake_case metrics, supported page numbers, preserved units, and brief evidence.

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
${JSON.stringify(modelStandards)}`
            }
          ]
        }]
      });
      const { error: updateError } = await auth.client.from("proposals").update({
        diagram_analysis: {
          responseId: result.id,
          status: result.status ?? "queued",
          startedAt: new Date().toISOString()
        },
        status: "in_review"
      }).eq("id", proposalId);
      if (updateError) throw new Error(updateError.message);
      await auth.client.from("proposal_history").insert({
        proposal_id: proposalId,
        company_id: auth.companyId,
        actor_id: auth.user.id,
        event_type: "deep_review_started",
        status: "in_review",
        summary: "Started a durable page-by-page AI review.",
        snapshot: { responseId: result.id, status: result.status ?? "queued" }
      });
      return NextResponse.json({
        status: result.status ?? "queued",
        responseId: result.id,
        model: result.model
      }, { status: 202 });
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
