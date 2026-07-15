import { describe, expect, it } from "vitest";
import bundleFixture from "../fixtures/claim-investigation/food-recall-contract.json";
import caseFixture from "../fixtures/claim-investigation/food-recall-case.json";
import type { EvidenceArtifact, InvestigationBundle } from "../../src/lib/claim-investigation-contract";
import type { InvestigationCase } from "../../src/lib/claim-investigation-case";
import type { EvidencePassageAssessment } from "../../src/lib/claim-investigation-evidence";
import { evaluateInvestigationEvidenceSufficiency } from "../../src/lib/claim-investigation-evidence";

const ASSESSED_AT = "2026-07-14T03:00:00Z";

function base(): { bundle: InvestigationBundle; investigationCase: InvestigationCase } {
  const bundle = structuredClone(bundleFixture) as InvestigationBundle;
  delete bundle.sufficiency;
  delete bundle.finding;
  return {
    bundle,
    investigationCase: structuredClone(caseFixture) as InvestigationCase,
  };
}

function completeAssessments(): EvidencePassageAssessment[] {
  return [
    {
      artifactId: "evidence:agency-list",
      questionId: "question:product-count",
      state: "answers_question",
      relation: "supports",
      exactAnswerSpan: "affected-product list contains 232 entries",
      coveredFacets: ["actor", "predicate", "object", "time", "quantity"],
      missingFacets: [],
      outdated: false,
      rationale: "The fetched agency passage directly states the list count.",
    },
    {
      artifactId: "evidence:agency-archive",
      questionId: "question:notice-identity",
      state: "answers_question",
      relation: "supports",
      exactAnswerSpan: "July 8 synthetic recall notice as notice EX-232",
      coveredFacets: ["actor", "object", "time"],
      missingFacets: [],
      outdated: false,
      rationale: "The archive identifies the notice and date.",
    },
    {
      artifactId: "evidence:list-scope",
      questionId: "question:list-scope",
      state: "answers_question",
      relation: "supports",
      exactAnswerSpan: "Each entry represents one product variant",
      coveredFacets: ["object", "quantity"],
      missingFacets: [],
      outdated: false,
      rationale: "The list documentation defines the unit represented by an entry.",
    },
  ];
}

function addListScopeEvidence(bundle: InvestigationBundle): void {
  bundle.evidence.push({
    version: 2,
    id: "evidence:list-scope",
    questionId: "question:list-scope",
    sourceRole: "primary",
    url: "https://agency.example.test/notices/synthetic-recall/list-help",
    publisher: "Example Agency",
    publishedAt: "2026-07-08T08:00:00Z",
    retrievedAt: "2026-07-14T02:20:00Z",
    exactExcerpt: "Each entry represents one product variant, rather than an individual lot.",
    contentFingerprint: "11111111111111111111111111111111",
    relation: "supports",
  });
}

describe("evidence sufficiency evaluator", () => {
  it("requires all case questions to have exact answering spans and required facets", () => {
    const { bundle, investigationCase } = base();
    addListScopeEvidence(bundle);
    const result = evaluateInvestigationEvidenceSufficiency(
      bundle,
      investigationCase,
      completeAssessments(),
      ASSESSED_AT,
    );

    expect(result.validation).toEqual({ ok: true });
    expect(result.sufficiency).toMatchObject({
      state: "sufficient",
      answeredQuestionIds: investigationCase.questionIds,
      unansweredQuestionIds: [],
    });
    expect(result.qualifyingArtifactIds).toHaveLength(3);
  });

  it("keeps a related title or passage with a missing quantity insufficient", () => {
    const { bundle, investigationCase } = base();
    const assessments = completeAssessments().slice(0, 2);
    assessments[0] = {
      ...assessments[0],
      state: "relevant_but_incomplete",
      exactAnswerSpan: undefined,
      coveredFacets: ["actor", "predicate", "object", "time"],
      missingFacets: ["quantity"],
      rationale: "The passage names the event but does not state the claimed count.",
    };

    const result = evaluateInvestigationEvidenceSufficiency(bundle, investigationCase, assessments, ASSESSED_AT);
    expect(result.validation).toEqual({ ok: true });
    expect(result.sufficiency?.state).toBe("insufficient");
    expect(result.sufficiency?.unansweredQuestionIds).toContain("question:product-count");
  });

  it("rejects an answer span that was not copied from the fetched excerpt", () => {
    const { bundle, investigationCase } = base();
    const assessments = completeAssessments().slice(0, 2);
    assessments[0].exactAnswerSpan = "232 recalled products were confirmed";

    const result = evaluateInvestigationEvidenceSufficiency(bundle, investigationCase, assessments, ASSESSED_AT);
    expect(result.validation.ok).toBe(false);
    if (result.validation.ok) return;
    expect(result.validation.issues).toContainEqual(expect.objectContaining({
      path: "assessments[0].exactAnswerSpan",
      code: "invalid_value",
    }));
  });

  it("reports conflict when independent answering passages support and refute one question", () => {
    const { bundle, investigationCase } = base();
    const refutingArtifact: EvidenceArtifact = {
      version: 2,
      id: "evidence:secondary-count",
      questionId: "question:product-count",
      sourceRole: "independent_secondary",
      url: "https://independent.example.test/report",
      publisher: "Independent Example",
      publishedAt: "2026-07-08T10:00:00Z",
      retrievedAt: "2026-07-14T02:30:00Z",
      exactExcerpt: "The agency list contains 231 entries, not 232.",
      contentFingerprint: "22222222222222222222222222222222",
      relation: "refutes",
    };
    bundle.evidence.push(refutingArtifact);
    const assessments = completeAssessments().slice(0, 2);
    assessments.push({
      artifactId: refutingArtifact.id,
      questionId: "question:product-count",
      state: "answers_question",
      relation: "refutes",
      exactAnswerSpan: "list contains 231 entries, not 232",
      coveredFacets: ["actor", "predicate", "object", "time", "quantity"],
      missingFacets: [],
      outdated: false,
      rationale: "The independent report gives a directly contradictory count.",
    });

    const result = evaluateInvestigationEvidenceSufficiency(bundle, investigationCase, assessments, ASSESSED_AT);
    expect(result.validation).toEqual({ ok: true });
    expect(result.sufficiency?.state).toBe("conflicting");
    expect(result.sufficiency?.conflictingQuestionIds).toContain("question:product-count");
  });

  it("deduplicates shared-origin evidence before enforcing source sufficiency", () => {
    const { bundle, investigationCase } = base();
    addListScopeEvidence(bundle);
    bundle.plan.minimumIndependentSources = 2;
    bundle.evidence.forEach((artifact) => {
      artifact.sharedOriginGroup = "origin:agency-notice";
    });

    const result = evaluateInvestigationEvidenceSufficiency(
      bundle,
      investigationCase,
      completeAssessments(),
      ASSESSED_AT,
    );
    expect(result.independentOriginCount).toBe(1);
    expect(result.sufficiency?.state).toBe("insufficient");
    expect(result.sufficiency?.rationale).toContain("additional independent origins");
  });

  it("does not treat different fingerprints from one publisher as independent origins", () => {
    const { bundle, investigationCase } = base();
    addListScopeEvidence(bundle);
    bundle.plan.minimumIndependentSources = 2;

    const result = evaluateInvestigationEvidenceSufficiency(
      bundle,
      investigationCase,
      completeAssessments(),
      ASSESSED_AT,
    );
    expect(new Set(bundle.evidence.map((artifact) => artifact.contentFingerprint)).size).toBe(3);
    expect(result.independentOriginCount).toBe(1);
    expect(result.sufficiency?.state).toBe("insufficient");
  });

  it("does not let a claim-origin or fallback source satisfy a primary-source requirement", () => {
    const { bundle, investigationCase } = base();
    bundle.evidence[0].sourceRole = "claim_origin";
    const assessments = completeAssessments().slice(0, 2);

    const result = evaluateInvestigationEvidenceSufficiency(bundle, investigationCase, assessments, ASSESSED_AT);

    expect(result.validation).toEqual({ ok: true });
    expect(result.qualifyingArtifactIds).not.toContain("evidence:agency-list");
    expect(result.sufficiency?.unansweredQuestionIds).toContain("question:product-count");
  });
});
