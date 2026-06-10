/**
 * Dev-only auto-reload client. Probes `http://localhost:9012/` (served by
 * `scripts/dev-reload-server.ts`) on startup. If the probe succeeds, polls
 * every `POLL_INTERVAL_MS` and calls `chrome.runtime.reload()` whenever
 * `buildId` changes. If the probe fails, the client quietly gives up —
 * production builds have no dev server running and will hit this path
 * exactly once on SW startup.
 *
 * No build-time flag is needed: runtime feature-probe handles the
 * production case. Zero ongoing cost if the dev server is absent.
 */
const DEV_RELOAD_URL = "http://localhost:9012/";
const POLL_INTERVAL_MS = 2000;
const PROBE_TIMEOUT_MS = 800;
const PENDING_TAB_REFRESH_KEY = "devReloadPendingTabRefresh";
const PENDING_TAB_REFRESH_TTL_MS = 60_000;
const POST_RESTART_TAB_RELOAD_DELAY_MS = 1500;

type PendingTabRefresh = {
  buildId: string;
  ts: number;
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function fetchBuildId(timeoutMs: number): Promise<string | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(DEV_RELOAD_URL, {
      cache: "no-store",
      signal: ctrl.signal,
    });
    if (!r.ok) return null;
    const json = (await r.json()) as { buildId?: string };
    return typeof json.buildId === "string" ? json.buildId : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function markPendingTabRefresh(buildId: string): Promise<void> {
  const pending: PendingTabRefresh = { buildId, ts: Date.now() };
  try {
    await chrome.storage.local.set({ [PENDING_TAB_REFRESH_KEY]: pending });
  } catch (e) {
    console.warn("[dev-reload] failed to persist pending tab refresh:", e);
  }
}

async function maybeReloadFacebookTabsAfterRestart(): Promise<void> {
  let pending: PendingTabRefresh | null = null;
  try {
    const result = await chrome.storage.local.get(PENDING_TAB_REFRESH_KEY);
    pending = (result[PENDING_TAB_REFRESH_KEY] as PendingTabRefresh | undefined) ?? null;
  } catch {
    return;
  }
  if (!pending) return;

  try {
    await chrome.storage.local.remove(PENDING_TAB_REFRESH_KEY);
  } catch {
    // Continue; stale key is better than blocking the reload path.
  }

  if (
    typeof pending.buildId !== "string" ||
    typeof pending.ts !== "number" ||
    Date.now() - pending.ts > PENDING_TAB_REFRESH_TTL_MS
  ) {
    return;
  }

  await sleep(POST_RESTART_TAB_RELOAD_DELAY_MS);
  const tabs = await chrome.tabs.query({ url: "*://*.facebook.com/*" }).catch(() => []);
  const reloadable = tabs.filter((tab) => typeof tab.id === "number");
  if (reloadable.length === 0) return;

  console.log(
    `[dev-reload] extension restarted for buildId=${pending.buildId}; reloading ${reloadable.length} Facebook tab(s)`,
  );
  await Promise.allSettled(
    reloadable.map((tab) => chrome.tabs.reload(tab.id!)),
  );
}

export async function initDevReloadClient(): Promise<void> {
  // Runtime probe: is the dev-reload server listening?
  const initialBuildId = await fetchBuildId(PROBE_TIMEOUT_MS);
  if (initialBuildId === null) {
    // Production / no dev server → quietly no-op.
    return;
  }
  console.log(
    `[dev-reload] connected to ${DEV_RELOAD_URL}, buildId=${initialBuildId}, polling every ${POLL_INTERVAL_MS}ms`,
  );
  await maybeReloadFacebookTabsAfterRestart();

  let lastSeen = initialBuildId;
  setInterval(async () => {
    const current = await fetchBuildId(PROBE_TIMEOUT_MS);
    if (current === null) return;
    if (current !== lastSeen) {
      console.log(
        `[dev-reload] buildId changed ${lastSeen} → ${current}, reloading extension...`,
      );
      lastSeen = current;
      await markPendingTabRefresh(current);
      chrome.runtime.reload();
    }
  }, POLL_INTERVAL_MS);
}
