#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { performance } from "node:perf_hooks";
import { Readability, isProbablyReaderable } from "@mozilla/readability";
import { JSDOM } from "jsdom";
import { Defuddle } from "defuddle/node";

const FIXTURE_DIR = "tests/fixtures/general-pages";
const MANIFEST_PATH = path.join(FIXTURE_DIR, "manifest.json");
const OUTPUT_DIR = "tmp/parser-spikes";
const REPORT_DATE = process.env.TRULY_PARSER_SPIKE_DATE ?? new Date().toISOString().slice(0, 10);
const REPORT_PATH = path.join(OUTPUT_DIR, `general-page-parser-spike-${REPORT_DATE}.json`);

const manifest = readManifest();
const fixtures = manifest.fixtures.map(normalizeFixture);

function readFixture(file) {
  return fs.readFileSync(path.join(FIXTURE_DIR, file), "utf8");
}

function readManifest() {
  const raw = fs.readFileSync(MANIFEST_PATH, "utf8");
  const parsed = JSON.parse(raw);
  if (parsed.schemaVersion !== 1)
    throw new Error(`Unsupported fixture manifest schema: ${parsed.schemaVersion}`);
  if (!Array.isArray(parsed.fixtures) || parsed.fixtures.length === 0)
    throw new Error("Fixture manifest must include at least one fixture.");
  return parsed;
}

function normalizeFixture(fixture) {
  if (!fixture.id || !fixture.file || !fixture.url)
    throw new Error(`Invalid fixture entry: ${JSON.stringify(fixture)}`);
  if (fixture.synthetic !== true)
    throw new Error(`Fixture ${fixture.id} must be explicitly marked synthetic.`);
  if (!fs.existsSync(path.join(FIXTURE_DIR, fixture.file)))
    throw new Error(`Fixture file does not exist: ${fixture.file}`);

  const expected = fixture.expected ?? {};
  const thresholds = {
    ...manifest.defaults?.thresholds,
    ...fixture.thresholds,
  };
  return {
    ...fixture,
    expectedContains: expected.contains ?? [],
    expectedExcludes: expected.excludes ?? [],
    thresholds: {
      minContainsScore: thresholds.minContainsScore ?? 1,
      maxLeakCount: thresholds.maxLeakCount ?? 0,
      maxDurationMs: thresholds.maxDurationMs ?? Number.POSITIVE_INFINITY,
    },
  };
}

function domFor(html, url) {
  return new JSDOM(html, { url });
}

function normalizeText(value) {
  return String(value ?? "")
    .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function scoreText(text, fixture) {
  const containsHits = fixture.expectedContains.filter((item) => text.includes(item));
  const excludeLeaks = fixture.expectedExcludes.filter((item) => text.includes(item));
  return {
    containsHits,
    excludeLeaks,
    containsScore: fixture.expectedContains.length === 0
      ? 1
      : containsHits.length / fixture.expectedContains.length,
    leakCount: excludeLeaks.length,
  };
}

function evaluateThresholds(engineResult, fixture) {
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

function resultSummary(raw) {
  const text = normalizeText(raw.textContent ?? raw.contentMarkdown ?? raw.content ?? "");
  return {
    ok: Boolean(text),
    title: raw.title || undefined,
    author: raw.byline ?? raw.author ?? undefined,
    siteName: raw.siteName ?? raw.site ?? undefined,
    publishedAt: raw.publishedTime ?? raw.published ?? undefined,
    textLength: text.length,
    excerpt: normalizeText(raw.excerpt ?? raw.description ?? "").slice(0, 240) || undefined,
    textPreview: text.slice(0, 320),
    text,
  };
}

function parseReadability(html, fixture) {
  const dom = domFor(html, fixture.url);
  const clone = dom.window.document.cloneNode(true);
  const start = performance.now();
  const readerable = isProbablyReaderable(clone, {
    minContentLength: 80,
    minScore: 10,
  });
  const article = new Readability(clone, {
    charThreshold: 80,
  }).parse();
  const durationMs = performance.now() - start;
  const summary = article
    ? resultSummary(article)
    : { ok: false, textLength: 0, textPreview: "", text: "" };
  return {
    engine: "readability",
    durationMs: Number(durationMs.toFixed(2)),
    readerable,
    ...withoutRawText(summary),
    score: scoreText(summary.text, fixture),
  };
}

async function parseDefuddle(html, fixture, options = {}) {
  const dom = domFor(html, fixture.url);
  const start = performance.now();
  const result = await Defuddle(dom.window.document, fixture.url, {
    useAsync: false,
    ...options,
  });
  const durationMs = performance.now() - start;
  const summary = resultSummary(result ?? {});
  return {
    engine: options.markdown ? "defuddle-markdown" : "defuddle",
    durationMs: Number(durationMs.toFixed(2)),
    ...withoutRawText(summary),
    wordCount: result?.wordCount,
    score: scoreText(summary.text, fixture),
  };
}

function withoutRawText(summary) {
  const { text: _text, ...rest } = summary;
  return rest;
}

async function main() {
  const results = [];
  for (const fixture of fixtures) {
    const html = readFixture(fixture.file);
    const engineResults = [];
    for (const candidate of [
      { engine: "readability", parse: () => parseReadability(html, fixture) },
      { engine: "defuddle", parse: () => parseDefuddle(html, fixture) },
      { engine: "defuddle-markdown", parse: () => parseDefuddle(html, fixture, { markdown: true }) },
    ]) {
      try {
        const result = await candidate.parse();
        engineResults.push({
          ...result,
          threshold: evaluateThresholds(result, fixture),
        });
      } catch (error) {
        const result = {
          engine: candidate.engine,
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        };
        engineResults.push({
          ...result,
          threshold: evaluateThresholds(result, fixture),
        });
      }
    }
    results.push({
      id: fixture.id,
      file: fixture.file,
      url: fixture.url,
      locale: fixture.locale,
      pageType: fixture.pageType,
      patterns: fixture.patterns,
      synthetic: fixture.synthetic,
      expectedContains: fixture.expectedContains,
      expectedExcludes: fixture.expectedExcludes,
      thresholds: fixture.thresholds,
      engines: engineResults,
    });
  }

  const report = {
    generatedAt: new Date().toISOString(),
    candidates: {
      readability: {
        package: "@mozilla/readability",
        version: "0.6.0",
        license: "Apache-2.0",
      },
      defuddle: {
        package: "defuddle",
        version: "0.19.1",
        license: "MIT",
      },
    },
    fixtureCount: fixtures.length,
    results,
    summary: summarize(results),
    threshold: summarizeThresholds(results),
  };

  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  fs.writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`);
  printSummary(report);
  if (!report.threshold.pass)
    process.exitCode = 1;
}

function summarize(results) {
  const byEngine = new Map();
  for (const fixture of results) {
    for (const engine of fixture.engines) {
      const current = byEngine.get(engine.engine) ?? {
        engine: engine.engine,
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
    okCount: item.okCount,
    fixtureCount: item.parsedFixtures,
    averageContainsScore: Number((item.totalContainsScore / item.parsedFixtures).toFixed(3)),
    totalLeaks: item.totalLeaks,
    averageDurationMs: Number((item.totalDurationMs / item.parsedFixtures).toFixed(2)),
    errors: item.errors,
    thresholdPassCount: item.thresholdPassCount,
  }));
}

function summarizeThresholds(results) {
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

function printSummary(report) {
  console.log(`Wrote ${REPORT_PATH}`);
  for (const item of report.summary) {
    console.log(
      `${item.engine}: ok ${item.okCount}/${item.fixtureCount}, ` +
      `contains ${item.averageContainsScore}, leaks ${item.totalLeaks}, ` +
      `avg ${item.averageDurationMs}ms, errors ${item.errors}, ` +
      `threshold ${item.thresholdPassCount}/${item.fixtureCount}`,
    );
  }
  if (report.threshold.pass) {
    console.log("threshold: pass");
  } else {
    console.error(`threshold: fail (${report.threshold.failureCount})`);
    for (const failure of report.threshold.failures) {
      console.error(
        `${failure.engine}/${failure.fixtureId}: ${failure.failures.join("; ")}`,
      );
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
