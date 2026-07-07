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
const SKIP_POPUP_READ = /^(1|true|yes)$/i.test(process.env.TRULY_AUDIT_SKIP_POPUP_READ || "");
const EXTENSION_ID = (process.env.TRULY_EXTENSION_ID || "").trim();
const STAMP = new Date().toISOString().replace(/[:.]/g, "-");
const OUT_DIR = resolve(ROOT, "tmp", `general-page-reader-audit-${STAMP}`);
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
const auditPhaseLog = [];

function usage() {
  console.log(`Usage: node scripts/audit-general-page-reader.mjs

Audits the General Page Reader flow in the existing Chrome CDP session.
Artifacts are written under tmp/ and must not be committed.

Environment:
  CDP_PORT=9222
  TRULY_AUDIT_AUTO_RELOAD=1   reload the loaded Truly extension before auditing
  TRULY_AUDIT_SKIP_POPUP_READ=1
                               skip the real chrome.action.openPopup read-click path
                               when the host OS cannot provide an active browser window
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
    const { resolve, reject, timer } = pending.get(message.id);
    pending.delete(message.id);
    clearTimeout(timer);
    if (message.error) reject(new Error(message.error.message ?? JSON.stringify(message.error)));
    else resolve(message.result);
  });

  async function send(method, params = {}, timeoutMs = CDP_COMMAND_TIMEOUT_MS) {
    await opened;
    const id = nextId++;
    const response = new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`CDP command timed out: ${method} after ${timeoutMs}ms`));
      }, timeoutMs);
      pending.set(id, { resolve, reject, timer });
    });
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
      }, Math.max(timeout + 1000, 3000));
      if (result.exceptionDetails) {
        throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text || "Runtime.evaluate failed");
      }
      return result.result?.value ?? null;
    },
    async evaluateJson(expression) {
      const raw = await this.evaluate(`(async () => JSON.stringify(await (${expression})))()`);
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
    async setViewport(width, height) {
      await send("Emulation.setDeviceMetricsOverride", {
        width,
        height,
        deviceScaleFactor: 1,
        mobile: false,
      });
    },
    async clearViewport() {
      await send("Emulation.clearDeviceMetricsOverride").catch(() => {});
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
    const kind = /parser recovery classifier/i.test(systemText)
      ? "parser-advisor"
      : hasImageUrl
      ? "screenshot-brief"
      : /dominant color/i.test(systemText)
      ? "vision-probe"
      : "brief";
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
      content = JSON.stringify({
        schemaVersion: 1,
        pageType: "app_shell",
        decision: "request_screenshot_region",
        confidence: "medium",
        needsUserSelection: false,
        needsScreenshot: true,
        riskTags: ["needs_visual_grounding"],
        rationale: "The synthetic fixture needs visible screenshot grounding.",
      });
    } else {
      content = JSON.stringify({
        schemaVersion: 1,
        summary: "Screenshot-grounded synthetic summary.",
        bg: [{ t: "Visual context", why: "The confirmed screenshot was included." }],
        claims: [{ c: "The page needs visual grounding.", why: "The text extraction was too sparse.", need: "Use the confirmed screenshot." }],
        qs: [{ q: "What does the visible card show?", kind: "understand" }],
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
      res.end(syntheticHtml("Third Synthetic Article", "This is a third synthetic article for multi-session Page/Web switching."));
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
    close: () => new Promise((resolveClose) => {
      server.close(resolveClose);
      server.closeIdleConnections?.();
      server.closeAllConnections?.();
    }),
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
  const activePage = connectCdp(activePageTarget.webSocketDebuggerUrl);
  try {
    await sleep(300);
    await activePage.send("Page.bringToFront");
    const tabFocus = await helper.evaluateJson(`(async () => {
      const targetUrl = ${JSON.stringify(activePageTarget.url || "")};
      const tabs = await new Promise((resolve) => chrome.tabs.query({}, resolve));
      const tab = tabs.find((candidate) => candidate.url === targetUrl) ||
        tabs.find((candidate) => targetUrl && candidate.url?.startsWith(targetUrl));
      if (!tab?.id) return { ok: false, reason: "tab_not_found", targetUrl };
      await new Promise((resolve) => chrome.tabs.update(tab.id, { active: true }, () => resolve(undefined)));
      if (typeof tab.windowId === "number") {
        await new Promise((resolve) => chrome.windows.update(tab.windowId, { focused: true }, () => resolve(undefined)));
      }
      return {
        ok: true,
        tabId: tab.id,
        windowId: tab.windowId,
        tabError: chrome.runtime.lastError?.message || "",
      };
    })()`).catch((error) => ({ ok: false, reason: error.message }));
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
    activePage.close();
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
    await waitFor(side, `(() => Boolean(document.querySelector('#pageScreenshotCapture')))()`, 18000, "Page/Web screenshot offer").catch(async (error) => {
      await side.screenshot(resolve(OUT_DIR, "page-screenshot-offer-timeout.png")).catch(() => {});
      throw error;
    });
    const offer = await side.evaluateJson(`(() => {
      const pane = document.querySelector('#page-pane');
      const screenshot = pane?.querySelector('.page-reader-screenshot');
      const advisor = pane?.querySelector('.page-reader-advisor');
      return {
        text: screenshot?.textContent?.replace(/\\s+/g, ' ').trim() || '',
        state: screenshot?.getAttribute('data-state') || null,
        hasCaptureButton: Boolean(document.querySelector('#pageScreenshotCapture')),
        hasPreview: Boolean(document.querySelector('.page-reader-screenshot-preview')),
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
    })()`, 8000, "Page/Web screenshot tab activation").catch(async (error) => {
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

    await side.evaluate(`document.querySelector('#pageScreenshotCapture')?.click(); undefined`);
    const captureClickState = await side.evaluateJson(`(async () => {
      const button = document.querySelector('#pageScreenshotCapture');
      await new Promise((resolve) => setTimeout(resolve, 700));
      const screenshot = document.querySelector('.page-reader-screenshot');
      return {
        clicked: Boolean(button),
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
      return Boolean(img?.getAttribute('src')?.startsWith('data:image/')) &&
        Boolean(document.querySelector('#pageScreenshotConfirm')) &&
        Boolean(document.querySelector('#pageScreenshotCancel'));
    })()`, 12000, "Page/Web screenshot preview").catch(async (error) => {
      writeFileSync(resolve(OUT_DIR, "page-screenshot-preview-timeout.json"), JSON.stringify(captureClickState, null, 2));
      await side.screenshot(resolve(OUT_DIR, "page-screenshot-preview-timeout.png")).catch(() => {});
      throw error;
    });
    const preview = await side.evaluateJson(`(() => {
      const img = document.querySelector('.page-reader-screenshot-preview');
      return {
        state: document.querySelector('.page-reader-screenshot')?.getAttribute('data-state') || null,
        imgSrcPrefix: img?.getAttribute('src')?.slice(0, 32) || '',
        hasConfirmButton: Boolean(document.querySelector('#pageScreenshotConfirm')),
        hasCancelButton: Boolean(document.querySelector('#pageScreenshotCancel')),
        explanation: document.querySelector('.page-reader-screenshot')?.textContent?.replace(/\\s+/g, ' ').trim() || ''
      };
    })()`);
    await side.screenshot(resolve(OUT_DIR, "page-screenshot-preview.png"));

    await side.evaluate(`document.querySelector('#pageScreenshotConfirm')?.click(); undefined`);
    await waitFor(side, `(() => /Screenshot-grounded synthetic summary|截圖/.test(document.querySelector('#page-pane')?.innerText || '') && !document.querySelector('.page-reader-screenshot-preview'))()`, 18000, "Page/Web screenshot confirmed brief").catch(async (error) => {
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
      status: document.querySelector('#page-pane .page-reader-status-label')?.textContent?.trim(),
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
    await waitFor(side, `(() => /Synthetic General Page Reader Article/.test(document.querySelector('#page-pane')?.innerText || ''))()`, 8000, "popup-triggered Page/Web replay")
      .catch(async (error) => {
        await capturePopupReadTimeoutState(popup, side, article, before, initialSide, "replay");
        throw error;
      });
    await waitFor(side, `(() => /已讀取|Ready/.test(document.querySelector('#page-pane .page-reader-status-label')?.textContent || ''))()`, 8000, "popup-triggered Page/Web ready status")
      .catch(async (error) => {
        await capturePopupReadTimeoutState(popup, side, article, before, initialSide, "ready");
        throw error;
      });
    await side.screenshot(resolve(OUT_DIR, "page-popup-read-result.png"));
    const sideState = await side.evaluateJson(`(() => ({
      activeTab: document.querySelector('.tab[aria-selected="true"]')?.textContent?.trim(),
      status: document.querySelector('#page-pane .page-reader-status-label')?.textContent?.trim(),
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
      status: document.querySelector('#page-pane .page-reader-status-label')?.textContent?.trim(),
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
      await waitFor(side, `(() => /已讀取|Ready/.test(document.querySelector('#page-pane')?.innerText || ''))()`, 8000, "Page/Web auto-read ready state")
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
    await waitFor(side, `(() => /已讀取|Ready/.test(document.querySelector('#page-pane')?.innerText || ''))()`, 8000, "Page/Web ready state").catch(async (error) => {
      const timeoutState = await capturePageReadTimeoutState(side, article, initial).catch((captureError) => ({
        initial,
        captureError: captureError.message,
      }));
      await side.screenshot(resolve(OUT_DIR, "page-ready-timeout.png")).catch(() => {});
      writeFileSync(resolve(OUT_DIR, "page-ready-timeout.json"), JSON.stringify(timeoutState, null, 2));
      error.message = `${error.message}; diagnostics: ${relative(ROOT, resolve(OUT_DIR, "page-ready-timeout.json"))}`;
      throw error;
    });
    await waitFor(side, `(() => /分析範圍|Analysis scope/.test(document.querySelector('#page-pane .page-reader-advisor')?.textContent || ''))()`, 8000, "Page/Web analysis scope").catch(async (error) => {
      await side.screenshot(resolve(OUT_DIR, "page-ready-advisor-timeout.png")).catch(() => {});
      throw error;
    });

    const ready = await side.evaluateJson(`(() => {
      const pane = document.querySelector('#page-pane');
      const advisor = pane?.querySelector('.page-reader-advisor');
      return {
        activeTab: document.querySelector('.tab[aria-selected="true"]')?.textContent?.trim(),
        status: pane?.querySelector('.page-reader-status-label')?.textContent?.trim(),
        statusTitle: pane?.querySelector('.page-reader-status')?.getAttribute('title') || '',
        statusAriaLabel: pane?.querySelector('.page-reader-status')?.getAttribute('aria-label') || '',
        detail: pane?.querySelector('.page-reader-status-detail')?.textContent?.trim(),
        title: pane?.querySelector('.page-reader-title-block h2')?.textContent?.trim(),
        excerpt: pane?.querySelector('.page-reader-excerpt')?.textContent?.trim(),
        meta: [...pane?.querySelectorAll('.page-reader-meta div') || []].map((el) => ({
          label: el.querySelector('dt')?.textContent?.trim(),
          value: el.querySelector('dd')?.textContent?.trim()
        })),
        extractionDiagnosticsOpen: pane?.querySelector('.page-reader-extraction-diagnostics')?.hasAttribute('open') ?? null,
        modelContext: (() => {
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
        advisor: advisor ? {
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
        sourceLinks: [...pane?.querySelectorAll('.page-reader-source-links a') || []].map((el) => ({
          label: el.textContent?.trim(),
          href: el.href
        })),
        fullTailVisible: /quick brown test page explains a public planning process/.test(pane?.innerText || ''),
        copyButton: pane?.querySelector('#pageCopyMetadata')?.textContent?.trim()
      };
    })()`);

    const pageBrief = await observePageBrief(side, "page-analysis-ready.png");
    const responsive = await auditResponsivePageWebLayout(side, "page-responsive-430.png");

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

    const secondArticleTarget = await createTarget(`${allowedBase}/article2?multi=1`);
    secondArticle = connectCdp(secondArticleTarget.webSocketDebuggerUrl);
    await secondArticle.send("Page.bringToFront");
    await sleep(600);
    await side.evaluate(`document.querySelector('#pageReadCurrent')?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })); undefined`);
    await waitFor(side, `(() => /Second Synthetic Article/.test(document.querySelector('#page-pane')?.innerText || ''))()`, 8000, "Page/Web second session ready").catch(async (error) => {
      await side.screenshot(resolve(OUT_DIR, "page-session-switcher-second-timeout.png")).catch(() => {});
      throw error;
    });
    const switcherSecond = await side.evaluateJson(`(() => ({
      text: document.querySelector('#page-pane')?.innerText || '',
      sessionCount: document.querySelectorAll('[data-page-session-tab-id]').length,
      selectionDisabled: document.querySelector('#pageReadSelection')?.disabled ?? null,
      activeState: globalThis.__trulyPageReadingRuntime?.auditState?.() || null
    }))()`);
    const thirdArticleTarget = await createTarget(`${allowedBase}/article3?multi=1`);
    thirdArticle = connectCdp(thirdArticleTarget.webSocketDebuggerUrl);
    await thirdArticle.send("Page.bringToFront");
    await sleep(600);
    await side.evaluate(`document.querySelector('#pageReadCurrent')?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })); undefined`);
    await waitFor(side, `(() => /Third Synthetic Article/.test(document.querySelector('#page-pane')?.innerText || ''))()`, 8000, "Page/Web third session ready").catch(async (error) => {
      await side.screenshot(resolve(OUT_DIR, "page-session-switcher-third-timeout.png")).catch(() => {});
      throw error;
    });
    const switcherThird = await side.evaluateJson(`(() => ({
      text: document.querySelector('#page-pane')?.innerText || '',
      sessionCount: document.querySelectorAll('[data-page-session-tab-id]').length,
      selectionDisabled: document.querySelector('#pageReadSelection')?.disabled ?? null,
      activeState: globalThis.__trulyPageReadingRuntime?.auditState?.() || null
    }))()`);
    const clickedSavedTabId = await side.evaluate(`(() => {
      const activeTabId = globalThis.__trulyPageReadingRuntime?.auditState?.()?.activeTabId;
      const button = Array.from(document.querySelectorAll('[data-page-session-tab-id]'))
        .find((item) => Number(item.dataset.pageSessionTabId) !== activeTabId && /Synthetic General Page/.test(item.textContent || '')) ||
        Array.from(document.querySelectorAll('[data-page-session-tab-id]'))
          .find((item) => Number(item.dataset.pageSessionTabId) !== activeTabId);
      button?.click();
      return button ? Number(button.dataset.pageSessionTabId) : null;
    })()`);
    await waitFor(side, `(() => {
      const title = document.querySelector('#page-pane .page-reader-title-block h2')?.textContent || '';
      const state = globalThis.__trulyPageReadingRuntime?.auditState?.() || {};
      const selectedChip = document.querySelector('[data-page-session-tab-id].is-selected');
      const ready = /Synthetic General Page Reader Article/.test(title) &&
        Boolean(document.querySelector('#pageActivateDisplayedTab')) &&
        state.displayTabId === ${JSON.stringify(clickedSavedTabId)} &&
        state.activeTabId !== state.displayTabId &&
        selectedChip &&
        Number(selectedChip.dataset.pageSessionTabId) === state.displayTabId &&
        !selectedChip.classList.contains('is-live');
      if (!ready) return false;
      globalThis.__trulySwitcherDisplayAudit = {
        text: document.querySelector('#page-pane')?.innerText || '',
        sessionCount: document.querySelectorAll('[data-page-session-tab-id]').length,
        pageTitle: title.trim() || null,
        selectionDisabled: document.querySelector('#pageReadSelection')?.disabled ?? null,
        hasActivateButton: Boolean(document.querySelector('#pageActivateDisplayedTab')),
        chips: Array.from(document.querySelectorAll('[data-page-session-tab-id]')).map((item) => ({
          tabId: Number(item.dataset.pageSessionTabId),
          className: item.className,
          text: item.textContent?.trim() || ''
        })),
        activeState: state
      };
      return true;
    })()`, 8000, "Page/Web saved session display").catch(async (error) => {
      const timeoutStateRaw = await side.evaluate(`(async () => {
        const diagnostics = await new Promise((resolve) => {
          chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            const activeTab = tabs?.[0] || null;
            resolve({
              clickedSavedTabId: ${JSON.stringify(clickedSavedTabId)},
              runtimeState: globalThis.__trulyPageReadingRuntime?.auditState?.() || null,
              chromeActiveTab: activeTab ? { id: activeTab.id, url: activeTab.url, title: activeTab.title, active: activeTab.active } : null,
              pageTitle: document.querySelector('#page-pane .page-reader-title-block h2')?.textContent?.trim() || null,
              selectionDisabled: document.querySelector('#pageReadSelection')?.disabled ?? null,
              hasActivateButton: Boolean(document.querySelector('#pageActivateDisplayedTab')),
              chips: Array.from(document.querySelectorAll('[data-page-session-tab-id]')).map((item) => ({
                tabId: Number(item.dataset.pageSessionTabId),
                className: item.className,
                text: item.textContent?.trim() || ''
              }))
            });
          });
        });
        return JSON.stringify(diagnostics);
      })()`).catch((captureError) => JSON.stringify({ captureError: captureError.message }));
      writeFileSync(resolve(OUT_DIR, "page-session-switcher-display-timeout.json"), timeoutStateRaw);
      await side.screenshot(resolve(OUT_DIR, "page-session-switcher-display-timeout.png")).catch(() => {});
      throw error;
    });
    const switcherDisplay = await side.evaluateJson(`(() => globalThis.__trulySwitcherDisplayAudit || null)()`);
    writeFileSync(resolve(OUT_DIR, "page-session-switcher-display.json"), JSON.stringify(switcherDisplay, null, 2));
    await side.screenshot(resolve(OUT_DIR, "page-session-switcher-display.png")).catch(() => {});
    await side.evaluate(`document.querySelector('#pageActivateDisplayedTab')?.click(); undefined`);
    await waitFor(side, `(() => {
      const title = document.querySelector('#page-pane .page-reader-title-block h2')?.textContent || '';
      const state = globalThis.__trulyPageReadingRuntime?.auditState?.() || {};
      return /Synthetic General Page Reader Article/.test(title) &&
        document.querySelector('#pageReadSelection')?.disabled === false &&
        state.activeTabId === state.displayTabId;
    })()`, 8000, "Page/Web saved session activation").catch(async (error) => {
      const timeoutStateRaw = await side.evaluate(`(async () => {
        const diagnostics = await new Promise((resolve) => {
          chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            const activeTab = tabs?.[0] || null;
            resolve({
            clickedSavedTabId: ${JSON.stringify(clickedSavedTabId)},
            runtimeState: globalThis.__trulyPageReadingRuntime?.auditState?.() || null,
            chromeActiveTab: activeTab ? { id: activeTab.id, url: activeTab.url, title: activeTab.title, active: activeTab.active } : null,
            pageTitle: document.querySelector('#page-pane .page-reader-title-block h2')?.textContent?.trim() || null,
            selectionDisabled: document.querySelector('#pageReadSelection')?.disabled ?? null,
            hasActivateButton: Boolean(document.querySelector('#pageActivateDisplayedTab')),
            chips: Array.from(document.querySelectorAll('[data-page-session-tab-id]')).map((item) => ({
              tabId: Number(item.dataset.pageSessionTabId),
              className: item.className,
              text: item.textContent?.trim() || ''
            }))
          });
        });
        });
        return JSON.stringify(diagnostics);
      })()`).catch((captureError) => JSON.stringify({ captureError: captureError.message }));
      const timeoutState = JSON.parse(timeoutStateRaw);
      writeFileSync(resolve(OUT_DIR, "page-session-switcher-activate-timeout.json"), JSON.stringify(timeoutState, null, 2));
      await side.screenshot(resolve(OUT_DIR, "page-session-switcher-activate-timeout.png")).catch(() => {});
      throw error;
    });
    const switcherActivated = await side.evaluateJson(`(() => ({
      text: document.querySelector('#page-pane')?.innerText || '',
      selectionDisabled: document.querySelector('#pageReadSelection')?.disabled ?? null,
      hasActivateButton: Boolean(document.querySelector('#pageActivateDisplayedTab')),
      activeState: globalThis.__trulyPageReadingRuntime?.auditState?.() || null
    }))()`);

    const selectedText = await article.evaluate(`(() => {
      const paragraph = document.querySelector('article p:nth-of-type(3)');
      const range = document.createRange();
      range.selectNodeContents(paragraph);
      const selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
      return selection.toString().replace(/\\s+/g, ' ').trim();
    })()`);
    const selectionBeforeAction = await side.evaluateJson(`(() => {
      const pane = document.querySelector('#page-pane');
      const model = pane?.querySelector('.page-reader-model-context');
      const rows = [...model?.querySelectorAll('dl div') || []].map((row) => ({
        label: row.querySelector('dt')?.textContent?.trim(),
        value: row.querySelector('dd')?.textContent?.trim(),
        rawValue: row.querySelector('dd')?.getAttribute('data-raw-value') || row.querySelector('dd')?.textContent?.trim()
      }));
      return {
        excerpt: pane?.querySelector('.page-reader-excerpt')?.textContent?.trim(),
        selectionDisabled: document.querySelector('#pageReadSelection')?.disabled ?? null,
        targetKind: rows.find((row) => /targetKind|目標|Target/.test(row.label || ''))?.rawValue || null,
      };
    })()`);
    await side.evaluate(`document.querySelector('#pageReadSelection')?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })); undefined`);
    await waitFor(side, `(() => {
      const model = document.querySelector('#page-pane .page-reader-model-context');
      const rows = [...model?.querySelectorAll('dl div') || []].map((row) => ({
        label: row.querySelector('dt')?.textContent?.trim(),
        value: row.querySelector('dd')?.textContent?.trim(),
            rawValue: row.querySelector('dd')?.getAttribute('data-raw-value') || row.querySelector('dd')?.textContent?.trim()
      }));
      return rows.some((row) => /targetKind|目標|Target/.test(row.label || '') && (row.rawValue || row.value) === 'selection');
    })()`, 10000, "Page/Web selection target").catch(async (error) => {
      await side.screenshot(resolve(OUT_DIR, "page-selection-timeout.png")).catch(() => {});
      throw error;
    });
    const selection = await side.evaluateJson(`(() => {
      const pane = document.querySelector('#page-pane');
      const model = pane?.querySelector('.page-reader-model-context');
      const advisor = pane?.querySelector('.page-reader-advisor');
      return {
        excerpt: pane?.querySelector('.page-reader-excerpt')?.textContent?.trim(),
        modelRows: [...model?.querySelectorAll('dl div') || []].map((row) => ({
          label: row.querySelector('dt')?.textContent?.trim(),
          value: row.querySelector('dd')?.textContent?.trim(),
            rawValue: row.querySelector('dd')?.getAttribute('data-raw-value') || row.querySelector('dd')?.textContent?.trim()
        })),
        advisorRows: [...advisor?.querySelectorAll('dl div') || []].map((row) => ({
          label: row.querySelector('dt')?.textContent?.trim(),
          value: row.querySelector('dd')?.textContent?.trim(),
            rawValue: row.querySelector('dd')?.getAttribute('data-raw-value') || row.querySelector('dd')?.textContent?.trim()
        })),
        advisorStatus: advisor?.querySelector('.page-reader-advisor-header span')?.textContent?.trim(),
      };
    })()`);
    await side.screenshot(resolve(OUT_DIR, "page-selection-target.png"));

    // Slice 6b: current-region hotkey flow. Simulate pointer movement over a
    // paragraph, then set the same session marker the SW command handler
    // writes; the panel consumes it and requests a point target.
    const pointerTab = await side.evaluateJson(`(() => globalThis.__trulyPageReadingRuntime?.auditState?.() || { activeTabId: null })()`);
    if (typeof pointerTab.activeTabId !== "number") {
      throw new Error("Unable to resolve synthetic article tab id for current-region audit");
    }
    await article.evaluate(`(() => {
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
      const model = document.querySelector('#page-pane .page-reader-model-context');
      const advisor = document.querySelector('#page-pane .page-reader-advisor');
      const advisorStatus = advisor?.querySelector('.page-reader-advisor-header span')?.textContent?.trim() || '';
      const rows = [...model?.querySelectorAll('dl div') || []].map((row) => ({
        label: row.querySelector('dt')?.textContent?.trim(),
        value: row.querySelector('dd')?.textContent?.trim(),
            rawValue: row.querySelector('dd')?.getAttribute('data-raw-value') || row.querySelector('dd')?.textContent?.trim()
      }));
      return rows.some((row) => /targetKind|目標|Target/.test(row.label || '') && (row.rawValue || row.value) === 'current-region') &&
        Boolean(advisor) &&
        !/檢查中|Checking/.test(advisorStatus);
    })()`, 16000, "Page/Web current-region target").catch(async (error) => {
      await side.screenshot(resolve(OUT_DIR, "page-point-target-timeout.png")).catch(() => {});
      throw error;
    });
    const pointTarget = await side.evaluateJson(`(() => {
      const pane = document.querySelector('#page-pane');
      const model = pane?.querySelector('.page-reader-model-context');
      const advisor = pane?.querySelector('.page-reader-advisor');
      const modelRows = [...model?.querySelectorAll('dl div') || []].map((row) => ({
        label: row.querySelector('dt')?.textContent?.trim(),
        value: row.querySelector('dd')?.textContent?.trim(),
            rawValue: row.querySelector('dd')?.getAttribute('data-raw-value') || row.querySelector('dd')?.textContent?.trim()
      }));
      return {
        targetKind: modelRows.find((row) => /targetKind|目標|Target/.test(row.label || ''))?.rawValue,
        targetKindLabel: modelRows.find((row) => /targetKind|目標|Target/.test(row.label || ''))?.value,
        advisorStatus: advisor?.querySelector('.page-reader-advisor-header span')?.textContent?.trim(),
        excerpt: pane?.querySelector('.page-reader-excerpt')?.textContent?.trim(),
      };
    })()`);
    await side.screenshot(resolve(OUT_DIR, "page-point-target.png"));

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
      stale: /頁面已變更|Page changed/.test(document.querySelector('#page-pane')?.innerText || ''),
      oldExcerptVisible: /synthetic article for the General Page Reader CDP acceptance test/.test(document.querySelector('#page-pane')?.innerText || ''),
      sourceLinkVisible: /Source link/.test(document.querySelector('#page-pane')?.innerText || '')
    }))()`);

    await side.screenshot(resolve(OUT_DIR, "page-ready-and-stale.png"));

    return {
      initial,
      autoRead,
      ready,
      pageBrief,
      responsive,
      copy,
      switcher: { second: switcherSecond, third: switcherThird, display: switcherDisplay, activated: switcherActivated },
      selection: { selectedText, beforeAction: selectionBeforeAction, ...selection },
      pointTarget,
      afterHash,
      afterTracking,
      afterMeaningful,
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
    modelContextStatus: "",
  };
  try {
    await waitFor(side, `(() => {
      const analysis = document.querySelector('#page-pane .page-reader-analysis');
      return analysis && !analysis.classList.contains('is-running');
    })()`, 20000, "Page/Web page brief completion");
  } catch {
    observation.status = "pending_or_timeout";
    observation.text = await side.evaluate(`document.querySelector('#page-pane .page-reader-analysis')?.innerText || ''`).catch(() => "");
    await side.screenshot(resolve(OUT_DIR, "page-analysis-pending.png")).catch(() => {});
    observation.screenshot = relative(ROOT, resolve(OUT_DIR, "page-analysis-pending.png"));
    return observation;
  }
  const state = await side.evaluateJson(`(() => {
    const analysis = document.querySelector('#page-pane .page-reader-analysis');
    const modelContext = document.querySelector('#page-pane .page-reader-model-context');
    return {
      className: analysis?.className || '',
      header: analysis?.querySelector('h3')?.textContent?.trim(),
      status: analysis?.querySelector('.page-reader-analysis-header span')?.textContent?.trim(),
      text: analysis?.innerText?.trim() || '',
      modelContextStatus: modelContext?.querySelector('.page-reader-model-context-header span')?.textContent?.trim() || ''
    };
  })()`);
  observation.status = /is-ready/.test(state?.className || "") ? "ready" : /is-error/.test(state?.className || "") ? "error" : "unknown";
  observation.text = state?.text || "";
  observation.modelContextStatus = state?.modelContextStatus || "";
  await side.screenshot(resolve(OUT_DIR, readyScreenshotName)).catch(() => {});
  observation.screenshot = relative(ROOT, resolve(OUT_DIR, readyScreenshotName));
  return observation;
}

async function auditResponsivePageWebLayout(side, screenshotName) {
  const width = 430;
  const height = 900;
  try {
    await side.setViewport(width, height);
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
      const visibleCardsOutsideViewport = Array.from(document.querySelectorAll("#page-pane .page-reader-card, #page-pane .page-reader-model-context, #page-pane .page-reader-advisor, #page-pane .page-reader-analysis"))
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
      return {
        viewport: { width: window.innerWidth, height: window.innerHeight },
        documentWidth: root.scrollWidth,
        horizontalOverflow: root.scrollWidth > window.innerWidth + 1,
        interactiveOverflows,
        unnamedInteractive,
        undersizedControls,
        visibleCardsOutsideViewport,
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

async function auditNoisyFallbackRead(extensionId, allowedBase) {
  const noisyTarget = await createTarget(`${allowedBase}/noisy`);
  const sideTarget = await openSidePanelTestPage(extensionId, noisyTarget, "noisy");
  const noisy = connectCdp(noisyTarget.webSocketDebuggerUrl);
  const side = connectCdp(sideTarget.webSocketDebuggerUrl);

  try {
    await sleep(800);
    await side.evaluate(`document.querySelector('#pageReadCurrent')?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })); undefined`);
    await waitFor(side, `(() => /已讀取|Ready/.test(document.querySelector('#page-pane')?.innerText || ''))()`, 8000, "Page/Web noisy fallback ready state").catch(async (error) => {
      const timeoutState = await capturePageReadTimeoutState(side, noisy, null).catch((captureError) => ({
        captureError: captureError.message,
      }));
      await side.screenshot(resolve(OUT_DIR, "page-noisy-timeout.png")).catch(() => {});
      writeFileSync(resolve(OUT_DIR, "page-noisy-timeout.json"), JSON.stringify(timeoutState, null, 2));
      error.message = `${error.message}; diagnostics: ${relative(ROOT, resolve(OUT_DIR, "page-noisy-timeout.json"))}`;
      throw error;
    });
    await waitFor(side, `(() => {
      const advisor = document.querySelector('#page-pane .page-reader-advisor');
      const status = advisor?.querySelector('.page-reader-advisor-header span')?.textContent?.trim() || '';
      const decision = advisor?.querySelector('dd[data-raw-value="accept_current"]');
      return Boolean(decision) && /分析範圍|Analysis scope/.test(advisor?.textContent || '') && !/檢查中|Checking/.test(status);
    })()`, 26000, "Page/Web parser advisor completion").catch(async (error) => {
      await side.screenshot(resolve(OUT_DIR, "page-noisy-advisor-timeout.png")).catch(() => {});
      throw error;
    });

    const ready = await side.evaluateJson(`(() => {
      const pane = document.querySelector('#page-pane');
      const model = pane?.querySelector('.page-reader-model-context');
      const advisor = pane?.querySelector('.page-reader-advisor');
      return {
        status: pane?.querySelector('.page-reader-status-label')?.textContent?.trim(),
        meta: [...pane?.querySelectorAll('.page-reader-meta div') || []].map((el) => ({
          label: el.querySelector('dt')?.textContent?.trim(),
          value: el.querySelector('dd')?.textContent?.trim()
        })),
        extractionDiagnosticsOpen: pane?.querySelector('.page-reader-extraction-diagnostics')?.hasAttribute('open') ?? null,
        modelContext: model ? {
          status: model.querySelector('.page-reader-model-context-header span')?.textContent?.trim(),
          detail: model.querySelector('p')?.textContent?.trim(),
          className: model.className,
          diagnosticsOpen: model.querySelector('.page-reader-diagnostics')?.hasAttribute('open') ?? null
        } : null,
        advisor: advisor ? {
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
    return { ready };
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
    await waitFor(side, `(() => /已讀取|Ready/.test(document.querySelector('#page-pane')?.innerText || ''))()`, 8000, "candidate block page ready");
    await waitFor(side, `(() => {
      const advisor = document.querySelector('#page-pane .page-reader-advisor');
      const status = advisor?.querySelector('.page-reader-advisor-header span')?.textContent?.trim() || '';
      const decision = advisor?.querySelector('dd[data-raw-value="prefer_candidate_block"], dd[data-raw-value="accept_current"]');
      return Boolean(decision) && !/檢查中|Checking/.test(status);
    })()`, 26000, "candidate fixture advisor decision").catch(async (error) => {
      await side.screenshot(resolve(OUT_DIR, "page-candidate-timeout.png")).catch(() => {});
      throw error;
    });

    const ready = await side.evaluateJson(`(() => {
      const pane = document.querySelector('#page-pane');
      const model = pane?.querySelector('.page-reader-model-context');
      const advisor = pane?.querySelector('.page-reader-advisor');
      return {
        status: pane?.querySelector('.page-reader-status-label')?.textContent?.trim(),
        excerpt: pane?.querySelector('.page-reader-excerpt')?.textContent?.trim(),
        extractionDiagnosticsOpen: pane?.querySelector('.page-reader-extraction-diagnostics')?.hasAttribute('open') ?? null,
        modelContext: model ? {
          status: model.querySelector('.page-reader-model-context-header span')?.textContent?.trim(),
          detail: model.querySelector('p')?.textContent?.trim(),
          className: model.className,
          diagnosticsOpen: model.querySelector('.page-reader-diagnostics')?.hasAttribute('open') ?? null
        } : null,
        advisor: advisor ? {
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
  const sideTarget = await openSidePanelTestPage(extensionId, teaserTarget, "teaser");
  const teaser = connectCdp(teaserTarget.webSocketDebuggerUrl);
  const side = connectCdp(sideTarget.webSocketDebuggerUrl);

  try {
    await sleep(800);
    await waitFor(side, `(() => {
      const button = document.querySelector('#pageReadCurrent');
      return Boolean(button && !button.disabled);
    })()`, 10000, "teaser hub read button ready");
    await side.evaluate(`(() => {
      const button = document.querySelector('#pageReadCurrent');
      if (!button || button.disabled) return false;
      return button.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    })()`);
    await waitFor(side, `(() => /已讀取|Ready/.test(document.querySelector('#page-pane')?.innerText || ''))()`, 8000, "teaser hub page ready").catch(async (error) => {
      const timeoutState = await capturePageReadTimeoutState(side, teaser, null).catch((captureError) => ({
        captureError: captureError.message,
      }));
      await side.screenshot(resolve(OUT_DIR, "page-teaser-hub-timeout.png")).catch(() => {});
      writeFileSync(resolve(OUT_DIR, "page-teaser-hub-timeout.json"), JSON.stringify(timeoutState, null, 2));
      error.message = `${error.message}; diagnostics: ${relative(ROOT, resolve(OUT_DIR, "page-teaser-hub-timeout.json"))}`;
      throw error;
    });
    await waitFor(side, `(() => {
      const advisor = document.querySelector('#page-pane .page-reader-advisor');
      const status = advisor?.querySelector('.page-reader-advisor-header span')?.textContent?.trim() || '';
      const decision = advisor?.querySelector('dd[data-raw-value="downgrade_to_index_or_feed"]');
      return Boolean(decision) && !/檢查中|Checking/.test(status);
    })()`, 26000, "teaser hub advisor decision").catch(async (error) => {
      await side.screenshot(resolve(OUT_DIR, "page-teaser-hub-advisor-timeout.png")).catch(() => {});
      throw error;
    });

    const ready = await side.evaluateJson(`(() => {
      const pane = document.querySelector('#page-pane');
      const model = pane?.querySelector('.page-reader-model-context');
      const advisor = pane?.querySelector('.page-reader-advisor');
      return {
        status: pane?.querySelector('.page-reader-status-label')?.textContent?.trim(),
        excerpt: pane?.querySelector('.page-reader-excerpt')?.textContent?.trim(),
        extractionDiagnosticsOpen: pane?.querySelector('.page-reader-extraction-diagnostics')?.hasAttribute('open') ?? null,
        modelContext: model ? {
          status: model.querySelector('.page-reader-model-context-header span')?.textContent?.trim(),
          detail: model.querySelector('p')?.textContent?.trim(),
          className: model.className,
          diagnosticsOpen: model.querySelector('.page-reader-diagnostics')?.hasAttribute('open') ?? null
        } : null,
        advisor: advisor ? {
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
    return { ready };
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
    await side.evaluate(`document.querySelector('#pageReadCurrent')?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })); undefined`);
    await sleep(700);
    await side.screenshot(resolve(OUT_DIR, "page-no-grant.png"));
    return await side.evaluateJson(`(() => ({
      status: document.querySelector('#page-pane .page-reader-status-label')?.textContent?.trim(),
      detail: document.querySelector('#page-pane .page-reader-status-detail')?.textContent?.trim(),
      error: document.querySelector('#page-pane .page-reader-error')?.textContent?.trim(),
      errorBlockPresent: Boolean(document.querySelector('#page-pane .page-reader-error')),
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
  const activeTarget = await createTarget(activeUrl);
  const sideTarget = await openSidePanelTestPage(extensionId, activeTarget, suffix);
  const side = connectCdp(sideTarget.webSocketDebuggerUrl);
  const active = connectCdp(activeTarget.webSocketDebuggerUrl);
  try {
    await sleep(900);
    await side.evaluate(`(() => {
      const norm = (s) => String(s || "").replace(/\\s+/g, " ").trim();
      const tab = Array.from(document.querySelectorAll("button,[role='tab']")).find((el) => /Page\\/Web/.test(norm(el.textContent || el.getAttribute("aria-label") || "")));
      tab?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, view: window }));
    })()`);
    await sleep(400);
    const state = await side.evaluateJson(`(() => ({
      activeTab: document.querySelector('.tab[aria-selected="true"], [role="tab"][aria-selected="true"]')?.textContent?.trim() || "",
      status: document.querySelector('#page-pane .page-reader-status-label')?.textContent?.trim() || "",
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
    if (result.popupRead.sideState.status !== "已讀取" && result.popupRead.sideState.status !== "Ready") {
      errors.push(`popup read path did not make Page/Web ready: ${result.popupRead.sideState.status || "(missing)"}`);
    }
    if (result.popupRead.sideState.title !== "Synthetic General Page Reader Article") {
      errors.push(`popup read path showed unexpected Page/Web title: ${result.popupRead.sideState.title || "(missing)"}`);
    }
  }
  if (result.success.ready.status !== "已讀取" && result.success.ready.status !== "Ready") {
    errors.push(`successful read did not reach ready status: ${result.success.ready.status}`);
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
  if (result.success.ready.title !== "Synthetic General Page Reader Article") {
    errors.push(`unexpected extracted title: ${result.success.ready.title}`);
  }
  if (result.success.ready.fullTailVisible) {
    errors.push("Page/Web pane includes the full synthetic body tail");
  }
  if (!/分析準備|Analysis readiness/.test(result.success.ready.modelContext?.title || "")) {
    errors.push("Page/Web pane does not show analysis readiness");
  }
  if (!/is-ready/.test(result.success.ready.modelContext?.className || "")) {
    errors.push(`unexpected analysis readiness class: ${result.success.ready.modelContext?.className || "(missing)"}`);
  }
  if (!/可分析|Ready to analyze|已送出|Sent|已產生重點|Brief created/.test(result.success.ready.modelContext?.status || "")) {
    errors.push(`unexpected analysis readiness status: ${result.success.ready.modelContext?.status || "(missing)"}`);
  }
  if (!hasPassingTextThresholdRow(result.success.ready.modelContext?.rows)) {
    errors.push("model context text threshold row is missing or incorrect");
  }
  if (!/分析範圍|Analysis scope/.test(result.success.ready.advisor?.title || "")) {
    errors.push("Page/Web pane does not show analysis scope state");
  }
  if (!/已建立|Ready/.test(result.success.ready.advisor?.status || "")) {
    errors.push(`successful read analysis scope should be established: ${result.success.ready.advisor?.status || "(missing)"}`);
  }
  if (!result.success.ready.advisor?.rows?.some((row) => /判斷|Decision/.test(row.label || "") && rawRowValue(row) === "accept_current")) {
    errors.push("successful read advisor does not preserve accept_current effective context");
  }
  if (!result.success.ready.sourceLinks?.some((link) => link.label === "Source link" && /\/source$/.test(link.href))) {
    errors.push("Page/Web pane does not expose extracted source links for early inspection");
  }
  if (result.success.ready.extractionDiagnosticsOpen !== false) {
    errors.push("successful read should keep extraction diagnostics collapsed by default");
  }
  if (result.success.ready.modelContext?.diagnosticsOpen !== false) {
    errors.push("successful read should keep model diagnostics collapsed by default");
  }
  if (!/is-compact/.test(result.success.ready.modelContext?.className || "")) {
    errors.push("successful read should render model context as a compact row");
  }
  if (result.success.ready.advisor?.diagnosticsOpen !== false) {
    errors.push("successful read should keep advisor diagnostics collapsed by default");
  }
  if (result.success.pageBrief?.status === "ready" &&
    !/已產生重點|Brief created/.test(result.success.pageBrief?.modelContextStatus || "")) {
    errors.push(`page brief completed but model context still shows wrong status: ${result.success.pageBrief?.modelContextStatus || "(missing)"}`);
  }
  if ((result.success.ready.sourceLinks?.length ?? 0) > 6) {
    errors.push("successful read exposes more than six source links");
  }
  if (result.success.responsive?.horizontalOverflow) {
    errors.push(`Page/Web 430px layout has horizontal overflow: documentWidth=${result.success.responsive.documentWidth}`);
  }
  if ((result.success.responsive?.interactiveOverflows?.length ?? 0) > 0) {
    errors.push(`Page/Web 430px layout clips interactive elements: ${result.success.responsive.interactiveOverflows.map((item) => item.text || item.id || item.className || item.tag).join(", ")}`);
  }
  if ((result.success.responsive?.visibleCardsOutsideViewport?.length ?? 0) > 0) {
    errors.push(`Page/Web 430px layout renders cards outside viewport: ${result.success.responsive.visibleCardsOutsideViewport.map((item) => item.className || item.tag).join(", ")}`);
  }
  if ((result.success.responsive?.unnamedInteractive?.length ?? 0) > 0) {
    errors.push(`Page/Web interactive elements are missing accessible names: ${result.success.responsive.unnamedInteractive.map((item) => item.id || item.className || item.tag).join(", ")}`);
  }
  if ((result.success.responsive?.undersizedControls?.length ?? 0) > 0) {
    errors.push(`Page/Web primary controls are too small at 430px: ${result.success.responsive.undersizedControls.map((item) => item.text || item.accessibleName || item.id || item.className || item.tag).join(", ")}`);
  }
  if (!result.success.copy.hasTitle || !result.success.copy.hasUrl || !result.success.copy.hasExcerpt || result.success.copy.hasFullTail) {
    errors.push("copy metadata boundary failed");
  }
  if ((result.success.switcher?.third?.sessionCount ?? 0) < 3 || (result.success.switcher?.display?.sessionCount ?? 0) < 3) {
    errors.push("Page/Web session switcher did not expose three saved page sessions");
  }
  if (result.success.switcher?.display?.activeState?.activeTabId !== result.success.switcher?.third?.activeState?.activeTabId) {
    errors.push("Page/Web saved-session display implicitly changed the active Chrome tab");
  }
  if (result.success.switcher?.display?.selectionDisabled !== true || result.success.switcher?.display?.hasActivateButton !== true) {
    errors.push("Page/Web inactive saved-session display did not gate live selection behind explicit tab activation");
  }
  if (
    result.success.switcher?.activated?.selectionDisabled !== false ||
    result.success.switcher?.activated?.hasActivateButton !== false ||
    result.success.switcher?.activated?.activeState?.activeTabId === result.success.switcher?.third?.activeState?.activeTabId
  ) {
    errors.push("Page/Web explicit saved-session activation did not restore live page controls");
  }
  if (!result.success.selection?.selectedText || !result.success.selection.excerpt?.includes(result.success.selection.selectedText.slice(0, 60))) {
    errors.push("selection target text was not rendered as the Page/Web preview");
  }
  if (result.success.selection?.beforeAction?.selectionDisabled !== false) {
    errors.push(`selection target button was not available before explicit action: ${result.success.selection?.beforeAction?.selectionDisabled}`);
  }
  if (result.success.selection?.beforeAction?.targetKind !== "page") {
    errors.push(`selection changed model target before explicit action: ${result.success.selection?.beforeAction?.targetKind || "(missing)"}`);
  }
  if (!result.success.selection?.modelRows?.some((row) => /目標|Target/.test(row.label || "") && rawRowValue(row) === "selection")) {
    errors.push("selection target did not switch model context targetKind to selection");
  }
  if (!result.success.selection?.advisorRows?.some((row) => /判斷|Decision/.test(row.label || "") && rawRowValue(row) === "accept_current")) {
    errors.push("selection target did not preserve accept_current reading context");
  }
  if (result.success.afterHash.stale) errors.push("hash-only URL change incorrectly marked stale");
  if (result.success.afterTracking.stale) errors.push("tracking-only query change incorrectly marked stale");
  if (!result.success.afterMeaningful.stale) errors.push("meaningful URL change did not mark stale");
  if (result.success.afterMeaningful.oldExcerptVisible || result.success.afterMeaningful.sourceLinkVisible) {
    errors.push("meaningful URL change did not scrub stale Page/Web surface content");
  }
  if (result.noisy.ready.status !== "已讀取" && result.noisy.ready.status !== "Ready") {
    errors.push(`noisy fallback read did not reach ready status: ${result.noisy.ready.status}`);
  }
  if (!/is-ready/.test(result.noisy.ready.modelContext?.className || "")) {
    errors.push("noisy fallback model context does not use ready UI state");
  }
  if (!result.noisy.ready.meta?.some((row) => /讀取方式|Reading method/.test(row.label || "") && row.value === "fallback")) {
    errors.push("noisy fallback audit did not exercise fallback extraction");
  }
  if (!result.noisy.ready.meta?.some((row) => /內容狀態|Content state/.test(row.label || "") && row.value === "complete")) {
    errors.push("noisy fallback audit did not exercise complete fallback extraction");
  }
  if (!result.noisy.ready.sourceLinks?.some((link) => link.label === "Article source" && /\/source$/.test(link.href))) {
    errors.push("noisy fallback audit did not preserve the real article source link");
  }
  if (!/is-compact/.test(result.noisy.ready.modelContext?.className || "")) {
    errors.push("noisy fallback ready context should remain compact");
  }
  if (result.noisy.ready.modelContext?.diagnosticsOpen !== false) {
    errors.push("noisy fallback ready model diagnostics should remain collapsed");
  }
  if (result.noisy.ready.advisor?.diagnosticsOpen !== false) {
    errors.push("noisy fallback ready advisor diagnostics should remain collapsed");
  }
  if ((result.noisy.ready.sourceLinks?.length ?? 0) > 6) {
    errors.push("noisy fallback exposes more than six source links");
  }
  if (result.noisy.ready.hasEdgeDownload || result.noisy.ready.hasFirefoxDownload || result.noisy.ready.hasGoogleDownload) {
    errors.push("noisy fallback audit still exposes browser download links as source context");
  }
  if (!/分析範圍|Analysis scope/.test(result.noisy.ready.advisor?.title || "")) {
    errors.push("noisy fallback does not show analysis scope state");
  }
  if (/檢查中|Checking/.test(result.noisy.ready.advisor?.status || "")) {
    errors.push("noisy fallback advisor remained pending");
  }
  const noisyAdvisorRows = result.noisy.ready.advisor?.rows || [];
  const noisyDecision = rawRowValue(noisyAdvisorRows.find((row) => /判斷|Decision/.test(row.label || "")));
  const noisyUse = rawRowValue(noisyAdvisorRows.find((row) => /用途|Use/.test(row.label || "")));
  if (noisyDecision !== "accept_current") {
    errors.push(`noisy fallback advisor did not accept the cleaned fallback context: ${noisyDecision || "(missing)"}`);
  }
  if (noisyUse !== "article_or_selection_analysis") {
    errors.push(`noisy fallback effective context was not article analysis: ${noisyUse || "(missing)"}`);
  }
  if (result.candidate.ready.status !== "已讀取" && result.candidate.ready.status !== "Ready") {
    errors.push(`candidate block recovery did not reach ready status: ${result.candidate.ready.status}`);
  }
  const candidateAdvisorRows = result.candidate.ready.advisor?.rows || [];
  const candidateDecision = rawRowValue(candidateAdvisorRows.find((row) => /判斷|Decision/.test(row.label || "")));
  const candidateUse = rawRowValue(candidateAdvisorRows.find((row) => /用途|Use/.test(row.label || "")));
  if (!["prefer_candidate_block", "accept_current"].includes(candidateDecision)) {
    errors.push(`candidate fixture did not reach a usable article decision: ${candidateDecision || "(missing)"}`);
  }
  if (candidateUse !== "article_or_selection_analysis") {
    errors.push(`candidate block effective context was not article analysis: ${candidateUse || "(missing)"}`);
  }
  if (candidateDecision === "prefer_candidate_block" && !result.candidate.ready.hasFullCandidateContinuation) {
    errors.push("candidate block recovery did not render the re-extracted full candidate text");
  }
  if (!result.candidate.ready.hasCandidateSource) {
    errors.push("candidate block recovery did not preserve candidate source link visibility");
  }
  if (candidateDecision === "prefer_candidate_block") {
    if (result.candidate.ready.extractionDiagnosticsOpen !== true) {
      errors.push("candidate block recovery should expand extraction diagnostics");
    }
    if (result.candidate.ready.modelContext?.diagnosticsOpen !== true) {
      errors.push("candidate block recovery should expand model diagnostics");
    }
    if (/is-compact/.test(result.candidate.ready.modelContext?.className || "")) {
      errors.push("candidate block recovery should not compact model context warnings");
    }
    if (result.candidate.ready.advisor?.diagnosticsOpen !== true) {
      errors.push("candidate block recovery should expand advisor diagnostics");
    }
  } else {
    if (result.candidate.ready.modelContext?.diagnosticsOpen !== false) {
      errors.push("candidate clean extraction should keep model diagnostics collapsed");
    }
    if (!/is-compact/.test(result.candidate.ready.modelContext?.className || "")) {
      errors.push("candidate clean extraction should use compact model context");
    }
    if (result.candidate.ready.advisor?.diagnosticsOpen !== false) {
      errors.push("candidate clean extraction should keep advisor diagnostics collapsed");
    }
  }
  if ((result.candidate.ready.sourceLinks?.length ?? 0) > 6) {
    errors.push("candidate block recovery exposes more than six source links");
  }
  if (result.teaser.ready.status !== "已讀取" && result.teaser.ready.status !== "Ready") {
    errors.push(`teaser hub did not reach ready status: ${result.teaser.ready.status}`);
  }
  const teaserAdvisorRows = result.teaser.ready.advisor?.rows || [];
  const teaserDecision = rawRowValue(teaserAdvisorRows.find((row) => /判斷|Decision/.test(row.label || "")));
  const teaserUse = rawRowValue(teaserAdvisorRows.find((row) => /用途|Use/.test(row.label || "")));
  if (teaserDecision !== "downgrade_to_index_or_feed") {
    errors.push(`teaser hub advisor did not downgrade to index/feed: ${teaserDecision || "(missing)"}`);
  }
  if (teaserUse !== "page_overview_only") {
    errors.push(`teaser hub effective context was not page overview only: ${teaserUse || "(missing)"}`);
  }
  if (result.teaser.ready.extractionDiagnosticsOpen !== true) {
    errors.push("teaser hub should expand extraction diagnostics");
  }
  if (result.teaser.ready.modelContext?.diagnosticsOpen !== true) {
    errors.push("teaser hub should expand model diagnostics");
  }
  if (result.teaser.ready.advisor?.diagnosticsOpen !== true) {
    errors.push("teaser hub should expand advisor diagnostics");
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
  if (result.screenshot?.preview?.state !== "preview" || !/^data:image\//.test(result.screenshot?.preview?.imgSrcPrefix || "")) {
    errors.push("screenshot recovery did not show a user preview with a supported image data URL");
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
  if (!result.noGrant.hasGuidance) errors.push("no-grant sidepanel path did not show toolbar activation guidance");
  if (!result.noGrant.hasAllSitesGuidance) errors.push("no-grant sidepanel path did not mention all-sites settings access");
  if (!result.noGrant.detailHasGuidance) errors.push("no-grant primary status detail did not show toolbar activation guidance");
  if (result.noGrant.detailHasGenericRetry) errors.push("no-grant primary status detail still shows generic retry guidance");
  if (result.noGrant.errorBlockPresent) errors.push("no-grant toolbar guidance is duplicated in a separate error block");
  if (result.unsupportedPages?.truly?.side?.readDisabled !== true) {
    errors.push("Truly internal page should keep Page/Web read button disabled");
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
  if (result.unsupportedPages?.browser?.side?.readDisabled !== true) {
    errors.push("browser internal page should keep Page/Web read button disabled");
  }
  if (!/不支援此頁|Unsupported page/.test(result.unsupportedPages?.browser?.side?.status || "")) {
    errors.push(`browser internal page did not render unsupported status: ${result.unsupportedPages?.browser?.side?.status || "(missing)"}`);
  }
  if (!/瀏覽器內部頁面|Browser internal pages/.test(result.unsupportedPages?.browser?.side?.detail || "")) {
    errors.push(`browser internal page did not explain the unsupported reason: ${result.unsupportedPages?.browser?.side?.detail || "(missing)"}`);
  }
  if (/工具列圖示|toolbar icon/.test(result.unsupportedPages?.browser?.side?.text || "")) {
    errors.push("browser internal page incorrectly shows toolbar activation guidance");
  }
  if (result.storagePrivacy?.ok !== true) {
    const hits = (result.storagePrivacy?.hits || []).map((hit) => `${hit.area}:${hit.path}:${hit.kind}`).join(", ");
    errors.push(`storage privacy probe found sensitive Page/Web data in chrome.storage: ${hits || "(missing details)"}`);
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

function qaPass(value) {
  if (value === null) return "SKIP";
  return value ? "PASS" : "FAIL";
}

function escapeTableCell(value) {
  return String(value).replace(/\|/g, "\\|");
}

function designRestraint(result) {
  const readyDiagnosticsCollapsed = result.success.ready.extractionDiagnosticsOpen === false &&
    result.success.ready.modelContext?.diagnosticsOpen === false &&
    result.success.ready.advisor?.diagnosticsOpen === false;
  const readyModelCompact = /is-compact/.test(result.success.ready.modelContext?.className || "");
  const sourceLinksCapped = (result.success.ready.sourceLinks?.length ?? 0) <= 6;
  const cautionDiagnosticsExpanded = result.teaser.ready.extractionDiagnosticsOpen === true &&
    result.teaser.ready.modelContext?.diagnosticsOpen === true &&
    result.teaser.ready.advisor?.diagnosticsOpen === true;
  const responsiveClean = result.success.responsive?.horizontalOverflow === false &&
    (result.success.responsive?.interactiveOverflows?.length ?? 0) === 0 &&
    (result.success.responsive?.visibleCardsOutsideViewport?.length ?? 0) === 0;
  const interactionAccessible = (result.success.responsive?.unnamedInteractive?.length ?? 0) === 0 &&
    (result.success.responsive?.undersizedControls?.length ?? 0) === 0;
  return {
    pass: readyDiagnosticsCollapsed && readyModelCompact && sourceLinksCapped && cautionDiagnosticsExpanded && responsiveClean && interactionAccessible,
    readyDiagnosticsCollapsed,
    readyModelCompact,
    sourceLinksCapped,
    cautionDiagnosticsExpanded,
    responsiveClean,
    interactionAccessible,
  };
}

function qaMatrixRows(result) {
  const noisyAdvisorRows = result.noisy.ready.advisor?.rows || [];
  const candidateAdvisorRows = result.candidate.ready.advisor?.rows || [];
  const teaserAdvisorRows = result.teaser.ready.advisor?.rows || [];
  const noisyDecision = rawRowValue(noisyAdvisorRows.find((row) => /判斷|Decision/.test(row.label || "")));
  const noisyUse = rawRowValue(noisyAdvisorRows.find((row) => /用途|Use/.test(row.label || "")));
  const candidateDecision = rawRowValue(candidateAdvisorRows.find((row) => /判斷|Decision/.test(row.label || "")));
  const candidateUse = rawRowValue(candidateAdvisorRows.find((row) => /用途|Use/.test(row.label || "")));
  const teaserDecision = rawRowValue(teaserAdvisorRows.find((row) => /判斷|Decision/.test(row.label || "")));
  const teaserUse = rawRowValue(teaserAdvisorRows.find((row) => /用途|Use/.test(row.label || "")));
  const restraint = designRestraint(result);
  return [
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
        (result.popupRead.sideState.status === "已讀取" || result.popupRead.sideState.status === "Ready") &&
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
      result.success.ready.status === "已讀取" &&
        result.success.ready.title === "Synthetic General Page Reader Article" &&
        !result.success.ready.fullTailVisible &&
        result.success.ready.extractionDiagnosticsOpen === false &&
        result.success.ready.modelContext?.diagnosticsOpen === false &&
        /is-compact/.test(result.success.ready.modelContext?.className || "") &&
        result.success.ready.advisor?.diagnosticsOpen === false &&
        (result.success.ready.sourceLinks?.length ?? 0) <= 6,
      "title=" + result.success.ready.title + "; links=" + (result.success.ready.sourceLinks?.length ?? 0) + "; diagnosticsCollapsed=" + (result.success.ready.extractionDiagnosticsOpen === false),
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
      "Page brief generation",
      result.success.pageBrief?.status === "ready" &&
        /已產生重點|Brief created/.test(result.success.pageBrief?.modelContextStatus || ""),
      "status=" + (result.success.pageBrief?.status || "missing") +
        "; modelContext=" + (result.success.pageBrief?.modelContextStatus || "missing"),
    ],
    [
      "Page brief quick mode",
      /快速重點|quick brief/.test(result.success.pageBrief?.text || ""),
      "quickNote=" + /快速重點|quick brief/.test(result.success.pageBrief?.text || ""),
    ],
    [
      "Responsive Page/Web layout",
      result.success.responsive?.horizontalOverflow === false &&
        (result.success.responsive?.interactiveOverflows?.length ?? 0) === 0 &&
        (result.success.responsive?.visibleCardsOutsideViewport?.length ?? 0) === 0,
      "430px horizontalOverflow=" + result.success.responsive?.horizontalOverflow +
        "; clippedInteractive=" + (result.success.responsive?.interactiveOverflows?.length ?? 0) +
        "; offscreenCards=" + (result.success.responsive?.visibleCardsOutsideViewport?.length ?? 0),
    ],
    [
      "Page/Web design restraint",
      restraint.pass,
      "readyCollapsed=" + restraint.readyDiagnosticsCollapsed +
        "; compactModel=" + restraint.readyModelCompact +
        "; sourceLinksCapped=" + restraint.sourceLinksCapped +
        "; cautionExpanded=" + restraint.cautionDiagnosticsExpanded +
        "; responsiveClean=" + restraint.responsiveClean +
        "; interactionAccessible=" + restraint.interactionAccessible,
    ],
    [
      "Page/Web interaction accessibility",
      (result.success.responsive?.unnamedInteractive?.length ?? 0) === 0 &&
        (result.success.responsive?.undersizedControls?.length ?? 0) === 0,
      "unnamed=" + (result.success.responsive?.unnamedInteractive?.length ?? 0) +
        "; undersizedControls=" + (result.success.responsive?.undersizedControls?.length ?? 0),
    ],
    [
      "Saved-session switching",
      (result.success.switcher?.display?.sessionCount ?? 0) >= 3 &&
        result.success.switcher?.display?.selectionDisabled === true &&
        result.success.switcher?.activated?.selectionDisabled === false,
      "sessions=" + (result.success.switcher?.display?.sessionCount ?? 0) + "; restored=" + (result.success.switcher?.activated?.selectionDisabled === false),
    ],
    [
      "Selection target",
      Boolean(result.success.selection?.selectedText) &&
        result.success.selection?.beforeAction?.selectionDisabled === false &&
        result.success.selection?.beforeAction?.targetKind === "page" &&
        result.success.selection?.modelRows?.some((row) => /目標|Target/.test(row.label || "") && rawRowValue(row) === "selection") &&
        result.success.selection?.advisorRows?.some((row) => /判斷|Decision/.test(row.label || "") && rawRowValue(row) === "accept_current"),
      "before=" + (result.success.selection?.beforeAction?.targetKind || "missing") +
        "; after=selection; selectedChars=" + (result.success.selection?.selectedText?.length ?? 0),
    ],
    [
      "Current-region shortcut",
      result.success.pointTarget?.targetKind === "current-region",
      "target=" + (result.success.pointTarget?.targetKind || "missing") + "; advisor=" + (result.success.pointTarget?.advisorStatus || "missing"),
    ],
    [
      "URL identity and stale scrub",
      !result.success.afterHash.stale &&
        !result.success.afterTracking.stale &&
        result.success.afterMeaningful.stale &&
        !result.success.afterMeaningful.oldExcerptVisible &&
        !result.success.afterMeaningful.sourceLinkVisible,
      "hash=" + result.success.afterHash.stale + "; tracking=" + result.success.afterTracking.stale + "; meaningful=" + result.success.afterMeaningful.stale,
    ],
    [
      "Noisy fallback clean context",
      /is-ready/.test(result.noisy.ready.modelContext?.className || "") &&
        /is-compact/.test(result.noisy.ready.modelContext?.className || "") &&
        noisyDecision === "accept_current" &&
        noisyUse === "article_or_selection_analysis" &&
        result.noisy.ready.modelContext?.diagnosticsOpen === false &&
        result.noisy.ready.advisor?.diagnosticsOpen === false,
      "decision=" + (noisyDecision || "missing") + "; use=" + (noisyUse || "missing"),
    ],
    [
      "Candidate fixture extraction",
      ["prefer_candidate_block", "accept_current"].includes(candidateDecision) &&
        candidateUse === "article_or_selection_analysis" &&
        (candidateDecision === "accept_current" || result.candidate.ready.hasFullCandidateContinuation === true) &&
        result.candidate.ready.hasCandidateSource === true,
      "decision=" + (candidateDecision || "missing") + "; use=" + (candidateUse || "missing"),
    ],
    [
      "Teaser hub overview",
      teaserDecision === "downgrade_to_index_or_feed" &&
        teaserUse === "page_overview_only" &&
        result.teaser.ready.extractionDiagnosticsOpen === true &&
        result.teaser.ready.modelContext?.diagnosticsOpen === true &&
        result.teaser.ready.advisor?.diagnosticsOpen === true &&
        result.teaser.ready.hasMemberArea === false &&
        result.teaser.ready.hasNewsletter === false,
      "decision=" + (teaserDecision || "missing") + "; use=" + (teaserUse || "missing"),
    ],
    [
      "Screenshot recovery",
      result.screenshot?.offer?.state === "offer" &&
        result.screenshot?.preview?.state === "preview" &&
        result.screenshot?.preview?.hasConfirmButton === true &&
        result.screenshot?.captureClickState?.captureCalls?.length === 1 &&
        result.screenshot?.confirmed?.hasPreview === false &&
        result.screenshot?.confirmed?.domHasDataImage === false &&
        result.screenshot?.requests?.some((request) => request.kind === "screenshot-brief" && request.hasImageUrl === true) &&
        result.screenshot?.storageAfter?.ok === true,
      "offer=" + (result.screenshot?.offer?.state || "missing") +
        "; preview=" + (result.screenshot?.preview?.state || "missing") +
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
      result.noGrant.hasGuidance === true &&
        result.noGrant.hasAllSitesGuidance === true &&
        result.noGrant.detailHasGuidance === true &&
        result.noGrant.detailHasGenericRetry === false &&
        result.noGrant.errorBlockPresent === false,
      "toolbarGuidance=" + result.noGrant.hasGuidance +
        "; allSitesGuidance=" + result.noGrant.hasAllSitesGuidance +
        "; primaryDetail=" + result.noGrant.detailHasGuidance +
        "; genericRetry=" + result.noGrant.detailHasGenericRetry +
        "; duplicateErrorBlock=" + result.noGrant.errorBlockPresent,
    ],
    [
      "Unsupported page guidance",
      result.unsupportedPages?.truly?.side?.readDisabled === true &&
        result.unsupportedPages?.browser?.side?.readDisabled === true &&
        /不支援此頁|Unsupported page/.test(result.unsupportedPages?.truly?.side?.status || "") &&
        /不支援此頁|Unsupported page/.test(result.unsupportedPages?.browser?.side?.status || "") &&
        /Truly.*設定|Truly settings|內部頁面|internal page/.test(result.unsupportedPages?.truly?.side?.detail || "") &&
        /瀏覽器內部頁面|Browser internal pages/.test(result.unsupportedPages?.browser?.side?.detail || "") &&
        !/工具列圖示|toolbar icon/.test(result.unsupportedPages?.truly?.side?.text || "") &&
        !/工具列圖示|toolbar icon/.test(result.unsupportedPages?.browser?.side?.text || ""),
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
      "Page/Web 讀取",
      "success/noisy/candidate/teaser",
      "Readable pages should show useful main content; noisy pages should not leak navigation, recirculation, or browser-download content.",
      ["Ordinary article read", "Noisy fallback clean context", "Candidate fixture extraction", "Teaser hub overview"],
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
      ["Page brief generation", "Page brief quick mode", "Storage privacy probe", "Noisy fallback clean context", "Candidate fixture extraction"],
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
      "多分頁 Page/Web session",
      "success",
      "Saved Page/Web sessions must not activate the wrong browser tab or enable live-target actions against an inactive page.",
      ["Saved-session switching"],
      [
        relative(ROOT, resolve(OUT_DIR, "page-session-switcher-display.png")),
        relative(ROOT, resolve(OUT_DIR, "page-session-switcher-display.json")),
      ],
    ),
    row(
      "URL meaningful change",
      "success",
      "Hash/tracking changes should not stale the session, while meaningful URL changes must scrub old page content.",
      ["URL identity and stale scrub"],
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
      "The audit itself must expose phase timing, QA evidence, private artifacts, and a feature-to-risk coverage map for review.",
      ["Popup activation", "Ordinary article read", "Screenshot recovery", "Unsupported page guidance", "Storage privacy probe"],
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
    `- Popup general page: ${result.popup.general.button} / disabled=${result.popup.general.disabled}`,
    `- Popup unsupported page disabled: ${result.popup.unsupported.disabled}`,
    isPopupReadSkipped(result)
      ? `- Popup read click: skipped (${result.popupRead.reason || "requested"})`
      : `- Popup read click: activeUrl=${result.popupRead.before.activeTab?.url || "(missing)"}; initialHadResult=${/Synthetic General Page Reader Article/.test(result.popupRead.initialSide?.text || "")}; status=${result.popupRead.sideState.status || "(missing)"}`,
    `- All-sites sidepanel auto-read: allSites=${Boolean(result.success.autoRead?.allSites)}; observed=${Boolean(result.success.autoRead?.observed)}`,
    `- Page/Web read status: ${result.success.ready.status}`,
    `- Page/Web read elapsed title: ${result.success.ready.statusTitle || "(missing)"}`,
    `- Analysis readiness: ${result.success.ready.modelContext?.status || "(missing)"}`,
    `- Analysis scope: ${result.success.ready.advisor?.status || "(missing)"}`,
    `- Page brief observation: ${result.success.pageBrief?.status || "(missing)"}`,
    `- Page brief model context status: ${result.success.pageBrief?.modelContextStatus || "(missing)"}`,
    `- Page brief quick mode: ${/快速重點|quick brief/.test(result.success.pageBrief?.text || "")}`,
    `- Responsive Page/Web 430px: horizontalOverflow=${result.success.responsive?.horizontalOverflow}; clippedInteractive=${result.success.responsive?.interactiveOverflows?.length ?? "(missing)"}; offscreenCards=${result.success.responsive?.visibleCardsOutsideViewport?.length ?? "(missing)"}`,
    `- Page/Web design restraint: readyCollapsed=${restraint.readyDiagnosticsCollapsed}; compactModel=${restraint.readyModelCompact}; sourceLinksCapped=${restraint.sourceLinksCapped}; cautionExpanded=${restraint.cautionDiagnosticsExpanded}; responsiveClean=${restraint.responsiveClean}; interactionAccessible=${restraint.interactionAccessible}`,
    `- Page/Web interaction accessibility: unnamed=${result.success.responsive?.unnamedInteractive?.length ?? "(missing)"}; undersizedControls=${result.success.responsive?.undersizedControls?.length ?? "(missing)"}`,
    `- Saved-page switcher: ${(result.success.switcher?.display?.sessionCount || 0)} sessions / activation restored=${result.success.switcher?.activated?.selectionDisabled === false}`,
    `- Selection target: ${result.success.selection?.advisorStatus || "(missing)"}`,
    `- Current-region target: ${result.success.pointTarget?.targetKind || "(missing)"} / ${result.success.pointTarget?.advisorStatus || "(missing)"}`,
    `- Source links visible: ${result.success.ready.sourceLinks?.length || 0}`,
    `- Noisy fallback model context: ${result.noisy.ready.modelContext?.status || "(missing)"}`,
    `- Noisy fallback reading context: ${result.noisy.ready.advisor?.status || "(missing)"}`,
    `- Noisy fallback source links: ${(result.noisy.ready.sourceLinks || []).map((link) => link.label).join(", ") || "(none)"}`,
    `- Candidate fixture extraction: ${result.candidate.ready.advisor?.status || "(missing)"}`,
    `- Teaser hub overview: ${result.teaser.ready.advisor?.status || "(missing)"}`,
    `- Screenshot recovery: offer=${result.screenshot?.offer?.state || "(missing)"}; preview=${result.screenshot?.preview?.state || "(missing)"}; sentImage=${Boolean(result.screenshot?.requests?.some((request) => request.kind === "screenshot-brief" && request.hasImageUrl === true))}; storageHits=${result.screenshot?.storageAfter?.hits?.length ?? "(missing)"}`,
    `- Hash-only stale: ${result.success.afterHash.stale}`,
    `- Tracking-only stale: ${result.success.afterTracking.stale}`,
    `- Meaningful URL stale: ${result.success.afterMeaningful.stale}`,
    `- Meaningful URL scrubbed stale surface: ${!result.success.afterMeaningful.oldExcerptVisible && !result.success.afterMeaningful.sourceLinkVisible}`,
    `- Copy info title/url/excerpt: ${result.success.copy.hasTitle}/${result.success.copy.hasUrl}/${result.success.copy.hasExcerpt}`,
    `- Storage privacy probe: ok=${result.storagePrivacy?.ok}; localKeys=${result.storagePrivacy?.localKeyCount ?? "(missing)"}; sessionKeys=${result.storagePrivacy?.sessionKeyCount ?? "(missing)"}; hits=${result.storagePrivacy?.hits?.length ?? "(missing)"}`,
    `- No-grant guidance: ${result.noGrant.hasGuidance}`,
    `- No-grant all-sites settings guidance: ${result.noGrant.hasAllSitesGuidance}`,
    `- No-grant primary status guidance: ${result.noGrant.detailHasGuidance}; genericRetry=${result.noGrant.detailHasGenericRetry}; duplicateErrorBlock=${result.noGrant.errorBlockPresent}`,
    `- Unsupported Truly page: status=${result.unsupportedPages?.truly?.side?.status || "(missing)"}; detail=${result.unsupportedPages?.truly?.side?.detail || "(missing)"}`,
    `- Unsupported browser page: status=${result.unsupportedPages?.browser?.side?.status || "(missing)"}; detail=${result.unsupportedPages?.browser?.side?.detail || "(missing)"}`,
    "",
    "## Artifacts",
    "",
    `- ${relative(ROOT, resolve(OUT_DIR, "audit.json"))}`,
    `- ${relative(ROOT, resolve(OUT_DIR, "audit-coverage.json"))}`,
    `- ${relative(ROOT, PHASE_LOG_PATH)}`,
    isPopupReadSkipped(result) ? null : `- ${relative(ROOT, resolve(OUT_DIR, "page-popup-read-result.png"))}`,
    `- ${relative(ROOT, resolve(OUT_DIR, "page-ready-and-stale.png"))}`,
    result.success.pageBrief?.screenshot ? `- ${result.success.pageBrief.screenshot}` : null,
    result.success.responsive?.screenshot ? `- ${result.success.responsive.screenshot}` : null,
    `- ${relative(ROOT, resolve(OUT_DIR, "page-session-switcher-display.png"))}`,
    `- ${relative(ROOT, resolve(OUT_DIR, "page-session-switcher-display.json"))}`,
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

mkdirSync(OUT_DIR, { recursive: true });
const expectedBuildId = readExpectedBuildId();
const server = await startSyntheticServer();
let exitCode = 0;

try {
  const targets = await listTargets();
  const extension = await findTrulyExtension(targets, expectedBuildId, { allowStale: AUTO_RELOAD, extensionId: EXTENSION_ID });
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
