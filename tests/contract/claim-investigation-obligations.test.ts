import { describe, expect, it } from "vitest";
import bundleFixture from "../fixtures/claim-investigation/food-recall-contract.json";
import caseFixture from "../fixtures/claim-investigation/food-recall-case.json";
import type { InvestigationBundle } from "../../src/lib/claim-investigation-contract";
import type { InvestigationCase } from "../../src/lib/claim-investigation-case";
import type { EvidencePassageAssessment } from "../../src/lib/claim-investigation-evidence";
import { evaluateInvestigationEvidenceSufficiency } from "../../src/lib/claim-investigation-evidence";
import {
  buildConservativeProofResponsibilities,
  buildDefaultInvestigationObligations,
  evaluateInvestigationProgress,
  type SearchCoverageReceipt,
} from "../../src/lib/claim-investigation-obligations";

const ASSESSED_AT = "2026-07-15T01:00:00Z";

function inputs() {
  const bundle = structuredClone(bundleFixture) as InvestigationBundle;
  delete bundle.sufficiency;
  delete bundle.finding;
  const investigationCase = structuredClone(caseFixture) as InvestigationCase;
  const assessments: EvidencePassageAssessment[] = [{
    artifactId: "evidence:agency-list",
    questionId: "question:product-count",
    state: "answers_question",
    relation: "supports",
    exactAnswerSpan: "affected-product list contains 232 entries",
    coveredFacets: ["actor", "predicate", "object", "time", "quantity"],
    missingFacets: [],
    outdated: false,
    rationale: "The primary passage answers the literal count question.",
  }];
  return { bundle, investigationCase, assessments };
}

function completeReceipt(obligationId: string, discoveryTargetIds: string[]): SearchCoverageReceipt {
  return {
    version: 2,
    obligationId,
    discoveryTargetIds,
    coverageState: "bounded_complete",
    hypotheses: [
      { id: "hypothesis:support", kind: "supporting", statement: "The stated event occurred." },
      { id: "hypothesis:counter", kind: "counter", statement: "The stated event did not occur as described." },
    ],
    sourceFamilies: [{ id: "family:official", family: "official_record", status: "covered" }],
    languages: ["zh-TW"],
    timeScope: { from: "2025-01-01", to: "2026-07-15" },
    aliases: ["affected product"],
    actions: [{
      query: "agency affected product notice",
      hypothesisIds: ["hypothesis:support", "hypothesis:counter"],
      sourceFamilyIds: ["family:official"],
      language: "zh-TW",
      candidatesConsidered: 4,
      documentsAttempted: 2,
    }],
    unresolvedBlindSpots: ["Authenticated industry database was outside the bounded search."],
    queriesAttempted: 1,
    candidateDocumentsConsidered: 4,
    documentsAttempted: 2,
    stopReason: "budget_exhausted",
    completedAt: ASSESSED_AT,
  };
}

describe("typed investigation proof obligations", () => {
  it("does not treat a primary press release as a canonical record", () => {
    const { bundle, investigationCase } = inputs();
    const question = bundle.plan.questions.find((entry) => entry.id === "question:product-count")!;
    question.purpose = "quantity";
    question.preferredSourceRoles = ["primary"];
    investigationCase.discoveryPlan.targets
      .filter((target) => target.questionIds.includes(question.id))
      .forEach((target) => {
        target.documentKinds = ["official_announcement"];
        target.acceptedSourceRoles = ["primary"];
      });

    expect(buildConservativeProofResponsibilities(bundle, investigationCase)
      .find((entry) => entry.questionId === question.id)?.standard).toBe("independent_corroboration");
  });

  it("keeps supporting context visible without blocking literal evidence readiness", () => {
    const { bundle, investigationCase, assessments } = inputs();
    const evidenceEvaluation = evaluateInvestigationEvidenceSufficiency(bundle, investigationCase, assessments, ASSESSED_AT);
    const obligationSet = buildDefaultInvestigationObligations(bundle, investigationCase);
    const progress = evaluateInvestigationProgress({
      bundle, investigationCase, evidenceEvaluation, obligationSet,
      searchReceipts: [], acquisitionTraces: [], assessedAt: ASSESSED_AT,
    });

    expect(progress.state).toBe("ready_for_review");
    expect(progress.mandatorySatisfied).toBe(progress.mandatoryTotal);
    expect(progress.supportingSatisfied).toBeLessThan(progress.supportingTotal);
    expect(progress.verdictProduced).toBe(false);
  });

  it("applies independent-origin minima to the literal question instead of pooling unrelated questions", () => {
    const { bundle, investigationCase, assessments } = inputs();
    bundle.plan.minimumIndependentSources = 2;
    const evidenceEvaluation = evaluateInvestigationEvidenceSufficiency(bundle, investigationCase, assessments, ASSESSED_AT);
    const obligationSet = buildDefaultInvestigationObligations(bundle, investigationCase);
    const progress = evaluateInvestigationProgress({
      bundle, investigationCase, evidenceEvaluation, obligationSet,
      searchReceipts: [], acquisitionTraces: [], assessedAt: ASSESSED_AT,
    });

    expect(progress.state).toBe("collecting");
    expect(progress.obligations).toContainEqual(expect.objectContaining({
      obligationId: "obligation:question:product-count:origins",
      blocker: "independent_origin_shortfall",
    }));
  });

  it("records bounded counterevidence search completion without fabricating an evidence passage", () => {
    const { bundle, investigationCase, assessments } = inputs();
    bundle.plan.questions[2].purpose = "counterevidence";
    const evidenceEvaluation = evaluateInvestigationEvidenceSufficiency(bundle, investigationCase, assessments, ASSESSED_AT);
    const obligationSet = buildDefaultInvestigationObligations(bundle, investigationCase);
    const searchObligation = obligationSet.obligations.find((entry) => entry.type === "counterevidence_search")!;

    const pending = evaluateInvestigationProgress({
      bundle, investigationCase, evidenceEvaluation, obligationSet,
      searchReceipts: [], acquisitionTraces: [], assessedAt: ASSESSED_AT,
    });
    expect(pending.state).toBe("collecting");

    const completed = evaluateInvestigationProgress({
      bundle, investigationCase, evidenceEvaluation, obligationSet,
      searchReceipts: [completeReceipt(
        searchObligation.id,
        searchObligation.type === "counterevidence_search" ? searchObligation.discoveryTargetIds : [],
      )],
      acquisitionTraces: [],
      assessedAt: ASSESSED_AT,
    });
    expect(completed.state).toBe("ready_for_review");
    expect(completed.obligations.find((entry) => entry.obligationId === searchObligation.id)).toMatchObject({
      status: "satisfied",
      proofArtifactIds: [],
    });
    expect(completed.verdictProduced).toBe(false);
  });

  it("rejects empty or target-mismatched search receipts", () => {
    const { bundle, investigationCase, assessments } = inputs();
    bundle.plan.questions[2].purpose = "counterevidence";
    const evidenceEvaluation = evaluateInvestigationEvidenceSufficiency(bundle, investigationCase, assessments, ASSESSED_AT);
    const obligationSet = buildDefaultInvestigationObligations(bundle, investigationCase);
    const searchObligation = obligationSet.obligations.find((entry) => entry.type === "counterevidence_search")!;

    expect(() => evaluateInvestigationProgress({
      bundle, investigationCase, evidenceEvaluation, obligationSet,
      searchReceipts: [{ ...completeReceipt(searchObligation.id, []), actions: [], queriesAttempted: 0, candidateDocumentsConsidered: 0, documentsAttempted: 0 }],
      acquisitionTraces: [],
      assessedAt: ASSESSED_AT,
    })).toThrow("Invalid search coverage receipt");
  });

  it("builds obligations only for the legal case question subset", () => {
    const { bundle, investigationCase } = inputs();
    investigationCase.questionIds = ["question:product-count"];
    investigationCase.requirements = investigationCase.requirements.filter((entry) => entry.questionId === "question:product-count");
    investigationCase.discoveryPlan.targets.forEach((target) => {
      target.questionIds = target.questionIds.filter((questionId) => questionId === "question:product-count");
    });
    investigationCase.discoveryPlan.targets = investigationCase.discoveryPlan.targets.filter((target) => target.questionIds.length > 0);

    const obligations = buildDefaultInvestigationObligations(bundle, investigationCase);
    expect(new Set(obligations.obligations.map((entry) => entry.questionId)))
      .toEqual(new Set(["question:product-count"]));
  });

  it("lets a primary canonical record satisfy only an explicitly record-scoped question", () => {
    const { bundle, investigationCase, assessments } = inputs();
    bundle.plan.minimumIndependentSources = 2;
    const evidenceEvaluation = evaluateInvestigationEvidenceSufficiency(bundle, investigationCase, assessments, ASSESSED_AT);
    const requirement = investigationCase.requirements.find((entry) => entry.questionId === "question:product-count")!;
    const obligationSet = buildDefaultInvestigationObligations(bundle, investigationCase, [{
      questionId: "question:product-count",
      standard: "canonical_record",
      requiredFacets: requirement.requiredFacets,
      recordScope: "record_content",
      entitledSourceRoles: ["primary"],
    }]);
    const progress = evaluateInvestigationProgress({
      bundle, investigationCase, evidenceEvaluation, obligationSet,
      searchReceipts: [], acquisitionTraces: [], assessedAt: ASSESSED_AT,
    });
    expect(progress.obligations.some((entry) => entry.obligationId.endsWith(":origins"))).toBe(false);
    expect(progress.obligations.find((entry) => entry.obligationId.endsWith(":answer"))).toMatchObject({ status: "satisfied" });
  });

  it("rejects canonical entitlement that extends beyond primary record sources", () => {
    const { bundle, investigationCase } = inputs();
    const requirement = investigationCase.requirements.find((entry) => entry.questionId === "question:product-count")!;
    expect(() => buildDefaultInvestigationObligations(bundle, investigationCase, [{
      questionId: "question:product-count",
      standard: "canonical_record",
      requiredFacets: requirement.requiredFacets,
      recordScope: "record_content",
      entitledSourceRoles: ["claim_origin"],
    }])).toThrow("Invalid proof responsibility");
  });

  it("keeps a partial evidence map pending", () => {
    const { bundle, investigationCase, assessments } = inputs();
    bundle.plan.questions[2].purpose = "counterevidence";
    const evidenceEvaluation = evaluateInvestigationEvidenceSufficiency(bundle, investigationCase, assessments, ASSESSED_AT);
    const obligationSet = buildDefaultInvestigationObligations(bundle, investigationCase);
    const searchObligation = obligationSet.obligations.find((entry) => entry.type === "counterevidence_search")!;
    const receipt = completeReceipt(searchObligation.id, searchObligation.type === "counterevidence_search" ? searchObligation.discoveryTargetIds : []);
    receipt.coverageState = "partial";
    receipt.sourceFamilies[0].status = "unresolved";
    const progress = evaluateInvestigationProgress({
      bundle, investigationCase, evidenceEvaluation, obligationSet,
      searchReceipts: [receipt], acquisitionTraces: [], assessedAt: ASSESSED_AT,
    });
    expect(progress.obligations.find((entry) => entry.obligationId === searchObligation.id)).toMatchObject({ status: "pending", blocker: "search_not_completed" });
  });

  it("reports attempted unavailable acquisition as blocked instead of not started", () => {
    const { bundle, investigationCase, assessments } = inputs();
    bundle.evidence = [];
    const evidenceEvaluation = evaluateInvestigationEvidenceSufficiency(bundle, investigationCase, [], ASSESSED_AT);
    const obligationSet = buildDefaultInvestigationObligations(bundle, investigationCase);
    const progress = evaluateInvestigationProgress({
      bundle, investigationCase, evidenceEvaluation, obligationSet,
      searchReceipts: [],
      acquisitionTraces: [{
        questionId: "question:product-count",
        attempts: 1,
        documentsFetched: 0,
        allKnownCandidatesUnavailable: true,
      }],
      assessedAt: ASSESSED_AT,
    });
    expect(progress.state).toBe("blocked");
    expect(progress.obligations).toContainEqual(expect.objectContaining({
      obligationId: "obligation:question:product-count:answer",
      blocker: "acquisition_unavailable",
    }));
    expect(assessments).toHaveLength(1);
  });
});
