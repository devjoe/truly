import { describe, expect, it } from "vitest";
import caseFixture from "../fixtures/claim-investigation/food-recall-case.json";
import bundleFixture from "../fixtures/claim-investigation/food-recall-contract.json";
import type { InvestigationBundle } from "../../src/lib/claim-investigation-contract";
import type { InvestigationCase } from "../../src/lib/claim-investigation-case";
import type { InvestigationObligationSet } from "../../src/lib/claim-investigation-obligations";
import { buildInvestigationSourceFamilyPlan } from "../../src/lib/investigation-discovery-planner";
import { validateInvestigationAcquisitionPortfolio } from "../../src/lib/investigation-source-route";

const investigationCase = structuredClone(caseFixture) as InvestigationCase;
const bundle = structuredClone(bundleFixture) as InvestigationBundle;

describe("Investigation Discovery Planner v2", () => {
  it("emits only obligation-required route families with bounded fallbacks", () => {
    const obligations: InvestigationObligationSet = {
      version: 2,
      caseId: investigationCase.id,
      obligations: [
        { version: 2, id: "obligation:product-count:answer", type: "answering_evidence", questionId: "question:product-count", mandatory: true, requiredFacets: ["actor", "predicate", "object", "quantity"], acceptedSourceRoles: ["primary"], recordScope: "record_content" },
        { version: 2, id: "obligation:product-count:origins", type: "independent_origins", questionId: "question:product-count", mandatory: true, minimumIndependentOrigins: 2, requiredFacets: ["actor", "predicate", "object", "quantity"] },
      ],
    };
    const plan = buildInvestigationSourceFamilyPlan({ bundle, investigationCase, obligationSet: obligations });
    expect(new Set(plan.routes.map((route) => route.routeFamily))).toEqual(new Set(["canonical_record", "lineage_diverse", "contextual_discovery"]));
    expect(plan.routes.filter((route) => route.fallback).every((route) => Boolean(route.fallbackForRouteId))).toBe(true);
    expect(plan.routes.find((route) => route.routeFamily === "lineage_diverse")?.locator).toMatchObject({ kind: "open_web", query: expect.stringContaining("independent report") });
    expect(validateInvestigationAcquisitionPortfolio({ ledger: plan, obligationSet: obligations })).toEqual([]);
  });

  it("does not force contextual routes when the case has no explicit fallback", () => {
    const noFallback = structuredClone(investigationCase);
    noFallback.discoveryPlan.targets = noFallback.discoveryPlan.targets.filter((target) => !target.fallback);
    const obligations: InvestigationObligationSet = {
      version: 2,
      caseId: noFallback.id,
      obligations: [{ version: 2, id: "obligation:product-count:origins", type: "independent_origins", questionId: "question:product-count", mandatory: true, minimumIndependentOrigins: 2, requiredFacets: ["actor", "predicate", "object", "quantity"] }],
    };
    const plan = buildInvestigationSourceFamilyPlan({ bundle, investigationCase: noFallback, obligationSet: obligations });
    expect(new Set(plan.routes.map((route) => route.routeFamily))).toEqual(new Set(["lineage_diverse"]));
  });
});
