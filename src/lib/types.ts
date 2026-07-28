export type ReviewStatus = "draft" | "in_review" | "approved" | "needs_revision";
export type RiskLevel = "low" | "medium" | "high";

export type Review = {
  id: string;
  user_id: string;
  city: string;
  permit_type: string;
  applicant: string;
  notes: string;
  risk_level: RiskLevel;
  status: ReviewStatus;
  created_at: string;
  updated_at: string;
};

export type UsageEvent = {
  id: string;
  user_id: string;
  event_type: string;
  endpoint: string | null;
  method: string | null;
  status_code: number | null;
  duration_ms: number | null;
  details: Record<string, unknown>;
  created_at: string;
};

export type RequirementSourceType =
  | "city-standard"
  | "client-standard"
  | "geotechnical-report"
  | "environmental-report"
  | "seismic-source"
  | "water-table-source"
  | "flood-source"
  | "soil-source";

export type Comparator = "minimum" | "maximum" | "exact" | "presence";
export type FindingStatus = "pass" | "fail" | "missing" | "needs-review";
export type EngineeringDocumentType =
  | "city-standard"
  | "client-standard"
  | "manual"
  | "geotechnical-report"
  | "environmental-report"
  | "seismic-source"
  | "water-table-source"
  | "flood-source"
  | "soil-source";

export type EngineeringDocument = {
  id: string;
  user_id: string;
  title: string;
  document_type: EngineeringDocumentType;
  jurisdiction: string;
  client_id: string | null;
  project_types: string[];
  effective_date: string | null;
  original_name: string | null;
  extraction_status: "pending" | "complete" | "failed";
  detected_jurisdiction: Record<string, unknown>;
  project_scope: string[];
  requirements: Array<Requirement | SiteFinding>;
  openai_response_id: string | null;
  created_at: string;
  updated_at: string;
};

export type SourceRegistryItem = {
  id: string;
  name: string;
  type: RequirementSourceType | "reference-library";
  url?: string;
  use: string;
};

export interface Requirement {
  id: string;
  clientId: string;
  jurisdiction: string;
  topic: string;
  metric: string;
  comparator: Comparator;
  value: number | string | boolean;
  unit?: string;
  sourceType: RequirementSourceType;
  sourceTitle: string;
  citation: string;
  sourceUrl?: string;
  scopeTags: string[];
  rationale: string;
  page?: number | null;
  excerpt?: string;
  embedding?: number[];
}

export interface ProposalMeasurement {
  metric: string;
  value: number | string | boolean | null;
  unit?: string;
  citation?: string;
  embedding?: number[];
}

export interface ProposalSubmission {
  projectName: string;
  clientId: string;
  jurisdiction: string;
  address: string;
  scopeTags: string[];
  measurements: ProposalMeasurement[];
  proposalText?: string;
  uploadedFiles?: string[];
}

export interface SiteFinding {
  id: string;
  topic: string;
  metric: string;
  comparator: Comparator;
  value: number | string | boolean;
  unit?: string;
  sourceType: RequirementSourceType;
  sourceTitle: string;
  citation: string;
  sourceUrl?: string;
  rationale: string;
  page?: number | null;
  excerpt?: string;
  embedding?: number[];
}

export interface ControllingRequirement {
  baseRequirement: Requirement;
  controlling: Requirement | SiteFinding;
  overrideApplied: boolean;
  overrideReason: string;
  conflict?: string;
}

export interface ReviewFinding {
  requirementId: string;
  topic: string;
  metric: string;
  requiredValue: number | string | boolean;
  submittedValue: number | string | boolean | null;
  unit?: string;
  status: FindingStatus;
  controllingSource: string;
  citation: string;
  explanation: string;
  recommendedCorrection: string;
  sourcePage?: number | null;
  sourceExcerpt?: string;
}

export interface ReviewResult {
  summary: {
    projectName: string;
    pass: number;
    fail: number;
    missing: number;
    needsReview: number;
    generatedAt: string;
  };
  controllingRequirements: ControllingRequirement[];
  findings: ReviewFinding[];
  nextActions: string[];
  sourcesUsed: SourceRegistryItem[];
}

export type ProposalStatus = "pending" | "in_review" | "needs_updates" | "accepted" | "rejected";
export type ProposalPriority = "" | "low" | "medium" | "high";

export type ProposalSection = {
  id: string;
  title: string;
  startLine: number;
  score: "green" | "yellow" | "red";
  notes: string;
  statutes?: Array<{ id: string; title: string; url: string; relevance: string; jurisdiction: string }>;
  aiReview?: {
    score: "green" | "yellow" | "red";
    summary: string;
    concerns: string[];
    recommendations: string[];
  };
};

export type ProposalHighlight = {
  id: string;
  text: string;
  note: string;
  sectionId: string;
  createdAt: string;
};

export type ProposalVersion = {
  label: string;
  original_name: string | null;
  uploaded_at: string;
  text_content?: string;
  sections?: ProposalSection[];
  extracted_requirements?: Array<Record<string, unknown>>;
};

export type Proposal = {
  id: string;
  user_id: string;
  name: string;
  client: string;
  location: string;
  status: ProposalStatus;
  priority: ProposalPriority;
  assigned_to_id: string | null;
  assigned_to_name: string | null;
  due_date: string | null;
  original_name: string | null;
  text_content: string;
  detected_jurisdiction: Record<string, unknown>;
  project_scope: string[];
  extracted_requirements: Array<Record<string, unknown>>;
  sections: ProposalSection[];
  highlights: ProposalHighlight[];
  versions: ProposalVersion[];
  compliance_review: ReviewResult | null;
  diagram_analysis: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
};
