import { NextResponse } from "next/server";
import { reviewProposal } from "@/lib/review-engine";
import { sourceRegistry, standardLibrary } from "@/lib/standards";
import type { ProposalSubmission, SiteFinding } from "@/lib/types";
import {
  asSiteFindings,
  extractEngineeringRequirements
} from "@/lib/extract-engineering";
import { authenticatedSupabase } from "@/lib/server-supabase";
import type { EngineeringDocument, Requirement } from "@/lib/types";

type ReviewRequest = {
  proposal?: ProposalSubmission;
  siteFindings?: SiteFinding[];
  siteDocumentText?: string;
};

function isProposalSubmission(value: unknown): value is ProposalSubmission {
  const proposal = value as ProposalSubmission;
  return Boolean(
    proposal &&
      typeof proposal.projectName === "string" &&
      typeof proposal.clientId === "string" &&
      typeof proposal.jurisdiction === "string" &&
      typeof proposal.address === "string" &&
      Array.isArray(proposal.scopeTags) &&
      Array.isArray(proposal.measurements)
  );
}

export async function GET() {
  return NextResponse.json({
    ok: true,
    message: "City Form Reviewer API is ready.",
    sources: sourceRegistry,
    standardsAvailable: standardLibrary.length
  });
}

export async function POST(request: Request) {
  const auth = await authenticatedSupabase(request);
  if (!auth && process.env.NEXT_PUBLIC_SUPABASE_URL) {
    return NextResponse.json({ ok: false, message: "Authentication required." }, { status: 401 });
  }
  const body = (await request.json()) as ReviewRequest;

  if (!isProposalSubmission(body.proposal)) {
    return NextResponse.json(
      { ok: false, message: "Missing proposal details for review." },
      { status: 400 }
    );
  }

  const proposal = { ...body.proposal };
  if ((proposal.proposalText?.length ?? 0) > 180000 || (body.siteDocumentText?.length ?? 0) > 180000) {
    return NextResponse.json(
      { ok: false, message: "Submitted document text exceeds the 180,000 character review limit." },
      { status: 413 }
    );
  }
  let siteFindings = Array.isArray(body.siteFindings) ? body.siteFindings : [];
  let extraction:
    | { proposalResponseId?: string; siteResponseId?: string; detectedJurisdiction?: unknown; projectScope?: string[] }
    | undefined;

  if (process.env.OPENAI_API_KEY && body.siteDocumentText?.trim()) {
    const siteExtraction = await extractEngineeringRequirements({
      text: body.siteDocumentText,
      context: `PROJECT: ${proposal.projectName}\nJURISDICTION: ${proposal.jurisdiction}`,
      mode: "site-report"
    });
    siteFindings = [
      ...siteFindings,
      ...asSiteFindings(siteExtraction.data, "Submitted geotechnical/site report")
    ];
    extraction = { ...extraction, siteResponseId: siteExtraction.responseId };
  }
  let dynamicStandards: Requirement[] = [];
  if (auth) {
    const { data } = await auth.client
      .from("engineering_documents")
      .select("*")
      .is("archived_at", null);
    const normalize = (value: string) => value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    const documents = ((data ?? []) as EngineeringDocument[]).filter((document) =>
      (!document.jurisdiction || normalize(document.jurisdiction) === normalize(proposal.jurisdiction)) &&
      (document.document_type === "city-standard" || !document.client_id || normalize(document.client_id) === normalize(proposal.clientId))
    );
    dynamicStandards = documents
      .filter((document) => ["city-standard", "client-standard", "manual"].includes(document.document_type))
      .flatMap((document) => document.requirements as Requirement[]);
    siteFindings = [
      ...siteFindings,
      ...documents
        .filter((document) => !["city-standard", "client-standard", "manual"].includes(document.document_type))
        .flatMap((document) => document.requirements as SiteFinding[])
    ];
  }
  const review = reviewProposal(
    proposal,
    [...standardLibrary, ...dynamicStandards],
    siteFindings,
    sourceRegistry
  );
  return NextResponse.json({
    ok: true,
    proposal,
    review,
    extraction
  });
}
