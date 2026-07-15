import { describe, expect, it } from "vitest";

import { compileInvestigationPairedAudit, type InvestigationPairedTrial } from "../../src/lib/investigation-paired-audit";

const trial: InvestigationPairedTrial = {
  trialId: "trial:1",
  sampleId: "sample:1",
  surface: "news",
  obligationId: "obligation:question:1:answer",
  questionId: "question:1",
  baselineBlocker: "missing_answering_evidence",
  routeCandidateIds: { atomic_query: ["candidate:a"], source_first: ["candidate:b"] },
};

function reviews(candidateId: string, questionId = "question:1", decisions = [true, true]) {
  return decisions.map((admittedForQuestion, index) => ({
    candidateId,
    questionId,
    reviewerId: `reviewer:${index + 1}`,
    admittedForQuestion,
  }));
}

describe("paired investigation audit", () => {
  it("compares routes only after question-scoped independent review", () => {
    const result = compileInvestigationPairedAudit({
      trials: [trial],
      candidates: [
        { candidateId: "candidate:a", questionId: "question:1" },
        { candidateId: "candidate:b", questionId: "question:1" },
      ],
      candidateReviews: [...reviews("candidate:a", "question:1", [false, false]), ...reviews("candidate:b")],
      expectedReviewerIds: ["reviewer:1", "reviewer:2"],
    });
    expect(result).toMatchObject({ sourceFirstOnly: 1, atomicOnly: 0, both: 0, neither: 0 });
  });

  it("does not promote an origin shortfall or evidence bundle from passage review alone", () => {
    const originTrial = {
      ...trial,
      obligationId: "obligation:question:1:origins",
      baselineBlocker: "independent_origin_shortfall" as const,
      rescueUnit: "evidence_set" as const,
      routeCandidateIds: { atomic_query: [], source_first: ["candidate:a", "candidate:b"] },
    };
    const input = {
      trials: [originTrial],
      candidates: [
        { candidateId: "candidate:a", questionId: "question:1" },
        { candidateId: "candidate:b", questionId: "question:1" },
      ],
      candidateReviews: [...reviews("candidate:a"), ...reviews("candidate:b")],
      expectedReviewerIds: ["reviewer:1", "reviewer:2"],
    };
    expect(compileInvestigationPairedAudit(input)).toMatchObject({
      sourceFirstOnly: 0,
      neither: 1,
      incompleteReviewTrials: 1,
    });
    expect(compileInvestigationPairedAudit({
      ...input,
      obligationReviews: [
        { trialId: "trial:1", reviewerId: "reviewer:1", rescued: true },
        { trialId: "trial:1", reviewerId: "reviewer:2", rescued: true },
      ],
    })).toMatchObject({ sourceFirstOnly: 1, incompleteReviewTrials: 0 });
  });

  it("fails closed on cross-question reuse and reviewer disagreement", () => {
    const result = compileInvestigationPairedAudit({
      trials: [trial],
      candidates: [
        { candidateId: "candidate:a", questionId: "question:other" },
        { candidateId: "candidate:b", questionId: "question:1" },
      ],
      candidateReviews: [
        ...reviews("candidate:a", "question:other"),
        ...reviews("candidate:b", "question:1", [true, false]),
      ],
      expectedReviewerIds: ["reviewer:1", "reviewer:2"],
    });
    expect(result).toMatchObject({
      neither: 1,
      candidateReviewDisagreements: 1,
      incompleteReviewTrials: 1,
    });
  });
});
