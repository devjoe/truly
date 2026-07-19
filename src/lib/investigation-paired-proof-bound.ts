export interface InvestigationPairedPassageTrial {
  trialId: string;
  obligationType: "answering_evidence" | "independent_origins";
  /**
   * Passage-count ceiling required before this arm could possibly satisfy the
   * obligation. Independent-origin trials use their frozen origin minimum;
   * answering-evidence trials use one.
   */
  minimumPassageCandidates: number;
  baselinePassageCandidates: number;
  candidatePassageCandidates: number;
}

export interface InvestigationPairedProofUpperBound {
  trials: number;
  candidateOnlyCeiling: number;
  baselineOnlyCeiling: number;
  sharedCeiling: number;
  neither: number;
  answeringCandidateOnlyCeiling: number;
  originCandidateOnlyCeiling: number;
  requiredCandidateOnlyRescues: number;
  canReachCandidateOnlyGate: boolean;
  proofReviewRequired: boolean;
  reason?: "candidate_only_ceiling_below_gate";
}

/**
 * Passage candidates are only an admission ceiling: proof review may remove
 * them, but cannot create a route-only rescue where no exact passage exists.
 */
export function evaluateInvestigationPairedProofUpperBound(
  trials: InvestigationPairedPassageTrial[],
  requiredCandidateOnlyRescues: number,
): InvestigationPairedProofUpperBound {
  if (trials.length < 1 || new Set(trials.map((trial) => trial.trialId)).size !== trials.length ||
    !Number.isInteger(requiredCandidateOnlyRescues) || requiredCandidateOnlyRescues < 1 ||
    trials.some((trial) => !Number.isInteger(trial.minimumPassageCandidates) || trial.minimumPassageCandidates < 1 ||
      !Number.isInteger(trial.baselinePassageCandidates) || trial.baselinePassageCandidates < 0 ||
      !Number.isInteger(trial.candidatePassageCandidates) || trial.candidatePassageCandidates < 0)) {
    throw new Error("Invalid paired proof-bound input");
  }
  const couldSatisfy = (count: number, trial: InvestigationPairedPassageTrial) => count >= trial.minimumPassageCandidates;
  const candidateOnly = trials.filter((trial) => couldSatisfy(trial.candidatePassageCandidates, trial) && !couldSatisfy(trial.baselinePassageCandidates, trial));
  const baselineOnly = trials.filter((trial) => couldSatisfy(trial.baselinePassageCandidates, trial) && !couldSatisfy(trial.candidatePassageCandidates, trial));
  const shared = trials.filter((trial) => couldSatisfy(trial.baselinePassageCandidates, trial) && couldSatisfy(trial.candidatePassageCandidates, trial));
  const neither = trials.filter((trial) => !couldSatisfy(trial.baselinePassageCandidates, trial) && !couldSatisfy(trial.candidatePassageCandidates, trial));
  const canReachCandidateOnlyGate = candidateOnly.length >= requiredCandidateOnlyRescues;
  return {
    trials: trials.length,
    candidateOnlyCeiling: candidateOnly.length,
    baselineOnlyCeiling: baselineOnly.length,
    sharedCeiling: shared.length,
    neither: neither.length,
    answeringCandidateOnlyCeiling: candidateOnly.filter((trial) => trial.obligationType === "answering_evidence").length,
    originCandidateOnlyCeiling: candidateOnly.filter((trial) => trial.obligationType === "independent_origins").length,
    requiredCandidateOnlyRescues,
    canReachCandidateOnlyGate,
    proofReviewRequired: canReachCandidateOnlyGate,
    ...(!canReachCandidateOnlyGate ? { reason: "candidate_only_ceiling_below_gate" as const } : {}),
  };
}
