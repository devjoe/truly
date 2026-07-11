export const MEANINGFUL_NAVIGATION_ARTIFACTS = Object.freeze({
  screenshot: "page-ready-and-stale.png",
});

const HASH_SETTLE_MS = 300;
const TRACKING_SETTLE_MS = 300;
const MEANINGFUL_SETTLE_MS = 1200;

async function installTimeline(side) {
  await side.evaluate(`(() => {
    const startedAt = performance.now();
    const entries = [];
    let signature = "";
    const capture = () => {
      const pane = document.querySelector("#page-pane");
      const session = globalThis.__trulyPageReadingRuntime?.auditState?.().displayedSession || null;
      const entry = {
        elapsedMs: Math.round(performance.now() - startedAt),
        requestId: session?.requestId || null,
        sessionStatus: session?.status || null,
        hasSurface: session?.hasSurface === true,
        staleVisible: /頁面已變更|Page changed/.test(pane?.innerText || ""),
        loadingVisible: /讀取中|Reading/.test(pane?.querySelector(".page-reader-status-label")?.textContent || ""),
        oldExcerptVisible: /synthetic article for the General Page Reader CDP acceptance test/.test(pane?.innerText || ""),
        oldSourceLinkVisible: Boolean(pane?.querySelector('.page-reader-source-links a[href$="/source"]')),
      };
      const nextSignature = JSON.stringify(entry);
      if (nextSignature === signature) return;
      signature = nextSignature;
      entries.push(entry);
    };
    const observer = new MutationObserver(capture);
    observer.observe(document.documentElement, { childList: true, subtree: true, attributes: true });
    const interval = setInterval(capture, 10);
    globalThis.__trulyMeaningfulNavigationTimeline = {
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

async function observeNavigation(side) {
  return side.evaluateJson(`(() => {
    const pane = document.querySelector("#page-pane");
    const session = globalThis.__trulyPageReadingRuntime?.auditState?.().displayedSession || null;
    return {
      requestId: session?.requestId || null,
      sessionStatus: session?.status || null,
      hasSurface: session?.hasSurface === true,
      stale: /頁面已變更|Page changed/.test(pane?.innerText || ""),
      loading: session?.status === "loading",
      oldExcerptVisible: /synthetic article for the General Page Reader CDP acceptance test/.test(pane?.innerText || ""),
      sourceLinkVisible: Boolean(pane?.querySelector('.page-reader-source-links a[href$="/source"]')),
    };
  })()`);
}

export async function runMeaningfulNavigationScenario({
  side,
  article,
  allowedBase,
  sleep,
  artifactPath,
}) {
  const initial = await observeNavigation(side);

  await article.evaluate(`location.href = ${JSON.stringify(`${allowedBase}/article3?multi=1#comments`)}; undefined`);
  await sleep(HASH_SETTLE_MS);
  const afterHash = await observeNavigation(side);

  await article.evaluate(`location.href = ${JSON.stringify(`${allowedBase}/article3?multi=1&utm_source=cdp&fbclid=abc`)}; undefined`);
  await sleep(TRACKING_SETTLE_MS);
  const afterTracking = await observeNavigation(side);

  await installTimeline(side);
  await article.evaluate(`location.href = ${JSON.stringify(`${allowedBase}/article2`)}; undefined`);
  await sleep(MEANINGFUL_SETTLE_MS);
  const timeline = await side.evaluateJson(`(() => globalThis.__trulyMeaningfulNavigationTimeline?.stop?.() || [])()`);
  const afterMeaningful = await observeNavigation(side);
  await side.screenshot(artifactPath(MEANINGFUL_NAVIGATION_ARTIFACTS.screenshot));

  return { initial, afterHash, afterTracking, afterMeaningful, timeline };
}

export function assertMeaningfulNavigationScenario(result, { autoRead }) {
  const errors = [];
  if (result.afterHash?.stale) errors.push("hash-only URL change incorrectly marked stale");
  if (result.afterTracking?.stale) errors.push("tracking-only query change incorrectly marked stale");
  if (result.afterMeaningful?.oldExcerptVisible || result.afterMeaningful?.sourceLinkVisible) {
    errors.push("meaningful URL change did not scrub stale Web surface content");
  }

  const entries = Array.isArray(result.timeline) ? result.timeline : [];
  const requestInvalidated = entries.some((entry) => entry.requestId === null);
  const loadingObserved = entries.some((entry) =>
    entry.sessionStatus === "loading" && entry.hasSurface === false);
  const staleObserved = entries.some((entry) =>
    entry.sessionStatus === "stale" || entry.staleVisible);
  const scrubObserved = entries.some((entry) =>
    entry.hasSurface === false && !entry.oldExcerptVisible && !entry.oldSourceLinkVisible);

  if (autoRead && !(loadingObserved && scrubObserved && requestInvalidated)) {
    errors.push("meaningful URL change did not enter a scrubbed canonical auto-read transition");
  }
  if (!autoRead && !(staleObserved && scrubObserved)) {
    errors.push("meaningful URL change without auto-read did not enter a scrubbed stale transition");
  }
  return errors;
}

export function meaningfulNavigationSummary(result) {
  const entries = Array.isArray(result?.timeline) ? result.timeline : [];
  return {
    hashStale: result?.afterHash?.stale === true,
    trackingStale: result?.afterTracking?.stale === true,
    loadingObserved: entries.some((entry) => entry.sessionStatus === "loading" && entry.hasSurface === false),
    staleObserved: entries.some((entry) => entry.sessionStatus === "stale" || entry.staleVisible),
    scrubObserved: entries.some((entry) => entry.hasSurface === false && !entry.oldExcerptVisible && !entry.oldSourceLinkVisible),
    requestInvalidated: entries.some((entry) => entry.requestId === null),
    oldContentVisibleAtEnd: Boolean(result?.afterMeaningful?.oldExcerptVisible || result?.afterMeaningful?.sourceLinkVisible),
  };
}
