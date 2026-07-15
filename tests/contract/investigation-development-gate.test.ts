import { describe, expect, it } from "vitest";
import { evaluateInvestigationDevelopmentGate, type InvestigationDevelopmentCaseReview } from "../../src/lib/investigation-development-gate";

function review(caseId: string, surface: "facebook" | "news", blocker: InvestigationDevelopmentCaseReview["transitions"][number]["baselineBlocker"]): InvestigationDevelopmentCaseReview {
  return {
    caseId,
    surface,
    safety: { snippetsAsEvidence: false, verdictProduced: false, exactSpanTraceable: true, temporalFailClosed: true },
    transitions: [{
      obligationId: `o:${caseId}`,
      baselineBlocker: blocker,
      candidateStatus: "satisfied",
      falseClosure: false,
      causedByProofRelaxation: false,
      rescueKind: blocker === "independent_origin_shortfall" ? "origin_bearing" : "evidence_bearing",
    }],
    baselineUnresolvedMandatory: 3,
    candidateUnresolvedMandatory: 2,
    processCapability: { fairBudgetExecuted: true, accessAccountingComplete: true, zeroYieldStopHonored: true, receiptScopeHonest: true },
    regressionCount: 0,
    blindedPreference: "candidate",
    reviewerAgreement: true,
  };
}

describe("causal development promotion gate", () => {
  it("requires safe attributable rescue across surfaces and blocker types", () => {
    const result = evaluateInvestigationDevelopmentGate([
      review("fb:1", "facebook", "missing_answering_evidence"),
      review("news:1", "news", "independent_origin_shortfall"),
      review("news:2", "news", "missing_answering_evidence"),
    ]);
    expect(result).toMatchObject({ pass: true, safetyPass: true, evidenceUtilityPass: true, processCapabilityPass: true, rescuedObligations: 3, evidenceOrOriginBearingRescues: 3 });
  });

  it("reports process capability separately and never lets receipt-only progress promote", () => {
    const rows = [
      review("fb:1", "facebook", "search_not_completed"),
      review("news:1", "news", "search_not_completed"),
      review("news:2", "news", "search_not_completed"),
    ];
    rows.forEach((row) => { row.transitions[0].rescueKind = "receipt_only"; });
    const result = evaluateInvestigationDevelopmentGate(rows);
    expect(result).toMatchObject({ pass: false, safetyPass: true, processCapabilityPass: true, evidenceUtilityPass: false, evidenceOrOriginBearingRescues: 0 });
  });

  it("fails on false closure, proof relaxation, or a one-surface gain", () => {
    const rows = [review("fb:1", "facebook", "missing_answering_evidence"), review("fb:2", "facebook", "independent_origin_shortfall"), review("fb:3", "facebook", "missing_answering_evidence")];
    rows[0].transitions[0].falseClosure = true;
    rows[1].transitions[0].causedByProofRelaxation = true;
    const result = evaluateInvestigationDevelopmentGate(rows);
    expect(result.pass).toBe(false);
    expect(result.falseClosures).toBe(1);
  });

  it("does not attribute a shared matched-baseline success to the candidate", () => {
    const shared = review("news:shared", "news", "missing_answering_evidence");
    shared.transitions[0].matchedBaselineStatus = "satisfied";
    shared.baselineUnresolvedMandatory = 0;
    shared.candidateUnresolvedMandatory = 0;
    shared.blindedPreference = "tie";
    const result = evaluateInvestigationDevelopmentGate([
      shared,
      review("fb:candidate-only", "facebook", "independent_origin_shortfall"),
    ]);
    expect(result).toMatchObject({ pass: false, rescuedObligations: 1, improvedCases: 1 });
  });
});
