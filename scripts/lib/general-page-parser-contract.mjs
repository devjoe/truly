const VALID_ROLES = new Set([
  "runtime-baseline",
  "article-extraction",
  "context-extraction",
]);

const NON_ARTICLE_PAGE_TYPES = new Set([
  "bad-page",
  "blocked",
  "forum-thread",
  "list-index",
  "social-public-page",
]);

/**
 * @typedef {Object} GeneralPageParserCandidate
 * @property {string} id Stable candidate id used in reports.
 * @property {string} label Human-readable candidate label.
 * @property {"runtime-baseline" | "article-extraction" | "context-extraction"} role
 * @property {string} packageName Package or source name.
 * @property {string} packageVersion Package or source version.
 * @property {string} license License that must be preserved if adopted.
 * @property {(input: { html: string, fixture: object }) => Promise<object> | object} parse
 */

/**
 * @typedef {Object} GeneralPageParserResult
 * @property {string} engine Candidate id.
 * @property {string} label Candidate label.
 * @property {"runtime-baseline" | "article-extraction" | "context-extraction"} role
 * @property {string} package Package or source name.
 * @property {string} version Package or source version.
 * @property {string} license License.
 * @property {boolean} ok Whether the candidate produced usable text.
 * @property {number=} durationMs Extraction duration.
 * @property {object=} diagnostics Candidate-specific diagnostics.
 */

export function defineParserCandidate(candidate) {
  if (!candidate || typeof candidate !== "object")
    throw new Error("Parser candidate must be an object.");
  if (!candidate.id || typeof candidate.id !== "string")
    throw new Error("Parser candidate must include a string id.");
  if (!candidate.label || typeof candidate.label !== "string")
    throw new Error(`Parser candidate ${candidate.id} must include a string label.`);
  if (!VALID_ROLES.has(candidate.role)) {
    throw new Error(
      `Parser candidate ${candidate.id} must use one of these roles: ${[...VALID_ROLES].join(", ")}`,
    );
  }
  if (!candidate.packageName || typeof candidate.packageName !== "string") {
    throw new Error(
      `Parser candidate ${candidate.id} must include the package or source name.`,
    );
  }
  if (!candidate.packageVersion || typeof candidate.packageVersion !== "string") {
    throw new Error(
      `Parser candidate ${candidate.id} must include the package or source version.`,
    );
  }
  if (!candidate.license || typeof candidate.license !== "string")
    throw new Error(`Parser candidate ${candidate.id} must include a license.`);
  if (typeof candidate.parse !== "function")
    throw new Error(`Parser candidate ${candidate.id} must include a parse function.`);

  return Object.freeze({ ...candidate });
}

export function candidateManifest(candidates) {
  return Object.fromEntries(
    candidates.map((candidate) => [
      candidate.id,
      {
        label: candidate.label,
        role: candidate.role,
        package: candidate.packageName,
        version: candidate.packageVersion,
        license: candidate.license,
      },
    ]),
  );
}

export function normalizeParserResult(candidate, rawResult) {
  const result = rawResult ?? {};
  return {
    ...result,
    engine: candidate.id,
    label: candidate.label,
    role: candidate.role,
    package: candidate.packageName,
    version: candidate.packageVersion,
    license: candidate.license,
    ok: Boolean(result.ok),
    diagnostics: result.diagnostics ?? {},
  };
}

export function normalizeParserError(candidate, error) {
  return normalizeParserResult(candidate, {
    ok: false,
    error: error instanceof Error ? error.message : String(error),
  });
}

export function evaluateThresholds(engineResult, fixture) {
  const failures = [];
  const score = engineResult.score ?? {
    containsScore: 0,
    leakCount: Number.POSITIVE_INFINITY,
  };

  if (!engineResult.ok)
    failures.push("empty-result");
  if (engineResult.error)
    failures.push("parser-error");
  if (score.containsScore < fixture.thresholds.minContainsScore) {
    failures.push(
      `contains-score ${score.containsScore} < ${fixture.thresholds.minContainsScore}`,
    );
  }
  if (score.leakCount > fixture.thresholds.maxLeakCount) {
    failures.push(
      `leak-count ${score.leakCount} > ${fixture.thresholds.maxLeakCount}`,
    );
  }
  if (
    typeof engineResult.durationMs === "number" &&
    engineResult.durationMs > fixture.thresholds.maxDurationMs
  ) {
    failures.push(
      `duration-ms ${engineResult.durationMs} > ${fixture.thresholds.maxDurationMs}`,
    );
  }

  return {
    pass: failures.length === 0,
    failures,
  };
}

export function evaluateSuitability(engineResult, fixture) {
  const metadata = evaluateMetadata(engineResult);
  const status = evaluateStatusSuitability(engineResult, fixture);
  const warnings = evaluateWarningSuitability(engineResult, fixture);
  const badPage = evaluateBadPageFalsePositive(engineResult, fixture);
  return {
    metadata,
    status,
    warnings,
    badPage,
  };
}

function evaluateMetadata(engineResult) {
  const fields = {
    title: Boolean(engineResult.title),
    author: Boolean(engineResult.author),
    siteName: Boolean(engineResult.siteName),
    publishedAt: Boolean(engineResult.publishedAt),
  };
  const present = Object.values(fields).filter(Boolean).length;
  const total = Object.keys(fields).length;
  return {
    fields,
    present,
    total,
    completeness: Number((present / total).toFixed(3)),
  };
}

function extractionStatus(engineResult) {
  return engineResult.extractionStatus
    ?? engineResult.diagnostics?.extraction?.status
    ?? null;
}

function extractionWarnings(engineResult) {
  const warnings = engineResult.extractionWarnings
    ?? engineResult.diagnostics?.extraction?.warnings
    ?? [];
  return Array.isArray(warnings) ? warnings : [];
}

function expectedStatusPolicy(fixture) {
  const explicitExpected = normalizeExpectedStatus(fixture.expectedStatus);
  if (explicitExpected.length > 0) {
    return {
      expected: explicitExpected,
      reason: "fixture declares an explicit expected extraction status",
    };
  }
  if (fixture.pageType === "blocked") {
    return {
      expected: ["blocked", "partial"],
      reason: "blocked/login/paywall-like pages should not be treated as fully complete",
    };
  }
  if (fixture.pageType === "bad-page") {
    return {
      expected: ["empty", "partial", "blocked"],
      reason: "bad or client-shell pages should avoid complete-article confidence",
    };
  }
  if (["forum-thread", "list-index", "social-public-page"].includes(fixture.pageType)) {
    return {
      expected: ["partial", "empty", "blocked"],
      reason: "non-article/feed-like pages should avoid complete-article confidence",
    };
  }
  return {
    expected: ["complete", "partial"],
    reason: "article-like pages should produce usable content",
  };
}

function normalizeExpectedStatus(value) {
  if (typeof value === "string")
    return [value];
  if (Array.isArray(value))
    return value.filter((item) => typeof item === "string");
  return [];
}

function evaluateStatusSuitability(engineResult, fixture) {
  const actual = extractionStatus(engineResult);
  const policy = expectedStatusPolicy(fixture);
  if (!actual) {
    return {
      applicable: false,
      expected: policy.expected,
      actual,
      pass: null,
      reason: "candidate does not report Truly extraction status",
    };
  }
  return {
    applicable: true,
    expected: policy.expected,
    actual,
    pass: policy.expected.includes(actual),
    reason: policy.reason,
  };
}

function expectedWarnings(fixture) {
  if (fixture.pageType === "blocked")
    return ["login-or-paywall-like"];
  if (fixture.pageType === "bad-page")
    return ["no-main-content", "dynamic-content-partial", "very-short-content"];
  if (["forum-thread", "list-index", "social-public-page"].includes(fixture.pageType))
    return ["no-main-content", "large-navigation-noise", "very-short-content"];
  return [];
}

function evaluateWarningSuitability(engineResult, fixture) {
  const actual = extractionWarnings(engineResult);
  const expectedAny = expectedWarnings(fixture);
  if (!expectedAny.length) {
    return {
      applicable: false,
      expectedAny,
      actual,
      pass: null,
      reason: "fixture does not require a specific warning family",
    };
  }
  if (!extractionStatus(engineResult)) {
    return {
      applicable: false,
      expectedAny,
      actual,
      pass: null,
      reason: "candidate does not report Truly extraction warnings",
    };
  }
  return {
    applicable: true,
    expectedAny,
    actual,
    pass: expectedAny.some((warning) => actual.includes(warning)),
    reason: "candidate should surface at least one warning suitable for this fixture family",
  };
}

function evaluateBadPageFalsePositive(engineResult, fixture) {
  if (!NON_ARTICLE_PAGE_TYPES.has(fixture.pageType)) {
    return {
      applicable: false,
      actualStatus: extractionStatus(engineResult),
      pass: null,
      reason: "fixture is not treated as a bad/non-article page",
    };
  }
  const actualStatus = extractionStatus(engineResult);
  if (!actualStatus) {
    return {
      applicable: false,
      actualStatus,
      pass: null,
      reason: "candidate does not report Truly extraction status",
    };
  }
  return {
    applicable: true,
    actualStatus,
    pass: actualStatus !== "complete",
    reason: "bad/non-article pages should not be reported as complete articles",
  };
}

export function summarizeParserResults(results) {
  const byEngine = new Map();
  for (const fixture of results) {
    for (const engine of fixture.engines) {
      const current = byEngine.get(engine.engine) ?? {
        engine: engine.engine,
        label: engine.label,
        role: engine.role,
        okCount: 0,
        totalContainsScore: 0,
        totalLeaks: 0,
        totalDurationMs: 0,
        parsedFixtures: 0,
        errors: 0,
        thresholdPassCount: 0,
        totalMetadataCompleteness: 0,
        statusApplicableCount: 0,
        statusPassCount: 0,
        warningApplicableCount: 0,
        warningPassCount: 0,
        badPageApplicableCount: 0,
        badPagePassCount: 0,
      };
      if (engine.ok)
        current.okCount += 1;
      if (engine.error)
        current.errors += 1;
      if (engine.score) {
        current.totalContainsScore += engine.score.containsScore;
        current.totalLeaks += engine.score.leakCount;
      }
      if (typeof engine.durationMs === "number")
        current.totalDurationMs += engine.durationMs;
      if (engine.threshold?.pass)
        current.thresholdPassCount += 1;
      if (engine.suitability?.metadata) {
        current.totalMetadataCompleteness += engine.suitability.metadata.completeness;
      }
      if (engine.suitability?.status?.applicable) {
        current.statusApplicableCount += 1;
        if (engine.suitability.status.pass)
          current.statusPassCount += 1;
      }
      if (engine.suitability?.warnings?.applicable) {
        current.warningApplicableCount += 1;
        if (engine.suitability.warnings.pass)
          current.warningPassCount += 1;
      }
      if (engine.suitability?.badPage?.applicable) {
        current.badPageApplicableCount += 1;
        if (engine.suitability.badPage.pass)
          current.badPagePassCount += 1;
      }
      current.parsedFixtures += 1;
      byEngine.set(engine.engine, current);
    }
  }
  return [...byEngine.values()].map((item) => ({
    engine: item.engine,
    label: item.label,
    role: item.role,
    okCount: item.okCount,
    fixtureCount: item.parsedFixtures,
    averageContainsScore: Number((item.totalContainsScore / item.parsedFixtures).toFixed(3)),
    totalLeaks: item.totalLeaks,
    averageDurationMs: Number((item.totalDurationMs / item.parsedFixtures).toFixed(2)),
    errors: item.errors,
    thresholdPassCount: item.thresholdPassCount,
    averageMetadataCompleteness: Number((item.totalMetadataCompleteness / item.parsedFixtures).toFixed(3)),
    statusPassCount: item.statusPassCount,
    statusApplicableCount: item.statusApplicableCount,
    warningPassCount: item.warningPassCount,
    warningApplicableCount: item.warningApplicableCount,
    badPagePassCount: item.badPagePassCount,
    badPageApplicableCount: item.badPageApplicableCount,
  }));
}

export function summarizeThresholds(results) {
  const failures = [];
  const nonBlockingFailures = [];
  for (const fixture of results) {
    for (const engine of fixture.engines) {
      if (engine.threshold?.pass)
        continue;
      const failure = {
        fixtureId: fixture.id,
        engine: engine.engine,
        role: engine.role,
        failures: engine.threshold?.failures ?? ["missing-threshold-result"],
      };
      if (engine.role === "runtime-baseline") {
        failures.push(failure);
      } else {
        nonBlockingFailures.push(failure);
      }
    }
  }
  return {
    pass: failures.length === 0,
    failureCount: failures.length,
    failures,
    gatedRole: "runtime-baseline",
    nonBlockingFailureCount: nonBlockingFailures.length,
    nonBlockingFailures,
  };
}

export function summarizeSuitability(results) {
  const failures = [];
  for (const fixture of results) {
    for (const engine of fixture.engines) {
      if (engine.role !== "runtime-baseline")
        continue;
      for (const key of ["status", "warnings", "badPage"]) {
        const item = engine.suitability?.[key];
        if (!item?.applicable || item.pass)
          continue;
        failures.push({
          fixtureId: fixture.id,
          pageType: fixture.pageType,
          engine: engine.engine,
          check: key,
          actual: item.actual ?? item.actualStatus ?? null,
          expected: item.expected ?? item.expectedAny ?? "not complete",
          reason: item.reason,
        });
      }
    }
  }
  return {
    pass: failures.length === 0,
    failureCount: failures.length,
    failures,
  };
}
