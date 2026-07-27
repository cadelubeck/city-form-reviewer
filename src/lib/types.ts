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
