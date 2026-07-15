import { describe, expect, it } from "vitest";

import { buildFrozenLocalAcquisitionTrial } from "@src/lib/investigation-local-snapshot-audit";

describe("frozen local source-aware acquisition audit", () => {
  it("gives both arms equal budgets while restricting only the candidate pool", () => {
    const result = buildFrozenLocalAcquisitionTrial({
      sampleId: "syn_news",
      normalizedClaim: "Example Agency recalled 232 products on July 8.",
      question: {
        id: "question:syn_news:1",
        basis: "literal",
        purpose: "proposition",
        question: "Did Example Agency recall 232 products on July 8?",
        queryCandidates: ["Example Agency 232 products July 8"],
        preferredSourceRoles: ["primary"],
      },
      requiredFacets: ["predicate", "quantity", "time"],
      route: {
        responsibility: { id: "responsibility:syn", questionId: "question:syn_news:1" },
        queryPortfolio: ["Example Agency recall notice July 8 232"],
        locatorState: "matched_catalog",
        catalogEntryId: "authority:example:record",
      },
      documents: [
        {
          snapshotId: "snapshot:noise",
          url: "https://news.invalid/noise",
          domain: "news.invalid",
          title: "Example Agency 232 products July 8 background",
          text: "A general background page without the recall statement.",
          catalogEntryIds: [],
          sourceFamilies: ["independent_reporting"],
        },
        {
          snapshotId: "snapshot:official",
          url: "https://example.gov/notice",
          domain: "example.gov",
          title: "Recall notice",
          text: "Example Agency recalled 232 products on July 8. Consumers should check the official list.",
          catalogEntryIds: ["authority:example:record"],
          sourceFamilies: ["official_record"],
        },
      ],
      maxDocuments: 1,
    });

    expect(result.budget).toEqual({ maxQueries: 1, maxDocuments: 1 });
    expect(result.externalQueryCount).toBe(0);
    expect(result.question).toBe("Did Example Agency recall 232 products on July 8?");
    expect(result.baseline.documents).toHaveLength(1);
    expect(result.candidate.documents).toHaveLength(1);
    expect(result.baseline.documents[0].snapshotId).toBe("snapshot:noise");
    expect(result.baseline.documents[0].passageCandidate).toBe(false);
    expect(result.candidate.documents[0].snapshotId).toBe("snapshot:official");
    expect(result.candidate.documents[0].passageCandidate).toBe(true);
    expect(result.candidateOnlyPassageCandidate).toBe(true);
    expect(result.evidenceProduced).toBe(false);
    expect(result.verdictProduced).toBe(false);
  });

  it("rejects unmatched routes instead of silently searching the whole snapshot", () => {
    expect(() => buildFrozenLocalAcquisitionTrial({
      sampleId: "syn_unmatched",
      normalizedClaim: "Claim",
      question: {
        id: "question:syn_unmatched:1",
        basis: "literal",
        purpose: "proposition",
        question: "Is the claim correct?",
        queryCandidates: ["claim"],
        preferredSourceRoles: ["primary"],
      },
      requiredFacets: ["predicate"],
      route: {
        responsibility: { id: "responsibility:syn", questionId: "question:syn_unmatched:1" },
        queryPortfolio: ["claim"],
        locatorState: "open_web_fallback",
      },
      documents: [],
      maxDocuments: 2,
    })).toThrow("matched catalog route");
  });
});
