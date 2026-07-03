#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const DEFAULT_CDP_PORT = 9222;
const DEFAULT_TIMEOUT_MS = 20_000;
const OUTPUT_ROOT = "tmp/general-page-product-quality";

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const page = await selectCurrentPage(args);
  if (!page)
    throw new Error("No reviewable http(s) page is visible in the Chrome CDP session.");

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const targetPath = path.join(OUTPUT_ROOT, `current-browser-target-${stamp}.json`);
  const outputDir = path.join(OUTPUT_ROOT, `current-browser-review-${stamp}`);
  fs.mkdirSync(OUTPUT_ROOT, { recursive: true });
  fs.writeFileSync(targetPath, `${JSON.stringify([{
    url: page.url,
    category: args.category,
    pageType: args.pageType,
  }], null, 2)}\n`);

  const result = spawnSync(process.execPath, [
    "scripts/review-general-page-product-quality.mjs",
    "--input", targetPath,
    "--allow-network",
    "--source", "cdp",
    "--cdp-port", String(args.cdpPort),
    "--limit", "1",
    "--concurrency", "1",
    "--timeout-ms", String(args.timeoutMs),
    "--output-dir", outputDir,
  ], {
    cwd: process.cwd(),
    stdio: "inherit",
  });
  if (result.status !== 0)
    process.exit(result.status ?? 1);

  const report = JSON.parse(fs.readFileSync(path.join(outputDir, "review.json"), "utf8"));
  const item = report.results[0] ?? {};
  const sanitized = {
    selectedPage: {
      titleLength: page.title.length,
      host: safeHost(page.url),
    },
    artifact: {
      targetPath,
      outputDir,
    },
    sourceMode: report.input?.sourceMode,
    aggregate: report.aggregate,
    result: {
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
    },
  };
  console.log("general-page current-browser smoke summary");
  console.log(JSON.stringify(sanitized, null, 2));
}

function parseArgs(argv) {
  return {
    cdpPort: numericArg(argv, "--cdp-port", DEFAULT_CDP_PORT, { min: 1, max: 65535 }),
    timeoutMs: numericArg(argv, "--timeout-ms", DEFAULT_TIMEOUT_MS, { min: 1000, max: 60000 }),
    urlPattern: stringArg(argv, "--url-pattern"),
    category: stringArg(argv, "--category") ?? "current-browser-smoke",
    pageType: stringArg(argv, "--page-type") ?? "unknown",
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

async function selectCurrentPage(args) {
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
  if (pattern) return pages.find((page) => pattern.test(page.url) || pattern.test(page.title));

  const inspected = [];
  for (const page of pages) {
    const state = await evaluatePageState(page.webSocketDebuggerUrl).catch(() => null);
    inspected.push({ ...page, state });
  }
  return inspected.find((page) => page.state?.visibilityState === "visible") ?? pages[0];
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

function safeHost(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return "";
  }
}

main().catch((error) => {
  console.error(error?.stack || String(error));
  process.exit(1);
});
