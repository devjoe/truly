#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { performance } from "node:perf_hooks";
import { Readability, isProbablyReaderable } from "@mozilla/readability";
import { JSDOM } from "jsdom";
import { Defuddle } from "defuddle/node";
import {
  candidateManifest,
  defineParserCandidate,
  evaluateSuitability,
  evaluateThresholds,
  normalizeParserError,
  normalizeParserResult,
  summarizeParserResults,
  summarizeSuitability,
  summarizeThresholds,
} from "./lib/general-page-parser-contract.mjs";
import { loadRuntimeGeneralPageExtractor } from "./lib/load-runtime-general-page-extractor.mjs";

const FIXTURE_DIR = "tests/fixtures/general-pages";
const MANIFEST_PATH = path.join(FIXTURE_DIR, "manifest.json");
const OUTPUT_DIR = "tmp/parser-spikes";
const REPORT_DATE = process.env.TRULY_PARSER_SPIKE_DATE ?? new Date().toISOString().slice(0, 10);
const REPORT_PATH = path.join(OUTPUT_DIR, `general-page-parser-spike-${REPORT_DATE}.json`);

const manifest = readManifest();
const fixtures = manifest.fixtures.map(normalizeFixture);
const candidates = [
  defineParserCandidate({
    id: "truly-heuristic",
    label: "Truly Heuristic",
    role: "runtime-baseline",
    packageName: "truly/src/lib/general-page-extraction",
    packageVersion: "runtime-source",
    license: "project-internal",
    parse: ({ html, fixture }) => parseTrulyHeuristic(html, fixture),
  }),
  defineParserCandidate({
    id: "readability",
    label: "Mozilla Readability",
    role: "article-extraction",
    packageName: "@mozilla/readability",
    packageVersion: "0.6.0",
    license: "Apache-2.0",
    parse: ({ html, fixture }) => parseReadability(html, fixture),
  }),
  defineParserCandidate({
    id: "defuddle",
    label: "Defuddle",
    role: "article-extraction",
    packageName: "defuddle",
    packageVersion: "0.19.1",
    license: "MIT",
    parse: ({ html, fixture }) => parseDefuddle(html, fixture),
  }),
  defineParserCandidate({
    id: "defuddle-markdown",
    label: "Defuddle Markdown",
    role: "context-extraction",
    packageName: "defuddle",
    packageVersion: "0.19.1",
    license: "MIT",
    parse: ({ html, fixture }) => parseDefuddle(html, fixture, { markdown: true }),
  }),
];

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

async function parseTrulyHeuristic(html, fixture) {
  const { extractGeneralPageSurface } = await loadRuntimeGeneralPageExtractor();
  const dom = domFor(html, fixture.url);
  const start = performance.now();
  const surface = extractGeneralPageSurface({
    document: dom.window.document,
    url: fixture.url,
  });
  const durationMs = performance.now() - start;
  const text = normalizeText(surface.mainText ?? "");
  return {
    durationMs: Number(durationMs.toFixed(2)),
    ok: Boolean(text),
    title: surface.title || undefined,
    author: surface.authorName || undefined,
    siteName: surface.sourceName || undefined,
    publishedAt: surface.publishedAt || undefined,
    canonicalUrl: surface.canonicalUrl || undefined,
    extractionMethod: surface.extraction?.method,
    extractionStatus: surface.extraction?.status,
    extractionWarnings: surface.extraction?.warnings ?? [],
    textLength: text.length,
    excerpt: normalizeText(surface.excerpt ?? "").slice(0, 240) || undefined,
    textPreview: text.slice(0, 320),
    diagnostics: {
      extraction: surface.extraction,
      linkCount: surface.links?.length ?? 0,
      imageCount: surface.images?.length ?? 0,
    },
    score: scoreText(text, fixture),
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
    durationMs: Number(durationMs.toFixed(2)),
    readerable,
    diagnostics: { readerable },
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
    durationMs: Number(durationMs.toFixed(2)),
    ...withoutRawText(summary),
    wordCount: result?.wordCount,
    diagnostics: {
      markdown: Boolean(options.markdown),
      wordCount: result?.wordCount,
    },
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
    for (const candidate of candidates) {
      try {
        const result = normalizeParserResult(
          candidate,
          await candidate.parse({ html, fixture }),
        );
        engineResults.push({
          ...result,
          suitability: evaluateSuitability(result, fixture),
          threshold: evaluateThresholds(result, fixture),
        });
      } catch (error) {
        const result = normalizeParserError(candidate, error);
        engineResults.push({
          ...result,
          suitability: evaluateSuitability(result, fixture),
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
    candidates: candidateManifest(candidates),
    fixtureCount: fixtures.length,
    results,
    summary: summarizeParserResults(results),
    threshold: summarizeThresholds(results),
    suitability: summarizeSuitability(results),
  };

  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  fs.writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`);
  printSummary(report);
  if (!report.threshold.pass || !report.suitability.pass)
    process.exitCode = 1;
}

function printSummary(report) {
  console.log(`Wrote ${REPORT_PATH}`);
  for (const item of report.summary) {
    console.log(
      `${item.engine}: ok ${item.okCount}/${item.fixtureCount}, ` +
      `contains ${item.averageContainsScore}, leaks ${item.totalLeaks}, ` +
      `metadata ${item.averageMetadataCompleteness}, ` +
      `status ${item.statusPassCount}/${item.statusApplicableCount}, ` +
      `warnings ${item.warningPassCount}/${item.warningApplicableCount}, ` +
      `bad-page ${item.badPagePassCount}/${item.badPageApplicableCount}, ` +
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
  if (report.suitability.pass) {
    console.log("suitability: pass");
  } else {
    console.error(`suitability: fail (${report.suitability.failureCount})`);
    for (const failure of report.suitability.failures) {
      console.error(
        `${failure.engine}/${failure.fixtureId}/${failure.check}: ` +
        `actual ${JSON.stringify(failure.actual)} expected ${JSON.stringify(failure.expected)}`,
      );
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
