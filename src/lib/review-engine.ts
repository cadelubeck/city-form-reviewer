import type {
  ControllingRequirement,
  ProposalMeasurement,
  ProposalSubmission,
  Requirement,
  ReviewFinding,
  ReviewResult,
  SiteFinding,
  SourceRegistryItem
} from "./types";

function appliesToProposal(requirement: Requirement, proposal: ProposalSubmission) {
  const sameClient = requirement.clientId === proposal.clientId;
  const sameJurisdiction = requirement.jurisdiction === proposal.jurisdiction;
  const sameScope = requirement.scopeTags.some((tag) => proposal.scopeTags.includes(tag));
  return sameClient && sameJurisdiction && sameScope;
}

function findSubmittedValue(measurements: ProposalMeasurement[], metric: string) {
  return measurements.find((measurement) => measurement.metric === metric);
}

function isStricter(candidate: Requirement | SiteFinding, baseline: Requirement) {
  if (candidate.metric !== baseline.metric || candidate.comparator !== baseline.comparator) {
    return false;
  }

  if (candidate.comparator === "minimum") {
    return Number(candidate.value) > Number(baseline.value);
  }

  if (candidate.comparator === "maximum") {
    return Number(candidate.value) < Number(baseline.value);
  }

  if (candidate.comparator === "presence") {
    return Boolean(candidate.value) === true && Boolean(baseline.value) === false;
  }

  return candidate.value !== baseline.value;
}

function compareValue(
  requirement: Requirement | SiteFinding,
  submitted: ProposalMeasurement | undefined
): Pick<ReviewFinding, "status" | "explanation" | "submittedValue"> {
  if (!submitted || submitted.value === null || submitted.value === "") {
    return {
      status: "missing",
      submittedValue: null,
      explanation: "The proposal does not provide this required value."
    };
  }

  if (requirement.comparator === "minimum") {
    const passes = Number(submitted.value) >= Number(requirement.value);
    return {
      status: passes ? "pass" : "fail",
      submittedValue: submitted.value,
      explanation: passes
        ? "The submitted value meets or exceeds the controlling minimum."
        : "The submitted value is below the controlling minimum."
    };
  }

  if (requirement.comparator === "maximum") {
    const passes = Number(submitted.value) <= Number(requirement.value);
    return {
      status: passes ? "pass" : "fail",
      submittedValue: submitted.value,
      explanation: passes
        ? "The submitted value is at or below the controlling maximum."
        : "The submitted value is above the controlling maximum."
    };
  }

  if (requirement.comparator === "presence") {
    const isPresent = submitted.value ? true : false;
    return {
      status: isPresent ? "pass" : "missing",
      submittedValue: submitted.value,
      explanation: isPresent
        ? "The proposal includes the required item."
        : "The proposal does not document the required item."
    };
  }

  return {
    status: submitted.value === requirement.value ? "pass" : "needs-review",
    submittedValue: submitted.value,
    explanation:
      submitted.value === requirement.value
        ? "The submitted value matches the controlling requirement."
        : "The submitted value differs from the controlling requirement and needs reviewer judgment."
  };
}

export function selectControllingRequirements(
  proposal: ProposalSubmission,
  standards: Requirement[],
  siteFindings: SiteFinding[]
): ControllingRequirement[] {
  return standards.filter((standard) => appliesToProposal(standard, proposal)).map((baseRequirement) => {
    const stricterFinding = siteFindings.find((finding) => isStricter(finding, baseRequirement));

    if (!stricterFinding) {
      return {
        baseRequirement,
        controlling: baseRequirement,
        overrideApplied: false,
        overrideReason: "City standard remains controlling."
      };
    }

    return {
      baseRequirement,
      controlling: stricterFinding,
      overrideApplied: true,
      overrideReason: "Site-specific report is stricter than the city standard."
    };
  });
}

export function reviewProposal(
  proposal: ProposalSubmission,
  standards: Requirement[],
  siteFindings: SiteFinding[],
  sourcesUsed: SourceRegistryItem[]
): ReviewResult {
  const controllingRequirements = selectControllingRequirements(proposal, standards, siteFindings);
  const findings = controllingRequirements.map<ReviewFinding>(({ baseRequirement, controlling }) => {
    const submitted = findSubmittedValue(proposal.measurements, controlling.metric);
    const comparison = compareValue(controlling, submitted);

    return {
      requirementId: baseRequirement.id,
      topic: controlling.topic,
      metric: controlling.metric,
      requiredValue: controlling.value,
      submittedValue: comparison.submittedValue,
      unit: controlling.unit,
      status: comparison.status,
      controllingSource: controlling.sourceTitle,
      citation: controlling.citation,
      explanation: comparison.explanation
    };
  });

  const pass = findings.filter((finding) => finding.status === "pass").length;
  const fail = findings.filter((finding) => finding.status === "fail").length;
  const missing = findings.filter((finding) => finding.status === "missing").length;
  const needsReview = findings.filter((finding) => finding.status === "needs-review").length;

  return {
    summary: {
      projectName: proposal.projectName,
      pass,
      fail,
      missing,
      needsReview,
      generatedAt: new Date().toISOString()
    },
    controllingRequirements,
    findings,
    nextActions: findings
      .filter((finding) => finding.status !== "pass")
      .map((finding) => `${finding.topic}: ${finding.explanation}`),
    sourcesUsed
  };
}
