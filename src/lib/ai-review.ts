import type { ProposalSubmission, ReviewResult } from "./types";

export async function createAiReviewNarrative(proposal: ProposalSubmission, review: ReviewResult) {
  if (!process.env.OPENAI_API_KEY) {
    return null;
  }

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: process.env.OPENAI_MODEL ?? "gpt-5-mini",
      input: [
        {
          role: "system",
          content:
            "You are an engineering compliance assistant. Use only the supplied review result and sources. Do not approve a proposal; flag items for licensed human review."
        },
        {
          role: "user",
          content: JSON.stringify({
            proposal,
            review,
            instructions:
              "Write concise reviewer notes with failing items, missing items, controlling sources, site-specific overrides, public-source flags, and next actions."
          })
        }
      ]
    })
  });

  if (!response.ok) {
    return `AI narrative unavailable: OpenAI API returned ${response.status}.`;
  }

  const data = (await response.json()) as { output_text?: string };
  return data.output_text ?? null;
}
