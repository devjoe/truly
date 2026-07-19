import type { InvestigationDevelopmentBlocker } from "./investigation-development-gate";

export type InvestigationProductOutcome =
  | "evidence_supports"
  | "evidence_contradicts"
  | "evidence_conflicts"
  | "not_enough_evidence_in_checked_scope"
  | "investigation_incomplete";

export type InvestigationNextAction =
  | "review_evidence"
  | "review_checked_scope"
  | "locate_answering_source"
  | "find_independent_origin"
  | "continue_source_family_search"
  | "resolve_time_scope"
  | "retry_with_capability";

export interface InvestigationProductStateInput {
  evidenceOutcome?: "supported" | "refuted" | "conflicting";
  dominantBlocker?: InvestigationDevelopmentBlocker;
  checkedScope: {
    allRequiredReachableFamiliesAttempted: boolean;
    unresolvedRequiredFamilies: number;
    accessDenied: boolean;
    capabilityLimited: boolean;
    budgetCutoff: boolean;
    temporalAmbiguity: boolean;
    stopConditionRecorded: boolean;
    blindSpotsDisclosed: boolean;
  };
}

export interface InvestigationProductState {
  outcome: InvestigationProductOutcome;
  nextAction: InvestigationNextAction;
  checkedScope: {
    label: "已檢查範圍";
    defaultExpanded: false;
    isEvidence: false;
    exhaustiveWebSearchClaimed: false;
  };
}

function blockerAction(blocker: InvestigationDevelopmentBlocker | undefined): InvestigationNextAction {
  switch (blocker) {
    case "missing_answering_evidence": return "locate_answering_source";
    case "independent_origin_shortfall": return "find_independent_origin";
    case "search_not_completed": return "continue_source_family_search";
    case "temporal_ambiguity": return "resolve_time_scope";
    case "acquisition_unavailable": return "retry_with_capability";
    default: return "review_checked_scope";
  }
}

/**
 * UI-neutral product semantics. The audit receipt is expandable provenance,
 * never a finding and never a claim that the open web was exhaustively searched.
 */
export function buildInvestigationProductState(input: InvestigationProductStateInput): InvestigationProductState {
  let outcome: InvestigationProductOutcome;
  let nextAction: InvestigationNextAction;
  if (input.evidenceOutcome) {
    outcome = input.evidenceOutcome === "supported" ? "evidence_supports"
      : input.evidenceOutcome === "refuted" ? "evidence_contradicts" : "evidence_conflicts";
    nextAction = "review_evidence";
  } else {
    const scopedNoConclusion = input.checkedScope.allRequiredReachableFamiliesAttempted &&
      input.checkedScope.unresolvedRequiredFamilies === 0 && !input.checkedScope.accessDenied &&
      !input.checkedScope.capabilityLimited && !input.checkedScope.budgetCutoff &&
      !input.checkedScope.temporalAmbiguity && input.checkedScope.stopConditionRecorded &&
      input.checkedScope.blindSpotsDisclosed;
    outcome = scopedNoConclusion ? "not_enough_evidence_in_checked_scope" : "investigation_incomplete";
    nextAction = scopedNoConclusion ? "review_checked_scope" : blockerAction(input.dominantBlocker);
  }
  return {
    outcome,
    nextAction,
    checkedScope: {
      label: "已檢查範圍",
      defaultExpanded: false,
      isEvidence: false,
      exhaustiveWebSearchClaimed: false,
    },
  };
}
