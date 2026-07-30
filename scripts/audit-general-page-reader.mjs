#!/usr/bin/env node

import { createServer } from "node:http";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  isFacebookPageTarget,
  reloadStaleExtensionWithFacebookRecovery,
} from "./lib/general-page-audit-runtime-reload.mjs";
import { resolveClaimPreparationEvidence } from "./lib/general-page-audit-claim-transition.mjs";
import { classifyGeneralPageAuditMockRequest } from "./lib/general-page-audit-mock-kind.mjs";
import { newExternalPageTargets } from "./lib/general-page-audit-targets.mjs";
import { connectCdp as connectCdpClient } from "./lib/cdp-client.mjs";
import {
  assertWebFocusContinuity,
  runWebFocusContinuityScenario,
  webFocusContinuitySummary,
} from "./lib/general-page-audit-scenarios/web-focus-continuity.mjs";
import {
  assertMeaningfulNavigationScenario,
  meaningfulNavigationSummary,
  runMeaningfulNavigationScenario,
} from "./lib/general-page-audit-scenarios/meaningful-navigation.mjs";

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const DIST_BUILD_ID = resolve(ROOT, "dist", "build-id.txt");
const CDP_PORT = Number(process.env.CDP_PORT || 9222);
const CDP_BASE = `http://127.0.0.1:${CDP_PORT}`;
const AUTO_RELOAD = /^(1|true|yes)$/i.test(process.env.TRULY_AUDIT_AUTO_RELOAD || "");
const SKIP_POPUP_READ = /^(1|true|yes)$/i.test(process.env.TRULY_AUDIT_SKIP_POPUP_READ || "");
const ALLOW_WINDOW_FOCUS = /^(1|true|yes)$/i.test(process.env.TRULY_AUDIT_ALLOW_WINDOW_FOCUS || "");
const UI_ONLY = /^(1|true|yes)$/i.test(process.env.TRULY_AUDIT_UI_ONLY || "");
const EXTENSION_ID = (process.env.TRULY_EXTENSION_ID || "").trim();
const STAMP = new Date().toISOString().replace(/[:.]/g, "-");
const OUT_DIR = resolve(ROOT, "tmp", `${UI_ONLY ? "general-page-ui-check" : "general-page-reader-audit"}-${STAMP}`);
const PHASE_LOG_PATH = resolve(OUT_DIR, "audit-phase-log.json");
const PHASE_TIMEOUT_MS = {
  popup: 20_000,
  popupRead: 35_000,
  success: 90_000,
  noisy: 45_000,
  teaser: 45_000,
  candidate: 45_000,
  screenshot: 60_000,
  noGrant: 30_000,
  unsupportedPages: 35_000,
  storagePrivacy: 20_000,
};
const CDP_COMMAND_TIMEOUT_MS = 15_000;
const EXPECTED_INVESTIGATION_ACTION_COUNT = 1;
const WEB_SURFACE_READY_EXPRESSION = `(() => {
  const state = globalThis.__trulyPageReadingRuntime?.auditState?.().displayedSession;
  return Boolean(document.querySelector('#page-pane .page-reader-card')) &&
    state?.status === 'ready' &&
    state?.hasSurface === true;
})()`;
const auditPhaseLog = [];

function usage() {
  console.log(`Usage: node scripts/audit-general-page-reader.mjs

Audits the General Page Reader flow in the existing Chrome CDP session.
Artifacts are written under tmp/ and must not be committed.

Environment:
  CDP_PORT=9222
  TRULY_AUDIT_AUTO_RELOAD=1   reload stale Truly runtime and recover stale Facebook tabs
  TRULY_AUDIT_SKIP_POPUP_READ=1
                               skip the real chrome.action.openPopup read-click path
                               when the host OS cannot provide an active browser window
  TRULY_AUDIT_ALLOW_WINDOW_FOCUS=1
                               allow the popup-read phase to focus Chrome; off by default
  TRULY_AUDIT_UI_ONLY=1       run deterministic Web/Focus IA and visual checks only
  TRULY_EXTENSION_ID=<id>     audit a specific loaded Truly extension id
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
    throw new Error(`Unable to read ${relative(ROOT, DIST_BUILD_ID)}. Run npm run build first. ${error.message}`);
  }
}

async function fetchJson(url, options = {}, timeoutMs = 2500) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const response = await fetch(url, { cache: "no-store", signal: ctrl.signal, ...options });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

function connectCdp(webSocketDebuggerUrl) {
  return connectCdpClient(webSocketDebuggerUrl, {
    commandTimeoutMs: CDP_COMMAND_TIMEOUT_MS,
    screenshotBeyondViewport: true,
  });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runAuditPhase(label, timeoutMs, fn) {
  const startedAt = new Date().toISOString();
  const startedMs = Date.now();
  const entry = {
    phase: label,
    status: "running",
    timeoutMs,
    startedAt,
  };
  auditPhaseLog.push(entry);
  writeFileSync(resolve(OUT_DIR, "audit-progress.json"), JSON.stringify({
    phase: label,
    timeoutMs,
    startedAt,
  }, null, 2));
  writeAuditPhaseLog();
  let timer;
  let status = "completed";
  try {
    return await Promise.race([
      fn(),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`Audit phase timed out: ${label} after ${timeoutMs}ms`)), timeoutMs);
      }),
    ]);
  } catch (error) {
    status = "failed";
    throw error;
  } finally {
    clearTimeout(timer);
    const finishedAt = new Date().toISOString();
    entry.status = status;
    entry.finishedAt = finishedAt;
    entry.durationMs = Date.now() - startedMs;
    writeFileSync(resolve(OUT_DIR, "audit-progress.json"), JSON.stringify({
      phase: label,
      status,
      timeoutMs,
      startedAt,
      finishedAt,
      durationMs: entry.durationMs,
    }, null, 2));
    writeAuditPhaseLog();
  }
}

function writeAuditPhaseLog() {
  writeFileSync(PHASE_LOG_PATH, `${JSON.stringify(auditPhaseLog, null, 2)}\n`);
}

function syntheticHtml(title, body) {
  return `<!doctype html>
<html lang="zh-Hant">
<head>
  <meta charset="utf-8">
  <title>${title}</title>
  <meta name="author" content="Synthetic Author">
  <meta property="og:site_name" content="Synthetic Local News">
  <link rel="canonical" href="/article">
</head>
<body>
  <header><nav>Home Latest Advertisement</nav></header>
  <main>
    <article>
      <h1>${title}</h1>
      <p class="byline">By Synthetic Author</p>
      <p>${body}</p>
      <p>This synthetic paragraph contains enough article text for Truly to extract a meaningful preview without using real website content.</p>
      <p>The quick brown test page explains a public planning process, includes one link, and has no private information.</p>
      <a href="/source">Source link</a>
    </article>
  </main>
  <aside>Related stories Advertisement Login</aside>
</body>
</html>`;
}

function noisyFallbackHtml() {
  const paragraphs = [
    "為達最佳瀏覽效果，建議使用 Chrome、Firefox 或 Microsoft Edge 的瀏覽器。",
    "請至 Edge 官網下載 請至 FireFox 官網下載 請至 Google 官網下載。",
    "即時 熱門 政治 軍武 社會 生活 健康 國際 地方 搜尋 會員 專區。",
    "This synthetic noisy fixture keeps enough body text to trigger fallback extraction without using a semantic main or article element.",
    "The actual synthetic report describes a fictional public notice, the decision timeline, and a review workflow for parser quality testing.",
    "The article source link below is the only link that should remain useful as model context after browser download and home navigation links are filtered.",
  ];
  return `<!doctype html>
<html lang="zh-Hant">
<head>
  <meta charset="utf-8">
  <title>Noisy Fallback Reader Fixture</title>
  <meta property="og:site_name" content="Synthetic Noisy News">
  <link rel="canonical" href="/noisy">
</head>
<body>
  <div class="layout-shell">
    <a href="/">首頁</a>
    <a href="https://www.microsoft.com/edge/download">請至 Edge 官網下載</a>
    <a href="https://www.mozilla.org/firefox/new">請至 FireFox 官網下載</a>
    <a href="https://www.google.com/chrome/">請至 Google 官網下載</a>
    <h1>Noisy Fallback Reader Fixture</h1>
    ${paragraphs.map((text) => `<p>${text}</p>`).join("\n    ")}
    <a href="/source">Article source</a>
  </div>
</body>
</html>`;
}

function candidateBlockHtml() {
  const candidateParagraphs = [
    "Candidate block recovery fixture starts with synthetic article text that is cleaner than the surrounding fallback shell.",
    "The candidate body describes a fictional civic workshop, a review timeline, and a parser recovery decision without copying any real website content.",
    "Full candidate continuation should appear in the visible reading preview after the advisor chooses the candidate block.",
    "A final synthetic paragraph keeps the block comfortably above the model threshold while avoiding private data, real names, or real URLs.",
  ];
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Candidate Block Recovery Fixture</title>
  <meta property="og:site_name" content="Synthetic Recovery Notes">
  <link rel="canonical" href="/candidate">
</head>
<body>
  <header>Home Topics Archive</header>
  <div class="layout-shell">
    <h1>Candidate Block Recovery Fixture</h1>
    <div class="story-body">
      ${candidateParagraphs.map((text) => `<p>${text}</p>`).join("\n      ")}
      <a href="/candidate-source">Candidate source</a>
    </div>
  </div>
</body>
</html>`;
}

function teaserHubHtml() {
  return `<!doctype html>
<html lang="zh-Hant">
<head>
  <meta charset="utf-8">
  <title>Multi Article Teaser Hub Fixture</title>
  <meta property="og:site_name" content="Synthetic Daily">
  <link rel="canonical" href="/teaser-hub">
</head>
<body>
  <header>
    <a href="/latest">Latest</a>
    <a href="/topics">Topics</a>
    <a href="/member">Member Area</a>
  </header>
  <div class="teaser-hub-shell">
    <article class="teaser-card">
      <h2>First synthetic teaser</h2>
      <p>The multi article teaser hub fixture contains short cards that describe fictional civic notices. This first card is a preview, not a complete article body.</p>
      <a href="/briefs/first">Read first item</a>
    </article>
    <article class="teaser-card">
      <h2>Second synthetic teaser</h2>
      <p>A second synthetic teaser mentions an imaginary library schedule and a public archive counter. It exists to model a hub card rather than a full article.</p>
      <a href="/briefs/second">Read second item</a>
    </article>
    <article class="teaser-card">
      <h2>Third synthetic teaser</h2>
      <p>The third synthetic teaser is deliberately short so the reader should see a caution state instead of a clean article-ready state.</p>
      <a href="/briefs/third">Read third item</a>
    </article>
  </div>
  <aside>
    <a href="/newsletter">Newsletter</a>
    <a href="/rankings">Popular briefings</a>
  </aside>
</body>
</html>`;
}

function screenshotRecoveryHtml() {
  return `<!doctype html>
<html lang="zh-Hant">
<head>
  <meta charset="utf-8">
  <title>Screenshot Recovery Fixture</title>
  <meta property="og:site_name" content="Synthetic Visual App">
  <link rel="canonical" href="/screenshot-recovery">
</head>
<body>
  <header>App Shell Navigation Search Login</header>
  <main>
    <h1>Screenshot Recovery Fixture</h1>
    <p>Sparse app-shell text that is intentionally too short for direct text analysis.</p>
    <section aria-label="visual card">
      <img alt="Synthetic visual card containing the primary article-like content" src="data:image/png;base64,iVBORw0KGgo=">
    </section>
  </main>
</body>
</html>`;
}

async function startMockOpenAiEndpoint() {
  const requests = [];
  const server = createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    const rawBody = Buffer.concat(chunks).toString("utf8");
    let body = {};
    try {
      body = JSON.parse(rawBody);
    } catch {
      body = { __parseError: rawBody.slice(0, 400) };
    }
    const messages = Array.isArray(body.messages) ? body.messages : [];
    const systemText = String(messages.find((item) => item?.role === "system")?.content || "");
    const userContent = messages.find((item) => item?.role === "user")?.content;
    const userText = Array.isArray(userContent)
      ? userContent.map((item) => item?.text || item?.image_url?.url || "").join("\n")
      : String(userContent || "");
    const hasImageUrl = JSON.stringify(userContent).includes('"image_url"');
    const kind = classifyGeneralPageAuditMockRequest(systemText, hasImageUrl);
    const wantsZhtw = /Taiwan Traditional Chinese|台灣慣用繁體中文/u.test(systemText);
    requests.push({
      kind,
      url: req.url,
      hasImageUrl,
      containsDataImage: /data:image\//i.test(JSON.stringify(body)),
      currentExtractionMentionsFixture: /Screenshot Recovery Fixture|Sparse app-shell/i.test(userText),
      body,
    });
    let content;
    if (kind === "vision-probe") {
      content = "blue";
    } else if (kind === "parser-advisor") {
      // Keep the checking state observable to the transition audit. The live
      // provider is asynchronous; an immediate local mock can otherwise skip
      // the user-visible intermediary state between DOM mutations.
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 900));
      content = /Multi Article Teaser Hub Fixture|multi article teaser hub/i.test(userText)
        ? JSON.stringify({
            schemaVersion: 1,
            pageType: "index_or_feed",
            decision: "downgrade_to_index_or_feed",
            confidence: "high",
            needsUserSelection: false,
            needsScreenshot: false,
            riskTags: ["index_or_feed"],
            rationale: "The synthetic fixture is a hub of short preview cards, not one complete article.",
          })
        : JSON.stringify({
            schemaVersion: 1,
            pageType: "app_shell",
            decision: "request_screenshot_region",
            confidence: "medium",
            needsUserSelection: false,
            needsScreenshot: true,
            riskTags: ["needs_visual_grounding"],
            rationale: "The synthetic fixture needs visible screenshot grounding.",
          });
    } else if (kind === "investigation-adapter") {
      // Keep the derived preparation visible long enough for the UI audit to
      // prove the intermediate state instead of racing directly to ready.
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 3000));
      const candidateLine = userText.split("\n").find((line) => line.startsWith('[{"id":"span:'));
      const candidates = candidateLine ? JSON.parse(candidateLine) : [];
      const selected = candidates.filter(({ exactText }) =>
        /^(?:The analyzed content is synthetic|The fixture uses no real website content|The audit runs against a local test page)$/u.test(exactText));
      const ranked = [
        ...(selected[0] ? [selected[0]] : []),
        ...candidates.filter(({ id }) => id !== selected[0]?.id),
      ].slice(0, Math.min(3, candidates.length));
      content = JSON.stringify({
        schemaVersion: 13,
        selections: ranked.map(({ id }, index) => ({
          candidateId: id,
          presentationTier: index === 0 ? "primary" : "exploratory",
        })),
      });
    } else if (kind === "investigation-admission") {
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 500));
      content = JSON.stringify({
        schemaVersion: 4,
        decision: /The analyzed content is synthetic|The fixture uses no real website content|The audit runs against a local test page/u.test(userText)
          ? "admit"
          : "reject",
      });
    } else if (kind === "investigation-tier") {
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 500));
      content = JSON.stringify({
        schemaVersion: 1,
        tier: "primary",
      });
    } else {
      // Keep the ordinary reading-analysis state observable as a distinct UX
      // phase instead of letting the deterministic mock resolve in one frame.
      if (!hasImageUrl) await new Promise((resolveDelay) => setTimeout(resolveDelay, 300));
      const targetKind = /targetKind:\s*selection/i.test(userText)
        ? "selection"
        : /targetKind:\s*current-region/i.test(userText)
        ? "current-region"
        : "page";
      const summary = wantsZhtw
        ? targetKind === "selection"
          ? "合成選取內容總覽。"
          : targetKind === "current-region"
          ? "合成段落總覽。"
          : "合成整頁總覽。"
        : targetKind === "selection"
        ? "Deterministic selected-content overview."
        : targetKind === "current-region"
        ? "Deterministic paragraph overview."
        : "Deterministic whole-page overview.";
      content = JSON.stringify({
        schemaVersion: 1,
        summary: hasImageUrl
          ? wantsZhtw ? "以截圖為依據的合成摘要。" : "Screenshot-grounded synthetic summary."
          : summary,
        bg: hasImageUrl
          ? [wantsZhtw
              ? { t: "視覺脈絡", why: "已納入使用者確認的截圖。" }
              : { t: "Visual context", why: "The confirmed screenshot was included." }]
          : [wantsZhtw
              ? { t: "合成範圍", why: "這個固定回應用於驗證介面狀態。" }
              : { t: "Synthetic scope", why: "This deterministic response verifies the UI state." }],
        claims: hasImageUrl
          ? [wantsZhtw ? {
              c: "此頁面需要視覺資訊作為依據。",
              why: "文字擷取內容不足。",
              need: "使用者確認的頁面截圖。",
              q: "此頁面是否需要視覺資訊作為依據？",
              atom: { s: "此頁面", p: "需要", o: "視覺資訊" },
              policy: { claimKind: "fact", consequence: "public_interest" },
            } : {
              c: "The page needs visual grounding.",
              why: "The text extraction was too sparse.",
              need: "Use the confirmed screenshot.",
              q: "Does the page need visual grounding?",
              atom: { s: "The page", p: "needs", o: "visual grounding" },
              policy: { claimKind: "fact", consequence: "public_interest" },
            }]
          : /The analyzed content is synthetic[\s\S]*The fixture uses no real website content[\s\S]*The audit runs against a local test page/i.test(userText)
          ? wantsZhtw ? [
              {
                c: "分析內容為合成資料。",
                why: "介面驗收不應依賴真實網站內容。",
                need: "比對合成頁面的測試規格、建置來源與驗收紀錄，確認內容範圍符合預期且可重現。",
                q: "分析內容是否完全由可重現的合成資料構成，而未混入任何真實網站內容？",
                atom: { s: "分析內容", p: "為", o: "合成資料" },
                policy: { claimKind: "fact", consequence: "public_interest" },
              },
              {
                c: "測試頁面未使用真實網站內容。",
                why: "驗收必須維持合成資料邊界。",
                need: "檢查本機測試頁面原始碼。",
                q: "測試頁面是否未使用真實網站內容？",
                atom: { s: "測試頁面", p: "未使用", o: "真實網站內容" },
                policy: { claimKind: "fact", consequence: "public_interest" },
              },
              {
                c: "驗收使用本機測試頁面。",
                why: "執行期證據必須可重現。",
                need: "檢查驗收目標設定。",
                q: "驗收是否使用本機測試頁面？",
                atom: { s: "驗收", p: "使用", o: "本機測試頁面" },
                policy: { claimKind: "fact", consequence: "public_interest" },
              },
            ] : [
              {
                c: "The analyzed content is synthetic.",
                why: "The UI check must not depend on live page content.",
                need: "Compare the fixture specification, build source, and audit record to confirm the expected reproducible scope.",
                q: "Is the analyzed content made entirely from reproducible synthetic data without any real website content?",
                atom: { s: "The analyzed content", p: "is", o: "synthetic" },
                policy: { claimKind: "fact", consequence: "public_interest" },
              },
              {
                c: "The fixture uses no real website content.",
                why: "The audit must stay synthetic.",
                need: "Inspect the local fixture source.",
                q: "Does the fixture use no real website content?",
                atom: { s: "The fixture", p: "uses", o: "no real website content" },
                policy: { claimKind: "fact", consequence: "public_interest" },
              },
              {
                c: "The audit runs against a local test page.",
                why: "The runtime proof must be reproducible.",
                need: "Inspect the audit target configuration.",
                q: "Does the audit run against a local test page?",
                atom: { s: "The audit", p: "runs against", o: "a local test page" },
                policy: { claimKind: "fact", consequence: "public_interest" },
              },
            ]
          : [wantsZhtw ? {
              c: "分析內容為合成資料。",
              why: "介面驗收不應依賴真實網站內容。",
              need: "確認預期的測試範圍。",
              q: "分析內容是否為合成資料？",
              atom: { s: "分析內容", p: "為", o: "合成資料" },
              policy: { claimKind: "fact", consequence: "public_interest" },
            } : {
              c: "The analyzed content is synthetic.",
              why: "The UI check must not depend on live page content.",
              need: "Confirm the expected scope.",
              q: "Is the analyzed content synthetic?",
              atom: { s: "The analyzed content", p: "is", o: "synthetic" },
              policy: { claimKind: "fact", consequence: "public_interest" },
            }],
        qs: [{
          q: wantsZhtw
            ? hasImageUrl ? "畫面中的卡片顯示什麼？" : "目前這個合成頁面使用的是整頁、選取內容，還是目前段落的哪一個分析範圍？"
            : hasImageUrl ? "What does the visible card show?" : "Does this synthetic page currently use the whole page, selected content, or the current paragraph as its analysis scope?",
          kind: "understand",
        }],
      });
    }
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({
      choices: [{
        message: { content },
      }],
    }));
  });
  await new Promise((resolveListen, rejectListen) => {
    server.once("error", rejectListen);
    server.listen(0, "127.0.0.1", resolveListen);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("mock_openai_endpoint_bind_failed");
  return {
    endpoint: `http://127.0.0.1:${address.port}/v1`,
    requests,
    close: () => new Promise((resolveClose) => {
      server.close(resolveClose);
      server.closeIdleConnections?.();
      server.closeAllConnections?.();
    }),
  };
}

async function startSyntheticServer() {
  const server = createServer((req, res) => {
    res.setHeader("content-type", "text/html; charset=utf-8");
    if (req.url?.startsWith("/noisy")) {
      res.end(noisyFallbackHtml());
      return;
    }
    if (req.url?.startsWith("/candidate")) {
      res.end(candidateBlockHtml());
      return;
    }
    if (req.url?.startsWith("/teaser-hub")) {
      res.end(teaserHubHtml());
      return;
    }
    if (req.url?.startsWith("/screenshot-recovery")) {
      res.end(screenshotRecoveryHtml());
      return;
    }
    if (req.url?.startsWith("/article2")) {
      res.end(syntheticHtml("Second Synthetic Article", "This is a different synthetic article after a meaningful URL change."));
      return;
    }
    if (req.url?.startsWith("/article3")) {
      res.end(syntheticHtml("Third Synthetic Article", "This is a third synthetic article for multi-session Web switching."));
      return;
    }
    res.end(syntheticHtml(
      "Synthetic General Page Reader Article",
      "This is a synthetic article for the General Page Reader CDP acceptance test. The analyzed content is synthetic. The fixture uses no real website content. The audit runs against a local test page.",
    ));
  });

  await new Promise((resolveListen, rejectListen) => {
    server.once("error", rejectListen);
    server.listen(0, "0.0.0.0", resolveListen);
  });
  const port = server.address().port;
  return {
    port,
    allowedBase: `http://127.0.0.1:${port}`,
    noGrantBase: `http://127.0.0.2:${port}`,
    close: () => new Promise((resolveClose) => {
      server.close(resolveClose);
      server.closeIdleConnections?.();
      server.closeAllConnections?.();
    }),
  };
}

async function createTarget(url) {
  const browserInfo = await fetchJson(`${CDP_BASE}/json/version`, {}, 5000);
  if (!browserInfo?.webSocketDebuggerUrl) throw new Error("Unable to connect to the CDP browser target");
  const browser = connectCdp(browserInfo.webSocketDebuggerUrl);
  let targetId;
  try {
    const created = await browser.send("Target.createTarget", { url, background: true });
    targetId = created?.targetId;
  } finally {
    browser.close();
  }
  if (!targetId) throw new Error(`Unable to create background CDP target for ${url}`);
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const target = (await listTargets()).find((entry) => entry.id === targetId);
    if (target?.webSocketDebuggerUrl) return target;
    await sleep(50);
  }
  throw new Error(`Background CDP target did not become inspectable for ${url}`);
}

async function activateTabWithoutWindowFocus(extensionPage, targetUrl) {
  let result;
  for (let attempt = 0; attempt < 60; attempt += 1) {
    result = await extensionPage.evaluateJson(`(() => new Promise((resolve) => {
      chrome.tabs.query({}, (tabs) => {
        const urlFor = (candidate) => candidate.url || candidate.pendingUrl || "";
        const tab = tabs.find((candidate) => urlFor(candidate) === ${JSON.stringify(targetUrl)}) ||
          tabs.find((candidate) => ${JSON.stringify(targetUrl)} && urlFor(candidate).startsWith(${JSON.stringify(targetUrl)}));
        if (!tab?.id) {
          resolve({
            ok: false,
            error: "tab_not_found",
            targetUrl: ${JSON.stringify(targetUrl)},
            observed: tabs.slice(-8).map((candidate) => ({
              id: candidate.id,
              url: candidate.url || "",
              pendingUrl: candidate.pendingUrl || "",
            })),
          });
          return;
        }
        chrome.tabs.update(tab.id, { active: true }, (updated) => {
          resolve({
            ok: !chrome.runtime.lastError,
            error: chrome.runtime.lastError?.message || "",
            tabId: updated?.id ?? tab.id,
            windowId: updated?.windowId ?? tab.windowId,
            url: updated?.url || tab.url || tab.pendingUrl || "",
          });
        });
      });
    }))()`);
    if (result?.ok) return result;
    await sleep(50);
  }
  throw new Error(`Unable to activate background audit tab: ${result?.error || "unknown"}; target=${targetUrl}; observed=${JSON.stringify(result?.observed || [])}`);
}

async function listTargets() {
  return fetchJson(`${CDP_BASE}/json/list`, {}, 5000).catch((error) => {
    throw new Error(`Unable to reach Chrome CDP at ${CDP_BASE}. Start Chrome with remote debugging. ${error.message}`);
  });
}

async function findTrulyExtension(targets, expectedBuildId, { allowStale = false, extensionId = "" } = {}) {
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
      const meta = await cdp.evaluateJson(`(() => {
        try {
          const manifest = chrome.runtime.getManifest();
          return {
            id: chrome.runtime.id,
            name: manifest.name,
            version: manifest.version,
            versionName: manifest.version_name || "",
            buildId: globalThis.__TRULY_BUILD_ID || null,
            url: location.href
          };
        } catch (error) {
          return { error: String(error) };
        }
      })()`).catch(() => null);
      if (meta?.name === "Truly") found.push({ target, meta: { ...meta, expectedBuildId } });
    } finally {
      cdp.close();
    }
  }

  const fresh = found.find((entry) => entry.meta.buildId === expectedBuildId);
  if (fresh) return fresh;

  const candidates = found.map((entry) => `${entry.meta.id} buildId=${entry.meta.buildId || "(missing)"}`).join(", ");
  if (extensionId) {
    const explicit = found.find((entry) => entry.meta.id === extensionId);
    if (explicit) return explicit;
    throw new Error(`TRULY_EXTENSION_ID=${extensionId} was not found among loaded Truly service workers. Candidates: ${candidates || "(none)"}.`);
  }
  if (allowStale && found.length === 1) return found[0];
  if (found.length > 0) {
    throw new Error(`No Truly service worker matches dist/build-id.txt ${expectedBuildId}. Candidates: ${candidates}. Set TRULY_EXTENSION_ID to the intended unpacked extension id or close stale Truly copies.`);
  }
  throw new Error("Truly service worker not found in the current Chrome CDP session.");
}

async function extensionPageEval(extensionId, expression) {
  const helperUrl = `chrome-extension://${extensionId}/options/options.html?generalPageReaderAudit=${STAMP}`;
  const helperTarget = await createTarget(helperUrl);
  const helper = connectCdp(helperTarget.webSocketDebuggerUrl);
  try {
    await sleep(400);
    return await helper.evaluate(expression);
  } finally {
    await helper.closeTarget().catch(() => {});
    helper.close();
  }
}

async function reloadExtension(extensionId) {
  const helperUrl = `chrome-extension://${extensionId}/options/options.html?generalPageReaderAuditReload=${STAMP}`;
  const helperTarget = await createTarget(helperUrl);
  const helper = connectCdp(helperTarget.webSocketDebuggerUrl);
  try {
    await sleep(300);
    await Promise.race([
      helper.evaluate("setTimeout(() => chrome.runtime.reload(), 0); undefined", 1000).catch(() => undefined),
      sleep(1000),
    ]);
  } finally {
    helper.close();
  }
  await sleep(1500);
}

async function readExtensionBuildId(extensionId) {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const target = (await listTargets()).find((entry) =>
      entry.type === "service_worker" &&
      entry.url?.startsWith(`chrome-extension://${extensionId}/`) &&
      entry.webSocketDebuggerUrl
    );
    if (target) {
      const worker = connectCdp(target.webSocketDebuggerUrl);
      try {
        const buildId = await worker.evaluate("globalThis.__TRULY_BUILD_ID || null").catch(() => null);
        if (buildId) return buildId;
      } finally {
        worker.close();
      }
    }
    await sleep(100);
  }
  return null;
}

async function facebookTargetsWithContentScriptBuildIds(targets) {
  const annotated = [];
  for (const target of targets) {
    if (!isFacebookPageTarget(target)) {
      annotated.push(target);
      continue;
    }
    const page = connectCdp(target.webSocketDebuggerUrl);
    try {
      const contentScriptBuildId = await page.evaluate(
        "document.documentElement.dataset.trulyBuildId || null",
      ).catch(() => null);
      annotated.push({ ...target, contentScriptBuildId });
    } finally {
      page.close();
    }
  }
  return annotated;
}

async function reloadFacebookTarget(target) {
  const page = connectCdp(target.webSocketDebuggerUrl);
  try {
    await page.reload();
  } finally {
    page.close();
  }
}

async function openSidePanelTestPage(extensionId, activePageTarget, suffix, activeTabId, options = {}) {
  const settleMs = Number.isFinite(options.settleMs) ? Math.max(0, options.settleMs) : 600;
  const helperUrl = `chrome-extension://${extensionId}/options/options.html?generalPageReaderAuditHelper=${suffix}`;
  const helperTarget = await createTarget(helperUrl);
  const helper = connectCdp(helperTarget.webSocketDebuggerUrl);
  try {
    await sleep(300);
    if (typeof activeTabId === "number") {
      const activated = await helper.evaluateJson(`(() => new Promise((resolve) => {
        chrome.tabs.update(${JSON.stringify(activeTabId)}, { active: true }, (updated) => {
          resolve({
            ok: !chrome.runtime.lastError,
            error: chrome.runtime.lastError?.message || "",
            tabId: updated?.id ?? ${JSON.stringify(activeTabId)},
          });
        });
      }))()`);
      if (!activated?.ok) throw new Error(`Unable to activate background audit tab id ${activeTabId}: ${activated?.error || "unknown"}`);
    } else {
      await activateTabWithoutWindowFocus(helper, activePageTarget.url || "");
    }
    const sideUrl = `chrome-extension://${extensionId}/sidepanel/sidepanel.html?generalPageReaderAudit=${suffix}`;
    await helper.evaluate(`new Promise((resolve) => {
      chrome.tabs.create({ url: ${JSON.stringify(sideUrl)}, active: false }, () => resolve(undefined));
    })`);
    for (let attempt = 0; attempt < 60; attempt += 1) {
      const target = (await listTargets()).find((entry) => entry.url?.startsWith(sideUrl));
      if (target?.webSocketDebuggerUrl) {
        if (settleMs > 0) await sleep(settleMs);
        return target;
      }
      await sleep(10);
    }
    throw new Error("Sidepanel audit target not found after chrome.tabs.create");
  } finally {
    await helper.closeTarget().catch(() => {});
    helper.close();
  }
}

async function openInactiveExtensionPage(extensionId, url, suffix) {
  const helperUrl = `chrome-extension://${extensionId}/options/options.html?generalPageReaderInactiveHelper=${suffix}`;
  const helperTarget = await createTarget(helperUrl);
  const helper = connectCdp(helperTarget.webSocketDebuggerUrl);
  try {
    await sleep(300);
    return await helper.evaluateJson(`(() => new Promise((resolve) => {
      chrome.tabs.create({ url: ${JSON.stringify(url)}, active: false }, (tab) => {
        resolve({ id: tab?.id, url: tab?.url, title: tab?.title, active: tab?.active, windowId: tab?.windowId });
      });
    }))()`);
  } finally {
    await helper.closeTarget().catch(() => {});
    helper.close();
  }
}

async function createInactiveAuditTab(extensionId, url, suffix) {
  const beforeIds = new Set((await listTargets()).map((target) => target.id));
  const tab = await openInactiveExtensionPage(extensionId, url, suffix);
  if (typeof tab?.id !== "number") throw new Error(`Unable to create inactive audit tab for ${url}`);
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const target = (await listTargets()).find((entry) =>
      !beforeIds.has(entry.id) &&
      entry.type === "page" &&
      entry.webSocketDebuggerUrl &&
      (entry.url === url || entry.url?.startsWith(url)));
    if (target) return { tab, target };
    await sleep(50);
  }
  throw new Error(`Inactive audit tab did not expose a CDP target for ${url}`);
}

async function findPageTargetByUrlPrefix(urlPrefix) {
  const target = (await listTargets()).find((entry) =>
    entry.type === "page" &&
    typeof entry.url === "string" &&
    entry.url.startsWith(urlPrefix) &&
    entry.webSocketDebuggerUrl
  );
  if (!target?.webSocketDebuggerUrl) throw new Error(`Target not found for ${urlPrefix}`);
  return target;
}

async function closePageTargetsByUrlPrefix(urlPrefix) {
  const targets = (await listTargets()).filter((entry) =>
    entry.type === "page" &&
    typeof entry.url === "string" &&
    entry.url.startsWith(urlPrefix) &&
    entry.webSocketDebuggerUrl
  );
  for (const target of targets) {
    const cdp = connectCdp(target.webSocketDebuggerUrl);
    try {
      await cdp.closeTarget().catch(() => {});
    } finally {
      cdp.close();
    }
  }
}

async function openActionPopup(extensionId, activePageTarget, suffix) {
  const popupUrlPrefix = `chrome-extension://${extensionId}/popup/popup.html`;
  await closePageTargetsByUrlPrefix(popupUrlPrefix);
  const helperUrl = `chrome-extension://${extensionId}/options/options.html?actionPopupHelper=${suffix}`;
  const helperTarget = await createTarget(helperUrl);
  const helper = connectCdp(helperTarget.webSocketDebuggerUrl);
  try {
    await sleep(300);
    const tabFocus = await activateTabWithoutWindowFocus(helper, activePageTarget.url || "")
      .catch((error) => ({ ok: false, reason: error.message }));
    if (ALLOW_WINDOW_FOCUS && typeof tabFocus?.windowId === "number") {
      await helper.evaluate(`new Promise((resolve) => {
        chrome.windows.update(${JSON.stringify(tabFocus.windowId)}, { focused: true }, () => resolve(undefined));
      })`);
    }
    await sleep(300);
    const openResult = await helper.evaluateJson(`(async () => {
      const windowId = ${JSON.stringify(typeof tabFocus?.windowId === "number" ? tabFocus.windowId : null)};
      try {
        await chrome.action.openPopup();
        return { ok: true, via: "active-window" };
      } catch (error) {
        if (typeof windowId === "number") {
          try {
            await chrome.action.openPopup({ windowId });
            return { ok: true, via: "window-id", firstError: String(error?.message || error) };
          } catch (secondError) {
            return {
              ok: false,
              error: String(secondError?.message || secondError),
              firstError: String(error?.message || error),
              hasOpenPopup: typeof chrome.action?.openPopup,
            };
          }
        }
        return { ok: false, error: String(error?.message || error), hasOpenPopup: typeof chrome.action?.openPopup };
      }
    })()`);
    if (!openResult?.ok) {
      throw new Error(`chrome.action.openPopup failed: ${openResult?.error || "(no details)"}; focus=${JSON.stringify(tabFocus)}`);
    }
    await sleep(800);
    return await findPageTargetByUrlPrefix(popupUrlPrefix);
  } finally {
    await helper.closeTarget().catch(() => {});
    helper.close();
  }
}

async function currentVersion(extensionId) {
  return extensionPageEval(
    extensionId,
    "chrome.runtime.sendMessage({ type: 'GET_VERSION' })",
  );
}

async function auditStoragePrivacy(extensionId) {
  return extensionPageEval(extensionId, `(() => new Promise((resolve) => {
    const suspiciousNeedles = [
      { name: "screenshot_data_url", pattern: /^data:image\\/(?:jpeg|png|webp);base64,/i },
      { name: "raw_html", pattern: /<\\/?(?:html|body|article|main|script|style)\\b/i },
      { name: "synthetic_article_text", pattern: /synthetic article for the General Page Reader CDP acceptance test/i },
      { name: "candidate_block_text", pattern: /Candidate block recovery fixture starts with synthetic article text/i },
      { name: "teaser_hub_text", pattern: /multi article teaser hub fixture contains short cards/i },
      { name: "noisy_fixture_text", pattern: /為達最佳瀏覽效果|download Chrome|請至 Google 官網下載/i },
    ];
    const safePreview = (value) => {
      const text = String(value);
      if (text.length <= 48) return text.replace(/[A-Za-z0-9+/=]{16,}/g, "[token]");
      return text.slice(0, 48).replace(/[A-Za-z0-9+/=]{16,}/g, "[token]") + "...";
    };
    const scan = (value, path, hits) => {
      if (typeof value === "string") {
        for (const needle of suspiciousNeedles) {
          if (needle.pattern.test(value)) {
            hits.push({ area: path[0], path: path.join("."), kind: needle.name, preview: safePreview(value) });
          }
        }
        return;
      }
      if (!value || typeof value !== "object") return;
      if (Array.isArray(value)) {
        value.forEach((item, index) => scan(item, path.concat(String(index)), hits));
        return;
      }
      for (const [key, nested] of Object.entries(value)) {
        scan(nested, path.concat(key), hits);
      }
    };

    Promise.all([
      chrome.storage.local.get(null).catch((error) => ({ __readError: String(error) })),
      chrome.storage.session.get(null).catch((error) => ({ __readError: String(error) })),
    ]).then(([local, session]) => {
      const hits = [];
      scan(local, ["local"], hits);
      scan(session, ["session"], hits);
      resolve({
        ok: hits.length === 0,
        localKeyCount: Object.keys(local || {}).length,
        sessionKeyCount: Object.keys(session || {}).length,
        hits,
      });
    });
  }))()`);
}

async function configureScreenshotRecoveryAudit(extensionId, endpoint) {
  return extensionPageEval(extensionId, `(() => new Promise((resolve) => {
    const readinessKey = "readinessChecksV1";
    chrome.storage.sync.get("settings", (syncStored) => {
      const originalSettings = syncStored?.settings;
      const hadSettings = Object.prototype.hasOwnProperty.call(syncStored || {}, "settings");
      chrome.storage.local.get(readinessKey, (localStored) => {
        const originalReadiness = localStored?.[readinessKey];
        const hadReadiness = Object.prototype.hasOwnProperty.call(localStored || {}, readinessKey);
        const nextSettings = {
          ...(originalSettings || {}),
          deepClassifyEnabled: true,
          tierBProvider: "openai-compatible",
          tierBEndpoint: ${JSON.stringify(endpoint)},
          vllmEndpoint: ${JSON.stringify(endpoint)},
          tierBModel: "audit-screenshot-model",
          vllmModel: "audit-screenshot-model",
          tierBUseTierAEndpoint: false,
          tierBUseTierAModel: false
        };
        const nextReadiness = {
          ...(originalReadiness || {}),
          ai_analysis: {
            ...(originalReadiness?.ai_analysis || {}),
            feature: "ai_analysis",
            status: "pass",
            capabilities: {
              ...(originalReadiness?.ai_analysis?.capabilities || {}),
              vision: "supported"
            },
            checkedAt: new Date().toISOString()
          }
        };
        chrome.storage.sync.set({ settings: nextSettings }, () => {
          chrome.storage.local.set({ [readinessKey]: nextReadiness }, () => {
            resolve({ hadSettings, originalSettings, hadReadiness, originalReadiness });
          });
        });
      });
    });
  }))()`);
}

async function restoreScreenshotRecoveryAudit(extensionId, snapshot) {
  if (!snapshot) return;
  await extensionPageEval(extensionId, `(() => new Promise((resolve) => {
    const readinessKey = "readinessChecksV1";
    const finish = () => {
      if (${JSON.stringify(snapshot.hadReadiness === true)}) {
        chrome.storage.local.set({ [readinessKey]: ${JSON.stringify(snapshot.originalReadiness ?? null)} }, () => resolve(true));
      } else {
        chrome.storage.local.remove(readinessKey, () => resolve(true));
      }
    };
    if (${JSON.stringify(snapshot.hadSettings === true)}) {
      chrome.storage.sync.set({ settings: ${JSON.stringify(snapshot.originalSettings ?? null)} }, finish);
    } else {
      chrome.storage.sync.remove("settings", finish);
    }
  }))()`);
}

async function auditScreenshotRecovery(extensionId, allowedBase) {
  const mockEndpoint = await startMockOpenAiEndpoint();
  let storageSnapshot;
  let article;
  let side;
  let articleTarget;
  let sideTarget;
  try {
    storageSnapshot = await configureScreenshotRecoveryAudit(extensionId, mockEndpoint.endpoint);
    articleTarget = await createTarget(`${allowedBase}/screenshot-recovery`);
    sideTarget = await openSidePanelTestPage(extensionId, articleTarget, "screenshot");
    article = connectCdp(articleTarget.webSocketDebuggerUrl);
    side = connectCdp(sideTarget.webSocketDebuggerUrl);
    await sleep(1000);
    await side.evaluate(`document.querySelector('#pageReadCurrent')?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })); undefined`);
    await waitFor(side, `(() => Boolean(document.querySelector('.page-reader-screenshot[data-state="offer"] #pageScreenshotCapture')))()`, 18000, "Web screenshot offer").catch(async (error) => {
      await side.screenshot(resolve(OUT_DIR, "page-screenshot-offer-timeout.png")).catch(() => {});
      throw error;
    });
    const offer = await side.evaluateJson(`(() => {
      const pane = document.querySelector('#page-pane');
      const screenshot = pane?.querySelector('.page-reader-screenshot');
      const advisor = pane?.querySelector('.page-reader-advisor');
      const modelContext = pane?.querySelector('.page-reader-model-context');
      return {
        text: screenshot?.textContent?.replace(/\\s+/g, ' ').trim() || '',
        state: screenshot?.getAttribute('data-state') || null,
        hasCaptureButton: Boolean(document.querySelector('#pageScreenshotCapture')),
        hasPreview: Boolean(document.querySelector('.page-reader-screenshot-preview')),
        pipelineHidden: !advisor && !modelContext,
        warningsHidden: !pane?.querySelector('.page-reader-warnings'),
        advisorRows: [...advisor?.querySelectorAll('dl div') || []].map((row) => ({
          label: row.querySelector('dt')?.textContent?.trim(),
          value: row.querySelector('dd')?.textContent?.trim(),
          rawValue: row.querySelector('dd')?.getAttribute('data-raw-value') || row.querySelector('dd')?.textContent?.trim()
        }))
      };
    })()`);
    await side.screenshot(resolve(OUT_DIR, "page-screenshot-offer.png"));
    const screenshotTab = await side.evaluateJson(`(() => new Promise((resolve) => {
      chrome.tabs.query({}, (tabs) => {
        const tab = tabs.find((item) => /\\/screenshot-recovery\\b/.test(item.url || ''));
        if (!tab?.id) {
          resolve({ ok: false, error: 'screenshot_tab_not_found' });
          return;
        }
        chrome.tabs.update(tab.id, { active: true }, (updated) => {
          resolve({
            ok: !chrome.runtime.lastError,
            error: chrome.runtime.lastError?.message || '',
            tabId: tab.id,
            windowId: updated?.windowId,
            url: updated?.url || tab.url || ''
          });
        });
      });
    }))()`);
    if (!screenshotTab?.ok || typeof screenshotTab.tabId !== "number") {
      throw new Error(`Unable to activate screenshot fixture tab: ${screenshotTab?.error || "unknown"}`);
    }
    await waitFor(side, `(() => {
      const state = globalThis.__trulyPageReadingRuntime?.auditState?.() || {};
      return state.activeTabId === ${JSON.stringify(screenshotTab.tabId)} &&
        state.displayTabId === ${JSON.stringify(screenshotTab.tabId)} &&
        Boolean(document.querySelector('#pageScreenshotCapture'));
    })()`, 8000, "Web screenshot tab activation").catch(async (error) => {
      const activationState = await side.evaluateJson(`(() => ({
        runtimeState: globalThis.__trulyPageReadingRuntime?.auditState?.() || null,
        hasCaptureButton: Boolean(document.querySelector('#pageScreenshotCapture')),
        paneText: document.querySelector('#page-pane')?.innerText || ''
      }))()`).catch((captureError) => ({ captureError: captureError.message }));
      writeFileSync(resolve(OUT_DIR, "page-screenshot-activation-timeout.json"), JSON.stringify({ screenshotTab, activationState }, null, 2));
      await side.screenshot(resolve(OUT_DIR, "page-screenshot-activation-timeout.png")).catch(() => {});
      throw error;
    });
    const captureStub = await side.evaluateJson(`(() => {
      const originalType = typeof chrome.tabs.captureVisibleTab;
      globalThis.__trulyAuditCaptureVisibleTabCalls = [];
      chrome.tabs.captureVisibleTab = (windowId, options) => {
        globalThis.__trulyAuditCaptureVisibleTabCalls.push({ windowId, options });
        return "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNQTf7/HwAEvwKHHvca0gAAAABJRU5ErkJggg==";
      };
      return { stubbed: true, originalType };
    })()`);

    const captureClickState = await side.evaluateJson(`(async () => {
      let clicked = false;
      for (let attempt = 0; attempt < 20; attempt += 1) {
        const button = document.querySelector('#pageScreenshotCapture');
        if (button) {
          clicked = button.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      await new Promise((resolve) => setTimeout(resolve, 700));
      const screenshot = document.querySelector('.page-reader-screenshot');
      return {
        clicked,
        runtimeState: globalThis.__trulyPageReadingRuntime?.auditState?.() || null,
        auditEvents: globalThis.__trulyPageReadingAuditEvents || [],
        captureCalls: globalThis.__trulyAuditCaptureVisibleTabCalls || [],
        state: screenshot?.getAttribute('data-state') || null,
        text: screenshot?.textContent?.replace(/\\s+/g, ' ').trim() || '',
        hasPreview: Boolean(document.querySelector('.page-reader-screenshot-preview')),
        hasError: Boolean(document.querySelector('.page-reader-screenshot-error'))
      };
    })()`);
    await waitFor(side, `(() => {
      const img = document.querySelector('.page-reader-screenshot-preview');
      const rect = img?.getBoundingClientRect();
      return Boolean(img?.getAttribute('src')?.startsWith('data:image/')) &&
        (rect?.height || 0) >= 100 &&
        Boolean(document.querySelector('#pageScreenshotConfirm')) &&
        Boolean(document.querySelector('#pageScreenshotCancel'));
    })()`, 12000, "Web screenshot preview").catch(async (error) => {
      writeFileSync(resolve(OUT_DIR, "page-screenshot-preview-timeout.json"), JSON.stringify(captureClickState, null, 2));
      await side.screenshot(resolve(OUT_DIR, "page-screenshot-preview-timeout.png")).catch(() => {});
      throw error;
    });
    const preview = await side.evaluateJson(`(() => {
      const img = document.querySelector('.page-reader-screenshot-preview');
      return {
        state: document.querySelector('.page-reader-screenshot')?.getAttribute('data-state') || null,
        imgSrcPrefix: img?.getAttribute('src')?.slice(0, 32) || '',
        previewRect: img ? (() => {
          const rect = img.getBoundingClientRect();
          return { width: rect.width, height: rect.height };
        })() : null,
        hasConfirmButton: Boolean(document.querySelector('#pageScreenshotConfirm')),
        hasCancelButton: Boolean(document.querySelector('#pageScreenshotCancel')),
        explanation: document.querySelector('.page-reader-screenshot')?.textContent?.replace(/\\s+/g, ' ').trim() || ''
      };
    })()`);
    await side.screenshot(resolve(OUT_DIR, "page-screenshot-preview.png"));

    await side.evaluate(`document.querySelector('#pageScreenshotConfirm')?.click(); undefined`);
    await waitFor(side, `(() => /Screenshot-grounded synthetic summary|截圖/.test(document.querySelector('#page-pane')?.innerText || '') && !document.querySelector('.page-reader-screenshot-preview'))()`, 18000, "Web screenshot confirmed brief").catch(async (error) => {
      await side.screenshot(resolve(OUT_DIR, "page-screenshot-confirm-timeout.png")).catch(() => {});
      throw error;
    });
    const confirmed = await side.evaluateJson(`(() => {
      const pane = document.querySelector('#page-pane');
      return {
        hasPreview: Boolean(document.querySelector('.page-reader-screenshot-preview')),
        screenshotState: document.querySelector('.page-reader-screenshot')?.getAttribute('data-state') || null,
        analysisStatus: pane?.querySelector('.page-reader-analysis .page-reader-analysis-header span')?.textContent?.trim() || '',
        analysisText: pane?.querySelector('.page-reader-analysis')?.textContent?.replace(/\\s+/g, ' ').trim() || '',
        domHasDataImage: /data:image\\//.test(pane?.innerHTML || '')
      };
    })()`);
    await side.screenshot(resolve(OUT_DIR, "page-screenshot-confirmed.png"));
    const storageAfter = await auditStoragePrivacy(extensionId);
    return {
      endpoint: mockEndpoint.endpoint.replace(/:\d+\/v1$/, ":<port>/v1"),
      offer,
      captureStub,
      captureClickState,
      preview,
      confirmed,
      requests: mockEndpoint.requests.map((item) => ({
        kind: item.kind,
        url: item.url,
        hasImageUrl: item.hasImageUrl,
        containsDataImage: item.containsDataImage,
        currentExtractionMentionsFixture: item.currentExtractionMentionsFixture,
      })),
      storageAfter,
    };
  } finally {
    if (side) {
      await side.closeTarget().catch(() => {});
      side.close();
    }
    if (article) {
      await article.closeTarget().catch(() => {});
      article.close();
    }
    await restoreScreenshotRecoveryAudit(extensionId, storageSnapshot).catch(() => {});
    await mockEndpoint.close();
  }
}

async function auditPopup(extensionId, allowedUrl) {
  const popupTarget = await createTarget(`chrome-extension://${extensionId}/popup/popup.html?auditActiveUrl=${encodeURIComponent(allowedUrl)}`);
  const popup = connectCdp(popupTarget.webSocketDebuggerUrl);
  try {
    await sleep(800);
    const general = await popup.evaluateJson(`(() => ({
      title: document.querySelector('#readinessTitle')?.textContent?.trim(),
      detail: document.querySelector('#readinessDetail')?.textContent?.trim(),
      dotClass: document.querySelector('#pageDot')?.className || '',
      button: document.querySelector('#dashboardLabel')?.textContent?.trim(),
      disabled: document.querySelector('#dashboardLink')?.disabled ?? null
    }))()`);
    await popup.evaluate(`location.href = ${JSON.stringify(`chrome-extension://${extensionId}/popup/popup.html?auditActiveUrl=${encodeURIComponent("chrome://settings/")}`)}; undefined`);
    await sleep(800);
    const unsupported = await popup.evaluateJson(`(() => ({
      title: document.querySelector('#readinessTitle')?.textContent?.trim(),
      detail: document.querySelector('#readinessDetail')?.textContent?.trim(),
      dotClass: document.querySelector('#pageDot')?.className || '',
      button: document.querySelector('#dashboardLabel')?.textContent?.trim(),
      disabled: document.querySelector('#dashboardLink')?.disabled ?? null
    }))()`);
    return { general, unsupported };
  } finally {
    await popup.closeTarget().catch(() => {});
    popup.close();
  }
}

async function auditPopupReadClick(extensionId, allowedBase) {
  const articleUrl = `${allowedBase}/article?popup=1`;
  const articleTarget = await createTarget(articleUrl);
  const article = connectCdp(articleTarget.webSocketDebuggerUrl);
  let popup;
  let side;
  try {
    const sideTarget = await openSidePanelTestPage(extensionId, articleTarget, "popup-read-result");
    side = connectCdp(sideTarget.webSocketDebuggerUrl);
    await sleep(800);
    const initialSide = await side.evaluateJson(`(() => ({
      activeTab: document.querySelector('.tab[aria-selected="true"]')?.textContent?.trim(),
      status: document.querySelector('#page-pane .page-reader-card-status')?.textContent?.trim() || document.querySelector('#page-pane .page-reader-status-label')?.textContent?.trim(),
      title: document.querySelector('#page-pane .page-reader-title-block h2')?.textContent?.trim() || null,
      text: document.querySelector('#page-pane')?.innerText || '',
      readDisabled: document.querySelector('#pageReadCurrent')?.disabled ?? null
    }))()`);
    const popupTarget = await openActionPopup(extensionId, articleTarget, "popup-read");
    popup = connectCdp(popupTarget.webSocketDebuggerUrl);
    await sleep(900);
    const before = await popup.evaluateJson(`(async () => {
      const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
      const tab = tabs?.[0] || null;
      return {
        activeTab: tab ? { id: tab.id, url: tab.url, title: tab.title, active: tab.active, windowId: tab.windowId } : null,
        button: document.querySelector('#dashboardLabel')?.textContent?.trim(),
        disabled: document.querySelector('#dashboardLink')?.disabled ?? null,
        dotClass: document.querySelector('#pageDot')?.className || '',
        sidePanelOpen: document.querySelector('#dashboardLink')?.dataset.sidepanelOpen || null
      };
    })()`);
    await popup.evaluate(`document.querySelector('#dashboardLink')?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })); undefined`);
    await waitFor(side, `(() => /Synthetic General Page Reader Article/.test(document.querySelector('#page-pane')?.innerText || ''))()`, 8000, "popup-triggered Web replay")
      .catch(async (error) => {
        await capturePopupReadTimeoutState(popup, side, article, before, initialSide, "replay");
        throw error;
      });
    await waitFor(side, WEB_SURFACE_READY_EXPRESSION, 8000, "popup-triggered Web ready status")
      .catch(async (error) => {
        await capturePopupReadTimeoutState(popup, side, article, before, initialSide, "ready");
        throw error;
      });
    await side.screenshot(resolve(OUT_DIR, "page-popup-read-result.png"));
    const sideState = await side.evaluateJson(`(() => ({
      activeTab: document.querySelector('.tab[aria-selected="true"]')?.textContent?.trim(),
      status: document.querySelector('#page-pane .page-reader-card-status')?.textContent?.trim() || document.querySelector('#page-pane .page-reader-status-label')?.textContent?.trim(),
      title: document.querySelector('#page-pane .page-reader-title-block h2')?.textContent?.trim(),
      excerpt: document.querySelector('#page-pane .page-reader-excerpt')?.textContent?.trim(),
      readDisabled: document.querySelector('#pageReadCurrent')?.disabled ?? null,
      text: document.querySelector('#page-pane')?.innerText || '',
      runtimeState: globalThis.__trulyPageReadingRuntime?.auditState?.() || null
    }))()`);
    return { before, initialSide, sideState };
  } finally {
    await side?.closeTarget().catch(() => {});
    side?.close();
    await popup?.closeTarget().catch(() => {});
    popup?.close();
    await article.closeTarget().catch(() => {});
    article.close();
  }
}

async function capturePopupReadTimeoutState(popup, side, article, before, initialSide, stage) {
  const state = {
    stage,
    before,
    initialSide,
    popup: await popup.evaluateJson(`(() => ({
      href: location.href,
      body: document.body?.innerText || '',
      button: document.querySelector('#dashboardLabel')?.textContent?.trim(),
      disabled: document.querySelector('#dashboardLink')?.disabled ?? null,
      sidePanelOpen: document.querySelector('#dashboardLink')?.dataset.sidepanelOpen || null
    }))()`).catch((error) => ({ error: error.message })),
    side: await side.evaluateJson(`(() => ({
      href: location.href,
      activeTab: document.querySelector('.tab[aria-selected="true"]')?.textContent?.trim(),
      status: document.querySelector('#page-pane .page-reader-card-status')?.textContent?.trim() || document.querySelector('#page-pane .page-reader-status-label')?.textContent?.trim(),
      detail: document.querySelector('#page-pane .page-reader-status-detail')?.textContent?.trim(),
      readDisabled: document.querySelector('#pageReadCurrent')?.disabled ?? null,
      text: document.querySelector('#page-pane')?.innerText || '',
      runtimeState: globalThis.__trulyPageReadingRuntime?.auditState?.() || null
    }))()`).catch((error) => ({ error: error.message })),
    article: await article.evaluateJson(`(() => ({
      href: location.href,
      title: document.title,
      bodyLength: document.body?.innerText?.length || 0,
      readyState: document.readyState
    }))()`).catch((error) => ({ error: error.message })),
  };
  writeFileSync(resolve(OUT_DIR, `page-popup-read-${stage}-timeout.json`), JSON.stringify(state, null, 2));
  await side.screenshot(resolve(OUT_DIR, `page-popup-read-${stage}-timeout.png`)).catch(() => {});
}

async function auditSuccessfulRead(extensionId, allowedBase) {
  const articleTarget = await createTarget(`${allowedBase}/article`);
  const sideTarget = await openSidePanelTestPage(extensionId, articleTarget, "success");
  const article = connectCdp(articleTarget.webSocketDebuggerUrl);
  const side = connectCdp(sideTarget.webSocketDebuggerUrl);
  let secondArticle;
  let thirdArticle;

  try {
    await side.evaluate(`(() => {
      const startedAt = performance.now();
      const entries = [];
      let lastSignature = "";
      const norm = (value) => (value || "").replace(/\\s+/g, " ").trim();
      const capture = () => {
        const pane = document.querySelector("#page-pane");
        const claimRow = pane?.querySelector(".page-claim-row");
        const runtimeState = globalThis.__trulyPageReadingRuntime?.auditState?.() || null;
        const entry = {
          elapsedMs: Math.round(performance.now() - startedAt),
          status: norm(pane?.querySelector(".page-reader-card-status")?.textContent || pane?.querySelector(".page-reader-status-label")?.textContent),
          detail: norm(pane?.querySelector(".page-reader-status-detail")?.textContent),
          title: norm(pane?.querySelector(".page-reader-title-block h2")?.textContent),
          text: norm(pane?.innerText).slice(0, 1200),
          extractionDiagnosticsPresent: Boolean(pane?.querySelector(".page-reader-extraction-diagnostics")),
          extractionDiagnosticsOpen: pane?.querySelector(".page-reader-extraction-diagnostics")?.hasAttribute("open") ?? null,
          processingStatusPresent: Boolean(pane?.querySelector(".page-reader-processing-status")),
          modelContextPresent: Boolean(pane?.querySelector(".page-reader-model-context")),
          advisorPresent: Boolean(pane?.querySelector(".page-reader-advisor")),
          previewPresent: Boolean(pane?.querySelector(".page-reader-excerpt, .page-reader-preview")),
          previewDirectPresent: Boolean(pane?.querySelector(".page-reader-card > .page-reader-excerpt, .page-reader-card > .page-reader-preview")),
          pageContextPresent: Boolean(pane?.querySelector(".page-reader-context-details")),
          pageContextOpen: pane?.querySelector(".page-reader-context-details")?.hasAttribute("open") ?? null,
          analysisClass: pane?.querySelector(".page-reader-analysis")?.className || "",
          liveStatusCount: pane?.querySelectorAll('[role="status"][aria-live]').length || 0,
          secondaryLoadingStatusPresent: Boolean(pane?.querySelector('.page-reader-loading-analysis .page-reader-analysis-loading')),
          readActionPresent: Boolean(pane?.querySelector("#pageReadCurrent")),
          readActionClass: pane?.querySelector("#pageReadCurrent")?.className || "",
          readActionText: norm(pane?.querySelector("#pageReadCurrent")?.textContent),
          readActionAriaDisabled: pane?.querySelector("#pageReadCurrent")?.getAttribute("aria-disabled") || "",
          exportActionCount: pane?.querySelectorAll(".page-reader-external-tools .page-reader-card-action").length || 0,
          supplementalDetailsOpen: pane?.querySelector(".page-reader-supplemental-details")?.hasAttribute("open") ?? null,
          claimPreparingPresent: (runtimeState?.displayedSession?.investigationPreparingCount ?? 0) > 0,
          claimPreparingText: (runtimeState?.displayedSession?.investigationPreparingCount ?? 0) > 0
            ? "background Adapter preparation"
            : "",
          claimHeadingLoadingVisible: Boolean(pane?.querySelector(".page-claim-section-loading")),
          claimCompactRowVisible: Boolean(claimRow?.querySelector(".page-claim-investigation")),
          claimActionReadyVisible: Boolean(claimRow?.querySelector(".page-claim-investigation-actions")),
          runtimeState,
        };
        const signature = JSON.stringify({ ...entry, elapsedMs: 0 });
        if (signature === lastSignature) return;
        lastSignature = signature;
        entries.push(entry);
      };
      const observer = new MutationObserver(capture);
      observer.observe(document.documentElement, { childList: true, subtree: true, attributes: true });
      const interval = setInterval(capture, 50);
      globalThis.__trulyPagePaneTimeline = {
        entries,
        stop() {
          capture();
          observer.disconnect();
          clearInterval(interval);
          return entries;
        },
      };
      capture();
    })()`);
    await waitFor(
      side,
      `Boolean(document.querySelector('#page-pane .page-reader-card.is-loading-target'))`,
      1200,
      "initial reading skeleton",
    ).then(() => side.screenshot(resolve(OUT_DIR, "page-loading-initial.png"))).catch(() => {});
    await sleep(800);
    const initial = await side.evaluateJson(`(() => ({
      activeTab: document.querySelector('.tab[aria-selected="true"]')?.textContent?.trim(),
      pageText: document.querySelector('#page-pane')?.innerText,
      readDisabled: document.querySelector('#pageReadCurrent')?.disabled ?? null
    }))()`);

    const autoRead = await side.evaluateJson(`(() => new Promise((resolve) => {
      chrome.permissions.contains({ origins: ['http://*/*', 'https://*/*'] }, (allSites) => {
        resolve({
          allSites: Boolean(allSites),
          permissionError: chrome.runtime.lastError?.message || ''
        });
      });
    }))()`);
    autoRead.observed = false;
    autoRead.error = "";
    if (autoRead.allSites) {
      await waitFor(side, WEB_SURFACE_READY_EXPRESSION, 8000, "Web auto-read ready state")
        .then(() => {
          autoRead.observed = true;
        })
        .catch(async (error) => {
          autoRead.error = error.message;
          await side.screenshot(resolve(OUT_DIR, "page-auto-read-timeout.png")).catch(() => {});
        });
    }

    if (!autoRead.observed) {
      await side.evaluate(`document.querySelector('#pageReadCurrent')?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })); undefined`);
    }
    await waitFor(side, `(() => {
      const activeState = globalThis.__trulyPageReadingRuntime?.auditState?.();
      return Boolean(document.querySelector('#page-pane .page-reader-card')) &&
        activeState?.displayedSession?.status === 'ready' &&
        activeState?.displayedSession?.hasSurface === true;
    })()`, 8000, "Web ready state").catch(async (error) => {
      const timeoutState = await capturePageReadTimeoutState(side, article, initial).catch((captureError) => ({
        initial,
        captureError: captureError.message,
      }));
      await side.screenshot(resolve(OUT_DIR, "page-ready-timeout.png")).catch(() => {});
      writeFileSync(resolve(OUT_DIR, "page-ready-timeout.json"), JSON.stringify(timeoutState, null, 2));
      error.message = `${error.message}; diagnostics: ${relative(ROOT, resolve(OUT_DIR, "page-ready-timeout.json"))}`;
      throw error;
    });
    await waitFor(
      side,
      `Boolean(document.querySelector('#page-pane .page-reader-card:not(.is-loading-target) .page-reader-analysis.is-running'))`,
      1200,
      "reading analysis running state",
    ).then(() => side.screenshot(resolve(OUT_DIR, "page-analysis-running.png"))).catch(() => {});
    await waitFor(side, `(() => {
      const processingReady = /頁面狀態|Page status/.test(document.querySelector('#page-pane .page-reader-processing-status')?.textContent || '');
      const briefReady = Boolean(document.querySelector('#page-pane .page-reader-analysis:not(.is-running)'));
      return processingReady || briefReady;
    })()`, 8000, "Web analysis scope or brief").catch(async (error) => {
      await side.screenshot(resolve(OUT_DIR, "page-ready-advisor-timeout.png")).catch(() => {});
      throw error;
    });

    const ready = await side.evaluateJson(`(() => {
      const pane = document.querySelector('#page-pane');
      const runtimeState = globalThis.__trulyPageReadingRuntime?.auditState?.().displayedSession || null;
      const processing = pane?.querySelector('.page-reader-processing-status');
      const advisor = pane?.querySelector('.page-reader-advisor');
      const processingRows = [...processing?.querySelectorAll('dl div') || []].map((row) => ({
        label: row.querySelector('dt')?.textContent?.trim(),
        value: row.querySelector('dd')?.textContent?.trim(),
        rawValue: row.querySelector('dd')?.getAttribute('data-raw-value') || row.querySelector('dd')?.textContent?.trim()
      }));
      return {
        runtimeState,
        activeTab: document.querySelector('.tab[aria-selected="true"]')?.textContent?.trim(),
        status: pane?.querySelector('.page-reader-card-status')?.textContent?.trim() || pane?.querySelector('.page-reader-status-label')?.textContent?.trim(),
        statusTitle: pane?.querySelector('.page-reader-card-meta')?.getAttribute('title') || pane?.querySelector('.page-reader-status')?.getAttribute('title') || '',
        statusAriaLabel: pane?.querySelector('.page-reader-status')?.getAttribute('aria-label') || pane?.querySelector('.page-reader-card-meta')?.getAttribute('title') || '',
        detail: pane?.querySelector('.page-reader-status-detail')?.textContent?.trim(),
        primaryActions: {
          hasStandaloneHeader: Boolean(pane?.querySelector('.page-reader-header')),
          cardScopedReadAction: Boolean(pane?.querySelector('.page-reader-card-header #pageReadCurrent, .page-reader-card-header #pageAuthorizeDomain')),
          hasTopLevelFocusTab: Boolean(document.querySelector('.tab[data-tab="focus"]')),
          hasInternalWorkspaceTabs: Boolean(pane?.querySelector('.page-reader-workspace-tabs')),
          selectionInFocus: Boolean(pane?.querySelector('.page-reader-focus-panel #pageReadSelection')),
          noPaneCommandBar: !pane?.querySelector('.page-reader-command-bar'),
        },
        title: pane?.querySelector('.page-reader-title-block h2')?.textContent?.trim(),
        excerpt: pane?.querySelector('.page-reader-excerpt')?.textContent?.trim(),
        meta: [...pane?.querySelectorAll('.page-reader-meta div') || []].map((el) => ({
          label: el.querySelector('dt')?.textContent?.trim(),
          value: el.querySelector('dd')?.textContent?.trim()
        })),
        extractionDiagnosticsOpen: pane?.querySelector('.page-reader-extraction-diagnostics')?.hasAttribute('open') ?? null,
        supplementalDetailsOpen: pane?.querySelector('.page-reader-supplemental-details')?.hasAttribute('open') ?? null,
        processingStatus: processing ? {
          title: processing.querySelector('h3')?.textContent?.trim(),
          status: processing.querySelector('.page-reader-processing-status-header span')?.textContent?.trim(),
          detail: processing.querySelector('p')?.textContent?.trim(),
          className: processing.className,
          rows: processingRows,
          diagnosticsOpen: processing.querySelector('.page-reader-diagnostics')?.hasAttribute('open') ?? null
        } : null,
        modelContext: processing ? {
          title: processing.querySelector('h3')?.textContent?.trim(),
          status: processing.querySelector('.page-reader-processing-status-header span')?.textContent?.trim(),
          detail: processing.querySelector('p')?.textContent?.trim(),
          className: processing.className,
          rows: processingRows,
          diagnosticsOpen: processing.querySelector('.page-reader-diagnostics')?.hasAttribute('open') ?? null
        } : (() => {
          const el = pane?.querySelector('.page-reader-model-context');
          return el ? {
            title: el.querySelector('h3')?.textContent?.trim(),
            status: el.querySelector('.page-reader-model-context-header span')?.textContent?.trim(),
            detail: el.querySelector('p')?.textContent?.trim(),
            className: el.className,
            rows: [...el.querySelectorAll('dl div')].map((row) => ({
              label: row.querySelector('dt')?.textContent?.trim(),
              value: row.querySelector('dd')?.textContent?.trim(),
            rawValue: row.querySelector('dd')?.getAttribute('data-raw-value') || row.querySelector('dd')?.textContent?.trim()
            })),
            diagnosticsOpen: el.querySelector('.page-reader-diagnostics')?.hasAttribute('open') ?? null
          } : null;
        })(),
        advisor: processing ? {
          title: processing.querySelector('h3')?.textContent?.trim(),
          status: processing.querySelector('.page-reader-processing-status-header span')?.textContent?.trim(),
          detail: processing.querySelector('p')?.textContent?.trim(),
          rows: processingRows,
          note: '',
          diagnosticsOpen: processing.querySelector('.page-reader-diagnostics')?.hasAttribute('open') ?? null
        } : advisor ? {
          title: advisor.querySelector('h3')?.textContent?.trim(),
          status: advisor.querySelector('.page-reader-advisor-header span')?.textContent?.trim(),
          detail: advisor.querySelector('p')?.textContent?.trim(),
          rows: [...advisor.querySelectorAll('dl div')].map((row) => ({
            label: row.querySelector('dt')?.textContent?.trim(),
            value: row.querySelector('dd')?.textContent?.trim(),
            rawValue: row.querySelector('dd')?.getAttribute('data-raw-value') || row.querySelector('dd')?.textContent?.trim()
          })),
          note: advisor.querySelector('.page-reader-advisor-note')?.textContent?.trim(),
          diagnosticsOpen: advisor.querySelector('.page-reader-diagnostics')?.hasAttribute('open') ?? null
        } : null,
        pageAnalysis: (() => {
          const el = pane?.querySelector('.page-reader-analysis');
          const questionList = el?.querySelector('.reading-brief-question-list');
          const questionRow = questionList?.querySelector(':scope > .reading-brief-question-row');
          const questionActions = questionRow?.querySelector('.reading-brief-question-actions');
          return el ? {
            className: el.className,
            title: el.querySelector('h3')?.textContent?.trim(),
            statusVisible: Boolean(el.querySelector('.page-reader-analysis-header span:not(.page-reader-analysis-scope)')),
            scope: el.querySelector('.page-reader-analysis-scope')?.textContent?.trim() || '',
            singleSectionCount: el.querySelectorAll('.page-reader-analysis-section.is-single').length,
            listSectionCount: el.querySelectorAll('.page-reader-analysis-section:not(.is-single):not(.page-reader-analysis-questions) ul').length,
            questionListTag: questionList?.tagName || '',
            questionRowTag: questionRow?.tagName || '',
            questionRowDisplay: questionRow ? getComputedStyle(questionRow).display : '',
            questionActionJustifySelf: questionActions ? getComputedStyle(questionActions).justifySelf : '',
          } : null;
        })(),
        cardActions: {
          headerCopy: Boolean(pane?.querySelector('.page-reader-card-header #pageCopyMetadata')),
          headerDownload: Boolean(pane?.querySelector('.page-reader-card-header #pageDownloadMarkdown')),
          footerCopy: Boolean(pane?.querySelector('.page-reader-card-tools #pageCopyMetadata')),
          footerDownload: Boolean(pane?.querySelector('.page-reader-card-tools #pageDownloadMarkdown')),
          contextSourceLinks: Boolean(pane?.querySelector('.page-reader-context-details .page-reader-source-links a')),
          completeExternalToolsFooter: Boolean(pane?.querySelector('.page-reader-external-tools .page-reader-external-tools-label')) &&
            Boolean(pane?.querySelector('.page-reader-external-tools .page-reader-external-tools-hint')) &&
            Boolean(pane?.querySelector('.page-reader-external-tools #pageCopyMetadata')) &&
            Boolean(pane?.querySelector('.page-reader-external-tools #pageDownloadMarkdown')),
        },
        informationArchitecture: (() => {
          const card = pane?.querySelector('.page-reader-card');
          const context = card?.querySelector(':scope > .page-reader-context-details');
          const analysis = card?.querySelector(':scope > .page-reader-analysis');
          const tools = card?.querySelector(':scope > .page-reader-external-tools');
          const children = card ? [...card.children] : [];
          return {
            contextTitle: context?.querySelector(':scope > summary')?.textContent?.trim() || '',
            readingTitle: analysis?.querySelector('.page-reader-analysis-header h3')?.textContent?.trim() || '',
            toolsTitle: tools?.querySelector('.page-reader-external-tools-label')?.textContent?.trim() || '',
            contextCollapsed: context ? !context.hasAttribute('open') : null,
            contextBeforeReading: Boolean(context && analysis && children.indexOf(context) < children.indexOf(analysis)),
            readingBeforeTools: Boolean(analysis && tools && children.indexOf(analysis) < children.indexOf(tools)),
          };
        })(),
        sourceLinks: [...pane?.querySelectorAll('.page-reader-source-links a') || []].map((el) => ({
          label: el.textContent?.trim(),
          href: el.href
        })),
        fullTailVisible: /quick brown test page explains a public planning process/.test(pane?.innerText || ''),
        copyButton: pane?.querySelector('#pageCopyMetadata')?.textContent?.trim()
      };
    })()`);

    await waitFor(
      side,
      `(globalThis.__trulyPageReadingRuntime?.auditState?.().displayedSession?.investigationPreparingCount ?? 0) > 0`,
      1400,
      "background claim investigation preparing state",
    ).catch(() => {});
    const preparingState = await side.evaluateJson(`(() => {
      const row = document.querySelector('#page-pane .page-claim-row');
      const runtimeState = globalThis.__trulyPageReadingRuntime?.auditState?.().displayedSession;
      const preparingCount = runtimeState?.investigationPreparingCount ?? 0;
      return {
        observed: preparingCount > 0,
        text: preparingCount > 0 ? 'background Adapter preparation' : '',
        preparingCount,
        headingLoadingCount: document.querySelectorAll('#page-pane .page-claim-section-loading').length,
        perRowLoadingTextPresent: [...document.querySelectorAll('#page-pane .page-claim-row')]
          .some((item) => /正在準備查核問題|Preparing a verification question/.test(item.textContent || '')),
        compactRowVisible: Boolean(row?.querySelector('.page-claim-investigation')),
        actionReadyVisible: Boolean(row?.querySelector('.page-claim-investigation-actions')),
      };
    })()`);
    if (preparingState?.observed) {
      await side.setViewport(430, 900);
      await side.screenshot(resolve(OUT_DIR, "page-claim-investigation-preparing.png")).catch(() => {});
    }
    const pageBrief = await observePageBrief(side, "page-analysis-ready.png");
    await waitFor(
      side,
      `globalThis.__trulyPageReadingRuntime?.auditState?.().displayedSession?.investigationReadyCount === ${EXPECTED_INVESTIGATION_ACTION_COUNT} &&
        document.querySelectorAll('#page-pane .page-claim-row .page-claim-investigation-actions').length === ${EXPECTED_INVESTIGATION_ACTION_COUNT}`,
      5000,
      "background atomic investigation preparation",
    );
    const claimInvestigation = await observeClaimInvestigation(side, preparingState);
    const initialLoadTimeline = await side.evaluateJson(`(() => {
      const timeline = globalThis.__trulyPagePaneTimeline;
      return timeline?.stop?.() || timeline?.entries || [];
    })()`);
    claimInvestigation.preparingUi = preparingState;
    claimInvestigation.preparing = resolveClaimPreparationEvidence(preparingState, initialLoadTimeline);
    writeFileSync(resolve(OUT_DIR, "page-initial-load-timeline.json"), JSON.stringify(initialLoadTimeline, null, 2));
    const responsive360 = await auditResponsivePageWebLayout(side, "page-responsive-360.png", 360);
    const responsive = await auditResponsivePageWebLayout(side, "page-responsive-430.png", 430);
    claimInvestigation.fallbackStates = await auditClaimFallbackStates(side);
    const pageContext = await side.evaluateJson(`(() => {
      const details = document.querySelector('#page-pane .page-reader-context-details');
      if (!details) return { present: false };
      details.open = true;
      return {
        present: true,
        open: details.open,
        title: details.querySelector(':scope > summary')?.textContent?.trim() || '',
        hasPreview: Boolean(details.querySelector('.page-reader-excerpt, .page-reader-preview')),
        sourceLinkCount: details.querySelectorAll('.page-reader-source-links a').length,
        technicalDetailsCollapsed: [...details.querySelectorAll('.page-reader-diagnostics')].every((item) => !item.open),
      };
    })()`);
    await side.screenshot(resolve(OUT_DIR, "page-context-expanded.png"));
    await side.evaluate(`(() => {
      const details = document.querySelector('#page-pane .page-reader-context-details');
      if (details) details.open = false;
    })()`);

    const copyRaw = await side.evaluate(`(async () => {
      globalThis.__trulyCopiedText = null;
      const original = navigator.clipboard;
      Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: { writeText: async (text) => { globalThis.__trulyCopiedText = text; } }
      });
      document.querySelector('#pageCopyMetadata')?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
      await new Promise((resolve) => setTimeout(resolve, 100));
      const copied = globalThis.__trulyCopiedText || '';
      const title = document.querySelector('#page-pane .page-reader-title-block h2')?.textContent?.trim() || '';
      const summary = document.querySelector('#page-pane .page-reader-analysis-summary')?.textContent?.trim() || '';
      const modelNotice = document.querySelector('#page-pane .reading-brief-model-note')?.textContent?.trim() || '';
      Object.defineProperty(navigator, 'clipboard', { configurable: true, value: original });
      return JSON.stringify({
        buttonText: document.querySelector('#pageCopyMetadata')?.textContent?.trim(),
        hasTitle: Boolean(title) && copied.includes(title),
        hasUrl: /原始頁面：http:\\/\\/127\\.0\\.0\\.1:/.test(copied),
        hasBrief: Boolean(summary) && copied.includes(summary),
        hasVerification: /待確認事項/.test(copied),
        hasQuestions: /延伸問題/.test(copied),
        hasModelNotice: Boolean(modelNotice) && copied.includes(modelNotice),
        hasExcerpt: /頁面文字|Excerpt:|quick brown test page explains a public planning process/.test(copied),
        hasRawDiagnostics: /Extraction:|Warnings:|semantic-html|large-navigation-noise/.test(copied),
        hasSourceList: /127\\.0\\.0\\.1:\\d+\\/source/.test(copied),
        hasFullTail: /quick brown test page explains a public planning process/.test(copied),
        length: copied.length
      });
    })()`);
    const copy = JSON.parse(copyRaw);

    const secondArticleTarget = await createTarget(`${allowedBase}/article2?multi=1`);
    secondArticle = connectCdp(secondArticleTarget.webSocketDebuggerUrl);
    await activateTabWithoutWindowFocus(side, secondArticleTarget.url || "");
    await sleep(600);
    await side.evaluate(`document.querySelector('#pageReadCurrent')?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })); undefined`);
    await waitFor(side, `(() => /Second Synthetic Article/.test(document.querySelector('#page-pane')?.innerText || ''))()`, 8000, "Web second session ready").catch(async (error) => {
      await side.screenshot(resolve(OUT_DIR, "page-web-history-second-timeout.png")).catch(() => {});
      throw error;
    });
    const historySecond = await side.evaluateJson(`(() => ({
      text: document.querySelector('#page-pane')?.innerText || '',
      sessionCount: document.querySelectorAll('[data-page-session-tab-id]').length,
      switcherVisible: Boolean(document.querySelector('.page-reader-switcher')),
      selectionDisabled: document.querySelector('#pageReadSelection')?.disabled ?? null,
      activeState: globalThis.__trulyPageReadingRuntime?.auditState?.() || null
    }))()`);
    const thirdArticleTarget = await createTarget(`${allowedBase}/article3?multi=1`);
    thirdArticle = connectCdp(thirdArticleTarget.webSocketDebuggerUrl);
    await activateTabWithoutWindowFocus(side, thirdArticleTarget.url || "");
    await sleep(600);
    await side.evaluate(`document.querySelector('#pageReadCurrent')?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })); undefined`);
    await waitFor(side, `(() => /Third Synthetic Article/.test(document.querySelector('#page-pane')?.innerText || ''))()`, 8000, "Web third session ready").catch(async (error) => {
      await side.screenshot(resolve(OUT_DIR, "page-web-history-third-timeout.png")).catch(() => {});
      throw error;
    });
    const historyThird = await side.evaluateJson(`(() => ({
      text: document.querySelector('#page-pane')?.innerText || '',
      sessionCount: document.querySelectorAll('[data-page-session-tab-id]').length,
      switcherVisible: Boolean(document.querySelector('.page-reader-switcher')),
      selectionDisabled: document.querySelector('#pageReadSelection')?.disabled ?? null,
      activeState: globalThis.__trulyPageReadingRuntime?.auditState?.() || null
    }))()`);
    await waitFor(side, `(() => {
      const title = document.querySelector('#page-pane .page-reader-title-block h2')?.textContent || '';
      const state = globalThis.__trulyPageReadingRuntime?.auditState?.() || {};
      const ready = /Third Synthetic Article/.test(title) &&
        state.activeTabId === state.displayTabId &&
        document.querySelectorAll('[data-page-session-tab-id]').length === 0 &&
        !document.querySelector('.page-reader-switcher') &&
        !document.querySelector('#pageActivateDisplayedTab');
      if (!ready) return false;
      globalThis.__trulyHistoryDisplayAudit = {
        text: document.querySelector('#page-pane')?.innerText || '',
        sessionCount: document.querySelectorAll('[data-page-session-tab-id]').length,
        switcherVisible: Boolean(document.querySelector('.page-reader-switcher')),
        pageTitle: title.trim() || null,
        selectionDisabled: document.querySelector('#pageReadSelection')?.disabled ?? null,
        hasActivateButton: Boolean(document.querySelector('#pageActivateDisplayedTab')),
        activeState: state
      };
      return true;
    })()`, 8000, "Web history hidden after multiple sessions").catch(async (error) => {
      const timeoutStateRaw = await side.evaluate(`(async () => {
        const diagnostics = await new Promise((resolve) => {
          chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            const activeTab = tabs?.[0] || null;
            resolve({
              runtimeState: globalThis.__trulyPageReadingRuntime?.auditState?.() || null,
              chromeActiveTab: activeTab ? { id: activeTab.id, url: activeTab.url, title: activeTab.title, active: activeTab.active } : null,
              pageTitle: document.querySelector('#page-pane .page-reader-title-block h2')?.textContent?.trim() || null,
              selectionDisabled: document.querySelector('#pageReadSelection')?.disabled ?? null,
              hasActivateButton: Boolean(document.querySelector('#pageActivateDisplayedTab')),
              switcherVisible: Boolean(document.querySelector('.page-reader-switcher')),
              sessionCount: document.querySelectorAll('[data-page-session-tab-id]').length
            });
          });
        });
        return JSON.stringify(diagnostics);
      })()`).catch((captureError) => JSON.stringify({ captureError: captureError.message }));
      writeFileSync(resolve(OUT_DIR, "page-web-history-hidden-timeout.json"), timeoutStateRaw);
      await side.screenshot(resolve(OUT_DIR, "page-web-history-hidden-timeout.png")).catch(() => {});
      throw error;
    });
    const liveArticle = thirdArticle;
    const webFocusScenario = await runWebFocusContinuityScenario({
      side,
      article: liveArticle,
      waitFor,
      artifactPath: (name) => resolve(OUT_DIR, name),
    });
    const { continuity, selection } = webFocusScenario;
    const historyDisplay = webFocusScenario.historyDisplay;

    // Slice 6b: current-region hotkey flow. Simulate pointer movement over a
    // paragraph, then set the same session marker the SW command handler
    // writes; the panel consumes it and requests a point target.
    const pointerTab = await side.evaluateJson(`(() => globalThis.__trulyPageReadingRuntime?.auditState?.() || { activeTabId: null })()`);
    if (typeof pointerTab.activeTabId !== "number") {
      throw new Error("Unable to resolve synthetic article tab id for current-region audit");
    }
    await liveArticle.evaluate(`(() => {
      const paragraph = document.querySelector('article p:nth-of-type(2)');
      const rect = paragraph.getBoundingClientRect();
      document.dispatchEvent(new MouseEvent('mousemove', {
        clientX: rect.x + Math.min(rect.width / 2, 200),
        clientY: rect.y + Math.min(rect.height / 2, 12),
        bubbles: true
      }));
      return undefined;
    })()`);
    await side.evaluate(`chrome.storage.session.set({ pendingCurrentRegionRead: { tabId: ${JSON.stringify(pointerTab.activeTabId)}, ts: Date.now() } })`);
    await waitFor(side, `(() => {
      const state = globalThis.__trulyPageReadingRuntime?.auditState?.().displayedSession;
      return state?.targetKind === 'current-region' &&
        state?.advisorStatus !== 'checking' &&
        state?.analysisStatus !== 'running' &&
        Boolean(document.querySelector('#page-pane .page-reader-focus-panel'));
    })()`, 16000, "Web current-region target").catch(async (error) => {
      await side.screenshot(resolve(OUT_DIR, "page-point-target-timeout.png")).catch(() => {});
      throw error;
    });
    const pointTarget = await side.evaluateJson(`(() => {
      const pane = document.querySelector('#page-pane');
      const model = pane?.querySelector('.page-reader-processing-status') || pane?.querySelector('.page-reader-model-context');
      const advisor = pane?.querySelector('.page-reader-processing-status') || pane?.querySelector('.page-reader-advisor');
      const activeState = globalThis.__trulyPageReadingRuntime?.auditState?.().displayedSession || null;
      const modelRows = [...model?.querySelectorAll('dl div') || []].map((row) => ({
        label: row.querySelector('dt')?.textContent?.trim(),
        value: row.querySelector('dd')?.textContent?.trim(),
            rawValue: row.querySelector('dd')?.getAttribute('data-raw-value') || row.querySelector('dd')?.textContent?.trim()
      }));
      return {
        targetKind: activeState?.targetKind || modelRows.find((row) => /targetKind|目標|Target/.test(row.label || ''))?.rawValue,
        targetKindLabel: modelRows.find((row) => /targetKind|目標|Target/.test(row.label || ''))?.value,
        advisorStatus: activeState?.advisorStatus || advisor?.querySelector('.page-reader-processing-status-header span, .page-reader-advisor-header span')?.textContent?.trim(),
        advisorDecision: activeState?.advisorDecision || null,
        excerpt: pane?.querySelector('.page-reader-focus-preview')?.textContent?.trim(),
        focusPanelCount: pane?.querySelectorAll('.page-reader-focus-panel').length || 0,
        hasPageCard: Boolean(pane?.querySelector('.page-reader-card')),
      };
    })()`);
    await side.screenshot(resolve(OUT_DIR, "page-point-target.png"));

    const navigation = await runMeaningfulNavigationScenario({
      side,
      article: liveArticle,
      allowedBase,
      sleep,
      artifactPath: (name) => resolve(OUT_DIR, name),
    });

    return {
      initial,
      initialLoadTimeline,
      autoRead,
      ready,
      pageBrief,
      claimInvestigation,
      responsive360,
      responsive,
      pageContext,
      copy,
      history: { second: historySecond, third: historyThird, display: historyDisplay },
      selection,
      continuity,
      pointTarget,
      navigation,
    };
  } finally {
    await thirdArticle?.closeTarget().catch(() => {});
    await secondArticle?.closeTarget().catch(() => {});
    await side.closeTarget().catch(() => {});
    await article.closeTarget().catch(() => {});
    thirdArticle?.close();
    secondArticle?.close();
    side.close();
    article.close();
  }
}

async function observePageBrief(side, readyScreenshotName) {
  const observation = {
    status: "not_observed",
    screenshot: null,
    text: "",
    header: "",
    modelContextStatus: "",
    pipelineHidden: false,
    diagnosticsHidden: false,
    primaryActions: null,
    rawExcerptVisible: false,
    rawExcerptDirectVisible: false,
    rawExcerptContextualized: false,
    contextDetailsOpen: null,
    readyHeaderVisible: false,
    standardContract: null,
  };
  try {
    await waitFor(side, `(() => {
      const analysis = document.querySelector('#page-pane .page-reader-analysis');
      return analysis && !analysis.classList.contains('is-running');
    })()`, 20000, "Web page brief completion");
  } catch {
    observation.status = "pending_or_timeout";
    observation.text = await side.evaluate(`document.querySelector('#page-pane .page-reader-analysis')?.innerText || ''`).catch(() => "");
    await side.screenshot(resolve(OUT_DIR, "page-analysis-pending.png")).catch(() => {});
    observation.screenshot = relative(ROOT, resolve(OUT_DIR, "page-analysis-pending.png"));
    return observation;
  }
  const state = await side.evaluateJson(`(() => {
    const analysis = document.querySelector('#page-pane .page-reader-analysis');
    const modelContext = document.querySelector('#page-pane .page-reader-processing-status') || document.querySelector('#page-pane .page-reader-model-context');
    const advisor = document.querySelector('#page-pane .page-reader-processing-status') || document.querySelector('#page-pane .page-reader-advisor');
    const extractionDiagnostics = document.querySelector('#page-pane .page-reader-extraction-diagnostics');
    const analysisHeader = analysis?.querySelector('.page-reader-analysis-header');
    return {
      className: analysis?.className || '',
      standardContract: {
        questionCount: analysis?.querySelectorAll('.reading-brief-question-row').length ?? 0,
        multiItemListCount: analysis?.querySelectorAll('.page-reader-analysis-section:not(.page-reader-analysis-questions) li').length ?? 0,
      },
      header: analysis?.querySelector('h3')?.textContent?.trim(),
      status: analysis?.querySelector('.page-reader-analysis-header span')?.textContent?.trim(),
      text: analysis?.innerText?.trim() || '',
      modelContextStatus: modelContext?.querySelector('.page-reader-processing-status-header span, .page-reader-model-context-header span')?.textContent?.trim() || '',
      pipelineHidden: !modelContext && !advisor,
      diagnosticsHidden: !extractionDiagnostics,
      rawExcerptVisible: Boolean(document.querySelector('#page-pane .page-reader-excerpt')),
      rawExcerptDirectVisible: Boolean(document.querySelector('#page-pane .page-reader-card > .page-reader-excerpt, #page-pane .page-reader-card > .page-reader-preview')),
      rawExcerptContextualized: Boolean(document.querySelector('#page-pane .page-reader-context-details .page-reader-excerpt, #page-pane .page-reader-context-details .page-reader-preview')),
      contextDetailsOpen: document.querySelector('#page-pane .page-reader-context-details')?.hasAttribute('open') ?? null,
      readyHeaderVisible: Boolean(analysisHeader) && getComputedStyle(analysisHeader).display !== 'none',
      primaryActions: {
        hasStandaloneHeader: Boolean(document.querySelector('#page-pane .page-reader-header')),
        cardScopedReadAction: Boolean(document.querySelector('#page-pane .page-reader-card-header #pageReadCurrent, #page-pane .page-reader-card-header #pageAuthorizeDomain')),
        hasTopLevelFocusTab: Boolean(document.querySelector('.tab[data-tab="focus"]')),
        hasInternalWorkspaceTabs: Boolean(document.querySelector('#page-pane .page-reader-workspace-tabs')),
        selectionInFocus: Boolean(document.querySelector('#page-pane .page-reader-focus-panel #pageReadSelection')),
        noPaneCommandBar: !document.querySelector('#page-pane .page-reader-command-bar'),
      }
    };
  })()`);
  observation.status = /is-ready/.test(state?.className || "") ? "ready" : /is-error/.test(state?.className || "") ? "error" : "unknown";
  observation.text = state?.text || "";
  observation.header = state?.header || "";
  observation.modelContextStatus = state?.modelContextStatus || "";
  observation.pipelineHidden = Boolean(state?.pipelineHidden);
  observation.diagnosticsHidden = Boolean(state?.diagnosticsHidden);
  observation.rawExcerptVisible = Boolean(state?.rawExcerptVisible);
  observation.rawExcerptDirectVisible = Boolean(state?.rawExcerptDirectVisible);
  observation.rawExcerptContextualized = Boolean(state?.rawExcerptContextualized);
  observation.contextDetailsOpen = state?.contextDetailsOpen ?? null;
  observation.readyHeaderVisible = Boolean(state?.readyHeaderVisible);
  observation.standardContract = state?.standardContract ?? null;
  observation.primaryActions = state?.primaryActions || null;
  await side.screenshot(resolve(OUT_DIR, readyScreenshotName)).catch(() => {});
  observation.screenshot = relative(ROOT, resolve(OUT_DIR, readyScreenshotName));
  return observation;
}

async function observeClaimInvestigation(side, preparingState = null) {
  const beforeTargets = await fetch(`${CDP_BASE}/json`).then((response) => response.json()).catch(() => []);
  await side.evaluate(`new Promise((resolve) => setTimeout(resolve, 180))`);
  const state = await side.evaluateJson(`(() => {
    const cards = [...document.querySelectorAll('#page-pane .page-claim-investigation')];
    const card = cards[0];
    const row = card?.closest('.page-claim-row');
    const list = row?.closest('ul');
    if (!card) return { available: false, ready: false };
    const links = [...(card?.querySelectorAll('a') || [])].map((link) => ({
      label: link.textContent?.trim() || '',
      href: link.href,
      target: link.target,
      rel: link.rel,
    }));
    return {
      available: true,
      ready: true,
      taskId: card?.getAttribute('data-task-id') || '',
      question: card?.querySelector('.page-claim-exact')?.textContent?.trim() || '',
      rowCount: cards.length,
      bulletList: Boolean(list) && getComputedStyle(list).listStyleType === 'disc' &&
        cards.every((item) => getComputedStyle(item.closest('.page-claim-row')).display === 'list-item'),
      sourceClaimsPresent: cards.every((item) =>
        Boolean(item.querySelector('.page-claim-exact')?.textContent?.trim())),
      sourceFramingPresent: cards.every((item) =>
        /原文主張|Source claim/.test(item.querySelector('.page-claim-source-label')?.textContent?.trim() || '')),
      actionsBelowQuestion: cards.every((item) => {
        const questionRect = item.querySelector('.page-claim-investigation-question')?.getBoundingClientRect();
        const actionRect = item.querySelector('.page-claim-investigation-actions')?.getBoundingClientRect();
        return Boolean(questionRect && actionRect && actionRect.top >= questionRect.bottom - 1);
      }),
      compactActionGaps: cards.map((item) => {
        const questionRect = item.querySelector('.page-claim-investigation-question')?.getBoundingClientRect();
        const actionRect = item.querySelector('.page-claim-investigation-actions')?.getBoundingClientRect();
        return questionRect && actionRect ? Math.round((actionRect.top - questionRect.bottom) * 10) / 10 : null;
      }),
      compactActionProximity: cards.every((item) => {
        const questionRect = item.querySelector('.page-claim-investigation-question')?.getBoundingClientRect();
        const actionRect = item.querySelector('.page-claim-investigation-actions')?.getBoundingClientRect();
        if (!questionRect || !actionRect) return false;
        const gap = actionRect.top - questionRect.bottom;
        return gap >= -3 && gap <= 6;
      }),
      links,
      copyPresent: Boolean(card?.querySelector('.page-claim-copy-question')),
      evidenceTogglePresent: Boolean(card?.querySelector('.page-claim-evidence-toggle')),
      evidenceNeedHidden: card?.querySelector('.page-claim-investigation-need')?.getAttribute('aria-hidden') === 'true',
      evidenceNeedPrefixAbsent: cards.every((item) =>
        !/^(?:需要|Needed)\s*[：:]/i.test(item.querySelector('.page-claim-investigation-need')?.textContent?.trim() || '')),
      compactRows: cards.every((item) =>
        item.querySelectorAll('a').length === 1 &&
        /問 Gemini|Ask Gemini/.test(item.querySelector('a')?.textContent || '') &&
        Boolean(item.querySelector('.page-claim-copy-question')) &&
        Boolean(item.querySelector('.page-claim-evidence-toggle'))),
      manualStartPresent: Boolean(document.querySelector('#page-pane .page-claim-start')),
      originalClaimVisible: Boolean(row?.querySelector(':scope > .page-claim-copy')),
      redundantLabelPresent: Boolean(card?.querySelector('.page-claim-investigation-label, .page-claim-investigation-header')),
    };
  })()`);
  const afterTargets = await fetch(`${CDP_BASE}/json`).then((response) => response.json()).catch(() => []);
  await side.screenshot(resolve(OUT_DIR, "page-claim-investigation.png")).catch(() => {});
  const evidenceDisclosure = await side.evaluateJson(`(async () => {
    const button = document.querySelector('#page-pane .page-claim-evidence-toggle');
    if (!button) return { available: false };
    button.click();
    await new Promise((resolve) => setTimeout(resolve, 180));
    const row = button.closest('.page-claim-investigation');
    const need = row?.querySelector('.page-claim-investigation-need');
    return {
      available: true,
      expanded: button.getAttribute('aria-expanded') === 'true',
      hidden: need?.getAttribute('aria-hidden') === 'true',
      text: need?.textContent?.trim() || '',
    };
  })()`);
  if (evidenceDisclosure?.expanded) {
    await side.setViewport(430, 900);
    await side.screenshot(resolve(OUT_DIR, "page-claim-evidence-open-430.png")).catch(() => {});
    await side.evaluate(`document.querySelector('#page-pane .page-claim-evidence-toggle')?.click()`);
  }
  const evidenceHover = await auditClaimEvidenceHoverStates(side);
  return {
    ...state,
    preparing: preparingState,
    preparingScreenshot: preparingState?.observed
      ? relative(ROOT, resolve(OUT_DIR, "page-claim-investigation-preparing.png"))
      : null,
    openedTargetOnPrepare: newExternalPageTargets(beforeTargets, afterTargets).length > 0,
    evidenceDisclosure,
    evidenceScreenshot: evidenceDisclosure?.expanded
      ? relative(ROOT, resolve(OUT_DIR, "page-claim-evidence-open-430.png"))
      : null,
    evidenceHover,
    screenshot: relative(ROOT, resolve(OUT_DIR, "page-claim-investigation.png")),
  };
}

async function auditClaimEvidenceHoverStates(side) {
  const count = await side.evaluateJson(`document.querySelectorAll('#page-pane .page-claim-evidence-toggle').length`);
  if (count !== EXPECTED_INVESTIGATION_ACTION_COUNT) return { available: false, count };
  const states = [];
  await side.setViewport(430, 900);
  await side.evaluate(`(() => {
    document.scrollingElement?.scrollTo({ top: 0, left: 0, behavior: 'instant' });
    document.querySelector('#page-pane')?.scrollTo?.({ top: 0, left: 0, behavior: 'instant' });
  })()`);
  await side.send("DOM.enable");
  await side.send("CSS.enable");
  const { root } = await side.send("DOM.getDocument", { depth: -1, pierce: true });
  const { nodeIds } = await side.send("DOM.querySelectorAll", {
    nodeId: root.nodeId,
    selector: "#page-pane .page-claim-evidence-toggle",
  });
  if (nodeIds.length !== count) return { available: false, count, cdpNodeCount: nodeIds.length };
  let previousNodeId = null;
  for (let index = 0; index < count; index += 1) {
    const nodeId = nodeIds[index];
    if (previousNodeId) {
      await side.send("CSS.forcePseudoState", { nodeId: previousNodeId, forcedPseudoClasses: [] });
    }
    await side.send("CSS.forcePseudoState", { nodeId, forcedPseudoClasses: ["hover"] });
    previousNodeId = nodeId;
    // Force style resolution once so the transition starts before the timed
    // observation. CSS.forcePseudoState alone does not require an immediate
    // rendering update in a background target.
    await side.evaluate(`[...document.querySelectorAll('#page-pane .page-claim-investigation-need')]
      .map((need) => [getComputedStyle(need).visibility, getComputedStyle(need).opacity])`);
    await sleep(260);
    const state = await side.evaluateJson(`(() => {
      const rows = [...document.querySelectorAll('#page-pane .page-claim-investigation')];
      const visible = rows.map((row) => {
        const need = row.querySelector('.page-claim-investigation-need');
        if (!need) return false;
        const style = getComputedStyle(need);
        return style.visibility === 'visible' && Number(style.opacity) > 0.5 && need.getBoundingClientRect().height > 0;
      });
      const toggles = rows.map((row) => row.querySelector('.page-claim-evidence-toggle'));
      const needTexts = rows.map((row) =>
        row.querySelector('.page-claim-investigation-need')?.textContent?.trim() || '');
      const needClipped = rows.map((row, rowIndex) => {
        const need = row.querySelector('.page-claim-investigation-need');
        return visible[rowIndex] && need ? need.scrollHeight > need.clientHeight + 1 : false;
      });
      const geometry = rows.map((row) => {
        const question = row.querySelector('.page-claim-investigation-question')?.getBoundingClientRect();
        const need = row.querySelector('.page-claim-investigation-need')?.getBoundingClientRect();
        const actions = row.querySelector('.page-claim-investigation-actions')?.getBoundingClientRect();
        if (!question || !need || !actions) return null;
        return {
          questionNeedGap: Math.round((need.top - question.bottom) * 10) / 10,
          needActionGap: Math.round((actions.top - need.bottom) * 10) / 10,
          ordered: need.top >= question.bottom - 1 && actions.top >= need.bottom - 3,
        };
      });
      return {
        hoveredIndex: ${index},
        visible,
        needTexts,
        needClipped,
        geometry,
        expanded: toggles.map((toggle) => toggle?.getAttribute('aria-expanded')),
        ariaHidden: rows.map((row) => row.querySelector('.page-claim-investigation-need')?.getAttribute('aria-hidden')),
        singletonTooltipVisible: document.querySelector('#truly-tooltip')?.classList.contains('visible') ?? false,
      };
    })()`);
    states.push({
      ...state,
      onlyHoveredNeedVisible: state?.visible?.filter(Boolean).length === 1 && state.visible[index] === true,
      hoveredNeedFits: state?.needClipped?.[index] === false,
      prefixAbsent: !/^(?:需要|Needed)\s*[：:]/i.test(state?.needTexts?.[index] || ''),
      adjacentAndOrdered: Boolean(
        state?.geometry?.[index]?.ordered &&
        state.geometry[index].questionNeedGap >= 1 &&
        state.geometry[index].questionNeedGap <= 3 &&
        state.geometry[index].needActionGap <= 4
      ),
      screenshot: relative(ROOT, resolve(OUT_DIR, `page-claim-evidence-hover-${index + 1}-430.png`)),
    });
    await side.screenshot(resolve(OUT_DIR, `page-claim-evidence-hover-${index + 1}-430.png`)).catch(() => {});
  }
  if (previousNodeId) {
    await side.send("CSS.forcePseudoState", { nodeId: previousNodeId, forcedPseudoClasses: [] });
  }
  await side.clearViewport();
  return {
    available: true,
    count,
    states,
    consistent: states.length === count && states.every((state) =>
      state.onlyHoveredNeedVisible === true &&
      state.hoveredNeedFits === true &&
      state.prefixAbsent === true &&
      state.adjacentAndOrdered === true &&
      state.expanded.every((value) => value === "false") &&
      state.ariaHidden.every((value) => value === "true") &&
      state.singletonTooltipVisible === false),
  };
}

async function auditClaimFallbackStates(side) {
  const envelope = await side.evaluateJson(`(() => {
    const state = globalThis.__trulyPageReadingRuntime?.auditState?.() || {};
    const preparedActions = [...document.querySelectorAll('#page-pane .page-claim-investigation')].map((card) => ({
      displayClaim: card.querySelector('.page-claim-exact')?.textContent?.trim() || '',
      evidenceHint: card.querySelector('.page-claim-investigation-need')?.textContent?.trim() || '',
      askAiPrompt: (() => {
        const href = card.querySelector('.reading-brief-google-link')?.href || '';
        try { return new URL(href).searchParams.get('q') || ''; } catch { return ''; }
      })(),
    })).filter((action) => action.displayClaim && action.evidenceHint && action.askAiPrompt);
    return {
      available: Boolean(state.displayedSession?.analysisKey && typeof state.displayTabId === 'number' && preparedActions.length > 0),
      analysisKey: state.displayedSession?.analysisKey || '',
      tabId: state.displayTabId ?? null,
      preparedActions,
    };
  })()`);
  if (!envelope?.available) return { available: false };

  const applyResult = async (status, preparedActions) => {
    await side.evaluate(`(() => {
      const runtime = globalThis.__trulyPageReadingRuntime;
      runtime?.handleGeneralPageInvestigationResult?.({
        type: 'GENERAL_PAGE_INVESTIGATION_RESULT',
        tabId: ${JSON.stringify(envelope.tabId)},
        analysisKey: ${JSON.stringify(envelope.analysisKey)},
        scope: 'page',
        status: ${JSON.stringify(status)},
        ...(${JSON.stringify(preparedActions)} ? { preparedActions: ${JSON.stringify(preparedActions)} } : {}),
      });
    })()`);
    await new Promise((resolve) => setTimeout(resolve, 240));
  };
  const observe = () => side.evaluateJson(`(() => {
    const rows = [...document.querySelectorAll('#page-pane .page-claim-row')];
    const runtimeState = globalThis.__trulyPageReadingRuntime?.auditState?.().displayedSession || {};
    const questions = rows.map((row) => row.querySelector('.page-claim-exact')?.textContent?.trim() || '');
    return {
      rowCount: rows.length,
      compactRowCount: rows.filter((row) => row.querySelector('.page-claim-investigation')).length,
      readyCount: rows.filter((row) => row.classList.contains('is-ready')).length,
      sectionPresent: Boolean(document.querySelector('#page-pane .page-claim-section')),
      pendingLoadingCount: document.querySelectorAll('#page-pane .page-claim-section-loading').length,
      actionCount: rows.filter((row) => row.querySelector('.page-claim-investigation-actions')).length,
      adapterReadyCount: runtimeState.investigationReadyCount ?? 0,
      adapterIneligibleCount: runtimeState.investigationIneligibleCount ?? 0,
      adapterUnavailableCount: runtimeState.investigationUnavailableCount ?? 0,
      batchStatus: runtimeState.investigationBatchStatus || '',
      evidenceToggleCount: rows.filter((row) => row.querySelector('.page-claim-evidence-toggle')).length,
      sourceClaimsPresent: questions.every(Boolean),
      inlineEvidenceNeedPresent: rows.some((row) => /（需要證據：|\\(Evidence needed:/.test(row.textContent || '')),
      legacyClaimCopyPresent: rows.some((row) => row.querySelector(':scope > .page-claim-copy')),
      questions,
    };
  })()`);

  await applyResult("ineligible", null);
  const ineligible = await observe();
  await side.setViewport(430, 900);
  await side.screenshot(resolve(OUT_DIR, "page-claim-ineligible-430.png")).catch(() => {});

  await applyResult("unavailable", null);
  const unavailable = await observe();
  await side.screenshot(resolve(OUT_DIR, "page-claim-unavailable-430.png")).catch(() => {});

  await applyResult("prepared", envelope.preparedActions);

  return {
    available: true,
    ineligible,
    unavailable,
    ineligibleScreenshot: relative(ROOT, resolve(OUT_DIR, "page-claim-ineligible-430.png")),
    unavailableScreenshot: relative(ROOT, resolve(OUT_DIR, "page-claim-unavailable-430.png")),
  };
}

async function auditResponsivePageWebLayout(side, screenshotName, width = 430) {
  const height = 900;
  try {
    await side.setViewport(width, height);
    await side.evaluate(`(() => {
      document.scrollingElement?.scrollTo({ top: 0, left: 0, behavior: 'instant' });
      document.querySelector('#page-pane')?.scrollTo?.({ top: 0, left: 0, behavior: 'instant' });
    })()`);
    await sleep(300);
    const layout = await side.evaluateJson(`(() => {
      const norm = (value) => (value || "").replace(/\\s+/g, " ").trim();
      const root = document.documentElement;
      const interactiveSelectors = [
        "#page-pane button",
        "#page-pane a",
        ".tab",
      ].join(",");
      const interactiveElements = Array.from(document.querySelectorAll(interactiveSelectors))
        .map((element) => {
          const rect = element.getBoundingClientRect();
          const textClipped = element.scrollWidth - element.clientWidth > 2 ||
            element.scrollHeight - element.clientHeight > 2;
          const viewportClipped = rect.left < -1 || rect.right > window.innerWidth + 1;
          const accessibleName = norm(
            element.getAttribute("aria-label") ||
            element.getAttribute("title") ||
            element.textContent ||
            element.getAttribute("alt") ||
            ""
          );
          return {
            tag: element.tagName,
            id: element.id || "",
            className: String(element.className || ""),
            text: norm(element.textContent).slice(0, 120),
            accessibleName: accessibleName.slice(0, 120),
            rect: { left: rect.left, right: rect.right, width: rect.width, height: rect.height },
            clientWidth: element.clientWidth,
            scrollWidth: element.scrollWidth,
            clientHeight: element.clientHeight,
            scrollHeight: element.scrollHeight,
            textClipped,
            viewportClipped,
          };
        })
        .filter((item) => item.rect.width > 0 && item.rect.height > 0);
      const interactiveOverflows = interactiveElements
        .filter((item) => item.textClipped || item.viewportClipped);
      const unnamedInteractive = interactiveElements
        .filter((item) => !item.accessibleName);
      const undersizedControls = interactiveElements
        .filter((item) => (
          item.tag === "BUTTON" ||
          /\btab\b/.test(item.className)
        ) && (
          item.rect.width < 28 ||
          item.rect.height < 28
        ));
      const visibleCardsOutsideViewport = Array.from(document.querySelectorAll("#page-pane .page-reader-card, #page-pane .page-reader-processing-status, #page-pane .page-reader-model-context, #page-pane .page-reader-advisor, #page-pane .page-reader-analysis"))
        .map((element) => {
          const rect = element.getBoundingClientRect();
          return {
            tag: element.tagName,
            className: String(element.className || ""),
            text: norm(element.textContent).slice(0, 120),
            rect: { left: rect.left, right: rect.right, width: rect.width, height: rect.height },
          };
        })
        .filter((item) => item.rect.width > 0 && item.rect.height > 0 && (item.rect.left < -1 || item.rect.right > window.innerWidth + 1));
      const followupQuestionRows = Array.from(document.querySelectorAll("#page-pane .reading-brief-question-row"))
        .map((row) => {
          const question = row.querySelector(".reading-brief-question-text");
          const actions = row.querySelector(".reading-brief-question-actions");
          const rowRect = row.getBoundingClientRect();
          const questionRect = question?.getBoundingClientRect();
          const actionRect = actions?.getBoundingClientRect();
          const columns = getComputedStyle(row).gridTemplateColumns;
          return {
            text: norm(question?.textContent).slice(0, 160),
            columns,
            columnCount: columns.trim().split(/\\s+/).filter(Boolean).length,
            questionActionGap: questionRect && actionRect
              ? Math.round((actionRect.top - questionRect.bottom) * 10) / 10
              : null,
            actionsBelowQuestion: Boolean(questionRect && actionRect && actionRect.top >= questionRect.bottom - 2),
            actionsRightAligned: Boolean(actionRect && Math.abs(actionRect.right - rowRect.right) <= 1),
          };
        })
        .filter((item) => item.text);
      const questionActionsStacked = followupQuestionRows.length > 0 &&
        followupQuestionRows.every((item) =>
          item.columnCount === 1 &&
          item.actionsBelowQuestion &&
          item.actionsRightAligned &&
          typeof item.questionActionGap === "number" &&
          item.questionActionGap >= -2 &&
          item.questionActionGap <= 1);
      return {
        viewport: { width: window.innerWidth, height: window.innerHeight },
        documentWidth: root.scrollWidth,
        horizontalOverflow: root.scrollWidth > window.innerWidth + 1,
        interactiveOverflows,
        unnamedInteractive,
        undersizedControls,
        visibleCardsOutsideViewport,
        followupQuestionRows,
        questionActionsStacked,
        pageText: norm(document.querySelector("#page-pane")?.innerText || "").slice(0, 2000),
      };
    })()`);
    await side.screenshot(resolve(OUT_DIR, screenshotName));
    return {
      ...layout,
      screenshot: relative(ROOT, resolve(OUT_DIR, screenshotName)),
    };
  } finally {
    await side.clearViewport();
  }
}

async function installAdvisorTransitionTimeline(side) {
  await side.evaluate(`(() => {
    const startedAt = performance.now();
    const entries = [];
    let lastSignature = "";
    const norm = (value) => (value || "").replace(/\\s+/g, " ").trim();
    const capture = () => {
      const pane = document.querySelector("#page-pane");
      const runtimeState = globalThis.__trulyPageReadingRuntime?.auditState?.() || null;
      const entry = {
        elapsedMs: Math.round(performance.now() - startedAt),
        status: norm(pane?.querySelector(".page-reader-card-status")?.textContent || pane?.querySelector(".page-reader-status-label")?.textContent),
        text: norm(pane?.innerText).slice(0, 1200),
        extractionDiagnosticsPresent: Boolean(pane?.querySelector(".page-reader-extraction-diagnostics")),
        processingStatusPresent: Boolean(pane?.querySelector(".page-reader-processing-status")),
        modelContextPresent: Boolean(pane?.querySelector(".page-reader-model-context")),
        advisorPresent: Boolean(pane?.querySelector(".page-reader-advisor")),
        previewPresent: Boolean(pane?.querySelector(".page-reader-excerpt, .page-reader-preview")),
        supplementalDetailsPresent: Boolean(pane?.querySelector(".page-reader-supplemental-details")),
        analysisClass: pane?.querySelector(".page-reader-analysis")?.className || "",
        runtimeState,
      };
      const signature = JSON.stringify({ ...entry, elapsedMs: 0 });
      if (signature === lastSignature) return;
      lastSignature = signature;
      entries.push(entry);
    };
    const observer = new MutationObserver(capture);
    observer.observe(document.documentElement, { childList: true, subtree: true, attributes: true });
    const interval = setInterval(capture, 25);
    globalThis.__trulyPageAdvisorTimeline = {
      entries,
      stop() {
        capture();
        observer.disconnect();
        clearInterval(interval);
        return entries;
      },
    };
    capture();
  })()`);
}

async function stopAdvisorTransitionTimeline(side, artifactName) {
  const entries = await side.evaluateJson(`(() => globalThis.__trulyPageAdvisorTimeline?.stop?.() || [])()`);
  writeFileSync(resolve(OUT_DIR, artifactName), JSON.stringify(entries, null, 2));
  return entries;
}

async function auditNoisyFallbackRead(extensionId, allowedBase) {
  const noisyTarget = await createTarget(`${allowedBase}/noisy`);
  const sideTarget = await openSidePanelTestPage(extensionId, noisyTarget, "noisy");
  const noisy = connectCdp(noisyTarget.webSocketDebuggerUrl);
  const side = connectCdp(sideTarget.webSocketDebuggerUrl);

  try {
    await sleep(800);
    await installAdvisorTransitionTimeline(side);
    await side.evaluate(`document.querySelector('#pageReadCurrent')?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })); undefined`);
    await waitFor(side, WEB_SURFACE_READY_EXPRESSION, 8000, "Web noisy fallback ready state").catch(async (error) => {
      const timeoutState = await capturePageReadTimeoutState(side, noisy, null).catch((captureError) => ({
        captureError: captureError.message,
      }));
      await side.screenshot(resolve(OUT_DIR, "page-noisy-timeout.png")).catch(() => {});
      writeFileSync(resolve(OUT_DIR, "page-noisy-timeout.json"), JSON.stringify(timeoutState, null, 2));
      error.message = `${error.message}; diagnostics: ${relative(ROOT, resolve(OUT_DIR, "page-noisy-timeout.json"))}`;
      throw error;
    });
    await waitFor(side, `(() => {
      const analysis = document.querySelector('#page-pane .page-reader-analysis:not(.is-running)');
      if (analysis) return true;
      const processing = document.querySelector('#page-pane .page-reader-processing-status');
      const status = processing?.querySelector('.page-reader-processing-status-header span')?.textContent?.trim() || '';
      const decision = processing?.querySelector('dd[data-raw-value="accept_current"]');
      return Boolean(decision) && /頁面狀態|Page status/.test(processing?.textContent || '') && !/整理中|Organizing/.test(status);
    })()`, 26000, "Web parser advisor completion").catch(async (error) => {
      await side.screenshot(resolve(OUT_DIR, "page-noisy-advisor-timeout.png")).catch(() => {});
      throw error;
    });

    const advisorTimeline = await side.evaluateJson(`(() => globalThis.__trulyPageAdvisorTimeline?.stop?.() || [])()`);
    writeFileSync(resolve(OUT_DIR, "page-noisy-transition-timeline.json"), JSON.stringify(advisorTimeline, null, 2));

    const ready = await side.evaluateJson(`(() => {
      const pane = document.querySelector('#page-pane');
      const runtimeState = globalThis.__trulyPageReadingRuntime?.auditState?.().displayedSession || null;
      const processing = pane?.querySelector('.page-reader-processing-status');
      const processingRows = [...processing?.querySelectorAll('dl div') || []].map((row) => ({
        label: row.querySelector('dt')?.textContent?.trim(),
        value: row.querySelector('dd')?.textContent?.trim(),
        rawValue: row.querySelector('dd')?.getAttribute('data-raw-value') || row.querySelector('dd')?.textContent?.trim()
      }));
      const model = pane?.querySelector('.page-reader-model-context');
      const advisor = pane?.querySelector('.page-reader-advisor');
      const pageAnalysis = pane?.querySelector('.page-reader-analysis');
      return {
        runtimeState,
        status: pane?.querySelector('.page-reader-card-status')?.textContent?.trim() || pane?.querySelector('.page-reader-status-label')?.textContent?.trim(),
        meta: [...pane?.querySelectorAll('.page-reader-meta div') || []].map((el) => ({
          label: el.querySelector('dt')?.textContent?.trim(),
          value: el.querySelector('dd')?.textContent?.trim()
        })),
        extractionDiagnosticsOpen: pane?.querySelector('.page-reader-extraction-diagnostics')?.hasAttribute('open') ?? null,
        pipelineHidden: !processing && !model && !advisor,
        pageAnalysis: pageAnalysis ? {
          className: pageAnalysis.className,
          text: pageAnalysis.textContent?.trim() || '',
          ready: !pageAnalysis.classList.contains('is-running')
        } : null,
        processingStatus: processing ? {
          title: processing.querySelector('h3')?.textContent?.trim(),
          status: processing.querySelector('.page-reader-processing-status-header span')?.textContent?.trim(),
          detail: processing.querySelector('p')?.textContent?.trim(),
          className: processing.className,
          rows: processingRows,
          diagnosticsOpen: processing.querySelector('.page-reader-diagnostics')?.hasAttribute('open') ?? null
        } : null,
        modelContext: processing ? {
          status: processing.querySelector('.page-reader-processing-status-header span')?.textContent?.trim(),
          detail: processing.querySelector('p')?.textContent?.trim(),
          className: processing.className,
          rows: processingRows,
          diagnosticsOpen: processing.querySelector('.page-reader-diagnostics')?.hasAttribute('open') ?? null
        } : model ? {
          status: model.querySelector('.page-reader-model-context-header span')?.textContent?.trim(),
          detail: model.querySelector('p')?.textContent?.trim(),
          className: model.className,
          diagnosticsOpen: model.querySelector('.page-reader-diagnostics')?.hasAttribute('open') ?? null
        } : null,
        advisor: processing ? {
          title: processing.querySelector('h3')?.textContent?.trim(),
          status: processing.querySelector('.page-reader-processing-status-header span')?.textContent?.trim(),
          detail: processing.querySelector('p')?.textContent?.trim(),
          rows: processingRows,
          note: '',
          className: processing.className,
          diagnosticsOpen: processing.querySelector('.page-reader-diagnostics')?.hasAttribute('open') ?? null
        } : advisor ? {
          title: advisor.querySelector('h3')?.textContent?.trim(),
          status: advisor.querySelector('.page-reader-advisor-header span')?.textContent?.trim(),
          detail: advisor.querySelector('p')?.textContent?.trim(),
          rows: [...advisor.querySelectorAll('dl div')].map((row) => ({
            label: row.querySelector('dt')?.textContent?.trim(),
            value: row.querySelector('dd')?.textContent?.trim(),
            rawValue: row.querySelector('dd')?.getAttribute('data-raw-value') || row.querySelector('dd')?.textContent?.trim()
          })),
          note: advisor.querySelector('.page-reader-advisor-note')?.textContent?.trim(),
          className: advisor.className,
          diagnosticsOpen: advisor.querySelector('.page-reader-diagnostics')?.hasAttribute('open') ?? null
        } : null,
        sourceLinks: [...pane?.querySelectorAll('.page-reader-source-links a') || []].map((el) => ({
          label: el.textContent?.trim(),
          href: el.href
        })),
        hasEdgeDownload: /Edge 官網下載/.test(pane?.innerText || ''),
        hasFirefoxDownload: /FireFox 官網下載/.test(pane?.innerText || ''),
        hasGoogleDownload: /Google 官網下載/.test(pane?.innerText || '')
      };
    })()`);
    await side.screenshot(resolve(OUT_DIR, "page-noisy-fallback.png"));
    return { ready, advisorTimeline };
  } finally {
    await side.closeTarget().catch(() => {});
    await noisy.closeTarget().catch(() => {});
    side.close();
    noisy.close();
  }
}

async function auditCandidateBlockRecovery(extensionId, allowedBase) {
  const candidateTarget = await createTarget(`${allowedBase}/candidate`);
  const sideTarget = await openSidePanelTestPage(extensionId, candidateTarget, "candidate");
  const candidate = connectCdp(candidateTarget.webSocketDebuggerUrl);
  const side = connectCdp(sideTarget.webSocketDebuggerUrl);

  try {
    await sleep(800);
    await side.evaluate(`document.querySelector('#pageReadCurrent')?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })); undefined`);
    await waitFor(side, WEB_SURFACE_READY_EXPRESSION, 8000, "candidate block page ready");
    await waitFor(side, `(() => {
      const analysis = document.querySelector('#page-pane .page-reader-analysis:not(.is-running)');
      if (analysis) return true;
      const processing = document.querySelector('#page-pane .page-reader-processing-status') || document.querySelector('#page-pane .page-reader-advisor');
      const status = processing?.querySelector('.page-reader-processing-status-header span, .page-reader-advisor-header span')?.textContent?.trim() || '';
      const decision = processing?.querySelector('dd[data-raw-value="prefer_candidate_block"], dd[data-raw-value="accept_current"]');
      return Boolean(decision) && !/整理中|Organizing|檢查中|Checking/.test(status);
    })()`, 26000, "candidate fixture advisor decision").catch(async (error) => {
      await side.screenshot(resolve(OUT_DIR, "page-candidate-timeout.png")).catch(() => {});
      throw error;
    });

    const ready = await side.evaluateJson(`(() => {
      const pane = document.querySelector('#page-pane');
      const runtimeState = globalThis.__trulyPageReadingRuntime?.auditState?.().displayedSession || null;
      const processing = pane?.querySelector('.page-reader-processing-status');
      const processingRows = [...processing?.querySelectorAll('dl div') || []].map((row) => ({
        label: row.querySelector('dt')?.textContent?.trim(),
        value: row.querySelector('dd')?.textContent?.trim(),
        rawValue: row.querySelector('dd')?.getAttribute('data-raw-value') || row.querySelector('dd')?.textContent?.trim()
      }));
      const model = pane?.querySelector('.page-reader-model-context');
      const advisor = pane?.querySelector('.page-reader-advisor');
      const pageAnalysis = pane?.querySelector('.page-reader-analysis');
      return {
        runtimeState,
        status: pane?.querySelector('.page-reader-card-status')?.textContent?.trim() || pane?.querySelector('.page-reader-status-label')?.textContent?.trim(),
        excerpt: pane?.querySelector('.page-reader-excerpt')?.textContent?.trim(),
        extractionDiagnosticsOpen: pane?.querySelector('.page-reader-extraction-diagnostics')?.hasAttribute('open') ?? null,
        pipelineHidden: !processing && !model && !advisor,
        pageAnalysis: pageAnalysis ? {
          className: pageAnalysis.className,
          text: pageAnalysis.textContent?.trim() || '',
          ready: !pageAnalysis.classList.contains('is-running')
        } : null,
        processingStatus: processing ? {
          title: processing.querySelector('h3')?.textContent?.trim(),
          status: processing.querySelector('.page-reader-processing-status-header span')?.textContent?.trim(),
          detail: processing.querySelector('p')?.textContent?.trim(),
          className: processing.className,
          rows: processingRows,
          diagnosticsOpen: processing.querySelector('.page-reader-diagnostics')?.hasAttribute('open') ?? null
        } : null,
        modelContext: processing ? {
          status: processing.querySelector('.page-reader-processing-status-header span')?.textContent?.trim(),
          detail: processing.querySelector('p')?.textContent?.trim(),
          className: processing.className,
          rows: processingRows,
          diagnosticsOpen: processing.querySelector('.page-reader-diagnostics')?.hasAttribute('open') ?? null
        } : model ? {
          status: model.querySelector('.page-reader-model-context-header span')?.textContent?.trim(),
          detail: model.querySelector('p')?.textContent?.trim(),
          className: model.className,
          diagnosticsOpen: model.querySelector('.page-reader-diagnostics')?.hasAttribute('open') ?? null
        } : null,
        advisor: processing ? {
          title: processing.querySelector('h3')?.textContent?.trim(),
          status: processing.querySelector('.page-reader-processing-status-header span')?.textContent?.trim(),
          detail: processing.querySelector('p')?.textContent?.trim(),
          rows: processingRows,
          note: '',
          className: processing.className,
          diagnosticsOpen: processing.querySelector('.page-reader-diagnostics')?.hasAttribute('open') ?? null
        } : advisor ? {
          title: advisor.querySelector('h3')?.textContent?.trim(),
          status: advisor.querySelector('.page-reader-advisor-header span')?.textContent?.trim(),
          detail: advisor.querySelector('p')?.textContent?.trim(),
          rows: [...advisor.querySelectorAll('dl div')].map((row) => ({
            label: row.querySelector('dt')?.textContent?.trim(),
            value: row.querySelector('dd')?.textContent?.trim(),
            rawValue: row.querySelector('dd')?.getAttribute('data-raw-value') || row.querySelector('dd')?.textContent?.trim()
          })),
          note: advisor.querySelector('.page-reader-advisor-note')?.textContent?.trim(),
          className: advisor.className,
          diagnosticsOpen: advisor.querySelector('.page-reader-diagnostics')?.hasAttribute('open') ?? null
        } : null,
        sourceLinks: [...pane?.querySelectorAll('.page-reader-source-links a') || []].map((el) => ({
          label: el.textContent?.trim(),
          href: el.href
        })),
        hasFullCandidateContinuation: /Full candidate continuation should appear/.test(pane?.innerText || ''),
        hasCandidateSource: /Candidate source/.test(pane?.innerText || '')
      };
    })()`);
    await side.screenshot(resolve(OUT_DIR, "page-candidate-block.png"));
    return { ready };
  } finally {
    await side.closeTarget().catch(() => {});
    await candidate.closeTarget().catch(() => {});
    side.close();
    candidate.close();
  }
}

async function auditTeaserHubOverview(extensionId, allowedBase) {
  const teaserTarget = await createTarget(`${allowedBase}/teaser-hub`);
  // Attach the transition observer as soon as the audit page becomes
  // inspectable. Waiting for the usual visual settle period lets fast local
  // mocks finish the auto-read before the observer exists.
  const sideTarget = await openSidePanelTestPage(
    extensionId,
    teaserTarget,
    "teaser",
    undefined,
    { settleMs: 0 },
  );
  const teaser = connectCdp(teaserTarget.webSocketDebuggerUrl);
  const side = connectCdp(sideTarget.webSocketDebuggerUrl);

  try {
    await installAdvisorTransitionTimeline(side);
    await waitFor(side, `(() => {
      const button = document.querySelector('#pageReadCurrent');
      return Boolean(button && !button.disabled);
    })()`, 10000, "teaser hub read button ready");
    await side.evaluate(`(() => {
      const button = document.querySelector('#pageReadCurrent');
      if (!button || button.disabled) return false;
      return button.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    })()`);
    await waitFor(side, WEB_SURFACE_READY_EXPRESSION, 8000, "teaser hub page ready").catch(async (error) => {
      const timeoutState = await capturePageReadTimeoutState(side, teaser, null).catch((captureError) => ({
        captureError: captureError.message,
      }));
      await side.screenshot(resolve(OUT_DIR, "page-teaser-hub-timeout.png")).catch(() => {});
      writeFileSync(resolve(OUT_DIR, "page-teaser-hub-timeout.json"), JSON.stringify(timeoutState, null, 2));
      error.message = `${error.message}; diagnostics: ${relative(ROOT, resolve(OUT_DIR, "page-teaser-hub-timeout.json"))}`;
      throw error;
    });
    await waitFor(side, `(() => {
      const analysis = document.querySelector('#page-pane .page-reader-analysis:not(.is-running)');
      if (analysis) return true;
      const processing = document.querySelector('#page-pane .page-reader-processing-status') || document.querySelector('#page-pane .page-reader-advisor');
      const status = processing?.querySelector('.page-reader-processing-status-header span, .page-reader-advisor-header span')?.textContent?.trim() || '';
      const decision = processing?.querySelector('dd[data-raw-value="downgrade_to_index_or_feed"], dd[data-raw-value="request_user_selection"]');
      return Boolean(decision) && !/整理中|Organizing|檢查中|Checking/.test(status);
    })()`, 26000, "teaser hub safe advisor decision").catch(async (error) => {
      await side.screenshot(resolve(OUT_DIR, "page-teaser-hub-advisor-timeout.png")).catch(() => {});
      throw error;
    });

    const advisorTimeline = await stopAdvisorTransitionTimeline(side, "page-advisor-transition-timeline.json");

    const ready = await side.evaluateJson(`(() => {
      const pane = document.querySelector('#page-pane');
      const runtimeState = globalThis.__trulyPageReadingRuntime?.auditState?.().displayedSession || null;
      const processing = pane?.querySelector('.page-reader-processing-status');
      const processingRows = [...processing?.querySelectorAll('dl div') || []].map((row) => ({
        label: row.querySelector('dt')?.textContent?.trim(),
        value: row.querySelector('dd')?.textContent?.trim(),
        rawValue: row.querySelector('dd')?.getAttribute('data-raw-value') || row.querySelector('dd')?.textContent?.trim()
      }));
      const model = pane?.querySelector('.page-reader-model-context');
      const advisor = pane?.querySelector('.page-reader-advisor');
      const pageAnalysis = pane?.querySelector('.page-reader-analysis');
      return {
        runtimeState,
        status: pane?.querySelector('.page-reader-card-status')?.textContent?.trim() || pane?.querySelector('.page-reader-status-label')?.textContent?.trim(),
        excerpt: pane?.querySelector('.page-reader-excerpt')?.textContent?.trim(),
        extractionDiagnosticsOpen: pane?.querySelector('.page-reader-extraction-diagnostics')?.hasAttribute('open') ?? null,
        pipelineHidden: !processing && !model && !advisor,
        pageAnalysis: pageAnalysis ? {
          className: pageAnalysis.className,
          text: pageAnalysis.textContent?.trim() || '',
          ready: !pageAnalysis.classList.contains('is-running')
        } : null,
        processingStatus: processing ? {
          title: processing.querySelector('h3')?.textContent?.trim(),
          status: processing.querySelector('.page-reader-processing-status-header span')?.textContent?.trim(),
          detail: processing.querySelector('p')?.textContent?.trim(),
          className: processing.className,
          rows: processingRows,
          diagnosticsOpen: processing.querySelector('.page-reader-diagnostics')?.hasAttribute('open') ?? null
        } : null,
        modelContext: processing ? {
          status: processing.querySelector('.page-reader-processing-status-header span')?.textContent?.trim(),
          detail: processing.querySelector('p')?.textContent?.trim(),
          className: processing.className,
          rows: processingRows,
          diagnosticsOpen: processing.querySelector('.page-reader-diagnostics')?.hasAttribute('open') ?? null
        } : model ? {
          status: model.querySelector('.page-reader-model-context-header span')?.textContent?.trim(),
          detail: model.querySelector('p')?.textContent?.trim(),
          className: model.className,
          diagnosticsOpen: model.querySelector('.page-reader-diagnostics')?.hasAttribute('open') ?? null
        } : null,
        advisor: processing ? {
          title: processing.querySelector('h3')?.textContent?.trim(),
          status: processing.querySelector('.page-reader-processing-status-header span')?.textContent?.trim(),
          detail: processing.querySelector('p')?.textContent?.trim(),
          rows: processingRows,
          note: '',
          className: processing.className,
          diagnosticsOpen: processing.querySelector('.page-reader-diagnostics')?.hasAttribute('open') ?? null
        } : advisor ? {
          title: advisor.querySelector('h3')?.textContent?.trim(),
          status: advisor.querySelector('.page-reader-advisor-header span')?.textContent?.trim(),
          detail: advisor.querySelector('p')?.textContent?.trim(),
          rows: [...advisor.querySelectorAll('dl div')].map((row) => ({
            label: row.querySelector('dt')?.textContent?.trim(),
            value: row.querySelector('dd')?.textContent?.trim(),
            rawValue: row.querySelector('dd')?.getAttribute('data-raw-value') || row.querySelector('dd')?.textContent?.trim()
          })),
          note: advisor.querySelector('.page-reader-advisor-note')?.textContent?.trim(),
          className: advisor.className,
          diagnosticsOpen: advisor.querySelector('.page-reader-diagnostics')?.hasAttribute('open') ?? null
        } : null,
        sourceLinks: [...pane?.querySelectorAll('.page-reader-source-links a') || []].map((el) => ({
          label: el.textContent?.trim(),
          href: el.href
        })),
        hasMemberArea: /Member Area/.test(pane?.innerText || ''),
        hasNewsletter: /Newsletter/.test(pane?.innerText || '')
      };
    })()`);
    await side.screenshot(resolve(OUT_DIR, "page-teaser-hub-overview.png"));
    return { ready, advisorTimeline };
  } finally {
    await side.closeTarget().catch(() => {});
    await teaser.closeTarget().catch(() => {});
    side.close();
    teaser.close();
  }
}

async function capturePageReadTimeoutState(side, article, initial) {
  const sideState = await side.evaluateJson(`(() => ({
    url: location.href,
    activeTab: document.querySelector('.tab[aria-selected="true"]')?.textContent?.trim(),
    readButtonText: document.querySelector('#pageReadCurrent')?.textContent?.trim(),
    readDisabled: document.querySelector('#pageReadCurrent')?.disabled ?? null,
    status: document.querySelector('#page-pane .page-reader-status-label')?.textContent?.trim(),
    detail: document.querySelector('#page-pane .page-reader-status-detail')?.textContent?.trim(),
    paneText: document.querySelector('#page-pane')?.innerText,
    error: document.querySelector('#page-pane .page-reader-error')?.textContent?.trim()
  }))()`);
  const articleState = await article.evaluateJson(`(() => ({
    url: location.href,
    title: document.title,
    bodyTextLength: document.body?.innerText?.length ?? 0,
    readyState: document.readyState
  }))()`);
  const extensionState = await side.evaluateJson(`(() => new Promise((resolve) => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const tab = tabs?.[0];
      resolve({
        activeTab: tab ? {
          id: tab.id,
          url: tab.url,
          title: tab.title,
          active: tab.active,
          windowId: tab.windowId
        } : null,
        lastError: chrome.runtime.lastError?.message || null
      });
    });
  }))()`);
  return { initial, sideState, articleState, extensionState };
}

async function auditNoGrantGuidance(extensionId, noGrantBase) {
  const articleTarget = await createTarget(`${noGrantBase}/article`);
  const sideTarget = await openSidePanelTestPage(extensionId, articleTarget, "no-grant");
  const side = connectCdp(sideTarget.webSocketDebuggerUrl);
  const article = connectCdp(articleTarget.webSocketDebuggerUrl);
  try {
    await sleep(800);
    await side.evaluate(`(() => {
      const norm = (s) => String(s || "").replace(/\\s+/g, " ").trim();
      const tab = document.querySelector('[role="tab"][data-tab="page"]') ||
        Array.from(document.querySelectorAll("button,[role='tab']")).find((el) => /\\bWeb\\b|Page\\/Web/.test(norm(el.textContent || el.getAttribute("aria-label") || "")));
      tab?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, view: window }));
    })()`);
    await sleep(400);
    await side.screenshot(resolve(OUT_DIR, "page-no-grant.png"));
    return await side.evaluateJson(`(() => ({
      status: document.querySelector('#page-pane .page-reader-card-status')?.textContent?.trim() || document.querySelector('#page-pane .page-reader-status-label')?.textContent?.trim(),
      detail: document.querySelector('#page-pane .page-reader-status-detail')?.textContent?.trim(),
      error: document.querySelector('#page-pane .page-reader-error')?.textContent?.trim(),
      errorBlockPresent: Boolean(document.querySelector('#page-pane .page-reader-error')),
      emptyBlockPresent: Boolean(document.querySelector('#page-pane .page-reader-empty')),
      authorizeButtonText: document.querySelector('#pageAuthorizeDomain')?.textContent?.trim() || '',
      authorizeButtonTitle: document.querySelector('#pageAuthorizeDomain')?.getAttribute('title') || '',
      hasAuthorizeDomain: Boolean(document.querySelector('#pageAuthorizeDomain')),
      detailHasGuidance: /工具列圖示|toolbar icon/.test(document.querySelector('#page-pane .page-reader-status-detail')?.textContent || ''),
      detailHasGenericRetry: /請重新讀取|Try again after the page finishes loading/.test(document.querySelector('#page-pane .page-reader-status-detail')?.textContent || ''),
      hasGuidance: /工具列圖示|toolbar icon/.test(document.querySelector('#page-pane')?.innerText || ''),
      hasAllSitesGuidance: /所有網站存取權|all-sites access/.test(document.querySelector('#page-pane')?.innerText || '')
    }))()`);
  } finally {
    await side.closeTarget().catch(() => {});
    await article.closeTarget().catch(() => {});
    side.close();
    article.close();
  }
}

async function inspectUnsupportedPageSidePanel(extensionId, activeUrl, suffix, screenshotName) {
  const created = await createInactiveAuditTab(extensionId, activeUrl, `active-${suffix}`);
  const activeTarget = created.target;
  const sideTarget = await openSidePanelTestPage(extensionId, activeTarget, suffix, created.tab.id);
  const side = connectCdp(sideTarget.webSocketDebuggerUrl);
  const active = connectCdp(activeTarget.webSocketDebuggerUrl);
  try {
    await sleep(900);
    await side.evaluate(`(() => {
      const norm = (s) => String(s || "").replace(/\\s+/g, " ").trim();
      const tab = document.querySelector('[role="tab"][data-tab="page"]') ||
        Array.from(document.querySelectorAll("button,[role='tab']")).find((el) => /Page\\/Web|\\bWeb\\b/.test(norm(el.textContent || el.getAttribute("aria-label") || "")));
      tab?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, view: window }));
    })()`);
    await sleep(400);
    const state = await side.evaluateJson(`(() => ({
      activeTab: document.querySelector('.tab[aria-selected="true"], [role="tab"][aria-selected="true"]')?.textContent?.trim() || "",
      status: document.querySelector('#page-pane .page-reader-card-status')?.textContent?.trim() || document.querySelector('#page-pane .page-reader-status-label')?.textContent?.trim() || "",
      detail: document.querySelector('#page-pane .page-reader-status-detail')?.textContent?.trim() || "",
      empty: document.querySelector('#page-pane .page-reader-empty')?.textContent?.trim() || "",
      error: document.querySelector('#page-pane .page-reader-error')?.textContent?.trim() || "",
      readDisabled: document.querySelector('#pageReadCurrent')?.disabled ?? null,
      selectionDisabled: document.querySelector('#pageReadSelection')?.disabled ?? null,
      text: document.querySelector('#page-pane')?.innerText?.replace(/\\s+/g, " ").trim() || ""
    }))()`);
    await side.screenshot(resolve(OUT_DIR, screenshotName));
    const activeState = await active.evaluateJson(`(() => ({
      href: location.href,
      title: document.title,
      readyState: document.readyState
    }))()`).catch((error) => ({ error: error instanceof Error ? error.message : String(error) }));
    return { activeUrl, activeState, side: state, screenshot: `tmp/${relative(resolve(ROOT, "tmp"), resolve(OUT_DIR, screenshotName))}` };
  } finally {
    await side.closeTarget().catch(() => {});
    await active.closeTarget().catch(() => {});
    side.close();
    active.close();
  }
}

async function auditUnsupportedPageGuidance(extensionId) {
  const truly = await inspectUnsupportedPageSidePanel(
    extensionId,
    `chrome-extension://${extensionId}/options/options.html?unsupportedPageAudit=${STAMP}`,
    "unsupported-truly",
    "page-unsupported-truly.png",
  );
  const browser = await inspectUnsupportedPageSidePanel(
    extensionId,
    "chrome://settings/",
    "unsupported-browser",
    "page-unsupported-browser.png",
  );
  return { truly, browser };
}

async function waitFor(cdp, expression, timeoutMs, label) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (await cdp.evaluate(expression).catch(() => false)) return;
    await sleep(150);
  }
  throw new Error(`Timed out waiting for ${label}`);
}

function isPopupReadSkipped(result) {
  return result.popupRead?.skipped === true;
}

function assertAudit(result) {
  const errors = [];
  const expectBuild = result.expectedBuildId;
  if (result.version?.buildId !== expectBuild) {
    errors.push(`live buildId mismatch: ${result.version?.buildId || "(missing)"} != ${expectBuild}`);
  }
  if (result.popup.general.button !== "讀取此頁" || result.popup.general.disabled !== false) {
    errors.push("popup general-page state is not enabled with 讀取此頁");
  }
  if (!/\bok\b/.test(result.popup.general.dotClass || "") || /\bchecking\b/.test(result.popup.general.dotClass || "")) {
    errors.push(`popup general-page state should be stable, not checking: ${result.popup.general.dotClass || "(missing)"}`);
  }
  if (result.popup.unsupported.disabled !== true) {
    errors.push("popup unsupported state is not disabled");
  }
  if (!isPopupReadSkipped(result)) {
    if (result.popupRead.before.activeTab?.url !== result.syntheticUrls.popupRead) {
      errors.push(`popup read path did not initialize with the synthetic article active tab: ${result.popupRead.before.activeTab?.url || "(missing)"}`);
    }
    if (result.popupRead.before.button !== "讀取此頁" || result.popupRead.before.disabled !== false) {
      errors.push(`popup read path button was not ready: ${result.popupRead.before.button || "(missing)"} / disabled=${result.popupRead.before.disabled}`);
    }
    if (!isWebReadyStatus(result.popupRead.sideState.status)) {
      errors.push(`popup read path did not make Web ready: ${result.popupRead.sideState.status || "(missing)"}`);
    }
    if (result.popupRead.sideState.title !== "Synthetic General Page Reader Article") {
      errors.push(`popup read path showed unexpected Web title: ${result.popupRead.sideState.title || "(missing)"}`);
    }
  }
  if (!isReadyObservation(result.success.ready)) {
    errors.push(`successful read did not reach ready state: visible=${result.success.ready.status || "missing"}; runtime=${result.success.ready.runtimeState?.status || "missing"}`);
  }
  if (/秒|\bs\b/.test(result.success.ready.status || "")) {
    errors.push(`successful read status label should stay quiet without inline elapsed time: ${result.success.ready.status}`);
  }
  if (!/讀取耗時|Read took/.test(result.success.ready.statusTitle || "")) {
    errors.push(`successful read status title does not expose elapsed time: ${result.success.ready.statusTitle || "(missing)"}`);
  }
  if (/讀取耗時 0 秒|Read took 0s/.test(result.success.ready.statusTitle || "")) {
    errors.push(`successful read status title should not round very fast reads to zero: ${result.success.ready.statusTitle}`);
  }
  if (result.success.autoRead?.allSites && !result.success.autoRead?.observed) {
    errors.push(`all-sites sidepanel auto-read did not reach ready status: ${result.success.autoRead.error || "(no details)"}`);
  }
  const autoReadTransition = autoReadTransitionState(result);
  if (result.success.autoRead?.allSites && !autoReadTransition.pass) {
    errors.push(`all-sites auto-read exposed intermediate UI before loading: firstLoadingMs=${autoReadTransition.firstLoadingMs ?? "missing"}; technicalStates=${autoReadTransition.technicalStateCount}; duplicateLoadingStatuses=${autoReadTransition.duplicateLoadingStatusCount}`);
  }
  if (result.success.ready.title !== "Synthetic General Page Reader Article") {
    errors.push(`unexpected extracted title: ${result.success.ready.title}`);
  }
  if (result.success.ready.fullTailVisible) {
    errors.push("Web pane includes the full synthetic body tail");
  }
  const cleanBriefHidesPipeline = result.success.pageBrief?.status === "ready" &&
    result.success.pageBrief?.pipelineHidden === true &&
    result.success.pageBrief?.diagnosticsHidden === true;
  if (!cleanBriefHidesPipeline) {
    if (!/頁面狀態|Page status/.test(result.success.ready.processingStatus?.title || result.success.ready.modelContext?.title || "")) {
      errors.push("Web pane does not show the consolidated page status");
    }
    if (!/is-ready/.test(result.success.ready.modelContext?.className || "")) {
      errors.push(`unexpected page status class: ${result.success.ready.modelContext?.className || "(missing)"}`);
    }
    if (!/可用|Usable|整理中|Organizing|已整理|Organized/.test(result.success.ready.modelContext?.status || "")) {
      errors.push(`unexpected page status value: ${result.success.ready.modelContext?.status || "(missing)"}`);
    }
    if (!hasPassingTextThresholdRow(result.success.ready.modelContext?.rows)) {
      errors.push("model context text threshold row is missing or incorrect");
    }
    if (!result.success.ready.advisor?.rows?.some((row) => /判斷|Decision/.test(row.label || "") && rawRowValue(row) === "accept_current")) {
      errors.push("successful read advisor does not preserve accept_current effective context");
    }
  }
  if (!hasSourceHref(result.success.ready.sourceLinks, /\/source$/)) {
    errors.push("Web pane does not expose extracted source links for early inspection");
  }
  if (cleanBriefHidesPipeline
    ? result.success.ready.extractionDiagnosticsOpen === true
    : result.success.ready.extractionDiagnosticsOpen !== false) {
    errors.push("successful read should keep extraction diagnostics collapsed by default");
  }
  if (!cleanBriefHidesPipeline) {
    if (result.success.ready.modelContext?.diagnosticsOpen !== false) {
      errors.push("successful read should keep page-status details collapsed by default");
    }
    if (result.success.ready.advisor?.diagnosticsOpen !== false) {
      errors.push("successful read should keep advisor details collapsed by default");
    }
  }
  if (result.success.pageBrief?.status === "ready" &&
    !result.success.pageBrief?.pipelineHidden &&
    !/已整理|Organized|已產生重點|Brief created/.test(result.success.pageBrief?.modelContextStatus || "")) {
    errors.push(`page brief completed but model context still shows wrong status: ${result.success.pageBrief?.modelContextStatus || "(missing)"}`);
  }
  if (result.success.pageBrief?.status === "ready" &&
    result.success.pageBrief?.pipelineHidden &&
    !result.success.pageBrief?.diagnosticsHidden) {
    errors.push("page brief clean UI should hide reading diagnostics");
  }
  if ((result.success.ready.sourceLinks?.length ?? 0) > 6) {
    errors.push("successful read exposes more than six source links");
  }
  for (const [width, responsive] of [[360, result.success.responsive360], [430, result.success.responsive]]) {
    if (responsive?.horizontalOverflow) {
      errors.push(`Web ${width}px layout has horizontal overflow: documentWidth=${responsive.documentWidth}`);
    }
    if ((responsive?.interactiveOverflows?.length ?? 0) > 0) {
      errors.push(`Web ${width}px layout clips interactive elements: ${responsive.interactiveOverflows.map((item) => item.text || item.id || item.className || item.tag).join(", ")}`);
    }
    if ((responsive?.visibleCardsOutsideViewport?.length ?? 0) > 0) {
      errors.push(`Web ${width}px layout renders cards outside viewport: ${responsive.visibleCardsOutsideViewport.map((item) => item.className || item.tag).join(", ")}`);
    }
    if ((responsive?.unnamedInteractive?.length ?? 0) > 0) {
      errors.push(`Web ${width}px interactive elements are missing accessible names: ${responsive.unnamedInteractive.map((item) => item.id || item.className || item.tag).join(", ")}`);
    }
    if ((responsive?.undersizedControls?.length ?? 0) > 0) {
      errors.push(`Web primary controls are too small at ${width}px: ${responsive.undersizedControls.map((item) => item.text || item.accessibleName || item.id || item.className || item.tag).join(", ")}`);
    }
    if (responsive?.questionActionsStacked !== true) {
      errors.push(`Web ${width}px follow-up actions are not consistently stacked below their questions`);
    }
  }
  if (
    !result.success.copy.hasTitle ||
    !result.success.copy.hasUrl ||
    !result.success.copy.hasBrief ||
    !result.success.copy.hasModelNotice ||
    result.success.copy.hasExcerpt ||
    result.success.copy.hasRawDiagnostics ||
    result.success.copy.hasSourceList ||
    result.success.copy.hasFullTail
  ) {
    errors.push("compact copy projection boundary failed");
  }
  if (
    result.success.history?.second?.sessionCount !== 0 ||
    result.success.history?.third?.sessionCount !== 0 ||
    result.success.history?.display?.sessionCount !== 0 ||
    result.success.history?.second?.switcherVisible !== false ||
    result.success.history?.third?.switcherVisible !== false ||
    result.success.history?.display?.switcherVisible !== false
  ) {
    errors.push("Web history UI should remain hidden after multiple page sessions");
  }
  if (result.success.history?.display?.selectionDisabled !== false) {
    errors.push("Web Focus selection action was not available after hiding history UI");
  }
  if (result.success.history?.display?.readCurrentVisible !== false || result.success.history?.display?.hasActivateButton !== false) {
    errors.push("Web hidden-history Focus view should expose selection-only controls");
  }
  if (!result.success.selection?.selectedText || !result.success.selection.excerpt?.includes(result.success.selection.selectedText.slice(0, 60))) {
    errors.push("selection target text was not rendered as the Focus preview");
  }
  if (
    result.success.selection?.focusPanelCount !== 1 ||
    result.success.selection?.hasPageCard !== false ||
    result.success.selection?.hasLastRead !== false ||
    result.success.selection?.hasExternalToolsLabel !== false ||
    result.success.selection?.focusToolCount !== 2
  ) {
    errors.push("Focus target did not preserve the single-card target-centric information architecture");
  }
  if (result.success.selection?.beforeAction?.selectionDisabled !== false) {
    errors.push(`selection target button was not available before explicit action: ${result.success.selection?.beforeAction?.selectionDisabled}`);
  }
  if (result.success.selection?.beforeAction?.targetKind !== "page") {
    errors.push(`selection changed model target before explicit action: ${result.success.selection?.beforeAction?.targetKind || "(missing)"}`);
  }
  const selectionTargetKind = result.success.selection?.activeState?.displayedSession?.targetKind ||
    result.success.selection?.modelRows?.find((row) => /目標|Target/.test(row.label || ""))?.rawValue;
  if (selectionTargetKind !== "selection") {
    errors.push("selection target did not switch model context targetKind to selection");
  }
  const activeSelectionAdvisorDecision = result.success.selection?.activeState?.displayedSession?.advisorDecision;
  const selectionAdvisorDecision = activeSelectionAdvisorDecision && activeSelectionAdvisorDecision !== "none"
    ? activeSelectionAdvisorDecision
    : result.success.selection?.advisorRows?.find((row) => /判斷|Decision/.test(row.label || ""))?.rawValue;
  const selectionNeedsNoAdvisor = result.success.selection?.activeState?.displayedSession?.advisorStatus === "not_needed" &&
    result.success.selection?.activeState?.displayedSession?.allowedUse === "article_or_selection_analysis";
  if (selectionAdvisorDecision !== "accept_current" && !selectionNeedsNoAdvisor) {
    errors.push("selection target did not preserve accept_current reading context");
  }
  errors.push(...assertMeaningfulNavigationScenario(result.success.navigation, {
    autoRead: Boolean(result.success.autoRead?.allSites),
  }));
  if (!isReadyObservation(result.noisy.ready)) {
    errors.push(`noisy fallback read did not reach ready state: ${result.noisy.ready.runtimeState?.status || "missing"}`);
  }
  if (!result.noisy.ready.meta?.some((row) => /讀取方式|Reading method/.test(row.label || "") && row.value === "fallback")) {
    errors.push("noisy fallback audit did not exercise fallback extraction");
  }
  if (!result.noisy.ready.meta?.some((row) => /內容狀態|Content state/.test(row.label || "") && row.value === "complete")) {
    errors.push("noisy fallback audit did not exercise complete fallback extraction");
  }
  if (!hasSourceHref(result.noisy.ready.sourceLinks, /\/source$/)) {
    errors.push("noisy fallback audit did not preserve the real article source link");
  }
  const noisyBriefReady = result.noisy.ready.pipelineHidden === true && result.noisy.ready.pageAnalysis?.ready === true;
  const noisyAdvisorRows = result.noisy.ready.advisor?.rows || [];
  const noisyDecision = rawRowValue(noisyAdvisorRows.find((row) => /判斷|Decision/.test(row.label || "")));
  const noisyUse = rawRowValue(noisyAdvisorRows.find((row) => /用途|Use/.test(row.label || "")));
  const noisyFallbackCleanContext =
    /page-reader-processing-status/.test(result.noisy.ready.modelContext?.className || "") &&
    noisyDecision === "accept_current" &&
    noisyUse === "article_or_selection_analysis" &&
    result.noisy.ready.modelContext?.diagnosticsOpen === false &&
    result.noisy.ready.advisor?.diagnosticsOpen === false;
  if (!noisyBriefReady && !noisyFallbackCleanContext) {
    errors.push("noisy fallback model context does not show accepted clean context");
  }
  if (!noisyBriefReady && !/page-reader-processing-status/.test(result.noisy.ready.modelContext?.className || "")) {
    errors.push("noisy fallback should render the consolidated page status");
  }
  if (!noisyBriefReady && result.noisy.ready.modelContext?.diagnosticsOpen !== false) {
    errors.push("noisy fallback page-status details should remain collapsed");
  }
  if (!noisyBriefReady && result.noisy.ready.advisor?.diagnosticsOpen !== false) {
    errors.push("noisy fallback advisor details should remain collapsed");
  }
  if ((result.noisy.ready.sourceLinks?.length ?? 0) > 6) {
    errors.push("noisy fallback exposes more than six source links");
  }
  if (result.noisy.ready.hasEdgeDownload || result.noisy.ready.hasFirefoxDownload || result.noisy.ready.hasGoogleDownload) {
    errors.push("noisy fallback audit still exposes browser download links as source context");
  }
  if (!noisyBriefReady && !/頁面狀態|Page status/.test(result.noisy.ready.advisor?.title || "")) {
    errors.push("noisy fallback does not show consolidated page status");
  }
  if (!noisyBriefReady && /整理中|Organizing|檢查中|Checking/.test(result.noisy.ready.advisor?.status || "")) {
    errors.push("noisy fallback advisor remained pending");
  }
  if (!noisyBriefReady && noisyDecision !== "accept_current") {
    errors.push(`noisy fallback advisor did not accept the cleaned fallback context: ${noisyDecision || "(missing)"}`);
  }
  if (!noisyBriefReady && noisyUse !== "article_or_selection_analysis") {
    errors.push(`noisy fallback effective context was not article analysis: ${noisyUse || "(missing)"}`);
  }
  if (!isReadyObservation(result.candidate.ready)) {
    errors.push(`candidate block recovery did not reach ready state: ${result.candidate.ready.runtimeState?.status || "missing"}`);
  }
  const candidateBriefReady = result.candidate.ready.pipelineHidden === true && result.candidate.ready.pageAnalysis?.ready === true;
  const candidateAdvisorRows = result.candidate.ready.advisor?.rows || [];
  const candidateDecision = rawRowValue(candidateAdvisorRows.find((row) => /判斷|Decision/.test(row.label || "")));
  const candidateUse = rawRowValue(candidateAdvisorRows.find((row) => /用途|Use/.test(row.label || "")));
  if (!candidateBriefReady && !["prefer_candidate_block", "accept_current"].includes(candidateDecision)) {
    errors.push(`candidate fixture did not reach a usable article decision: ${candidateDecision || "(missing)"}`);
  }
  if (!candidateBriefReady && candidateUse !== "article_or_selection_analysis") {
    errors.push(`candidate block effective context was not article analysis: ${candidateUse || "(missing)"}`);
  }
  if (!candidateBriefReady && candidateDecision === "prefer_candidate_block" && !result.candidate.ready.hasFullCandidateContinuation) {
    errors.push("candidate block recovery did not render the re-extracted full candidate text");
  }
  if (!hasSourceHref(result.candidate.ready.sourceLinks, /\/candidate-source$/)) {
    errors.push("candidate block recovery did not preserve candidate source link visibility");
  }
  if (candidateDecision === "prefer_candidate_block") {
    if (result.candidate.ready.extractionDiagnosticsOpen !== false) {
      errors.push("candidate block recovery should keep extraction diagnostics collapsed by default");
    }
    if (result.candidate.ready.modelContext?.diagnosticsOpen !== false) {
      errors.push("candidate block recovery should keep page-status details collapsed by default");
    }
    if (!/page-reader-processing-status/.test(result.candidate.ready.modelContext?.className || "")) {
      errors.push("candidate block recovery should render consolidated page status by default");
    }
    if (result.candidate.ready.advisor?.diagnosticsOpen !== false) {
      errors.push("candidate block recovery should keep advisor details collapsed by default");
    }
  } else {
    if (!candidateBriefReady && result.candidate.ready.modelContext?.diagnosticsOpen !== false) {
      errors.push("candidate clean extraction should keep page-status details collapsed");
    }
    if (!candidateBriefReady && !/page-reader-processing-status/.test(result.candidate.ready.modelContext?.className || "")) {
      errors.push("candidate clean extraction should render consolidated page status");
    }
    if (!candidateBriefReady && result.candidate.ready.advisor?.diagnosticsOpen !== false) {
      errors.push("candidate clean extraction should keep advisor details collapsed");
    }
  }
  if ((result.candidate.ready.sourceLinks?.length ?? 0) > 6) {
    errors.push("candidate block recovery exposes more than six source links");
  }
  if (!isReadyObservation(result.teaser.ready)) {
    errors.push(`teaser hub did not reach ready state: ${result.teaser.ready.runtimeState?.status || "missing"}`);
  }
  const teaserBriefReady = result.teaser.ready.pipelineHidden === true && result.teaser.ready.pageAnalysis?.ready === true;
  const teaserAdvisorRows = result.teaser.ready.advisor?.rows || [];
  const teaserDecision = result.teaser.ready.runtimeState?.advisorDecision !== "none"
    ? result.teaser.ready.runtimeState?.advisorDecision
    : rawRowValue(teaserAdvisorRows.find((row) => /判斷|Decision/.test(row.label || "")));
  const teaserUse = result.teaser.ready.runtimeState?.allowedUse ||
    rawRowValue(teaserAdvisorRows.find((row) => /用途|Use/.test(row.label || "")));
  const teaserSafeScope =
    (teaserDecision === "downgrade_to_index_or_feed" && teaserUse === "page_overview_only") ||
    (teaserDecision === "request_user_selection" && teaserUse === "requires_user_target");
  if (!teaserBriefReady && !teaserSafeScope) {
    errors.push(`teaser hub advisor did not choose a safe non-article scope: decision=${teaserDecision || "(missing)"} use=${teaserUse || "(missing)"}`);
  }
  if (result.teaser.ready.extractionDiagnosticsOpen === true) {
    errors.push("teaser hub should keep extraction diagnostics collapsed by default");
  }
  if (!teaserBriefReady && result.teaser.ready.modelContext?.diagnosticsOpen !== false) {
    errors.push("teaser hub should keep page-status details collapsed by default");
  }
  if (!teaserBriefReady && result.teaser.ready.advisor?.diagnosticsOpen !== false) {
    errors.push("teaser hub should keep advisor details collapsed by default");
  }
  if ((result.teaser.ready.sourceLinks?.length ?? 0) > 6) {
    errors.push("teaser hub exposes more than six source links");
  }
  if (result.teaser.ready.hasMemberArea || result.teaser.ready.hasNewsletter) {
    errors.push("teaser hub still exposes header/sidebar utility links as source context");
  }
  if (result.screenshot?.offer?.state !== "offer" || result.screenshot?.offer?.hasCaptureButton !== true) {
    errors.push("screenshot recovery did not show an explicit capture offer");
  }
  if (result.screenshot?.offer?.pipelineHidden !== true) {
    errors.push("screenshot recovery offer should hide model/advisor pipeline rows");
  }
  if (result.screenshot?.offer?.warningsHidden !== true) {
    errors.push("screenshot recovery offer should hide technical extraction warnings");
  }
  if (result.screenshot?.preview?.state !== "preview" || !/^data:image\//.test(result.screenshot?.preview?.imgSrcPrefix || "")) {
    errors.push("screenshot recovery did not show a user preview with a supported image data URL");
  }
  if ((result.screenshot?.preview?.previewRect?.height ?? 0) < 100) {
    errors.push("screenshot recovery preview was not visually inspectable");
  }
  if (!result.screenshot?.captureStub?.stubbed || result.screenshot?.captureClickState?.captureCalls?.length !== 1) {
    errors.push("screenshot recovery audit did not exercise the captureVisibleTab seam exactly once");
  }
  if (result.screenshot?.preview?.hasConfirmButton !== true || result.screenshot?.preview?.hasCancelButton !== true) {
    errors.push("screenshot recovery preview did not show confirm/cancel controls");
  }
  if (result.screenshot?.confirmed?.hasPreview !== false || result.screenshot?.confirmed?.domHasDataImage !== false) {
    errors.push("screenshot recovery kept screenshot preview/data URL in the DOM after confirmation");
  }
  if (!result.screenshot?.requests?.some((request) => request.kind === "parser-advisor" && request.currentExtractionMentionsFixture)) {
    errors.push("screenshot recovery did not route through the parser advisor mock endpoint");
  }
  if (!result.screenshot?.requests?.some((request) => request.kind === "screenshot-brief" && request.hasImageUrl && request.containsDataImage)) {
    errors.push("screenshot recovery did not send a confirmed screenshot image_url to the model endpoint");
  }
  if (result.screenshot?.storageAfter?.ok !== true) {
    const hits = (result.screenshot?.storageAfter?.hits || []).map((hit) => `${hit.area}:${hit.path}:${hit.kind}`).join(", ");
    errors.push(`screenshot recovery left sensitive data in chrome.storage: ${hits || "(missing details)"}`);
  }
  const noGrantShowsDomainAuthorization = result.noGrant.hasAuthorizeDomain === true &&
    /授權網域|Authorize domain/.test(result.noGrant.authorizeButtonText || "") &&
    /允許 Truly 讀取此網域|Allow Truly to read pages on this domain/.test(result.noGrant.authorizeButtonTitle || "");
  const noGrantShowsUrlUnavailableGuidance = result.noGrant.hasAuthorizeDomain === false &&
    result.noGrant.hasGuidance === true &&
    result.noGrant.hasAllSitesGuidance === true &&
    result.noGrant.detailHasGuidance === true;
  if (!noGrantShowsDomainAuthorization && !noGrantShowsUrlUnavailableGuidance) {
    errors.push(`no-grant sidepanel path did not show a valid authorization/guidance state: authorize=${result.noGrant.authorizeButtonText || "(missing)"} toolbarGuidance=${result.noGrant.hasGuidance} allSites=${result.noGrant.hasAllSitesGuidance}`);
  }
  if (result.noGrant.detailHasGenericRetry) errors.push("no-grant primary status detail still shows generic retry guidance");
  if (result.noGrant.errorBlockPresent) errors.push("no-grant toolbar guidance is duplicated in a separate error block");
  if (noGrantShowsDomainAuthorization && !result.noGrant.emptyBlockPresent) {
    errors.push("no-grant empty target should explain that the page has not been read yet when a domain grant action is available");
  }
  if (noGrantShowsUrlUnavailableGuidance && result.noGrant.emptyBlockPresent) {
    errors.push("no-grant URL-unavailable guidance should not duplicate the empty target block");
  }
  if (result.unsupportedPages?.truly?.side?.readDisabled !== null) {
    errors.push("Truly internal page should not render a Web read button");
  }
  if (!/不支援此頁|Unsupported page/.test(result.unsupportedPages?.truly?.side?.status || "")) {
    errors.push(`Truly internal page did not render unsupported status: ${result.unsupportedPages?.truly?.side?.status || "(missing)"}`);
  }
  if (!/Truly.*設定|Truly settings|內部頁面|internal page/.test(result.unsupportedPages?.truly?.side?.detail || "")) {
    errors.push(`Truly internal page did not explain the unsupported reason: ${result.unsupportedPages?.truly?.side?.detail || "(missing)"}`);
  }
  if (/工具列圖示|toolbar icon/.test(result.unsupportedPages?.truly?.side?.text || "")) {
    errors.push("Truly internal page incorrectly shows toolbar activation guidance");
  }
  if (result.unsupportedPages?.truly?.side?.empty) {
    errors.push("Truly internal page should not render a duplicate empty-state block");
  }
  if (result.unsupportedPages?.browser?.side?.readDisabled !== null) {
    errors.push("browser internal page should not render a Web read button");
  }
  if (!/不支援此頁|Unsupported page/.test(result.unsupportedPages?.browser?.side?.status || "")) {
    errors.push(`browser internal page did not render unsupported status: ${result.unsupportedPages?.browser?.side?.status || "(missing)"}`);
  }
  const browserUnsupportedDetail = result.unsupportedPages?.browser?.side?.detail || "";
  const browserShowsUrlUnavailable = /Chrome 沒有提供目前分頁網址|Chrome did not provide the current tab URL/.test(browserUnsupportedDetail);
  if (!/瀏覽器內部頁面|Browser internal pages|Chrome 沒有提供目前分頁網址|Chrome did not provide the current tab URL/.test(browserUnsupportedDetail)) {
    errors.push(`browser internal page did not explain the unsupported reason: ${result.unsupportedPages?.browser?.side?.detail || "(missing)"}`);
  }
  if (!browserShowsUrlUnavailable && /工具列圖示|toolbar icon/.test(result.unsupportedPages?.browser?.side?.text || "")) {
    errors.push("browser internal page incorrectly shows toolbar activation guidance");
  }
  if (result.unsupportedPages?.browser?.side?.empty) {
    errors.push("browser internal page should not render a duplicate empty-state block");
  }
  if (result.storagePrivacy?.ok !== true) {
    const hits = (result.storagePrivacy?.hits || []).map((hit) => `${hit.area}:${hit.path}:${hit.kind}`).join(", ");
    errors.push(`storage privacy probe found sensitive Web data in chrome.storage: ${hits || "(missing details)"}`);
  }
  for (const [label, pass, evidence] of qaMatrixRows(result)) {
    if (pass === null) continue;
    if (!pass) errors.push(`QA matrix failed: ${label}: ${evidence}`);
  }
  return errors;
}

function hasPassingTextThresholdRow(rows) {
  const row = rows?.find((item) => /文字門檻|Text threshold/.test(item.label || ""));
  const match = String(row?.value ?? "").match(/^(\d+)\/240$/);
  return Boolean(match && Number(match[1]) >= 240);
}

function rawRowValue(row) {
  return row?.rawValue || row?.value || "";
}

function hasSourceHref(links, pattern) {
  return (links || []).some((link) => pattern.test(link.href || ""));
}

function isWebReadyStatus(status) {
  return status === "已讀取" || status === "Ready" || status === "已擷取" || status === "Captured";
}

function isReadyObservation(observation) {
  return observation?.runtimeState?.status === "ready" &&
    observation?.runtimeState?.hasSurface === true &&
    (observation?.pageAnalysis?.ready === true || /\bis-ready\b/.test(observation?.pageAnalysis?.className || ""));
}

function qaPass(value) {
  if (value === null) return "SKIP";
  return value ? "PASS" : "FAIL";
}

function escapeTableCell(value) {
  return String(value).replace(/\|/g, "\\|");
}

function designRestraint(result) {
  const cleanBriefPipelineHidden = result.success.pageBrief?.status === "ready" &&
    result.success.pageBrief?.pipelineHidden === true;
  const readyDiagnosticsCollapsed = cleanBriefPipelineHidden ||
    (result.success.ready.extractionDiagnosticsOpen === false &&
      result.success.ready.modelContext?.diagnosticsOpen === false &&
      result.success.ready.advisor?.diagnosticsOpen === false);
  const cleanBriefDebugHidden = result.success.pageBrief?.status !== "ready" ||
    (result.success.pageBrief?.pipelineHidden === true &&
      result.success.pageBrief?.diagnosticsHidden === true &&
      !/讀取細節|Reading details|分析準備|Analysis readiness|分析範圍|Analysis scope|頁面狀態|Page status/.test(result.success.responsive?.pageText || ""));
  const readyPageStatusConsolidated = cleanBriefPipelineHidden ||
    (/page-reader-processing-status/.test(result.success.ready.modelContext?.className || "") &&
      /頁面狀態|Page status/.test(result.success.ready.processingStatus?.title || result.success.ready.modelContext?.title || ""));
  const readyBriefStatusQuiet = !/is-ready/.test(result.success.ready.pageAnalysis?.className || "") ||
    result.success.ready.pageAnalysis?.statusVisible === false;
  const compactBriefSectionLayout = !/is-ready/.test(result.success.ready.pageAnalysis?.className || "") ||
    (result.success.ready.pageAnalysis?.listSectionCount ?? 0) <= 1;
  const sharedQuestionActionLayout = !/is-ready/.test(result.success.ready.pageAnalysis?.className || "") ||
    !result.success.ready.pageAnalysis?.questionListTag ||
    (result.success.ready.pageAnalysis?.questionListTag === "UL" &&
      result.success.ready.pageAnalysis?.questionRowTag === "LI" &&
      result.success.ready.pageAnalysis?.questionRowDisplay === "grid" &&
      result.success.ready.pageAnalysis?.questionActionJustifySelf === "end" &&
      result.success.responsive360?.questionActionsStacked === true &&
      result.success.responsive?.questionActionsStacked === true);
  const cleanReadyRawExcerptContextualized = result.success.pageBrief?.status !== "ready" ||
    (result.success.pageBrief?.rawExcerptVisible === true &&
      result.success.pageBrief?.rawExcerptDirectVisible === false &&
      result.success.pageBrief?.rawExcerptContextualized === true &&
      result.success.pageBrief?.contextDetailsOpen === false);
  const cleanReadyBriefHeaderAligned = result.success.pageBrief?.status !== "ready" ||
    (result.success.pageBrief?.readyHeaderVisible === true &&
      /閱讀脈絡|Reading context/.test(result.success.pageBrief?.header || ""));
  const secondaryActionsInFooter = result.success.ready.cardActions?.headerCopy === false &&
    result.success.ready.cardActions?.headerDownload === false &&
    result.success.ready.cardActions?.footerCopy === true &&
    result.success.ready.cardActions?.footerDownload === true;
  const sourceContextAndExternalToolsSeparated = result.success.ready.cardActions?.contextSourceLinks === true &&
    result.success.ready.cardActions?.completeExternalToolsFooter === true;
  const sharedReadingSkeleton = /頁面脈絡|Page context/.test(result.success.ready.informationArchitecture?.contextTitle || "") &&
    /閱讀脈絡|Reading context/.test(result.success.ready.informationArchitecture?.readingTitle || "") &&
    /外部工具整合|External Tool Integration/.test(result.success.ready.informationArchitecture?.toolsTitle || "") &&
    result.success.ready.informationArchitecture?.contextCollapsed === true &&
    result.success.ready.informationArchitecture?.contextBeforeReading === true &&
    result.success.ready.informationArchitecture?.readingBeforeTools === true;
  const pageContextExpandedHealthy = result.success.pageContext?.present === true &&
    result.success.pageContext?.open === true &&
    /頁面脈絡|Page context/.test(result.success.pageContext?.title || "") &&
    result.success.pageContext?.hasPreview === true &&
    (result.success.pageContext?.sourceLinkCount ?? 0) >= 1 &&
    result.success.pageContext?.technicalDetailsCollapsed === true;
  const cleanReadyPrimaryActions = result.success.pageBrief?.primaryActions || result.success.ready.primaryActions;
  const primaryActionsScopedToCard = cleanReadyPrimaryActions?.hasStandaloneHeader === false &&
    cleanReadyPrimaryActions?.cardScopedReadAction === true &&
    cleanReadyPrimaryActions?.hasTopLevelFocusTab === true &&
    cleanReadyPrimaryActions?.hasInternalWorkspaceTabs === false &&
    cleanReadyPrimaryActions?.noPaneCommandBar === true;
  const sourceLinksCapped = (result.success.ready.sourceLinks?.length ?? 0) <= 6;
  const nonCleanTechnicalCollapsed = result.teaser.ready.extractionDiagnosticsOpen !== true &&
    (result.teaser.ready.pipelineHidden === true || (
      result.teaser.ready.modelContext?.diagnosticsOpen === false &&
      result.teaser.ready.advisor?.diagnosticsOpen === false
    ));
  const responsiveClean = [result.success.responsive360, result.success.responsive].every((responsive) =>
    responsive?.horizontalOverflow === false &&
    (responsive?.interactiveOverflows?.length ?? 0) === 0 &&
    (responsive?.visibleCardsOutsideViewport?.length ?? 0) === 0);
  const interactionAccessible = [result.success.responsive360, result.success.responsive].every((responsive) =>
    (responsive?.unnamedInteractive?.length ?? 0) === 0 &&
    (responsive?.undersizedControls?.length ?? 0) === 0);
  return {
    pass: readyDiagnosticsCollapsed && cleanBriefDebugHidden && readyPageStatusConsolidated && readyBriefStatusQuiet && compactBriefSectionLayout && sharedQuestionActionLayout && cleanReadyRawExcerptContextualized && cleanReadyBriefHeaderAligned && secondaryActionsInFooter && sourceContextAndExternalToolsSeparated && sharedReadingSkeleton && pageContextExpandedHealthy && primaryActionsScopedToCard && sourceLinksCapped && nonCleanTechnicalCollapsed && responsiveClean && interactionAccessible,
    readyDiagnosticsCollapsed,
    cleanBriefDebugHidden,
    readyPageStatusConsolidated,
    readyBriefStatusQuiet,
    compactBriefSectionLayout,
    sharedQuestionActionLayout,
    cleanReadyRawExcerptContextualized,
    cleanReadyBriefHeaderAligned,
    secondaryActionsInFooter,
    sourceContextAndExternalToolsSeparated,
    sharedReadingSkeleton,
    pageContextExpandedHealthy,
    primaryActionsScopedToCard,
    sourceLinksCapped,
    nonCleanTechnicalCollapsed,
    responsiveClean,
    interactionAccessible,
  };
}

function ordinaryArticleReadPasses(result) {
  const cleanBriefPipelineHidden = result.success.pageBrief?.status === "ready" &&
    result.success.pageBrief?.pipelineHidden === true &&
    result.success.pageBrief?.diagnosticsHidden === true;
  const diagnosticsSafe = cleanBriefPipelineHidden
    ? result.success.ready.extractionDiagnosticsOpen !== true
    : result.success.ready.extractionDiagnosticsOpen === false &&
      result.success.ready.modelContext?.diagnosticsOpen === false &&
      /page-reader-processing-status/.test(result.success.ready.modelContext?.className || "") &&
      result.success.ready.advisor?.diagnosticsOpen === false;
  return isReadyObservation(result.success.ready) &&
    result.success.ready.title === "Synthetic General Page Reader Article" &&
    !result.success.ready.fullTailVisible &&
    diagnosticsSafe &&
    (result.success.ready.sourceLinks?.length ?? 0) <= 6;
}

function autoReadTransitionState(result) {
  const entries = Array.isArray(result.success.initialLoadTimeline)
    ? result.success.initialLoadTimeline
    : [];
  const firstLoading = entries.find((entry) => entry.runtimeState?.displayedSession?.status === "loading");
  const loadingEntries = entries.filter((entry) => entry.runtimeState?.displayedSession?.status === "loading");
  const initialReadActionEntries = loadingEntries.filter((entry) => entry.readActionPresent === true);
  const initialExportActionEntries = loadingEntries.filter((entry) => entry.exportActionCount > 0);
  const duplicateLoadingStatusEntries = loadingEntries.filter((entry) =>
    entry.liveStatusCount !== 1 || entry.secondaryLoadingStatusPresent === true);
  const firstAnalysis = entries.find((entry) => /page-reader-analysis is-(?:running|ready)/.test(entry.analysisClass || ""));
  const technicalStates = entries.filter((entry) =>
    (firstAnalysis ? entry.elapsedMs <= firstAnalysis.elapsedMs : true) &&
    (
      entry.extractionDiagnosticsPresent ||
      entry.processingStatusPresent ||
      entry.modelContextPresent ||
      entry.advisorPresent ||
      entry.previewDirectPresent ||
      entry.pageContextOpen === true ||
      (entry.previewPresent && !entry.pageContextPresent)
    ));
  const firstLoadingMs = typeof firstLoading?.elapsedMs === "number" ? firstLoading.elapsedMs : undefined;
  return {
    pass: typeof firstLoadingMs === "number" && firstLoadingMs <= 100 &&
      technicalStates.length === 0 && initialReadActionEntries.length === 0 && initialExportActionEntries.length === 0 &&
      duplicateLoadingStatusEntries.length === 0,
    firstLoadingMs,
    technicalStateCount: technicalStates.length,
    initialReadActionCount: initialReadActionEntries.length,
    initialExportActionCount: initialExportActionEntries.length,
    duplicateLoadingStatusCount: duplicateLoadingStatusEntries.length,
  };
}

function initialAnalysisActionState(result) {
  const entries = Array.isArray(result.success.initialLoadTimeline)
    ? result.success.initialLoadTimeline
    : [];
  const runningEntries = entries.filter((entry) =>
    entry.runtimeState?.displayedSession?.status === "ready" &&
    entry.runtimeState?.displayedSession?.analysisStatus === "running");
  const unsafeEntries = runningEntries.filter((entry) =>
    entry.readActionPresent !== true ||
    !/\bis-reread-busy\b/.test(entry.readActionClass || "") ||
    entry.readActionAriaDisabled !== "true" ||
    !/正在整理此頁|Organizing this page/.test(entry.readActionText || "") ||
    entry.exportActionCount > 0);
  return {
    pass: runningEntries.length > 0 && unsafeEntries.length === 0,
    runningStateCount: runningEntries.length,
    unsafeStateCount: unsafeEntries.length,
  };
}

function advisorTransitionState(result) {
  const entries = Array.isArray(result.teaser?.advisorTimeline)
    ? result.teaser.advisorTimeline
    : [];
  const checkingEntries = entries.filter((entry) =>
    entry.runtimeState?.displayedSession?.advisorStatus === "checking");
  const unsafeEntries = checkingEntries.filter((entry) =>
    entry.extractionDiagnosticsPresent ||
    entry.processingStatusPresent ||
    entry.modelContextPresent ||
    entry.advisorPresent ||
    (entry.previewPresent && !entry.supplementalDetailsPresent) ||
    !/page-reader-analysis is-running/.test(entry.analysisClass || ""));
  return {
    pass: checkingEntries.length > 0 && unsafeEntries.length === 0,
    checkingStateCount: checkingEntries.length,
    unsafeStateCount: unsafeEntries.length,
  };
}

function runtimeReloadSafety(result) {
  const reload = result.runtimeReload || {};
  if (!reload.requested) return true;
  const expectedFacebookReloads = reload.extensionReloaded
    ? reload.facebookTabsFound
    : reload.facebookTabsStale;
  return reload.facebookTabsReloaded === expectedFacebookReloads &&
    (expectedFacebookReloads > 0 || reload.skippedReason === "already_fresh");
}

function claimActionPayloadContract(result) {
  const links = result.success?.claimInvestigation?.links ?? [];
  const standard = links.find((link) => /Google 搜尋|Search Google/.test(link.label || ""));
  const aiMode = links.find((link) => /問 Gemini|Ask Gemini/.test(link.label || ""));
  try {
    const aiModeUrl = aiMode ? new URL(aiMode.href) : null;
    const aiModePrompt = aiModeUrl?.searchParams.get("q") || "";
    return {
      pass: Boolean(
        !standard && aiModeUrl &&
        /google\.com$/u.test(aiModeUrl.hostname) &&
        aiModeUrl.searchParams.get("udm") === "50" &&
        aiModePrompt &&
        /Original claim|原文陳述/u.test(aiModePrompt) &&
        /Evidence target|證據方向/u.test(aiModePrompt) &&
        /Source metadata \(not evidence\)|來源中繼資料（不等於證據）/u.test(aiModePrompt) &&
        /127\.0\.0\.1/u.test(aiModePrompt)
      ),
      standardQueryLength: 0,
      aiModePromptLength: aiModePrompt.length,
    };
  } catch {
    return { pass: false, standardQueryLength: 0, aiModePromptLength: 0 };
  }
}

function qaMatrixRows(result) {
  const noisyAdvisorRows = result.noisy.ready.advisor?.rows || [];
  const candidateAdvisorRows = result.candidate.ready.advisor?.rows || [];
  const teaserAdvisorRows = result.teaser.ready.advisor?.rows || [];
  const noisyDecision = rawRowValue(noisyAdvisorRows.find((row) => /判斷|Decision/.test(row.label || "")));
  const noisyUse = rawRowValue(noisyAdvisorRows.find((row) => /用途|Use/.test(row.label || "")));
  const candidateDecision = rawRowValue(candidateAdvisorRows.find((row) => /判斷|Decision/.test(row.label || "")));
  const candidateUse = rawRowValue(candidateAdvisorRows.find((row) => /用途|Use/.test(row.label || "")));
  const teaserDecision = result.teaser.ready.runtimeState?.advisorDecision !== "none"
    ? result.teaser.ready.runtimeState?.advisorDecision
    : rawRowValue(teaserAdvisorRows.find((row) => /判斷|Decision/.test(row.label || "")));
  const teaserUse = result.teaser.ready.runtimeState?.allowedUse ||
    rawRowValue(teaserAdvisorRows.find((row) => /用途|Use/.test(row.label || "")));
  const noisyBriefReady = result.noisy.ready.pipelineHidden === true && result.noisy.ready.pageAnalysis?.ready === true;
  const candidateBriefReady = result.candidate.ready.pipelineHidden === true && result.candidate.ready.pageAnalysis?.ready === true;
  const teaserBriefReady = result.teaser.ready.pipelineHidden === true && result.teaser.ready.pageAnalysis?.ready === true;
  const noGrantShowsDomainAuthorization = result.noGrant.hasAuthorizeDomain === true &&
    /授權網域|Authorize domain/.test(result.noGrant.authorizeButtonText || "") &&
    /允許 Truly 讀取此網域|Allow Truly to read pages on this domain/.test(result.noGrant.authorizeButtonTitle || "") &&
    result.noGrant.detailHasGenericRetry === false &&
    result.noGrant.errorBlockPresent === false &&
    result.noGrant.emptyBlockPresent === true;
  const noGrantShowsUrlUnavailableGuidance = result.noGrant.hasAuthorizeDomain === false &&
    result.noGrant.hasGuidance === true &&
    result.noGrant.hasAllSitesGuidance === true &&
    result.noGrant.detailHasGuidance === true &&
    result.noGrant.detailHasGenericRetry === false &&
    result.noGrant.errorBlockPresent === false &&
    result.noGrant.emptyBlockPresent === false;
  const restraint = designRestraint(result);
  const claimActions = claimActionPayloadContract(result);
  return [
    [
      "Runtime reload safety",
      runtimeReloadSafety(result),
      "requested=" + Boolean(result.runtimeReload?.requested) +
        "; extensionStale=" + Boolean(result.runtimeReload?.extensionStale) +
        "; extensionReloaded=" + Boolean(result.runtimeReload?.extensionReloaded) +
        "; facebookFound=" + (result.runtimeReload?.facebookTabsFound ?? "missing") +
        "; facebookStale=" + (result.runtimeReload?.facebookTabsStale ?? "missing") +
        "; facebookReloaded=" + (result.runtimeReload?.facebookTabsReloaded ?? "missing") +
        "; skipped=" + (result.runtimeReload?.skippedReason || "none"),
    ],
    [
      "Popup activation",
      result.popup.general.button === "讀取此頁" &&
        result.popup.general.disabled === false &&
        /\bok\b/.test(result.popup.general.dotClass || "") &&
        !/\bchecking\b/.test(result.popup.general.dotClass || "") &&
      result.popup.unsupported.disabled === true,
      "general=" + result.popup.general.button + "/disabled=" + result.popup.general.disabled + "; dot=" + (result.popup.general.dotClass || "missing") + "; unsupportedDisabled=" + result.popup.unsupported.disabled,
    ],
    [
      "Popup read click",
      isPopupReadSkipped(result)
        ? null
        : result.popupRead.before.activeTab?.url === result.syntheticUrls.popupRead &&
        result.popupRead.before.button === "讀取此頁" &&
        result.popupRead.before.disabled === false &&
        isWebReadyStatus(result.popupRead.sideState.status) &&
        result.popupRead.sideState.title === "Synthetic General Page Reader Article",
      isPopupReadSkipped(result)
        ? `skipped=${result.popupRead.reason || "requested"}`
        : "activeUrl=" + (result.popupRead.before.activeTab?.url || "missing") +
        "; initialHadResult=" + /Synthetic General Page Reader Article/.test(result.popupRead.initialSide?.text || "") +
        "; status=" + (result.popupRead.sideState.status || "missing") +
        "; title=" + (result.popupRead.sideState.title || "missing"),
    ],
    [
      "Ordinary article read",
      ordinaryArticleReadPasses(result),
      "title=" + result.success.ready.title + "; links=" + (result.success.ready.sourceLinks?.length ?? 0) + "; diagnosticsSafe=" + (result.success.ready.extractionDiagnosticsOpen !== true),
    ],
    [
      "Read elapsed display",
      !/秒|\bs\b/.test(result.success.ready.status || "") &&
        /讀取耗時|Read took/.test(result.success.ready.statusTitle || "") &&
        !/讀取耗時 0 秒|Read took 0s/.test(result.success.ready.statusTitle || ""),
      "label=" + (result.success.ready.status || "missing") +
        "; title=" + (result.success.ready.statusTitle || "missing"),
    ],
    [
      "All-sites sidepanel auto-read",
      result.success.autoRead?.allSites
        ? result.success.autoRead?.observed === true
        : true,
      "allSites=" + Boolean(result.success.autoRead?.allSites) +
        "; observed=" + Boolean(result.success.autoRead?.observed) +
        (result.success.autoRead?.error ? "; error=" + result.success.autoRead.error : ""),
    ],
    [
      "Auto-read transitional UI",
      result.success.autoRead?.allSites ? autoReadTransitionState(result).pass : true,
      "firstLoadingMs=" + (autoReadTransitionState(result).firstLoadingMs ?? "missing") +
        "; technicalStates=" + autoReadTransitionState(result).technicalStateCount +
        "; initialReadActions=" + autoReadTransitionState(result).initialReadActionCount +
        "; initialExportActions=" + autoReadTransitionState(result).initialExportActionCount +
        "; duplicateLoadingStatuses=" + autoReadTransitionState(result).duplicateLoadingStatusCount,
    ],
    [
      "Initial analysis action lock",
      initialAnalysisActionState(result).pass,
      "runningStates=" + initialAnalysisActionState(result).runningStateCount +
        "; unsafeStates=" + initialAnalysisActionState(result).unsafeStateCount,
    ],
    [
      "Advisor transitional UI",
      advisorTransitionState(result).pass,
      "checkingStates=" + advisorTransitionState(result).checkingStateCount +
        "; unsafeStates=" + advisorTransitionState(result).unsafeStateCount,
    ],
    [
      "Page brief generation",
      result.success.pageBrief?.status === "ready" &&
        (result.success.pageBrief?.pipelineHidden === true ||
          /已整理|Organized|已產生重點|Brief created/.test(result.success.pageBrief?.modelContextStatus || "")) &&
        result.success.pageBrief?.diagnosticsHidden === true,
      "status=" + (result.success.pageBrief?.status || "missing") +
        "; modelContext=" + (result.success.pageBrief?.modelContextStatus || (result.success.pageBrief?.pipelineHidden ? "hidden" : "missing")) +
        "; diagnostics=" + (result.success.pageBrief?.diagnosticsHidden ? "hidden" : "visible"),
    ],
    [
      "Page brief standard contract",
      (result.success.pageBrief?.standardContract?.questionCount ?? 0) <= 1 &&
        (result.success.pageBrief?.standardContract?.multiItemListCount ?? 0) <= 2,
      "questionCount=" + (result.success.pageBrief?.standardContract?.questionCount ?? "missing") +
        "; compactListItems=" + (result.success.pageBrief?.standardContract?.multiItemListCount ?? "missing"),
    ],
    [
      "Claim investigation prepare",
        result.success.claimInvestigation?.available === true &&
        result.success.claimInvestigation?.ready === true &&
        result.success.claimInvestigation?.preparing?.observed === true &&
        result.success.claimInvestigation?.preparing?.headingLoadingVisible === true &&
        result.success.claimInvestigation?.preparing?.compactRowVisible === false &&
        result.success.claimInvestigation?.preparing?.actionReadyVisible === false &&
        result.success.claimInvestigation?.preparingUi?.headingLoadingCount === 1 &&
        result.success.claimInvestigation?.preparingUi?.perRowLoadingTextPresent === false &&
        Boolean(result.success.claimInvestigation?.question) &&
        result.success.claimInvestigation?.copyPresent === true &&
        result.success.claimInvestigation?.evidenceTogglePresent === true &&
        result.success.claimInvestigation?.evidenceNeedHidden === true &&
        result.success.claimInvestigation?.evidenceNeedPrefixAbsent === true &&
        result.success.claimInvestigation?.evidenceDisclosure?.expanded === true &&
        result.success.claimInvestigation?.evidenceDisclosure?.hidden === false &&
        result.success.claimInvestigation?.evidenceHover?.consistent === true &&
        result.success.claimInvestigation?.compactRows === true &&
        result.success.claimInvestigation?.rowCount === EXPECTED_INVESTIGATION_ACTION_COUNT &&
        result.success.claimInvestigation?.bulletList === true &&
        result.success.claimInvestigation?.sourceClaimsPresent === true &&
        result.success.claimInvestigation?.sourceFramingPresent === true &&
        result.success.claimInvestigation?.actionsBelowQuestion === true &&
        result.success.claimInvestigation?.compactActionProximity === true &&
        result.success.claimInvestigation?.manualStartPresent === false &&
        result.success.claimInvestigation?.originalClaimVisible === false &&
        result.success.claimInvestigation?.redundantLabelPresent === false &&
        result.success.claimInvestigation?.openedTargetOnPrepare === false &&
        (result.success.claimInvestigation?.links?.length ?? 0) === 1 &&
        result.success.claimInvestigation.links.every((link) => link.target === "_blank" && /noopener/.test(link.rel)),
      "available=" + Boolean(result.success.claimInvestigation?.available) +
        "; preparing=" + Boolean(result.success.claimInvestigation?.preparing?.observed) +
        "; ready=" + Boolean(result.success.claimInvestigation?.ready) +
        "; openedOnPrepare=" + Boolean(result.success.claimInvestigation?.openedTargetOnPrepare) +
        "; links=" + (result.success.claimInvestigation?.links?.length ?? 0),
    ],
    [
      "Atomic claim fallback presentation",
      result.success.claimInvestigation?.fallbackStates?.available === true &&
        result.success.claimInvestigation?.fallbackStates?.ineligible?.rowCount === 0 &&
        result.success.claimInvestigation?.fallbackStates?.ineligible?.sectionPresent === false &&
        result.success.claimInvestigation?.fallbackStates?.ineligible?.adapterIneligibleCount === 1 &&
        result.success.claimInvestigation?.fallbackStates?.ineligible?.batchStatus === "ineligible" &&
        result.success.claimInvestigation?.fallbackStates?.unavailable?.rowCount === 0 &&
        result.success.claimInvestigation?.fallbackStates?.unavailable?.sectionPresent === false &&
        result.success.claimInvestigation?.fallbackStates?.unavailable?.adapterUnavailableCount === 1 &&
        result.success.claimInvestigation?.fallbackStates?.unavailable?.batchStatus === "unavailable",
      "ineligibleRows=" + (result.success.claimInvestigation?.fallbackStates?.ineligible?.rowCount ?? "missing") +
        "; unavailableRows=" + (result.success.claimInvestigation?.fallbackStates?.unavailable?.rowCount ?? "missing"),
    ],
    [
      "Claim Gemini payload",
      claimActions.pass,
      "standardSearchAbsent=" + (claimActions.standardQueryLength === 0) +
        "; aiModePrompt=" + claimActions.aiModePromptLength,
    ],
    [
      "Responsive Web layout",
      [result.success.responsive360, result.success.responsive].every((responsive) =>
        responsive?.horizontalOverflow === false &&
        (responsive?.interactiveOverflows?.length ?? 0) === 0 &&
        (responsive?.visibleCardsOutsideViewport?.length ?? 0) === 0 &&
        responsive?.questionActionsStacked === true),
      "360/430px horizontalOverflow=" + result.success.responsive360?.horizontalOverflow + "/" + result.success.responsive?.horizontalOverflow +
        "; stackedQuestions=" + result.success.responsive360?.questionActionsStacked + "/" + result.success.responsive?.questionActionsStacked,
    ],
    [
      "Web design restraint",
      restraint.pass,
      "readyCollapsed=" + restraint.readyDiagnosticsCollapsed +
        "; cleanBriefDebugHidden=" + restraint.cleanBriefDebugHidden +
        "; pageStatusConsolidated=" + restraint.readyPageStatusConsolidated +
        "; readyBriefStatusQuiet=" + restraint.readyBriefStatusQuiet +
        "; compactBriefSectionLayout=" + restraint.compactBriefSectionLayout +
        "; sharedQuestionActionLayout=" + restraint.sharedQuestionActionLayout +
        "; cleanReadyRawExcerptContextualized=" + restraint.cleanReadyRawExcerptContextualized +
        "; cleanReadyBriefHeaderAligned=" + restraint.cleanReadyBriefHeaderAligned +
        "; secondaryActionsInFooter=" + restraint.secondaryActionsInFooter +
        "; sourceContextAndExternalToolsSeparated=" + restraint.sourceContextAndExternalToolsSeparated +
        "; sharedReadingSkeleton=" + restraint.sharedReadingSkeleton +
        "; pageContextExpandedHealthy=" + restraint.pageContextExpandedHealthy +
        "; primaryActionsScopedToCard=" + restraint.primaryActionsScopedToCard +
        "; sourceLinksCapped=" + restraint.sourceLinksCapped +
        "; nonCleanTechnicalCollapsed=" + restraint.nonCleanTechnicalCollapsed +
        "; responsiveClean=" + restraint.responsiveClean +
        "; interactionAccessible=" + restraint.interactionAccessible,
    ],
    [
      "Web interaction accessibility",
      (result.success.responsive?.unnamedInteractive?.length ?? 0) === 0 &&
        (result.success.responsive?.undersizedControls?.length ?? 0) === 0,
      "unnamed=" + (result.success.responsive?.unnamedInteractive?.length ?? 0) +
        "; undersizedControls=" + (result.success.responsive?.undersizedControls?.length ?? 0),
    ],
    [
      "Web history hidden",
      result.success.history?.second?.sessionCount === 0 &&
        result.success.history?.third?.sessionCount === 0 &&
        result.success.history?.display?.sessionCount === 0 &&
        result.success.history?.second?.switcherVisible === false &&
        result.success.history?.third?.switcherVisible === false &&
        result.success.history?.display?.switcherVisible === false &&
        result.success.history?.display?.selectionDisabled === false &&
        result.success.history?.display?.readCurrentVisible === false,
      "secondChips=" + (result.success.history?.second?.sessionCount ?? "missing") +
        "; thirdChips=" + (result.success.history?.third?.sessionCount ?? "missing") +
        "; focusSelection=" + (result.success.history?.display?.selectionDisabled === false) +
        "; focusReadVisible=" + Boolean(result.success.history?.display?.readCurrentVisible),
    ],
    [
      "Selection target",
      Boolean(result.success.selection?.selectedText) &&
        result.success.selection?.beforeAction?.selectionDisabled === false &&
        result.success.selection?.beforeAction?.targetKind === "page" &&
        result.success.selection?.activeState?.displayedSession?.targetKind === "selection" &&
        (
          result.success.selection?.activeState?.displayedSession?.advisorDecision === "accept_current" ||
          (
            result.success.selection?.activeState?.displayedSession?.advisorStatus === "not_needed" &&
            result.success.selection?.activeState?.displayedSession?.allowedUse === "article_or_selection_analysis"
          )
        ) &&
        result.success.selection?.focusPanelCount === 1 &&
        result.success.selection?.hasPageCard === false,
      "before=" + (result.success.selection?.beforeAction?.targetKind || "missing") +
        "; after=selection; selectedChars=" + (result.success.selection?.selectedText?.length ?? 0),
    ],
    [
      "Current-region shortcut",
      result.success.pointTarget?.targetKind === "current-region" &&
        result.success.pointTarget?.focusPanelCount === 1 &&
        result.success.pointTarget?.hasPageCard === false,
      "target=" + (result.success.pointTarget?.targetKind || "missing") + "; advisor=" + (result.success.pointTarget?.advisorStatus || "missing"),
    ],
    [
      "URL identity and navigation scrub",
      assertMeaningfulNavigationScenario(result.success.navigation, {
        autoRead: Boolean(result.success.autoRead?.allSites),
      }).length === 0,
      (() => {
        const summary = meaningfulNavigationSummary(result.success.navigation);
        return "hashStale=" + summary.hashStale +
          "; trackingStale=" + summary.trackingStale +
          "; loadingObserved=" + summary.loadingObserved +
          "; staleObserved=" + summary.staleObserved +
          "; scrubObserved=" + summary.scrubObserved +
          "; requestInvalidated=" + summary.requestInvalidated +
          "; oldContentVisibleAtEnd=" + summary.oldContentVisibleAtEnd;
      })(),
    ],
    [
      "Noisy fallback clean context",
      noisyBriefReady ||
        (/page-reader-processing-status/.test(result.noisy.ready.modelContext?.className || "") &&
          noisyDecision === "accept_current" &&
          noisyUse === "article_or_selection_analysis" &&
          result.noisy.ready.modelContext?.diagnosticsOpen === false &&
          result.noisy.ready.advisor?.diagnosticsOpen === false),
      "briefReady=" + noisyBriefReady + "; decision=" + (noisyDecision || "missing") + "; use=" + (noisyUse || "missing"),
    ],
    [
      "Candidate fixture extraction",
      (candidateBriefReady ||
        (["prefer_candidate_block", "accept_current"].includes(candidateDecision) &&
          candidateUse === "article_or_selection_analysis" &&
          (candidateDecision === "accept_current" || result.candidate.ready.hasFullCandidateContinuation === true))) &&
        hasSourceHref(result.candidate.ready.sourceLinks, /\/candidate-source$/),
      "briefReady=" + candidateBriefReady + "; decision=" + (candidateDecision || "missing") + "; use=" + (candidateUse || "missing"),
    ],
    [
      "Teaser hub safe scope",
      (teaserBriefReady ||
        ((teaserDecision === "downgrade_to_index_or_feed" && teaserUse === "page_overview_only") ||
          (teaserDecision === "request_user_selection" && teaserUse === "requires_user_target"))) &&
        result.teaser.ready.extractionDiagnosticsOpen !== true &&
        (teaserBriefReady || result.teaser.ready.modelContext?.diagnosticsOpen === false) &&
        (teaserBriefReady || result.teaser.ready.advisor?.diagnosticsOpen === false) &&
        result.teaser.ready.hasMemberArea === false &&
        result.teaser.ready.hasNewsletter === false,
      "briefReady=" + teaserBriefReady + "; decision=" + (teaserDecision || "missing") + "; use=" + (teaserUse || "missing"),
    ],
    [
      "Screenshot recovery",
      result.screenshot?.offer?.state === "offer" &&
        result.screenshot?.offer?.pipelineHidden === true &&
        result.screenshot?.offer?.warningsHidden === true &&
        result.screenshot?.preview?.state === "preview" &&
        (result.screenshot?.preview?.previewRect?.height ?? 0) >= 100 &&
        result.screenshot?.preview?.hasConfirmButton === true &&
        result.screenshot?.captureClickState?.captureCalls?.length === 1 &&
        result.screenshot?.confirmed?.hasPreview === false &&
        result.screenshot?.confirmed?.domHasDataImage === false &&
        result.screenshot?.requests?.some((request) => request.kind === "screenshot-brief" && request.hasImageUrl === true) &&
        result.screenshot?.storageAfter?.ok === true,
      "offer=" + (result.screenshot?.offer?.state || "missing") +
        "; offerPipelineHidden=" + Boolean(result.screenshot?.offer?.pipelineHidden) +
        "; offerWarningsHidden=" + Boolean(result.screenshot?.offer?.warningsHidden) +
        "; preview=" + (result.screenshot?.preview?.state || "missing") +
        "/" + Math.round(result.screenshot?.preview?.previewRect?.height ?? 0) + "px" +
        "; captureCalls=" + (result.screenshot?.captureClickState?.captureCalls?.length ?? "missing") +
        "; sentImage=" + Boolean(result.screenshot?.requests?.some((request) => request.kind === "screenshot-brief" && request.hasImageUrl === true)) +
        "; domHasDataImageAfter=" + Boolean(result.screenshot?.confirmed?.domHasDataImage) +
        "; storageHits=" + (result.screenshot?.storageAfter?.hits?.length ?? "missing"),
    ],
    [
      "Storage privacy probe",
      result.storagePrivacy?.ok === true,
      "localKeys=" + (result.storagePrivacy?.localKeyCount ?? "missing") +
        "; sessionKeys=" + (result.storagePrivacy?.sessionKeyCount ?? "missing") +
        "; hits=" + (result.storagePrivacy?.hits?.length ?? "missing"),
    ],
    [
      "No-grant guidance",
      noGrantShowsDomainAuthorization || noGrantShowsUrlUnavailableGuidance,
      "authorize=" + result.noGrant.authorizeButtonText +
        "; toolbarGuidance=" + result.noGrant.hasGuidance +
        "; allSitesGuidance=" + result.noGrant.hasAllSitesGuidance +
        "; primaryDetail=" + result.noGrant.detailHasGuidance +
        "; genericRetry=" + result.noGrant.detailHasGenericRetry +
        "; duplicateErrorBlock=" + result.noGrant.errorBlockPresent +
        "; duplicateEmptyBlock=" + result.noGrant.emptyBlockPresent,
    ],
    [
      "Unsupported page guidance",
      result.unsupportedPages?.truly?.side?.readDisabled === null &&
        result.unsupportedPages?.browser?.side?.readDisabled === null &&
        /不支援此頁|Unsupported page/.test(result.unsupportedPages?.truly?.side?.status || "") &&
        /不支援此頁|Unsupported page/.test(result.unsupportedPages?.browser?.side?.status || "") &&
        /Truly.*設定|Truly settings|內部頁面|internal page/.test(result.unsupportedPages?.truly?.side?.detail || "") &&
        /瀏覽器內部頁面|Browser internal pages|Chrome 沒有提供目前分頁網址|Chrome did not provide the current tab URL/.test(result.unsupportedPages?.browser?.side?.detail || "") &&
        !result.unsupportedPages?.truly?.side?.empty &&
        !result.unsupportedPages?.browser?.side?.empty &&
        !/工具列圖示|toolbar icon/.test(result.unsupportedPages?.truly?.side?.text || "") &&
        (
          /Chrome 沒有提供目前分頁網址|Chrome did not provide the current tab URL/.test(result.unsupportedPages?.browser?.side?.detail || "") ||
          !/工具列圖示|toolbar icon/.test(result.unsupportedPages?.browser?.side?.text || "")
        ),
      "truly=" + (result.unsupportedPages?.truly?.side?.detail || "missing") +
        "; browser=" + (result.unsupportedPages?.browser?.side?.detail || "missing"),
    ],
  ];
}

function qaMatrixStatusByLabel(result) {
  return new Map(qaMatrixRows(result).map(([label, pass, evidence]) => [
    label,
    { result: qaPass(pass), evidence },
  ]));
}

function auditCoverageRows(result) {
  const status = qaMatrixStatusByLabel(result);
  const row = (feature, phase, risk, labels, artifacts) => {
    const checks = labels.map((label) => ({
      label,
      result: status.get(label)?.result || "MISSING",
      evidence: status.get(label)?.evidence || "",
    }));
    const hasFailure = checks.some((check) => check.result !== "PASS" && check.result !== "SKIP");
    const hasSkip = checks.some((check) => check.result === "SKIP");
    return {
      feature,
      phase,
      risk,
      result: hasFailure ? "FAIL" : hasSkip ? "PARTIAL" : "PASS",
      checks,
      artifacts,
    };
  };
  return [
    row(
      "Popup 讀取此頁",
      isPopupReadSkipped(result) ? "popup" : "popup-read",
      "Toolbar popup must not force a second Side Panel read click, and unsupported tabs must stay disabled.",
      ["Popup activation", "Popup read click"],
      [
        isPopupReadSkipped(result) ? null : relative(ROOT, resolve(OUT_DIR, "page-popup-read-result.png")),
      ].filter(Boolean),
    ),
    row(
      "Web 讀取",
      "success/noisy/candidate/teaser",
      "Readable pages should show useful main content; noisy pages should not leak navigation, recirculation, or browser-download content.",
      ["Ordinary article read", "Noisy fallback clean context", "Candidate fixture extraction", "Teaser hub safe scope"],
      [
        relative(ROOT, resolve(OUT_DIR, "page-ready-and-stale.png")),
        relative(ROOT, resolve(OUT_DIR, "page-noisy-fallback.png")),
        relative(ROOT, resolve(OUT_DIR, "page-candidate-block.png")),
        relative(ROOT, resolve(OUT_DIR, "page-teaser-hub-overview.png")),
      ],
    ),
    row(
      "模型脈絡準備",
      "success/noisy/candidate/teaser/storage-privacy",
      "Model context must reflect the effective target, visible readiness, and privacy boundary instead of raw DOM or stale extraction.",
      ["Page brief generation", "Page brief standard contract", "Storage privacy probe", "Noisy fallback clean context", "Candidate fixture extraction"],
      [
        relative(ROOT, resolve(OUT_DIR, "page-analysis-ready.png")),
        relative(ROOT, resolve(OUT_DIR, "page-noisy-fallback.png")),
        relative(ROOT, resolve(OUT_DIR, "page-candidate-block.png")),
        relative(ROOT, resolve(OUT_DIR, "audit.json")),
      ],
    ),
    row(
      "讀取耗時",
      "success",
      "Elapsed time should be quiet by default but inspectable on hover or failure, without misleading zero-second display.",
      ["Read elapsed display"],
      [relative(ROOT, resolve(OUT_DIR, "page-ready-and-stale.png"))],
    ),
    row(
      "Web history hidden",
      "success",
      "Multiple Web reads should keep internal session state without adding a visible history strip that competes with the current page brief.",
      ["Web history hidden"],
      [
        relative(ROOT, resolve(OUT_DIR, "page-web-history-hidden.png")),
        relative(ROOT, resolve(OUT_DIR, "page-web-history-hidden.json")),
      ],
    ),
    row(
      "URL meaningful change",
      "success",
      "Hash/tracking changes should not stale the session, while meaningful URL changes must scrub old page content.",
      ["URL identity and navigation scrub"],
      [relative(ROOT, resolve(OUT_DIR, "page-ready-and-stale.png"))],
    ),
    row(
      "選取文字",
      "success",
      "Selection must require explicit action and then scope the effective model target to selected text.",
      ["Selection target"],
      [relative(ROOT, resolve(OUT_DIR, "page-selection-target.png"))],
    ),
    row(
      "Current-region shortcut",
      "success/no-grant",
      "Current-region hotkey must fail closed without a live read/grant and use the pointer region only after a readable session exists.",
      ["Current-region shortcut", "No-grant guidance"],
      [
        relative(ROOT, resolve(OUT_DIR, "page-point-target.png")),
        relative(ROOT, resolve(OUT_DIR, "page-no-grant.png")),
      ],
    ),
    row(
      "截圖恢復流程",
      "screenshot-recovery/storage-privacy",
      "Screenshot assistance must be explicit, preview-confirmed, sent once, and removed from DOM/storage after use.",
      ["Screenshot recovery", "Storage privacy probe"],
      [
        relative(ROOT, resolve(OUT_DIR, "page-screenshot-offer.png")),
        relative(ROOT, resolve(OUT_DIR, "page-screenshot-preview.png")),
        relative(ROOT, resolve(OUT_DIR, "page-screenshot-confirmed.png")),
      ],
    ),
    row(
      "權限路徑",
      "popup/success/no-grant/unsupported-pages",
      "activeTab, all-sites auto-read, and unreadable special pages must use distinct user-facing guidance.",
      ["Popup activation", "All-sites sidepanel auto-read", "No-grant guidance", "Unsupported page guidance"],
      [
        relative(ROOT, resolve(OUT_DIR, "page-no-grant.png")),
        relative(ROOT, resolve(OUT_DIR, "page-unsupported-truly.png")),
        relative(ROOT, resolve(OUT_DIR, "page-unsupported-browser.png")),
      ],
    ),
    row(
      "Audit 工具",
      "all phases",
      "The audit must preserve loaded Facebook content scripts across runtime reloads and expose phase timing, QA evidence, private artifacts, and coverage.",
      ["Runtime reload safety", "Popup activation", "Ordinary article read", "Screenshot recovery", "Unsupported page guidance", "Storage privacy probe"],
      [
        relative(ROOT, resolve(OUT_DIR, "audit.json")),
        relative(ROOT, PHASE_LOG_PATH),
        relative(ROOT, resolve(OUT_DIR, "audit-coverage.json")),
      ],
    ),
  ];
}

function writeAuditCoverage(result) {
  const coverage = {
    capturedAt: result.capturedAt,
    expectedBuildId: result.expectedBuildId,
    liveBuildId: result.version?.buildId || null,
    rows: auditCoverageRows(result),
  };
  writeFileSync(resolve(OUT_DIR, "audit-coverage.json"), `${JSON.stringify(coverage, null, 2)}\n`);
  return coverage;
}

function writeSummary(result, errors) {
  const restraint = designRestraint(result);
  const coverage = writeAuditCoverage(result);
  const lines = [
    "# General Page Reader CDP Audit",
    "",
    `- Captured at: ${result.capturedAt}`,
    `- Expected buildId: ${result.expectedBuildId}`,
    `- Live buildId: ${result.version?.buildId || "(missing)"}`,
    `- Runtime reload: extensionReloaded=${Boolean(result.runtimeReload?.extensionReloaded)}; Facebook ${result.runtimeReload?.facebookTabsReloaded ?? 0}/${result.runtimeReload?.facebookTabsFound ?? 0}`,
    `- Verdict: ${errors.length === 0 ? "PASS" : "FAIL"}`,
    "",
    "## QA Matrix",
    "",
    "| Case | Result | Evidence |",
    "|---|---|---|",
    ...qaMatrixRows(result).map(([label, pass, evidence]) => `| ${label} | ${qaPass(pass)} | ${escapeTableCell(evidence)} |`),
    "",
    "## Feature Coverage Map",
    "",
    "| Feature | Result | Phase | Product risk covered | Evidence |",
    "|---|---|---|---|---|",
    ...coverage.rows.map((item) => `| ${escapeTableCell(item.feature)} | ${item.result} | ${escapeTableCell(item.phase)} | ${escapeTableCell(item.risk)} | ${escapeTableCell(item.checks.map((check) => `${check.label}: ${check.result}`).join("; "))} |`),
    "",
    "## Checks",
    "",
    `- Runtime reload safety: requested=${Boolean(result.runtimeReload?.requested)}; extensionStale=${Boolean(result.runtimeReload?.extensionStale)}; extensionReloaded=${Boolean(result.runtimeReload?.extensionReloaded)}; Facebook found/stale/reloaded=${result.runtimeReload?.facebookTabsFound ?? 0}/${result.runtimeReload?.facebookTabsStale ?? 0}/${result.runtimeReload?.facebookTabsReloaded ?? 0}; skipped=${result.runtimeReload?.skippedReason || "none"}`,
    `- Popup general page: ${result.popup.general.button} / disabled=${result.popup.general.disabled}`,
    `- Popup unsupported page disabled: ${result.popup.unsupported.disabled}`,
    isPopupReadSkipped(result)
      ? `- Popup read click: skipped (${result.popupRead.reason || "requested"})`
      : `- Popup read click: activeUrl=${result.popupRead.before.activeTab?.url || "(missing)"}; initialHadResult=${/Synthetic General Page Reader Article/.test(result.popupRead.initialSide?.text || "")}; status=${result.popupRead.sideState.status || "(missing)"}`,
    `- All-sites sidepanel auto-read: allSites=${Boolean(result.success.autoRead?.allSites)}; observed=${Boolean(result.success.autoRead?.observed)}`,
    `- Web read status: ${result.success.ready.status}`,
    `- Web read elapsed title: ${result.success.ready.statusTitle || "(missing)"}`,
    `- Page status: ${result.success.ready.processingStatus?.status || result.success.ready.modelContext?.status || "(missing)"}`,
    `- Page brief observation: ${result.success.pageBrief?.status || "(missing)"}`,
    `- Page brief model context status: ${result.success.pageBrief?.modelContextStatus || (result.success.pageBrief?.pipelineHidden ? "hidden" : "(missing)")}`,
    `- Page brief standard contract: questionCount=${result.success.pageBrief?.standardContract?.questionCount ?? "missing"}; compactListItems=${result.success.pageBrief?.standardContract?.multiItemListCount ?? "missing"}`,
    `- Responsive Web 360px: horizontalOverflow=${result.success.responsive360?.horizontalOverflow}; stackedQuestions=${result.success.responsive360?.questionActionsStacked}; clippedInteractive=${result.success.responsive360?.interactiveOverflows?.length ?? "(missing)"}`,
    `- Responsive Web 430px: horizontalOverflow=${result.success.responsive?.horizontalOverflow}; stackedQuestions=${result.success.responsive?.questionActionsStacked}; clippedInteractive=${result.success.responsive?.interactiveOverflows?.length ?? "(missing)"}; offscreenCards=${result.success.responsive?.visibleCardsOutsideViewport?.length ?? "(missing)"}`,
    `- Web design restraint: readyCollapsed=${restraint.readyDiagnosticsCollapsed}; cleanBriefDebugHidden=${restraint.cleanBriefDebugHidden}; pageStatusConsolidated=${restraint.readyPageStatusConsolidated}; readyBriefStatusQuiet=${restraint.readyBriefStatusQuiet}; compactBriefSectionLayout=${restraint.compactBriefSectionLayout}; sharedQuestionActionLayout=${restraint.sharedQuestionActionLayout}; cleanReadyRawExcerptContextualized=${restraint.cleanReadyRawExcerptContextualized}; cleanReadyBriefHeaderAligned=${restraint.cleanReadyBriefHeaderAligned}; secondaryActionsInFooter=${restraint.secondaryActionsInFooter}; sourceContextAndExternalToolsSeparated=${restraint.sourceContextAndExternalToolsSeparated}; sharedReadingSkeleton=${restraint.sharedReadingSkeleton}; pageContextExpandedHealthy=${restraint.pageContextExpandedHealthy}; primaryActionsScopedToCard=${restraint.primaryActionsScopedToCard}; sourceLinksCapped=${restraint.sourceLinksCapped}; nonCleanTechnicalCollapsed=${restraint.nonCleanTechnicalCollapsed}; responsiveClean=${restraint.responsiveClean}; interactionAccessible=${restraint.interactionAccessible}`,
    `- Page context expanded: present=${result.success.pageContext?.present}; open=${result.success.pageContext?.open}; preview=${result.success.pageContext?.hasPreview}; links=${result.success.pageContext?.sourceLinkCount ?? "(missing)"}; technicalCollapsed=${result.success.pageContext?.technicalDetailsCollapsed}`,
    `- Web interaction accessibility: unnamed=${result.success.responsive?.unnamedInteractive?.length ?? "(missing)"}; undersizedControls=${result.success.responsive?.undersizedControls?.length ?? "(missing)"}`,
    `- Web history hidden: secondChips=${result.success.history?.second?.sessionCount ?? "(missing)"}; thirdChips=${result.success.history?.third?.sessionCount ?? "(missing)"}; focusSelection=${result.success.history?.display?.selectionDisabled === false}; focusReadVisible=${Boolean(result.success.history?.display?.readCurrentVisible)}`,
    `- Selection target: ${result.success.selection?.advisorStatus || "(missing)"}`,
    `- Current-region target: ${result.success.pointTarget?.targetKind || "(missing)"} / ${result.success.pointTarget?.advisorStatus || "(missing)"}`,
    `- Source links visible: ${result.success.ready.sourceLinks?.length || 0}`,
    `- Noisy fallback model context: ${result.noisy.ready.modelContext?.status || "(missing)"}`,
    `- Noisy fallback reading context: ${result.noisy.ready.advisor?.status || "(missing)"}`,
    `- Noisy fallback source links: ${(result.noisy.ready.sourceLinks || []).map((link) => link.label).join(", ") || "(none)"}`,
    `- Candidate fixture extraction: ${result.candidate.ready.advisor?.status || "(missing)"}`,
    `- Teaser hub safe scope: ${result.teaser.ready.advisor?.status || "(missing)"}`,
    `- Screenshot recovery: offer=${result.screenshot?.offer?.state || "(missing)"}; preview=${result.screenshot?.preview?.state || "(missing)"}/${Math.round(result.screenshot?.preview?.previewRect?.height ?? 0)}px; sentImage=${Boolean(result.screenshot?.requests?.some((request) => request.kind === "screenshot-brief" && request.hasImageUrl === true))}; storageHits=${result.screenshot?.storageAfter?.hits?.length ?? "(missing)"}`,
    `- Meaningful navigation: ${JSON.stringify(meaningfulNavigationSummary(result.success.navigation))}`,
    `- Compact copy title/url/brief: ${result.success.copy.hasTitle}/${result.success.copy.hasUrl}/${result.success.copy.hasBrief}`,
    `- Compact copy excludes excerpt/raw/source list: ${!result.success.copy.hasExcerpt}/${!result.success.copy.hasRawDiagnostics}/${!result.success.copy.hasSourceList}`,
    `- Storage privacy probe: ok=${result.storagePrivacy?.ok}; localKeys=${result.storagePrivacy?.localKeyCount ?? "(missing)"}; sessionKeys=${result.storagePrivacy?.sessionKeyCount ?? "(missing)"}; hits=${result.storagePrivacy?.hits?.length ?? "(missing)"}`,
    `- No-grant domain authorization: ${result.noGrant.authorizeButtonText || "(missing)"}`,
    `- No-grant toolbar/all-sites guidance: toolbar=${result.noGrant.hasGuidance}; allSites=${result.noGrant.hasAllSitesGuidance}`,
    `- No-grant primary status guidance: ${result.noGrant.detailHasGuidance}; genericRetry=${result.noGrant.detailHasGenericRetry}; duplicateErrorBlock=${result.noGrant.errorBlockPresent}; duplicateEmptyBlock=${result.noGrant.emptyBlockPresent}`,
    `- Unsupported Truly page: status=${result.unsupportedPages?.truly?.side?.status || "(missing)"}; detail=${result.unsupportedPages?.truly?.side?.detail || "(missing)"}`,
    `- Unsupported browser page: status=${result.unsupportedPages?.browser?.side?.status || "(missing)"}; detail=${result.unsupportedPages?.browser?.side?.detail || "(missing)"}`,
    "",
    "## Artifacts",
    "",
    `- ${relative(ROOT, resolve(OUT_DIR, "audit.json"))}`,
    `- ${relative(ROOT, resolve(OUT_DIR, "audit-coverage.json"))}`,
    `- ${relative(ROOT, PHASE_LOG_PATH)}`,
    `- ${relative(ROOT, resolve(OUT_DIR, "runtime-reload.json"))}`,
    isPopupReadSkipped(result) ? null : `- ${relative(ROOT, resolve(OUT_DIR, "page-popup-read-result.png"))}`,
    `- ${relative(ROOT, resolve(OUT_DIR, "page-loading-initial.png"))}`,
    `- ${relative(ROOT, resolve(OUT_DIR, "page-analysis-running.png"))}`,
    `- ${relative(ROOT, resolve(OUT_DIR, "page-ready-and-stale.png"))}`,
    result.success.pageBrief?.screenshot ? `- ${result.success.pageBrief.screenshot}` : null,
    result.success?.claimInvestigation?.preparingScreenshot
      ? `- ${result.success.claimInvestigation.preparingScreenshot}`
      : null,
    `- ${relative(ROOT, resolve(OUT_DIR, "page-claim-investigation.png"))}`,
    result.success?.claimInvestigation?.evidenceScreenshot
      ? `- ${result.success.claimInvestigation.evidenceScreenshot}`
      : null,
    ...(result.success?.claimInvestigation?.evidenceHover?.states ?? [])
      .map((state) => `- ${state.screenshot}`),
    result.success.responsive360?.screenshot ? `- ${result.success.responsive360.screenshot}` : null,
    result.success.responsive?.screenshot ? `- ${result.success.responsive.screenshot}` : null,
    `- ${relative(ROOT, resolve(OUT_DIR, "page-context-expanded.png"))}`,
    `- ${relative(ROOT, resolve(OUT_DIR, "page-web-history-hidden.png"))}`,
    `- ${relative(ROOT, resolve(OUT_DIR, "page-web-history-hidden.json"))}`,
    `- ${relative(ROOT, resolve(OUT_DIR, "page-selection-target.png"))}`,
    `- ${relative(ROOT, resolve(OUT_DIR, "page-point-target.png"))}`,
    `- ${relative(ROOT, resolve(OUT_DIR, "page-noisy-fallback.png"))}`,
    `- ${relative(ROOT, resolve(OUT_DIR, "page-candidate-block.png"))}`,
    `- ${relative(ROOT, resolve(OUT_DIR, "page-teaser-hub-overview.png"))}`,
    `- ${relative(ROOT, resolve(OUT_DIR, "page-screenshot-offer.png"))}`,
    `- ${relative(ROOT, resolve(OUT_DIR, "page-screenshot-preview.png"))}`,
    `- ${relative(ROOT, resolve(OUT_DIR, "page-screenshot-confirmed.png"))}`,
    `- ${relative(ROOT, resolve(OUT_DIR, "page-no-grant.png"))}`,
    `- ${relative(ROOT, resolve(OUT_DIR, "page-unsupported-truly.png"))}`,
    `- ${relative(ROOT, resolve(OUT_DIR, "page-unsupported-browser.png"))}`,
    "",
    "## Public Repo Boundary",
    "",
    "This artifact uses synthetic local pages only. Screenshots and JSON still live under tmp/ and must not be committed.",
    "",
  ];
  if (errors.length > 0) {
    lines.push("## Errors", "", ...errors.map((error) => `- ${error}`), "");
  }
  writeFileSync(resolve(OUT_DIR, "summary.md"), `${lines.filter((line) => line !== null).join("\n")}\n`);
}

function assertUiOnlyAudit(result) {
  const errors = [];
  const success = result.success;

  if (success?.pageBrief?.status !== "ready") errors.push("Web analysis did not reach the ready state");
  for (const [width, responsive] of [[360, success?.responsive360], [430, success?.responsive]]) {
    if (responsive?.horizontalOverflow) errors.push(`${width}px Web layout has horizontal overflow`);
    if ((responsive?.interactiveOverflows?.length ?? 0) > 0) errors.push(`${width}px Web layout clips interactive controls`);
    if (responsive?.questionActionsStacked !== true) errors.push(`${width}px follow-up actions are not stacked below their questions`);
  }
  if ((success?.responsive?.unnamedInteractive?.length ?? 0) > 0) errors.push("Web layout contains unnamed interactive controls");
  if (
    success?.claimInvestigation?.available !== true ||
    success?.claimInvestigation?.ready !== true ||
    success?.claimInvestigation?.preparing?.observed !== true ||
    success?.claimInvestigation?.preparing?.headingLoadingVisible !== true ||
    success?.claimInvestigation?.preparing?.compactRowVisible !== false ||
    success?.claimInvestigation?.preparing?.actionReadyVisible !== false ||
    success?.claimInvestigation?.preparingUi?.headingLoadingCount !== 1 ||
    success?.claimInvestigation?.preparingUi?.perRowLoadingTextPresent !== false ||
    !success?.claimInvestigation?.question ||
    success?.claimInvestigation?.copyPresent !== true ||
    success?.claimInvestigation?.evidenceTogglePresent !== true ||
    success?.claimInvestigation?.evidenceNeedHidden !== true ||
    success?.claimInvestigation?.evidenceNeedPrefixAbsent !== true ||
    success?.claimInvestigation?.evidenceDisclosure?.expanded !== true ||
    success?.claimInvestigation?.evidenceDisclosure?.hidden !== false ||
    success?.claimInvestigation?.evidenceHover?.consistent !== true ||
    success?.claimInvestigation?.compactRows !== true ||
    success?.claimInvestigation?.rowCount !== EXPECTED_INVESTIGATION_ACTION_COUNT ||
    success?.claimInvestigation?.bulletList !== true ||
    success?.claimInvestigation?.sourceClaimsPresent !== true ||
    success?.claimInvestigation?.sourceFramingPresent !== true ||
    success?.claimInvestigation?.actionsBelowQuestion !== true ||
    success?.claimInvestigation?.compactActionProximity !== true ||
    success?.claimInvestigation?.manualStartPresent !== false ||
    success?.claimInvestigation?.originalClaimVisible !== false ||
    success?.claimInvestigation?.redundantLabelPresent !== false ||
    success?.claimInvestigation?.openedTargetOnPrepare !== false ||
    (success?.claimInvestigation?.links?.length ?? 0) !== 1
  ) {
    errors.push("Claim investigation synthetic action was not available and safely prepared");
  }
  const fallbackStates = success?.claimInvestigation?.fallbackStates;
  if (
    fallbackStates?.available !== true ||
    fallbackStates?.ineligible?.rowCount !== 0 ||
    fallbackStates?.ineligible?.sectionPresent !== false ||
    fallbackStates?.ineligible?.adapterIneligibleCount !== 1 ||
    fallbackStates?.ineligible?.batchStatus !== "ineligible" ||
    fallbackStates?.unavailable?.rowCount !== 0 ||
    fallbackStates?.unavailable?.sectionPresent !== false ||
    fallbackStates?.unavailable?.adapterUnavailableCount !== 1 ||
    fallbackStates?.unavailable?.batchStatus !== "unavailable"
  ) {
    errors.push("Claim investigation atomic fallback presentation was not fail-closed");
  }
  if (!claimActionPayloadContract(result).pass) {
    errors.push("Gemini AI Mode prompt did not preserve its safe metadata boundary");
  }
  errors.push(...assertWebFocusContinuity(success ?? {}));
  return errors;
}

async function auditUiOnly(extensionId, allowedBase) {
  const mockEndpoint = await startMockOpenAiEndpoint();
  let storageSnapshot;
  try {
    storageSnapshot = await configureScreenshotRecoveryAudit(extensionId, mockEndpoint.endpoint);
    const success = await runAuditPhase("ui-success", PHASE_TIMEOUT_MS.success, () =>
      auditSuccessfulRead(extensionId, allowedBase));
    return {
      success,
      mockEndpoint: mockEndpoint.endpoint.replace(/:\d+\/v1$/, ":<port>/v1"),
      mockRequests: mockEndpoint.requests.map((request) => ({
        kind: request.kind,
        hasImageUrl: request.hasImageUrl,
      })),
    };
  } finally {
    await restoreScreenshotRecoveryAudit(extensionId, storageSnapshot).catch(() => {});
    await mockEndpoint.close();
  }
}

function writeUiOnlySummary(result, errors) {
  const continuity = result.success?.continuity;
  const scenario = webFocusContinuitySummary(continuity);
  const lines = [
    "# General Page Reader UI Check",
    "",
    `- Result: ${errors.length === 0 ? "pass" : "fail"}`,
    `- Build: ${result.expectedBuildId}`,
    `- Web preserved: ${scenario.webPreserved}`,
    `- Focus preserved: ${scenario.focusPreserved}`,
    `- Typography aligned: ${scenario.typographyAligned}`,
    `- Focus action: ${scenario.focusAction}`,
    `- Side Panel focus states: ${scenario.documentFocusStates.join(", ")}`,
    "",
    "## Screenshots",
    "",
    `- ${relative(ROOT, resolve(OUT_DIR, "page-loading-initial.png"))}`,
    `- ${relative(ROOT, resolve(OUT_DIR, "page-analysis-running.png"))}`,
    `- ${relative(ROOT, resolve(OUT_DIR, "page-analysis-ready.png"))}`,
    result.success?.claimInvestigation?.preparingScreenshot
      ? `- ${result.success.claimInvestigation.preparingScreenshot}`
      : null,
    `- ${relative(ROOT, resolve(OUT_DIR, "page-claim-investigation.png"))}`,
    result.success?.claimInvestigation?.evidenceScreenshot
      ? `- ${result.success.claimInvestigation.evidenceScreenshot}`
      : null,
    ...(result.success?.claimInvestigation?.evidenceHover?.states ?? [])
      .map((state) => `- ${state.screenshot}`),
    `- ${relative(ROOT, resolve(OUT_DIR, "page-responsive-360.png"))}`,
    `- ${relative(ROOT, resolve(OUT_DIR, "page-responsive-430.png"))}`,
    `- ${relative(ROOT, resolve(OUT_DIR, "page-selection-target.png"))}`,
    `- ${relative(ROOT, resolve(OUT_DIR, "page-web-restored-after-focus.png"))}`,
    `- ${relative(ROOT, resolve(OUT_DIR, "page-focus-restored-after-web.png"))}`,
    "",
    "Synthetic pages and deterministic model responses only. Keep this tmp artifact private.",
  ];
  if (errors.length > 0) lines.push("", "## Errors", "", ...errors.map((error) => `- ${error}`));
  writeFileSync(resolve(OUT_DIR, "summary.md"), `${lines.join("\n")}\n`);
}

mkdirSync(OUT_DIR, { recursive: true });
const expectedBuildId = readExpectedBuildId();
const server = await startSyntheticServer();
let exitCode = 0;

try {
  const targets = await listTargets();
  const extension = await findTrulyExtension(targets, expectedBuildId, { allowStale: AUTO_RELOAD, extensionId: EXTENSION_ID });
  const extensionId = extension.meta.id;
  const runtimeTargets = await facebookTargetsWithContentScriptBuildIds(targets);
  const runtimeReload = await reloadStaleExtensionWithFacebookRecovery({
    autoReload: AUTO_RELOAD,
    expectedBuildId,
    liveBuildId: extension.meta.buildId,
    targets: runtimeTargets,
    reloadExtension: () => reloadExtension(extensionId),
    readExtensionBuildId: () => readExtensionBuildId(extensionId),
    reloadFacebookTarget,
    settleAfterFacebookReload: () => sleep(3500),
  });
  writeFileSync(resolve(OUT_DIR, "runtime-reload.json"), `${JSON.stringify(runtimeReload, null, 2)}\n`);
  const version = await currentVersion(extensionId);

  if (UI_ONLY) {
    const ui = await auditUiOnly(extensionId, server.allowedBase);
    const result = {
      capturedAt: new Date().toISOString(),
      mode: "ui-only",
      cdpBase: CDP_BASE,
      extensionId,
      expectedBuildId,
      version,
      runtimeReload,
      syntheticUrl: `${server.allowedBase}/article`,
      ...ui,
      artifactDir: relative(ROOT, OUT_DIR),
    };
    const errors = assertUiOnlyAudit(result);
    result.ok = errors.length === 0;
    result.errors = errors;
    writeFileSync(resolve(OUT_DIR, "audit.json"), `${JSON.stringify(result, null, 2)}\n`);
    writeUiOnlySummary(result, errors);
    console.log(`General Page Reader UI check ${result.ok ? "passed" : "failed"}`);
    console.log(`artifact: ${relative(ROOT, OUT_DIR)}`);
    if (!result.ok) exitCode = 1;
  } else {
    const mockEndpoint = await startMockOpenAiEndpoint();
    let storageSnapshot;
    try {
      storageSnapshot = await configureScreenshotRecoveryAudit(extensionId, mockEndpoint.endpoint);
      const result = {
        capturedAt: new Date().toISOString(),
        cdpBase: CDP_BASE,
        extensionId,
        expectedBuildId,
        version,
        runtimeReload,
        syntheticUrls: {
          allowed: `${server.allowedBase}/article`,
          popupRead: `${server.allowedBase}/article?popup=1`,
          screenshotRecovery: `${server.allowedBase}/screenshot-recovery`,
          noGrant: `${server.noGrantBase}/article`,
        },
        popup: await runAuditPhase("popup", PHASE_TIMEOUT_MS.popup, () =>
          auditPopup(extensionId, `${server.allowedBase}/article`)),
        popupRead: SKIP_POPUP_READ
          ? { skipped: true, reason: "TRULY_AUDIT_SKIP_POPUP_READ=1" }
          : await runAuditPhase("popup-read", PHASE_TIMEOUT_MS.popupRead, () =>
            auditPopupReadClick(extensionId, server.allowedBase)),
        success: await runAuditPhase("success", PHASE_TIMEOUT_MS.success, () =>
          auditSuccessfulRead(extensionId, server.allowedBase)),
        noisy: await runAuditPhase("noisy", PHASE_TIMEOUT_MS.noisy, () =>
          auditNoisyFallbackRead(extensionId, server.allowedBase)),
        candidate: await runAuditPhase("candidate", PHASE_TIMEOUT_MS.candidate, () =>
          auditCandidateBlockRecovery(extensionId, server.allowedBase)),
        teaser: await runAuditPhase("teaser", PHASE_TIMEOUT_MS.teaser, () =>
          auditTeaserHubOverview(extensionId, server.allowedBase)),
        screenshot: await runAuditPhase("screenshot-recovery", PHASE_TIMEOUT_MS.screenshot, () =>
          auditScreenshotRecovery(extensionId, server.allowedBase)),
        noGrant: await runAuditPhase("no-grant", PHASE_TIMEOUT_MS.noGrant, () =>
          auditNoGrantGuidance(extensionId, server.noGrantBase)),
        unsupportedPages: await runAuditPhase("unsupported-pages", PHASE_TIMEOUT_MS.unsupportedPages, () =>
          auditUnsupportedPageGuidance(extensionId)),
        storagePrivacy: await runAuditPhase("storage-privacy", PHASE_TIMEOUT_MS.storagePrivacy, () =>
          auditStoragePrivacy(extensionId)),
        mockEndpoint: mockEndpoint.endpoint.replace(/:\d+\/v1$/, ":<port>/v1"),
        mockRequests: mockEndpoint.requests.map((request) => ({
          kind: request.kind,
          hasImageUrl: request.hasImageUrl,
        })),
        artifactDir: relative(ROOT, OUT_DIR),
      };

      const errors = assertAudit(result);
      result.ok = errors.length === 0;
      result.errors = errors;
      writeFileSync(resolve(OUT_DIR, "audit.json"), JSON.stringify(result, null, 2));
      writeSummary(result, errors);
      console.log(`General Page Reader CDP audit ${result.ok ? "passed" : "failed"}`);
      console.log(`artifact: ${relative(ROOT, OUT_DIR)}`);
      if (!result.ok) exitCode = 1;
    } finally {
      await restoreScreenshotRecoveryAudit(extensionId, storageSnapshot).catch(() => {});
      await mockEndpoint.close();
    }
  }
} catch (error) {
  const failure = {
    capturedAt: new Date().toISOString(),
    cdpBase: CDP_BASE,
    expectedBuildId,
    error: error instanceof Error ? error.message : String(error),
    stack: error instanceof Error ? error.stack : undefined,
    artifactDir: relative(ROOT, OUT_DIR),
    phaseLog: relative(ROOT, PHASE_LOG_PATH),
  };
  writeFileSync(resolve(OUT_DIR, "audit-failure.json"), JSON.stringify(failure, null, 2));
  console.error(`General Page Reader CDP audit failed: ${failure.error}`);
  console.error(`artifact: ${relative(ROOT, OUT_DIR)}`);
  exitCode = 1;
} finally {
  await server.close();
}

process.exit(exitCode);
