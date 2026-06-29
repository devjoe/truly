#!/usr/bin/env node

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const DIST_BUILD_ID = resolve(ROOT, "dist", "build-id.txt");
const CDP_PORT = Number(process.env.CDP_PORT || 9222);
const CDP_BASE = `http://127.0.0.1:${CDP_PORT}`;
const EXPECT_LOCALE = (process.env.TRULY_AUDIT_EXPECT_LOCALE || "").trim();
const REQUESTED_TARGET_ID = (process.env.TRULY_AUDIT_TARGET_ID || "").trim();
const STAMP = new Date().toISOString().replace(/[:.]/g, "-");
const OUT_DIR = resolve(ROOT, "tmp", `facebook-current-audit-${STAMP}`);

function usage() {
  console.log(`Usage: node scripts/audit-facebook-current.mjs

Audits the current logged-in Facebook page in the existing Chrome CDP session.
Artifacts are written under tmp/ and are intentionally not suitable for commit.

Environment:
  CDP_PORT=9222
  TRULY_AUDIT_EXPECT_LOCALE=zh|en|zh-Hant|zh-TW
  TRULY_AUDIT_TARGET_ID=<Chrome-CDP-target-id>
`);
}

if (process.argv.includes("--help") || process.argv.includes("-h")) {
  usage();
  process.exit(0);
}

function readExpectedBuildId() {
  try {
    return readFileSync(DIST_BUILD_ID, "utf8").trim();
  } catch (error) {
    throw new Error(`Unable to read ${relative(ROOT, DIST_BUILD_ID)}. Run npm run build:dev first. ${error.message}`);
  }
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

function connectCdp(webSocketDebuggerUrl) {
  if (typeof WebSocket !== "function") {
    throw new Error("global WebSocket is unavailable in this Node runtime");
  }

  const ws = new WebSocket(webSocketDebuggerUrl);
  let nextId = 1;
  const pending = new Map();
  const opened = new Promise((resolveOpen, rejectOpen) => {
    ws.addEventListener("open", () => resolveOpen());
    ws.addEventListener("error", () => rejectOpen(new Error("CDP websocket connection failed")), { once: true });
  });

  ws.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    if (!message.id || !pending.has(message.id)) return;
    const { resolve, reject } = pending.get(message.id);
    pending.delete(message.id);
    if (message.error) reject(new Error(message.error.message ?? JSON.stringify(message.error)));
    else resolve(message.result);
  });

  async function send(method, params = {}) {
    await opened;
    const id = nextId++;
    const response = new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
    ws.send(JSON.stringify({ id, method, params }));
    return response;
  }

  return {
    async evaluate(expression) {
      const result = await send("Runtime.evaluate", {
        expression,
        awaitPromise: true,
        returnByValue: true,
        timeout: 10_000,
      });
      if (result.exceptionDetails) {
        throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text || "Runtime.evaluate failed");
      }
      return result.result?.value ?? null;
    },
    async screenshot(path) {
      await send("Page.enable").catch(() => {});
      const result = await send("Page.captureScreenshot", {
        format: "png",
        fromSurface: true,
        captureBeyondViewport: false,
      });
      writeFileSync(path, Buffer.from(result.data, "base64"));
    },
    close() {
      ws.close();
    },
  };
}

function isFacebookTarget(target) {
  return target.type === "page" &&
    typeof target.url === "string" &&
    /^https?:\/\/([^/]+\.)?facebook\.com\//.test(target.url) &&
    target.webSocketDebuggerUrl;
}

async function evaluateTarget(target, expression) {
  const cdp = connectCdp(target.webSocketDebuggerUrl);
  try {
    return await cdp.evaluate(expression);
  } finally {
    cdp.close();
  }
}

async function selectFacebookTarget(targets) {
  const facebookTargets = targets.filter(isFacebookTarget);
  if (facebookTargets.length === 0) {
    throw new Error("No facebook.com page found in the current Chrome CDP session.");
  }

  if (REQUESTED_TARGET_ID) {
    const target = facebookTargets.find((entry) => entry.id === REQUESTED_TARGET_ID);
    if (!target) {
      throw new Error(`Requested Facebook target not found: ${REQUESTED_TARGET_ID}`);
    }
    return {
      target,
      states: [{
        id: target.id,
        url: target.url,
        title: target.title || "",
        visibility: await evaluateTarget(target, "document.visibilityState").catch(() => "unknown"),
        buildId: await evaluateTarget(target, "document.documentElement.dataset.trulyBuildId || null").catch(() => null),
      }],
    };
  }

  const states = [];
  for (const target of facebookTargets) {
    states.push({
      id: target.id,
      url: target.url,
      title: target.title || "",
      visibility: await evaluateTarget(target, "document.visibilityState").catch(() => "unknown"),
      buildId: await evaluateTarget(target, "document.documentElement.dataset.trulyBuildId || null").catch(() => null),
    });
  }

  const visible = facebookTargets.find((target) => states.find((state) => state.id === target.id)?.visibility === "visible");
  return {
    target: visible || facebookTargets.find((target) => target.url.includes("/groups/")) || facebookTargets[0],
    states,
  };
}

async function findTrulyServiceWorker(targets, expectedBuildId) {
  const workers = targets.filter((target) =>
    target.type === "service_worker" &&
    typeof target.url === "string" &&
    target.url.startsWith("chrome-extension://") &&
    target.webSocketDebuggerUrl
  );

  const found = [];
  for (const target of workers) {
    const cdp = connectCdp(target.webSocketDebuggerUrl);
    try {
      const meta = await cdp.evaluate(`(() => {
        try {
          const manifest = chrome.runtime.getManifest();
          return {
            id: chrome.runtime.id,
            name: manifest.name,
            version: manifest.version,
            versionName: manifest.version_name || "",
            buildId: globalThis.__TRULY_BUILD_ID || null,
            url: globalThis.location?.href || ""
          };
        } catch (error) {
          return { error: String(error) };
        }
      })()`).catch(() => null);
      if (meta?.name === "Truly") found.push({ target, meta });
    } finally {
      cdp.close();
    }
  }

  const truly = found.find((entry) => entry.meta.buildId === expectedBuildId) || found[0] || null;
  return { found: found.map((entry) => entry.meta), selected: truly };
}

async function getContentScriptStats(serviceWorkerEntry, pageUrl) {
  if (!serviceWorkerEntry) return { error: "Truly service worker not found" };
  const cdp = connectCdp(serviceWorkerEntry.target.webSocketDebuggerUrl);
  try {
    const escapedUrl = JSON.stringify(pageUrl);
    const stats = await cdp.evaluate(`new Promise((resolve) => {
      chrome.tabs.query({}, (tabs) => {
        const target = tabs.find((tab) => tab.url === ${escapedUrl}) ||
          tabs.find((tab) => /^https?:\\/\\/([^/]+\\.)?facebook\\.com\\//.test(tab.url || ""));
        if (!target?.id) return resolve({ error: "Facebook tab not found", tabCount: tabs.length });
        chrome.tabs.sendMessage(target.id, { type: "GET_STATS" }, (response) => {
          resolve(response || { error: chrome.runtime.lastError?.message || "empty GET_STATS response" });
        });
      });
    })`).catch((error) => ({ error: error.message }));
    const logs = await cdp.evaluate(`new Promise((resolve) => {
      chrome.tabs.query({}, (tabs) => {
        const target = tabs.find((tab) => tab.url === ${escapedUrl}) ||
          tabs.find((tab) => /^https?:\\/\\/([^/]+\\.)?facebook\\.com\\//.test(tab.url || ""));
        if (!target?.id) return resolve({ error: "Facebook tab not found", tabCount: tabs.length });
        chrome.tabs.sendMessage(target.id, { type: "EXPORT_LOG_BUFFER" }, (response) => {
          resolve(response || { error: chrome.runtime.lastError?.message || "empty EXPORT_LOG_BUFFER response" });
        });
      });
    })`).catch((error) => ({ error: error.message }));
    return { stats, logs };
  } finally {
    cdp.close();
  }
}

function localeExpectationMatches(signals) {
  if (!EXPECT_LOCALE) return { ok: true, detail: "not requested" };
  const expected = EXPECT_LOCALE.toLowerCase();
  if (expected === "zh" || expected === "zh-tw" || expected === "zh-hant") {
    return {
      ok: signals.htmlLang?.toLowerCase().startsWith("zh") || signals.hasChineseChrome,
      detail: `htmlLang=${signals.htmlLang || "(none)"} chineseChrome=${signals.hasChineseChrome}`,
    };
  }
  if (expected === "en") {
    return {
      ok: !signals.hasChineseChrome && signals.hasEnglishChrome,
      detail: `htmlLang=${signals.htmlLang || "(none)"} englishChrome=${signals.hasEnglishChrome} chineseChrome=${signals.hasChineseChrome}`,
    };
  }
  return { ok: false, detail: `unsupported TRULY_AUDIT_EXPECT_LOCALE=${EXPECT_LOCALE}` };
}

function summarizeLogWarnings(logPayload) {
  const logs = Array.isArray(logPayload?.logs) ? logPayload.logs : Array.isArray(logPayload) ? logPayload : [];
  return logs
    .filter((entry) => entry?.level === "warn" || entry?.level === "error")
    .slice(-20)
    .map((entry) => ({
      level: entry.level,
      text: String(entry.text || "").slice(0, 220),
    }));
}

function formatStep(ok, label, detail = "") {
  return `- ${ok ? "[OK]" : "[FAIL]"} ${label}${detail ? `: ${detail}` : ""}`;
}

function writeSummary(report, failures) {
  const lines = [
    "# Facebook Current Page Audit",
    "",
    `- Captured at: ${report.capturedAt}`,
    `- Page: ${report.page.url}`,
    `- Expected build: ${report.expectedBuildId}`,
    `- Page build: ${report.audit.buildId || "(missing)"}`,
    `- Service worker build: ${report.serviceWorker?.selected?.meta?.buildId || "(missing)"}`,
    `- Locale: ${report.audit.localeSignals.htmlLang || "(none)"}`,
    `- Heads-up hosts: ${report.audit.counts.hosts}`,
    `- Tagged posts: ${report.audit.counts.taggedPosts}`,
    `- Selector health: ${report.runtime.stats?.selectorHealth || "(unavailable)"}`,
    "",
    "## Verdict",
    "",
    failures.length === 0 ? "PASS" : "FAIL",
    "",
    "## Checks",
    "",
    ...report.checks.map((check) => formatStep(check.ok, check.label, check.detail)),
    "",
    "## Heads-Up Boundary Sample",
    "",
    ...report.audit.hostDetails.slice(0, 8).map((host) =>
      `- #${host.index}: host=${host.hostRect?.w || 0}x${host.hostRect?.h || 0} article=${host.articleRect?.w || 0}x${host.articleRect?.h || 0} problems=${host.problems.length ? host.problems.join(", ") : "none"}`
    ),
    "",
    "## Screenshots",
    "",
    ...report.screenshots.map((file) => `- ${relative(ROOT, file)}`),
    "",
    "## Runtime Warnings",
    "",
    ...(report.runtime.warnings.length
      ? report.runtime.warnings.map((warning) => `- ${warning.level}: ${warning.text}`)
      : ["- none in exported log tail"]),
    "",
    "## Public Repo Boundary",
    "",
    "This artifact may include private screenshots or live-page-derived text. Keep it under tmp/ and do not commit it.",
    "",
  ];
  writeFileSync(resolve(OUT_DIR, "summary.md"), `${lines.join("\n")}\n`);
}

const expectedBuildId = readExpectedBuildId();
mkdirSync(OUT_DIR, { recursive: true });

const targets = await fetchJson(`${CDP_BASE}/json/list`).catch((error) => {
  throw new Error(`Unable to reach Chrome CDP at ${CDP_BASE}. Start Chrome with remote debugging. ${error.message}`);
});

const { target: pageTarget, states: pageStates } = await selectFacebookTarget(targets);
const serviceWorker = await findTrulyServiceWorker(targets, expectedBuildId);
const page = connectCdp(pageTarget.webSocketDebuggerUrl);
const screenshots = [];

try {
  await new Promise((resolve) => setTimeout(resolve, 1000));
  const initialScroll = await page.evaluate("window.scrollY").catch(() => 0);
  const initialViewport = resolve(OUT_DIR, "viewport-initial.png");
  await page.screenshot(initialViewport).catch(() => {});
  screenshots.push(initialViewport);

  const audit = await page.evaluate(`(() => {
    const norm = (s) => (s || "").replace(/\\s+/g, " ").trim();
    const rectOf = (el) => {
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return {
        x: Math.round(r.x * 10) / 10,
        y: Math.round(r.y * 10) / 10,
        w: Math.round(r.width * 10) / 10,
        h: Math.round(r.height * 10) / 10,
        top: Math.round(r.top * 10) / 10,
        bottom: Math.round(r.bottom * 10) / 10,
        left: Math.round(r.left * 10) / 10,
        right: Math.round(r.right * 10) / 10
      };
    };
    const visibleText = (el) => norm(el?.innerText || el?.textContent || "");
    const hosts = Array.from(document.querySelectorAll(".truly-headsup-host,.fc-headsup-host"));
    const taggedPosts = Array.from(document.querySelectorAll("[data-truly-id]"));
    const articles = Array.from(document.querySelectorAll('[role="article"], article'));
    const viewport = { w: window.innerWidth, h: window.innerHeight, scrollY: window.scrollY };
    const hostDetails = hosts.map((host, index) => {
      const root = host.shadowRoot || host;
      const headsUp = root.querySelector(".truly-headsup,.fc-headsup");
      const summary = root.querySelector(".truly-headsup-summary,.fc-headsup-summary,[aria-expanded]") || root.querySelector("button");
      const detail = root.querySelector(".truly-headsup-detail,.fc-headsup-detail");
      const article = host.closest("[data-truly-id],[role='article'],article");
      const hostRect = rectOf(host);
      const articleRect = rectOf(article);
      const summaryText = visibleText(summary);
      const detailText = visibleText(detail);
      const problems = [];
      if (!article) problems.push("missing-post-boundary");
      if (articleRect?.h > 3000) problems.push("oversized-post-boundary:" + articleRect.h);
      if (articleRect && hostRect) {
        if (hostRect.w < articleRect.w * 0.7) problems.push("host-too-narrow:" + hostRect.w + "/" + articleRect.w);
        if (Math.abs(hostRect.x - articleRect.x) > 12) problems.push("host-x-mismatch:" + hostRect.x + "/" + articleRect.x);
        if (hostRect.y < articleRect.y - 4 || hostRect.y > articleRect.y + 72) problems.push("host-y-unexpected:" + hostRect.y + "/" + articleRect.y);
      }
      if (hostRect && (hostRect.left < -1 || hostRect.right > viewport.w + 1)) problems.push("host-horizontal-overflow");
      if (!summaryText) problems.push("empty-summary");
      return {
        index,
        hostRect,
        articleRect,
        trulyId: article?.getAttribute("data-truly-id") || null,
        expanded: summary?.getAttribute("aria-expanded") || null,
        className: headsUp?.className || null,
        summaryText,
        detailText: detailText.slice(0, 600),
        hasNestedFeed: article ? article.getAttribute("role") !== "feed" && !!article.querySelector('[role="feed"]') : false,
        hasComposerText: article ? /Write something|你在想什麼|撰寫|匿名貼文|不具名貼文|心情\\/活動|感受\\/活動|投票|票選活動/.test(visibleText(article).slice(0, 500)) : false,
        problems
      };
    });
    const bodyText = visibleText(document.body).slice(0, 2500);
    return {
      url: location.href,
      title: document.title,
      buildId: document.documentElement.dataset.trulyBuildId || null,
      viewport,
      localeSignals: {
        htmlLang: document.documentElement.lang || null,
        hasChineseChrome: /留言|分享|讚|回覆|首頁|社團|通知|你在想什麼|留個言|撰寫|不具名貼文|感受\\/活動|票選活動/.test(bodyText),
        hasEnglishChrome: /\\b(Comment|Share|Like|Home|Groups|Notifications|Write something)\\b/.test(bodyText)
      },
      counts: {
        hosts: hosts.length,
        taggedPosts: taggedPosts.length,
        articles: articles.length,
        skipped: document.querySelectorAll("[data-truly-skip-reason]").length
      },
      hostDetails
    };
  })()`);

  const screenshotCount = Math.min(3, audit.hostDetails.length);
  for (let i = 0; i < screenshotCount; i++) {
    const path = resolve(OUT_DIR, `host-${i}-viewport.png`);
    await page.evaluate(`(() => {
      const host = Array.from(document.querySelectorAll(".truly-headsup-host,.fc-headsup-host"))[${i}];
      host?.scrollIntoView({ block: "start", inline: "nearest", behavior: "instant" });
    })()`).catch(() => {});
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 250));
    await page.screenshot(path).catch(() => {});
    screenshots.push(path);
  }

  const firstInteraction = await page.evaluate(`(() => {
    const norm = (s) => (s || "").replace(/\\s+/g, " ").trim();
    const host = document.querySelector(".truly-headsup-host,.fc-headsup-host");
    if (!host) return { ok: false, error: "host not found" };
    host.scrollIntoView({ block: "start", inline: "nearest", behavior: "instant" });
    const root = host.shadowRoot || host;
    const headsUp = root.querySelector(".truly-headsup,.fc-headsup");
    const summary = root.querySelector(".truly-headsup-summary,.fc-headsup-summary,[aria-expanded]") || root.querySelector("button");
    const before = summary?.getAttribute("aria-expanded") || null;
    summary?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    return new Promise((resolve) => setTimeout(() => {
      resolve({
        ok: true,
        before,
        after: summary?.getAttribute("aria-expanded") || null,
        text: norm(headsUp?.innerText || headsUp?.textContent || "").slice(0, 600)
      });
    }, 350));
  })()`).catch((error) => ({ ok: false, error: error.message }));

  const runtime = await getContentScriptStats(serviceWorker.selected, audit.url);
  const warnings = summarizeLogWarnings(runtime.logs);
  const locale = localeExpectationMatches(audit.localeSignals);
  const hostProblems = audit.hostDetails.flatMap((host) => host.problems.map((problem) => `host #${host.index}: ${problem}`));

  const checks = [
    { label: "Chrome CDP reachable", ok: true, detail: CDP_BASE },
    { label: "Truly service worker present", ok: Boolean(serviceWorker.selected), detail: serviceWorker.selected?.meta?.id || "" },
    {
      label: "service worker build fresh",
      ok: serviceWorker.selected?.meta?.buildId === expectedBuildId,
      detail: `sw=${serviceWorker.selected?.meta?.buildId || "(missing)"}`,
    },
    { label: "Facebook content script fresh", ok: audit.buildId === expectedBuildId, detail: `cs=${audit.buildId || "(missing)"}` },
    { label: "locale expectation", ok: locale.ok, detail: locale.detail },
    { label: "heads-up rendered", ok: audit.counts.hosts > 0, detail: String(audit.counts.hosts) },
    { label: "posts tagged", ok: audit.counts.taggedPosts > 0, detail: String(audit.counts.taggedPosts) },
    { label: "heads-up boundaries valid", ok: hostProblems.length === 0, detail: hostProblems.join("; ") || "none" },
    {
      label: "selector health",
      ok: !runtime.stats?.selectorHealth || runtime.stats.selectorHealth === "healthy",
      detail: runtime.stats?.selectorHealth || "(unavailable)",
    },
    {
      label: "heads-up expand toggles",
      ok: firstInteraction.ok && firstInteraction.before !== firstInteraction.after,
      detail: firstInteraction.ok ? `${firstInteraction.before} -> ${firstInteraction.after}` : firstInteraction.error,
    },
  ];

  await page.evaluate(`window.scrollTo(0, ${Number(initialScroll) || 0})`).catch(() => {});

  const report = {
    capturedAt: new Date().toISOString(),
    expectedBuildId,
    pageStates,
    page: { url: audit.url, title: audit.title, selectedTargetId: pageTarget.id },
    serviceWorker,
    audit,
    interaction: firstInteraction,
    runtime: {
      stats: runtime.stats || null,
      warnings,
      logExportError: runtime.logs?.error || null,
    },
    checks,
    screenshots,
    ok: checks.every((check) => check.ok),
  };
  const failures = checks.filter((check) => !check.ok);
  writeFileSync(resolve(OUT_DIR, "audit.json"), JSON.stringify(report, null, 2));
  writeSummary(report, failures);

  console.log(`[facebook-current-audit] artifact: ${relative(ROOT, OUT_DIR)}`);
  for (const check of checks) {
    console.log(`${check.ok ? "[OK]" : "[FAIL]"} ${check.label}${check.detail ? ` — ${check.detail}` : ""}`);
  }
  console.log(`[facebook-current-audit] summary: ${relative(ROOT, resolve(OUT_DIR, "summary.md"))}`);
  if (failures.length > 0) process.exitCode = 1;
} finally {
  page.close();
}
