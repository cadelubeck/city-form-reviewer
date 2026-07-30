import { NextResponse } from "next/server";
import { PDFDocument } from "pdf-lib";
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
type ReviewRecord = Record<string, unknown>;

const DEEP_REVIEW_BATCH_SIZE = 3;
const DEEP_REVIEW_MAX_OUTPUT_TOKENS = 48000;

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
    description: requirement.description,
    rationale: requirement.rationale,
    comparator: requirement.comparator,
    value: requirement.value,
    unit: requirement.unit,
    sourceTitle: requirement.documentTitle ?? requirement.sourceTitle,
    page: requirement.page,
    citation: requirement.citation,
    excerpt: requirement.excerpt,
    sourceUrl: requirement.sourceUrl,
    documentType: requirement.documentType
  }));
}

async function proposalBatchInput(
  auth: NonNullable<Awaited<ReturnType<typeof authenticatedSupabase>>>,
  proposal: ReviewRecord,
  requestedStartPage: number,
  batchSize = DEEP_REVIEW_BATCH_SIZE
) {
  if (!proposal.file_path) {
    return {
      documentInput: { type: "input_text", text: String(proposal.text_content ?? "").slice(0, 180000) },
      batchStart: 1,
      batchEnd: 1,
      totalPages: 1
    };
  }

  const { data: file, error: fileError } = await auth.client.storage
    .from("proposal-files").download(String(proposal.file_path));
  if (fileError || !file) throw new Error(fileError?.message ?? "The original proposal file could not be loaded.");
  const bytes = new Uint8Array(await file.arrayBuffer());
  const isPdf = String(proposal.original_name ?? "").toLowerCase().endsWith(".pdf") ||
    file.type === "application/pdf";

  if (!isPdf) {
    return {
      documentInput: {
        type: "input_file",
        filename: String(proposal.original_name ?? "proposal.txt"),
        file_data: `data:${file.type || "text/plain"};base64,${Buffer.from(bytes).toString("base64")}`
      },
      batchStart: 1,
      batchEnd: 1,
      totalPages: 1
    };
  }

  const source = await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false });
  const totalPages = source.getPageCount();
  if (!totalPages) throw new Error("The uploaded PDF has no readable pages.");
  const batchStart = Math.min(Math.max(1, requestedStartPage), totalPages);
  const batchEnd = Math.min(batchStart + Math.max(1, batchSize) - 1, totalPages);
  const batch = await PDFDocument.create();
  const indexes = Array.from({ length: batchEnd - batchStart + 1 }, (_, index) => batchStart - 1 + index);
  const copiedPages = await batch.copyPages(source, indexes);
  copiedPages.forEach((page) => batch.addPage(page));
  const batchBytes = await batch.save({ useObjectStreams: true });

  return {
    documentInput: {
      type: "input_file",
      filename: `proposal-pages-${batchStart}-${batchEnd}.pdf`,
      file_data: `data:application/pdf;base64,${Buffer.from(batchBytes).toString("base64")}`
    },
    batchStart,
    batchEnd,
    totalPages
  };
}

async function startDeepReviewBatch(
  auth: NonNullable<Awaited<ReturnType<typeof authenticatedSupabase>>>,
  proposal: ReviewRecord,
  standards: StandardRequirement[],
  requestedStartPage: number,
  batchSize = DEEP_REVIEW_BATCH_SIZE
) {
  const batch = await proposalBatchInput(auth, proposal, requestedStartPage, batchSize);
  const modelStandards = compactStandardsForModel(standards);
  const result = await startBackgroundStructuredResponse({
    name: "deep_civil_page_review",
    schema: deepReviewSchema,
    reasoningEffort: "high",
    maxOutputTokens: DEEP_REVIEW_MAX_OUTPUT_TOKENS,
    instructions: `You are an AI civil proposal review assistant, not the approving engineer.
This request contains original proposal pages ${batch.batchStart}-${batch.batchEnd} of ${batch.totalPages}.
Use the ORIGINAL page numbers ${batch.batchStart}-${batch.batchEnd} in every page and finding record.
Return exactly one page record for each supplied page and no records for pages outside this batch.

Inspect every supplied page, including every visible word, note, table, callout, plan, profile,
detail, section, schedule, symbol, dimension, legend, stamp, and diagram. Do not infer unreadable values.

Extract every explicit submitted civil-engineering value in this batch into extractedRequirements.
Use stable snake_case metrics, original page numbers, preserved units, and brief evidence.

Perform a complete technical audit, not a short list of general suggestions. For each page,
describe the substantive content and visual information, then report every supported conflict,
omission, ambiguity, coordination issue, and item requiring engineer judgment. Corrections must
be specific and actionable. Do not collapse multiple distinct deficiencies into one generic item.

Compare only against the supplied standards library. The city/client standard is the baseline;
a site-specific requirement controls only when it is demonstrably stricter. Cite the proposal
page and the exact standard title/page for every finding. standardId must exactly match a supplied
requirement id, or null when no supplied standard supports the finding. Never invent a law, URL,
page, requirement, or citation. When the library does not support a compliance conclusion, still
record visible omissions or ambiguities as engineer-review and state that no controlling standard
was supplied. Mark unreadable information explicitly and reserve engineering judgment for the
licensed human reviewer.`,
    input: [{
      role: "user",
      content: [
        batch.documentInput,
        {
          type: "input_text",
          text: `PROJECT
Name: ${String(proposal.name ?? "")}
Client: ${String(proposal.client ?? "")}
Jurisdiction: ${String(proposal.location ?? "")}
Known scope: ${(proposal.project_scope as string[] ?? []).join(", ")}
CURRENT PAGE BATCH: ${batch.batchStart}-${batch.batchEnd} of ${batch.totalPages}

CONTROLLING-STANDARD CANDIDATES (authoritative supplied library only)
${JSON.stringify(modelStandards)}`
        }
      ]
    }]
  });
  return { ...batch, result };
}

function mergeUnique<T>(items: T[], key: (item: T) => string) {
  return Array.from(new Map(items.map((item) => [key(item), item])).values());
}

function mergeBatchReview(job: ReviewRecord, batchReview: ReviewRecord) {
  const pages = mergeUnique(
    [
      ...((job.accumulatedPages as ReviewRecord[]) ?? []),
      ...((batchReview.pages as ReviewRecord[]) ?? [])
    ],
    (page) => String(page.page ?? "")
  ).sort((a, b) => Number(a.page ?? 0) - Number(b.page ?? 0));
  const extractedRequirements = mergeUnique(
    [
      ...((job.accumulatedRequirements as ReviewRecord[]) ?? []),
      ...((batchReview.extractedRequirements as ReviewRecord[]) ?? [])
    ],
    (item) => `${item.metric ?? ""}|${item.page ?? ""}|${item.excerpt ?? ""}`
  );
  const globalMissingInformation = Array.from(new Set([
    ...((job.globalMissingInformation as string[]) ?? []),
    ...((batchReview.globalMissingInformation as string[]) ?? [])
  ]));
  const projectScope = Array.from(new Set([
    ...((job.projectScope as string[]) ?? []),
    ...((batchReview.projectScope as string[]) ?? [])
  ]));
  const executiveSummaries = [
    ...((job.executiveSummaries as string[]) ?? []),
    String(batchReview.executiveSummary ?? "")
  ].filter(Boolean);
  const complianceValues = [
    ...((job.complianceValues as string[]) ?? []),
    String(batchReview.overallCompliance ?? "yellow")
  ];
  const overallCompliance = complianceValues.includes("red")
    ? "red"
    : complianceValues.includes("yellow") ? "yellow" : "green";

  return {
    pages,
    extractedRequirements,
    globalMissingInformation,
    projectScope,
    executiveSummaries,
    complianceValues,
    overallCompliance,
    detectedJurisdiction: job.detectedJurisdiction ?? batchReview.detectedJurisdiction ?? {}
  };
}

function normalizeBatchPageNumbers(review: ReviewRecord, batchStart: number, batchEnd: number) {
  const expectedCount = batchEnd - batchStart + 1;
  const pages = ((review.pages as ReviewRecord[]) ?? []).slice(0, expectedCount).map((page, index) => {
    const originalPage = batchStart + index;
    return {
      ...page,
      page: originalPage,
      findings: ((page.findings as ReviewRecord[]) ?? []).map((finding) => ({
        ...finding,
        proposalPage: originalPage
      }))
    };
  });
  return {
    ...review,
    pages,
    extractedRequirements: ((review.extractedRequirements as ReviewRecord[]) ?? []).map((item) => {
      const reportedPage = Number(item.page);
      const page = reportedPage >= batchStart && reportedPage <= batchEnd
        ? reportedPage
        : batchStart;
      return { ...item, page };
    })
  };
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
    const job = proposal.diagram_analysis as ReviewRecord | null;
    if (!job?.responseId) {
      return NextResponse.json({ error: "No deep review is currently running." }, { status: 404 });
    }
    const response = await retrieveBackgroundResponse(String(job.responseId));
    if (response.status === "queued" || response.status === "in_progress") {
      return NextResponse.json({
        status: response.status,
        responseId: response.id,
        completedPages: Number(job.completedPages ?? 0),
        totalPages: Number(job.totalPages ?? 0),
        batchStart: Number(job.batchStart ?? 1),
        batchEnd: Number(job.batchEnd ?? 1)
      }, { status: 202 });
    }
    if (response.status !== "completed") {
      const incompleteReason = response.incomplete_details?.reason;
      const failedBatchStart = Number(job.batchStart ?? 1);
      const failedBatchEnd = Number(job.batchEnd ?? failedBatchStart);
      if (
        response.status === "incomplete" &&
        incompleteReason === "max_tokens" &&
        failedBatchEnd > failedBatchStart
      ) {
        const retry = await startDeepReviewBatch(auth, proposal, standards, failedBatchStart, 1);
        const retryJob = {
          ...job,
          responseId: retry.result.id,
          status: retry.result.status ?? "queued",
          batchStart: retry.batchStart,
          batchEnd: retry.batchEnd,
          updatedAt: new Date().toISOString(),
          retryMode: "single-page"
        };
        const { error: retryError } = await auth.client.from("proposals").update({
          diagram_analysis: retryJob
        }).eq("id", proposalId);
        if (retryError) throw new Error(retryError.message);
        return NextResponse.json({
          status: retry.result.status ?? "queued",
          responseId: retry.result.id,
          completedPages: Number(job.completedPages ?? 0),
          totalPages: Number(job.totalPages ?? retry.totalPages),
          batchStart: retry.batchStart,
          batchEnd: retry.batchEnd,
          retryMode: "single-page"
        }, { status: 202 });
      }
      const message = response.error?.message ??
        (response.status === "incomplete" && incompleteReason === "max_tokens"
          ? "A single-page review reached the model output limit and requires engineer review."
          : `Deep review ended with status ${response.status ?? "unknown"}${incompleteReason ? ` (${incompleteReason})` : ""}.`);
      await auth.client.from("proposals").update({
        diagram_analysis: {
          ...job,
          responseId: response.id,
          status: response.status ?? "failed",
          incompleteReason: incompleteReason ?? null,
          error: message
        }
      }).eq("id", proposalId);
      return NextResponse.json({ error: message, status: response.status }, { status: 500 });
    }
    const batchStart = Number(job.batchStart ?? 1);
    const batchEnd = Number(job.batchEnd ?? batchStart);
    const totalPages = Number(job.totalPages ?? batchEnd);
    const parsedBatch = normalizeBatchPageNumbers(
      parseStructuredResponse<ReviewRecord>(response),
      batchStart,
      batchEnd
    );
    const batchReview = enrichReview(parsedBatch, standards);
    const merged = mergeBatchReview(job, batchReview);
    const nextStart = batchEnd + 1;

    if (nextStart <= totalPages) {
      const next = await startDeepReviewBatch(auth, proposal, standards, nextStart);
      const nextJob: ReviewRecord = {
        responseId: next.result.id,
        status: next.result.status ?? "queued",
        startedAt: job.startedAt ?? new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        batchStart: next.batchStart,
        batchEnd: next.batchEnd,
        totalPages,
        completedPages: batchEnd,
        accumulatedPages: merged.pages,
        accumulatedRequirements: merged.extractedRequirements,
        globalMissingInformation: merged.globalMissingInformation,
        projectScope: merged.projectScope,
        executiveSummaries: merged.executiveSummaries,
        complianceValues: merged.complianceValues,
        detectedJurisdiction: merged.detectedJurisdiction
      };
      const { error: nextError } = await auth.client.from("proposals").update({
        diagram_analysis: nextJob,
        page_reviews: merged.pages,
        status: "in_review"
      }).eq("id", proposalId);
      if (nextError) throw new Error(nextError.message);
      return NextResponse.json({
        status: next.result.status ?? "queued",
        responseId: next.result.id,
        completedPages: batchEnd,
        totalPages,
        batchStart: next.batchStart,
        batchEnd: next.batchEnd,
        pages: merged.pages
      }, { status: 202 });
    }

    const review: ReviewRecord = {
      overallCompliance: merged.overallCompliance,
      executiveSummary: merged.executiveSummaries.join("\n\n"),
      detectedJurisdiction: merged.detectedJurisdiction,
      projectScope: merged.projectScope,
      extractedRequirements: merged.extractedRequirements,
      pages: merged.pages,
      globalMissingInformation: merged.globalMissingInformation
    };
    const pages = merged.pages;
    const complianceReview = deterministicReview(proposal, review, standards);
    const extractedRequirements = merged.extractedRequirements;
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
      model: response.model,
      completedPages: totalPages,
      totalPages
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
      const existingJob = proposal.diagram_analysis as ReviewRecord | null;
      const existingStatus = String(existingJob?.status ?? "");
      if (existingJob?.responseId && (existingStatus === "queued" || existingStatus === "in_progress")) {
        return NextResponse.json({
          status: existingStatus,
          responseId: existingJob.responseId,
          completedPages: Number(existingJob.completedPages ?? 0),
          totalPages: Number(existingJob.totalPages ?? 0),
          batchStart: Number(existingJob.batchStart ?? 1),
          batchEnd: Number(existingJob.batchEnd ?? 1),
          alreadyRunning: true
        }, { status: 202 });
      }
      const batch = await startDeepReviewBatch(auth, proposal, standards, 1);
      const { error: updateError } = await auth.client.from("proposals").update({
        diagram_analysis: {
          responseId: batch.result.id,
          status: batch.result.status ?? "queued",
          startedAt: new Date().toISOString(),
          batchStart: batch.batchStart,
          batchEnd: batch.batchEnd,
          totalPages: batch.totalPages,
          completedPages: 0,
          accumulatedPages: [],
          accumulatedRequirements: [],
          globalMissingInformation: [],
          projectScope: [],
          executiveSummaries: [],
          complianceValues: []
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
        summary: `Started a durable ${DEEP_REVIEW_BATCH_SIZE}-page batch AI review for ${batch.totalPages} pages.`,
        snapshot: {
          responseId: batch.result.id,
          status: batch.result.status ?? "queued",
          batchStart: batch.batchStart,
          batchEnd: batch.batchEnd,
          totalPages: batch.totalPages
        }
      });
      return NextResponse.json({
        status: batch.result.status ?? "queued",
        responseId: batch.result.id,
        model: batch.result.model,
        completedPages: 0,
        totalPages: batch.totalPages,
        batchStart: batch.batchStart,
        batchEnd: batch.batchEnd
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
