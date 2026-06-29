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
const AUTO_RELOAD = /^(1|true|yes)$/i.test(process.env.TRULY_AUDIT_AUTO_RELOAD || "");
const ALLOW_FOCUS = /^(1|true|yes)$/i.test(process.env.CDP_ALLOW_FOCUS || "");
const STAMP = new Date().toISOString().replace(/[:.]/g, "-");
const OUT_DIR = resolve(ROOT, "tmp", `facebook-current-audit-${STAMP}`);
const HEADSUP_HOST_SELECTOR = ".truly-headsup-host,.fc-headsup-host";
const HEADSUP_PANEL_SELECTOR = ".truly-headsup,.fc-headsup";
const HEADSUP_SUMMARY_SELECTOR = ".truly-headsup-summary,.fc-headsup-summary,[aria-expanded]";
const HEADSUP_DETAIL_SELECTOR = ".truly-headsup-detail,.fc-headsup-detail";
const TAGGED_POST_SELECTOR = "[data-truly-id]";
const SKIPPED_POST_SELECTOR = "[data-truly-skip-reason]";
const SIDEPANEL_PATH = "/sidepanel/sidepanel.html";
const CHINESE_CHROME_TOKENS = [
  "首頁",
  "留言",
  "分享",
  "讚",
  "通知",
  "你在想什麼",
  "查看更多",
  "收合",
  "展開",
];
const ENGLISH_CHROME_TOKENS = [
  "Home",
  "Comment",
  "Share",
  "Like",
  "Notifications",
  "Write something",
  "See more",
];
const CHINESE_TRULY_TOKENS = [
  "分析完成",
  "深入閱讀",
  "詳細",
  "收合",
  "展開",
  "建議查核",
];
const PANEL_ACTION_PATTERN = "^(深入閱讀|建議查核|Deep reading|Deep read|Read deeper|Suggested fact-check|Fact-check suggested)$";
const SIDEPANEL_RENDER_WAIT_MS = 1600;

function usage() {
  console.log(`Usage: node scripts/audit-facebook-current.mjs

Audits the current logged-in Facebook page in the existing Chrome CDP session.
Artifacts are written under tmp/ and are intentionally not suitable for commit.

Environment:
  CDP_PORT=9222
  TRULY_AUDIT_EXPECT_LOCALE=zh|en|zh-Hant|zh-TW
  TRULY_AUDIT_TARGET_ID=<Chrome-CDP-target-id>
  TRULY_AUDIT_AUTO_RELOAD=1   reload stale Truly extension + Facebook tab, then audit
  CDP_ALLOW_FOCUS=1            allow focus-required side-panel click fallback
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
    send,
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
    async evaluateJson(expression) {
      const raw = await this.evaluate(`JSON.stringify((${expression}))`);
      return raw ? JSON.parse(raw) : null;
    },
    async clickAt(x, y) {
      await send("Input.dispatchMouseEvent", {
        type: "mouseMoved",
        x,
        y,
        button: "none",
      });
      await send("Input.dispatchMouseEvent", {
        type: "mousePressed",
        x,
        y,
        button: "left",
        clickCount: 1,
      });
      await send("Input.dispatchMouseEvent", {
        type: "mouseReleased",
        x,
        y,
        button: "left",
        clickCount: 1,
      });
    },
    async reload() {
      await send("Page.enable").catch(() => {});
      await send("Page.reload", { ignoreCache: true });
    },
    async bringToFront() {
      await send("Page.bringToFront");
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

function isSidePanelTarget(target) {
  return target.type === "page" &&
    typeof target.url === "string" &&
    target.url.includes(SIDEPANEL_PATH) &&
    target.webSocketDebuggerUrl;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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

function buildFreshnessState(expectedBuildId, serviceWorker, pageStates, selectedTargetId) {
  const selectedPage = pageStates.find((state) => state.id === selectedTargetId) ?? pageStates[0] ?? null;
  const serviceWorkerBuildId = serviceWorker.selected?.meta?.buildId ?? null;
  const pageBuildId = selectedPage?.buildId ?? null;
  const serviceWorkerFresh = serviceWorkerBuildId === expectedBuildId;
  const pageFresh = pageBuildId === expectedBuildId;
  const stale = !serviceWorkerFresh || !pageFresh;
  const hints = [];
  if (!serviceWorkerFresh) {
    hints.push(`service worker build is stale: ${serviceWorkerBuildId || "(missing)"} != ${expectedBuildId}`);
  }
  if (!pageFresh) {
    hints.push(`Facebook content script build is stale: ${pageBuildId || "(missing)"} != ${expectedBuildId}`);
  }
  if (stale && !AUTO_RELOAD) {
    hints.push("rerun with TRULY_AUDIT_AUTO_RELOAD=1 to reload the extension and Facebook tab automatically");
  }
  return {
    expectedBuildId,
    selectedPageBuildId: pageBuildId,
    serviceWorkerBuildId,
    serviceWorkerFresh,
    pageFresh,
    stale,
    autoReloadRequested: AUTO_RELOAD,
    hints,
  };
}

async function reloadStaleRuntime(serviceWorkerEntry) {
  const result = {
    attempted: false,
    extensionReloaded: false,
    facebookTabsReloaded: 0,
    error: null,
  };
  if (!serviceWorkerEntry?.target?.webSocketDebuggerUrl) {
    result.error = "Truly service worker target unavailable";
    return result;
  }

  result.attempted = true;
  try {
    await evaluateTarget(serviceWorkerEntry.target, "chrome.runtime.reload(); undefined")
      .catch(() => undefined);
    result.extensionReloaded = true;
    await sleep(2500);
    const targets = await fetchJson(`${CDP_BASE}/json/list`);
    for (const target of targets.filter(isFacebookTarget)) {
      const cdp = connectCdp(target.webSocketDebuggerUrl);
      try {
        await cdp.reload();
        result.facebookTabsReloaded += 1;
      } finally {
        cdp.close();
      }
    }
    await sleep(3500);
  } catch (error) {
    result.error = error instanceof Error ? error.message : String(error);
  }
  return result;
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
    const htmlLangOk = signals.htmlLang?.toLowerCase().startsWith("zh");
    const chromeTokenCount = signals.chineseChromeMatches?.length ?? 0;
    const trulyTokenCount = signals.chineseTrulyMatches?.length ?? 0;
    return {
      ok: Boolean(htmlLangOk && chromeTokenCount >= 2 && trulyTokenCount >= 1),
      detail:
        `htmlLang=${signals.htmlLang || "(none)"} ` +
        `fbZh=${(signals.chineseChromeMatches ?? []).join(",") || "(none)"} ` +
        `trulyZh=${(signals.chineseTrulyMatches ?? []).join(",") || "(none)"}`,
    };
  }
  if (expected === "en") {
    const englishTokenCount = signals.englishChromeMatches?.length ?? 0;
    return {
      ok: englishTokenCount >= 2 && (signals.chineseChromeMatches?.length ?? 0) === 0,
      detail:
        `htmlLang=${signals.htmlLang || "(none)"} ` +
        `fbEn=${(signals.englishChromeMatches ?? []).join(",") || "(none)"} ` +
        `fbZh=${(signals.chineseChromeMatches ?? []).join(",") || "(none)"}`,
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

async function captureSidePanelTarget(target, index) {
  const cdp = connectCdp(target.webSocketDebuggerUrl);
  try {
    await sleep(SIDEPANEL_RENDER_WAIT_MS);
    const data = await cdp.evaluateJson(`(() => {
      const norm = (s) => String(s || "").replace(/\\s+/g, " ").trim();
      const rectOf = (el) => {
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return {
          x: Math.round(r.x * 10) / 10,
          y: Math.round(r.y * 10) / 10,
          w: Math.round(r.width * 10) / 10,
          h: Math.round(r.height * 10) / 10,
          left: Math.round(r.left * 10) / 10,
          right: Math.round(r.right * 10) / 10,
          top: Math.round(r.top * 10) / 10,
          bottom: Math.round(r.bottom * 10) / 10
        };
      };
      const analysis = document.querySelector("[role='tabpanel'][data-tab='analysis'], #analysis-pane");
      const bodyText = norm(document.body?.innerText || document.documentElement?.innerText || document.body?.textContent || "");
      const inspected = Array.from(document.querySelectorAll(
        "button,a,.post-card,.analysis-overview,.details-row,.details-label,.chip,.necessity-pill,.source-badge,.deep-ai-chip,.iq-chip,.analysis-context-tag,.placeholder"
      )).slice(0, 120).map((el) => {
        const rect = rectOf(el);
        return {
          text: norm(el.innerText || el.textContent || el.getAttribute("aria-label") || "").slice(0, 120),
          className: String(el.className || ""),
          rect,
          overflow: rect ? rect.left < -1 || rect.right > window.innerWidth + 1 : false
        };
      });
      return {
        url: location.href,
        title: document.title,
        lang: document.documentElement.lang || null,
        readyState: document.readyState,
        activeTab: norm(document.querySelector(".tab[aria-selected=true], [aria-selected=true]")?.textContent),
        placeholder: norm(document.querySelector("#analysisPlaceholder,.placeholder")?.textContent),
        text: bodyText.slice(0, 5000),
        analysisText: norm(analysis?.innerText || analysis?.textContent || "").slice(0, 5000),
        buttonTexts: Array.from(document.querySelectorAll("button"))
          .map((button) => norm(button.innerText || button.textContent || button.getAttribute("aria-label") || ""))
          .filter(Boolean)
          .slice(0, 60),
        rawDebugVisible: /Raw decision|GraphQL 查詢|原始回應 JSON|送出的文字/.test(bodyText),
        overflow: inspected.filter((item) => item.overflow),
        inspectedCount: inspected.length
      };
    })()`);
    const screenshot = resolve(OUT_DIR, `sidepanel-${index}.png`);
    await cdp.screenshot(screenshot).catch(() => {});
    return {
      target: {
        id: target.id,
        type: target.type,
        title: target.title || "",
        url: target.url,
      },
      data,
      screenshot,
    };
  } finally {
    cdp.close();
  }
}

async function auditSidePanelWorkflow(page) {
  const beforeTargets = await fetchJson(`${CDP_BASE}/json/list`)
    .then((targets) => targets.filter(isSidePanelTarget).map((target) => target.id))
    .catch(() => []);
  const findButton = () => page.evaluate(`(() => {
    const norm = (s) => String(s || "").replace(/\\s+/g, " ").trim();
    const actionPattern = new RegExp(${JSON.stringify(PANEL_ACTION_PATTERN)});
    const hosts = Array.from(document.querySelectorAll(${JSON.stringify(HEADSUP_HOST_SELECTOR)}));
    const snapshots = hosts.map((host, index) => {
      const root = host.shadowRoot || host;
      return {
        index,
        buttons: Array.from(root.querySelectorAll("button, [role='button']"))
          .map((button) => norm(button.innerText || button.textContent || button.getAttribute("aria-label") || ""))
          .filter(Boolean)
      };
    });
    for (const host of hosts) {
      host.scrollIntoView({ block: "center", inline: "nearest", behavior: "instant" });
      const root = host.shadowRoot || host;
      const buttons = Array.from(root.querySelectorAll("button, [role='button']"));
      const target = buttons.find((button) =>
        actionPattern.test(norm(button.innerText || button.textContent || button.getAttribute("aria-label") || ""))
      );
      if (!target) continue;
      const rect = target.getBoundingClientRect();
      return {
        found: true,
        text: norm(target.innerText || target.textContent || target.getAttribute("aria-label") || ""),
        x: rect.x + rect.width / 2,
        y: rect.y + rect.height / 2,
        rect: {
          x: Math.round(rect.x * 10) / 10,
          y: Math.round(rect.y * 10) / 10,
          w: Math.round(rect.width * 10) / 10,
          h: Math.round(rect.height * 10) / 10
        },
        snapshots
      };
    }
    return { found: false, hostCount: hosts.length, snapshots };
  })()`).catch((error) => ({ found: false, error: error.message }));

  const clickAttempts = [];
  let button = await findButton();

  async function readSidePanelTargets() {
    const targets = await fetchJson(`${CDP_BASE}/json/list`).catch(() => []);
    return Array.isArray(targets) ? targets.filter(isSidePanelTarget) : [];
  }

  async function recordTargets(method) {
    await sleep(2200);
    const targets = await readSidePanelTargets();
    clickAttempts.push({
      method,
      targetCount: targets.length,
      targetIds: targets.map((target) => target.id),
    });
    return targets;
  }

  let sidePanelTargetsAfterClick = [];
  if (button.found) {
    await page.clickAt(button.x, button.y);
    sidePanelTargetsAfterClick = await recordTargets("cdp-mouse");

    if (sidePanelTargetsAfterClick.length === 0) {
      await page.evaluate(`(() => {
        const norm = (s) => String(s || "").replace(/\\s+/g, " ").trim();
        const actionPattern = new RegExp(${JSON.stringify(PANEL_ACTION_PATTERN)});
        for (const host of Array.from(document.querySelectorAll(${JSON.stringify(HEADSUP_HOST_SELECTOR)}))) {
          const root = host.shadowRoot || host;
          const target = Array.from(root.querySelectorAll("button, [role='button']")).find((button) =>
            actionPattern.test(norm(button.innerText || button.textContent || button.getAttribute("aria-label") || ""))
          );
          if (!target) continue;
          target.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, view: window }));
          return true;
        }
        return false;
      })()`).catch(() => false);
      sidePanelTargetsAfterClick = await recordTargets("dom-click");
    }

    if (sidePanelTargetsAfterClick.length === 0 && ALLOW_FOCUS) {
      await page.bringToFront().catch(() => {});
      button = await findButton();
      if (button.found) {
        await page.clickAt(button.x, button.y);
        sidePanelTargetsAfterClick = await recordTargets("focused-cdp-mouse");
      }
    }
  }

  const sidePanelTargets = sidePanelTargetsAfterClick.length > 0
    ? sidePanelTargetsAfterClick
    : await readSidePanelTargets();
  const captures = [];
  for (const [index, target] of sidePanelTargets.entries()) {
    captures.push(await captureSidePanelTarget(target, index).catch((error) => ({
      target: {
        id: target.id,
        type: target.type,
        title: target.title || "",
        url: target.url,
      },
      error: error instanceof Error ? error.message : String(error),
    })));
  }

  const problems = [];
  if (!button.found) {
    problems.push(button.error || `panel-action-not-found hosts=${button.hostCount ?? 0}`);
  }
  if (sidePanelTargets.length === 0)
    problems.push("sidepanel-target-not-found");
  for (const capture of captures) {
    if (capture.error) problems.push(`sidepanel-capture-error:${capture.error}`);
    if (capture.data?.rawDebugVisible) problems.push("sidepanel-raw-debug-visible");
    if ((capture.data?.overflow?.length ?? 0) > 0) {
      problems.push(`sidepanel-horizontal-overflow:${capture.data.overflow.length}`);
    }
    if (!capture.data?.text)
      problems.push("sidepanel-dom-text-empty");
  }

  const openedNewTarget = sidePanelTargets.some((target) => !beforeTargets.includes(target.id));
  return {
    ok: button.found && sidePanelTargets.length > 0 && problems.length === 0,
    button,
    clickAttempts,
    focusAllowed: ALLOW_FOCUS,
    beforeTargetCount: beforeTargets.length,
    targetCount: sidePanelTargets.length,
    openedNewTarget,
    captures,
    problems,
  };
}

function formatStep(ok, label, detail = "") {
  return `- ${ok ? "[OK]" : "[FAIL]"} ${label}${detail ? `: ${detail}` : ""}`;
}

function writeSummary(report, failures) {
  const sidePanel = report.sidePanel;
  const remediation = report.remediation;
  const localeSignals = report.audit.localeSignals;
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
    `- Side Panel targets: ${sidePanel?.targetCount ?? 0}`,
    "",
    "## Verdict",
    "",
    failures.length === 0 ? "PASS" : "FAIL",
    "",
    "## Human Summary",
    "",
    failures.length === 0
      ? "- Current Facebook page, build freshness, locale, heads-up overlay, expand toggle, and side-panel workflow passed."
      : `- Audit found ${failures.length} failing check(s). Review the checks and remediation sections before trusting this browser state.`,
    "",
    "## Build Freshness Remediation",
    "",
    `- Auto reload requested: ${remediation.autoReloadRequested ? "yes" : "no"}`,
    `- Stale before audit: ${remediation.before?.stale ? "yes" : "no"}`,
    ...(remediation.before?.hints?.length ? remediation.before.hints.map((hint) => `- Before: ${hint}`) : ["- Before: no stale-build remediation needed"]),
    ...(remediation.reload?.attempted
      ? [
          `- Reload attempted: yes`,
          `- Extension reload requested: ${remediation.reload.extensionReloaded ? "yes" : "no"}`,
          `- Facebook tabs reloaded: ${remediation.reload.facebookTabsReloaded}`,
          ...(remediation.reload.error ? [`- Reload error: ${remediation.reload.error}`] : []),
        ]
      : ["- Reload attempted: no"]),
    `- Stale after reload/audit: ${remediation.after?.stale ? "yes" : "no"}`,
    ...(remediation.after?.hints?.length ? remediation.after.hints.map((hint) => `- After: ${hint}`) : []),
    "",
    "## Locale Signals",
    "",
    `- html lang: ${localeSignals.htmlLang || "(none)"}`,
    `- Facebook zh tokens: ${(localeSignals.chineseChromeMatches ?? []).join(", ") || "(none)"}`,
    `- Facebook en tokens: ${(localeSignals.englishChromeMatches ?? []).join(", ") || "(none)"}`,
    `- Truly zh tokens: ${(localeSignals.chineseTrulyMatches ?? []).join(", ") || "(none)"}`,
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
    "## Side Panel Workflow",
    "",
    `- Action button: ${sidePanel?.button?.found ? sidePanel.button.text : "(not found)"}`,
    `- Targets: ${sidePanel?.targetCount ?? 0}`,
    `- Opened new target: ${sidePanel?.openedNewTarget ? "yes" : "no"}`,
    `- Focus fallback allowed: ${sidePanel?.focusAllowed ? "yes" : "no"}`,
    `- Click attempts: ${sidePanel?.clickAttempts?.length
      ? sidePanel.clickAttempts.map((attempt) => `${attempt.method}:${attempt.targetCount}`).join(", ")
      : "none"}`,
    `- Problems: ${sidePanel?.problems?.length ? sidePanel.problems.join("; ") : "none"}`,
    ...(sidePanel?.captures?.length
      ? sidePanel.captures.map((capture, index) =>
          `- #${index}: title=${capture.data?.title || capture.target?.title || "(unknown)"} ` +
          `text=${capture.data?.text ? "present" : "empty"} ` +
          `overflow=${capture.data?.overflow?.length ?? 0} ` +
          `rawDebug=${capture.data?.rawDebugVisible ? "yes" : "no"}`
        )
      : ["- no side-panel capture"]),
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

let targets = await fetchJson(`${CDP_BASE}/json/list`).catch((error) => {
  throw new Error(`Unable to reach Chrome CDP at ${CDP_BASE}. Start Chrome with remote debugging. ${error.message}`);
});

let { target: pageTarget, states: pageStates } = await selectFacebookTarget(targets);
let serviceWorker = await findTrulyServiceWorker(targets, expectedBuildId);
const remediation = {
  before: buildFreshnessState(expectedBuildId, serviceWorker, pageStates, pageTarget.id),
  reload: {
    attempted: false,
    extensionReloaded: false,
    facebookTabsReloaded: 0,
    error: null,
  },
  after: null,
  autoReloadRequested: AUTO_RELOAD,
};

if (remediation.before.stale && AUTO_RELOAD) {
  remediation.reload = await reloadStaleRuntime(serviceWorker.selected);
  targets = await fetchJson(`${CDP_BASE}/json/list`);
  ({ target: pageTarget, states: pageStates } = await selectFacebookTarget(targets));
  serviceWorker = await findTrulyServiceWorker(targets, expectedBuildId);
}
remediation.after = buildFreshnessState(expectedBuildId, serviceWorker, pageStates, pageTarget.id);

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
    const matchTokens = (text, tokens) => tokens.filter((token) => text.includes(token));
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
    const hosts = Array.from(document.querySelectorAll(${JSON.stringify(HEADSUP_HOST_SELECTOR)}));
    const taggedPosts = Array.from(document.querySelectorAll(${JSON.stringify(TAGGED_POST_SELECTOR)}));
    const articles = Array.from(document.querySelectorAll('[role="article"], article'));
    const viewport = { w: window.innerWidth, h: window.innerHeight, scrollY: window.scrollY };
    const hostDetails = hosts.map((host, index) => {
      const root = host.shadowRoot || host;
      const headsUp = root.querySelector(${JSON.stringify(HEADSUP_PANEL_SELECTOR)});
      const summary = root.querySelector(${JSON.stringify(HEADSUP_SUMMARY_SELECTOR)}) || root.querySelector("button");
      const detail = root.querySelector(${JSON.stringify(HEADSUP_DETAIL_SELECTOR)});
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
    const headsUpText = hosts.map((host) => {
      const root = host.shadowRoot || host;
      return visibleText(root);
    }).join(" ");
    return {
      url: location.href,
      title: document.title,
      buildId: document.documentElement.dataset.trulyBuildId || null,
      viewport,
      localeSignals: {
        htmlLang: document.documentElement.lang || null,
        chineseChromeMatches: matchTokens(bodyText, ${JSON.stringify(CHINESE_CHROME_TOKENS)}),
        englishChromeMatches: matchTokens(bodyText, ${JSON.stringify(ENGLISH_CHROME_TOKENS)}),
        chineseTrulyMatches: matchTokens(headsUpText, ${JSON.stringify(CHINESE_TRULY_TOKENS)})
      },
      counts: {
        hosts: hosts.length,
        taggedPosts: taggedPosts.length,
        articles: articles.length,
        skipped: document.querySelectorAll(${JSON.stringify(SKIPPED_POST_SELECTOR)}).length
      },
      hostDetails
    };
  })()`);

  const screenshotCount = Math.min(3, audit.hostDetails.length);
  for (let i = 0; i < screenshotCount; i++) {
    const path = resolve(OUT_DIR, `host-${i}-viewport.png`);
    await page.evaluate(`(() => {
      const host = Array.from(document.querySelectorAll(${JSON.stringify(HEADSUP_HOST_SELECTOR)}))[${i}];
      host?.scrollIntoView({ block: "start", inline: "nearest", behavior: "instant" });
    })()`).catch(() => {});
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 250));
    await page.screenshot(path).catch(() => {});
    screenshots.push(path);
  }

  const firstInteraction = await page.evaluate(`(() => {
    const norm = (s) => (s || "").replace(/\\s+/g, " ").trim();
    const host = document.querySelector(${JSON.stringify(HEADSUP_HOST_SELECTOR)});
    if (!host) return { ok: false, error: "host not found" };
    host.scrollIntoView({ block: "start", inline: "nearest", behavior: "instant" });
    const root = host.shadowRoot || host;
    const headsUp = root.querySelector(${JSON.stringify(HEADSUP_PANEL_SELECTOR)});
    const summary = root.querySelector(${JSON.stringify(HEADSUP_SUMMARY_SELECTOR)}) || root.querySelector("button");
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

  const sidePanel = await auditSidePanelWorkflow(page);
  for (const capture of sidePanel.captures) {
    if (capture.screenshot) screenshots.push(capture.screenshot);
  }

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
    {
      label: "sidepanel opens from heads-up action",
      ok: sidePanel.button.found && sidePanel.targetCount > 0,
      detail: sidePanel.button.found
        ? `${sidePanel.button.text}; targets=${sidePanel.targetCount}; new=${sidePanel.openedNewTarget ? "yes" : "no"}`
        : sidePanel.button.error || `hosts=${sidePanel.button.hostCount ?? 0}`,
    },
    {
      label: "sidepanel visual health",
      ok: sidePanel.problems.length === 0,
      detail: sidePanel.problems.join("; ") || "none",
    },
  ];

  await page.evaluate(`window.scrollTo(0, ${Number(initialScroll) || 0})`).catch(() => {});

  const report = {
    capturedAt: new Date().toISOString(),
    expectedBuildId,
    pageStates,
    page: { url: audit.url, title: audit.title, selectedTargetId: pageTarget.id },
    serviceWorker,
    remediation,
    audit,
    interaction: firstInteraction,
    sidePanel,
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
