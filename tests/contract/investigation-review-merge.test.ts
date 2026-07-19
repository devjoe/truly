import { describe, expect, it } from "vitest";
import { mergeInvestigationReviewParts } from "../../scripts/lib/investigation-review-merge";

const evidence = {
  version: 2 as const,
  id: "evidence:sample:1:1",
  questionId: "question:sample:1",
  sourceRole: "primary" as const,
  retrievedAt: "2026-07-15T00:00:00Z",
  exactExcerpt: "Agency notice confirms 232 affected products.",
  relation: "context" as const,
};

describe("private investigation review merge", () => {
  const retrievalRows = [{
    sampleId: "sample",
    targetRuns: [{ questionRuns: [{ status: "passage_candidate_extracted", evidence }] }],
  }];
  const assessment = {
    artifactId: evidence.id,
    questionId: evidence.questionId,
    state: "answers_question" as const,
    relation: "supports" as const,
    exactAnswerSpan: "232 affected products",
    coveredFacets: ["quantity" as const],
    missingFacets: [],
    outdated: false,
    rationale: "The exact span answers the count.",
  };

  it("merges complete review parts in retrieval order", () => {
    expect(mergeInvestigationReviewParts({
      retrievalRows,
      reviewParts: [{ rows: [{ sampleId: "sample", assessments: [assessment] }] }],
    })).toEqual([{ sampleId: "sample", assessments: [assessment] }]);
  });

  it("rejects missing, duplicate, and non-exact assessments", () => {
    expect(() => mergeInvestigationReviewParts({ retrievalRows, reviewParts: [] }))
      .toThrow("exactly match retrieval samples");
    expect(() => mergeInvestigationReviewParts({
      retrievalRows,
      reviewParts: [{ rows: [
        { sampleId: "sample", assessments: [assessment] },
        { sampleId: "sample", assessments: [assessment] },
      ] }],
    })).toThrow("Duplicate review sample");
    expect(() => mergeInvestigationReviewParts({
      retrievalRows,
      reviewParts: [{ rows: [{ sampleId: "sample", assessments: [{ ...assessment, exactAnswerSpan: "not present" }] }] }],
    })).toThrow("not in the fetched excerpt");
  });

  it("requires an explicit empty review row when a sample has no passages", () => {
    const emptyRetrieval = [{ sampleId: "empty", targetRuns: [] }];
    expect(() => mergeInvestigationReviewParts({ retrievalRows: emptyRetrieval, reviewParts: [] }))
      .toThrow("exactly match retrieval samples");
    expect(mergeInvestigationReviewParts({
      retrievalRows: emptyRetrieval,
      reviewParts: [{ rows: [{ sampleId: "empty", assessments: [] }] }],
    })).toEqual([{ sampleId: "empty", assessments: [] }]);
  });
});
