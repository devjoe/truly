#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { performance } from "node:perf_hooks";
import ts from "typescript";
import { JSDOM, VirtualConsole } from "jsdom";
import { labelingClientScript } from "./lib/review-labeling-client.mjs";
import { cdpBaseForPort, fetchRenderedPageHtml } from "./lib/cdp-page-source.mjs";
import { createProductQualityProgressTracker } from "./lib/product-quality-progress.mjs";

const OUTPUT_DIR = "tmp/general-page-product-quality";
const DEFAULT_TIMEOUT_MS = 12_000;
const DEFAULT_CONCURRENCY = 8;
const DEFAULT_LIMIT = 200;
const PREVIEW_LIMIT = 1600;
const USER_AGENT = "TrulyGeneralPageReaderProductQuality/0.1 (+https://example.test/truly)";
const quietJsdomVirtualConsole = new VirtualConsole();

let extractorModulePromise;
let modelContextModulePromise;

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const targets = readTargets(args.input).slice(0, args.limit);
  if (targets.length === 0)
    throw new Error("Product-quality review input must include at least one target.");
  if (!args.allowNetwork && targets.some((target) => target.url && !target.htmlPath))
    throw new Error("Live targets require --allow-network.");

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const outDir = args.outputDir ?? path.join(OUTPUT_DIR, `review-${stamp}`);
  fs.mkdirSync(outDir, { recursive: true });

  const progress = createProductQualityProgressTracker({
    total: targets.length,
    every: args.progressEvery,
  });
  const results = await mapWithConcurrency(targets, args.concurrency, async (target, index) => {
    const result = await reviewTarget(normalizeTarget(target, index), args);
    progress.record(result);
    return result;
  },
  );
  const report = {
    generatedAt: new Date().toISOString(),
    privacyBoundary: "Private tmp product-quality artifact. Do not commit. Contains real URLs and extracted text previews for manual review.",
    input: {
      targetCount: targets.length,
      limit: args.limit,
      timeoutMs: args.timeoutMs,
      concurrency: args.concurrency,
      networkAllowed: args.allowNetwork,
      sourceMode: args.source,
    },
    aggregate: aggregate(results),
    results,
  };

  fs.writeFileSync(path.join(outDir, "review.json"), `${JSON.stringify(report, null, 2)}\n`);
  fs.writeFileSync(path.join(outDir, "review.jsonl"), `${results.map((item) => JSON.stringify(item)).join("\n")}\n`);
  fs.writeFileSync(path.join(outDir, "manual-labels-template.jsonl"), `${results.map((item) => JSON.stringify({
    targetId: item.targetId,
    url: item.url,
    verdict: "unreviewed",
    issueTags: [],
    notes: "",
  })).join("\n")}\n`);
  fs.writeFileSync(path.join(outDir, "review.html"), renderHtmlReport(report));

  printSummary(report, outDir);
}

function parseArgs(argv) {
  const input = stringArg(argv, "--input");
  if (!input) {
    console.error("Usage: node scripts/review-general-page-product-quality.mjs --input tmp/targets.json --allow-network [--source static|cdp] [--cdp-port 9222] [--limit 200] [--concurrency 8] [--timeout-ms 12000] [--progress-every 10]");
    process.exit(2);
  }
  const source = stringArg(argv, "--source") ?? "static";
  if (!["static", "cdp"].includes(source))
    throw new Error("--source must be static or cdp");
  const explicitConcurrency = stringArg(argv, "--concurrency") !== undefined;
  const concurrency = numericArg(argv, "--concurrency", DEFAULT_CONCURRENCY, { min: 1, max: 24 });
  const progressEvery = numericArg(argv, "--progress-every", source === "cdp" ? 10 : 50, { min: 0, max: 1000 });
  return {
    input,
    outputDir: stringArg(argv, "--output-dir"),
    allowNetwork: argv.includes("--allow-network"),
    limit: numericArg(argv, "--limit", DEFAULT_LIMIT, { min: 1, max: 1000 }),
    // Live-DOM rendering keeps one Chrome target per in-flight review, so
    // default to a gentle concurrency unless the caller overrides it.
    concurrency: source === "cdp" && !explicitConcurrency ? 2 : concurrency,
    timeoutMs: numericArg(argv, "--timeout-ms", DEFAULT_TIMEOUT_MS, { min: 1000, max: 60000 }),
    progressEvery,
    source,
    cdpBase: cdpBaseForPort(numericArg(argv, "--cdp-port", 9222, { min: 1, max: 65535 })),
  };
}

function stringArg(argv, name) {
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] : undefined;
}

function numericArg(argv, name, fallback, { min, max }) {
  const raw = stringArg(argv, name);
  if (raw === undefined)
    return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < min || value > max)
    throw new Error(`${name} must be an integer between ${min} and ${max}.`);
  return value;
}

function readTargets(inputPath) {
  const parsed = JSON.parse(fs.readFileSync(inputPath, "utf8"));
  return Array.isArray(parsed) ? parsed : parsed.targets;
}

function normalizeTarget(target, index) {
  if (!target || typeof target !== "object")
    throw new Error("target must be an object");
  if (typeof target.url !== "string" && typeof target.htmlPath !== "string")
    throw new Error("target must include url or htmlPath");
  return {
    targetId: `target-${String(index + 1).padStart(3, "0")}`,
    url: typeof target.url === "string" ? target.url : "https://example.test/private-local-target",
    htmlPath: typeof target.htmlPath === "string" ? target.htmlPath : undefined,
    category: typeof target.category === "string" ? target.category : "uncategorized",
    pageType: typeof target.pageType === "string" ? target.pageType : undefined,
    seedId: typeof target.seedId === "string" ? target.seedId : undefined,
  };
}

async function reviewTarget(target, args) {
  try {
    const html = await loadHtml(target, args);
    const { extractGeneralPageSurface } = await loadRuntimeModule("src/lib/general-page-extraction.ts", "extractor");
    const { buildGeneralPageModelContext } = await loadRuntimeModule("src/lib/general-page-model-context.ts", "modelContext");
    const dom = createReviewDom(html, target.url);
    const start = performance.now();
    const surface = extractGeneralPageSurface({
      document: dom.window.document,
      url: target.url,
    });
    const durationMs = performance.now() - start;
    const modelContext = buildGeneralPageModelContext(surface);
    const document = documentSignals(html, target.url);
    const autoReview = autoReviewHints(surface, modelContext, document, target);
    return {
      targetId: target.targetId,
      url: target.url,
      category: target.category,
      pageType: target.pageType,
      seedId: target.seedId,
      ok: Boolean(surface.mainText),
      durationMs: Number(durationMs.toFixed(2)),
      document,
      surface: {
        title: surface.title,
        canonicalUrl: surface.canonicalUrl,
        sourceName: surface.sourceName,
        authorName: surface.authorName,
        publishedAt: surface.publishedAt,
        textLength: surface.mainText.length,
        excerpt: surface.excerpt,
        preview: modelContext.mainText.slice(0, PREVIEW_LIMIT),
        extraction: surface.extraction,
        linkCount: surface.links?.length ?? 0,
        imageCount: surface.images?.length ?? 0,
      },
      modelContext: {
        modelEligible: modelContext.modelEligible,
        modelReadiness: modelContext.modelReadiness,
        qualityIssues: modelContext.qualityIssues,
        ineligibilityReason: modelContext.ineligibilityReason,
        textLength: modelContext.mainText.length,
        links: modelContext.links,
        imageAltText: modelContext.imageAltText,
      },
      autoReview,
      manualReview: emptyManualReview(),
    };
  } catch (error) {
    return {
      targetId: target.targetId,
      url: target.url,
      category: target.category,
      pageType: target.pageType,
      seedId: target.seedId,
      ok: false,
      errorKind: errorKind(error),
      errorMessage: error instanceof Error ? error.message.slice(0, 240) : String(error).slice(0, 240),
      manualReview: emptyManualReview(),
    };
  }
}

async function loadHtml(target, args) {
  if (target.htmlPath)
    return fs.readFileSync(target.htmlPath, "utf8");
  if (args.source === "cdp") {
    const rendered = await fetchRenderedPageHtml(target.url, {
      cdpBase: args.cdpBase,
      timeoutMs: args.timeoutMs,
    });
    return rendered.html;
  }
  const response = await fetch(target.url, {
    redirect: "follow",
    signal: AbortSignal.timeout(args.timeoutMs),
    headers: {
      "user-agent": USER_AGENT,
      "accept": "text/html,application/xhtml+xml",
    },
  });
  if (!response.ok)
    throw new Error(`fetch failed with ${response.status}`);
  return response.text();
}

async function loadRuntimeModule(sourcePath, kind) {
  if (kind === "extractor") {
    extractorModulePromise ??= importTsModule(sourcePath);
    return extractorModulePromise;
  }
  if (kind === "modelContext") {
    modelContextModulePromise ??= importTsModule(sourcePath);
    return modelContextModulePromise;
  }
  throw new Error(`Unknown runtime module kind: ${kind}`);
}

async function importTsModule(sourcePath) {
  const absolutePath = path.resolve(process.cwd(), sourcePath);
  const source = fs.readFileSync(absolutePath, "utf8");
  const transpiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ES2022,
      target: ts.ScriptTarget.ES2022,
      importsNotUsedAsValues: ts.ImportsNotUsedAsValues.Remove,
      verbatimModuleSyntax: false,
    },
    fileName: absolutePath,
  });
  const encoded = Buffer.from(transpiled.outputText, "utf8").toString("base64");
  return import(`data:text/javascript;base64,${encoded}`);
}

function documentSignals(html, url) {
  const dom = createReviewDom(html, url);
  const document = dom.window.document;
  return {
    htmlLength: html.length,
    bodyTextLength: cleanText(document.body?.textContent ?? "").length,
    titlePresent: Boolean(document.title.trim()),
    articleCount: count(document, "article"),
    mainCount: count(document, "main"),
    roleMainCount: count(document, "[role='main'], [role=\"main\"]"),
    paragraphCount: count(document, "p"),
    linkCount: count(document, "a[href]"),
    imageCount: count(document, "img"),
    formCount: count(document, "form"),
    dialogCount: count(document, "[role='dialog'], [role=\"dialog\"], dialog"),
    hasCanonical: Boolean(document.querySelector("link[rel='canonical'], link[rel='Canonical']")),
    hasArticleMeta: Boolean(document.querySelector("meta[property^='article:']")),
    hasOpenGraph: Boolean(document.querySelector("meta[property^='og:']")),
  };
}

function createReviewDom(html, url) {
  return new JSDOM(html, {
    url,
    virtualConsole: quietJsdomVirtualConsole,
  });
}

function autoReviewHints(surface, modelContext, document, target) {
  const issueTags = [];
  if (surface.extraction.method === "fallback")
    issueTags.push("fallback");
  if (surface.extraction.status === "partial")
    issueTags.push("partial");
  if (surface.extraction.status === "empty")
    issueTags.push("empty");
  if (surface.extraction.status === "blocked")
    issueTags.push("blocked");
  for (const warning of surface.extraction.warnings)
    issueTags.push(`warning:${warning}`);
  for (const issue of modelContext.qualityIssues)
    issueTags.push(`quality:${issue}`);
  if (!surface.title)
    issueTags.push("missing-title");
  if ((modelContext.links?.length ?? 0) >= 12)
    issueTags.push("many-source-links");
  const cleanCompleteExtraction = surface.extraction.status === "complete" &&
    surface.extraction.warnings.length === 0 &&
    modelContext.modelReadiness === "ready";
  if (
    document.linkCount >= 120 &&
    document.articleCount >= 3 &&
    !cleanCompleteExtraction &&
    !isDocumentationReviewTarget(target, surface)
  )
    issueTags.push("likely-index-or-feed");

  let suggestedVerdict = "good";
  if (!modelContext.modelEligible || surface.extraction.status === "empty" || surface.extraction.status === "blocked") {
    suggestedVerdict = "blocked_or_empty_review";
  } else if (surface.extraction.status === "partial" || issueTags.includes("quality:partial_extraction")) {
    suggestedVerdict = "partial";
  } else if (modelContext.modelReadiness === "caution" || issueTags.includes("likely-index-or-feed")) {
    suggestedVerdict = "usable_with_caution";
  }

  return {
    suggestedVerdict,
    issueTags: [...new Set(issueTags)],
  };
}

function isDocumentationReviewTarget(target, surface) {
  const signals = `${target.category ?? ""} ${target.pageType ?? ""} ${target.url ?? ""} ${surface.title ?? ""}`.toLowerCase();
  return /(?:technical_docs|documentation|knowledge_base|docs?|handbook|reference|developer)/.test(signals);
}

function emptyManualReview() {
  return {
    verdict: "unreviewed",
    issueTags: [],
    notes: "",
  };
}

function aggregate(results) {
  const extractedItems = results.filter((item) => item.ok);
  const fetchedButEmptyItems = results.filter((item) => !item.ok && item.surface);
  const fetchErrorItems = results.filter((item) => item.errorKind);
  return {
    extractedCount: extractedItems.length,
    emptyOrBlockedCount: fetchedButEmptyItems.length,
    fetchErrorCount: fetchErrorItems.length,
    okCount: extractedItems.length,
    errorCount: fetchErrorItems.length,
    byCategory: countValues(results.map((item) => item.category ?? "uncategorized")),
    byPageType: countValues(results.map((item) => item.pageType ?? "unknown")),
    byReadiness: countValues(results.map((item) => item.modelContext?.modelReadiness ?? "error")),
    byExtractionStatus: countValues(results.map((item) => item.surface?.extraction?.status ?? "error")),
    byExtractionMethod: countValues(results.map((item) => item.surface?.extraction?.method ?? "error")),
    bySuggestedVerdict: countValues(results.map((item) => item.autoReview?.suggestedVerdict ?? "error")),
    topAutoIssueTags: topCounts(results.flatMap((item) => item.autoReview?.issueTags ?? []), 24),
    errorKinds: countValues(fetchErrorItems.map((item) => item.errorKind ?? "unknown-error")),
  };
}

async function mapWithConcurrency(items, concurrency, mapper) {
  const results = new Array(items.length);
  let nextIndex = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await mapper(items[index], index);
    }
  });
  await Promise.all(workers);
  return results;
}

function renderHtmlReport(report) {
  const cards = report.results.map(renderResultCard).join("\n");
  return `<!doctype html>
<html lang="zh-Hant">
<head>
  <meta charset="utf-8">
  <title>Truly General Page Product Quality Review</title>
  <style>
    body { margin: 0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background: #111; color: #eee; }
    header { position: sticky; top: 0; z-index: 2; padding: 18px 24px; background: #181818; border-bottom: 1px solid #333; }
    h1 { margin: 0 0 8px; font-size: 22px; }
    h2 { margin: 0 0 12px; font-size: 18px; }
    .summary { display: flex; gap: 10px; flex-wrap: wrap; color: #c9c9c9; font-size: 13px; }
    .pill { padding: 4px 8px; border: 1px solid #3d3d3d; border-radius: 999px; background: #202020; }
    main { padding: 18px 24px 48px; display: grid; gap: 16px; }
    article { border: 1px solid #3c3c3c; border-radius: 8px; background: #1c1c1c; padding: 16px; }
    .meta, .links, .review { display: grid; gap: 8px; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); margin: 12px 0; }
    .box { padding: 10px; background: #141414; border-radius: 6px; border: 1px solid #2d2d2d; }
    .label { display: block; color: #aaa; font-size: 12px; margin-bottom: 4px; }
    .value { font-weight: 650; }
    pre { white-space: pre-wrap; overflow-wrap: anywhere; line-height: 1.45; background: #101010; border: 1px solid #303030; border-radius: 6px; padding: 12px; max-height: 260px; overflow: auto; }
    a { color: #64a8ff; }
    select, textarea, input { width: 100%; box-sizing: border-box; background: #101010; color: #eee; border: 1px solid #444; border-radius: 6px; padding: 8px; }
    textarea { min-height: 72px; resize: vertical; }
    .ready { color: #2fd184; }
    .caution { color: #e0a72f; }
    .blocked, .error { color: #ff7070; }
  </style>
</head>
<body>
  <header>
    <h1>Truly General Page Product Quality Review</h1>
    <div class="summary">
      <span class="pill">Generated ${escapeHtml(report.generatedAt)}</span>
      <span class="pill">Targets ${report.input.targetCount}</span>
      <span class="pill">Extracted ${report.aggregate.extractedCount}</span>
      <span class="pill">Empty/blocked ${report.aggregate.emptyOrBlockedCount}</span>
      <span class="pill">Fetch errors ${report.aggregate.fetchErrorCount}</span>
      <span class="pill">Private tmp artifact, do not commit</span>
    </div>
  </header>
  <main>${cards}</main>
  ${labelingClientScript()}
</body>
</html>`;
}

function renderResultCard(item) {
  const readiness = item.modelContext?.modelReadiness ?? "error";
  const extraction = item.surface?.extraction;
  return `<article id="${escapeHtml(item.targetId)}">
    <h2>${escapeHtml(item.targetId)} · ${escapeHtml(item.surface?.title ?? item.errorKind ?? "(no title)")}</h2>
    <p><a href="${escapeAttribute(item.url)}" target="_blank" rel="noreferrer">${escapeHtml(item.url)}</a></p>
    <div class="meta">
      ${box("Category", item.category)}
      ${box("Page type", item.pageType ?? "unknown")}
      ${box("Readiness", readiness, readinessClass(readiness))}
      ${box("Suggested", item.autoReview?.suggestedVerdict ?? "error")}
      ${box("Method", extraction?.method ?? "error")}
      ${box("Status", extraction?.status ?? "error")}
      ${box("Text length", String(item.surface?.textLength ?? 0))}
      ${box("Links", String(item.modelContext?.links?.length ?? 0))}
    </div>
    <div class="box">
      <span class="label">Warnings / quality issues</span>
      <span class="value">${escapeHtml([
        ...(extraction?.warnings ?? []),
        ...(item.modelContext?.qualityIssues ?? []),
        ...(item.autoReview?.issueTags ?? []),
      ].join(", ") || "none")}</span>
    </div>
    <pre>${escapeHtml(item.surface?.preview ?? item.errorMessage ?? "")}</pre>
    <div class="links">
      ${(item.modelContext?.links ?? []).slice(0, 8).map((link) =>
        `<div class="box"><span class="label">${escapeHtml(link.text ?? "source")}</span><a href="${escapeAttribute(link.href)}" target="_blank" rel="noreferrer">${escapeHtml(link.href)}</a></div>`
      ).join("")}
    </div>
    <div class="review">
      <label class="box"><span class="label">Manual verdict</span><select data-target="${escapeAttribute(item.targetId)}"><option>unreviewed</option><option>good</option><option>usable_with_caution</option><option>partial</option><option>bad</option><option>blocked_or_empty_ok</option></select></label>
      <label class="box"><span class="label">Issue tags</span><input value="${escapeAttribute((item.autoReview?.issueTags ?? []).join(", "))}"></label>
      <label class="box"><span class="label">Notes</span><textarea></textarea></label>
    </div>
  </article>`;
}

function box(label, value, className = "") {
  return `<div class="box"><span class="label">${escapeHtml(label)}</span><span class="value ${escapeAttribute(className)}">${escapeHtml(value ?? "")}</span></div>`;
}

function readinessClass(value) {
  if (value === "ready")
    return "ready";
  if (value === "caution")
    return "caution";
  return "blocked";
}

function count(root, selector) {
  return root.querySelectorAll(selector).length;
}

function cleanText(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function countValues(values) {
  return values.reduce((counts, value) => {
    counts[value] = (counts[value] ?? 0) + 1;
    return counts;
  }, {});
}

function topCounts(values, limit) {
  return Object.entries(countValues(values))
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([value, count]) => ({ value, count }));
}

function errorKind(error) {
  if (error instanceof Error && ["AbortError", "TimeoutError"].includes(error.name))
    return "fetch-timeout";
  if (error instanceof Error && /\bcdp\b/i.test(error.message))
    return "cdp-error";
  if (error instanceof TypeError)
    return "fetch-error";
  return "target-review-error";
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function escapeAttribute(value) {
  return escapeHtml(value).replace(/"/g, "&quot;");
}

function printSummary(report, outDir) {
  console.log(`Wrote ${outDir}`);
  console.log(
    `reviewed ${report.aggregate.extractedCount}/${report.input.targetCount}; ` +
    `emptyOrBlocked ${report.aggregate.emptyOrBlockedCount}; ` +
    `fetchErrors ${report.aggregate.fetchErrorCount}`,
  );
  console.log(`readiness ${JSON.stringify(report.aggregate.byReadiness)}`);
  console.log(`suggested ${JSON.stringify(report.aggregate.bySuggestedVerdict)}`);
  console.log(`top issues ${JSON.stringify(report.aggregate.topAutoIssueTags.slice(0, 8))}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
