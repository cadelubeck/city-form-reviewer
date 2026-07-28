import { embedTexts, structuredResponse } from "./openai";
import type { Comparator, ProposalMeasurement, RequirementSourceType, SiteFinding } from "./types";

type ExtractedRequirement = {
  topic: string;
  metric: string;
  description: string;
  comparator: Comparator;
  value: number | string | boolean;
  unit: string | null;
  page: number | null;
  excerpt: string;
};

type Extraction = {
  jurisdiction: {
    city: string | null;
    county: string | null;
    state: string | null;
    confidence: number;
    evidence: string;
  };
  projectScope: string[];
  requirements: ExtractedRequirement[];
};

type EmbeddedExtraction = Omit<Extraction, "requirements"> & {
  requirements: Array<ExtractedRequirement & { embedding?: number[] }>;
};

const extractionSchema = {
  type: "object",
  additionalProperties: false,
  required: ["jurisdiction", "projectScope", "requirements"],
  properties: {
    jurisdiction: {
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
    requirements: {
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
    }
  }
};

export async function extractEngineeringRequirements(options: {
  text: string;
  context: string;
  mode: "proposal" | "site-report" | "standard";
}) {
  const result = await structuredResponse<Extraction>({
    name: "civil_engineering_requirements",
    schema: extractionSchema,
    instructions: `Extract only explicit civil-engineering values and requirements. Never invent a value or citation.
Use stable snake_case metrics. Prefer aggregate_base_depth, asphalt_thickness, frost_depth,
groundwater_clearance, pipe_diameter, pipe_slope, compaction, trench_depth,
seismic_design_category, and floodplain_elevation where applicable.
"minimum" means the submitted value must be greater than or equal to the requirement.
"maximum" means it must be less than or equal. Preserve units and short evidence excerpts.
Page numbers must be supported by visible page markers; otherwise return null.
Extraction mode: ${options.mode}.`,
    input: `${options.context}\n\nDOCUMENT:\n${options.text.slice(0, 180000)}`,
    maxOutputTokens: 12000
  });
  const vectors = await embedTexts(
    result.data.requirements.map((item) =>
      [item.topic, item.metric, item.description, item.value, item.unit].filter(Boolean).join(" | ")
    )
  );
  return {
    ...result,
    data: {
      ...result.data,
      requirements: result.data.requirements.map((item, index) => ({
        ...item,
        embedding: vectors[index]
      }))
    }
  };
}

export function asProposalMeasurements(extraction: EmbeddedExtraction) {
  return extraction.requirements.map<ProposalMeasurement>((item) => ({
    metric: item.metric,
    value: item.value,
    unit: item.unit ?? undefined,
    citation: item.excerpt,
    embedding: item.embedding
  }));
}

export function asSiteFindings(
  extraction: EmbeddedExtraction,
  sourceTitle: string,
  sourceType: RequirementSourceType = "geotechnical-report"
) {
  return extraction.requirements.map<SiteFinding>((item, index) => ({
    id: `extracted-site-${index}-${item.metric}`,
    topic: item.topic,
    metric: item.metric,
    comparator: item.comparator,
    value: item.value,
    unit: item.unit ?? undefined,
    sourceType,
    sourceTitle,
    citation: item.excerpt,
    rationale: item.description,
    page: item.page,
    excerpt: item.excerpt,
    embedding: item.embedding
  }));
}
