import { describe, expect, it } from "vitest";

import caseFixture from "../fixtures/claim-investigation/food-recall-case.json";
import bundleFixture from "../fixtures/claim-investigation/food-recall-contract.json";
import type { InvestigationCase } from "../../src/lib/claim-investigation-case";
import type { InvestigationBundle } from "../../src/lib/claim-investigation-contract";
import type { InvestigationObligationSet } from "../../src/lib/claim-investigation-obligations";
import {
  buildSourceAwareAcquisitionPlan,
  compileInvestigationSourceResponsibilities,
  validateInvestigationTrustedLocatorCatalog,
  validateSourceAwareAcquisitionPlan,
  type InvestigationTrustedLocatorCatalog,
} from "../../src/lib/investigation-source-aware-acquisition";

const investigationCase = structuredClone(caseFixture) as InvestigationCase;
const bundle = structuredClone(bundleFixture) as InvestigationBundle;
const obligations: InvestigationObligationSet = {
  version: 2,
  caseId: investigationCase.id,
  obligations: [
    { version: 2, id: "obligation:product-count:answer", type: "answering_evidence", questionId: "question:product-count", mandatory: true, requiredFacets: ["actor", "predicate", "object", "time", "quantity"], acceptedSourceRoles: ["primary"], recordScope: "record_content" },
    { version: 2, id: "obligation:product-count:origins", type: "independent_origins", questionId: "question:product-count", mandatory: true, minimumIndependentOrigins: 2, requiredFacets: ["actor", "predicate", "object", "time", "quantity"] },
  ],
};

function catalog(): InvestigationTrustedLocatorCatalog {
  return {
    version: 1,
    entries: [{
      id: "authority:example-agency",
      authorityNames: ["Example Agency"],
      jurisdictions: [],
      languages: ["en"],
      sourceFamily: "official_record",
      documentKinds: ["official_announcement", "dataset"],
      locators: [
        { kind: "registry_record", registry: "registry:example-agency-notices", documentKinds: ["official_announcement", "dataset"] },
        { kind: "domain_index", domain: "agency.example.test", documentKinds: ["official_announcement", "dataset"] },
      ],
      provenance: "human_reviewed_source",
      sourceRef: "review:synthetic-authority-catalog",
      status: "active",
      reviewedAt: "2026-07-15T00:00:00Z",
      reviewDueAt: "2026-10-15T00:00:00Z",
    }],
  };
}

describe("source-aware acquisition candidate", () => {
  it("compiles proof obligations into question-specific source responsibilities", () => {
    const responsibilities = compileInvestigationSourceResponsibilities({ bundle, investigationCase, obligationSet: obligations });
    expect(responsibilities).toEqual([
      expect.objectContaining({ questionId: "question:product-count", obligationId: "obligation:product-count:answer", kind: "canonical_record", requiredSourceFamilies: ["official_record"], preferredLocatorKinds: ["registry_record", "domain_index", "open_web"] }),
      expect.objectContaining({ questionId: "question:product-count", obligationId: "obligation:product-count:origins", kind: "independent_corroboration", requiredSourceFamilies: ["independent_reporting"], minimumIndependentOrigins: 2, preferredLocatorKinds: ["open_web"] }),
    ]);
  });

  it("uses a reviewed registry for the canonical question and keeps origin discovery separate", () => {
    const plan = buildSourceAwareAcquisitionPlan({ bundle, investigationCase, obligationSet: obligations, catalog: catalog() });
    expect(validateSourceAwareAcquisitionPlan({ plan, obligationSet: obligations, catalog: catalog() })).toEqual([]);
    const canonical = plan.routes.find((entry) => entry.responsibility.kind === "canonical_record");
    const independent = plan.routes.find((entry) => entry.responsibility.kind === "independent_corroboration");
    expect(canonical).toMatchObject({ locatorState: "matched_catalog", catalogEntryId: "authority:example-agency", route: { locator: { kind: "registry_record", registry: "registry:example-agency-notices" } } });
    expect(canonical?.queryPortfolio.length).toBeGreaterThan(0);
    expect(canonical?.queryPortfolio.length).toBeLessThanOrEqual(canonical?.route.budget.maxQueries ?? 0);
    expect(independent).toMatchObject({ locatorState: "open_web_fallback", unresolvedLocatorReason: "trusted_locator_not_applicable", route: { routeFamily: "lineage_diverse", sourceFamily: "independent_reporting", locator: { kind: "open_web" } } });
    expect(canonical?.queryPortfolio[0]).not.toContain("report");
    expect(independent?.queryPortfolio[0]).toContain("report");
    expect(plan.evidenceProduced).toBe(false);
    expect(plan.verdictProduced).toBe(false);
  });

  it("fails closed instead of inventing an authority domain", () => {
    const emptyCatalog: InvestigationTrustedLocatorCatalog = { version: 1, entries: [] };
    const plan = buildSourceAwareAcquisitionPlan({ bundle, investigationCase, obligationSet: obligations, catalog: emptyCatalog });
    const canonical = plan.routes.find((entry) => entry.responsibility.kind === "canonical_record");
    expect(canonical).toMatchObject({ locatorState: "open_web_fallback", unresolvedLocatorReason: "trusted_locator_unavailable", route: { locator: { kind: "open_web" } } });
    expect(canonical).not.toHaveProperty("catalogEntryId");
  });

  it("removes first-party discovery intent from an independent fallback query", () => {
    const localCase = structuredClone(investigationCase);
    localCase.discoveryPlan.targets.forEach((target) => {
      target.documentKinds = ["official_announcement"];
      target.queries = ["Example Agency affected products official announcement", "Example Agency affected products press release"];
    });
    const plan = buildSourceAwareAcquisitionPlan({
      bundle,
      investigationCase: localCase,
      obligationSet: obligations,
      catalog: { version: 1, entries: [] },
    });
    const canonical = plan.routes.find((entry) => entry.responsibility.kind === "canonical_record");
    const independent = plan.routes.find((entry) => entry.responsibility.kind === "independent_corroboration");
    expect(canonical?.queryPortfolio[0]).toContain("official announcement");
    expect(independent?.queryPortfolio[0]).toBe("Example Agency affected products");
    expect(independent?.queryPortfolio.join(" ")).not.toMatch(/official announcement|press release/iu);
  });

  it("rejects catalog entries that are not human reviewed", () => {
    const invalid = catalog();
    invalid.entries[0].provenance = "case_plan" as never;
    expect(validateInvestigationTrustedLocatorCatalog(invalid)).toContain("entries[0]: invalid provenance");
  });

  it("does not route through a suspended catalog entry", () => {
    const suspended = catalog();
    suspended.entries[0].status = "suspended";
    const plan = buildSourceAwareAcquisitionPlan({ bundle, investigationCase, obligationSet: obligations, catalog: suspended });
    expect(plan.routes.find((entry) => entry.responsibility.kind === "canonical_record")).toMatchObject({
      locatorState: "open_web_fallback",
      unresolvedLocatorReason: "trusted_locator_unavailable",
    });
  });

  it("rejects catalog review windows that do not advance", () => {
    const invalid = catalog();
    invalid.entries[0].reviewDueAt = invalid.entries[0].reviewedAt;
    expect(validateInvestigationTrustedLocatorCatalog(invalid)).toContain("entries[0]: invalid review lifecycle");
  });

  it("does not match a reviewed locator from the wrong source family", () => {
    const mismatched = catalog();
    mismatched.entries[0].sourceFamily = "independent_reporting";
    const plan = buildSourceAwareAcquisitionPlan({ bundle, investigationCase, obligationSet: obligations, catalog: mismatched });
    expect(plan.routes.find((entry) => entry.responsibility.kind === "canonical_record")).toMatchObject({
      locatorState: "open_web_fallback",
      unresolvedLocatorReason: "trusted_locator_unavailable",
    });
  });
});
