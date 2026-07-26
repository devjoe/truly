#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { connectCdp } from "./lib/cdp-client.mjs";
import { findInvestigationServiceWorker, isPrivateCaptureOutputPath } from "./collect-general-page-runtime-envelopes-cdp.mjs";

const DEFAULT_ENDPOINT = "http://127.0.0.1:9222";
const DEFAULT_TIMEOUT_MS = 120_000;
const POLL_MS = 200;
export const PAGE_AUTO_READ_GRACE_MS = 4_000;
export const FACEBOOK_MESSAGE_SELECTORS = [
  "[data-ad-rendering-role='story_message']",
  "[data-ad-preview='message']",
  "[data-ad-comet-preview='message']",
];

if (isDirectRun()) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}

export function validateAcquisitionUrls(values) {
  if (!Array.isArray(values) || values.length === 0) throw new Error("--input must contain a non-empty JSON array");
  return values.map((value) => {
    if (typeof value !== "string") throw new Error("every input URL must be a string");
    const url = new URL(value);
    if (!/^https?:$/.test(url.protocol) || url.username || url.password) {
      throw new Error(`unsafe acquisition URL: ${url.origin}`);
    }
    return url.href;
  });
}

export function acquisitionUrlsFromCapturePacket(packet, offset = 0) {
  if (!Array.isArray(packet?.captures) || packet.captures.length === 0)
    throw new Error("--input-capture must contain non-empty captures");
  if (!Number.isInteger(offset) || offset < 0)
    throw new Error("capture input offset must be a non-negative integer");
  return validateAcquisitionUrls(packet.captures.slice(offset).map((capture) => {
    const context = capture?.analysis?.context;
    return context?.canonicalUrl || context?.url;
  }));
}

export function isMetadataReportPath(value, cwd = process.cwd()) {
  return isPrivateCaptureOutputPath(value, cwd);
}

export function hashAcquisitionText(value) {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

export function acquisitionUrlsMatch(left, right) {
  try {
    const normalized = (value) => {
      const url = new URL(value);
      url.hash = "";
      return url.href;
    };
    return normalized(left) === normalized(right);
  } catch {
    return false;
  }
}

export function publisherRedirectPending(inputValue, currentValue) {
  try {
    const input = new URL(inputValue);
    const current = new URL(currentValue);
    return input.hostname === "news.google.com" &&
      input.pathname.startsWith("/read/") &&
      current.hostname === "news.google.com";
  } catch {
    return false;
  }
}

export function equivalentPageCaptureMetadata(left, right) {
  if (!left || !right)
    return false;
  return left.tabId === right.tabId &&
    left.scope === right.scope &&
    left.targetKind === right.targetKind &&
    left.extractionMethod === right.extractionMethod &&
    left.extractionStatus === right.extractionStatus &&
    left.mainTextLength === right.mainTextLength &&
    left.mainTextHash === right.mainTextHash &&
    left.candidateCount === right.candidateCount &&
    left.candidateTextLength === right.candidateTextLength &&
    acquisitionUrlsMatch(left.contextUrl, right.contextUrl);
}

export function pageSurfaceMatchesSourceTitle(cardTitle, sourceTitle) {
  const clean = (value) => String(value ?? "").replace(/\s+/g, " ").trim();
  const card = clean(cardTitle);
  const source = clean(sourceTitle);
  if (card.length < 5 || source.length < 5) return false;
  return card === source || source.startsWith(card) || card.startsWith(source);
}

export function shouldTriggerPageReread({
  elapsedMs,
  sawPageBusy,
  canReread,
  titleMatches,
}) {
  return elapsedMs >= PAGE_AUTO_READ_GRACE_MS &&
    !sawPageBusy &&
    canReread &&
    titleMatches;
}

export function canContinueAfterSourceFailure(failureCount, maximumFailures) {
  return Number.isInteger(failureCount) &&
    failureCount >= 0 &&
    Number.isInteger(maximumFailures) &&
    maximumFailures >= 0 &&
    failureCount < maximumFailures;
}

export async function emulateBackgroundPageVisibility(client) {
  await client.send("Page.enable").catch(() => undefined);
  await client.send("Emulation.setFocusEmulationEnabled", { enabled: true });
  await client.send("Page.setWebLifecycleState", { state: "active" }).catch(() => undefined);
}

export function selectFacebookMessageInDocument(
  documentRef,
  selection,
  selectors = FACEBOOK_MESSAGE_SELECTORS,
  usedHashes = [],
) {
  const clean = (value) => String(value || "").replace(/\s+/g, " ").trim();
  const hash = (value) => {
    let result = 2166136261;
    for (let index = 0; index < value.length; index += 1) {
      result ^= value.charCodeAt(index);
      result = Math.imul(result, 16777619);
    }
    return (result >>> 0).toString(16).padStart(8, "0");
  };
  const used = new Set(usedHashes);
  const nodeFilter = documentRef.defaultView?.NodeFilter ?? globalThis.NodeFilter;
  if (!nodeFilter || !selection)
    return null;

  // Prefer the most specific selector that exists. A fallback wrapper must not
  // expand a range already represented by story_message.
  let candidates = [];
  for (const selector of selectors) {
    candidates = [...documentRef.querySelectorAll(selector)];
    if (candidates.length > 0)
      break;
  }

  for (const candidate of candidates) {
    const walker = documentRef.createTreeWalker(candidate, nodeFilter.SHOW_TEXT);
    let firstTextNode = null;
    let lastTextNode = null;
    let current = walker.nextNode();
    while (current) {
      const parent = current.parentElement;
      const value = clean(current.nodeValue);
      if (!parent || !value) {
        current = walker.nextNode();
        continue;
      }

      const hiddenAncestor = parent.closest("[hidden], [aria-hidden=\"true\"]");
      const style = documentRef.defaultView?.getComputedStyle(parent);
      if (hiddenAncestor || style?.display === "none" || style?.visibility === "hidden") {
        // A Selection Range is contiguous. Once authored text has started, a
        // hidden node would be included again if we continued to a later node.
        if (firstTextNode)
          break;
        current = walker.nextNode();
        continue;
      }

      const renderingRole = parent.closest("[data-ad-rendering-role]");
      const entersNestedUiRole = renderingRole &&
        renderingRole !== candidate &&
        renderingRole.getAttribute("data-ad-rendering-role") !== "story_message";
      const entersControl = Boolean(parent.closest(
        "button, [role=\"button\"], [role=\"menu\"], [role=\"menuitem\"], input, select, textarea",
      ));
      if (entersNestedUiRole || entersControl) {
        if (firstTextNode)
          break;
        current = walker.nextNode();
        continue;
      }

      firstTextNode ??= current;
      lastTextNode = current;
      current = walker.nextNode();
    }

    if (!firstTextNode || !lastTextNode)
      continue;
    const range = documentRef.createRange();
    range.setStart(firstTextNode, 0);
    range.setEnd(lastTextNode, lastTextNode.nodeValue?.length ?? 0);
    selection.removeAllRanges();
    selection.addRange(range);
    const selectedText = clean(selection.toString());
    if (selectedText.length < 80 || selectedText.length > 4000) {
      selection.removeAllRanges();
      continue;
    }
    const valueHash = hash(selectedText);
    if (used.has(valueHash)) {
      selection.removeAllRanges();
      continue;
    }
    return { length: selectedText.length, hash: valueHash, text: selectedText };
  }
  return null;
}

export function assertSelectionCaptureMatch(capture, selection) {
  if (!selection)
    return;
  if (!capture?.mainTextHash || !capture?.selectedTextHash) {
    throw new Error("Focus capture lacks selection provenance");
  }
  if (selection.hash !== capture.mainTextHash || selection.hash !== capture.selectedTextHash) {
    throw new Error("Focus capture does not match the authorized Selection text");
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!isMetadataReportPath(args.report)) throw new Error("--report must stay under tmp or a system-private temp directory");
  const reportPath = path.resolve(args.report);
  if (fs.existsSync(reportPath)) throw new Error("--report already exists; use a fresh path");

  const inputUrls = args.mode === "facebook-focus"
    ? [validateAcquisitionUrls([args.facebookUrl])[0]]
    : args.inputCapture
    ? acquisitionUrlsFromCapturePacket(JSON.parse(fs.readFileSync(args.inputCapture, "utf8")), args.inputOffset)
    : validateAcquisitionUrls(JSON.parse(fs.readFileSync(args.input, "utf8")));
  if (args.mode !== "facebook-focus" && inputUrls.length < args.count) {
    throw new Error(`input has ${inputUrls.length} URLs, fewer than requested ${args.count}`);
  }

  const targets = await listTargets(args.endpoint);
  const workerTarget = await findInvestigationServiceWorker(targets);
  if (!workerTarget) throw new Error("Truly extension service worker target not found");
  const worker = connectCdp(workerTarget.webSocketDebuggerUrl, { commandTimeoutMs: 10_000 });
  const openedTabIds = [];
  let sideTarget;
  try {
    const extensionId = await worker.evaluate("chrome.runtime.id");
    const buildId = await worker.evaluate("globalThis.__TRULY_BUILD_ID || null");
    const armState = await waitForCaptureArm(worker, args.timeoutMs, { requireEmpty: !args.resume });
    await resetCaptureConsumerHandshake(worker);
    console.error(`capture armed; acquiring ${args.count} ${args.mode} envelopes without requesting window focus${args.resume ? ` (resume from ${armState.count} buffered rows)` : ""}`);

    const sideUrl = `chrome-extension://${extensionId}/sidepanel/sidepanel.html`;
    // A globally discovered side panel can belong to a different Chrome window
    // than the inactive source tabs created below. Keep the audit isolated from
    // the user's visible panel and give it a dedicated background tab instead.
    const side = await createInactiveTab(worker, `${sideUrl}?runtimeEnvelopeAcquisition=${Date.now()}`);
    openedTabIds.push(side.id);
    sideTarget = await waitForTabTarget(args.endpoint, side.id, side.url, args.timeoutMs);
    const sideClient = connectCdp(sideTarget.webSocketDebuggerUrl, { commandTimeoutMs: 10_000 });
    const samples = [];
    const sourceFailures = [];
    try {
      await waitForDocument(sideClient, args.timeoutMs);
      if (!args.resume) {
        await sleep(750);
        await clearCaptureBuffer(worker);
      }
      if (args.mode === "facebook-focus") {
        const source = args.facebookExistingTab
          ? await openExistingFacebookSource(worker, args.endpoint, args.timeoutMs)
          : await openSource(worker, args.endpoint, inputUrls[0], args.timeoutMs);
        if (!source.existing) openedTabIds.push(source.tab.id);
        const originalScrollY = source.existing
          ? await source.client.evaluate("window.scrollY").catch(() => 0)
          : 0;
        try {
          if (!source.existing || !source.wasActive) await activateTabWithoutWindowFocus(worker, source.tab.id);
          await waitForFacebookDocumentComplete(source.client, args.timeoutMs);
          await advanceFacebookFeed(source.client, args.facebookStartScrolls);
          await sideClient.reload();
          await waitForDocument(sideClient, args.timeoutMs);
          await sleep(750);
          await selectWorkspace(sideClient, "focus");
          const initialUsedHashes = await captureTextHashes(worker, "focus");
          await acquireFacebookFocus({ worker, sideClient, source, count: args.count, timeoutMs: args.timeoutMs, samples, initialUsedHashes });
        } finally {
          if (source.existing) {
            await source.client.evaluate(`(() => {
              window.getSelection()?.removeAllRanges();
              window.scrollTo(0, ${Number(originalScrollY) || 0});
              return true;
            })()`).catch(() => undefined);
            if (Number.isInteger(source.previousActiveTabId) && source.previousActiveTabId !== source.tab.id) {
              await activateTabWithoutWindowFocus(worker, source.previousActiveTabId).catch(() => undefined);
            }
          }
          source.client.close();
        }
      } else {
        for (const url of inputUrls) {
          if (samples.length >= args.count)
            break;
          const expectedScope = args.mode === "page" ? "page" : "focus";
          const before = await captureCount(worker, expectedScope);
          let stage = "open-source";
          let source = null;
          try {
            source = await openSource(worker, args.endpoint, url, args.timeoutMs);
            openedTabIds.push(source.tab.id);
            let selection = null;
            stage = "activate-background-tab";
            await activateTabWithoutWindowFocus(worker, source.tab.id);
            if (args.mode === "focus") {
              stage = "select-focus-text";
              selection = await selectGeneralPageText(source.client);
            }
            stage = "select-workspace";
            await selectWorkspace(sideClient, args.mode === "page" ? "page" : "focus");
            stage = "trigger-or-wait";
            if (args.mode === "focus") await clickFocusAction(sideClient, args.timeoutMs);
            else await waitForPageAutoReadOrReread(
              worker,
              sideClient,
              before,
              args.timeoutMs,
              source.matchUrl,
              source.title,
            );
            stage = "read-capture-metadata";
            const capture = await waitForSingleCapture(worker, before, args.mode, args.timeoutMs, {
              selection,
              tabId: source.tab.id,
            });
            assertSelectionCaptureMatch(capture, selection);
            samples.push(sampleMetadata(url, capture, selection));
          } catch (error) {
            if (source) await removeCapturesForTab(worker, source.tab.id);
            if (!canContinueAfterSourceFailure(sourceFailures.length, args.maxSourceFailures)) {
              throw acquisitionError(stage, url, error);
            }
            sourceFailures.push({
              origin: new URL(url).origin,
              stage,
              message: error instanceof Error ? error.message : String(error),
            });
          } finally {
            source?.client.close();
            if (source) {
              await removeTab(worker, source.tab.id);
              openedTabIds.splice(openedTabIds.indexOf(source.tab.id), 1);
            }
          }
        }
        if (samples.length < args.count) {
          throw new Error(`input sources produced only ${samples.length} of ${args.count} required captures after ${sourceFailures.length} tolerated failure(s)`);
        }
      }
    } finally {
      sideClient.close();
    }

    await worker.evaluate("(() => { const capture = globalThis.__trulyGeneralPageInvestigationCapture; if (!capture) return false; capture.consumerDone = true; return true; })()");

    fs.mkdirSync(path.dirname(reportPath), { recursive: true, mode: 0o700 });
    fs.writeFileSync(reportPath, `${JSON.stringify({
      schemaVersion: 1,
      generatedAt: new Date().toISOString(),
      mode: args.mode,
      requested: args.count,
      captured: samples.length,
      buildId,
      targetActivated: false,
      browserFocusRequested: false,
      sourceFailures,
      containsPageText: false,
      samples,
    }, null, 2)}\n`, { flag: "wx", mode: 0o600 });
    console.log(JSON.stringify({ result: samples.length === args.count ? "pass" : "fail", report: privatePathLabel(reportPath), captured: samples.length, requested: args.count, targetActivated: false, browserFocusRequested: false }, null, 2));
  } finally {
    for (const tabId of openedTabIds.reverse()) await removeTab(worker, tabId).catch(() => undefined);
    worker.close();
  }
}

async function acquireFacebookFocus({ worker, sideClient, source, count, timeoutMs, samples, initialUsedHashes = [] }) {
  const used = new Set(initialUsedHashes);
  const initialUsedCount = used.size;
  let stalledScrolls = 0;
  while (samples.length < count) {
    await selectWorkspace(sideClient, "focus");
    const selection = await selectFacebookMessage(source.client, [...used]);
    if (!selection) {
      if (stalledScrolls >= 12) throw new Error(`Facebook supplied only ${used.size - initialUsedCount} unique eligible message bodies`);
      stalledScrolls += 1;
      await source.client.evaluate("window.scrollBy(0, Math.max(innerHeight * 0.85, 600)); true");
      await sleep(1200);
      continue;
    }
    stalledScrolls = 0;
    const before = await captureCount(worker, "focus");
    if (!await facebookSelectionMatches(source.client, selection.hash))
      continue;
    await clickFocusAction(sideClient, timeoutMs);
    const capture = await waitForSingleCapture(worker, before, "focus", timeoutMs, {
      selection,
      tabId: source.tab.id,
      sideClient,
      selectionText: selection.text,
    });
    if (!capture) {
      used.add(selection.hash);
      continue;
    }
    assertSelectionCaptureMatch(capture, selection);
    used.add(selection.hash);
    samples.push(sampleMetadata(source.tab.url, capture, selection));
  }
}

async function facebookSelectionMatches(client, expectedHash) {
  const hashSource = hashAcquisitionText.toString();
  return client.evaluate(`(() => {
    const hash = ${hashSource};
    return hash(window.getSelection()?.toString() || "") === ${JSON.stringify(expectedHash)};
  })()`).catch(() => false);
}

async function waitForFacebookDocumentComplete(client, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const ready = await client.evaluate(`(() => {
      if (document.readyState !== "complete") return false;
      const selectors = ${JSON.stringify(FACEBOOK_MESSAGE_SELECTORS)};
      return selectors.some((selector) => [...document.querySelectorAll(selector)]
        .some((node) => String(node.innerText || node.textContent || "").replace(/\\s+/g, " ").trim().length >= 80));
    })()`);
    if (ready) return;
    await sleep(POLL_MS);
  }
  throw new Error("Facebook did not finish rendering an eligible authored message in time");
}

async function advanceFacebookFeed(client, scrolls) {
  for (let index = 0; index < scrolls; index += 1) {
    await client.evaluate("window.scrollBy(0, Math.max(innerHeight * 0.9, 650)); true");
    await sleep(900);
  }
}

async function openSource(worker, endpoint, url, timeoutMs) {
  const auditUrl = withAuditMarker(url);
  const tab = await createInactiveTab(worker, auditUrl);
  const target = await waitForTabTarget(endpoint, tab.id, auditUrl, timeoutMs);
  const client = connectCdp(target.webSocketDebuggerUrl, { commandTimeoutMs: 10_000 });
  if (/^https?:\/\/(?:www\.)?facebook\.com\//.test(url)) {
    await emulateBackgroundPageVisibility(client);
  }
  await waitForDocument(client, timeoutMs);
  await waitForHttpLocation(client, timeoutMs);
  await waitForPublisherRedirect(client, url, timeoutMs);
  await waitForDocument(client, timeoutMs);
  await sleep(750);
  const finalUrl = await client.evaluate("location.href");
  const title = await client.evaluate("document.title");
  const matchUrl = await client.evaluate("document.querySelector('link[rel=\"canonical\"]')?.href || location.href");
  return { tab: { ...tab, url: finalUrl }, target, client, title, matchUrl };
}

async function waitForPublisherRedirect(client, inputUrl, timeoutMs) {
  let currentUrl = await client.evaluate("location.href").catch(() => "");
  if (!publisherRedirectPending(inputUrl, currentUrl))
    return;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await sleep(POLL_MS);
    currentUrl = await client.evaluate("location.href").catch(() => "");
    if (!publisherRedirectPending(inputUrl, currentUrl))
      return;
  }
  throw new Error("Google News read link did not redirect to a publisher");
}

async function openExistingFacebookSource(worker, endpoint, timeoutMs) {
  const tab = await worker.evaluate(`new Promise((resolve) => chrome.windows.getLastFocused({}, (window) => {
    if (!Number.isInteger(window?.id)) return resolve(null);
    chrome.tabs.query({ windowId: window.id }, (tabs) => {
      const tab = tabs.find((candidate) => /^https?:\\/\\/(?:www\\.)?facebook\\.com\\//.test(candidate?.url || ""));
      const previous = tabs.find((candidate) => candidate.active);
      resolve(tab ? {
        id: tab.id,
        url: tab.url,
        title: tab.title,
        wasActive: tab.active === true,
        previousActiveTabId: previous?.id,
      } : null);
    });
  }))`);
  if (!Number.isInteger(tab?.id) || !tab?.url) {
    throw new Error("the last focused Chrome window has no Facebook tab");
  }
  const target = await waitForTabTarget(endpoint, tab.id, tab.url, timeoutMs);
  const client = connectCdp(target.webSocketDebuggerUrl, { commandTimeoutMs: 10_000 });
  await emulateBackgroundPageVisibility(client);
  await waitForDocument(client, timeoutMs);
  return {
    tab,
    target,
    client,
    title: tab.title || "",
    matchUrl: tab.url,
    existing: true,
    wasActive: tab.wasActive === true,
    previousActiveTabId: tab.previousActiveTabId,
  };
}

function withAuditMarker(value) {
  const url = new URL(value);
  url.hash = `truly-gpr-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return url.href;
}

async function createInactiveTab(worker, url) {
  const result = await worker.evaluate(`new Promise((resolve) => chrome.tabs.create({ url: ${JSON.stringify(url)}, active: false }, (tab) => resolve({ id: tab?.id, url: tab?.pendingUrl || tab?.url || ${JSON.stringify(url)} })))`);
  if (!Number.isInteger(result?.id)) throw new Error(`unable to create inactive tab for ${new URL(url).origin}`);
  return result;
}

async function activateTabWithoutWindowFocus(worker, tabId) {
  const result = await worker.evaluate(`new Promise((resolve) => chrome.tabs.update(${tabId}, { active: true }, (tab) => resolve({ ok: !chrome.runtime.lastError, error: chrome.runtime.lastError?.message || "", id: tab?.id })))`);
  if (!result?.ok) throw new Error(`unable to activate background tab ${tabId}: ${result?.error || "unknown"}`);
  await sleep(250);
}

async function removeTab(worker, tabId) {
  await worker.evaluate(`new Promise((resolve) => chrome.tabs.remove(${tabId}, () => resolve(true)))`).catch(() => undefined);
}

async function waitForTabTarget(endpoint, tabId, url, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const targets = await listTargets(endpoint);
    const target = targets.find((entry) => entry.type === "page" && entry.webSocketDebuggerUrl && (entry.url === url || entry.url?.startsWith(url)));
    if (target) return target;
    const workerTargets = targets.filter((entry) => entry.type === "service_worker" && entry.url?.startsWith("chrome-extension://"));
    for (const target of workerTargets) {
      const client = connectCdp(target.webSocketDebuggerUrl, { commandTimeoutMs: 3_000 });
      try {
        const matched = await client.evaluate(`new Promise((resolve) => chrome.tabs.get(${tabId}, (tab) => resolve(tab?.url || tab?.pendingUrl || "")))`).catch(() => "");
        const byUrl = targets.find((entry) => entry.type === "page" && entry.webSocketDebuggerUrl && entry.url === matched);
        if (byUrl) return byUrl;
      } finally { client.close(); }
    }
    await sleep(POLL_MS);
  }
  throw new Error(`tab ${tabId} did not expose an inspectable target for ${new URL(url).origin}`);
}

async function waitForDocument(client, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const ready = await client.evaluate("document.readyState === 'complete' || document.readyState === 'interactive'").catch(() => false);
    if (ready) return;
    await sleep(POLL_MS);
  }
  throw new Error("document did not become ready");
}

async function waitForHttpLocation(client, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await client.evaluate("location.href").catch(() => "");
    if (/^https?:\/\//.test(value)) return value;
    await sleep(POLL_MS);
  }
  throw new Error("background tab remained at a non-HTTP location");
}

async function waitForCaptureArm(worker, timeoutMs, options = {}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const state = await worker.evaluate("(() => { const c = globalThis.__trulyGeneralPageInvestigationCapture; return { enabled: Boolean(c?.enabled), count: c?.items?.length ?? -1 }; })()");
    if (state.enabled && (options.requireEmpty === false || state.count === 0)) return state;
    await sleep(POLL_MS);
  }
  throw new Error("collector did not arm an empty runtime-envelope capture buffer in time");
}

async function resetCaptureConsumerHandshake(worker) {
  const reset = await worker.evaluate("(() => { const capture = globalThis.__trulyGeneralPageInvestigationCapture; if (!capture?.enabled) return false; capture.consumerDone = false; return true; })()");
  if (!reset) throw new Error("collector handshake became unavailable before acquisition started");
}

async function clearCaptureBuffer(worker) {
  const cleared = await worker.evaluate("(() => { const capture = globalThis.__trulyGeneralPageInvestigationCapture; if (!capture?.enabled || !Array.isArray(capture.items)) return false; capture.items.splice(0, capture.items.length); capture.consumerDone = false; return true; })()");
  if (!cleared) throw new Error("collector buffer became unavailable before acquisition started");
}

async function captureCount(worker, scope) {
  return worker.evaluate(`(() => {
    const items = globalThis.__trulyGeneralPageInvestigationCapture?.items;
    if (!Array.isArray(items)) return -1;
    return items.filter((item) => item?.analysis?.scope === ${JSON.stringify(scope)}).length;
  })()`);
}

async function captureTextHashes(worker, scope) {
  const hashSource = hashAcquisitionText.toString();
  return worker.evaluate(`(() => {
    const items = globalThis.__trulyGeneralPageInvestigationCapture?.items || [];
    const hash = ${hashSource};
    return items
      .filter((item) => item?.analysis?.scope === ${JSON.stringify(scope)})
      .map((item) => hash(item?.analysis?.context?.mainText || ""));
  })()`);
}

async function captureMetadata(worker, scope, index) {
  const hashSource = hashAcquisitionText.toString();
  return worker.evaluate(`(() => {
    const items = globalThis.__trulyGeneralPageInvestigationCapture?.items || [];
    const item = items.filter((candidate) => candidate?.analysis?.scope === ${JSON.stringify(scope)})[${index}];
    if (!item) return null;
    const analysis = item.analysis || {};
    const context = analysis.context || {};
    const adapter = item.adapter || {};
    const candidates = Array.isArray(adapter.candidates) ? adapter.candidates : [];
    const hash = ${hashSource};
    const mainText = typeof context.mainText === "string" ? context.mainText : "";
    const selectedText = typeof context.selectedText === "string" ? context.selectedText : "";
    return {
      tabId: analysis.tabId ?? null,
      scope: analysis.scope || null,
      targetKind: adapter.targetKind || context.targetKind || null,
      extractionMethod: context.extractionMethod || null,
      extractionStatus: context.extractionStatus || null,
      mainTextLength: mainText.length,
      mainTextHash: mainText ? hash(mainText) : null,
      selectedTextLength: selectedText.length,
      selectedTextHash: selectedText ? hash(selectedText) : null,
      contextUrl: context.canonicalUrl || context.url || null,
      candidateCount: candidates.length,
      candidateTextLength: candidates.reduce((sum, candidate) => sum + (typeof candidate?.exactText === "string" ? candidate.exactText.length : 0), 0),
    };
  })()`);
}

async function waitForSingleCapture(worker, before, expectedMode, timeoutMs, expected = {}) {
  const expectedScope = expectedMode === "page" ? "page" : "focus";
  const deadline = Date.now() + timeoutMs;
  let rejectedFocusCaptures = 0;
  while (Date.now() < deadline) {
    const count = await captureCount(worker, expectedScope);
    if (expectedScope === "focus" && count > before) {
      const captured = [];
      for (let index = before; index < count; index += 1) {
        captured.push({ index, metadata: await captureMetadata(worker, expectedScope, index) });
      }
      const matches = captured.filter(({ metadata }) =>
        metadata?.tabId === expected.tabId &&
        metadata?.mainTextHash === expected.selection?.hash &&
        metadata?.selectedTextHash === expected.selection?.hash
      );
      if (matches.length > 1) throw new Error("Focus workspace produced duplicate captures for the authorized Selection");
      const unexpected = captured.filter((entry) => !matches.includes(entry));
      if (unexpected.length) {
        await removeScopeCaptures(worker, expectedScope, unexpected.map(({ index }) => index));
        rejectedFocusCaptures += unexpected.length;
      }
      if (matches.length === 1) return matches[0].metadata;
    } else if (count > before + 1) {
      throw new Error(`expected one capture but received ${count - before}`);
    } else if (count === before + 1) {
      const metadata = await captureMetadata(worker, expectedScope, before);
      if (metadata?.scope !== expectedScope) throw new Error(`expected ${expectedScope} capture, received ${metadata?.scope || "unknown"}`);
      if (!metadata.mainTextLength || !metadata.candidateCount) throw new Error("captured envelope lacks main text or candidate spans");
      return metadata;
    }
    if (expectedScope === "focus" &&
        expected.sideClient &&
        expected.selectionText &&
        await facebookAnalysisSettled(expected.sideClient, expected.selectionText)) {
      return null;
    }
    await sleep(POLL_MS);
  }
  throw new Error(`timed out waiting for ${expectedMode} runtime envelope${rejectedFocusCaptures ? ` after rejecting ${rejectedFocusCaptures} mismatched capture(s)` : ""}`);
}

async function facebookAnalysisSettled(sideClient, selectionText) {
  return sideClient.evaluate(`(() => {
    const clean = (value) => String(value || "").replace(/\\s+/g, " ").trim();
    const fullText = clean(document.querySelector(".page-reader-focus-fulltext")?.textContent);
    const analysis = document.querySelector(".page-reader-focus-analysis .page-reader-analysis");
    return fullText === ${JSON.stringify(selectionText)} &&
      Boolean(analysis?.classList.contains("is-ready") || analysis?.classList.contains("is-error"));
  })()`).catch(() => false);
}

async function removeScopeCaptures(worker, scope, scopeIndices) {
  if (!scopeIndices.length) return;
  const removed = await worker.evaluate(`(() => {
    const items = globalThis.__trulyGeneralPageInvestigationCapture?.items;
    if (!Array.isArray(items)) return false;
    const scopeIndexes = [];
    items.forEach((item, rawIndex) => {
      if (item?.analysis?.scope === ${JSON.stringify(scope)}) scopeIndexes.push(rawIndex);
    });
    const rawIndexes = ${JSON.stringify(scopeIndices)}.map((index) => scopeIndexes[index]).filter(Number.isInteger).sort((a, b) => b - a);
    rawIndexes.forEach((rawIndex) => items.splice(rawIndex, 1));
    return rawIndexes.length;
  })()`);
  if (removed !== scopeIndices.length) throw new Error("unable to remove unexpected runtime capture");
}

async function removeCapturesForTab(worker, tabId) {
  const removed = await worker.evaluate(`(() => {
    const items = globalThis.__trulyGeneralPageInvestigationCapture?.items;
    if (!Array.isArray(items)) return 0;
    let removed = 0;
    for (let index = items.length - 1; index >= 0; index -= 1) {
      if (items[index]?.analysis?.tabId === ${Number(tabId)}) {
        items.splice(index, 1);
        removed += 1;
      }
    }
    return removed;
  })()`);
  if (!Number.isInteger(removed)) throw new Error("unable to clean failed source captures");
}

async function selectWorkspace(sideClient, workspace) {
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const ok = await sideClient.evaluate(`(() => { const button = document.querySelector('.tab[data-tab=${JSON.stringify(workspace)}]'); if (!button || button.getAttribute('aria-disabled') === 'true') return false; button.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })); return true; })()`);
    if (!ok) throw new Error(`${workspace} workspace is unavailable`);
    await sleep(250);
    const selected = await sideClient.evaluate(`document.querySelector('.tab[data-tab=${JSON.stringify(workspace)}]')?.getAttribute('aria-selected') === 'true'`).catch(() => false);
    if (selected) return;
  }
  throw new Error(`${workspace} workspace did not remain selected`);
}

async function clickFocusAction(sideClient, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const clicked = await sideClient.evaluate("(() => { const button = document.querySelector('#pageReadSelection'); if (!button || button.disabled) return false; button.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })); return true; })()").catch(() => false);
    if (clicked) return;
    await sleep(POLL_MS);
  }
  throw new Error("Focus action did not become available");
}

async function waitForPageAutoReadOrReread(
  worker,
  sideClient,
  before,
  timeoutMs,
  expectedUrl,
  expectedTitle,
) {
  const startedAt = Date.now();
  const deadline = Date.now() + timeoutMs;
  let rereadTriggered = false;
  let sawPageBusy = false;
  while (Date.now() < deadline) {
    const count = await captureCount(worker, "page");
    if (count > before) {
      const captured = [];
      for (let index = before; index < count; index += 1) {
        captured.push({ index, metadata: await captureMetadata(worker, "page", index) });
      }
      const matches = captured.filter(({ metadata }) => acquisitionUrlsMatch(metadata?.contextUrl, expectedUrl));
      const unexpected = captured.filter(({ metadata }) => !acquisitionUrlsMatch(metadata?.contextUrl, expectedUrl));
      if (unexpected.length) await removeScopeCaptures(worker, "page", unexpected.map(({ index }) => index));
      if (matches.length > 1) {
        const [first, ...duplicates] = matches;
        if (!duplicates.every(({ metadata }) => equivalentPageCaptureMetadata(first.metadata, metadata))) {
          throw new Error("Web workspace produced divergent duplicate captures for the active page");
        }
        await removeScopeCaptures(worker, "page", duplicates.map(({ index }) => index));
        return;
      }
      if (matches.length === 1) return;
    }
    if (!rereadTriggered) {
      const surface = await sideClient.evaluate(`(() => {
        const button = document.querySelector('#pageReadCurrent');
        return {
          title: document.querySelector('.page-reader-card h2')?.textContent || '',
          isBusy: Boolean(button) && button.getAttribute('aria-busy') === 'true',
          canReread: Boolean(button) &&
            button.getAttribute('aria-disabled') !== 'true' &&
            button.getAttribute('aria-busy') !== 'true' &&
            !button.disabled,
        };
      })()`).catch(() => ({ title: "", isBusy: false, canReread: false }));
      const titleMatches = pageSurfaceMatchesSourceTitle(surface.title, expectedTitle);
      if (surface.isBusy) sawPageBusy = true;
      if (shouldTriggerPageReread({
        elapsedMs: Date.now() - startedAt,
        sawPageBusy,
        canReread: surface.canReread,
        titleMatches,
      })) {
        rereadTriggered = await sideClient.evaluate(`(() => {
          const button = document.querySelector('#pageReadCurrent');
          if (!button || button.disabled || button.getAttribute('aria-disabled') === 'true') return false;
          button.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
          return true;
        })()`).catch(() => false);
      }
    }
    await sleep(POLL_MS);
  }
  throw new Error(`Web workspace did not ${rereadTriggered ? "re-read" : "auto-read"} the active page`);
}

async function selectGeneralPageText(client) {
  const result = await client.evaluate(`(() => {
    const clean = (value) => String(value || "").replace(/\\s+/g, " ").trim();
    const nodes = [...document.querySelectorAll('article p, main p, article li, main li, p, li')];
    const candidate = nodes.map((node) => ({ node, text: clean(node.textContent) }))
      .filter(({ node, text }) => text.length >= 80 && text.length <= 1800 && !node.closest('nav, header, footer, aside'))
      .sort((a, b) => b.text.length - a.text.length)[0];
    if (!candidate) return { unavailable: true, totalNodes: nodes.length, maxTextLength: Math.max(0, ...nodes.map((node) => clean(node.textContent).length)), pageUrl: location.href };
    const range = document.createRange(); range.selectNodeContents(candidate.node);
    const selection = getSelection(); selection.removeAllRanges(); selection.addRange(range);
    const selectedText = clean(selection.toString());
    return { length: selectedText.length, hash: hash(selectedText) };
    function hash(value) { let h = 2166136261; for (let i = 0; i < value.length; i += 1) { h ^= value.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0).toString(16).padStart(8, '0'); }
  })()`);
  if (result?.unavailable) throw new Error(`page has no eligible complete paragraph (nodes=${result.totalNodes}, max=${result.maxTextLength}, url=${result.pageUrl})`);
  return result;
}

async function selectFacebookMessage(client, usedHashes) {
  return client.evaluate(`(() => {
    const selectors = ${JSON.stringify(FACEBOOK_MESSAGE_SELECTORS)};
    const selectMessage = ${selectFacebookMessageInDocument.toString()};
    return selectMessage(document, getSelection(), selectors, ${JSON.stringify(usedHashes)});
  })()`);
}

function sampleMetadata(url, capture, selection) {
  return {
    origin: new URL(url).origin,
    scope: capture.scope,
    targetKind: capture.targetKind,
    extractionMethod: capture.extractionMethod,
    extractionStatus: capture.extractionStatus,
    mainTextLength: capture.mainTextLength,
    candidateCount: capture.candidateCount,
    candidateTextLength: capture.candidateTextLength,
    selectedTextLength: selection?.length ?? null,
    selectionHash: selection?.hash ?? null,
    selectionMatchesCapture: selection
      ? selection.hash === capture.mainTextHash && selection.hash === capture.selectedTextHash
      : null,
  };
}

function acquisitionError(stage, url, error) {
  const message = error instanceof Error ? error.message : String(error);
  return new Error(`${stage} failed for ${new URL(url).origin}: ${message}`);
}

async function listTargets(endpoint) {
  const response = await fetch(`${endpoint}/json/list`);
  if (!response.ok) throw new Error(`CDP target listing failed: ${response.status}`);
  return response.json();
}

function parseArgs(argv) {
  const mode = stringArg(argv, "--mode");
  const report = stringArg(argv, "--report");
  if (!new Set(["page", "focus", "facebook-focus"]).has(mode) || !report) throw new Error("Usage: --mode page|focus|facebook-focus --report tmp/report.json [--input urls.json | --facebook-url URL] [--count 15] [--max-source-failures 0]");
  const input = stringArg(argv, "--input");
  const facebookUrl = stringArg(argv, "--facebook-url");
  const inputCapture = stringArg(argv, "--input-capture");
  const inputOffset = integerArg(argv, "--input-offset", 0, 0, 10_000);
  if (inputCapture && !isMetadataReportPath(inputCapture)) throw new Error("--input-capture must stay under tmp or a system-private temp directory");
  if (inputOffset > 0 && !inputCapture) throw new Error("--input-offset requires --input-capture");
  if (mode === "facebook-focus" ? !facebookUrl : Boolean(input) === Boolean(inputCapture)) {
    throw new Error(mode === "facebook-focus"
      ? "--facebook-url is required"
      : "exactly one of --input or --input-capture is required");
  }
  if (mode === "facebook-focus" && integerArg(argv, "--max-source-failures", 0, 0, 30) !== 0) {
    throw new Error("--max-source-failures is only supported for Page and general Focus URL batches");
  }
  if (mode !== "facebook-focus" && integerArg(argv, "--facebook-start-scrolls", 0, 0, 100) !== 0) {
    throw new Error("--facebook-start-scrolls is only supported for Facebook Focus");
  }
  return {
    mode,
    report,
    input,
    inputCapture,
    inputOffset,
    facebookUrl,
    facebookExistingTab: argv.includes("--facebook-existing-tab"),
    facebookStartScrolls: integerArg(argv, "--facebook-start-scrolls", 0, 0, 100),
    endpoint: stringArg(argv, "--endpoint") ?? DEFAULT_ENDPOINT,
    count: integerArg(argv, "--count", 15, 1, 30),
    maxSourceFailures: integerArg(argv, "--max-source-failures", 0, 0, 30),
    timeoutMs: integerArg(argv, "--timeout-ms", DEFAULT_TIMEOUT_MS, 5_000, 10 * 60_000),
    resume: argv.includes("--resume"),
  };
}

function stringArg(argv, name) { const index = argv.indexOf(name); return index >= 0 ? argv[index + 1] : undefined; }
function integerArg(argv, name, fallback, min, max) { const raw = stringArg(argv, name); if (raw === undefined) return fallback; const value = Number(raw); if (!Number.isInteger(value) || value < min || value > max) throw new Error(`${name} must be an integer between ${min} and ${max}`); return value; }
function privatePathLabel(value) { const tmp = path.resolve(process.cwd(), "tmp") + path.sep; return value.startsWith(tmp) ? path.relative(process.cwd(), value) : "<private-temp-path>"; }
function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }
function isDirectRun() { return process.argv[1] && import.meta.url === new URL(process.argv[1], "file:").href; }
