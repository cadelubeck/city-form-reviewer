import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createAiReviewNarrative } from "@/lib/ai-review";
import { reviewProposal } from "@/lib/review-engine";
import { sourceRegistry, standardLibrary } from "@/lib/standards";
import type { ProposalSubmission, SiteFinding } from "@/lib/types";
import {
  asProposalMeasurements,
  asSiteFindings,
  extractEngineeringRequirements
} from "@/lib/extract-engineering";

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

async function isAuthorized(request: Request) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) return true;
  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!token) return false;
  const supabase = createClient(url, anonKey, { auth: { persistSession: false } });
  const { data, error } = await supabase.auth.getUser(token);
  return !error && Boolean(data.user);
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
  if (!(await isAuthorized(request))) {
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

  if (process.env.OPENAI_API_KEY && proposal.proposalText?.trim()) {
    const proposalExtraction = await extractEngineeringRequirements({
      text: proposal.proposalText,
      context: `PROJECT: ${proposal.projectName}\nSUBMITTED JURISDICTION: ${proposal.jurisdiction}`,
      mode: "proposal"
    });
    const extracted = asProposalMeasurements(proposalExtraction.data);
    proposal.measurements = proposal.measurements.map((measurement) =>
      measurement.value === null || measurement.value === ""
        ? extracted.find((candidate) => candidate.metric === measurement.metric) ?? measurement
        : measurement
    );
    extraction = {
      proposalResponseId: proposalExtraction.responseId,
      detectedJurisdiction: proposalExtraction.data.jurisdiction,
      projectScope: proposalExtraction.data.projectScope
    };
  }

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
  const review = reviewProposal(proposal, standardLibrary, siteFindings, sourceRegistry);
  const aiNarrative = await createAiReviewNarrative(proposal, review);

  return NextResponse.json({
    ok: true,
    proposal,
    review,
    aiNarrative,
    extraction
  });
}
