import { describe, expect, it } from "vitest";
import {
  summarizeInvestigationLocatorKinds,
  validateInvestigationAcquisitionPortfolio,
  validateInvestigationRouteReceipt,
  validateInvestigationSourceRouteLedger,
  type InvestigationRouteReceipt,
  type InvestigationSourceRouteLedger,
} from "../../src/lib/investigation-source-route";
import type { InvestigationObligationSet } from "../../src/lib/claim-investigation-obligations";

function ledger(): InvestigationSourceRouteLedger {
  return {
    version: 2,
    caseId: "case:food-recall",
    routes: [{
      version: 2,
      id: "route:food-recall:1",
      caseId: "case:food-recall",
      obligationIds: ["obligation:food-recall:answer"],
      routeFamily: "canonical_record",
      sourceFamily: "official_record",
      fallback: false,
      hypothesis: "The regulator publishes a canonical recall list.",
      hypothesisConfidence: "medium",
      hypothesisProvenance: "human_reviewed_source",
      entityTerms: [{ value: "232 products", provenance: "claim_text" }],
      institutionTerms: [{ value: "food regulator", provenance: "human_reviewed_source", sourceRef: "review:route:1" }],
      requiredSourceRoles: ["primary"],
      expectedDocumentKinds: ["official_record"],
      locator: { kind: "domain_index", domain: "agency.example", query: "232 products recall list" },
      budget: { maxQueries: 2, maxDocuments: 3, maxBytes: 2_000_000, maxDurationMs: 30_000 },
    }],
  };
}

function obligations(): InvestigationObligationSet {
  return {
    version: 2,
    caseId: "case:food-recall",
    obligations: [{
      version: 2,
      id: "obligation:food-recall:answer",
      type: "answering_evidence",
      questionId: "question:food-recall",
      mandatory: true,
      requiredFacets: ["actor", "predicate", "object"],
      acceptedSourceRoles: ["primary"],
      recordScope: "record_content",
    }],
  };
}

function receipt(): InvestigationRouteReceipt {
  return {
    version: 2,
    routeId: "route:food-recall:1",
    obligationIds: ["obligation:food-recall:answer"],
    queriesAttempted: 1,
    documentsConsidered: 2,
    documentsFetched: 1,
    bytesFetched: 20_000,
    durationMs: 2_000,
    coveredSourceFamilies: ["official_record"],
    languages: ["en"],
    observedOriginKeys: ["origin:agency"],
    unresolvedBlindSpots: [],
    stopReason: "document_families_exhausted",
    completedAt: "2026-07-15T00:00:00Z",
    evidenceProduced: false,
    verdictProduced: false,
  };
}

describe("investigation source-route ledger", () => {
  it("accepts a bounded fixed locator and reports its primitive", () => {
    expect(validateInvestigationSourceRouteLedger(ledger())).toEqual([]);
    expect(summarizeInvestigationLocatorKinds(ledger())).toEqual({ direct_url: 0, registry_record: 0, domain_index: 1, open_web: 0 });
  });

  it("requires only the route families implied by mandatory obligations", () => {
    expect(validateInvestigationAcquisitionPortfolio({ ledger: ledger(), obligationSet: obligations() })).toEqual([]);
    const contextualOnly = ledger();
    contextualOnly.routes[0].routeFamily = "contextual_discovery";
    expect(validateInvestigationAcquisitionPortfolio({ ledger: contextualOnly, obligationSet: obligations() })).toContain(
      "canonical obligation obligation:food-recall:answer requires a canonical-record route",
    );
  });

  it("records bounded stopping work without producing evidence or a verdict", () => {
    expect(validateInvestigationRouteReceipt(receipt(), ledger().routes[0])).toEqual([]);
    expect(validateInvestigationAcquisitionPortfolio({ ledger: ledger(), obligationSet: obligations(), receipts: [receipt()] })).toEqual([]);
    expect({ ...receipt(), evidenceProduced: true } satisfies Record<string, unknown>).toMatchObject({ evidenceProduced: true });
    expect(validateInvestigationRouteReceipt({ ...receipt(), evidenceProduced: true } as unknown as InvestigationRouteReceipt, ledger().routes[0])).toContain("invalid receipt boundary");
  });

  it("rejects invented metadata provenance and search-engine instructions", () => {
    const invalid = ledger();
    invalid.routes[0].institutionTerms[0].sourceRef = undefined;
    invalid.routes[0].locator = { kind: "open_web", query: "search on Google for 232 products" };
    expect(validateInvestigationSourceRouteLedger(invalid)).toEqual([
      "routes[0]: invalid route terms",
      "routes[0]: invalid locator or budget",
    ]);
  });

  it("does not reject Google when the company or product is the subject", () => {
    const valid = ledger();
    valid.routes[0].locator = { kind: "open_web", query: "Google Search publisher priority feature BBC 2026" };
    expect(validateInvestigationSourceRouteLedger(valid)).toEqual([]);
  });
});
