#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const CDP_PORT = Number(process.env.CDP_PORT || 9222);
const CDP_BASE = `http://127.0.0.1:${CDP_PORT}`;
const STAMP = new Date().toISOString().replace(/[:.]/g, "-");
const OUT_DIR = resolve(ROOT, "tmp", `facebook-open-tabs-audit-${STAMP}`);

function usage() {
  console.log(`Usage: node scripts/audit-facebook-open-tabs.mjs

Runs the current-page Facebook audit against every open facebook.com tab in the
existing Chrome CDP session. The repo intentionally does not keep a built-in URL
matrix; open the scenarios you want to cover, then run this command.

Environment:
  CDP_PORT=9222
  TRULY_AUDIT_EXPECT_LOCALE=zh|en|zh-Hant|zh-TW
`);
}

if (process.argv.includes("--help") || process.argv.includes("-h")) {
  usage();
  process.exit(0);
}

async function fetchJson(url, timeoutMs = 2500) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const response = await fetch(url, { cache: "no-store", signal: ctrl.signal });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

function isFacebookTarget(target) {
  return target.type === "page" &&
    typeof target.url === "string" &&
    /^https?:\/\/([^/]+\.)?facebook\.com\//.test(target.url) &&
    target.webSocketDebuggerUrl;
}

function targetKind(url) {
  try {
    const parsed = new URL(url);
    if (parsed.pathname.startsWith("/groups/")) return "group";
    if (parsed.pathname === "/" || parsed.pathname === "/home.php") return "feed";
    if (/\/posts\//.test(parsed.pathname) || /\/permalink\//.test(parsed.pathname)) return "post";
    if (/\/profile\.php/.test(parsed.pathname)) return "profile";
    return "facebook";
  } catch {
    return "facebook";
  }
}

mkdirSync(OUT_DIR, { recursive: true });

const targets = await fetchJson(`${CDP_BASE}/json/list`).catch((error) => {
  throw new Error(`Unable to reach Chrome CDP at ${CDP_BASE}. Start Chrome with remote debugging. ${error.message}`);
});

const facebookTargets = targets.filter(isFacebookTarget);
if (facebookTargets.length === 0) {
  throw new Error("No open facebook.com tabs found.");
}

const results = [];
for (const [index, target] of facebookTargets.entries()) {
  console.log(`[facebook-open-tabs-audit] ${index + 1}/${facebookTargets.length} ${targetKind(target.url)} ${target.title || target.url}`);
  const result = spawnSync(process.execPath, ["scripts/audit-facebook-current.mjs"], {
    cwd: ROOT,
    env: {
      ...process.env,
      TRULY_AUDIT_TARGET_ID: target.id,
    },
    encoding: "utf8",
  });
  const outputPath = resolve(OUT_DIR, `target-${index + 1}.log`);
  writeFileSync(outputPath, `${result.stdout || ""}${result.stderr || ""}`);
  const artifactMatch = (result.stdout || "").match(/artifact: (tmp\/facebook-current-audit-[^\s]+)/);
  results.push({
    index: index + 1,
    id: target.id,
    kind: targetKind(target.url),
    title: target.title || "",
    url: target.url,
    status: result.status,
    ok: result.status === 0,
    artifact: artifactMatch?.[1] || null,
    log: `tmp/facebook-open-tabs-audit-${STAMP}/target-${index + 1}.log`,
  });
}

const failures = results.filter((result) => !result.ok);
const summary = [
  "# Facebook Open Tabs Audit",
  "",
  `- Captured at: ${new Date().toISOString()}`,
  `- Targets: ${results.length}`,
  `- Verdict: ${failures.length === 0 ? "PASS" : "FAIL"}`,
  "",
  "## Targets",
  "",
  ...results.map((result) =>
    `- ${result.ok ? "[OK]" : "[FAIL]"} #${result.index} ${result.kind}: ${result.title || result.url}` +
    `${result.artifact ? ` (${result.artifact}/summary.md)` : ""}`
  ),
  "",
  "## Public Repo Boundary",
  "",
  "This artifact references live Facebook pages and may point to private screenshots. Keep it under tmp/ and do not commit it.",
  "",
].join("\n");

writeFileSync(resolve(OUT_DIR, "matrix.json"), JSON.stringify({
  capturedAt: new Date().toISOString(),
  cdpBase: CDP_BASE,
  results,
  ok: failures.length === 0,
}, null, 2));
writeFileSync(resolve(OUT_DIR, "summary.md"), `${summary}\n`);

console.log(`[facebook-open-tabs-audit] summary: tmp/facebook-open-tabs-audit-${STAMP}/summary.md`);
if (failures.length > 0) process.exit(1);
