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
const EXTENSION_ID = (process.env.TRULY_EXTENSION_ID || "").trim();
const STAMP = new Date().toISOString().replace(/[:.]/g, "-");
const OUT_DIR = resolve(ROOT, "tmp", `general-page-reader-audit-${STAMP}`);

function usage() {
  console.log(`Usage: node scripts/audit-general-page-reader.mjs

Audits the General Page Reader flow in the existing Chrome CDP session.
Artifacts are written under tmp/ and must not be committed.

Environment:
  CDP_PORT=9222
  TRULY_AUDIT_AUTO_RELOAD=1   reload the loaded Truly extension before auditing
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
    await waitFor(side, `(() => /Reading context/.test(document.querySelector('#page-pane .page-reader-advisor')?.textContent || ''))()`, 8000, "Page/Web reading context").catch(async (error) => {
      await side.screenshot(resolve(OUT_DIR, "page-ready-advisor-timeout.png")).catch(() => {});
      throw error;
    });

    const ready = await side.evaluateJson(`(() => {
      const pane = document.querySelector('#page-pane');
      const advisor = pane?.querySelector('.page-reader-advisor');
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
        modelContext: (() => {
          const el = pane?.querySelector('.page-reader-model-context');
          return el ? {
            title: el.querySelector('h3')?.textContent?.trim(),
            status: el.querySelector('.page-reader-model-context-header span')?.textContent?.trim(),
            detail: el.querySelector('p')?.textContent?.trim(),
            rows: [...el.querySelectorAll('dl div')].map((row) => ({
              label: row.querySelector('dt')?.textContent?.trim(),
              value: row.querySelector('dd')?.textContent?.trim()
            }))
          } : null;
        })(),
        advisor: advisor ? {
          title: advisor.querySelector('h3')?.textContent?.trim(),
          status: advisor.querySelector('.page-reader-advisor-header span')?.textContent?.trim(),
          detail: advisor.querySelector('p')?.textContent?.trim(),
          rows: [...advisor.querySelectorAll('dl div')].map((row) => ({
            label: row.querySelector('dt')?.textContent?.trim(),
            value: row.querySelector('dd')?.textContent?.trim()
          })),
          note: advisor.querySelector('.page-reader-advisor-note')?.textContent?.trim()
        } : null,
        sourceLinks: [...pane?.querySelectorAll('.page-reader-source-links a') || []].map((el) => ({
          label: el.textContent?.trim(),
          href: el.href
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

    const selectedText = await article.evaluate(`(() => {
      const paragraph = document.querySelector('article p:nth-of-type(3)');
      const range = document.createRange();
      range.selectNodeContents(paragraph);
      const selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
      return selection.toString().replace(/\\s+/g, ' ').trim();
    })()`);
    await side.evaluate(`document.querySelector('#pageReadSelection')?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })); undefined`);
    await waitFor(side, `(() => {
      const pane = document.querySelector('#page-pane');
      return /targetKind|目標/.test(pane?.innerText || '') && /selection/.test(pane?.innerText || '');
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
          value: row.querySelector('dd')?.textContent?.trim()
        })),
        advisorRows: [...advisor?.querySelectorAll('dl div') || []].map((row) => ({
          label: row.querySelector('dt')?.textContent?.trim(),
          value: row.querySelector('dd')?.textContent?.trim()
        })),
        advisorStatus: advisor?.querySelector('.page-reader-advisor-header span')?.textContent?.trim(),
      };
    })()`);
    await side.screenshot(resolve(OUT_DIR, "page-selection-target.png"));

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

    return { initial, ready, copy, selection: { selectedText, ...selection }, afterHash, afterTracking, afterMeaningful };
  } finally {
    await side.closeTarget().catch(() => {});
    await article.closeTarget().catch(() => {});
    side.close();
    article.close();
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
    await waitFor(side, `(() => /需改善抽取|Extraction needs improvement/.test(document.querySelector('#page-pane')?.innerText || ''))()`, 8000, "Page/Web noisy fallback caution state").catch(async (error) => {
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
      return /Reading context/.test(advisor?.textContent || '') && !/檢查中|Checking/.test(status);
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
        modelContext: model ? {
          status: model.querySelector('.page-reader-model-context-header span')?.textContent?.trim(),
          detail: model.querySelector('p')?.textContent?.trim(),
          className: model.className
        } : null,
        advisor: advisor ? {
          title: advisor.querySelector('h3')?.textContent?.trim(),
          status: advisor.querySelector('.page-reader-advisor-header span')?.textContent?.trim(),
          detail: advisor.querySelector('p')?.textContent?.trim(),
          rows: [...advisor.querySelectorAll('dl div')].map((row) => ({
            label: row.querySelector('dt')?.textContent?.trim(),
            value: row.querySelector('dd')?.textContent?.trim()
          })),
          note: advisor.querySelector('.page-reader-advisor-note')?.textContent?.trim(),
          className: advisor.className
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
    await side.screenshot(resolve(OUT_DIR, "page-noisy-caution.png"));
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
      const text = advisor?.textContent || '';
      const status = advisor?.querySelector('.page-reader-advisor-header span')?.textContent?.trim() || '';
      return /prefer_candidate_block/.test(text) && !/檢查中|Checking/.test(status);
    })()`, 26000, "candidate block advisor decision").catch(async (error) => {
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
        modelContext: model ? {
          status: model.querySelector('.page-reader-model-context-header span')?.textContent?.trim(),
          detail: model.querySelector('p')?.textContent?.trim(),
          className: model.className
        } : null,
        advisor: advisor ? {
          title: advisor.querySelector('h3')?.textContent?.trim(),
          status: advisor.querySelector('.page-reader-advisor-header span')?.textContent?.trim(),
          detail: advisor.querySelector('p')?.textContent?.trim(),
          rows: [...advisor.querySelectorAll('dl div')].map((row) => ({
            label: row.querySelector('dt')?.textContent?.trim(),
            value: row.querySelector('dd')?.textContent?.trim()
          })),
          note: advisor.querySelector('.page-reader-advisor-note')?.textContent?.trim(),
          className: advisor.className
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
  if (!/模型脈絡|Model context/.test(result.success.ready.modelContext?.title || "")) {
    errors.push("Page/Web pane does not show model context readiness");
  }
  if (!/可送模型|Model-ready/.test(result.success.ready.modelContext?.status || "")) {
    errors.push(`unexpected model context status: ${result.success.ready.modelContext?.status || "(missing)"}`);
  }
  if (!hasPassingTextThresholdRow(result.success.ready.modelContext?.rows)) {
    errors.push("model context text threshold row is missing or incorrect");
  }
  if (!/Reading context/.test(result.success.ready.advisor?.title || "")) {
    errors.push("Page/Web pane does not show Reading context advisor state");
  }
  if (!/本地通過|Local pass/.test(result.success.ready.advisor?.status || "")) {
    errors.push(`successful read advisor should be local pass: ${result.success.ready.advisor?.status || "(missing)"}`);
  }
  if (!result.success.ready.advisor?.rows?.some((row) => /判斷|Decision/.test(row.label || "") && row.value === "accept_current")) {
    errors.push("successful read advisor does not preserve accept_current effective context");
  }
  if (!result.success.ready.sourceLinks?.some((link) => link.label === "Source link" && /\/source$/.test(link.href))) {
    errors.push("Page/Web pane does not expose extracted source links for early inspection");
  }
  if (!result.success.copy.hasTitle || !result.success.copy.hasUrl || !result.success.copy.hasExcerpt || result.success.copy.hasFullTail) {
    errors.push("copy metadata boundary failed");
  }
  if (!result.success.selection?.selectedText || !result.success.selection.excerpt?.includes(result.success.selection.selectedText.slice(0, 60))) {
    errors.push("selection target text was not rendered as the Page/Web preview");
  }
  if (!result.success.selection?.modelRows?.some((row) => /目標|Target/.test(row.label || "") && row.value === "selection")) {
    errors.push("selection target did not switch model context targetKind to selection");
  }
  if (!result.success.selection?.advisorRows?.some((row) => /判斷|Decision/.test(row.label || "") && row.value === "accept_current")) {
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
  if (!/需改善抽取|Extraction needs improvement/.test(result.noisy.ready.modelContext?.status || "")) {
    errors.push(`noisy fallback model context was not downgraded to caution: ${result.noisy.ready.modelContext?.status || "(missing)"}`);
  }
  if (!/fallback|Fallback/.test(result.noisy.ready.modelContext?.detail || "")) {
    errors.push("noisy fallback model context does not explain fallback extraction quality");
  }
  if (!/is-caution/.test(result.noisy.ready.modelContext?.className || "")) {
    errors.push("noisy fallback model context does not use caution UI state");
  }
  if (!result.noisy.ready.meta?.some((row) => /抽取方式|Method/.test(row.label || "") && row.value === "fallback")) {
    errors.push("noisy fallback audit did not exercise fallback extraction");
  }
  if (!result.noisy.ready.meta?.some((row) => /狀態|Status/.test(row.label || "") && row.value === "partial")) {
    errors.push("noisy fallback audit did not exercise partial extraction");
  }
  if (!result.noisy.ready.sourceLinks?.some((link) => link.label === "Article source" && /\/source$/.test(link.href))) {
    errors.push("noisy fallback audit did not preserve the real article source link");
  }
  if (result.noisy.ready.hasEdgeDownload || result.noisy.ready.hasFirefoxDownload || result.noisy.ready.hasGoogleDownload) {
    errors.push("noisy fallback audit still exposes browser download links as source context");
  }
  if (!/Reading context/.test(result.noisy.ready.advisor?.title || "")) {
    errors.push("noisy fallback does not show Reading context advisor state");
  }
  if (/檢查中|Checking/.test(result.noisy.ready.advisor?.status || "")) {
    errors.push("noisy fallback advisor remained pending");
  }
  const noisyAdvisorRows = result.noisy.ready.advisor?.rows || [];
  const noisyDecision = noisyAdvisorRows.find((row) => /判斷|Decision/.test(row.label || ""))?.value || "";
  const noisyUse = noisyAdvisorRows.find((row) => /用途|Use/.test(row.label || ""))?.value || "";
  if (noisyDecision !== "downgrade_to_index_or_feed") {
    errors.push(`noisy fallback advisor did not downgrade to index/feed: ${noisyDecision || "(missing)"}`);
  }
  if (noisyUse !== "page_overview_only") {
    errors.push(`noisy fallback effective context was not page overview only: ${noisyUse || "(missing)"}`);
  }
  if (result.candidate.ready.status !== "已讀取" && result.candidate.ready.status !== "Ready") {
    errors.push(`candidate block recovery did not reach ready status: ${result.candidate.ready.status}`);
  }
  const candidateAdvisorRows = result.candidate.ready.advisor?.rows || [];
  const candidateDecision = candidateAdvisorRows.find((row) => /判斷|Decision/.test(row.label || ""))?.value || "";
  const candidateUse = candidateAdvisorRows.find((row) => /用途|Use/.test(row.label || ""))?.value || "";
  if (candidateDecision !== "prefer_candidate_block") {
    errors.push(`candidate block recovery did not prefer candidate block: ${candidateDecision || "(missing)"}`);
  }
  if (candidateUse !== "article_or_selection_analysis") {
    errors.push(`candidate block effective context was not article analysis: ${candidateUse || "(missing)"}`);
  }
  if (!result.candidate.ready.hasFullCandidateContinuation) {
    errors.push("candidate block recovery did not render the re-extracted full candidate text");
  }
  if (!result.candidate.ready.hasCandidateSource) {
    errors.push("candidate block recovery did not preserve candidate source link visibility");
  }
  if (!result.noGrant.hasGuidance) errors.push("no-grant sidepanel path did not show toolbar activation guidance");
  if (!result.noGrant.hasAllSitesGuidance) errors.push("no-grant sidepanel path did not mention all-sites settings access");
  return errors;
}

function hasPassingTextThresholdRow(rows) {
  const row = rows?.find((item) => /文字門檻|Text threshold/.test(item.label || ""));
  const match = String(row?.value ?? "").match(/^(\d+)\/240$/);
  return Boolean(match && Number(match[1]) >= 240);
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
    `- Model context: ${result.success.ready.modelContext?.status || "(missing)"}`,
    `- Reading context: ${result.success.ready.advisor?.status || "(missing)"}`,
    `- Selection target: ${result.success.selection?.advisorStatus || "(missing)"}`,
    `- Source links visible: ${result.success.ready.sourceLinks?.length || 0}`,
    `- Noisy fallback model context: ${result.noisy.ready.modelContext?.status || "(missing)"}`,
    `- Noisy fallback reading context: ${result.noisy.ready.advisor?.status || "(missing)"}`,
    `- Noisy fallback source links: ${(result.noisy.ready.sourceLinks || []).map((link) => link.label).join(", ") || "(none)"}`,
    `- Candidate block recovery: ${result.candidate.ready.advisor?.status || "(missing)"}`,
    `- Hash-only stale: ${result.success.afterHash.stale}`,
    `- Tracking-only stale: ${result.success.afterTracking.stale}`,
    `- Meaningful URL stale: ${result.success.afterMeaningful.stale}`,
    `- Meaningful URL scrubbed stale surface: ${!result.success.afterMeaningful.oldExcerptVisible && !result.success.afterMeaningful.sourceLinkVisible}`,
    `- Copy metadata title/url/excerpt: ${result.success.copy.hasTitle}/${result.success.copy.hasUrl}/${result.success.copy.hasExcerpt}`,
    `- No-grant guidance: ${result.noGrant.hasGuidance}`,
    `- No-grant all-sites settings guidance: ${result.noGrant.hasAllSitesGuidance}`,
    "",
    "## Artifacts",
    "",
    `- ${relative(ROOT, resolve(OUT_DIR, "audit.json"))}`,
    `- ${relative(ROOT, resolve(OUT_DIR, "page-ready-and-stale.png"))}`,
    `- ${relative(ROOT, resolve(OUT_DIR, "page-selection-target.png"))}`,
    `- ${relative(ROOT, resolve(OUT_DIR, "page-noisy-caution.png"))}`,
    `- ${relative(ROOT, resolve(OUT_DIR, "page-candidate-block.png"))}`,
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
      noGrant: `${server.noGrantBase}/article`,
    },
    popup: await auditPopup(extensionId, `${server.allowedBase}/article`),
    success: await auditSuccessfulRead(extensionId, server.allowedBase),
    noisy: await auditNoisyFallbackRead(extensionId, server.allowedBase),
    candidate: await auditCandidateBlockRecovery(extensionId, server.allowedBase),
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
  if (!result.ok) exitCode = 1;
} catch (error) {
  const failure = {
    capturedAt: new Date().toISOString(),
    cdpBase: CDP_BASE,
    expectedBuildId,
    error: error instanceof Error ? error.message : String(error),
    stack: error instanceof Error ? error.stack : undefined,
    artifactDir: relative(ROOT, OUT_DIR),
  };
  writeFileSync(resolve(OUT_DIR, "audit-failure.json"), JSON.stringify(failure, null, 2));
  console.error(`General Page Reader CDP audit failed: ${failure.error}`);
  console.error(`artifact: ${relative(ROOT, OUT_DIR)}`);
  exitCode = 1;
} finally {
  await server.close();
}

process.exit(exitCode);
