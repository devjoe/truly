#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { performance } from "node:perf_hooks";
import { createHash } from "node:crypto";
import { Readability, isProbablyReaderable } from "@mozilla/readability";
import { JSDOM } from "jsdom";
import { Defuddle } from "defuddle/node";
import { evaluateSuitability } from "./lib/general-page-parser-contract.mjs";
import { loadRuntimeGeneralPageExtractor } from "./lib/load-runtime-general-page-extractor.mjs";

const OUTPUT_DIR = "tmp/general-page-real-world-evals";
const REPORT_DATE = process.env.TRULY_REAL_WORLD_EVAL_DATE ?? new Date().toISOString().slice(0, 10);
const REPORT_PATH = path.join(OUTPUT_DIR, `real-world-eval-${REPORT_DATE}.json`);
const DEFAULT_FETCH_TIMEOUT_MS = 15_000;
const MIN_FETCH_TIMEOUT_MS = 1_000;
const MAX_FETCH_TIMEOUT_MS = 60_000;
const USER_AGENT = "TrulyGeneralPageReaderEvaluation/0.1 (+https://example.test/truly)";

if (isDirectRun()) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const targets = readTargets(args.input);

  if (targets.length === 0) {
    console.error("Real-world eval input must include at least one target.");
    process.exit(2);
  }

  const results = [];
  for (const [index, target] of targets.entries()) {
    try {
      results.push(await evaluateTarget(normalizeTarget(target, index), args));
    } catch (error) {
      results.push({
        targetId: safeTargetId(target.id, index),
        category: target.category,
        pageType: target.pageType,
        ok: false,
        errorKind: errorKind(error),
      });
    }
  }

  const report = {
    generatedAt: new Date().toISOString(),
    privacyBoundary: "Private tmp report. Do not commit. Contains no target URLs, raw HTML, extracted text, text previews, excerpts, screenshots, or DOM snapshots.",
    input: {
      targetCount: targets.length,
      networkAllowed: args.allowNetwork,
      timeoutMs: args.timeoutMs,
    },
    results,
    aggregate: aggregate(results),
  };

  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  fs.writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`);
  printSummary(report);
}

function isDirectRun() {
  return process.argv[1] && import.meta.url === new URL(process.argv[1], "file:").href;
}

function parseArgs(argv) {
  const inputIndex = argv.indexOf("--input");
  const input = inputIndex >= 0 ? argv[inputIndex + 1] : undefined;
  if (!input) {
    console.error("Usage: npm run eval:general-page-real-world -- --input tmp/private-targets.json [--allow-network] [--timeout-ms 15000]");
    process.exit(2);
  }
  return {
    input,
    allowNetwork: argv.includes("--allow-network"),
    timeoutMs: numericArg(argv, "--timeout-ms", DEFAULT_FETCH_TIMEOUT_MS, {
      min: MIN_FETCH_TIMEOUT_MS,
      max: MAX_FETCH_TIMEOUT_MS,
    }),
  };
}

function numericArg(argv, name, fallback, { min, max }) {
  const index = argv.indexOf(name);
  if (index < 0)
    return fallback;
  const raw = argv[index + 1];
  const value = Number(raw);
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`${name} must be an integer between ${min} and ${max}.`);
  }
  return value;
}

function readTargets(inputPath) {
  const parsed = JSON.parse(fs.readFileSync(inputPath, "utf8"));
  if (!Array.isArray(parsed))
    throw new Error("Input file must be an array of private targets.");
  return parsed;
}

function normalizeTarget(target, index) {
  if (!target || typeof target !== "object")
    throw new Error("target must be an object");
  if (typeof target.url !== "string" && typeof target.htmlPath !== "string")
    throw new Error("target must include url or htmlPath");
  if (target.htmlPath && !isPrivateHtmlPath(target.htmlPath))
    throw new Error("htmlPath must point under tmp/ or the system temp directory");

  return {
    id: safeTargetId(target.id, index),
    url: typeof target.url === "string" ? target.url : "https://example.test/private-local-target",
    htmlPath: typeof target.htmlPath === "string" ? target.htmlPath : undefined,
    category: typeof target.category === "string" ? target.category : undefined,
    pageType: typeof target.pageType === "string" ? target.pageType : undefined,
    expectedContains: Array.isArray(target.expected?.contains) ? target.expected.contains : [],
    expectedExcludes: Array.isArray(target.expected?.excludes) ? target.expected.excludes : [],
  };
}

function safeTargetId(_value, index) {
  return `target-${String(index + 1).padStart(3, "0")}`;
}

function isPrivateHtmlPath(value) {
  const resolved = path.resolve(value);
  const tmpRoot = path.resolve("tmp");
  return resolved.startsWith(`${tmpRoot}${path.sep}`)
    || resolved === tmpRoot
    || resolved.startsWith(`${path.resolve(process.env.TMPDIR ?? "/tmp")}${path.sep}`)
    || resolved.startsWith(`${path.resolve("/tmp")}${path.sep}`);
}

async function evaluateTarget(target, args) {
  const html = await loadHtml(target, args);
  const engines = [];
  for (const engine of [
    ["truly-heuristic", parseTrulyHeuristic],
    ["readability", parseReadability],
    ["defuddle", parseDefuddle],
    ["defuddle-markdown", (input) => parseDefuddle(input, { markdown: true })],
  ]) {
    const [engineId, parse] = engine;
    try {
      const result = await parse({ html, url: target.url, target });
      engines.push(sanitizeEngineResult(engineId, result, target));
    } catch (error) {
      engines.push({
        engine: engineId,
        ok: false,
        errorKind: errorKind(error),
      });
    }
  }

  const document = documentSignals(html, target.url);
  const ok = engines.some((engine) => engine.ok);
  return {
    targetId: target.id,
    targetHash: hashTarget(target),
    category: target.category,
    pageType: target.pageType,
    sourceKind: target.htmlPath ? "local-private-html" : "live-fetch",
    ok,
    failureKind: ok ? undefined : classifyTargetFailure(document, engines),
    document,
    engines,
  };
}

async function loadHtml(target, args) {
  if (target.htmlPath)
    return fs.readFileSync(target.htmlPath, "utf8");
  if (!args.allowNetwork)
    throw new Error("network target requires --allow-network");

  const response = await fetch(target.url, {
    redirect: "follow",
    signal: AbortSignal.timeout(args.timeoutMs),
    headers: {
      "user-agent": USER_AGENT,
      "accept": "text/html,application/xhtml+xml",
    },
  });
  return response.text();
}

async function parseTrulyHeuristic({ html, url }) {
  const { extractGeneralPageSurface } = await loadRuntimeGeneralPageExtractor();
  const dom = domFor(html, url);
  const start = performance.now();
  const surface = extractGeneralPageSurface({
    document: dom.window.document,
    url,
  });
  const durationMs = performance.now() - start;
  return {
    ok: Boolean(surface.mainText),
    durationMs,
    title: surface.title,
    author: surface.authorName,
    siteName: surface.sourceName,
    publishedAt: surface.publishedAt,
    text: surface.mainText,
    extractionStatus: surface.extraction.status,
    extractionWarnings: surface.extraction.warnings,
    diagnostics: {
      extraction: surface.extraction,
      linkCount: surface.links?.length ?? 0,
      imageCount: surface.images?.length ?? 0,
    },
  };
}

function parseReadability({ html, url }) {
  const dom = domFor(html, url);
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
  return {
    ok: Boolean(article?.textContent),
    durationMs,
    title: article?.title,
    author: article?.byline,
    siteName: article?.siteName,
    publishedAt: article?.publishedTime,
    text: article?.textContent ?? "",
    diagnostics: {
      readerable,
    },
  };
}

async function parseDefuddle({ html, url }, options = {}) {
  const dom = domFor(html, url);
  const start = performance.now();
  const result = await Defuddle(dom.window.document, url, {
    useAsync: false,
    ...options,
  });
  const durationMs = performance.now() - start;
  return {
    ok: Boolean(result?.textContent ?? result?.contentMarkdown ?? result?.content),
    durationMs,
    title: result?.title,
    author: result?.author,
    siteName: result?.site,
    publishedAt: result?.published,
    text: normalizeText(result?.textContent ?? result?.contentMarkdown ?? result?.content ?? ""),
    diagnostics: {
      markdown: Boolean(options.markdown),
      wordCount: result?.wordCount,
    },
  };
}

export function sanitizeEngineResult(engineId, result, target) {
  const text = normalizeText(result.text ?? "");
  const containsHits = target.expectedContains.filter((item) => text.includes(item)).length;
  const excludeLeaks = target.expectedExcludes.filter((item) => text.includes(item)).length;
  const suitability = evaluateSuitability({
    ...result,
    ok: Boolean(text),
    diagnostics: result.diagnostics,
  }, {
    pageType: target.pageType,
  });

  return {
    engine: engineId,
    ok: Boolean(text),
    durationMs: Number((result.durationMs ?? 0).toFixed(2)),
    textLength: text.length,
    metadata: metadataSummary(result),
    extractionStatus: result.extractionStatus,
    extractionWarnings: result.extractionWarnings,
    expectedContainsHitCount: containsHits,
    expectedContainsTotal: target.expectedContains.length,
    expectedExcludeLeakCount: excludeLeaks,
    suitability: {
      metadataCompleteness: suitability.metadata.completeness,
      status: suitability.status.applicable ? suitability.status.pass : null,
      warnings: suitability.warnings.applicable ? suitability.warnings.pass : null,
      badPage: suitability.badPage.applicable ? suitability.badPage.pass : null,
    },
    diagnostics: sanitizeDiagnostics(result.diagnostics),
  };
}

function metadataSummary(result) {
  return {
    title: Boolean(result.title),
    author: Boolean(result.author),
    siteName: Boolean(result.siteName),
    publishedAt: Boolean(result.publishedAt),
  };
}

function sanitizeDiagnostics(diagnostics = {}) {
  return {
    readerable: typeof diagnostics.readerable === "boolean" ? diagnostics.readerable : undefined,
    markdown: typeof diagnostics.markdown === "boolean" ? diagnostics.markdown : undefined,
    wordCount: typeof diagnostics.wordCount === "number" ? diagnostics.wordCount : undefined,
    linkCount: typeof diagnostics.linkCount === "number" ? diagnostics.linkCount : undefined,
    imageCount: typeof diagnostics.imageCount === "number" ? diagnostics.imageCount : undefined,
    extraction: diagnostics.extraction
      ? {
        method: diagnostics.extraction.method,
        status: diagnostics.extraction.status,
        warnings: diagnostics.extraction.warnings,
      }
      : undefined,
  };
}

function documentSignals(html, url) {
  const dom = domFor(html, url);
  const document = dom.window.document;
  const bodyTextLength = normalizeText(document.body?.textContent ?? "").length;
  return {
    htmlLength: html.length,
    bodyTextLength,
    titlePresent: Boolean(document.title.trim()),
    articleCount: count(document, "article"),
    mainCount: count(document, "main"),
    roleMainCount: count(document, "[role='main'], [role=\"main\"]"),
    paragraphCount: count(document, "p"),
    linkCount: count(document, "a[href]"),
    imageCount: count(document, "img"),
    formCount: count(document, "form"),
    dialogCount: count(document, "[role='dialog'], [role=\"dialog\"], dialog"),
    scriptCount: count(document, "script"),
    hasCanonical: Boolean(document.querySelector("link[rel='canonical'], link[rel='Canonical']")),
    hasArticleMeta: Boolean(document.querySelector("meta[property^='article:']")),
    hasOpenGraph: Boolean(document.querySelector("meta[property^='og:']")),
  };
}

function aggregate(items) {
  const okItems = items.filter((item) => item.ok);
  const byEngine = new Map();
  for (const item of okItems) {
    for (const engine of item.engines ?? []) {
      const current = byEngine.get(engine.engine) ?? {
        engine: engine.engine,
        okCount: 0,
        totalTextLength: 0,
        totalDurationMs: 0,
        status: {},
        warnings: {},
        suitability: {
          statusPass: 0,
          statusApplicable: 0,
          warningPass: 0,
          warningApplicable: 0,
          badPagePass: 0,
          badPageApplicable: 0,
        },
      };
      if (engine.ok)
        current.okCount += 1;
      current.totalTextLength += engine.textLength ?? 0;
      current.totalDurationMs += engine.durationMs ?? 0;
      if (engine.extractionStatus)
        current.status[engine.extractionStatus] = (current.status[engine.extractionStatus] ?? 0) + 1;
      for (const warning of engine.extractionWarnings ?? []) {
        current.warnings[warning] = (current.warnings[warning] ?? 0) + 1;
      }
      if (engine.suitability.status !== null) {
        current.suitability.statusApplicable += 1;
        if (engine.suitability.status)
          current.suitability.statusPass += 1;
      }
      if (engine.suitability.warnings !== null) {
        current.suitability.warningApplicable += 1;
        if (engine.suitability.warnings)
          current.suitability.warningPass += 1;
      }
      if (engine.suitability.badPage !== null) {
        current.suitability.badPageApplicable += 1;
        if (engine.suitability.badPage)
          current.suitability.badPagePass += 1;
      }
      byEngine.set(engine.engine, current);
    }
  }
  return {
    okCount: okItems.length,
    errorCount: items.length - okItems.length,
    failureBuckets: failureBuckets(items),
    engines: [...byEngine.values()].map((item) => ({
      engine: item.engine,
      okCount: item.okCount,
      averageTextLength: okItems.length ? Math.round(item.totalTextLength / okItems.length) : 0,
      averageDurationMs: okItems.length ? Number((item.totalDurationMs / okItems.length).toFixed(2)) : 0,
      status: item.status,
      warnings: item.warnings,
      suitability: item.suitability,
    })),
  };
}

function failureBuckets(items) {
  return {
    targetFailures: countValues(
      items
        .filter((item) => !item.ok)
        .map((item) => item.failureKind ?? item.errorKind ?? "target-failed"),
    ),
    engineFailures: countValues(
      items.flatMap((item) => (item.engines ?? [])
        .filter((engine) => !engine.ok)
        .map((engine) => `${engine.engine}:${engine.errorKind ?? "empty-result"}`)),
    ),
    runtimeSuitabilityFailures: countValues(
      items.flatMap((item) => {
        const engine = (item.engines ?? []).find((candidate) => candidate.engine === "truly-heuristic");
        if (!engine?.suitability)
          return [];
        const failures = [];
        if (engine.suitability.status === false)
          failures.push(`status:${item.pageType ?? "unknown"}`);
        if (engine.suitability.warnings === false)
          failures.push(`warnings:${item.pageType ?? "unknown"}`);
        if (engine.suitability.badPage === false)
          failures.push(`badPage:${item.pageType ?? "unknown"}`);
        return failures;
      }),
    ),
  };
}

function classifyTargetFailure(document, engines) {
  const allEnginesErrored = engines.length > 0 && engines.every((engine) => engine.errorKind);
  if (allEnginesErrored)
    return "all-engines-error";
  if (document.bodyTextLength < 500)
    return "low-text-or-empty-shell";
  return "all-engines-empty";
}

function domFor(html, url) {
  return new JSDOM(html, { url });
}

function count(root, selector) {
  return root.querySelectorAll(selector).length;
}

function normalizeText(value) {
  return String(value ?? "")
    .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript\b[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<template\b[\s\S]*?<\/template>/gi, " ")
    .replace(/<svg\b[\s\S]*?<\/svg>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function hashTarget(target) {
  // Stable URL fingerprints are for private diffing only; do not publish them.
  return createHash("sha256")
    .update(`${target.url}\n${target.htmlPath ?? ""}\n${target.id}`)
    .digest("hex")
    .slice(0, 16);
}

function errorKind(error) {
  if (error instanceof SyntaxError)
    return "invalid-json-or-html";
  if (error instanceof Error && ["AbortError", "TimeoutError"].includes(error.name))
    return "fetch-timeout";
  if (error instanceof Error && error.message.includes("--allow-network"))
    return "network-not-allowed";
  if (error instanceof Error && error.message.includes("htmlPath"))
    return "invalid-private-html-path";
  if (error instanceof TypeError)
    return "fetch-error";
  return "target-evaluation-error";
}

function printSummary(report) {
  console.log(`Wrote ${REPORT_PATH}`);
  console.log(`evaluated ${report.aggregate.okCount}/${report.input.targetCount}; errors ${report.aggregate.errorCount}`);
  console.log(`failureBuckets ${JSON.stringify(report.aggregate.failureBuckets)}`);
  for (const item of report.aggregate.engines) {
    console.log(
      `${item.engine}: ok ${item.okCount}/${report.input.targetCount}, ` +
      `avgText ${item.averageTextLength}, avg ${item.averageDurationMs}ms, ` +
      `status ${JSON.stringify(item.status)}, warnings ${JSON.stringify(item.warnings)}`,
    );
  }
}

function countValues(values) {
  return values.reduce((counts, value) => {
    counts[value] = (counts[value] ?? 0) + 1;
    return counts;
  }, {});
}
