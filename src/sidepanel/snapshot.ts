/**
 * Sidepanel "📦 匯出狀態" — bundles the user's current debugging state
 * into a single .json artifact downloaded via blob URL.
 *
 * Bundle contents (the goal is "drag this one file into Claude and have
 * enough context to debug a layout / classification regression"):
 *   - timestamps + buildId per component
 *   - console ring buffers from sidepanel + service worker + every CS
 *     attached to a facebook.com tab
 *   - chrome.storage.sync settings
 *   - chrome.storage.session (pendingOpenPost, etc.)
 *   - dashboardEvents (passed in — sidepanel owns this state)
 *   - sidepanel DOM (innerHTML of body)
 *   - FB tab DOM signals (article counts, sponsored count, truly-overlay count)
 *   - FB tab screenshot (data URL JPEG, downsampled by capture API)
 *
 * Permission notes:
 *   - chrome.tabs.captureVisibleTab on the FB tab requires either
 *     activeTab (granted on user invocation, but sidepanel button clicks
 *     don't always count) or matching host_permissions. Manifest grants
 *     `*://*.facebook.com/*` for this purpose.
 *   - Anchor + blob URL is used for the download (no `downloads` permission
 *     needed — Chrome treats it as a normal user-initiated save).
 */

import type {
  ExportLogBufferResultMsg,
  FbTabStats,
  TrulyMessage,
  GetVersionResultMsg,
} from "../lib/messages";
import { snapshotLogBuffer } from "../lib/log-buffer";
import type { DashboardPostEvent } from "../lib/types";

interface ComponentLogs {
  component: string;
  buildId: string;
  entries: ExportLogBufferResultMsg["entries"];
  /** Per-tab data when the component is "content-script". */
  tabId?: number;
  url?: string;
  fbStats?: FbTabStats;
  screenshot?: string; // data URL
  screenshotError?: string;
}

export interface SnapshotBundle {
  schemaVersion: 1;
  timestamp: string; // ISO
  sidepanel: {
    buildId: string;
    entries: ComponentLogs["entries"];
    domHtml: string;
    activeTab: string | null;
  };
  serviceWorker: ComponentLogs | { error: string };
  facebookTabs: ComponentLogs[];
  storage: {
    sync: Record<string, unknown>;
    session: Record<string, unknown>;
  };
  dashboardEvents: DashboardPostEvent[];
}

declare const __TRULY_BUILD_ID__: string;
const REDACTED_SECRET = "[redacted]";
const SECRET_KEY_RE = /api[-_]?key$/i;

async function fetchSwLogs(): Promise<ComponentLogs | { error: string }> {
  try {
    const reply = (await chrome.runtime.sendMessage({
      type: "EXPORT_LOG_BUFFER",
    } satisfies TrulyMessage)) as ExportLogBufferResultMsg | undefined;
    if (!reply || reply.type !== "EXPORT_LOG_BUFFER_RESULT") {
      return { error: "unexpected reply from service worker" };
    }
    return {
      component: reply.component,
      buildId: reply.buildId,
      entries: reply.entries,
    };
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}

async function fetchTabLogs(tabId: number): Promise<ExportLogBufferResultMsg | null> {
  try {
    const reply = (await chrome.tabs.sendMessage(tabId, {
      type: "EXPORT_LOG_BUFFER",
    } satisfies TrulyMessage)) as ExportLogBufferResultMsg | undefined;
    if (!reply || reply.type !== "EXPORT_LOG_BUFFER_RESULT") return null;
    return reply;
  } catch {
    return null; // tab without CS attached, or messaging failed
  }
}

async function captureScreenshot(
  windowId: number
): Promise<{ dataUrl: string } | { error: string }> {
  try {
    const dataUrl = await chrome.tabs.captureVisibleTab(windowId, {
      format: "jpeg",
      quality: 75,
    });
    return { dataUrl };
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}

async function readStorage(): Promise<{
  sync: Record<string, unknown>;
  session: Record<string, unknown>;
}> {
  const [sync, session] = await Promise.all([
    chrome.storage.sync.get(null).catch(() => ({}) as Record<string, unknown>),
    chrome.storage.session
      .get(null)
      .catch(() => ({}) as Record<string, unknown>),
  ]);
  return {
    sync: redactStorageSecrets(sync),
    session: redactStorageSecrets(session),
  };
}

function redactStorageSecrets(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return redactObject(value as Record<string, unknown>);
}

function redactObject(value: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, nested] of Object.entries(value)) {
    if (SECRET_KEY_RE.test(key)) {
      out[key] = REDACTED_SECRET;
    } else {
      out[key] = redactNestedValue(nested);
    }
  }
  return out;
}

function redactNestedValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactNestedValue);
  if (value && typeof value === "object") return redactObject(value as Record<string, unknown>);
  return value;
}

export async function buildSnapshotBundle(
  dashboardEvents: DashboardPostEvent[]
): Promise<SnapshotBundle> {
  const sidepanelEntries = snapshotLogBuffer();

  const fbTabs = await chrome.tabs
    .query({ url: "*://*.facebook.com/*" })
    .catch(() => []);

  const activeTabUrl =
    (await chrome.tabs.query({ active: true, lastFocusedWindow: true }))[0]
      ?.url ?? null;

  const [swResult, storage] = await Promise.all([
    fetchSwLogs(),
    readStorage(),
  ]);

  const fbResults: ComponentLogs[] = [];
  for (const tab of fbTabs) {
    if (typeof tab.id !== "number") continue;
    const [logs, shot] = await Promise.all([
      fetchTabLogs(tab.id),
      typeof tab.windowId === "number"
        ? captureScreenshot(tab.windowId)
        : Promise.resolve({ error: "no windowId" } as { error: string }),
    ]);
    fbResults.push({
      component: "content-script",
      buildId: logs?.buildId || "(no response)",
      entries: logs?.entries ?? [],
      tabId: tab.id,
      url: tab.url,
      fbStats: logs?.fbStats,
      screenshot: "dataUrl" in shot ? shot.dataUrl : undefined,
      screenshotError: "error" in shot ? shot.error : undefined,
    });
  }

  return {
    schemaVersion: 1,
    timestamp: new Date().toISOString(),
    sidepanel: {
      buildId: __TRULY_BUILD_ID__,
      entries: sidepanelEntries,
      domHtml: document.body.outerHTML,
      activeTab: activeTabUrl,
    },
    serviceWorker: swResult,
    facebookTabs: fbResults,
    storage,
    dashboardEvents,
  };
}

export function downloadBundle(bundle: SnapshotBundle): void {
  const blob = new Blob([JSON.stringify(bundle, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `truly-snapshot-${bundle.timestamp.replace(/[:.]/g, "-")}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  // Revoke after the click handler resolves; small timeout is enough for
  // Chrome's download manager to grab the blob.
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

// Flat helper used by GET_VERSION probes — kept here so callers don't
// need to know the message shape.
export async function probeBuildIds(): Promise<{
  sw: string | null;
  cs: Record<number, string>;
}> {
  const sw = (await chrome.runtime
    .sendMessage({ type: "GET_VERSION" } satisfies TrulyMessage)
    .catch(() => null)) as GetVersionResultMsg | null;
  const tabs = await chrome.tabs.query({ url: "*://*.facebook.com/*" });
  const cs: Record<number, string> = {};
  for (const t of tabs) {
    if (typeof t.id !== "number") continue;
    const reply = (await chrome.tabs
      .sendMessage(t.id, { type: "GET_VERSION" } satisfies TrulyMessage)
      .catch(() => null)) as GetVersionResultMsg | null;
    if (reply) cs[t.id] = reply.buildId;
  }
  return { sw: sw?.buildId ?? null, cs };
}

export const __snapshotInternals = {
  REDACTED_SECRET,
  readStorage,
  redactStorageSecrets,
};
