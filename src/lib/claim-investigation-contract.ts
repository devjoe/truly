/**
 * Model-, transport-, and UI-neutral Claim Investigation domain contract.
 *
 * This module intentionally does not import Chrome APIs, model clients, or the
 * Side Panel runtime. It is the shared language for development evaluation,
 * a future native companion, and synthetic UI fixtures. The current release
 * runtime does not persist or execute this contract yet.
 */

export const CLAIM_INVESTIGATION_CONTRACT_VERSION = 2 as const;

export type InvestigationScope = "page" | "focus";
export type InvestigationConsequence =
  | "health"
  | "safety"
  | "money"
  | "rights"
  | "law"
  | "public_interest";
export type InvestigationAttributionModality =
  | "statement"
  | "report"
  | "estimate"
  | "allegation"
  | "forecast"
  | "analysis";
export type InvestigationQuestionBasis = "literal" | "contextual";
export type InvestigationQuestionPurpose =
  | "proposition"
  | "identity"
  | "timeline"
  | "quantity"
  | "context"
  | "counterevidence";
export type EvidenceSourceRole =
  | "primary"
  | "independent_secondary"
  | "fact_check"
  | "claim_origin"
  | "user_supplied";
export type EvidenceRelation = "supports" | "refutes" | "context" | "irrelevant";
export type EvidenceSufficiencyState =
  | "sufficient"
  | "insufficient"
  | "conflicting"
  | "outdated"
  | "not_yet_verifiable";
export type InvestigationFindingState =
  | "supported_by_available_evidence"
  | "contradicted_by_available_evidence"
  | "mixed"
  | "insufficient"
  | "conflicting"
  | "outdated"
  | "not_yet_verifiable";

export interface InvestigationSourceSnapshot {
  title?: string;
  publisher?: string;
  url?: string;
  publishedAt?: string;
  observedAt: string;
  contentFingerprint: string;
}

export interface InvestigationAttribution {
  actor: string;
  relation: string;
  modality: InvestigationAttributionModality;
}

export interface InvestigationProposition {
  originalSpan: string;
  normalizedText: string;
  time?: string;
  place?: string;
  quantity?: string;
}

export interface InvestigationSubject {
  version: typeof CLAIM_INVESTIGATION_CONTRACT_VERSION;
  id: string;
  scope: InvestigationScope;
  originalSpan: string;
  normalizedClaim: string;
  source: InvestigationSourceSnapshot;
  attribution?: InvestigationAttribution;
  proposition: InvestigationProposition;
  consequence: InvestigationConsequence;
}

export interface InvestigationQuestion {
  id: string;
  basis: InvestigationQuestionBasis;
  purpose: InvestigationQuestionPurpose;
  question: string;
  queryCandidates: string[];
  preferredSourceRoles: EvidenceSourceRole[];
}

export interface InvestigationPlan {
  version: typeof CLAIM_INVESTIGATION_CONTRACT_VERSION;
  subjectId: string;
  questions: InvestigationQuestion[];
  timeCutoff?: string;
  minimumIndependentSources?: number;
  stoppingConditions: string[];
}

export interface EvidenceArtifact {
  version: typeof CLAIM_INVESTIGATION_CONTRACT_VERSION;
  id: string;
  questionId: string;
  sourceRole: EvidenceSourceRole;
  url?: string;
  publisher?: string;
  publishedAt?: string;
  retrievedAt: string;
  exactExcerpt: string;
  contentFingerprint?: string;
  sharedOriginGroup?: string;
  relation: EvidenceRelation;
}

export interface EvidenceSufficiency {
  version: typeof CLAIM_INVESTIGATION_CONTRACT_VERSION;
  subjectId: string;
  state: EvidenceSufficiencyState;
  answeredQuestionIds: string[];
  unansweredQuestionIds: string[];
  conflictingQuestionIds?: string[];
  outdatedArtifactIds?: string[];
  rationale: string;
  assessedAt: string;
}

export interface InvestigationFinding {
  version: typeof CLAIM_INVESTIGATION_CONTRACT_VERSION;
  subjectId: string;
  state: InvestigationFindingState;
  summary: string;
  evidenceArtifactIds: string[];
  unresolvedQuestionIds: string[];
  generatedAt: string;
}

export interface InvestigationBundle {
  subject: InvestigationSubject;
  plan: InvestigationPlan;
  evidence: EvidenceArtifact[];
  sufficiency?: EvidenceSufficiency;
  finding?: InvestigationFinding;
}

export type InvestigationContractIssueCode =
  | "invalid_type"
  | "invalid_version"
  | "missing_value"
  | "invalid_value"
  | "out_of_bounds"
  | "duplicate_id"
  | "unknown_reference"
  | "inconsistent_state";

export interface InvestigationContractIssue {
  path: string;
  code: InvestigationContractIssueCode;
  message: string;
}

export type InvestigationContractValidation =
  | { ok: true }
  | { ok: false; issues: InvestigationContractIssue[] };

const ID_RE = /^[a-z0-9][a-z0-9._:-]{0,127}$/i;
const FINGERPRINT_RE = /^[a-f0-9]{16,128}$/i;

const CONSEQUENCES = new Set<InvestigationConsequence>([
  "health", "safety", "money", "rights", "law", "public_interest",
]);
const ATTRIBUTION_MODALITIES = new Set<InvestigationAttributionModality>([
  "statement", "report", "estimate", "allegation", "forecast", "analysis",
]);
const QUESTION_BASES = new Set<InvestigationQuestionBasis>(["literal", "contextual"]);
const QUESTION_PURPOSES = new Set<InvestigationQuestionPurpose>([
  "proposition", "identity", "timeline", "quantity", "context", "counterevidence",
]);
const SOURCE_ROLES = new Set<EvidenceSourceRole>([
  "primary", "independent_secondary", "fact_check", "claim_origin", "user_supplied",
]);
const EVIDENCE_RELATIONS = new Set<EvidenceRelation>([
  "supports", "refutes", "context", "irrelevant",
]);
const SUFFICIENCY_STATES = new Set<EvidenceSufficiencyState>([
  "sufficient", "insufficient", "conflicting", "outdated", "not_yet_verifiable",
]);
const FINDING_STATES = new Set<InvestigationFindingState>([
  "supported_by_available_evidence", "contradicted_by_available_evidence", "mixed",
  "insufficient", "conflicting", "outdated", "not_yet_verifiable",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function issue(
  issues: InvestigationContractIssue[],
  path: string,
  code: InvestigationContractIssueCode,
  message: string,
): void {
  issues.push({ path, code, message });
}

function requireString(
  issues: InvestigationContractIssue[],
  value: unknown,
  path: string,
  maxLength: number,
): value is string {
  if (typeof value !== "string") {
    issue(issues, path, "invalid_type", "must be a string");
    return false;
  }
  const length = Array.from(value.trim()).length;
  if (length === 0) {
    issue(issues, path, "missing_value", "must not be empty");
    return false;
  }
  if (length > maxLength) {
    issue(issues, path, "out_of_bounds", `must be at most ${maxLength} characters`);
    return false;
  }
  return true;
}

function optionalString(
  issues: InvestigationContractIssue[],
  value: unknown,
  path: string,
  maxLength: number,
): value is string | undefined {
  return value === undefined || requireString(issues, value, path, maxLength);
}

function requireId(issues: InvestigationContractIssue[], value: unknown, path: string): value is string {
  if (!requireString(issues, value, path, 128)) return false;
  if (!ID_RE.test(value)) {
    issue(issues, path, "invalid_value", "must be a stable opaque identifier");
    return false;
  }
  return true;
}

function requireTimestamp(issues: InvestigationContractIssue[], value: unknown, path: string): value is string {
  if (!requireString(issues, value, path, 40)) return false;
  if (!Number.isFinite(Date.parse(value))) {
    issue(issues, path, "invalid_value", "must be an ISO-compatible timestamp or date");
    return false;
  }
  return true;
}

function optionalHttpUrl(issues: InvestigationContractIssue[], value: unknown, path: string): void {
  if (value === undefined) return;
  if (!requireString(issues, value, path, 2048)) return;
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      issue(issues, path, "invalid_value", "must use http or https");
    }
  } catch {
    issue(issues, path, "invalid_value", "must be an absolute URL");
  }
}

function requireVersion(issues: InvestigationContractIssue[], value: unknown, path: string): void {
  if (value !== CLAIM_INVESTIGATION_CONTRACT_VERSION) {
    issue(issues, path, "invalid_version", `must equal ${CLAIM_INVESTIGATION_CONTRACT_VERSION}`);
  }
}

function validateSubject(value: unknown, issues: InvestigationContractIssue[]): value is InvestigationSubject {
  if (!isRecord(value)) {
    issue(issues, "subject", "invalid_type", "must be an object");
    return false;
  }
  requireVersion(issues, value.version, "subject.version");
  requireId(issues, value.id, "subject.id");
  if (value.scope !== "page" && value.scope !== "focus") {
    issue(issues, "subject.scope", "invalid_value", "must be page or focus");
  }
  requireString(issues, value.originalSpan, "subject.originalSpan", 1200);
  requireString(issues, value.normalizedClaim, "subject.normalizedClaim", 280);
  if (!CONSEQUENCES.has(value.consequence as InvestigationConsequence)) {
    issue(issues, "subject.consequence", "invalid_value", "must be a consequential investigation category");
  }

  if (!isRecord(value.source)) {
    issue(issues, "subject.source", "invalid_type", "must be an object");
  } else {
    optionalString(issues, value.source.title, "subject.source.title", 240);
    optionalString(issues, value.source.publisher, "subject.source.publisher", 120);
    optionalHttpUrl(issues, value.source.url, "subject.source.url");
    if (value.source.publishedAt !== undefined) {
      requireTimestamp(issues, value.source.publishedAt, "subject.source.publishedAt");
    }
    requireTimestamp(issues, value.source.observedAt, "subject.source.observedAt");
    if (!requireString(issues, value.source.contentFingerprint, "subject.source.contentFingerprint", 128) ||
      !FINGERPRINT_RE.test(value.source.contentFingerprint)) {
      issue(issues, "subject.source.contentFingerprint", "invalid_value", "must be a hexadecimal content fingerprint");
    }
  }

  if (value.attribution !== undefined) {
    if (!isRecord(value.attribution)) {
      issue(issues, "subject.attribution", "invalid_type", "must be an object");
    } else {
      requireString(issues, value.attribution.actor, "subject.attribution.actor", 160);
      requireString(issues, value.attribution.relation, "subject.attribution.relation", 80);
      if (!ATTRIBUTION_MODALITIES.has(value.attribution.modality as InvestigationAttributionModality)) {
        issue(issues, "subject.attribution.modality", "invalid_value", "has an unsupported modality");
      }
    }
  }

  if (!isRecord(value.proposition)) {
    issue(issues, "subject.proposition", "invalid_type", "must be one atomic proposition object");
  } else {
    requireString(issues, value.proposition.originalSpan, "subject.proposition.originalSpan", 600);
    requireString(issues, value.proposition.normalizedText, "subject.proposition.normalizedText", 280);
    optionalString(issues, value.proposition.time, "subject.proposition.time", 80);
    optionalString(issues, value.proposition.place, "subject.proposition.place", 100);
    optionalString(issues, value.proposition.quantity, "subject.proposition.quantity", 80);
  }
  return true;
}

function validatePlan(
  value: unknown,
  subject: InvestigationSubject | undefined,
  issues: InvestigationContractIssue[],
): value is InvestigationPlan {
  if (!isRecord(value)) {
    issue(issues, "plan", "invalid_type", "must be an object");
    return false;
  }
  requireVersion(issues, value.version, "plan.version");
  if (requireId(issues, value.subjectId, "plan.subjectId") && subject && value.subjectId !== subject.id) {
    issue(issues, "plan.subjectId", "unknown_reference", "must reference subject.id");
  }
  if (value.timeCutoff !== undefined) requireTimestamp(issues, value.timeCutoff, "plan.timeCutoff");
  if (value.minimumIndependentSources !== undefined &&
    (typeof value.minimumIndependentSources !== "number" ||
      !Number.isInteger(value.minimumIndependentSources) ||
      value.minimumIndependentSources < 0 || value.minimumIndependentSources > 5)) {
    issue(issues, "plan.minimumIndependentSources", "out_of_bounds", "must be an integer from 0 to 5");
  }
  if (!Array.isArray(value.stoppingConditions) || value.stoppingConditions.length < 1 || value.stoppingConditions.length > 8) {
    issue(issues, "plan.stoppingConditions", "out_of_bounds", "must contain 1 to 8 conditions");
  } else {
    value.stoppingConditions.forEach((condition, index) => {
      requireString(issues, condition, `plan.stoppingConditions[${index}]`, 240);
    });
  }
  if (!Array.isArray(value.questions) || value.questions.length < 1 || value.questions.length > 8) {
    issue(issues, "plan.questions", "out_of_bounds", "must contain 1 to 8 questions");
  } else {
    const ids = new Set<string>();
    value.questions.forEach((question, index) => {
      const path = `plan.questions[${index}]`;
      if (!isRecord(question)) {
        issue(issues, path, "invalid_type", "must be an object");
        return;
      }
      if (requireId(issues, question.id, `${path}.id`)) {
        if (ids.has(question.id)) issue(issues, `${path}.id`, "duplicate_id", "must be unique within the plan");
        ids.add(question.id);
      }
      if (question.propositionIndex !== undefined) {
        issue(issues, `${path}.propositionIndex`, "invalid_value", "is not part of the single-proposition v2 contract");
      }
      if (!QUESTION_BASES.has(question.basis as InvestigationQuestionBasis)) {
        issue(issues, `${path}.basis`, "invalid_value", "has an unsupported basis");
      }
      if (!QUESTION_PURPOSES.has(question.purpose as InvestigationQuestionPurpose)) {
        issue(issues, `${path}.purpose`, "invalid_value", "has an unsupported purpose");
      }
      requireString(issues, question.question, `${path}.question`, 320);
      if (!Array.isArray(question.queryCandidates) || question.queryCandidates.length > 3) {
        issue(issues, `${path}.queryCandidates`, "out_of_bounds", "must contain at most 3 candidates");
      } else {
        question.queryCandidates.forEach((candidate, candidateIndex) => {
          requireString(issues, candidate, `${path}.queryCandidates[${candidateIndex}]`, 240);
        });
      }
      if (!Array.isArray(question.preferredSourceRoles) || question.preferredSourceRoles.length < 1) {
        issue(issues, `${path}.preferredSourceRoles`, "missing_value", "must name at least one source role");
      } else {
        question.preferredSourceRoles.forEach((role, roleIndex) => {
          if (!SOURCE_ROLES.has(role as EvidenceSourceRole)) {
            issue(issues, `${path}.preferredSourceRoles[${roleIndex}]`, "invalid_value", "has an unsupported source role");
          }
        });
      }
    });
  }
  return true;
}

function validateEvidence(
  evidence: unknown,
  questionIds: Set<string>,
  issues: InvestigationContractIssue[],
): evidence is EvidenceArtifact[] {
  if (!Array.isArray(evidence)) {
    issue(issues, "evidence", "invalid_type", "must be an array");
    return false;
  }
  if (evidence.length > 80) issue(issues, "evidence", "out_of_bounds", "must contain at most 80 artifacts");
  const ids = new Set<string>();
  evidence.forEach((artifact, index) => {
    const path = `evidence[${index}]`;
    if (!isRecord(artifact)) {
      issue(issues, path, "invalid_type", "must be an object");
      return;
    }
    requireVersion(issues, artifact.version, `${path}.version`);
    if (requireId(issues, artifact.id, `${path}.id`)) {
      if (ids.has(artifact.id)) issue(issues, `${path}.id`, "duplicate_id", "must be unique");
      ids.add(artifact.id);
    }
    if (requireId(issues, artifact.questionId, `${path}.questionId`) && !questionIds.has(artifact.questionId)) {
      issue(issues, `${path}.questionId`, "unknown_reference", "must reference a plan question");
    }
    if (!SOURCE_ROLES.has(artifact.sourceRole as EvidenceSourceRole)) {
      issue(issues, `${path}.sourceRole`, "invalid_value", "has an unsupported source role");
    }
    if (!EVIDENCE_RELATIONS.has(artifact.relation as EvidenceRelation)) {
      issue(issues, `${path}.relation`, "invalid_value", "has an unsupported evidence relation");
    }
    optionalHttpUrl(issues, artifact.url, `${path}.url`);
    optionalString(issues, artifact.publisher, `${path}.publisher`, 120);
    if (artifact.publishedAt !== undefined) requireTimestamp(issues, artifact.publishedAt, `${path}.publishedAt`);
    requireTimestamp(issues, artifact.retrievedAt, `${path}.retrievedAt`);
    requireString(issues, artifact.exactExcerpt, `${path}.exactExcerpt`, 2400);
    optionalString(issues, artifact.contentFingerprint, `${path}.contentFingerprint`, 128);
    optionalString(issues, artifact.sharedOriginGroup, `${path}.sharedOriginGroup`, 128);
  });
  return true;
}

function validateSufficiency(
  value: unknown,
  subjectId: string | undefined,
  questionIds: Set<string>,
  evidenceIds: Set<string>,
  issues: InvestigationContractIssue[],
): value is EvidenceSufficiency {
  if (!isRecord(value)) {
    issue(issues, "sufficiency", "invalid_type", "must be an object");
    return false;
  }
  requireVersion(issues, value.version, "sufficiency.version");
  if (requireId(issues, value.subjectId, "sufficiency.subjectId") && subjectId && value.subjectId !== subjectId) {
    issue(issues, "sufficiency.subjectId", "unknown_reference", "must reference subject.id");
  }
  if (!SUFFICIENCY_STATES.has(value.state as EvidenceSufficiencyState)) {
    issue(issues, "sufficiency.state", "invalid_value", "has an unsupported sufficiency state");
  }
  const answered = validateReferenceArray(value.answeredQuestionIds, "sufficiency.answeredQuestionIds", questionIds, issues);
  const unanswered = validateReferenceArray(value.unansweredQuestionIds, "sufficiency.unansweredQuestionIds", questionIds, issues);
  const conflicting = value.conflictingQuestionIds === undefined
    ? new Set<string>()
    : validateReferenceArray(value.conflictingQuestionIds, "sufficiency.conflictingQuestionIds", questionIds, issues);
  if (value.outdatedArtifactIds !== undefined) {
    validateReferenceArray(value.outdatedArtifactIds, "sufficiency.outdatedArtifactIds", evidenceIds, issues);
  }
  for (const id of answered) {
    if (unanswered.has(id)) issue(issues, "sufficiency", "inconsistent_state", `${id} cannot be answered and unanswered`);
  }
  if (value.state === "sufficient" && (unanswered.size > 0 || conflicting.size > 0)) {
    issue(issues, "sufficiency.state", "inconsistent_state", "sufficient cannot retain unanswered or conflicting questions");
  }
  if (value.state === "conflicting" && conflicting.size === 0) {
    issue(issues, "sufficiency.conflictingQuestionIds", "missing_value", "conflicting requires at least one conflicting question");
  }
  requireString(issues, value.rationale, "sufficiency.rationale", 800);
  requireTimestamp(issues, value.assessedAt, "sufficiency.assessedAt");
  return true;
}

function validateReferenceArray(
  value: unknown,
  path: string,
  knownIds: Set<string>,
  issues: InvestigationContractIssue[],
): Set<string> {
  const result = new Set<string>();
  if (!Array.isArray(value)) {
    issue(issues, path, "invalid_type", "must be an array");
    return result;
  }
  value.forEach((id, index) => {
    if (!requireId(issues, id, `${path}[${index}]`)) return;
    if (result.has(id)) issue(issues, `${path}[${index}]`, "duplicate_id", "must be unique");
    if (!knownIds.has(id)) issue(issues, `${path}[${index}]`, "unknown_reference", "references an unknown id");
    result.add(id);
  });
  return result;
}

function validateFinding(
  value: unknown,
  subjectId: string | undefined,
  sufficiency: EvidenceSufficiency | undefined,
  evidenceIds: Set<string>,
  questionIds: Set<string>,
  issues: InvestigationContractIssue[],
): value is InvestigationFinding {
  if (!isRecord(value)) {
    issue(issues, "finding", "invalid_type", "must be an object");
    return false;
  }
  requireVersion(issues, value.version, "finding.version");
  if (requireId(issues, value.subjectId, "finding.subjectId") && subjectId && value.subjectId !== subjectId) {
    issue(issues, "finding.subjectId", "unknown_reference", "must reference subject.id");
  }
  if (!FINDING_STATES.has(value.state as InvestigationFindingState)) {
    issue(issues, "finding.state", "invalid_value", "has an unsupported finding state");
  }
  requireString(issues, value.summary, "finding.summary", 800);
  validateReferenceArray(value.evidenceArtifactIds, "finding.evidenceArtifactIds", evidenceIds, issues);
  validateReferenceArray(value.unresolvedQuestionIds, "finding.unresolvedQuestionIds", questionIds, issues);
  requireTimestamp(issues, value.generatedAt, "finding.generatedAt");
  if (!sufficiency) {
    issue(issues, "finding", "inconsistent_state", "requires a sufficiency assessment");
  } else {
    const expected: Record<EvidenceSufficiencyState, InvestigationFindingState[]> = {
      sufficient: ["supported_by_available_evidence", "contradicted_by_available_evidence", "mixed"],
      insufficient: ["insufficient"],
      conflicting: ["conflicting", "mixed"],
      outdated: ["outdated"],
      not_yet_verifiable: ["not_yet_verifiable"],
    };
    if (!expected[sufficiency.state].includes(value.state as InvestigationFindingState)) {
      issue(issues, "finding.state", "inconsistent_state", "must agree with evidence sufficiency");
    }
  }
  return true;
}

/** Validate structure and cross-references without making a truth judgment. */
export function validateInvestigationBundle(value: unknown): InvestigationContractValidation {
  const issues: InvestigationContractIssue[] = [];
  if (!isRecord(value)) {
    return { ok: false, issues: [{ path: "bundle", code: "invalid_type", message: "must be an object" }] };
  }
  const subject = validateSubject(value.subject, issues) ? value.subject : undefined;
  const plan = validatePlan(value.plan, subject, issues) ? value.plan : undefined;
  const questionIds = new Set(plan?.questions.map((question) => question.id) ?? []);
  const evidence = validateEvidence(value.evidence, questionIds, issues) ? value.evidence : [];
  const evidenceIds = new Set(evidence.map((artifact) => artifact.id));
  const sufficiency = value.sufficiency === undefined
    ? undefined
    : validateSufficiency(value.sufficiency, subject?.id, questionIds, evidenceIds, issues)
      ? value.sufficiency
      : undefined;
  if (value.finding !== undefined) {
    validateFinding(value.finding, subject?.id, sufficiency, evidenceIds, questionIds, issues);
  }
  return issues.length === 0 ? { ok: true } : { ok: false, issues };
}
