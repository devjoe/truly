import { describe, expect, it } from "vitest";
import { evaluateInvestigationPairedProofUpperBound } from "../../src/lib/investigation-paired-proof-bound";

describe("paired proof admission upper bound", () => {
  it("stops proof review when exact passages cannot reach the frozen candidate-only gate", () => {
    const result = evaluateInvestigationPairedProofUpperBound([
      { trialId: "trial:1", obligationType: "answering_evidence", minimumPassageCandidates: 1, baselinePassageCandidates: 0, candidatePassageCandidates: 1 },
      { trialId: "trial:2", obligationType: "independent_origins", minimumPassageCandidates: 2, baselinePassageCandidates: 1, candidatePassageCandidates: 2 },
      { trialId: "trial:3", obligationType: "answering_evidence", minimumPassageCandidates: 1, baselinePassageCandidates: 1, candidatePassageCandidates: 0 },
    ], 3);
    expect(result).toMatchObject({ candidateOnlyCeiling: 2, originCandidateOnlyCeiling: 1, canReachCandidateOnlyGate: false, proofReviewRequired: false, reason: "candidate_only_ceiling_below_gate" });
  });

  it("requires proof review when the passage ceiling could still clear the gate", () => {
    const result = evaluateInvestigationPairedProofUpperBound([
      { trialId: "trial:1", obligationType: "answering_evidence", minimumPassageCandidates: 1, baselinePassageCandidates: 0, candidatePassageCandidates: 1 },
      { trialId: "trial:2", obligationType: "independent_origins", minimumPassageCandidates: 2, baselinePassageCandidates: 0, candidatePassageCandidates: 2 },
    ], 2);
    expect(result).toMatchObject({ candidateOnlyCeiling: 2, canReachCandidateOnlyGate: true, proofReviewRequired: true });
  });

  it("rejects an invalid frozen passage threshold", () => {
    expect(() => evaluateInvestigationPairedProofUpperBound([{
      trialId: "trial:1",
      obligationType: "independent_origins",
      minimumPassageCandidates: 0,
      baselinePassageCandidates: 0,
      candidatePassageCandidates: 1,
    }], 1)).toThrow("Invalid paired proof-bound input");
  });
});
