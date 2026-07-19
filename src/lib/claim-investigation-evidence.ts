/**
 * Conservative evidence-assessment boundary for Claim Investigation.
 *
 * A passage candidate becomes answering evidence only when an assessment maps
 * an exact answer span to every facet required by the atomic question. The
 * result is evidence sufficiency, never a truth verdict.
 */

import type {
  EvidenceArtifact,
  EvidenceRelation,
  EvidenceSufficiency,
  EvidenceSufficiencyState,
  InvestigationBundle,
  InvestigationContractIssue,
  InvestigationContractValidation,
} from "./claim-investigation-contract";
import { CLAIM_INVESTIGATION_CONTRACT_VERSION, validateInvestigationBundle } from "./claim-investigation-contract";
import type {
  InvestigationCase,
  InvestigationVerificationFacet,
  InvestigationVerificationRequirement,
} from "./claim-investigation-case";
import { validateInvestigationCase } from "./claim-investigation-case";

export type EvidencePassageAssessmentState =
  | "answers_question"
  | "relevant_but_incomplete"
  | "irrelevant";

export interface EvidencePassageAssessment {
  artifactId: string;
  questionId: string;
  state: EvidencePassageAssessmentState;
  relation: EvidenceRelation;
  exactAnswerSpan?: string;
  coveredFacets: InvestigationVerificationFacet[];
  missingFacets: InvestigationVerificationFacet[];
  outdated: boolean;
  rationale: string;
}

export interface EvidenceSufficiencyEvaluation {
  validation: InvestigationContractValidation;
  sufficiency?: EvidenceSufficiency;
  qualifyingArtifactIds: string[];
  independentOriginCount: number;
}

const FACETS = new Set<InvestigationVerificationFacet>([
  "actor", "predicate", "object", "attribution", "time", "place", "quantity",
]);
const STATES = new Set<EvidencePassageAssessmentState>([
  "answers_question", "relevant_but_incomplete", "irrelevant",
]);
const RELATIONS = new Set<EvidenceRelation>(["supports", "refutes", "context", "irrelevant"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function addIssue(
  issues: InvestigationContractIssue[],
  path: string,
  code: InvestigationContractIssue["code"],
  message: string,
): void {
  issues.push({ path, code, message });
}

function validateFacetArray(
  value: unknown,
  path: string,
  issues: InvestigationContractIssue[],
): Set<InvestigationVerificationFacet> {
  const result = new Set<InvestigationVerificationFacet>();
  if (!Array.isArray(value)) {
    addIssue(issues, path, "invalid_type", "must be an array");
    return result;
  }
  value.forEach((facet, index) => {
    if (!FACETS.has(facet as InvestigationVerificationFacet)) {
      addIssue(issues, `${path}[${index}]`, "invalid_value", "has an unsupported facet");
      return;
    }
    if (result.has(facet as InvestigationVerificationFacet)) {
      addIssue(issues, `${path}[${index}]`, "duplicate_id", "must be unique");
    }
    result.add(facet as InvestigationVerificationFacet);
  });
  return result;
}

function assessmentValidation(
  assessments: unknown,
  bundle: InvestigationBundle,
  investigationCase: InvestigationCase,
): InvestigationContractValidation {
  const issues: InvestigationContractIssue[] = [];
  const bundleValidation = validateInvestigationBundle(bundle);
  if (!bundleValidation.ok) {
    return { ok: false, issues: bundleValidation.issues.map((entry) => ({ ...entry, path: `bundle.${entry.path}` })) };
  }
  const caseValidation = validateInvestigationCase(investigationCase, bundle);
  if (!caseValidation.ok) {
    return { ok: false, issues: caseValidation.issues };
  }
  if (!Array.isArray(assessments)) {
    return { ok: false, issues: [{ path: "assessments", code: "invalid_type", message: "must be an array" }] };
  }
  if (assessments.length > 80) {
    addIssue(issues, "assessments", "out_of_bounds", "must contain at most 80 assessments");
  }
  const caseQuestionIds = new Set(investigationCase.questionIds);
  const artifacts = new Map(bundle.evidence.map((artifact) => [artifact.id, artifact]));
  const seenPairs = new Set<string>();

  assessments.forEach((assessment, index) => {
    const path = `assessments[${index}]`;
    if (!isRecord(assessment)) {
      addIssue(issues, path, "invalid_type", "must be an object");
      return;
    }
    const artifactId = typeof assessment.artifactId === "string" ? assessment.artifactId : "";
    const questionId = typeof assessment.questionId === "string" ? assessment.questionId : "";
    if (!artifactId) addIssue(issues, `${path}.artifactId`, "missing_value", "must not be empty");
    if (!questionId) addIssue(issues, `${path}.questionId`, "missing_value", "must not be empty");
    const artifact = artifacts.get(artifactId);
    if (artifactId && !artifact) {
      addIssue(issues, `${path}.artifactId`, "unknown_reference", "must reference bundle.evidence");
    }
    if (questionId && !caseQuestionIds.has(questionId)) {
      addIssue(issues, `${path}.questionId`, "unknown_reference", "must reference case.questionIds");
    }
    if (artifact && questionId && artifact.questionId !== questionId) {
      addIssue(issues, `${path}.questionId`, "unknown_reference", "must match the evidence artifact question");
    }
    const pair = `${artifactId}\u0000${questionId}`;
    if (seenPairs.has(pair)) addIssue(issues, path, "duplicate_id", "must be unique per artifact and question");
    seenPairs.add(pair);

    if (!STATES.has(assessment.state as EvidencePassageAssessmentState)) {
      addIssue(issues, `${path}.state`, "invalid_value", "has an unsupported assessment state");
    }
    if (!RELATIONS.has(assessment.relation as EvidenceRelation)) {
      addIssue(issues, `${path}.relation`, "invalid_value", "has an unsupported evidence relation");
    }
    if (artifact && assessment.relation !== artifact.relation) {
      addIssue(issues, `${path}.relation`, "inconsistent_state", "must match the evidence ledger relation");
    }
    const covered = validateFacetArray(assessment.coveredFacets, `${path}.coveredFacets`, issues);
    const missing = validateFacetArray(assessment.missingFacets, `${path}.missingFacets`, issues);
    covered.forEach((facet) => {
      if (missing.has(facet)) addIssue(issues, path, "inconsistent_state", `${facet} cannot be covered and missing`);
    });
    if (typeof assessment.outdated !== "boolean") {
      addIssue(issues, `${path}.outdated`, "invalid_type", "must be a boolean");
    }
    if (typeof assessment.rationale !== "string" || !assessment.rationale.trim()) {
      addIssue(issues, `${path}.rationale`, "missing_value", "must not be empty");
    } else if (Array.from(assessment.rationale.trim()).length > 400) {
      addIssue(issues, `${path}.rationale`, "out_of_bounds", "must be at most 400 characters");
    }

    const exactAnswerSpan = typeof assessment.exactAnswerSpan === "string"
      ? assessment.exactAnswerSpan.trim()
      : "";
    if (assessment.state === "answers_question") {
      if (!exactAnswerSpan) {
        addIssue(issues, `${path}.exactAnswerSpan`, "missing_value", "answering evidence requires an exact answer span");
      } else if (artifact && !artifact.exactExcerpt.includes(exactAnswerSpan)) {
        addIssue(issues, `${path}.exactAnswerSpan`, "invalid_value", "must be an exact substring of the fetched excerpt");
      }
      if (assessment.relation === "context" || assessment.relation === "irrelevant") {
        addIssue(issues, `${path}.relation`, "inconsistent_state", "answering evidence must support or refute the proposition");
      }
    } else if (exactAnswerSpan) {
      addIssue(issues, `${path}.exactAnswerSpan`, "inconsistent_state", "non-answering evidence must not expose an answer span");
    }
  });

  return issues.length === 0 ? { ok: true } : { ok: false, issues };
}

function requirementMap(investigationCase: InvestigationCase): Map<string, InvestigationVerificationRequirement> {
  return new Map(investigationCase.requirements.map((requirement) => [requirement.questionId, requirement]));
}

function originKey(artifact: EvidenceArtifact): string {
  if (artifact.sharedOriginGroup) return `shared:${artifact.sharedOriginGroup}`;
  if (artifact.publisher) return `publisher:${artifact.publisher.trim().toLocaleLowerCase()}`;
  if (artifact.url) {
    try {
      return `host:${new URL(artifact.url).hostname.toLocaleLowerCase().replace(/^www\./u, "")}`;
    } catch {
      // The bundle validator reports malformed URLs before this function runs.
    }
  }
  if (artifact.contentFingerprint) return `unattributed-fingerprint:${artifact.contentFingerprint}`;
  return `artifact:${artifact.id}`;
}

function hasEveryRequiredFacet(
  assessment: EvidencePassageAssessment,
  requirement: InvestigationVerificationRequirement,
): boolean {
  const covered = new Set(assessment.coveredFacets);
  return assessment.missingFacets.length === 0 &&
    requirement.requiredFacets.every((facet) => covered.has(facet));
}

function resultingState(input: {
  answered: string[];
  unanswered: string[];
  conflicting: string[];
  outdatedOnly: string[];
  evidenceCount: number;
  independentOriginCount: number;
  minimumIndependentSources: number;
}): EvidenceSufficiencyState {
  if (input.conflicting.length > 0) return "conflicting";
  if (input.unanswered.length === 0 && input.independentOriginCount >= input.minimumIndependentSources) {
    return "sufficient";
  }
  if (input.unanswered.length > 0 && input.outdatedOnly.length === input.unanswered.length) return "outdated";
  if (input.evidenceCount === 0) return "not_yet_verifiable";
  return "insufficient";
}

/**
 * Aggregate already-assessed, fetched passages. This function cannot create an
 * InvestigationFinding and deliberately treats related-but-incomplete text as
 * insufficient.
 */
export function evaluateInvestigationEvidenceSufficiency(
  bundle: InvestigationBundle,
  investigationCase: InvestigationCase,
  assessments: EvidencePassageAssessment[],
  assessedAt: string,
): EvidenceSufficiencyEvaluation {
  const validation = assessmentValidation(assessments, bundle, investigationCase);
  if (!validation.ok) {
    return { validation, qualifyingArtifactIds: [], independentOriginCount: 0 };
  }
  if (!Number.isFinite(Date.parse(assessedAt))) {
    return {
      validation: {
        ok: false,
        issues: [{ path: "assessedAt", code: "invalid_value", message: "must be an ISO-compatible timestamp" }],
      },
      qualifyingArtifactIds: [],
      independentOriginCount: 0,
    };
  }

  const artifacts = new Map(bundle.evidence.map((artifact) => [artifact.id, artifact]));
  const requirements = requirementMap(investigationCase);
  const qualifying = assessments.filter((assessment) => {
    const artifact = artifacts.get(assessment.artifactId)!;
    const requirement = requirements.get(assessment.questionId)!;
    return assessment.state === "answers_question" &&
      !assessment.outdated &&
      requirement.acceptableSourceRoles.includes(artifact.sourceRole) &&
      hasEveryRequiredFacet(assessment, requirement);
  });
  const qualifyingArtifactIds = [...new Set(qualifying.map((assessment) => assessment.artifactId))];
  const independentOrigins = new Set(qualifying.map((assessment) => originKey(artifacts.get(assessment.artifactId)!)));

  const answered: string[] = [];
  const unanswered: string[] = [];
  const conflicting: string[] = [];
  const outdatedOnly: string[] = [];
  for (const questionId of investigationCase.questionIds) {
    const questionAssessments = assessments.filter((assessment) => assessment.questionId === questionId);
    const qualifyingForQuestion = qualifying.filter((assessment) => assessment.questionId === questionId);
    const relations = new Set(qualifyingForQuestion.map((assessment) => assessment.relation));
    if (relations.has("supports") && relations.has("refutes")) {
      conflicting.push(questionId);
      unanswered.push(questionId);
      continue;
    }
    if (qualifyingForQuestion.length > 0) {
      answered.push(questionId);
      continue;
    }
    unanswered.push(questionId);
    const requirement = requirements.get(questionId)!;
    const completeButOutdated = questionAssessments.some((assessment) => {
      const artifact = artifacts.get(assessment.artifactId)!;
      return assessment.state === "answers_question" && assessment.outdated &&
        requirement.acceptableSourceRoles.includes(artifact.sourceRole) &&
        hasEveryRequiredFacet(assessment, requirement);
    });
    if (completeButOutdated) outdatedOnly.push(questionId);
  }

  const minimumIndependentSources = bundle.plan.minimumIndependentSources ?? 0;
  const state = resultingState({
    answered,
    unanswered,
    conflicting,
    outdatedOnly,
    evidenceCount: bundle.evidence.length,
    independentOriginCount: independentOrigins.size,
    minimumIndependentSources,
  });
  const sourceShortfall = Math.max(0, minimumIndependentSources - independentOrigins.size);
  const rationale = [
    `${answered.length}/${investigationCase.questionIds.length} questions have exact answering evidence.`,
    `${independentOrigins.size} independent evidence origins qualify.`,
    sourceShortfall > 0 ? `${sourceShortfall} additional independent origins are required.` : "",
    conflicting.length > 0 ? `${conflicting.length} questions have conflicting answering evidence.` : "",
    outdatedOnly.length > 0 ? `${outdatedOnly.length} questions are answered only by outdated evidence.` : "",
  ].filter(Boolean).join(" ");

  const sufficiency: EvidenceSufficiency = {
    version: CLAIM_INVESTIGATION_CONTRACT_VERSION,
    subjectId: bundle.subject.id,
    state,
    answeredQuestionIds: answered,
    unansweredQuestionIds: unanswered,
    ...(conflicting.length > 0 ? { conflictingQuestionIds: conflicting } : {}),
    ...(outdatedOnly.length > 0
      ? { outdatedArtifactIds: assessments.filter((entry) => entry.outdated).map((entry) => entry.artifactId) }
      : {}),
    rationale,
    assessedAt,
  };
  return {
    validation: { ok: true },
    sufficiency,
    qualifyingArtifactIds,
    independentOriginCount: independentOrigins.size,
  };
}
