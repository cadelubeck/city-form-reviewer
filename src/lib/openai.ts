const RESPONSES_URL = "https://api.openai.com/v1/responses";
const EMBEDDINGS_URL = "https://api.openai.com/v1/embeddings";
const DEFAULT_TIMEOUT_MS = 90_000;

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

export type BackgroundResponse = {
  id: string;
  model?: string;
  status?: string;
  error?: { message?: string } | null;
  output_text?: string;
  output?: Array<{ content?: Array<{ type?: string; text?: string }> }>;
};

function responseBody(options: {
  name: string;
  schema: Record<string, unknown>;
  instructions: string;
  input: unknown;
  maxOutputTokens?: number;
  reasoningEffort?: "none" | "low" | "medium" | "high" | "xhigh" | "max";
}) {
  return {
    model: process.env.OPENAI_MODEL ?? "gpt-5.6-sol",
    instructions: options.instructions,
    input: options.input,
    reasoning: { effort: options.reasoningEffort ?? "low" },
    max_output_tokens: options.maxOutputTokens ?? 6000,
    text: {
      verbosity: "high",
      format: {
        type: "json_schema",
        name: options.name,
        strict: true,
        schema: options.schema
      }
    }
  };
}

export async function startBackgroundStructuredResponse(options: {
  name: string;
  schema: Record<string, unknown>;
  instructions: string;
  input: unknown;
  maxOutputTokens?: number;
  reasoningEffort?: "none" | "low" | "medium" | "high" | "xhigh" | "max";
}) {
  const response = await fetch(RESPONSES_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey()}`,
      "Content-Type": "application/json"
    },
    signal: AbortSignal.timeout(60_000),
    body: JSON.stringify({ ...responseBody(options), background: true, store: true })
  });
  const body = await response.json() as BackgroundResponse;
  if (!response.ok || !body.id) {
    throw new Error(body.error?.message ?? `OpenAI API error ${response.status}`);
  }
  return body;
}

export async function retrieveBackgroundResponse(responseId: string) {
  const response = await fetch(`${RESPONSES_URL}/${encodeURIComponent(responseId)}`, {
    headers: { Authorization: `Bearer ${apiKey()}` },
    signal: AbortSignal.timeout(30_000)
  });
  const body = await response.json() as BackgroundResponse;
  if (!response.ok) {
    throw new Error(body.error?.message ?? `OpenAI API error ${response.status}`);
  }
  return body;
}

export function parseStructuredResponse<T>(body: BackgroundResponse) {
  const text = outputText(body);
  if (!text) throw new Error("OpenAI returned no structured output.");
  return JSON.parse(text) as T;
}

export async function structuredResponse<T>(options: {
  name: string;
  schema: Record<string, unknown>;
  instructions: string;
  input: unknown;
  maxOutputTokens?: number;
  reasoningEffort?: "none" | "low" | "medium" | "high" | "xhigh" | "max";
  timeoutMs?: number;
}) {
  let lastError: Error | null = null;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const response = await fetch(RESPONSES_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey()}`,
          "Content-Type": "application/json"
        },
        signal: AbortSignal.timeout(options.timeoutMs ?? DEFAULT_TIMEOUT_MS),
        body: JSON.stringify(responseBody(options))
      });

      const body = (await response.json()) as {
        id?: string;
        model?: string;
        error?: { message?: string };
        output_text?: string;
        output?: Array<{ content?: Array<{ type?: string; text?: string }> }>;
      };
      if (!response.ok) {
        const error = new Error(body.error?.message ?? `OpenAI API error ${response.status}`);
        if (response.status === 429 || response.status >= 500) {
          throw Object.assign(error, { retryable: true });
        }
        throw Object.assign(error, { retryable: false });
      }
      const text = outputText(body);
      if (!text) throw new Error("OpenAI returned no structured output.");
      return { data: JSON.parse(text) as T, responseId: body.id, model: body.model };
    } catch (error) {
      lastError = error instanceof Error ? error : new Error("OpenAI request failed.");
      const retryable = (lastError as Error & { retryable?: boolean }).retryable === true;
      if (!retryable || attempt === 1) break;
      await new Promise((resolve) => setTimeout(resolve, 750));
    }
  }
  if (lastError?.name === "TimeoutError") {
    throw new Error(`The AI request exceeded ${Math.round((options.timeoutMs ?? DEFAULT_TIMEOUT_MS) / 1000)} seconds. The saved record is unchanged; retry the review.`);
  }
  throw lastError ?? new Error("OpenAI request failed.");
}

export async function embedTexts(input: string[]) {
  if (!input.length) return [];
  const response = await fetch(EMBEDDINGS_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey()}`,
      "Content-Type": "application/json"
    },
    signal: AbortSignal.timeout(60_000),
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
