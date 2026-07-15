import type {
  InvestigationDevelopmentBlocker,
  InvestigationDevelopmentSurface,
} from "./investigation-development-gate";

export type InvestigationPairedRoute = "atomic_query" | "source_first";

export interface InvestigationPairedCandidate {
  candidateId: string;
  questionId: string;
}

export interface InvestigationPairedCandidateReview {
  candidateId: string;
  questionId: string;
  reviewerId: string;
  admittedForQuestion: boolean;
}

export interface InvestigationPairedObligationReview {
  trialId: string;
  reviewerId: string;
  rescued: boolean;
}

export interface InvestigationPairedTrial {
  trialId: string;
  sampleId: string;
  surface: InvestigationDevelopmentSurface;
  obligationId: string;
  questionId: string;
  baselineBlocker: InvestigationDevelopmentBlocker;
  rescueUnit?: "single_artifact" | "evidence_set";
  routeCandidateIds: Record<InvestigationPairedRoute, string[]>;
}

export interface InvestigationPairedTrialResult {
  trialId: string;
  sampleId: string;
  surface: InvestigationDevelopmentSurface;
  obligationId: string;
  baselineBlocker: InvestigationDevelopmentBlocker;
  candidateReviewDisagreement: boolean;
  candidateReviewCoverageComplete: boolean;
  obligationReviewCoverageComplete: boolean;
  obligationReviewDisagreement: boolean;
  passageAdmission: Record<InvestigationPairedRoute, boolean>;
  obligationRescue: Record<InvestigationPairedRoute, boolean>;
  comparison: "source_first_only" | "atomic_only" | "both" | "neither";
}

export interface InvestigationPairedAuditResult {
  trials: InvestigationPairedTrialResult[];
  sourceFirstOnly: number;
  atomicOnly: number;
  both: number;
  neither: number;
  candidateReviewDisagreements: number;
  obligationReviewDisagreements: number;
  incompleteReviewTrials: number;
}

function unique(values: string[], label: string): string[] {
  const result = [...new Set(values)];
  if (result.length !== values.length) throw new Error(`${label} must be unique`);
  return result;
}

/**
 * Compiles a paired retrieval experiment without turning passage-level review
 * into obligation-level proof. An origin shortfall or a multi-passage answer is
 * rescued only after the whole trial obligation receives its own blind review.
 */
export function compileInvestigationPairedAudit(input: {
  trials: InvestigationPairedTrial[];
  candidates: InvestigationPairedCandidate[];
  candidateReviews: InvestigationPairedCandidateReview[];
  obligationReviews?: InvestigationPairedObligationReview[];
  expectedReviewerIds: string[];
}): InvestigationPairedAuditResult {
  const reviewerIds = unique(input.expectedReviewerIds, "Expected reviewer IDs");
  if (reviewerIds.length < 2) throw new Error("Paired audit requires at least two independent reviewers");
  unique(input.trials.map((trial) => trial.trialId), "Trial IDs");
  unique(input.candidates.map((candidate) => candidate.candidateId), "Candidate IDs");
  const candidateById = new Map(input.candidates.map((candidate) => [candidate.candidateId, candidate]));
  const reviewByCandidate = new Map<string, InvestigationPairedCandidateReview[]>();
  input.candidateReviews.forEach((review) => {
    const candidate = candidateById.get(review.candidateId);
    if (!candidate || candidate.questionId !== review.questionId) {
      throw new Error(`Candidate review is not scoped to its candidate question: ${review.candidateId}`);
    }
    if (!reviewerIds.includes(review.reviewerId)) throw new Error(`Unexpected reviewer ${review.reviewerId}`);
    const reviews = reviewByCandidate.get(review.candidateId) ?? [];
    if (reviews.some((entry) => entry.reviewerId === review.reviewerId)) {
      throw new Error(`Duplicate candidate review from ${review.reviewerId}: ${review.candidateId}`);
    }
    reviews.push(review);
    reviewByCandidate.set(review.candidateId, reviews);
  });
  const obligationReviewByTrial = new Map<string, InvestigationPairedObligationReview[]>();
  (input.obligationReviews ?? []).forEach((review) => {
    if (!input.trials.some((trial) => trial.trialId === review.trialId)) {
      throw new Error(`Unknown obligation review trial ${review.trialId}`);
    }
    if (!reviewerIds.includes(review.reviewerId)) throw new Error(`Unexpected reviewer ${review.reviewerId}`);
    const reviews = obligationReviewByTrial.get(review.trialId) ?? [];
    if (reviews.some((entry) => entry.reviewerId === review.reviewerId)) {
      throw new Error(`Duplicate obligation review from ${review.reviewerId}: ${review.trialId}`);
    }
    reviews.push(review);
    obligationReviewByTrial.set(review.trialId, reviews);
  });

  const trials = input.trials.map((trial): InvestigationPairedTrialResult => {
    const routeCandidates = Object.fromEntries((["atomic_query", "source_first"] as const).map((route) => {
      const ids = unique(trial.routeCandidateIds[route], `${trial.trialId} ${route} candidate IDs`);
      const candidates = ids.map((id) => {
        const candidate = candidateById.get(id);
        if (!candidate) throw new Error(`${trial.trialId} references unknown candidate ${id}`);
        return candidate;
      });
      return [route, candidates];
    })) as Record<InvestigationPairedRoute, InvestigationPairedCandidate[]>;
    const scopedCandidates = [...new Map(Object.values(routeCandidates).flat().map((candidate) => [candidate.candidateId, candidate])).values()];
    const scopedReviewCoverage = scopedCandidates.every((candidate) =>
      candidate.questionId === trial.questionId &&
      (reviewByCandidate.get(candidate.candidateId) ?? []).length === reviewerIds.length);
    const candidateReviewDisagreement = scopedCandidates.some((candidate) => {
      const reviews = reviewByCandidate.get(candidate.candidateId) ?? [];
      return reviews.length === reviewerIds.length && new Set(reviews.map((entry) => entry.admittedForQuestion)).size > 1;
    });
    const admittedCandidates = new Set(scopedCandidates.filter((candidate) => {
      const reviews = reviewByCandidate.get(candidate.candidateId) ?? [];
      return candidate.questionId === trial.questionId && reviews.length === reviewerIds.length &&
        reviews.every((entry) => entry.admittedForQuestion);
    }).map((candidate) => candidate.candidateId));
    const passageAdmission = Object.fromEntries((["atomic_query", "source_first"] as const).map((route) => [
      route,
      routeCandidates[route].some((candidate) => admittedCandidates.has(candidate.candidateId)),
    ])) as Record<InvestigationPairedRoute, boolean>;
    const obligationReviews = obligationReviewByTrial.get(trial.trialId) ?? [];
    const obligationReviewCoverageComplete = obligationReviews.length === reviewerIds.length;
    const obligationReviewDisagreement = obligationReviewCoverageComplete &&
      new Set(obligationReviews.map((entry) => entry.rescued)).size > 1;
    const obligationConsensus = obligationReviewCoverageComplete && !obligationReviewDisagreement &&
      obligationReviews.every((entry) => entry.rescued);
    const requiresObligationReview = trial.obligationId.endsWith(":origins") ||
      trial.rescueUnit === "evidence_set";
    const obligationRescue = Object.fromEntries((["atomic_query", "source_first"] as const).map((route) => [
      route,
      scopedReviewCoverage && !candidateReviewDisagreement && passageAdmission[route] &&
        (!requiresObligationReview || obligationConsensus),
    ])) as Record<InvestigationPairedRoute, boolean>;
    const comparison = obligationRescue.source_first && !obligationRescue.atomic_query
      ? "source_first_only"
      : obligationRescue.atomic_query && !obligationRescue.source_first
        ? "atomic_only"
        : obligationRescue.atomic_query && obligationRescue.source_first
          ? "both"
          : "neither";
    return {
      trialId: trial.trialId,
      sampleId: trial.sampleId,
      surface: trial.surface,
      obligationId: trial.obligationId,
      baselineBlocker: trial.baselineBlocker,
      candidateReviewDisagreement,
      candidateReviewCoverageComplete: scopedReviewCoverage,
      obligationReviewCoverageComplete,
      obligationReviewDisagreement,
      passageAdmission,
      obligationRescue,
      comparison,
    };
  });
  return {
    trials,
    sourceFirstOnly: trials.filter((trial) => trial.comparison === "source_first_only").length,
    atomicOnly: trials.filter((trial) => trial.comparison === "atomic_only").length,
    both: trials.filter((trial) => trial.comparison === "both").length,
    neither: trials.filter((trial) => trial.comparison === "neither").length,
    candidateReviewDisagreements: trials.filter((trial) => trial.candidateReviewDisagreement).length,
    obligationReviewDisagreements: trials.filter((trial) => trial.obligationReviewDisagreement).length,
    incompleteReviewTrials: trials.filter((trial) => !trial.candidateReviewCoverageComplete ||
      ((trial.obligationId.endsWith(":origins") ||
        input.trials.find((entry) => entry.trialId === trial.trialId)!.rescueUnit === "evidence_set") &&
        !trial.obligationReviewCoverageComplete)).length,
  };
}
