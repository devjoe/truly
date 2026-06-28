#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { performance } from "node:perf_hooks";
import { Readability, isProbablyReaderable } from "@mozilla/readability";
import { JSDOM } from "jsdom";
import { Defuddle } from "defuddle/node";

const FIXTURE_DIR = "tests/fixtures/general-pages";
const OUTPUT_DIR = "tmp/parser-spikes";
const REPORT_DATE = process.env.TRULY_PARSER_SPIKE_DATE ?? new Date().toISOString().slice(0, 10);
const REPORT_PATH = path.join(OUTPUT_DIR, `general-page-parser-spike-${REPORT_DATE}.json`);

const fixtures = [
  {
    id: "clean-article",
    file: "clean-article.html",
    url: "https://example.test/articles/clean-article",
    expectedContains: ["public planning meeting", "meeting notes"],
    expectedExcludes: [],
  },
  {
    id: "nav-sidebar-noise",
    file: "nav-sidebar-noise.html",
    url: "https://example.test/blog/noise-fixture",
    expectedContains: ["small research team keeps notes useful"],
    expectedExcludes: ["Home Products Pricing", "Promotional sidebar", "Privacy Terms Contact"],
  },
  {
    id: "documentation-page",
    file: "documentation-page.html",
    url: "https://docs.example.test/client/setup",
    expectedContains: ["Create a local configuration file", "model endpoint that the user controls"],
    expectedExcludes: [],
  },
  {
    id: "selected-text",
    file: "selected-text.html",
    url: "https://example.test/articles/selection",
    expectedContains: ["meaningful selection", "selected text has priority"],
    expectedExcludes: [],
  },
  {
    id: "blocked-like",
    file: "blocked-like.html",
    url: "https://example.test/private/story",
    expectedContains: ["log in or subscribe"],
    expectedExcludes: [],
  },
  {
    id: "zh-tw-article",
    file: "zh-tw-article.html",
    url: "https://example.test/zh-tw/article",
    expectedContains: ["這是一篇合成的繁體中文文章", "不包含真實人物、真實帳號或私人網址"],
    expectedExcludes: [],
  },
];

function readFixture(file) {
  return fs.readFileSync(path.join(FIXTURE_DIR, file), "utf8");
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
        engineResults.push(await candidate.parse());
      } catch (error) {
        engineResults.push({
          engine: candidate.engine,
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
    results.push({
      id: fixture.id,
      file: fixture.file,
      url: fixture.url,
      expectedContains: fixture.expectedContains,
      expectedExcludes: fixture.expectedExcludes,
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
  };

  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  fs.writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`);
  printSummary(report);
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
  }));
}

function printSummary(report) {
  console.log(`Wrote ${REPORT_PATH}`);
  for (const item of report.summary) {
    console.log(
      `${item.engine}: ok ${item.okCount}/${item.fixtureCount}, ` +
      `contains ${item.averageContainsScore}, leaks ${item.totalLeaks}, ` +
      `avg ${item.averageDurationMs}ms, errors ${item.errors}`,
    );
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
