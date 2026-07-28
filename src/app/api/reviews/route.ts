import { NextResponse } from "next/server";
import { createAiReviewNarrative } from "@/lib/ai-review";
import { reviewProposal } from "@/lib/review-engine";
import { sourceRegistry, standardLibrary } from "@/lib/standards";
import type { ProposalSubmission, SiteFinding } from "@/lib/types";

type ReviewRequest = {
  proposal?: ProposalSubmission;
  siteFindings?: SiteFinding[];
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
  const body = (await request.json()) as ReviewRequest;

  if (!isProposalSubmission(body.proposal)) {
    return NextResponse.json(
      { ok: false, message: "Missing proposal details for review." },
      { status: 400 }
    );
  }

  const proposal = body.proposal;
  const siteFindings = Array.isArray(body.siteFindings) ? body.siteFindings : [];
  const review = reviewProposal(proposal, standardLibrary, siteFindings, sourceRegistry);
  const aiNarrative = await createAiReviewNarrative(proposal, review);

  return NextResponse.json({
    ok: true,
    proposal,
    review,
    aiNarrative
  });
}
