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
}

export interface ProposalMeasurement {
  metric: string;
  value: number | string | boolean | null;
  unit?: string;
  citation?: string;
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
}

export interface ControllingRequirement {
  baseRequirement: Requirement;
  controlling: Requirement | SiteFinding;
  overrideApplied: boolean;
  overrideReason: string;
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
