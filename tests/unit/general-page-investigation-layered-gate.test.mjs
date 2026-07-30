import { describe, expect, it } from "vitest";

import {
  evaluateLayeredInvestigationGate,
} from "../../scripts/lib/general-page-investigation-layered-gate.mjs";

function selected(maxAllowedTier = "primary", overrides = {}) {
  return {
    acceptable: true,
    hardUnacceptable: false,
    userUnacceptable: false,
    exactGrounding: true,
    scopeFidelity: true,
    residueDerived: false,
    handoffComplete: true,
    cueVisible: maxAllowedTier === "exploratory",
    maxAllowedTier,
    ...overrides,
  };
}

function cohort() {
  const rows = [];
  for (let index = 0; index < 24; index += 1) {
    rows.push({
      id: `news-action-${index}`,
      category: "news",
      sourceExpectation: "actionable",
      exploratoryOnly: false,
      displayedActionCount: index < 20 ? 1 : 0,
      selected: index < 20 ? selected() : null,
    });
  }
  for (let index = 0; index < 6; index += 1) {
    rows.push({
      id: `news-none-${index}`,
      category: "news",
      sourceExpectation: "none",
      exploratoryOnly: false,
      displayedActionCount: 0,
      selected: null,
    });
  }
  for (let index = 0; index < 18; index += 1) {
    const exploratoryOnly = index < 10;
    rows.push({
      id: `general-action-${index}`,
      category: "general",
      sourceExpectation: "actionable",
      exploratoryOnly,
      displayedActionCount: index < 11 ? 1 : 0,
      selected: index < 11
        ? selected(exploratoryOnly ? "exploratory" : "primary")
        : null,
    });
  }
  for (let index = 0; index < 12; index += 1) {
    rows.push({
      id: `general-none-${index}`,
      category: "general",
      sourceExpectation: "none",
      exploratoryOnly: false,
      displayedActionCount: 0,
      selected: null,
    });
  }
  return rows;
}

describe("General Page layered Gate B/C contract", () => {
  it("passes fixed source denominators, product coverage, cues, and hard boundaries", () => {
    const result = evaluateLayeredInvestigationGate({
      rows: cohort(),
      blindNonRegressionPass: true,
      providerCompatibilityPass: true,
      serviceProfilePass: true,
    });

    expect(result).toMatchObject({
      passed: true,
      metrics: {
        news: { total: 30, actionable: 24, none: 6, acceptableDisplayed: 20 },
        general: { total: 30, actionable: 18, none: 12, acceptableDisplayed: 11 },
        exploratoryOnly: { total: 10, cueVisible: 10 },
        tierOverstatement: 0,
      },
      gates: {
        newsCoverage: { pass: true },
        generalCoverage: { pass: true },
        exploratoryCueCoverage: { pass: true },
      },
      errors: [],
    });
  });

  it("rejects denominator collapse even when easy rows have perfect recall", () => {
    const rows = cohort();
    for (const row of rows.filter(({ category }) => category === "news").slice(0, 5)) {
      row.sourceExpectation = "none";
      row.displayedActionCount = 0;
      row.selected = null;
    }
    for (const row of rows.filter(({ exploratoryOnly }) => exploratoryOnly).slice(0, 2)) {
      row.exploratoryOnly = false;
    }

    const result = evaluateLayeredInvestigationGate({
      rows,
      blindNonRegressionPass: true,
      providerCompatibilityPass: true,
      serviceProfilePass: true,
    });

    expect(result.passed).toBe(false);
    expect(result.errors).toEqual(expect.arrayContaining([
      "news actionable source stratum requires at least 20 rows",
      "exploratory-only source stratum requires at least 9 rows",
    ]));
  });

  it("keeps unacceptable output, expected-none visibility, and scope defects at zero tolerance", () => {
    const rows = cohort();
    rows[0].selected = selected("primary", { userUnacceptable: true });
    rows[24].displayedActionCount = 1;
    rows[24].selected = selected("primary");
    rows[31].selected = selected("exploratory", { scopeFidelity: false });

    const result = evaluateLayeredInvestigationGate({
      rows,
      blindNonRegressionPass: true,
      providerCompatibilityPass: true,
      serviceProfilePass: true,
    });

    expect(result.passed).toBe(false);
    expect(result.gates).toMatchObject({
      userAcceptability: { pass: false },
      expectedNoneVisibility: { pass: false },
      scopeFidelity: { pass: false },
    });
  });

  it("rejects widened batches even when the first selected action is acceptable", () => {
    const rows = cohort();
    rows[0].displayedActionCount = 2;

    const result = evaluateLayeredInvestigationGate({
      rows,
      blindNonRegressionPass: true,
      providerCompatibilityPass: true,
      serviceProfilePass: true,
    });

    expect(result.passed).toBe(false);
    expect(result.gates.atomicDisplay).toMatchObject({ pass: false });
  });

  it("reports tier overstatement diagnostically but enforces the cue coverage floor", () => {
    const passingRows = cohort();
    for (const row of passingRows.filter(({ exploratoryOnly }) => exploratoryOnly).slice(0, 4)) {
      row.selected = selected("exploratory", {
        cueVisible: false,
        maxAllowedTier: "exploratory",
      });
    }
    const passing = evaluateLayeredInvestigationGate({
      rows: passingRows,
      blindNonRegressionPass: true,
      providerCompatibilityPass: true,
      serviceProfilePass: true,
    });
    expect(passing.passed).toBe(true);
    expect(passing.metrics.tierOverstatement).toBe(4);

    const failingRows = cohort();
    for (const row of failingRows.filter(({ exploratoryOnly }) => exploratoryOnly).slice(0, 5)) {
      row.selected = selected("exploratory", {
        cueVisible: false,
        maxAllowedTier: "exploratory",
      });
    }
    const failing = evaluateLayeredInvestigationGate({
      rows: failingRows,
      blindNonRegressionPass: true,
      providerCompatibilityPass: true,
      serviceProfilePass: true,
    });
    expect(failing.passed).toBe(false);
    expect(failing.gates.exploratoryCueCoverage).toMatchObject({
      pass: false,
      result: 0.5,
      minimum: 0.6,
    });
  });

  it("keeps blind non-regression and provider service gates independent", () => {
    const result = evaluateLayeredInvestigationGate({
      rows: cohort(),
      blindNonRegressionPass: false,
      providerCompatibilityPass: false,
      serviceProfilePass: false,
    });
    expect(result.passed).toBe(false);
    expect(result.gates).toMatchObject({
      blindNonRegression: { pass: false },
      providerCompatibility: { pass: false },
      serviceProfile: { pass: false },
    });
  });
});
