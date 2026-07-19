import { describe, expect, it } from "vitest";
import fixture from "../fixtures/claim-investigation/food-recall-contract.json";
import caseFixture from "../fixtures/claim-investigation/food-recall-case.json";
import type { InvestigationBundle } from "../../src/lib/claim-investigation-contract";
import type { InvestigationCase } from "../../src/lib/claim-investigation-case";
import {
  buildInvestigationCaseRetrievalRoute,
  buildInvestigationRetrievalRoute,
} from "../../src/lib/claim-investigation-retrieval";

function plannedBundle(): InvestigationBundle {
  const bundle = structuredClone(fixture) as InvestigationBundle;
  bundle.evidence = [];
  delete bundle.sufficiency;
  delete bundle.finding;
  return bundle;
}

describe("investigation retrieval routes", () => {
  it("keeps the single-search baseline to one inspectable step", () => {
    const steps = buildInvestigationRetrievalRoute(plannedBundle(), "single_search");
    expect(steps).toHaveLength(1);
    expect(steps[0].operation).toBe("search_web");
    expect(steps[0].evidenceFromSnippetAllowed).toBe(false);
    expect(steps[0].verdictFromSnippetAllowed).toBe(false);
  });

  it("uses each decomposed question without trusting executable model instructions", () => {
    const steps = buildInvestigationRetrievalRoute(plannedBundle(), "question_decomposition");
    expect(steps).toHaveLength(3);
    expect(steps.every((step) => step.questionId && step.phase === "question")).toBe(true);
    expect(steps.some((step) => /https?:|google|bing/i.test(step.query ?? ""))).toBe(false);
  });

  it("allows a search-product entity but strips search-engine instructions and private-record requests", () => {
    const bundle = plannedBundle();
    bundle.subject.normalizedClaim = "Google Preferred Sources lets users prioritize publishers.";
    bundle.subject.proposition = {
      originalSpan: "Google Preferred Sources lets users prioritize publishers.",
      normalizedText: "Google Preferred Sources lets users prioritize publishers.",
    };
    bundle.plan.questions = [{
      ...bundle.plan.questions[0],
      queryCandidates: [
        "Google Preferred Sources publishers",
        "search Google for preferred publishers",
        "Lisa Faulkner medical records",
      ],
    }];
    const steps = buildInvestigationRetrievalRoute(bundle, "question_decomposition");
    expect(steps.map((step) => step.query)).toEqual(["Google Preferred Sources publishers"]);
  });

  it("locates an authority and document before extracting an exact passage", () => {
    const steps = buildInvestigationRetrievalRoute(plannedBundle(), "authority_document_first");
    expect(steps).toHaveLength(9);
    expect(steps.filter((step) => step.operation === "locate_authority")).toHaveLength(3);
    expect(steps.filter((step) => step.operation === "locate_document")).toHaveLength(3);
    expect(steps.filter((step) => step.operation === "extract_exact_passage")).toHaveLength(3);
    expect(steps.every((step) => step.acceptedSourceRoles.includes("primary"))).toBe(true);
    expect(steps.filter((step) => step.operation === "extract_exact_passage").every((step) =>
      step.requiresFetchedDocument && step.query === undefined && step.dependsOnStepIds.length === 1
    )).toBe(true);
    expect(steps.every((step) => step.verdictFromSnippetAllowed === false)).toBe(true);
  });

  it("builds an adaptive primary-document cascade with an explicit secondary fallback", () => {
    const steps = buildInvestigationRetrievalRoute(plannedBundle(), "adaptive_evidence_cascade");
    expect(steps).toHaveLength(33);
    expect(steps.every((step) => step.evidenceFromSnippetAllowed === false)).toBe(true);
    expect(steps.every((step) => step.verdictFromSnippetAllowed === false)).toBe(true);

    const firstQuestion = fixture.plan.questions[0].id;
    const scoped = steps.filter((step) => step.questionId === firstQuestion);
    const query = scoped.find((step) => step.id.endsWith(":query:1"))!;
    const authority = scoped.find((step) => step.id.endsWith(":authority"))!;
    const document = scoped.find((step) => step.id.endsWith(":document") && !step.id.includes(":fallback:"))!;
    const fetch = scoped.find((step) => step.id.endsWith(":fetch") && !step.id.includes(":fallback:"))!;
    const passage = scoped.find((step) => step.id.endsWith(":passage") && !step.id.includes(":fallback:"))!;
    const assessment = scoped.find((step) => step.id.endsWith(":assessment") && !step.id.includes(":fallback:"))!;
    expect(authority.dependsOnStepIds).toContain(query.id);
    expect(document.dependsOnStepIds).toEqual([authority.id]);
    expect(fetch.dependsOnStepIds).toEqual([document.id]);
    expect(passage.dependsOnStepIds).toEqual([fetch.id]);
    expect(passage).toMatchObject({ resultUse: "exact_passage", requiresFetchedDocument: true });
    expect(assessment.dependsOnStepIds).toEqual([passage.id]);

    const fallback = scoped.filter((step) => step.runWhen === "primary_unavailable_or_insufficient");
    expect(fallback).toHaveLength(5);
    expect(fallback.every((step) => step.evidenceQualityDowngrade)).toBe(true);
    expect(fallback.every((step) => step.acceptedSourceRoles.every((role) =>
      role === "independent_secondary" || role === "fact_check"
    ))).toBe(true);
    expect(fallback[0]).toMatchObject({
      operation: "search_secondary_fallback",
      resultUse: "discovery_only",
      dependsOnStepIds: [assessment.id],
    });
    expect(fallback.find((step) => step.resultUse === "exact_passage")).toMatchObject({
      requiresFetchedDocument: true,
    });
  });

  it("does not create a new route over an existing evidence ledger", () => {
    expect(buildInvestigationRetrievalRoute(fixture as InvestigationBundle, "single_search")).toEqual([]);
  });

  it("searches at document level, fetches once, then fans out to atomic questions", () => {
    const steps = buildInvestigationCaseRetrievalRoute(
      plannedBundle(),
      structuredClone(caseFixture) as InvestigationCase,
    );
    const primaryTarget = steps.filter((step) => step.discoveryTargetId === "target:agency-notice");
    expect(primaryTarget.filter((step) => step.operation === "search_web")).toHaveLength(2);
    expect(primaryTarget.filter((step) => step.operation === "fetch_document")).toHaveLength(1);
    expect(primaryTarget.filter((step) => step.operation === "extract_exact_passage")).toHaveLength(3);
    expect(primaryTarget.filter((step) => step.operation === "assess_sufficiency")).toHaveLength(3);
    expect(primaryTarget.filter((step) => step.operation === "search_web").every((step) =>
      step.questionId === undefined && step.questionIds?.length === 3 && step.resultUse === "discovery_only"
    )).toBe(true);

    const fetch = primaryTarget.find((step) => step.operation === "fetch_document")!;
    expect(primaryTarget.filter((step) => step.operation === "extract_exact_passage").every((step) =>
      step.dependsOnStepIds.includes(fetch.id) && step.requiresFetchedDocument
    )).toBe(true);
  });

  it("activates a case fallback only after primary sufficiency assessments", () => {
    const steps = buildInvestigationCaseRetrievalRoute(
      plannedBundle(),
      structuredClone(caseFixture) as InvestigationCase,
    );
    const fallback = steps.filter((step) => step.discoveryTargetId === "target:independent-report");
    expect(fallback.every((step) => step.runWhen === "primary_unavailable_or_insufficient")).toBe(true);
    const fallbackSearch = fallback.find((step) => step.operation === "search_secondary_fallback")!;
    expect(fallbackSearch.dependsOnStepIds).toEqual(expect.arrayContaining([
      "step:case:1:assessment:1",
      "step:case:1:assessment:3",
    ]));
    expect(fallbackSearch.evidenceQualityDowngrade).toBe(false);
    expect(fallback.every((step) => step.evidenceFromSnippetAllowed === false)).toBe(true);
  });
});
