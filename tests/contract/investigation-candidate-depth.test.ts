import { describe, expect, it } from "vitest";
import {
  buildCandidateEvidenceId,
  normalizeCandidateUrl,
  selectBoundedDocumentCandidates,
} from "../../scripts/lib/investigation-candidate-depth";

describe("bounded investigation candidate-depth replay", () => {
  const candidate = (rank: number, url = `https://agency.example.test/document-${rank}`) => ({
    targetId: "target:sample:1",
    url,
    discoveryRank: rank,
  });

  it("measures candidates in rank order and reports the target budget", () => {
    const selected = selectBoundedDocumentCandidates({
      candidates: [candidate(3), candidate(1), candidate(2)],
      maxDocumentsPerTarget: 2,
      maxDocumentsPerCase: 8,
      caseCandidateUrls: new Set(),
    });
    expect(selected.candidates.map((entry) => entry.discoveryRank)).toEqual([1, 2]);
    expect(selected.stopReason).toBe("target_budget");
  });

  it("reuses the same normalized URL across targets without spending another case slot", () => {
    const seen = new Set([normalizeCandidateUrl("https://agency.example.test/shared#first")]);
    const selected = selectBoundedDocumentCandidates({
      candidates: [candidate(1, "https://agency.example.test/shared#second"), candidate(2, "https://agency.example.test/new")],
      maxDocumentsPerTarget: 3,
      maxDocumentsPerCase: 1,
      caseCandidateUrls: seen,
    });
    expect(selected.candidates).toHaveLength(1);
    expect(selected.stopReason).toBe("case_budget");
    expect(selected.caseBudgetExhausted).toBe(true);
  });

  it("skips over a new over-budget URL to retain a later reusable document", () => {
    const seen = new Set([normalizeCandidateUrl("https://agency.example.test/shared")]);
    const selected = selectBoundedDocumentCandidates({
      candidates: [candidate(1, "https://agency.example.test/new"), candidate(2, "https://agency.example.test/shared")],
      maxDocumentsPerTarget: 3,
      maxDocumentsPerCase: 1,
      caseCandidateUrls: seen,
    });
    expect(selected.candidates.map((entry) => entry.discoveryRank)).toEqual([2]);
    expect(selected.stopReason).toBe("case_budget");
  });

  it("rejects duplicate ranks and keeps rank-one evidence IDs backward compatible", () => {
    expect(() => selectBoundedDocumentCandidates({
      candidates: [candidate(1), candidate(1, "https://agency.example.test/other")],
      maxDocumentsPerTarget: 3,
      maxDocumentsPerCase: 8,
      caseCandidateUrls: new Set(),
    })).toThrow("unique positive integers");
    expect(buildCandidateEvidenceId({
      sampleId: "sample",
      targetId: "target:sample:2",
      questionId: "question:sample:3",
      discoveryRank: 1,
    })).toBe("evidence:sample:2:3");
    expect(buildCandidateEvidenceId({
      sampleId: "sample",
      targetId: "target:sample:2",
      questionId: "question:sample:3",
      discoveryRank: 2,
    })).toBe("evidence:sample:2:2:3");
  });
});
