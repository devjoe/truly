import { describe, expect, it } from "vitest";
import bundleFixture from "../fixtures/claim-investigation/food-recall-contract.json";
import caseFixture from "../fixtures/claim-investigation/food-recall-case.json";
import type { InvestigationBundle } from "../../src/lib/claim-investigation-contract";
import type { InvestigationCaseDraft } from "../../src/lib/claim-investigation-case-planner";
import {
  INVESTIGATION_CASE_SEMANTIC_DRAFT_JSON_SCHEMA,
  completeMissingInvestigationDiscoveryCoverage,
  investigationCaseSemanticPlannerSystemPrompt,
  investigationCaseSemanticPlannerUserPrompt,
  materializeSemanticInvestigationCase,
  investigationCasePlannerSystemPrompt,
  investigationCasePlannerUserPrompt,
  materializeInvestigationCase,
  parseInvestigationCaseDraft,
} from "../../src/lib/claim-investigation-case-planner";

function plannedBundle(): InvestigationBundle {
  const bundle = structuredClone(bundleFixture) as InvestigationBundle;
  bundle.evidence = [];
  delete bundle.sufficiency;
  delete bundle.finding;
  return bundle;
}

function draft(): InvestigationCaseDraft {
  const fixture = structuredClone(caseFixture);
  return {
    schemaVersion: 2,
    eventFrame: {
      description: fixture.eventFrame.description,
      entities: fixture.eventFrame.entities,
      time: fixture.eventFrame.time ?? null,
      place: fixture.eventFrame.place ?? null,
    },
    discoveryContext: {
      aliases: fixture.discoveryContext.aliases,
      institutions: fixture.discoveryContext.institutions,
      languages: fixture.discoveryContext.languages,
      jurisdictions: fixture.discoveryContext.jurisdictions,
      timeFrom: fixture.discoveryContext.timeBounds?.from ?? null,
      timeTo: fixture.discoveryContext.timeBounds?.to ?? null,
    },
    requirements: fixture.requirements,
    targets: fixture.discoveryPlan.targets.map(({ id: _id, ...target }: any) => target),
    stoppingConditions: fixture.discoveryPlan.stoppingConditions,
  };
}

describe("investigation case planner boundary", () => {
  it("compiles a semantic draft into local IDs, requirements, queries, and stopping conditions", () => {
    const bundle = plannedBundle();
    const result = materializeSemanticInvestigationCase({
      schemaVersion: 3,
      eventFrame: {
        description: "Synthetic food recall notice",
        entities: ["Example Foods"],
        time: null,
        place: null,
      },
      discoveryContext: {
        aliases: [],
        institutions: [],
        languages: ["en"],
        jurisdictions: [],
        timeFrom: null,
        timeTo: null,
      },
      targets: [{
        purpose: "Locate the primary recall record",
        questionIndexes: bundle.plan.questions.map((_question, index) => index),
        documentKinds: ["official_record"],
        authorityHints: [],
        acceptedSourceRoles: ["primary"],
        fallback: false,
      }],
    }, bundle, "semantic-1");

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.investigationCase.id).toBe("case:semantic-1");
    expect(result.investigationCase.requirements.map((entry) => entry.questionId))
      .toEqual(bundle.plan.questions.map((question) => question.id));
    expect(result.investigationCase.discoveryPlan.targets[0]).toMatchObject({
      id: "target:semantic-1:1",
      questionIds: bundle.plan.questions.map((question) => question.id),
      queries: bundle.plan.questions.flatMap((question) => question.queryCandidates).slice(0, 4),
    });
    expect(result.investigationCase.discoveryPlan.stoppingConditions)
      .toEqual(bundle.plan.stoppingConditions);
  });

  it("asks the semantic planner only for choices that require model judgment", () => {
    const schema = JSON.stringify(INVESTIGATION_CASE_SEMANTIC_DRAFT_JSON_SCHEMA);
    expect(schema).toContain("questionIndexes");
    expect(schema).not.toContain("questionIds");
    expect(schema).not.toContain("queries");
    expect(schema).not.toContain("requirements");
    expect(schema).not.toContain("stoppingConditions");

    const system = investigationCaseSemanticPlannerSystemPrompt("zh-TW");
    expect(system).toContain("Local code assigns IDs");
    expect(system).toContain("Do not write search queries");
    const user = investigationCaseSemanticPlannerUserPrompt(plannedBundle());
    expect(user).toContain('"index":0');
    expect(user).not.toContain("question:product-count");
    expect(user).not.toContain("queryCandidates");
  });

  it("materializes a model draft into stable case and target IDs", () => {
    const result = materializeInvestigationCase(draft(), plannedBundle(), "sample-1");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.investigationCase.id).toBe("case:sample-1");
    expect(result.investigationCase.discoveryContext.languages).toEqual(["en"]);
    expect(result.investigationCase.discoveryPlan.targets.map((target) => target.id)).toEqual([
      "target:sample-1:1",
      "target:sample-1:2",
    ]);
    expect(result.investigationCase.discoveryPlan.targets[0].questionIds).toHaveLength(3);
    expect(result.investigationCase.requirements.find((entry) =>
      entry.questionId === "question:product-count"
    )?.requiredFacets).toEqual(expect.arrayContaining(["actor", "predicate", "object", "quantity"]));
  });

  it("binds timeline and quantity answers to the correct object", () => {
    const bundle = plannedBundle();
    bundle.plan.questions[0].purpose = "timeline";
    bundle.plan.questions[1].purpose = "quantity";
    const value = draft();
    value.requirements[0].requiredFacets = ["time"];
    value.requirements[1].requiredFacets = ["quantity"];

    const result = materializeInvestigationCase(value, bundle, "sample-1");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.investigationCase.requirements[0].requiredFacets).toEqual(
      expect.arrayContaining(["actor", "predicate", "object", "time"]),
    );
    expect(result.investigationCase.requirements[1].requiredFacets).toEqual(
      expect.arrayContaining(["actor", "predicate", "object", "quantity"]),
    );
  });

  it("fails closed when a generated target omits a case question", () => {
    const value = draft();
    value.targets.forEach((target) => {
      target.questionIds = target.questionIds.filter((id) => id !== "question:list-scope");
    });
    const result = materializeInvestigationCase(value, plannedBundle(), "sample-1");
    expect(result).toMatchObject({ ok: false, error: "invalid_case" });
  });

  it("can explicitly recover missing target coverage without inventing an authority", () => {
    const value = draft();
    value.targets.forEach((target) => {
      target.questionIds = target.questionIds.filter((id) => id !== "question:list-scope");
    });
    const repaired = completeMissingInvestigationDiscoveryCoverage(value, plannedBundle());
    expect(repaired).toBeDefined();
    const target = repaired?.targets.find((entry) => entry.questionIds.includes("question:list-scope"));
    expect(target).toMatchObject({
      questionIds: ["question:list-scope"],
      authorityHints: [],
      fallback: false,
    });
    expect(target?.queries).toEqual(plannedBundle().plan.questions.find((entry) => entry.id === "question:list-scope")?.queryCandidates);
    expect(materializeInvestigationCase(repaired!, plannedBundle(), "sample-1")).toMatchObject({ ok: true });
  });

  it("maps fact-check discovery preference to an independent source instead of leaking an incompatible role", () => {
    const bundle = plannedBundle();
    const question = bundle.plan.questions.find((entry) => entry.id === "question:list-scope")!;
    question.preferredSourceRoles = ["primary", "fact_check"];
    const value = draft();
    value.targets.forEach((target) => {
      target.questionIds = target.questionIds.filter((id) => id !== question.id);
    });

    const repaired = completeMissingInvestigationDiscoveryCoverage(value, bundle);
    const target = repaired?.targets.find((entry) => entry.questionIds.includes(question.id));
    expect(target?.acceptedSourceRoles).toEqual(["primary", "independent_secondary"]);
    expect(materializeInvestigationCase(repaired!, bundle, "sample-1")).toMatchObject({ ok: true });
  });

  it("reuses a compatible non-fallback target when the six-target cap is full", () => {
    const value = draft();
    value.targets.forEach((target) => {
      target.questionIds = target.questionIds.filter((id) => id !== "question:list-scope");
    });
    while (value.targets.length < 6) value.targets.push(structuredClone(value.targets[0]));
    const repaired = completeMissingInvestigationDiscoveryCoverage(value, plannedBundle());
    expect(repaired?.targets).toHaveLength(6);
    expect(repaired?.targets.some((target) => !target.fallback && target.questionIds.includes("question:list-scope"))).toBe(true);
    expect(materializeInvestigationCase(repaired!, plannedBundle(), "sample-1")).toMatchObject({ ok: true });
  });

  it("normalizes nullable event fields without inventing context", () => {
    const value: any = draft();
    value.eventFrame.time = null;
    value.eventFrame.place = null;
    const parsed = parseInvestigationCaseDraft(value);
    expect(parsed?.eventFrame.time).toBeNull();
    expect(parsed?.eventFrame.place).toBeNull();
  });

  it("drops model-added discovery vocabulary that is not grounded in the frozen subject", () => {
    const value = draft();
    value.discoveryContext.aliases.push("Invented Parent Company");
    value.discoveryContext.institutions.push("Imaginary Registry");
    value.discoveryContext.jurisdictions.push("Atlantis");
    value.discoveryContext.timeFrom = "2039-01-01";
    value.targets[0].queries[0] = "Invented Parent Company affected products 2039";
    const result = materializeInvestigationCase(value, plannedBundle(), "sample-1");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.investigationCase.discoveryContext.aliases).not.toContain("Invented Parent Company");
    expect(result.investigationCase.discoveryContext.institutions).not.toContain("Imaginary Registry");
    expect(result.investigationCase.discoveryContext.jurisdictions).not.toContain("Atlantis");
    expect(result.investigationCase.discoveryContext.timeBounds?.from).toBeUndefined();
    expect(result.investigationCase.discoveryPlan.targets[0].queries[0]).not.toContain("2039");
  });

  it("tells the model that discovery queries and verification questions are different units", () => {
    const prompt = investigationCasePlannerSystemPrompt("zh-TW");
    expect(prompt).toContain("Do not turn every atomic question into its own search query");
    expect(prompt).toContain("Search snippets are discovery hints only");
    expect(prompt).toContain("Use claim_origin only when a question asks what the original source said");
    const user = investigationCasePlannerUserPrompt(plannedBundle());
    expect(user).toContain("question:product-count");
    expect(user).not.toContain("queryCandidates");
  });
});
