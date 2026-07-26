#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { connectCdp } from "./lib/cdp-client.mjs";

const DEFAULT_CDP_ENDPOINT = "http://127.0.0.1:9222";
const DEFAULT_COUNT = 60;
const DEFAULT_TIMEOUT_MS = 15 * 60_000;
const POLL_MS = 500;

if (isDirectRun()) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}

export function isPrivateCaptureOutputPath(value, cwd = process.cwd()) {
  const resolved = path.resolve(cwd, value);
  const roots = [
    path.resolve(cwd, "tmp"),
    path.resolve(process.env.TMPDIR ?? "/tmp"),
    path.resolve("/tmp"),
    path.resolve("/private/tmp"),
  ];
  return roots.some((root) => resolved === root || resolved.startsWith(`${root}${path.sep}`));
}

export function runtimeCaptureIsComplete(
  captures,
  requestedCount,
  consumerDone,
  consumerTimeoutMs,
) {
  return Array.isArray(captures) &&
    captures.length >= requestedCount &&
    (consumerTimeoutMs === 0 || consumerDone === true);
}

export function selectInvestigationServiceWorker(targets) {
  return targets.find((target) =>
    target?.type === "service_worker" &&
    typeof target.webSocketDebuggerUrl === "string" &&
    /^chrome-extension:\/\//.test(target.url ?? ""),
  );
}

export async function findInvestigationServiceWorker(targets, connect = connectCdp) {
  const workers = targets.filter((target) =>
    target?.type === "service_worker" &&
    typeof target.webSocketDebuggerUrl === "string" &&
    /^chrome-extension:\/\//.test(target.url ?? ""),
  );
  for (const target of workers) {
    const client = connect(target.webSocketDebuggerUrl, { commandTimeoutMs: 5_000 });
    try {
      const identity = await client.evaluate(`(() => {
        try {
          return {
            name: chrome.runtime.getManifest().name,
            available: Boolean(globalThis.__trulyGeneralPageInvestigationCapture),
          };
        } catch {
          return { name: null, available: false };
        }
      })()`);
      if (identity?.name === "Truly" && identity.available) return target;
    } catch {
      // Another extension worker is not an error; continue probing.
    } finally {
      client.close();
    }
  }
  return undefined;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.reset && !isPrivateCaptureOutputPath(args.output)) {
    throw new Error("--output must stay under repo tmp/, the system temp directory, or /private/tmp");
  }
  const outputPath = args.output ? path.resolve(args.output) : undefined;
  if (outputPath && fs.existsSync(outputPath)) throw new Error("--output already exists; use a fresh path");

  const targets = await fetch(`${args.endpoint}/json`).then((response) => {
    if (!response.ok) throw new Error(`CDP target listing failed: ${response.status}`);
    return response.json();
  });
  const target = await findInvestigationServiceWorker(targets);
  if (!target) throw new Error("Truly extension service worker target not found");

  const client = connectCdp(target.webSocketDebuggerUrl, { commandTimeoutMs: 10_000 });
  let armed = false;
  try {
    if (args.reset) {
      const reset = await client.evaluate(`(() => {
        const capture = globalThis.__trulyGeneralPageInvestigationCapture;
        if (!capture || !Array.isArray(capture.items)) return false;
        capture.enabled = false;
        capture.consumerDone = false;
        capture.items.splice(0, capture.items.length);
        return true;
      })()`);
      if (!reset) throw new Error("runtime-envelope capture is unavailable");
      console.log(JSON.stringify({ result: "reset", targetActivated: false, browserFocusRequested: false }, null, 2));
      return;
    }

    const state = await client.evaluate(`(() => {
      const capture = globalThis.__trulyGeneralPageInvestigationCapture;
      if (!capture || !Array.isArray(capture.items)) return { available: false };
      return { available: true, enabled: capture.enabled, items: capture.items.length, maxItems: capture.maxItems };
    })()`);
    if (!state?.available) throw new Error("runtime-envelope capture is unavailable; build and reload the current development extension");
    if (state.enabled) throw new Error("runtime-envelope capture is already enabled by another collector");
    if (state.maxItems < args.count) throw new Error(`capture buffer holds ${state.maxItems}, fewer than requested ${args.count}`);

    await client.evaluate(`(() => {
      const capture = globalThis.__trulyGeneralPageInvestigationCapture;
      capture.items.splice(0, capture.items.length);
      capture.consumerDone = false;
      capture.enabled = true;
      return true;
    })()`);
    armed = true;

    const deadline = Date.now() + args.timeoutMs;
    let captures = [];
    let consumerDone = args.consumerTimeoutMs === 0;
    let consumerDeadline = null;
    while (Date.now() < (consumerDeadline ?? deadline)) {
      const snapshot = await client.evaluate(`(() => {
        const capture = globalThis.__trulyGeneralPageInvestigationCapture;
        const items = capture ? capture.items : [];
        const selected = ${JSON.stringify(args.scope)}
          ? items.filter((item) => item?.analysis?.scope === ${JSON.stringify(args.scope)})
          : items;
        return {
          captures: JSON.parse(JSON.stringify(selected)),
          consumerDone: Boolean(capture?.consumerDone),
        };
      })()`);
      captures = snapshot.captures;
      consumerDone = args.consumerTimeoutMs === 0 || snapshot.consumerDone;
      if (captures.length >= args.count) {
        if (consumerDone) break;
        consumerDeadline ??= Date.now() + args.consumerTimeoutMs;
      }
      await new Promise((resolve) => setTimeout(resolve, POLL_MS));
    }

    const selected = captures.slice(0, args.count);
    const complete = runtimeCaptureIsComplete(
      selected,
      args.count,
      consumerDone,
      args.consumerTimeoutMs,
    );
    fs.mkdirSync(path.dirname(outputPath), { recursive: true, mode: 0o700 });
    fs.writeFileSync(outputPath, `${JSON.stringify({
      schemaVersion: 1,
      privacyBoundary: "Private runtime-envelope capture. Contains authorized page or selection text. Do not commit to the public repository.",
      capturedAt: new Date().toISOString(),
      cdpEndpoint: new URL(args.endpoint).origin,
      targetUrl: target.url,
      requestedCount: args.count,
      requestedScope: args.scope,
      complete,
      captures: selected,
    }, null, 2)}\n`, { flag: "wx", mode: 0o600 });
    console.log(JSON.stringify({
      result: complete ? "pass" : "partial",
      output: privatePathLabel(outputPath),
      captured: selected.length,
      requested: args.count,
      consumerDone,
      targetActivated: false,
      browserFocusRequested: false,
    }, null, 2));
    if (!complete) process.exitCode = 1;
  } finally {
    if (armed) {
      await client.evaluate(`(() => {
      const capture = globalThis.__trulyGeneralPageInvestigationCapture;
      if (!capture) return false;
      capture.enabled = false;
      capture.consumerDone = false;
      capture.items.splice(0, capture.items.length);
        return true;
      })()`).catch(() => undefined);
    }
    client.close();
  }
}

function parseArgs(argv) {
  const reset = argv.includes("--reset");
  const output = stringArg(argv, "--output");
  if (!reset && !output) {
    throw new Error("Usage: node scripts/collect-general-page-runtime-envelopes-cdp.mjs --output tmp/private-capture.json [--count 60] [--scope page|focus] [--timeout-ms 900000] [--consumer-timeout-ms 0] | --reset");
  }
  if (reset && output) throw new Error("--reset cannot be combined with --output");
  const scope = stringArg(argv, "--scope");
  if (scope !== undefined && scope !== "page" && scope !== "focus") throw new Error("--scope must be page or focus");
  return {
    output,
    endpoint: stringArg(argv, "--endpoint") ?? DEFAULT_CDP_ENDPOINT,
    count: integerArg(argv, "--count", DEFAULT_COUNT, 1, 90),
    timeoutMs: integerArg(argv, "--timeout-ms", DEFAULT_TIMEOUT_MS, 1_000, 60 * 60_000),
    consumerTimeoutMs: integerArg(argv, "--consumer-timeout-ms", 0, 0, 5 * 60_000),
    scope,
    reset,
  };
}

function stringArg(argv, name) {
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] : undefined;
}

function integerArg(argv, name, fallback, min, max) {
  const raw = stringArg(argv, name);
  if (raw === undefined) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`${name} must be an integer between ${min} and ${max}`);
  }
  return value;
}

function privatePathLabel(outputPath) {
  return outputPath.startsWith(path.resolve(process.cwd(), "tmp") + path.sep)
    ? path.relative(process.cwd(), outputPath)
    : "<private-temp-path>";
}

function isDirectRun() {
  return process.argv[1] && import.meta.url === new URL(process.argv[1], "file:").href;
}
