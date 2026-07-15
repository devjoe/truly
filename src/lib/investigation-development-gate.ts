export type InvestigationDevelopmentSurface = "facebook" | "news";
export type InvestigationDevelopmentBlocker =
  | "missing_answering_evidence"
  | "independent_origin_shortfall"
  | "search_not_completed"
  | "temporal_ambiguity"
  | "acquisition_unavailable";

export interface InvestigationDevelopmentCaseReview {
  caseId: string;
  surface: InvestigationDevelopmentSurface;
  safety: { snippetsAsEvidence: false; verdictProduced: false; exactSpanTraceable: boolean; temporalFailClosed: boolean };
  transitions: Array<{
    obligationId: string;
    baselineBlocker: InvestigationDevelopmentBlocker;
    /** Status produced by the equal-budget matched baseline, when one was run. */
    matchedBaselineStatus?: "satisfied" | "pending" | "blocked";
    candidateStatus: "satisfied" | "pending" | "blocked";
    falseClosure: boolean;
    causedByProofRelaxation: boolean;
    rescueKind: "evidence_bearing" | "origin_bearing" | "receipt_only" | "temporal_only";
  }>;
  baselineUnresolvedMandatory: number;
  candidateUnresolvedMandatory: number;
  processCapability: {
    fairBudgetExecuted: boolean;
    accessAccountingComplete: boolean;
    zeroYieldStopHonored: boolean;
    receiptScopeHonest: boolean;
  };
  regressionCount: number;
  blindedPreference: "candidate" | "baseline" | "tie";
  reviewerAgreement: boolean;
}

export interface InvestigationDevelopmentGateResult {
  pass: boolean;
  safetyPass: boolean;
  utilityPass: boolean;
  evidenceUtilityPass: boolean;
  processCapabilityPass: boolean;
  rescuedObligations: number;
  evidenceOrOriginBearingRescues: number;
  rescuedBlockerTypes: InvestigationDevelopmentBlocker[];
  improvedSurfaces: InvestigationDevelopmentSurface[];
  falseClosures: number;
  regressions: number;
  reviewerDisagreements: number;
  candidatePreferredCases: number;
  improvedCases: number;
}

/** Internal development promotion gate; passing never authorizes release or holdout use. */
export function evaluateInvestigationDevelopmentGate(
  reviews: InvestigationDevelopmentCaseReview[],
): InvestigationDevelopmentGateResult {
  if (reviews.length < 2 || new Set(reviews.map((entry) => entry.caseId)).size !== reviews.length) {
    throw new Error("Development gate requires unique reviewed cases");
  }
  const falseClosures = reviews.flatMap((entry) => entry.transitions).filter((entry) => entry.falseClosure).length;
  const regressions = reviews.reduce((sum, entry) => sum + entry.regressionCount, 0);
  const reviewerDisagreements = reviews.filter((entry) => !entry.reviewerAgreement).length;
  const rescued = reviews.flatMap((review) => review.transitions
    .filter((entry) => entry.candidateStatus === "satisfied" && entry.matchedBaselineStatus !== "satisfied" &&
      !entry.falseClosure && !entry.causedByProofRelaxation)
    .map((entry) => ({ surface: review.surface, blocker: entry.baselineBlocker, rescueKind: entry.rescueKind })));
  const safetyPass = reviews.every((entry) => !entry.safety.snippetsAsEvidence && !entry.safety.verdictProduced &&
    entry.safety.exactSpanTraceable && entry.safety.temporalFailClosed) && falseClosures === 0 && regressions === 0;
  const rescuedBlockerTypes = [...new Set(rescued.map((entry) => entry.blocker))];
  const improvedSurfaces = [...new Set(rescued.map((entry) => entry.surface))];
  const candidatePreferredCases = reviews.filter((entry) => entry.blindedPreference === "candidate").length;
  const evidenceOrOriginBearingRescues = rescued.filter((entry) =>
    entry.rescueKind === "evidence_bearing" || entry.rescueKind === "origin_bearing").length;
  const improved = reviews.filter((entry) => entry.candidateUnresolvedMandatory < entry.baselineUnresolvedMandatory);
  const improvedCaseSurfaces = new Set(improved.map((entry) => entry.surface));
  const evidenceUtilityPass = rescued.length >= 3 && evidenceOrOriginBearingRescues >= 2 &&
    rescuedBlockerTypes.length >= 2 && improvedSurfaces.length === 2 && improved.length >= 2 &&
    improvedCaseSurfaces.size === 2 && candidatePreferredCases >= 2 && reviewerDisagreements === 0;
  const processCapabilityPass = reviews.every((entry) => entry.processCapability.fairBudgetExecuted &&
    entry.processCapability.accessAccountingComplete && entry.processCapability.zeroYieldStopHonored &&
    entry.processCapability.receiptScopeHonest);
  return {
    pass: safetyPass && evidenceUtilityPass && processCapabilityPass,
    safetyPass,
    utilityPass: evidenceUtilityPass,
    evidenceUtilityPass,
    processCapabilityPass,
    rescuedObligations: rescued.length,
    evidenceOrOriginBearingRescues,
    rescuedBlockerTypes,
    improvedSurfaces,
    falseClosures,
    regressions,
    reviewerDisagreements,
    candidatePreferredCases,
    improvedCases: improved.length,
  };
}
