import { describe, expect, it } from "vitest";
import { buildInvestigationProductState } from "../../src/lib/investigation-product-state";

const checked = {
  allRequiredReachableFamiliesAttempted: true,
  unresolvedRequiredFamilies: 0,
  accessDenied: false,
  capabilityLimited: false,
  budgetCutoff: false,
  temporalAmbiguity: false,
  stopConditionRecorded: true,
  blindSpotsDisclosed: true,
};

describe("dual-channel investigation product state", () => {
  it("keeps a scoped no-conclusion separate from the expandable audit receipt", () => {
    expect(buildInvestigationProductState({ checkedScope: checked })).toEqual({
      outcome: "not_enough_evidence_in_checked_scope",
      nextAction: "review_checked_scope",
      checkedScope: { label: "已檢查範圍", defaultExpanded: false, isEvidence: false, exhaustiveWebSearchClaimed: false },
    });
  });

  it("uses incomplete whenever access, capability, budget, temporal, or family scope remains unresolved", () => {
    expect(buildInvestigationProductState({
      dominantBlocker: "acquisition_unavailable",
      checkedScope: { ...checked, accessDenied: true },
    })).toMatchObject({ outcome: "investigation_incomplete", nextAction: "retry_with_capability" });
  });

  it("keeps an evidentiary outcome primary regardless of receipt completeness", () => {
    expect(buildInvestigationProductState({
      evidenceOutcome: "conflicting",
      checkedScope: { ...checked, unresolvedRequiredFamilies: 2, budgetCutoff: true },
    })).toMatchObject({ outcome: "evidence_conflicts", nextAction: "review_evidence" });
  });
});
