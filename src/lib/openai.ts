const RESPONSES_URL = "https://api.openai.com/v1/responses";
const EMBEDDINGS_URL = "https://api.openai.com/v1/embeddings";

function apiKey() {
  const key = process.env.OPENAI_API_KEY;
  if (!key || key === "your_key_here") {
    throw new Error("OPENAI_API_KEY is not configured.");
  }
  return key;
}

function outputText(payload: { output_text?: string; output?: Array<{ content?: Array<{ type?: string; text?: string }> }> }) {
  if (payload.output_text) return payload.output_text;
  return (payload.output ?? [])
    .flatMap((item) => item.content ?? [])
    .filter((item) => item.type === "output_text")
    .map((item) => item.text ?? "")
    .join("");
}

export async function structuredResponse<T>(options: {
  name: string;
  schema: Record<string, unknown>;
  instructions: string;
  input: unknown;
  maxOutputTokens?: number;
}) {
  const response = await fetch(RESPONSES_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey()}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: process.env.OPENAI_MODEL ?? "gpt-5.6-sol",
      instructions: options.instructions,
      input: options.input,
      max_output_tokens: options.maxOutputTokens ?? 6000,
      text: {
        format: {
          type: "json_schema",
          name: options.name,
          strict: true,
          schema: options.schema
        }
      }
    })
  });

  const body = (await response.json()) as {
    id?: string;
    model?: string;
    error?: { message?: string };
    output_text?: string;
    output?: Array<{ content?: Array<{ type?: string; text?: string }> }>;
  };
  if (!response.ok) throw new Error(body.error?.message ?? `OpenAI API error ${response.status}`);
  const text = outputText(body);
  if (!text) throw new Error("OpenAI returned no structured output.");
  return { data: JSON.parse(text) as T, responseId: body.id, model: body.model };
}

export async function embedTexts(input: string[]) {
  if (!input.length) return [];
  const response = await fetch(EMBEDDINGS_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey()}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: process.env.OPENAI_EMBEDDING_MODEL ?? "text-embedding-3-small",
      input
    })
  });
  const body = (await response.json()) as {
    data?: Array<{ index: number; embedding: number[] }>;
    error?: { message?: string };
  };
  if (!response.ok) throw new Error(body.error?.message ?? `OpenAI embeddings error ${response.status}`);
  return (body.data ?? []).sort((a, b) => a.index - b.index).map((item) => item.embedding);
}
