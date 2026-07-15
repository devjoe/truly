import { describe, expect, it } from "vitest";
import {
  summarizeInvestigationPairedRetrieval,
  validateInvestigationPairedRetrievalTrial,
  type InvestigationPairedRetrievalTrial,
  type InvestigationPairedRouteOutcome,
} from "../../src/lib/investigation-paired-retrieval";

const budget = { maxQueries: 2, maxDocuments: 3, maxBytes: 2_000_000, maxDurationMs: 30_000 };
function trial(): InvestigationPairedRetrievalTrial {
  return {
    version: 1,
    id: "trial:food-recall:answer",
    caseId: "case:food-recall",
    obligationId: "obligation:food-recall:answer",
    requiredFacets: ["actor", "predicate", "object", "quantity"],
    acceptedSourceRoles: ["primary"],
    baseline: { route: "atomic_query", queries: ["agency 232 recalled products"], bridgeTerms: [], sourceRouteIds: [], budget },
    candidate: { route: "source_first", queries: ["agency recall registry product list"], bridgeTerms: [{ value: "recall registry", provenance: "human_reviewed_source", sourceRef: "route-review:1" }], sourceRouteIds: ["route:food-recall:1"], budget: { ...budget } },
    blindedReviewToken: "blind:food-recall:answer",
  };
}
function outcome(route: "atomic_query" | "source_first", rescued: boolean): InvestigationPairedRouteOutcome {
  return {
    trialId: trial().id,
    route,
    queriesAttempted: 1,
    documentsAttempted: 2,
    documentsFetched: 2,
    answerableDocuments: rescued ? 1 : 0,
    qualifyingArtifacts: rescued ? 1 : 0,
    mandatoryObligationRescued: rescued,
    byteCost: 100_000,
    durationMs: 2_000,
    safety: { snippetsAsEvidence: false, verdictProduced: false, exactSpanTraceable: true },
  };
}

describe("paired source-first retrieval", () => {
  it("requires equal budgets and provenance-bound bridge terms", () => {
    expect(validateInvestigationPairedRetrievalTrial(trial())).toEqual([]);
    const invalid = trial();
    invalid.candidate.budget.maxDocuments = 4;
    invalid.candidate.bridgeTerms[0].sourceRef = undefined;
    expect(validateInvestigationPairedRetrievalTrial(invalid)).toEqual([
      "paired routes must use equal budgets",
      "invalid paired route plan",
    ]);
  });

  it("scores evidence-bearing source-first wins without treating snippets as evidence", () => {
    expect(summarizeInvestigationPairedRetrieval([trial()], [outcome("atomic_query", false), outcome("source_first", true)])).toMatchObject({
      comparableTrials: 1,
      sourceFirstWins: 1,
      sourceFirstMandatoryRescues: 1,
      atomicMandatoryRescues: 0,
      safetyPass: true,
    });
  });
});
