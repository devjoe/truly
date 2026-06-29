const VALID_ROLES = new Set([
  "runtime-baseline",
  "article-extraction",
  "context-extraction",
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
  }));
}

export function summarizeThresholds(results) {
  const failures = [];
  for (const fixture of results) {
    for (const engine of fixture.engines) {
      if (engine.threshold?.pass)
        continue;
      failures.push({
        fixtureId: fixture.id,
        engine: engine.engine,
        failures: engine.threshold?.failures ?? ["missing-threshold-result"],
      });
    }
  }
  return {
    pass: failures.length === 0,
    failureCount: failures.length,
    failures,
  };
}
