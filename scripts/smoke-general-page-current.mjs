#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const DEFAULT_CDP_PORT = 9222;
const DEFAULT_TIMEOUT_MS = 20_000;
const OUTPUT_ROOT = "tmp/general-page-product-quality";
const PUBLIC_SUMMARY_FORBIDDEN_KEYS = new Set([
  "url",
  "finalUrl",
  "title",
  "excerpt",
  "preview",
  "mainText",
  "textContent",
  "html",
  "rawHtml",
  "sourceHtml",
  "screenshot",
  "dataUrl",
]);
const PUBLIC_SUMMARY_FORBIDDEN_STRING_PATTERNS = [
  /https?:\/\//i,
  /<!doctype/i,
  /<html/i,
];

if (isDirectRun()) {
  main().catch((error) => {
    console.error(error?.stack || String(error));
    process.exit(1);
  });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const pages = await selectPages(args);
  if (pages.length === 0)
    throw new Error("No reviewable http(s) page is visible in the Chrome CDP session.");

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const targetPath = path.join(OUTPUT_ROOT, `current-browser-target-${stamp}.json`);
  const outputDir = path.join(OUTPUT_ROOT, `current-browser-review-${stamp}`);
  fs.mkdirSync(OUTPUT_ROOT, { recursive: true });
  fs.writeFileSync(targetPath, `${JSON.stringify(pages.map((page) => ({
    url: page.url,
    category: args.category,
    pageType: args.pageType,
  })), null, 2)}\n`);

  const result = spawnSync(process.execPath, [
    "scripts/review-general-page-product-quality.mjs",
    "--input", targetPath,
    "--allow-network",
    "--source", "cdp",
    "--cdp-port", String(args.cdpPort),
    "--limit", String(pages.length),
    "--concurrency", String(Math.min(args.concurrency, pages.length)),
    "--timeout-ms", String(args.timeoutMs),
    "--output-dir", outputDir,
  ], {
    cwd: process.cwd(),
    stdio: "inherit",
  });
  if (result.status !== 0)
    process.exit(result.status ?? 1);

  const report = JSON.parse(fs.readFileSync(path.join(outputDir, "review.json"), "utf8"));
  const safePages = pages.map((page) => ({
    titleLength: page.title.length,
    host: safeSmokeHost(page.url),
  }));
  const sanitized = {
    selectedPages: safePages,
    artifact: {
      targetPath,
      outputDir,
      summaryJsonPath: path.join(outputDir, "current-browser-smoke-summary.json"),
      summaryMarkdownPath: path.join(outputDir, "current-browser-smoke-summary.md"),
    },
    sourceMode: report.input?.sourceMode,
    aggregate: report.aggregate,
    threshold: evaluateSmokeThreshold(report, args),
    results: report.results.map((item, index) => sanitizedResult(item, safePages[index])),
  };
  writeSmokeSummary(sanitized, args);
  console.log("general-page current-browser smoke summary");
  console.log(JSON.stringify(sanitized, null, 2));
  if (sanitized.threshold && !sanitized.threshold.pass) {
    console.error(`general-page current-browser smoke failed: ${sanitized.threshold.failures.join("; ")}`);
    process.exit(1);
  }
}

function parseArgs(argv) {
  return {
    cdpPort: numericArg(argv, "--cdp-port", DEFAULT_CDP_PORT, { min: 1, max: 65535 }),
    timeoutMs: numericArg(argv, "--timeout-ms", DEFAULT_TIMEOUT_MS, { min: 1000, max: 60000 }),
    concurrency: numericArg(argv, "--concurrency", 2, { min: 1, max: 8 }),
    limit: numericArg(argv, "--limit", 6, { min: 1, max: 30 }),
    minPageCount: optionalNumericArg(argv, "--min-page-count", { min: 1, max: 30 }),
    maxReadyCount: optionalNumericArg(argv, "--max-ready-count", { min: 0, max: 30 }),
    maxErrorCount: optionalNumericArg(argv, "--max-error-count", { min: 0, max: 30 }),
    maxEmptyOrBlockedCount: optionalNumericArg(argv, "--max-empty-or-blocked-count", { min: 0, max: 30 }),
    failOnIssueTags: repeatedStringArg(argv, "--fail-on-issue-tag").flatMap((value) =>
      value.split(",").map((tag) => tag.trim()).filter(Boolean)
    ).map((tag) => safeIssueTag(tag, "--fail-on-issue-tag")),
    allOpen: argv.includes("--all-open"),
    urlPattern: stringArg(argv, "--url-pattern"),
    category: safeLabelArg(argv, "--category", "current-browser-smoke"),
    pageType: safeLabelArg(argv, "--page-type", "unknown"),
  };
}

function stringArg(argv, name) {
  const index = argv.indexOf(name);
  if (index < 0) return undefined;
  if (argv[index + 1] === undefined || argv[index + 1].startsWith("--"))
    throw new Error(`${name} requires a value.`);
  return argv[index + 1];
}

function repeatedStringArg(argv, name) {
  const values = [];
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === name && argv[index + 1] !== undefined) {
      if (argv[index + 1].startsWith("--"))
        throw new Error(`${name} requires a value.`);
      values.push(argv[index + 1]);
      index += 1;
    }
  }
  return values;
}

function safeLabelArg(argv, name, fallback) {
  const value = stringArg(argv, name) ?? fallback;
  if (!/^[a-z0-9._:-]{1,80}$/i.test(value))
    throw new Error(`${name} must be a short public-safe label using letters, numbers, dot, underscore, colon, or dash.`);
  return value;
}

function safeIssueTag(value, name) {
  if (!/^[a-z0-9._:-]{1,120}$/i.test(value))
    throw new Error(`${name} must use public-safe issue tags with letters, numbers, dot, underscore, colon, or dash.`);
  return value;
}

function optionalNumericArg(argv, name, { min, max }) {
  const raw = stringArg(argv, name);
  if (raw === undefined)
    return undefined;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < min || value > max)
    throw new Error(`${name} must be an integer between ${min} and ${max}.`);
  return value;
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

function readyCount(report) {
  return report.results.filter((item) => item.modelContext?.modelReadiness === "ready").length;
}

function evaluateSmokeThreshold(report, args) {
  const thresholds = {
    minPageCount: args.minPageCount,
    maxReadyCount: args.maxReadyCount,
    maxErrorCount: args.maxErrorCount,
    maxEmptyOrBlockedCount: args.maxEmptyOrBlockedCount,
    failOnIssueTags: args.failOnIssueTags?.length ? args.failOnIssueTags : undefined,
  };
  const enabled = Object.values(thresholds).some((value) =>
    Array.isArray(value) ? value.length > 0 : value !== undefined
  );
  if (!enabled) return undefined;

  const issueTagHits = countIssueTagHits(report, thresholds.failOnIssueTags ?? []);
  const pageCount = Array.isArray(report.results) ? report.results.length : 0;
  const counts = {
    pageCount,
    readyCount: readyCount(report),
    errorCount: report.aggregate?.errorCount ?? report.results.filter((item) => item.errorKind).length,
    emptyOrBlockedCount: report.aggregate?.emptyOrBlockedCount ?? report.results.filter((item) => !item.ok && item.surface).length,
    issueTagHits,
  };
  const failures = [];
  if (thresholds.minPageCount !== undefined && counts.pageCount < thresholds.minPageCount)
    failures.push(`pageCount=${counts.pageCount} < minPageCount=${thresholds.minPageCount}`);
  if (thresholds.maxReadyCount !== undefined && counts.readyCount > thresholds.maxReadyCount)
    failures.push(`readyCount=${counts.readyCount} > maxReadyCount=${thresholds.maxReadyCount}`);
  if (thresholds.maxErrorCount !== undefined && counts.errorCount > thresholds.maxErrorCount)
    failures.push(`errorCount=${counts.errorCount} > maxErrorCount=${thresholds.maxErrorCount}`);
  if (thresholds.maxEmptyOrBlockedCount !== undefined && counts.emptyOrBlockedCount > thresholds.maxEmptyOrBlockedCount)
    failures.push(`emptyOrBlockedCount=${counts.emptyOrBlockedCount} > maxEmptyOrBlockedCount=${thresholds.maxEmptyOrBlockedCount}`);
  for (const tag of Object.keys(issueTagHits)) {
    if (issueTagHits[tag] > 0)
      failures.push(`issueTag=${tag} hit ${issueTagHits[tag]}`);
  }

  return {
    pass: failures.length === 0,
    failures,
    thresholds,
    counts,
  };
}

function countIssueTagHits(report, failOnIssueTags) {
  const tags = new Set(failOnIssueTags);
  if (tags.size === 0) return {};
  const hits = Object.fromEntries([...tags].map((tag) => [tag, 0]));
  for (const item of report.results ?? []) {
    for (const tag of item.autoReview?.issueTags ?? []) {
      if (tags.has(tag))
        hits[tag] += 1;
    }
  }
  return hits;
}

async function selectPages(args) {
  const targets = await fetchJson(`http://127.0.0.1:${args.cdpPort}/json`);
  const pages = targets
    .filter((target) =>
      target.type === "page" &&
      target.webSocketDebuggerUrl &&
      typeof target.url === "string" &&
      /^https?:\/\//i.test(target.url)
    )
    .map((target) => ({
      title: String(target.title ?? ""),
      url: target.url,
      webSocketDebuggerUrl: target.webSocketDebuggerUrl,
    }));

  const pattern = args.urlPattern ? new RegExp(args.urlPattern) : undefined;
  const matchingPages = pattern
    ? pages.filter((page) => pattern.test(page.url) || pattern.test(page.title))
    : pages;
  if (args.allOpen)
    return dedupePages(matchingPages).slice(0, args.limit);

  const inspected = [];
  for (const page of matchingPages) {
    const state = await evaluatePageState(page.webSocketDebuggerUrl).catch(() => null);
    inspected.push({ ...page, state });
  }
  const selected = inspected.find((page) => page.state?.visibilityState === "visible") ?? inspected[0] ?? matchingPages[0];
  return selected ? [selected] : [];
}

function dedupePages(pages) {
  const seen = new Set();
  const unique = [];
  for (const page of pages) {
    const key = canonicalPageKey(page.url);
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(page);
  }
  return unique;
}

function canonicalPageKey(url) {
  try {
    const parsed = new URL(url);
    parsed.hash = "";
    parsed.searchParams.sort();
    return parsed.href;
  } catch {
    return url;
  }
}

function sanitizedResult(item, page) {
  return {
    host: page?.host ?? safeSmokeHost(item.url),
    ok: item.ok,
    category: item.category,
    pageType: item.pageType,
    textLength: item.surface?.textLength,
    extraction: item.surface?.extraction,
    linkCount: item.surface?.linkCount,
    imageCount: item.surface?.imageCount,
    modelReadiness: item.modelContext?.modelReadiness,
    modelEligible: item.modelContext?.modelEligible,
    qualityIssues: item.modelContext?.qualityIssues,
    modelTextLength: item.modelContext?.textLength,
    modelLinkCount: item.modelContext?.links?.length,
    imageAltCount: item.modelContext?.imageAltText?.length,
    suggestedVerdict: item.autoReview?.suggestedVerdict,
    issueTags: item.autoReview?.issueTags,
    errorKind: item.errorKind,
  };
}

async function evaluatePageState(webSocketDebuggerUrl) {
  const client = await connect(webSocketDebuggerUrl);
  try {
    const evaluated = await client.send("Runtime.evaluate", {
      expression: "({ visibilityState: document.visibilityState, href: location.href, title: document.title })",
      returnByValue: true,
    });
    return evaluated?.result?.value ?? null;
  } finally {
    client.close();
  }
}

function connect(webSocketDebuggerUrl) {
  return new Promise((resolveConnect, rejectConnect) => {
    const ws = new WebSocket(webSocketDebuggerUrl);
    let nextId = 1;
    const pending = new Map();
    const timer = setTimeout(() => {
      try { ws.close(); } catch { /* ignore */ }
      rejectConnect(new Error("cdp websocket timeout"));
    }, 5_000);

    ws.addEventListener("open", () => {
      clearTimeout(timer);
      resolveConnect({
        send(method, params = {}) {
          return new Promise((resolveSend, rejectSend) => {
            const id = nextId;
            nextId += 1;
            pending.set(id, { resolve: resolveSend, reject: rejectSend });
            ws.send(JSON.stringify({ id, method, params }));
          });
        },
        close() {
          try { ws.close(); } catch { /* ignore */ }
        },
      });
    }, { once: true });

    ws.addEventListener("error", () => {
      clearTimeout(timer);
      rejectConnect(new Error("cdp websocket connection failed"));
    }, { once: true });

    ws.addEventListener("message", (event) => {
      let message;
      try {
        message = JSON.parse(String(event.data));
      } catch {
        return;
      }
      if (typeof message.id !== "number" || !pending.has(message.id)) return;
      const entry = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) entry.reject(new Error(message.error.message ?? "cdp command failed"));
      else entry.resolve(message.result);
    });
  });
}

async function fetchJson(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(8_000) });
  if (!response.ok)
    throw new Error(`cdp http ${response.status} for ${url}`);
  return response.json();
}

function safeSmokeHost(url) {
  try {
    const hostname = new URL(url).hostname.toLowerCase();
    if (isLocalhost(hostname))
      return "localhost";
    if (isPrivateHostname(hostname))
      return "private-host";
    return hostname;
  } catch {
    return "";
  }
}

function isLocalhost(hostname) {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1" || hostname === "[::1]";
}

function isPrivateHostname(hostname) {
  return hostname.endsWith(".local") ||
    hostname.endsWith(".internal") ||
    hostname.endsWith(".lan") ||
    /^10\./.test(hostname) ||
    /^192\.168\./.test(hostname) ||
    /^172\.(1[6-9]|2\d|3[0-1])\./.test(hostname);
}

function writeSmokeSummary(summary, args) {
  assertPublicSmokeSummary(summary);
  fs.writeFileSync(summary.artifact.summaryJsonPath, `${JSON.stringify(summary, null, 2)}\n`);
  fs.writeFileSync(summary.artifact.summaryMarkdownPath, renderSmokeSummaryMarkdown(summary, args));
}

function assertPublicSmokeSummary(value, pathLabel = "summary") {
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertPublicSmokeSummary(item, `${pathLabel}[${index}]`));
    return;
  }
  if (value && typeof value === "object") {
    for (const [key, nested] of Object.entries(value)) {
      if (PUBLIC_SUMMARY_FORBIDDEN_KEYS.has(key))
        throw new Error(`Public smoke summary must not include private field ${pathLabel}.${key}`);
      assertPublicSmokeSummary(nested, `${pathLabel}.${key}`);
    }
    return;
  }
  if (typeof value !== "string") return;
  for (const pattern of PUBLIC_SUMMARY_FORBIDDEN_STRING_PATTERNS) {
    if (pattern.test(value))
      throw new Error(`Public smoke summary must not include private-looking string at ${pathLabel}`);
  }
}

function renderSmokeSummaryMarkdown(summary, args) {
  const rows = summary.results.map((item, index) => [
    index + 1,
    item.host || "(unknown)",
    formatExtraction(item.extraction),
    item.modelReadiness ?? "(none)",
    item.suggestedVerdict ?? "(none)",
    item.modelTextLength ?? 0,
    item.modelLinkCount ?? 0,
    (item.issueTags ?? []).join(", ") || "(none)",
  ].map(markdownCell));

  return `# General Page Current-Browser Smoke Summary

Generated: ${new Date().toISOString()}
Source mode: ${summary.sourceMode ?? "(unknown)"}
Page count: ${summary.results.length}
Threshold: ${summary.threshold ? (summary.threshold.pass ? "pass" : "fail") : "(none)"}

This summary is public-safe metadata derived from a private live-CDP smoke run.
It intentionally omits real URLs, page titles, copied text, extracted previews,
screenshots, and per-target notes. The full private artifacts remain under
\`${summary.artifact.outputDir}\` and must not be committed.

## Command Shape

- allOpen: ${args.allOpen}
- category: ${args.category}
- pageType: ${args.pageType}
- limit: ${args.limit}
- concurrency: ${args.concurrency}
- timeoutMs: ${args.timeoutMs}
- minPageCount: ${args.minPageCount ?? "(none)"}
- maxReadyCount: ${args.maxReadyCount ?? "(none)"}
- maxErrorCount: ${args.maxErrorCount ?? "(none)"}
- maxEmptyOrBlockedCount: ${args.maxEmptyOrBlockedCount ?? "(none)"}
- failOnIssueTags: ${args.failOnIssueTags?.join(", ") || "(none)"}

## Threshold

\`\`\`json
${JSON.stringify(summary.threshold ?? null, null, 2)}
\`\`\`

## Aggregate

\`\`\`json
${JSON.stringify(summary.aggregate ?? {}, null, 2)}
\`\`\`

## Results

| # | Host | Extraction | Model readiness | Suggested verdict | Model chars | Model links | Issue tags |
| --- | --- | --- | --- | --- | ---: | ---: | --- |
${rows.map((row) => `| ${row.join(" | ")} |`).join("\n")}
`;
}

function markdownCell(value) {
  return String(value).replace(/\|/g, "\\|").replace(/\n/g, " ");
}

function formatExtraction(extraction) {
  if (!extraction) return "(none)";
  const method = extraction.method ?? "unknown-method";
  const status = extraction.status ?? "unknown-status";
  const warnings = Array.isArray(extraction.warnings) && extraction.warnings.length > 0
    ? ` (${extraction.warnings.join(", ")})`
    : "";
  return `${method}/${status}${warnings}`;
}

function isDirectRun() {
  return process.argv[1] && import.meta.url === new URL(process.argv[1], "file:").href;
}

export {
  assertPublicSmokeSummary,
  evaluateSmokeThreshold,
  parseArgs as parseCurrentBrowserSmokeArgs,
  renderSmokeSummaryMarkdown,
  safeSmokeHost,
};
