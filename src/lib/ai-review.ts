import type { ProposalSubmission, ReviewResult } from "./types";
import { structuredResponse } from "./openai";

export async function createAiReviewNarrative(proposal: ProposalSubmission, review: ReviewResult) {
  if (!process.env.OPENAI_API_KEY) {
    return null;
  }

  try {
    const result = await structuredResponse<{ narrative: string }>({
      name: "engineering_review_narrative",
      schema: {
        type: "object",
        additionalProperties: false,
        required: ["narrative"],
        properties: { narrative: { type: "string" } }
      },
      instructions:
        "You are an engineering compliance assistant. Use only supplied findings and cited sources. Never approve a proposal. Clearly separate deterministic failures from items requiring licensed engineer judgment.",
      input: JSON.stringify({ proposal, review }),
      maxOutputTokens: 2500
    });
    return result.data.narrative;
  } catch (error) {
    return `AI narrative unavailable: ${error instanceof Error ? error.message : "unknown error"}`;
  }
}
