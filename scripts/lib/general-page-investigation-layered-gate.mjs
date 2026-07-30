const CATEGORY_COUNTS = Object.freeze({ news: 30, general: 30 });
const MINIMUM_STRATA = Object.freeze({
  newsActionable: 20,
  generalActionable: 15,
  exploratoryOnly: 9,
  newsNone: 5,
  generalNone: 5,
});
const COVERAGE_FLOORS = Object.freeze({
  news: 0.8,
  general: 0.6,
  exploratoryCue: 0.6,
});

function ratio(numerator, denominator) {
  return denominator > 0 ? numerator / denominator : 0;
}

function gate(pass, extra = {}) {
  return { pass, ...extra };
}

function assertEnvelope(input) {
  if (!input || !Array.isArray(input.rows)) {
    throw new TypeError("layered gate requires rows");
  }
  if (input.rows.length !== 60) {
    throw new TypeError("layered gate requires exactly 60 rows");
  }
  const ids = new Set();
  for (const row of input.rows) {
    if (!row || typeof row.id !== "string" || !row.id || ids.has(row.id)) {
      throw new TypeError("layered gate requires unique row IDs");
    }
    ids.add(row.id);
    if (!Object.hasOwn(CATEGORY_COUNTS, row.category) ||
        !["actionable", "none"].includes(row.sourceExpectation) ||
        !Number.isInteger(row.displayedActionCount) ||
        row.displayedActionCount < 0 ||
        Boolean(row.selected) !== (row.displayedActionCount > 0) ||
        typeof row.exploratoryOnly !== "boolean" ||
        (row.exploratoryOnly && row.sourceExpectation !== "actionable")) {
      throw new TypeError(`invalid layered gate row: ${row.id}`);
    }
  }
}

/**
 * Evaluates the product-facing Page investigation contract. Source expectation
 * belongs to the complete authorized source context, not to the candidate
 * builder's output, so missing candidates remain visible as coverage misses.
 */
export function evaluateLayeredInvestigationGate(input) {
  assertEnvelope(input);
  const errors = [];
  const byCategory = Object.fromEntries(
    Object.keys(CATEGORY_COUNTS).map((category) => [
      category,
      input.rows.filter((row) => row.category === category),
    ]),
  );
  for (const [category, expected] of Object.entries(CATEGORY_COUNTS)) {
    if (byCategory[category].length !== expected) {
      errors.push(`${category} category requires exactly ${expected} rows`);
    }
  }

  const categoryMetrics = {};
  for (const [category, rows] of Object.entries(byCategory)) {
    const actionable = rows.filter(({ sourceExpectation }) =>
      sourceExpectation === "actionable"
    );
    const none = rows.filter(({ sourceExpectation }) =>
      sourceExpectation === "none"
    );
    const acceptableDisplayed = actionable.filter(({ selected }) =>
      selected?.acceptable === true &&
      selected.hardUnacceptable !== true &&
      selected.userUnacceptable !== true
    ).length;
    categoryMetrics[category] = {
      total: rows.length,
      actionable: actionable.length,
      none: none.length,
      acceptableDisplayed,
      coverage: ratio(acceptableDisplayed, actionable.length),
    };
  }

  const exploratoryRows = input.rows.filter(({ exploratoryOnly }) =>
    exploratoryOnly
  );
  const cueVisible = exploratoryRows.filter(({ selected }) =>
    selected?.acceptable === true && selected.cueVisible === true
  ).length;
  const tierOverstatement = input.rows.filter(({ selected }) =>
    selected?.maxAllowedTier === "exploratory" &&
    selected.cueVisible !== true
  ).length;
  const selectedRows = input.rows.filter(({ selected }) => selected);

  if (categoryMetrics.news.actionable < MINIMUM_STRATA.newsActionable) {
    errors.push(
      `news actionable source stratum requires at least ${MINIMUM_STRATA.newsActionable} rows`,
    );
  }
  if (categoryMetrics.general.actionable < MINIMUM_STRATA.generalActionable) {
    errors.push(
      `general actionable source stratum requires at least ${MINIMUM_STRATA.generalActionable} rows`,
    );
  }
  if (exploratoryRows.length < MINIMUM_STRATA.exploratoryOnly) {
    errors.push(
      `exploratory-only source stratum requires at least ${MINIMUM_STRATA.exploratoryOnly} rows`,
    );
  }
  if (categoryMetrics.news.none < MINIMUM_STRATA.newsNone) {
    errors.push(`news expected-none stratum requires at least ${MINIMUM_STRATA.newsNone} rows`);
  }
  if (categoryMetrics.general.none < MINIMUM_STRATA.generalNone) {
    errors.push(`general expected-none stratum requires at least ${MINIMUM_STRATA.generalNone} rows`);
  }

  const newsCoverage = gate(
    categoryMetrics.news.coverage >= COVERAGE_FLOORS.news,
    { result: categoryMetrics.news.coverage, minimum: COVERAGE_FLOORS.news },
  );
  const generalCoverage = gate(
    categoryMetrics.general.coverage >= COVERAGE_FLOORS.general,
    { result: categoryMetrics.general.coverage, minimum: COVERAGE_FLOORS.general },
  );
  const exploratoryCueCoverage = gate(
    ratio(cueVisible, exploratoryRows.length) >= COVERAGE_FLOORS.exploratoryCue,
    {
      result: ratio(cueVisible, exploratoryRows.length),
      minimum: COVERAGE_FLOORS.exploratoryCue,
    },
  );
  const hardAcceptability = gate(
    selectedRows.every(({ selected }) => selected.hardUnacceptable === false),
  );
  const userAcceptability = gate(
    selectedRows.every(({ selected }) =>
      selected.acceptable === true && selected.userUnacceptable === false
    ),
  );
  const expectedNoneVisibility = gate(
    input.rows.every(({ sourceExpectation, selected }) =>
      sourceExpectation !== "none" || selected == null
    ),
  );
  const exactGrounding = gate(
    selectedRows.every(({ selected }) => selected.exactGrounding === true),
  );
  const scopeFidelity = gate(
    selectedRows.every(({ selected }) => selected.scopeFidelity === true),
  );
  const residue = gate(
    selectedRows.every(({ selected }) => selected.residueDerived === false),
  );
  const handoff = gate(
    selectedRows.every(({ selected }) => selected.handoffComplete === true),
  );
  const atomicDisplay = gate(
    input.rows.every(({ displayedActionCount }) => displayedActionCount <= 1),
  );

  const gates = {
    hardAcceptability,
    userAcceptability,
    expectedNoneVisibility,
    exactGrounding,
    scopeFidelity,
    residue,
    handoff,
    atomicDisplay,
    newsCoverage,
    generalCoverage,
    exploratoryCueCoverage,
    blindNonRegression: gate(input.blindNonRegressionPass === true),
    providerCompatibility: gate(input.providerCompatibilityPass === true),
    serviceProfile: gate(input.serviceProfilePass === true),
  };
  for (const [name, value] of Object.entries(gates)) {
    if (!value.pass) errors.push(`${name} gate failed`);
  }

  return {
    schemaVersion: 1,
    passed: errors.length === 0,
    metrics: {
      news: categoryMetrics.news,
      general: categoryMetrics.general,
      exploratoryOnly: {
        total: exploratoryRows.length,
        cueVisible,
        coverage: ratio(cueVisible, exploratoryRows.length),
      },
      tierOverstatement,
    },
    gates,
    errors,
  };
}
