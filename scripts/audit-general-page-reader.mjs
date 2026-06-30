#!/usr/bin/env node

import { createServer } from "node:http";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const DIST_BUILD_ID = resolve(ROOT, "dist", "build-id.txt");
const CDP_PORT = Number(process.env.CDP_PORT || 9222);
const CDP_BASE = `http://127.0.0.1:${CDP_PORT}`;
const AUTO_RELOAD = /^(1|true|yes)$/i.test(process.env.TRULY_AUDIT_AUTO_RELOAD || "");
const STAMP = new Date().toISOString().replace(/[:.]/g, "-");
const OUT_DIR = resolve(ROOT, "tmp", `general-page-reader-audit-${STAMP}`);

function usage() {
  console.log(`Usage: node scripts/audit-general-page-reader.mjs

Audits the General Page Reader flow in the existing Chrome CDP session.
Artifacts are written under tmp/ and must not be committed.

Environment:
  CDP_PORT=9222
  TRULY_AUDIT_AUTO_RELOAD=1   reload the loaded Truly extension before auditing
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
    async evaluate(expression, timeout = 10_000) {
      const result = await send("Runtime.evaluate", {
        expression,
        awaitPromise: true,
        returnByValue: true,
        timeout,
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
    async screenshot(path) {
      await send("Page.enable").catch(() => {});
      const result = await send("Page.captureScreenshot", {
        format: "png",
        fromSurface: true,
        captureBeyondViewport: true,
      });
      writeFileSync(path, Buffer.from(result.data, "base64"));
    },
    async closeTarget() {
      await send("Page.close").catch(() => {});
    },
    close() {
      ws.close();
    },
  };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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

async function startSyntheticServer() {
  const server = createServer((req, res) => {
    res.setHeader("content-type", "text/html; charset=utf-8");
    if (req.url?.startsWith("/article2")) {
      res.end(syntheticHtml("Second Synthetic Article", "This is a different synthetic article after a meaningful URL change."));
      return;
    }
    res.end(syntheticHtml("Synthetic General Page Reader Article", "This is a synthetic article for the General Page Reader CDP acceptance test."));
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
    close: () => new Promise((resolveClose) => server.close(resolveClose)),
  };
}

async function createTarget(url) {
  const target = await fetchJson(`${CDP_BASE}/json/new?${encodeURIComponent(url)}`, { method: "PUT" }, 5000);
  if (!target?.webSocketDebuggerUrl) throw new Error(`Unable to create CDP target for ${url}`);
  return target;
}

async function listTargets() {
  return fetchJson(`${CDP_BASE}/json/list`, {}, 5000).catch((error) => {
    throw new Error(`Unable to reach Chrome CDP at ${CDP_BASE}. Start Chrome with remote debugging. ${error.message}`);
  });
}

async function findTrulyExtension(targets, expectedBuildId) {
  const workers = targets.filter((target) =>
    target.type === "service_worker" &&
    typeof target.url === "string" &&
    target.url.startsWith("chrome-extension://") &&
    target.webSocketDebuggerUrl
  );

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
            url: location.href
          };
        } catch (error) {
          return { error: String(error) };
        }
      })()`).catch(() => null);
      if (meta?.name === "Truly" || target.url.includes("/background/service-worker.js")) {
        return { target, meta: { ...meta, expectedBuildId } };
      }
    } finally {
      cdp.close();
    }
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

async function openSidePanelTestPage(extensionId, activePageTarget, suffix) {
  const helperUrl = `chrome-extension://${extensionId}/options/options.html?generalPageReaderAuditHelper=${suffix}`;
  const helperTarget = await createTarget(helperUrl);
  const helper = connectCdp(helperTarget.webSocketDebuggerUrl);
  try {
    await sleep(300);
    const page = connectCdp(activePageTarget.webSocketDebuggerUrl);
    try {
      await page.send("Page.bringToFront");
    } finally {
      page.close();
    }
    const sideUrl = `chrome-extension://${extensionId}/sidepanel/sidepanel.html?generalPageReaderAudit=${suffix}`;
    await helper.evaluate(`new Promise((resolve) => {
      chrome.tabs.create({ url: ${JSON.stringify(sideUrl)}, active: false }, () => resolve(undefined));
    })`);
    await sleep(600);
    const target = (await listTargets()).find((entry) => entry.url?.startsWith(sideUrl));
    if (!target?.webSocketDebuggerUrl) throw new Error("Sidepanel audit target not found after chrome.tabs.create");
    return target;
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

async function auditPopup(extensionId, allowedUrl) {
  const popupTarget = await createTarget(`chrome-extension://${extensionId}/popup/popup.html?auditActiveUrl=${encodeURIComponent(allowedUrl)}`);
  const popup = connectCdp(popupTarget.webSocketDebuggerUrl);
  try {
    await sleep(800);
    const general = await popup.evaluateJson(`(() => ({
      title: document.querySelector('#readinessTitle')?.textContent?.trim(),
      detail: document.querySelector('#readinessDetail')?.textContent?.trim(),
      button: document.querySelector('#dashboardLabel')?.textContent?.trim(),
      disabled: document.querySelector('#dashboardLink')?.disabled ?? null
    }))()`);
    await popup.evaluate(`location.href = ${JSON.stringify(`chrome-extension://${extensionId}/popup/popup.html?auditActiveUrl=${encodeURIComponent("chrome://settings/")}`)}; undefined`);
    await sleep(800);
    const unsupported = await popup.evaluateJson(`(() => ({
      title: document.querySelector('#readinessTitle')?.textContent?.trim(),
      detail: document.querySelector('#readinessDetail')?.textContent?.trim(),
      button: document.querySelector('#dashboardLabel')?.textContent?.trim(),
      disabled: document.querySelector('#dashboardLink')?.disabled ?? null
    }))()`);
    return { general, unsupported };
  } finally {
    await popup.closeTarget().catch(() => {});
    popup.close();
  }
}

async function auditSuccessfulRead(extensionId, allowedBase) {
  const articleTarget = await createTarget(`${allowedBase}/article`);
  const sideTarget = await openSidePanelTestPage(extensionId, articleTarget, "success");
  const article = connectCdp(articleTarget.webSocketDebuggerUrl);
  const side = connectCdp(sideTarget.webSocketDebuggerUrl);

  try {
    await sleep(800);
    const initial = await side.evaluateJson(`(() => ({
      activeTab: document.querySelector('.tab[aria-selected="true"]')?.textContent?.trim(),
      pageText: document.querySelector('#page-pane')?.innerText,
      readDisabled: document.querySelector('#pageReadCurrent')?.disabled ?? null
    }))()`);

    await side.evaluate(`document.querySelector('#pageReadCurrent')?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })); undefined`);
    await waitFor(side, `(() => /已讀取|Ready/.test(document.querySelector('#page-pane')?.innerText || ''))()`, 8000, "Page/Web ready state");

    const ready = await side.evaluateJson(`(() => {
      const pane = document.querySelector('#page-pane');
      return {
        activeTab: document.querySelector('.tab[aria-selected="true"]')?.textContent?.trim(),
        status: pane?.querySelector('.page-reader-status-label')?.textContent?.trim(),
        detail: pane?.querySelector('.page-reader-status-detail')?.textContent?.trim(),
        title: pane?.querySelector('.page-reader-title-block h2')?.textContent?.trim(),
        excerpt: pane?.querySelector('.page-reader-excerpt')?.textContent?.trim(),
        meta: [...pane?.querySelectorAll('.page-reader-meta div') || []].map((el) => ({
          label: el.querySelector('dt')?.textContent?.trim(),
          value: el.querySelector('dd')?.textContent?.trim()
        })),
        fullTailVisible: /quick brown test page explains a public planning process/.test(pane?.innerText || ''),
        copyButton: pane?.querySelector('#pageCopyMetadata')?.textContent?.trim()
      };
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
      Object.defineProperty(navigator, 'clipboard', { configurable: true, value: original });
      return JSON.stringify({
        buttonText: document.querySelector('#pageCopyMetadata')?.textContent?.trim(),
        hasTitle: /Title: Synthetic General Page Reader Article/.test(copied),
        hasUrl: /URL: http:\\/\\/127\\.0\\.0\\.1:/.test(copied),
        hasExcerpt: /Excerpt:/.test(copied),
        hasFullTail: /quick brown test page explains a public planning process/.test(copied),
        length: copied.length
      });
    })()`);
    const copy = JSON.parse(copyRaw);

    await article.evaluate(`location.href = ${JSON.stringify(`${allowedBase}/article#comments`)}; undefined`);
    await sleep(500);
    const afterHash = await side.evaluateJson(`(() => ({
      status: document.querySelector('#page-pane .page-reader-status-label')?.textContent?.trim(),
      stale: /頁面已變更|Page changed/.test(document.querySelector('#page-pane')?.innerText || '')
    }))()`);

    await article.evaluate(`location.href = ${JSON.stringify(`${allowedBase}/article?utm_source=cdp&fbclid=abc`)}; undefined`);
    await sleep(500);
    const afterTracking = await side.evaluateJson(`(() => ({
      status: document.querySelector('#page-pane .page-reader-status-label')?.textContent?.trim(),
      stale: /頁面已變更|Page changed/.test(document.querySelector('#page-pane')?.innerText || '')
    }))()`);

    await article.evaluate(`location.href = ${JSON.stringify(`${allowedBase}/article2`)}; undefined`);
    await sleep(800);
    const afterMeaningful = await side.evaluateJson(`(() => ({
      status: document.querySelector('#page-pane .page-reader-status-label')?.textContent?.trim(),
      detail: document.querySelector('#page-pane .page-reader-status-detail')?.textContent?.trim(),
      stale: /頁面已變更|Page changed/.test(document.querySelector('#page-pane')?.innerText || '')
    }))()`);

    await side.screenshot(resolve(OUT_DIR, "page-ready-and-stale.png"));

    return { initial, ready, copy, afterHash, afterTracking, afterMeaningful };
  } finally {
    await side.closeTarget().catch(() => {});
    await article.closeTarget().catch(() => {});
    side.close();
    article.close();
  }
}

async function auditNoGrantGuidance(extensionId, noGrantBase) {
  const articleTarget = await createTarget(`${noGrantBase}/article`);
  const sideTarget = await openSidePanelTestPage(extensionId, articleTarget, "no-grant");
  const side = connectCdp(sideTarget.webSocketDebuggerUrl);
  const article = connectCdp(articleTarget.webSocketDebuggerUrl);
  try {
    await sleep(800);
    await side.evaluate(`document.querySelector('#pageReadCurrent')?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })); undefined`);
    await sleep(700);
    await side.screenshot(resolve(OUT_DIR, "page-no-grant.png"));
    return await side.evaluateJson(`(() => ({
      status: document.querySelector('#page-pane .page-reader-status-label')?.textContent?.trim(),
      detail: document.querySelector('#page-pane .page-reader-status-detail')?.textContent?.trim(),
      error: document.querySelector('#page-pane .page-reader-error')?.textContent?.trim(),
      hasGuidance: /工具列圖示|toolbar icon/.test(document.querySelector('#page-pane')?.innerText || '')
    }))()`);
  } finally {
    await side.closeTarget().catch(() => {});
    await article.closeTarget().catch(() => {});
    side.close();
    article.close();
  }
}

async function waitFor(cdp, expression, timeoutMs, label) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (await cdp.evaluate(expression).catch(() => false)) return;
    await sleep(150);
  }
  throw new Error(`Timed out waiting for ${label}`);
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
  if (result.popup.unsupported.disabled !== true) {
    errors.push("popup unsupported state is not disabled");
  }
  if (result.success.ready.status !== "已讀取" && result.success.ready.status !== "Ready") {
    errors.push(`successful read did not reach ready status: ${result.success.ready.status}`);
  }
  if (result.success.ready.title !== "Synthetic General Page Reader Article") {
    errors.push(`unexpected extracted title: ${result.success.ready.title}`);
  }
  if (result.success.ready.fullTailVisible) {
    errors.push("Page/Web pane includes the full synthetic body tail");
  }
  if (!result.success.copy.hasTitle || !result.success.copy.hasUrl || !result.success.copy.hasExcerpt || result.success.copy.hasFullTail) {
    errors.push("copy metadata boundary failed");
  }
  if (result.success.afterHash.stale) errors.push("hash-only URL change incorrectly marked stale");
  if (result.success.afterTracking.stale) errors.push("tracking-only query change incorrectly marked stale");
  if (!result.success.afterMeaningful.stale) errors.push("meaningful URL change did not mark stale");
  if (!result.noGrant.hasGuidance) errors.push("no-grant sidepanel path did not show toolbar activation guidance");
  return errors;
}

function writeSummary(result, errors) {
  const lines = [
    "# General Page Reader CDP Audit",
    "",
    `- Captured at: ${result.capturedAt}`,
    `- Expected buildId: ${result.expectedBuildId}`,
    `- Live buildId: ${result.version?.buildId || "(missing)"}`,
    `- Verdict: ${errors.length === 0 ? "PASS" : "FAIL"}`,
    "",
    "## Checks",
    "",
    `- Popup general page: ${result.popup.general.button} / disabled=${result.popup.general.disabled}`,
    `- Popup unsupported page disabled: ${result.popup.unsupported.disabled}`,
    `- Page/Web read status: ${result.success.ready.status}`,
    `- Hash-only stale: ${result.success.afterHash.stale}`,
    `- Tracking-only stale: ${result.success.afterTracking.stale}`,
    `- Meaningful URL stale: ${result.success.afterMeaningful.stale}`,
    `- Copy metadata title/url/excerpt: ${result.success.copy.hasTitle}/${result.success.copy.hasUrl}/${result.success.copy.hasExcerpt}`,
    `- No-grant guidance: ${result.noGrant.hasGuidance}`,
    "",
    "## Artifacts",
    "",
    `- ${relative(ROOT, resolve(OUT_DIR, "audit.json"))}`,
    `- ${relative(ROOT, resolve(OUT_DIR, "page-ready-and-stale.png"))}`,
    `- ${relative(ROOT, resolve(OUT_DIR, "page-no-grant.png"))}`,
    "",
    "## Public Repo Boundary",
    "",
    "This artifact uses synthetic local pages only. Screenshots and JSON still live under tmp/ and must not be committed.",
    "",
  ];
  if (errors.length > 0) {
    lines.push("## Errors", "", ...errors.map((error) => `- ${error}`), "");
  }
  writeFileSync(resolve(OUT_DIR, "summary.md"), `${lines.join("\n")}\n`);
}

mkdirSync(OUT_DIR, { recursive: true });
const expectedBuildId = readExpectedBuildId();
const server = await startSyntheticServer();

try {
  const targets = await listTargets();
  const extension = await findTrulyExtension(targets, expectedBuildId);
  const extensionId = extension.meta.id;
  if (AUTO_RELOAD) await reloadExtension(extensionId);
  const version = await currentVersion(extensionId);

  const result = {
    capturedAt: new Date().toISOString(),
    cdpBase: CDP_BASE,
    extensionId,
    expectedBuildId,
    version,
    syntheticUrls: {
      allowed: `${server.allowedBase}/article`,
      noGrant: `${server.noGrantBase}/article`,
    },
    popup: await auditPopup(extensionId, `${server.allowedBase}/article`),
    success: await auditSuccessfulRead(extensionId, server.allowedBase),
    noGrant: await auditNoGrantGuidance(extensionId, server.noGrantBase),
    artifactDir: relative(ROOT, OUT_DIR),
  };

  const errors = assertAudit(result);
  result.ok = errors.length === 0;
  result.errors = errors;
  writeFileSync(resolve(OUT_DIR, "audit.json"), JSON.stringify(result, null, 2));
  writeSummary(result, errors);
  console.log(`General Page Reader CDP audit ${result.ok ? "passed" : "failed"}`);
  console.log(`artifact: ${relative(ROOT, OUT_DIR)}`);
  if (!result.ok) process.exit(1);
} finally {
  await server.close();
}
