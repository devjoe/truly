// Background service worker for Truly
//
// Ollama classification fetches MUST happen here (not in the content
// script) because content scripts inherit Chrome's Private Network Access
// restriction from the page origin (facebook.com), which blocks fetches
// to loopback addresses like localhost:11434. Service worker requests
// originate from `chrome-extension://...` and bypass PNA via
// host_permissions. The previous attempt to move this into filter-engine.ts
// (commit d8b8a05) shipped a CORS error visible in DevTools — reverted by
// commit on 2026-04-09 after user-reported regression.
//
// "Message port closed before a response was received" errors during page
// reloads are cosmetic noise (the content script context dies mid-flight)
// and are silently ignored on the content side.

import { callTierBDeepDetailed, callTierBReadingBrief } from "../lib/tier-b-client";
import { callGeminiNanoTierB, callGeminiNanoReadingBrief, GEMINI_NANO_PROVIDER } from "../lib/gemini-nano-client";
import { initDevReloadClient } from "./dev-reload-client";
import type { TierAProvider, TierBProvider } from "../lib/types";
import {
  providerEndpointKind,
} from "../lib/provider-capabilities";
import { providerCanRunTierBFeature } from "../lib/feature-readiness";
import type {
  TrulyMessage,
  DeepClassifyResultMsg,
  ReadingBriefResultMsg,
  ReadinessRunChecksResultMsg,
  ExportLogBufferResultMsg,
} from "../lib/messages";
import { installLogBuffer, snapshotLogBuffer } from "../lib/log-buffer";
import { runReadinessChecks } from "./readiness-checks";
import {
  runGeminiNanoProbe,
  runGeminiNanoSmoke,
  runOllamaCompactDigitsCheck,
  runOllamaHealthCheck,
  runOllamaResponseFormatCheck,
} from "./model-probe-checks";
import { DashboardRuntimeState } from "./dashboard-state";
import { createTierBCaptureBuffer, maybeCaptureTierB } from "./tier-b-capture";
import { classifyTierAPosts } from "./tier-a-classification";
import { debugLog } from "../lib/logger";

// Capture console output for the debug snapshot bundle. Idempotent — if
// the SW wakes from suspension this is a no-op. See lib/log-buffer.ts.
installLogBuffer();

const CLASSIFICATION_CACHE_KEY_RE = /^classificationCacheV\d+$/;
const CLASSIFICATION_CACHE_BUILD_ID_KEY = "classificationCacheBuildId";
const CLASSIFICATION_CACHE_RUNTIME_CLEAR_KEY = "classificationCacheClearedForRuntime";

async function clearPersistedClassificationCache(reason: string): Promise<void> {
  try {
    const stored = await chrome.storage.local.get(null);
    const keys = Object.keys(stored).filter(
      (key) => CLASSIFICATION_CACHE_KEY_RE.test(key) || key === CLASSIFICATION_CACHE_BUILD_ID_KEY,
    );
    if (keys.length === 0) return;
    await chrome.storage.local.remove(keys);
    debugLog(
      `[Truly BG] Cleared persisted classification cache on ${reason}: ${keys.join(", ")}`,
    );
  } catch (error) {
    console.warn("[Truly BG] Failed to clear persisted classification cache:", error);
  }
}

async function openOptionsOnFreshInstall(): Promise<void> {
  try {
    await chrome.runtime.openOptionsPage();
  } catch (error) {
    console.warn("[Truly BG] Failed to open options on install:", error);
  }
}

chrome.runtime.onInstalled.addListener((details) => {
  void clearPersistedClassificationCache(`extension ${details.reason}`);
  if (details.reason === "install") {
    void openOptionsOnFreshInstall();
  }
});

async function clearClassificationCacheOncePerRuntime(): Promise<void> {
  try {
    const session = chrome.storage.session;
    if (!session) {
      await clearPersistedClassificationCache("service-worker startup without session marker");
      return;
    }
    const stored = await session.get(CLASSIFICATION_CACHE_RUNTIME_CLEAR_KEY);
    if (stored?.[CLASSIFICATION_CACHE_RUNTIME_CLEAR_KEY] === __TRULY_BUILD_ID__) return;
    await clearPersistedClassificationCache(`extension runtime buildId=${__TRULY_BUILD_ID__}`);
    await session.set({ [CLASSIFICATION_CACHE_RUNTIME_CLEAR_KEY]: __TRULY_BUILD_ID__ });
  } catch (error) {
    console.warn("[Truly BG] Failed to run runtime cache invalidation:", error);
  }
}

void clearClassificationCacheOncePerRuntime();

const __trulyTierBCapture = createTierBCaptureBuffer(60);
(globalThis as any).__trulyTierBCapture = __trulyTierBCapture;

// Dev-only auto-reload: probes http://localhost:9012 (served by
// scripts/dev-reload-server.ts). When the dev server isn't listening
// (production), this is a single failed fetch on startup and then no-op.
void initDevReloadClient();

// ---------------------------------------------------------------------------
// Dashboard event replay buffer
// ---------------------------------------------------------------------------
//
// The side panel may not be open when posts stream through. Keeping a ring
// buffer of recent POST_CLASSIFIED events means that opening the dashboard
// later can replay the last ~300 events instead of starting from zero.
//
// Progressive updates (tier1 → LLM) for the same `event.id` overwrite
// in-place so the buffer stores the MOST RECENT decision per post, not
// every intermediate update.

const dashboardState = new DashboardRuntimeState(300);

function broadcastOpenDashboardForPost(id: string): void {
  const msg = { type: "OPEN_DASHBOARD_FOR_POST", id } satisfies TrulyMessage;
  chrome.runtime.sendMessage(msg).catch(() => {});
  setTimeout(() => chrome.runtime.sendMessage(msg).catch(() => {}), 250);
  setTimeout(() => chrome.runtime.sendMessage(msg).catch(() => {}), 900);
}
try {
  chrome.sidePanel?.onOpened?.addListener((info) => {
    dashboardState.markPanelOpen(info.windowId);
  });
  chrome.sidePanel?.onClosed?.addListener((info) => {
    dashboardState.markPanelClosed(info.windowId);
  });
} catch {
  /* SidePanel open/closed events are unavailable in older Chrome builds. */
}

// Single message listener — explicit returns, no fall-through
chrome.runtime.onMessage.addListener((message: TrulyMessage, sender, sendResponse) => {
  if (message.type === "GET_VERSION") {
    try { sendResponse({ type: "GET_VERSION_RESULT", buildId: __TRULY_BUILD_ID__, component: "service-worker" }); } catch {}
    return false;
  }

  if (message.type === "EXPORT_LOG_BUFFER") {
    const reply: ExportLogBufferResultMsg = {
      type: "EXPORT_LOG_BUFFER_RESULT",
      component: "service-worker",
      buildId: __TRULY_BUILD_ID__,
      entries: snapshotLogBuffer(),
    };
    try { sendResponse(reply); } catch {}
    return false;
  }

  if (message.type === "POST_CLASSIFIED") {
    // Buffer for replay on dashboard open…
    dashboardState.bufferEvent(message.event);
    // …and relay live to any currently-open extension pages.
    chrome.runtime.sendMessage(message).catch(() => {});
    return false;
  }

  if (message.type === "CURRENT_VIEW_POST" || message.type === "MANUAL_VIEW_POST") {
    // Pure broadcast — relay to whichever extension page is listening
    // (sidepanel's 閱讀 tab). No buffering: the panel only cares about
    // the most recent value, which the CS continually re-broadcasts.
    chrome.runtime.sendMessage(message).catch(() => {});
    return false;
  }

  if (message.type === "REQUEST_CURRENT_VIEW_POST") {
    chrome.tabs.query({ url: "*://*.facebook.com/*" }).then((tabs) => {
      for (const tab of tabs) {
        if (typeof tab.id !== "number") continue;
        chrome.tabs.sendMessage(tab.id, message).catch(() => {});
      }
    }).catch(() => {});
    return false;
  }

  if (message.type === "DASHBOARD_REPLAY_REQUEST") {
    const replay: TrulyMessage = {
      type: "DASHBOARD_REPLAY",
      events: dashboardState.replayEvents(),
    };
    // Reply synchronously if the caller wants it (sidepanel sendMessage
    // with callback), but also broadcast so any open subscriber sees it.
    try {
      sendResponse(replay);
    } catch {
      chrome.runtime.sendMessage(replay).catch(() => {});
    }
    return false;
  }

  if (message.type === "SCROLL_TO_POST") {
    // Broadcast to every open FB tab — the content script holding the
    // matching stableId in its DOM map will handle it; others ignore.
    chrome.tabs.query({ url: "*://*.facebook.com/*" }).then((tabs) => {
      for (const tab of tabs) {
        if (typeof tab.id !== "number") continue;
        chrome.tabs.sendMessage(tab.id, message).catch(() => {});
      }
    }).catch(() => {});
    return false;
  }

  if (message.type === "CACHE_CLEARED") {
    // Tell every open FB tab to drop its in-memory classification cache.
    // Persisted chrome.storage entries were removed by the sender already.
    chrome.tabs.query({ url: "*://*.facebook.com/*" }).then((tabs) => {
      for (const tab of tabs) {
        if (typeof tab.id !== "number") continue;
        chrome.tabs.sendMessage(tab.id, message).catch(() => {});
      }
    }).catch(() => {});
    return false;
  }

  if (message.type === "OPEN_OPTIONS_PAGE") {
    const fallback = () => {
      chrome.tabs
        .create({ url: chrome.runtime.getURL("options/options.html") })
        .catch(() => {});
    };
    try {
      chrome.runtime.openOptionsPage().catch(fallback);
    } catch {
      fallback();
    }
    return false;
  }

  if (message.type === "OPEN_DASHBOARD_FOR_POST" || message.type === "TOGGLE_DASHBOARD_FOR_POST") {
    const windowId = sender?.tab?.windowId;
    if (
      message.type === "TOGGLE_DASHBOARD_FOR_POST" &&
      typeof windowId === "number" &&
      dashboardState.isPanelOpenForPost(windowId, message.id) &&
      chrome.sidePanel?.close
    ) {
      chrome.sidePanel.close({ windowId }).catch(() => {});
      dashboardState.markPanelClosed(windowId);
      return false;
    }

    // Persist the target post id so a freshly-mounting sidepanel can
    // pick it up after its replay completes. Without this, the
    // runtime.sendMessage below is lost if the panel wasn't already
    // open (the script hasn't attached its onMessage listener yet).
    chrome.storage.session
      .set({ pendingOpenPost: message.id })
      .catch(() => {});

    const openPromise =
      typeof windowId === "number" && chrome.sidePanel?.open
        ? chrome.sidePanel.open({ windowId }).catch(() => {})
        : Promise.resolve();
    openPromise.then(() => {
      if (typeof windowId === "number") {
        dashboardState.rememberPanelPost(windowId, message.id);
      }
      // Forward for the already-open case (the session-storage path
      // handles the cold-start case).
      broadcastOpenDashboardForPost(message.id);
    });
    return false;
  }

  if (message.type === "GET_SIDE_PANEL_STATE") {
    try {
      sendResponse({
        type: "GET_SIDE_PANEL_STATE_RESULT",
        windowId: message.windowId,
        isOpen: dashboardState.isPanelOpen(message.windowId),
      });
    } catch {}
    return false;
  }

  if (message.type === "OLLAMA_HEALTH_CHECK") {
    (async () => {
      sendResponse(await runOllamaHealthCheck(message));
    })();
    return true; // async response
  }

  if (message.type === "READINESS_RUN_CHECKS") {
    (async () => {
      try {
        sendResponse(await runReadinessChecks(message, __TRULY_BUILD_ID__));
      } catch (error) {
        sendResponse({
          type: "READINESS_RUN_CHECKS_RESULT",
          ok: false,
          records: [],
          error: error instanceof Error ? error.message : String(error),
        } satisfies ReadinessRunChecksResultMsg);
      }
    })();
    return true;
  }

  if (message.type === "GEMINI_NANO_PROBE") {
    (async () => {
      try { sendResponse(await runGeminiNanoProbe(message)); } catch {}
    })();
    return true;
  }

  if (message.type === "GEMINI_NANO_SMOKE") {
    (async () => {
      sendResponse(await runGeminiNanoSmoke(message));
    })();
    return true;
  }

  if (message.type === "OLLAMA_RESPONSE_FORMAT_CHECK") {
    (async () => {
      sendResponse(await runOllamaResponseFormatCheck(message));
    })();
    return true;
  }

  if (message.type === "OLLAMA_COMPACT_DIGITS_CHECK") {
    (async () => {
      sendResponse(await runOllamaCompactDigitsCheck(message));
    })();
    return true;
  }

  if (message.type === "DEEP_CLASSIFY") {
    const { postId, text, imageUrls, filteredImageCount, endpoint, model } = message;
    const outputLang = message.outputLang ?? "zh-TW";
    if (message.provider !== GEMINI_NANO_PROVIDER) {
      try {
        maybeCaptureTierB(__trulyTierBCapture, message);
      } catch (e) {
        console.warn("[Truly BG] Tier B capture failed:", e);
      }
    }
    (async () => {
      try {
        const result = message.provider === GEMINI_NANO_PROVIDER
          ? await callGeminiNanoTierB({ text, imageUrls, filteredImageCount, outputLang })
          : await callTierBDeepDetailed({
              endpoint, model, text, imageUrls, filteredImageCount, outputLang,
            });
        const reply: DeepClassifyResultMsg = result.ok && result.deep
          ? { type: "DEEP_CLASSIFY_RESULT", postId, ok: true, deep: result.deep }
          : { type: "DEEP_CLASSIFY_RESULT", postId, ok: false, error: result.error ?? "tier_b_failed" };
        try { sendResponse(reply); } catch {}
      } catch (e) {
        try {
          sendResponse({
            type: "DEEP_CLASSIFY_RESULT",
            postId,
            ok: false,
            error: e instanceof Error ? e.message.slice(0, 200) : "internal_error",
          } satisfies DeepClassifyResultMsg);
        } catch {}
      }
    })();
    return true;
  }

  if (message.type === "READING_BRIEF_REQUEST") {
    const { postId, endpoint, model, event } = message;
    const outputLang = message.outputLang ?? "zh-TW";
    (async () => {
      try {
        if (message.provider && !providerCanRunTierBFeature("reading_brief", message.provider)) {
          throw new Error(`${message.provider}_reading_brief_unsupported`);
        }
        dashboardState.patchEvent(postId, {
          readingBriefPending: true,
          readingBriefError: undefined,
        });
        const startedAt = Date.now();
        const brief = message.provider === GEMINI_NANO_PROVIDER
          ? await callGeminiNanoReadingBrief({ event, outputLang })
          : await callTierBReadingBrief({ endpoint, model, event, outputLang });
        if (brief) {
          const timedBrief = { ...brief, elapsedMs: Date.now() - startedAt };
          const updated = dashboardState.patchEvent(postId, {
            readingBrief: timedBrief,
            readingBriefPending: false,
            readingBriefStale: false,
            readingBriefError: undefined,
          }) ?? {
            ...event,
            readingBrief: timedBrief,
            readingBriefPending: false,
            readingBriefStale: false,
            readingBriefError: undefined,
          };
          chrome.runtime.sendMessage({ type: "POST_CLASSIFIED", event: updated } satisfies TrulyMessage).catch(() => {});
          try {
            sendResponse({
              type: "READING_BRIEF_RESULT",
              postId,
              ok: true,
              brief: timedBrief,
            } satisfies ReadingBriefResultMsg);
          } catch {}
        } else {
          const updated = dashboardState.patchEvent(postId, {
            readingBriefPending: false,
            readingBriefStale: false,
            readingBriefError: "reading_brief_failed",
          }) ?? {
            ...event,
            readingBriefPending: false,
            readingBriefStale: false,
            readingBriefError: "reading_brief_failed",
          };
          chrome.runtime.sendMessage({ type: "POST_CLASSIFIED", event: updated } satisfies TrulyMessage).catch(() => {});
          try {
            sendResponse({
              type: "READING_BRIEF_RESULT",
              postId,
              ok: false,
              error: "reading_brief_failed",
            } satisfies ReadingBriefResultMsg);
          } catch {}
        }
      } catch (e) {
        const error = e instanceof Error ? e.message.slice(0, 200) : "internal_error";
        const updated = dashboardState.patchEvent(postId, {
          readingBriefPending: false,
          readingBriefStale: false,
          readingBriefError: error,
        }) ?? { ...event, readingBriefPending: false, readingBriefStale: false, readingBriefError: error };
        chrome.runtime.sendMessage({ type: "POST_CLASSIFIED", event: updated } satisfies TrulyMessage).catch(() => {});
        try {
          sendResponse({
            type: "READING_BRIEF_RESULT",
            postId,
            ok: false,
            error,
          } satisfies ReadingBriefResultMsg);
        } catch {}
      }
    })();
    return true;
  }

  if (message.type === "OLLAMA_CLASSIFY") {
    const tabId = sender.tab?.id;
    const fallbackRequestedIds = (message.posts || []).map((post) => post.id);

    (async () => {
      try {
        const { requestedIds, results } = await classifyTierAPosts(message);
        debugLog(`[Truly BG] Ollama done: ${Object.keys(results).length} results (rules=${message.customRules?.length ?? 0})`);
        if (typeof tabId === "number") {
          await chrome.tabs.sendMessage(tabId, {
            type: "OLLAMA_RESULT" as const,
            results,
            requestedIds,
          });
        }
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        console.error("[Truly BG] Ollama pipeline error:", errorMsg);
        if (typeof tabId === "number") {
          await chrome.tabs.sendMessage(tabId, {
            type: "OLLAMA_RESULT" as const,
            results: {},
            requestedIds: fallbackRequestedIds,
            error: errorMsg,
          }).catch(() => {});
        }
      }
      try { sendResponse({}); } catch {}
    })();
    return true;
  }

  if (message.type === "SELECTOR_HEALTH_UPDATE") {
    const tabId = sender.tab?.id;
    debugLog(`[Truly BG] SELECTOR_HEALTH_UPDATE: tabId=${tabId} status=${message.status}`);
    if (tabId) {
      if (message.status === "unhealthy") {
        tabHealthState.set(tabId, "unhealthy");
        chrome.action.setBadgeText({ text: "!", tabId });
        chrome.action.setBadgeBackgroundColor({ color: "#e41e3f", tabId });
      } else if (message.status === "healthy") {
        tabHealthState.delete(tabId);
        chrome.action.setBadgeText({ text: "", tabId });
      }
    }
    return false;
  }

  return false;
});

// Per-tab selector-health state. Unhealthy tabs show a red "!" action badge.
const tabHealthState = new Map<number, "unhealthy">();

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status === "loading") {
    chrome.action.setBadgeText({ text: "", tabId });
    tabHealthState.delete(tabId);
  }
});

chrome.tabs.onRemoved.addListener((tabId) => {
  tabHealthState.delete(tabId);
});

// Keep service worker alive (workaround for MV3 idle timeout)
const keepAlive = () => {
  setInterval(() => {
    chrome.runtime.getPlatformInfo(() => {});
  }, 20000);
};
keepAlive();

// Dev-only command handler. Public manifests do not declare this command;
// dev builds may add it through the manifest patch step.
chrome.commands?.onCommand.addListener((cmd) => {
  if (cmd === "reload-extension") {
    debugLog("[Truly BG] reload-extension command → chrome.runtime.reload()");
    chrome.runtime.reload();
  }
});

// Expose the buildId so probes can read it via sw.evaluate (Vite inlines
// __TRULY_BUILD_ID__ as a string literal at build time, so it isn't on
// globalThis unless we assign it explicitly).
(globalThis as any).__TRULY_BUILD_ID = __TRULY_BUILD_ID__;
debugLog(`[Truly BG] Service worker loaded buildId=${__TRULY_BUILD_ID__}`);
