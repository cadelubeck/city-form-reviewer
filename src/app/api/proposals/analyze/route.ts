import { NextResponse } from "next/server";
import { structuredResponse } from "@/lib/openai";
import { authenticatedSupabase } from "@/lib/server-supabase";

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

export async function POST(request: Request) {
  const auth = await authenticatedSupabase(request);
  if (!auth) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  try {
    const body = await request.json();
    const mode = body.mode === "diagrams" ? "diagrams" : "section";
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
