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

function canonicalUnit(unit?: string) {
  const value = (unit ?? "").trim().toLowerCase();
  return (
    {
      inch: "in",
      inches: "in",
      '"': "in",
      foot: "ft",
      feet: "ft",
      "'": "ft",
      percent: "%",
      percentage: "%"
    }[value] ?? value
  );
}

function convertedNumber(value: number | string | boolean, from?: string, to?: string) {
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  const source = canonicalUnit(from);
  const target = canonicalUnit(to);
  if (source === target) return number;
  if (source === "ft" && target === "in") return number * 12;
  if (source === "in" && target === "ft") return number / 12;
  return null;
}

function comparable(candidate: Requirement | SiteFinding, baseline: Requirement) {
  if (candidate.metric !== baseline.metric || candidate.comparator !== baseline.comparator) return false;
  if (["minimum", "maximum"].includes(candidate.comparator)) {
    return convertedNumber(candidate.value, candidate.unit, baseline.unit) !== null;
  }
  return canonicalUnit(candidate.unit) === canonicalUnit(baseline.unit);
}

function isStricter(candidate: Requirement | SiteFinding, baseline: Requirement) {
  if (!comparable(candidate, baseline)) return false;
  const candidateValue = convertedNumber(candidate.value, candidate.unit, baseline.unit);
  const baselineValue = convertedNumber(baseline.value, baseline.unit, baseline.unit);

  if (candidate.comparator === "minimum") {
    return candidateValue !== null && baselineValue !== null && candidateValue > baselineValue;
  }

  if (candidate.comparator === "maximum") {
    return candidateValue !== null && baselineValue !== null && candidateValue < baselineValue;
  }

  if (candidate.comparator === "presence") {
    return Boolean(candidate.value) === true && Boolean(baseline.value) === false;
  }

  return candidate.value !== baseline.value;
}

function compareValue(
  requirement: Requirement | SiteFinding,
  submitted: ProposalMeasurement | undefined,
  conflict?: string
): Pick<ReviewFinding, "status" | "explanation" | "submittedValue"> {
  if (conflict) {
    return { status: "needs-review", submittedValue: submitted?.value ?? null, explanation: conflict };
  }
  if (!submitted || submitted.value === null || submitted.value === "") {
    return {
      status: "missing",
      submittedValue: null,
      explanation: "The proposal does not provide this required value."
    };
  }

  if (requirement.comparator === "minimum") {
    const submittedValue = convertedNumber(submitted.value, submitted.unit, requirement.unit);
    if (submittedValue === null) return {
      status: "needs-review",
      submittedValue: submitted.value,
      explanation: "Submitted and controlling units are not deterministically comparable."
    };
    const passes = submittedValue >= Number(requirement.value);
    return {
      status: passes ? "pass" : "fail",
      submittedValue: submitted.value,
      explanation: passes
        ? "The submitted value meets or exceeds the controlling minimum."
        : "The submitted value is below the controlling minimum."
    };
  }

  if (requirement.comparator === "maximum") {
    const submittedValue = convertedNumber(submitted.value, submitted.unit, requirement.unit);
    if (submittedValue === null) return {
      status: "needs-review",
      submittedValue: submitted.value,
      explanation: "Submitted and controlling units are not deterministically comparable."
    };
    const passes = submittedValue <= Number(requirement.value);
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
    const relatedFindings = siteFindings.filter((finding) => finding.metric === baseRequirement.metric);
    const incompatible = relatedFindings.find((finding) => !comparable(finding, baseRequirement));
    if (incompatible) {
      return {
        baseRequirement,
        controlling: baseRequirement,
        overrideApplied: false,
        overrideReason: "City standard remains the provisional baseline.",
        conflict: `The site-specific source uses an incompatible unit, comparator, or value for ${baseRequirement.metric}. A licensed engineer must resolve the conflict.`
      };
    }
    const stricterFinding = relatedFindings
      .filter((finding) => isStricter(finding, baseRequirement))
      .sort((a, b) => {
        const av = convertedNumber(a.value, a.unit, baseRequirement.unit) ?? 0;
        const bv = convertedNumber(b.value, b.unit, baseRequirement.unit) ?? 0;
        return baseRequirement.comparator === "maximum" ? av - bv : bv - av;
      })[0];

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
  const findings = controllingRequirements.map<ReviewFinding>(({ baseRequirement, controlling, conflict }) => {
    const submitted = findSubmittedValue(proposal.measurements, controlling.metric);
    const comparison = compareValue(controlling, submitted, conflict);

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
      explanation: comparison.explanation,
      recommendedCorrection:
        comparison.status === "fail"
          ? `Revise the proposal to meet ${String(controlling.value)} ${controlling.unit ?? ""}.`.trim()
          : comparison.status === "missing"
            ? "Provide the missing value or supporting document."
            : comparison.status === "needs-review"
              ? "Have the responsible engineer resolve the comparison before approval."
              : "",
      sourcePage: controlling.page,
      sourceExcerpt: controlling.excerpt
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
