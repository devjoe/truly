/**
 * Typed proof obligations for Claim Investigation progress.
 *
 * Evidence admission remains owned by claim-investigation-evidence. This layer
 * only states which independently auditable proof types are still required;
 * in particular, bounded search completion never proves absence or a verdict.
 */

import type { EvidenceArtifact, EvidenceSourceRole, InvestigationBundle } from "./claim-investigation-contract";
import type { InvestigationCase, InvestigationVerificationFacet } from "./claim-investigation-case";
import type { EvidenceSufficiencyEvaluation } from "./claim-investigation-evidence";

export const INVESTIGATION_OBLIGATION_VERSION = 2 as const;

interface ObligationBase {
  version: typeof INVESTIGATION_OBLIGATION_VERSION;
  id: string;
  questionId: string;
  mandatory: boolean;
}

export interface AnsweringEvidenceObligation extends ObligationBase {
  type: "answering_evidence";
  requiredFacets: InvestigationVerificationFacet[];
  acceptedSourceRoles?: EvidenceSourceRole[];
  recordScope?: "record_content" | "record_existence";
}

export interface IndependentOriginsObligation extends ObligationBase {
  type: "independent_origins";
  minimumIndependentOrigins: number;
  requiredFacets: InvestigationVerificationFacet[];
}

export interface CounterevidenceSearchObligation extends ObligationBase {
  type: "counterevidence_search";
  discoveryTargetIds: string[];
}

export type InvestigationProofObligation =
  | AnsweringEvidenceObligation
  | IndependentOriginsObligation
  | CounterevidenceSearchObligation;

export interface InvestigationObligationSet {
  version: typeof INVESTIGATION_OBLIGATION_VERSION;
  caseId: string;
  obligations: InvestigationProofObligation[];
}

export interface InvestigationQuestionProofResponsibility {
  questionId: string;
  standard: "independent_corroboration" | "canonical_record";
  requiredFacets: InvestigationVerificationFacet[];
  minimumIndependentOrigins?: number;
  recordScope?: "record_content" | "record_existence";
  entitledSourceRoles?: EvidenceSourceRole[];
}

/**
 * Conservative contract default used before human review. Canonical status is
 * granted only when the question explicitly asks for an identity, timeline or
 * quantity and a primary target explicitly requests an official record or
 * ruling. A press release or product page remains a first-party answer that
 * still needs independent corroboration.
 */
export function buildConservativeProofResponsibilities(
  bundle: InvestigationBundle,
  investigationCase: InvestigationCase,
): InvestigationQuestionProofResponsibility[] {
  const requirements = new Map(investigationCase.requirements.map((entry) => [entry.questionId, entry]));
  return bundle.plan.questions.filter((question) => investigationCase.questionIds.includes(question.id)).map((question) => {
    const requiredFacets = requirements.get(question.id)?.requiredFacets ?? [];
    const primaryTargets = investigationCase.discoveryPlan.targets.filter((target) => !target.fallback && target.questionIds.includes(question.id));
    const canonicalPurpose = question.purpose === "identity" || question.purpose === "timeline" || question.purpose === "quantity";
    const canonicalDocument = primaryTargets.some((target) => target.acceptedSourceRoles.every((role) => role === "primary") &&
      target.documentKinds.some((kind) => kind === "official_record" || kind === "ruling"));
    if (canonicalPurpose && canonicalDocument) {
      return {
        questionId: question.id,
        standard: "canonical_record" as const,
        requiredFacets,
        recordScope: "record_content" as const,
        entitledSourceRoles: ["primary" as const],
      };
    }
    return {
      questionId: question.id,
      standard: "independent_corroboration" as const,
      requiredFacets,
      minimumIndependentOrigins: Math.max(2, bundle.plan.minimumIndependentSources ?? 2),
    };
  });
}

export type SearchCoverageStopReason =
  | "document_families_exhausted"
  | "budget_exhausted"
  | "time_cutoff_reached"
  | "capability_unavailable"
  | "access_denied";

export interface SearchCoverageReceipt {
  version: typeof INVESTIGATION_OBLIGATION_VERSION;
  obligationId: string;
  discoveryTargetIds: string[];
  coverageState: "bounded_complete" | "partial";
  hypotheses: Array<{
    id: string;
    kind: "supporting" | "counter" | "alternative";
    statement: string;
  }>;
  sourceFamilies: Array<{
    id: string;
    family: "canonical_authority" | "official_record" | "first_party_statement" |
      "independent_reporting" | "domain_expert" | "historical_archive" | "counterparty_record";
    status: "covered" | "blocked" | "unresolved";
  }>;
  languages: string[];
  timeScope: { from?: string; to: string };
  aliases: string[];
  actions: Array<{
    query: string;
    hypothesisIds: string[];
    sourceFamilyIds: string[];
    language: string;
    candidatesConsidered: number;
    documentsAttempted: number;
  }>;
  unresolvedBlindSpots: string[];
  queriesAttempted: number;
  candidateDocumentsConsidered: number;
  documentsAttempted: number;
  stopReason: SearchCoverageStopReason;
  completedAt: string;
}

export interface QuestionAcquisitionTrace {
  questionId: string;
  attempts: number;
  documentsFetched: number;
  allKnownCandidatesUnavailable: boolean;
}

export type InvestigationObligationBlocker =
  | "missing_answering_evidence"
  | "independent_origin_shortfall"
  | "search_not_completed"
  | "acquisition_unavailable";

export interface InvestigationObligationProgress {
  obligationId: string;
  status: "satisfied" | "pending" | "blocked";
  proofArtifactIds: string[];
  independentOriginCount: number;
  blocker?: InvestigationObligationBlocker;
}

export interface InvestigationProgressAssessment {
  version: typeof INVESTIGATION_OBLIGATION_VERSION;
  caseId: string;
  state: "not_started" | "collecting" | "blocked" | "ready_for_review";
  mandatorySatisfied: number;
  mandatoryTotal: number;
  supportingSatisfied: number;
  supportingTotal: number;
  obligations: InvestigationObligationProgress[];
  assessedAt: string;
  verdictProduced: false;
}

const SEARCH_STOP_REASONS = new Set<SearchCoverageStopReason>([
  "document_families_exhausted",
  "budget_exhausted",
  "time_cutoff_reached",
  "capability_unavailable",
  "access_denied",
]);
const SEARCH_HYPOTHESIS_KINDS = new Set(["supporting", "counter", "alternative"]);
const SEARCH_SOURCE_FAMILIES = new Set([
  "canonical_authority", "official_record", "first_party_statement", "independent_reporting",
  "domain_expert", "historical_archive", "counterparty_record",
]);
const SEARCH_SOURCE_FAMILY_STATES = new Set(["covered", "blocked", "unresolved"]);

function originKey(artifact: EvidenceArtifact): string {
  if (artifact.sharedOriginGroup) return `shared:${artifact.sharedOriginGroup}`;
  if (artifact.publisher) return `publisher:${artifact.publisher.trim().toLocaleLowerCase()}`;
  if (artifact.url) {
    try {
      return `host:${new URL(artifact.url).hostname.toLocaleLowerCase().replace(/^www\./u, "")}`;
    } catch {
      // Bundle validation happens before obligation evaluation.
    }
  }
  if (artifact.contentFingerprint) return `unattributed-fingerprint:${artifact.contentFingerprint}`;
  return `artifact:${artifact.id}`;
}

export function buildDefaultInvestigationObligations(
  bundle: InvestigationBundle,
  investigationCase: InvestigationCase,
  proofResponsibilities: InvestigationQuestionProofResponsibility[] = [],
): InvestigationObligationSet {
  const targetIdsByQuestion = new Map<string, string[]>();
  investigationCase.discoveryPlan.targets.forEach((target) => {
    target.questionIds.forEach((questionId) => {
      const ids = targetIdsByQuestion.get(questionId) ?? [];
      ids.push(target.id);
      targetIdsByQuestion.set(questionId, ids);
    });
  });
  const obligations: InvestigationProofObligation[] = [];
  const caseQuestionIds = new Set(investigationCase.questionIds);
  const requirements = new Map(investigationCase.requirements.map((entry) => [entry.questionId, entry]));
  if (new Set(proofResponsibilities.map((entry) => entry.questionId)).size !== proofResponsibilities.length ||
    proofResponsibilities.some((entry) => !caseQuestionIds.has(entry.questionId))) {
    throw new Error("Proof responsibilities must be unique and belong to the investigation case");
  }
  const responsibilityByQuestion = new Map(proofResponsibilities.map((entry) => [entry.questionId, entry]));
  bundle.plan.questions.filter((question) => caseQuestionIds.has(question.id)).forEach((question) => {
    const mandatory = question.basis === "literal" || question.purpose === "counterevidence";
    const requirementFacets = requirements.get(question.id)?.requiredFacets ?? [];
    const responsibility = responsibilityByQuestion.get(question.id);
    if (responsibility) {
      const expected = [...new Set(requirementFacets)].sort();
      const actual = [...new Set(responsibility.requiredFacets)].sort();
      if (expected.length !== actual.length || expected.some((facet, index) => facet !== actual[index]) ||
        (responsibility.standard === "canonical_record" &&
          (!responsibility.recordScope || !responsibility.entitledSourceRoles?.length ||
            responsibility.entitledSourceRoles.some((role) => role !== "primary"))) ||
        (responsibility.standard === "independent_corroboration" && responsibility.recordScope !== undefined)) {
        throw new Error(`Invalid proof responsibility for ${question.id}`);
      }
    }
    if (question.purpose === "counterevidence") {
      obligations.push({
        version: INVESTIGATION_OBLIGATION_VERSION,
        id: `obligation:${question.id}:search`,
        type: "counterevidence_search",
        questionId: question.id,
        mandatory,
        discoveryTargetIds: [...new Set(targetIdsByQuestion.get(question.id) ?? [])],
      });
      return;
    }
    obligations.push({
      version: INVESTIGATION_OBLIGATION_VERSION,
      id: `obligation:${question.id}:answer`,
      type: "answering_evidence",
      questionId: question.id,
      mandatory,
      requiredFacets: requirementFacets,
      acceptedSourceRoles: responsibility?.standard === "canonical_record"
        ? responsibility.entitledSourceRoles
        : undefined,
      recordScope: responsibility?.standard === "canonical_record" ? responsibility.recordScope : undefined,
    });
    const minimumIndependentOrigins = responsibility?.standard === "independent_corroboration"
      ? responsibility.minimumIndependentOrigins ?? bundle.plan.minimumIndependentSources ?? 0
      : responsibility?.standard === "canonical_record" ? 0 : bundle.plan.minimumIndependentSources ?? 0;
    if (question.basis === "literal" && minimumIndependentOrigins > 1) {
      obligations.push({
        version: INVESTIGATION_OBLIGATION_VERSION,
        id: `obligation:${question.id}:origins`,
        type: "independent_origins",
        questionId: question.id,
        mandatory: true,
        minimumIndependentOrigins,
        requiredFacets: requirementFacets,
      });
    }
  });
  return { version: INVESTIGATION_OBLIGATION_VERSION, caseId: investigationCase.id, obligations };
}

export function evaluateInvestigationProgress(input: {
  bundle: InvestigationBundle;
  investigationCase: InvestigationCase;
  evidenceEvaluation: EvidenceSufficiencyEvaluation;
  obligationSet: InvestigationObligationSet;
  searchReceipts: SearchCoverageReceipt[];
  acquisitionTraces: QuestionAcquisitionTrace[];
  assessedAt: string;
}): InvestigationProgressAssessment {
  if (!input.evidenceEvaluation.validation.ok || !input.evidenceEvaluation.sufficiency) {
    throw new Error("A valid evidence sufficiency evaluation is required");
  }
  if (input.obligationSet.caseId !== input.investigationCase.id || Number.isNaN(Date.parse(input.assessedAt))) {
    throw new Error("Invalid obligation evaluation input");
  }
  if (new Set(input.searchReceipts.map((receipt) => receipt.obligationId)).size !== input.searchReceipts.length) {
    throw new Error("Search coverage receipts must be unique per obligation");
  }
  const searchObligations = new Map(input.obligationSet.obligations
    .filter((obligation): obligation is CounterevidenceSearchObligation => obligation.type === "counterevidence_search")
    .map((obligation) => [obligation.id, obligation]));
  input.searchReceipts.forEach((receipt) => {
    const obligation = searchObligations.get(receipt.obligationId);
    const expectedTargets = obligation ? [...new Set(obligation.discoveryTargetIds)].sort() : [];
    const actualTargets = [...new Set(receipt.discoveryTargetIds)].sort();
    const hypothesisIds = new Set(receipt.hypotheses?.map((entry) => entry.id) ?? []);
    const sourceFamilyIds = new Set(receipt.sourceFamilies?.map((entry) => entry.id) ?? []);
    const actionLanguages = new Set(receipt.actions?.map((entry) => entry.language) ?? []);
    const actionHypothesisIds = new Set(receipt.actions?.flatMap((entry) => entry.hypothesisIds) ?? []);
    const actionFamilyIds = new Set(receipt.actions?.flatMap((entry) => entry.sourceFamilyIds) ?? []);
    const invalidCoverage = receipt.coverageState !== "bounded_complete" && receipt.coverageState !== "partial" ||
      !Array.isArray(receipt.hypotheses) || receipt.hypotheses.length < 2 || receipt.hypotheses.length > 8 ||
      hypothesisIds.size !== receipt.hypotheses.length || !receipt.hypotheses.some((entry) => entry.kind === "counter") ||
      receipt.hypotheses.some((entry) => !/^[a-z0-9][a-z0-9._:-]{0,127}$/iu.test(entry.id) ||
        !SEARCH_HYPOTHESIS_KINDS.has(entry.kind) || !entry.statement.trim() || entry.statement.length > 320) ||
      !Array.isArray(receipt.sourceFamilies) || receipt.sourceFamilies.length < 1 || receipt.sourceFamilies.length > 8 ||
      sourceFamilyIds.size !== receipt.sourceFamilies.length || receipt.sourceFamilies.some((entry) =>
        !/^[a-z0-9][a-z0-9._:-]{0,127}$/iu.test(entry.id) || !SEARCH_SOURCE_FAMILIES.has(entry.family) ||
        !SEARCH_SOURCE_FAMILY_STATES.has(entry.status)) ||
      !Array.isArray(receipt.languages) || receipt.languages.length < 1 || new Set(receipt.languages).size !== receipt.languages.length ||
      receipt.languages.some((language) => !/^[a-z]{2,3}(?:-[A-Z][a-z]{3})?(?:-[A-Z]{2})?$/u.test(language)) ||
      !receipt.timeScope || Number.isNaN(Date.parse(receipt.timeScope.to)) ||
      (receipt.timeScope.from !== undefined && (Number.isNaN(Date.parse(receipt.timeScope.from)) || Date.parse(receipt.timeScope.from) > Date.parse(receipt.timeScope.to))) ||
      !Array.isArray(receipt.aliases) || receipt.aliases.length > 24 || receipt.aliases.some((alias) => !alias.trim() || alias.length > 160) ||
      !Array.isArray(receipt.actions) || receipt.actions.length < 1 || receipt.actions.length > 32 ||
      receipt.actions.some((action) => !action.query.trim() || action.query.length > 320 || action.hypothesisIds.length < 1 ||
        action.sourceFamilyIds.length < 1 || action.hypothesisIds.some((id) => !hypothesisIds.has(id)) ||
        action.sourceFamilyIds.some((id) => !sourceFamilyIds.has(id)) || !receipt.languages.includes(action.language) ||
        !Number.isInteger(action.candidatesConsidered) || action.candidatesConsidered < 0 ||
        !Number.isInteger(action.documentsAttempted) || action.documentsAttempted < 0 || action.documentsAttempted > action.candidatesConsidered) ||
      [...hypothesisIds].some((id) => !actionHypothesisIds.has(id)) ||
      receipt.sourceFamilies.some((entry) => entry.status === "covered" && !actionFamilyIds.has(entry.id)) ||
      !Array.isArray(receipt.unresolvedBlindSpots) || receipt.unresolvedBlindSpots.length > 16 ||
      receipt.unresolvedBlindSpots.some((entry) => !entry.trim() || entry.length > 240) ||
      [...actionLanguages].some((language) => !receipt.languages.includes(language)) ||
      receipt.queriesAttempted !== receipt.actions.length ||
      receipt.candidateDocumentsConsidered !== receipt.actions.reduce((sum, action) => sum + action.candidatesConsidered, 0) ||
      receipt.documentsAttempted !== receipt.actions.reduce((sum, action) => sum + action.documentsAttempted, 0) ||
      (receipt.coverageState === "bounded_complete" && receipt.sourceFamilies.some((entry) => entry.status === "unresolved"));
    if (receipt.version !== INVESTIGATION_OBLIGATION_VERSION || !obligation || invalidCoverage ||
      expectedTargets.length !== actualTargets.length || expectedTargets.some((targetId, index) => targetId !== actualTargets[index]) ||
      !Number.isInteger(receipt.queriesAttempted) || receipt.queriesAttempted < 1 ||
      !Number.isInteger(receipt.candidateDocumentsConsidered) || receipt.candidateDocumentsConsidered < 0 ||
      !Number.isInteger(receipt.documentsAttempted) || receipt.documentsAttempted < 0 ||
      receipt.documentsAttempted > receipt.candidateDocumentsConsidered ||
      !SEARCH_STOP_REASONS.has(receipt.stopReason) || Number.isNaN(Date.parse(receipt.completedAt))) {
      throw new Error(`Invalid search coverage receipt for ${receipt.obligationId}`);
    }
  });
  const artifacts = new Map(input.bundle.evidence.map((artifact) => [artifact.id, artifact]));
  const qualifying = new Set(input.evidenceEvaluation.qualifyingArtifactIds);
  const receipts = new Map(input.searchReceipts.map((receipt) => [receipt.obligationId, receipt]));
  if (new Set(input.acquisitionTraces.map((trace) => trace.questionId)).size !== input.acquisitionTraces.length ||
    input.acquisitionTraces.some((trace) => !input.investigationCase.questionIds.includes(trace.questionId) ||
      !Number.isInteger(trace.attempts) || trace.attempts < 0 ||
      !Number.isInteger(trace.documentsFetched) || trace.documentsFetched < 0 || trace.documentsFetched > trace.attempts ||
      (trace.allKnownCandidatesUnavailable && (trace.attempts < 1 || trace.documentsFetched > 0)))) {
    throw new Error("Invalid question acquisition trace");
  }
  const acquisitionByQuestion = new Map(input.acquisitionTraces.map((trace) => [trace.questionId, trace]));
  const progress = input.obligationSet.obligations.map((obligation): InvestigationObligationProgress => {
    const proofArtifacts = [...qualifying].filter((artifactId) => {
      const artifact = artifacts.get(artifactId);
      return artifact?.questionId === obligation.questionId &&
        (obligation.type !== "answering_evidence" || !obligation.acceptedSourceRoles || obligation.acceptedSourceRoles.includes(artifact.sourceRole));
    });
    const independentOrigins = new Set(proofArtifacts.map((artifactId) => originKey(artifacts.get(artifactId)!)));
    if (obligation.type === "answering_evidence") {
      return proofArtifacts.length > 0
        ? { obligationId: obligation.id, status: "satisfied", proofArtifactIds: proofArtifacts, independentOriginCount: independentOrigins.size }
        : acquisitionByQuestion.get(obligation.questionId)?.allKnownCandidatesUnavailable
          ? { obligationId: obligation.id, status: "blocked", proofArtifactIds: [], independentOriginCount: 0, blocker: "acquisition_unavailable" }
        : { obligationId: obligation.id, status: "pending", proofArtifactIds: [], independentOriginCount: 0, blocker: "missing_answering_evidence" };
    }
    if (obligation.type === "independent_origins") {
      return independentOrigins.size >= obligation.minimumIndependentOrigins
        ? { obligationId: obligation.id, status: "satisfied", proofArtifactIds: proofArtifacts, independentOriginCount: independentOrigins.size }
        : { obligationId: obligation.id, status: "pending", proofArtifactIds: proofArtifacts, independentOriginCount: independentOrigins.size, blocker: "independent_origin_shortfall" };
    }
    const receipt = receipts.get(obligation.id);
    if (!receipt) {
      return { obligationId: obligation.id, status: "pending", proofArtifactIds: [], independentOriginCount: 0, blocker: "search_not_completed" };
    }
    if (receipt.stopReason === "capability_unavailable" || receipt.stopReason === "access_denied") {
      return { obligationId: obligation.id, status: "blocked", proofArtifactIds: [], independentOriginCount: 0, blocker: "acquisition_unavailable" };
    }
    if (receipt.coverageState !== "bounded_complete") {
      return { obligationId: obligation.id, status: "pending", proofArtifactIds: [], independentOriginCount: 0, blocker: "search_not_completed" };
    }
    return { obligationId: obligation.id, status: "satisfied", proofArtifactIds: [], independentOriginCount: 0 };
  });
  const obligationById = new Map(input.obligationSet.obligations.map((obligation) => [obligation.id, obligation]));
  const mandatory = progress.filter((entry) => obligationById.get(entry.obligationId)?.mandatory);
  const supporting = progress.filter((entry) => !obligationById.get(entry.obligationId)?.mandatory);
  const mandatorySatisfied = mandatory.filter((entry) => entry.status === "satisfied").length;
  const supportingSatisfied = supporting.filter((entry) => entry.status === "satisfied").length;
  const hasAnyWork = input.bundle.evidence.length > 0 || input.searchReceipts.length > 0 ||
    input.acquisitionTraces.some((trace) => trace.attempts > 0);
  const state = mandatory.length > 0 && mandatorySatisfied === mandatory.length
    ? "ready_for_review"
    : mandatory.some((entry) => entry.status === "blocked")
      ? "blocked"
      : hasAnyWork ? "collecting" : "not_started";
  return {
    version: INVESTIGATION_OBLIGATION_VERSION,
    caseId: input.investigationCase.id,
    state,
    mandatorySatisfied,
    mandatoryTotal: mandatory.length,
    supportingSatisfied,
    supportingTotal: supporting.length,
    obligations: progress,
    assessedAt: input.assessedAt,
    verdictProduced: false,
  };
}
