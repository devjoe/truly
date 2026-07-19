import { describe, expect, it } from "vitest";
import bundleFixture from "../fixtures/claim-investigation/food-recall-contract.json";
import caseFixture from "../fixtures/claim-investigation/food-recall-case.json";
import type { InvestigationBundle } from "../../src/lib/claim-investigation-contract";
import type { InvestigationCase } from "../../src/lib/claim-investigation-case";
import { validateInvestigationCase } from "../../src/lib/claim-investigation-case";

function fixtures(): { bundle: InvestigationBundle; investigationCase: InvestigationCase } {
  return {
    bundle: structuredClone(bundleFixture) as InvestigationBundle,
    investigationCase: structuredClone(caseFixture) as InvestigationCase,
  };
}

describe("case-level investigation discovery contract", () => {
  it("allows one document-discovery target to cover several atomic questions", () => {
    const { bundle, investigationCase } = fixtures();
    expect(investigationCase.discoveryPlan.targets[0].questionIds).toHaveLength(3);
    expect(investigationCase.discoveryPlan.targets[0].queries).toHaveLength(2);
    expect(validateInvestigationCase(investigationCase, bundle)).toEqual({ ok: true });
  });

  it("requires a verification requirement and discovery target for every case question", () => {
    const { bundle, investigationCase } = fixtures();
    investigationCase.requirements = investigationCase.requirements.slice(0, 2);
    investigationCase.discoveryPlan.targets.forEach((target) => {
      target.questionIds = target.questionIds.filter((id) => id !== "question:list-scope");
    });

    const result = validateInvestigationCase(investigationCase, bundle);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: "case.requirements", code: "missing_value" }),
      expect.objectContaining({ path: "case.discoveryPlan.targets", code: "missing_value" }),
    ]));
  });

  it("rejects search-engine instructions and private-record discovery queries", () => {
    const { bundle, investigationCase } = fixtures();
    investigationCase.discoveryPlan.targets[0].queries = [
      "search Google for Example Agency",
      "Example Agency patient records",
    ];

    const result = validateInvestigationCase(investigationCase, bundle);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues.filter((entry) => entry.path.includes(".queries"))).toHaveLength(2);
  });

  it("rejects verdict-seeking queries and fallback-only question coverage", () => {
    const { bundle, investigationCase } = fixtures();
    investigationCase.discoveryPlan.targets[0].queries = ["Example Agency product count fact check"];
    investigationCase.discoveryPlan.targets[0].questionIds = ["question:notice-identity"];

    const result = validateInvestigationCase(investigationCase, bundle);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: "case.discoveryPlan.targets[0].queries[0]", code: "invalid_value" }),
      expect.objectContaining({ path: "case.discoveryPlan.targets", code: "missing_value" }),
    ]));
  });

  it("does not allow a discovery target to reference a question outside the case", () => {
    const { bundle, investigationCase } = fixtures();
    investigationCase.discoveryPlan.targets[0].questionIds.push("question:outside");

    const result = validateInvestigationCase(investigationCase, bundle);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues).toContainEqual(expect.objectContaining({
      path: "case.discoveryPlan.targets[0].questionIds",
      code: "unknown_reference",
    }));
  });

  it("rejects unresolved query placeholders and generic use of legal rulings", () => {
    const { bundle, investigationCase } = fixtures();
    investigationCase.discoveryPlan.targets[0].queries = [
      "Example Agency notice [year prior to article date]",
      "Example Agency decision 3 days ago",
    ];
    investigationCase.discoveryPlan.targets[0].documentKinds = ["ruling"];

    const result = validateInvestigationCase(investigationCase, bundle);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: "case.discoveryPlan.targets[0].queries[0]", code: "invalid_value" }),
      expect.objectContaining({ path: "case.discoveryPlan.targets[0].queries[1]", code: "invalid_value" }),
      expect.objectContaining({ path: "case.discoveryPlan.targets[0].documentKinds", code: "invalid_value" }),
    ]));
  });
});
