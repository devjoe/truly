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

import { callTierBDeepDetailed, callTierBGeneralPageBrief, callTierBGeneralPageParserAdvisor, callTierBReadingBrief } from "../lib/tier-b-client";
import { callGeminiNanoTierB, callGeminiNanoReadingBrief, GEMINI_NANO_PROVIDER } from "../lib/gemini-nano-client";
import { initDevReloadClient } from "./dev-reload-client";
import type { TierAProvider, TierBProvider } from "../lib/types";
import {
  providerEndpointKind,
} from "../lib/provider-capabilities";
import { providerCanRunTierBFeature } from "../lib/feature-readiness";
import {
  buildRuleBasedGeneralPageParserAdvice,
  isGeneralPageParserAdvisorAdviceCompatible,
} from "../lib/general-page-parser-advisor";
import type {
  TrulyMessage,
  DeepClassifyResultMsg,
  GeneralPageAnalysisResultMsg,
  GeneralPageParserAdvisorResultMsg,
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
import {
  resolveTrustedTierARuntime,
  resolveTrustedTierBProviderRuntime,
  type StoredModelRuntimeInput,
} from "./trusted-model-runtime";
import { isSupportedScreenshotDataUrl } from "../lib/screenshot-data-url";
import { queueReadingCommand } from "./reading-command-mailbox";
import { createPageReaderTabTransport } from "./page-reader-tab-transport";
import {
  modelWorkPriorityForDeepSource,
  modelWorkPriorityForReadingBriefSource,
  modelWorkResourceKey,
} from "../lib/model-work";
import { ModelWorkScheduler } from "./model-work-scheduler";
import { scheduleGeneralPageInvestigationPreparation } from "./general-page-investigation-background";

// Capture console output for the debug snapshot bundle. Idempotent — if
// the SW wakes from suspension this is a no-op. See lib/log-buffer.ts.
installLogBuffer();
const modelWorkScheduler = new ModelWorkScheduler({ foregroundBurstLimit: 3 });

const CLASSIFICATION_CACHE_KEY_RE = /^classificationCacheV\d+$/;
const CLASSIFICATION_CACHE_BUILD_ID_KEY = "classificationCacheBuildId";
const CLASSIFICATION_CACHE_RUNTIME_CLEAR_KEY = "classificationCacheClearedForRuntime";
const OPENAI_COMPAT_PROVIDER = "openai-compatible";

async function storedSecretString(keys: string[]): Promise<string | undefined> {
  const [sessionStored, localStored] = await Promise.all([
    chrome.storage.session?.get(keys).catch(() => ({} as Record<string, unknown>)) ??
      Promise.resolve({} as Record<string, unknown>),
    chrome.storage.local.get(keys),
  ]);
  for (const stored of [sessionStored, localStored]) {
    for (const key of keys) {
      const value = stored[key];
      if (typeof value === "string" && value.trim()) return value.trim();
    }
  }
  return undefined;
}

async function storedModelRuntimeInput(): Promise<StoredModelRuntimeInput> {
  const [syncStored, localStored] = await Promise.all([
    chrome.storage.sync.get("settings"),
    chrome.storage.local.get(["ollamaEndpoint", "ollamaModel"]),
  ]);
  return {
    settings: syncStored.settings,
    ollamaEndpoint: localStored.ollamaEndpoint,
    ollamaModel: localStored.ollamaModel,
  };
}

async function tierAApiKeyForProvider(
  provider: TierAProvider | undefined,
  endpointKind: string | undefined,
): Promise<string | undefined> {
  if (endpointKind !== OPENAI_COMPAT_PROVIDER && provider !== OPENAI_COMPAT_PROVIDER) {
    return undefined;
  }
  return storedSecretString(["tierAApiKey", "apiKey"]);
}

async function tierBApiKeyForProvider(
  provider: TierAProvider | TierBProvider | undefined,
): Promise<string | undefined> {
  if (provider !== OPENAI_COMPAT_PROVIDER) return undefined;
  return storedSecretString(["tierBApiKey"]);
}

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
// scripts/dev-reload-server.mjs). Production builds must not probe localhost
// or accept reload signals from local processes.
if (__TRULY_DEV_BUILD__) {
  void initDevReloadClient();
}

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
const pageReaderTabTransport = createPageReaderTabTransport({
  scripting: chrome.scripting,
  tabs: chrome.tabs,
  expectedBuildId: __TRULY_BUILD_ID__,
});

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

  if (message.type === "QUEUE_PAGE_READING_COMMAND") {
    void queueReadingCommand({
      message,
      sender,
      extensionId: chrome.runtime.id,
      storage: chrome.storage.session,
      notify: (hint) => chrome.runtime.sendMessage(hint),
      now: Date.now,
    }).then((result) => {
      try { sendResponse(result); } catch {}
    }).catch((error) => {
      try {
        sendResponse({
          type: "QUEUE_PAGE_READING_COMMAND_RESULT",
          requestId: message.envelope?.requestId || "",
          ok: false,
          error: error instanceof Error ? error.message.slice(0, 200) : "reading_command_queue_failed",
        } satisfies TrulyMessage);
      } catch {}
    });
    return true;
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

  if (message.type === "READING_TARGET_REQUEST") {
    const supportedTargetRequest =
      (message.trigger === "selection" && message.activation?.targetKind === "selection") ||
      (message.trigger === "hotkey" && message.activation?.targetKind === "current-region");
    if (!supportedTargetRequest) {
      try {
        sendResponse({
          type: "READING_TARGET_ERROR",
          tabId: message.tabId,
          error: "reading_target_unsupported",
        } satisfies TrulyMessage);
      } catch {}
      return false;
    }

    void pageReaderTabTransport.requestTarget(message).then((reply) => sendResponse(reply));
    return true;
  }

  if (message.type === "GENERAL_PAGE_CANDIDATE_BLOCK_TEXT_REQUEST") {
    void pageReaderTabTransport.requestCandidateBlock(message).then((reply) => sendResponse(reply));
    return true;
  }

  if (message.type === "GENERAL_PAGE_PARSER_ADVISOR_REQUEST") {
    (async () => {
      let modelAttempted = false;
      let trustedRuntime = message.providerRuntime;
      try {
        trustedRuntime = resolveTrustedTierBProviderRuntime(
          "ai_analysis",
          await storedModelRuntimeInput(),
        );
        if (trustedRuntime.canUseModel && trustedRuntime.endpoint && trustedRuntime.model) {
          modelAttempted = true;
          const apiKey = await tierBApiKeyForProvider(trustedRuntime.effectiveProvider);
          const modelResult = await modelWorkScheduler.enqueue({
            id: `parser-advisor:${message.tabId}:${Date.now()}`,
            resourceKey: modelWorkResourceKey(trustedRuntime),
            priority: "foreground",
            run: () => callTierBGeneralPageParserAdvisor({
              endpoint: trustedRuntime.endpoint!,
              model: trustedRuntime.model!,
              apiKey,
              request: message.request,
              outputLang: message.outputLang,
            }),
          });
          if (
            modelResult.ok &&
            modelResult.advice &&
            isGeneralPageParserAdvisorAdviceCompatible(message.request, modelResult.advice)
          ) {
            sendResponse({
              type: "GENERAL_PAGE_PARSER_ADVISOR_RESULT",
              tabId: message.tabId,
              ok: true,
              advice: modelResult.advice,
              providerRuntime: {
                ...trustedRuntime,
                mode: "tier-b-short-json",
              },
            } satisfies GeneralPageParserAdvisorResultMsg);
            return;
          }
          console.warn(
            "[Truly General Page Parser Advisor] model fallback:",
            modelResult.error ?? "advisor_incompatible_with_deterministic_risk",
          );
        }

        const advice = buildRuleBasedGeneralPageParserAdvice(message.request);
        sendResponse({
          type: "GENERAL_PAGE_PARSER_ADVISOR_RESULT",
          tabId: message.tabId,
          ok: true,
          advice,
          providerRuntime: {
            ...trustedRuntime,
            mode: modelAttempted ? "tier-b-short-json-fallback" : "rule-based-runtime-baseline",
          },
        } satisfies GeneralPageParserAdvisorResultMsg);
      } catch (error) {
        sendResponse({
          type: "GENERAL_PAGE_PARSER_ADVISOR_RESULT",
          tabId: message.tabId,
          ok: false,
          providerRuntime: {
            ...trustedRuntime,
            mode: modelAttempted ? "tier-b-short-json-fallback" : "rule-based-runtime-baseline",
          },
          error: error instanceof Error ? error.message.slice(0, 200) : "parser_advisor_failed",
        } satisfies GeneralPageParserAdvisorResultMsg);
      }
    })();
    return true;
  }

  if (message.type === "GENERAL_PAGE_ANALYSIS_REQUEST") {
    (async () => {
      try {
        const trustedRuntime = resolveTrustedTierBProviderRuntime(
          "ai_analysis",
          await storedModelRuntimeInput(),
        );
        if (!trustedRuntime.canUseModel || !trustedRuntime.endpoint || !trustedRuntime.model) {
          throw new Error(trustedRuntime.blockedReason || "general_page_brief_provider_unavailable");
        }
        const screenshotDataUrl = message.screenshotDataUrl;
        if (screenshotDataUrl !== undefined && !isSupportedScreenshotDataUrl(screenshotDataUrl)) {
          throw new Error("general_page_brief_invalid_screenshot_data_url");
        }
        const startedAt = Date.now();
        const apiKey = await tierBApiKeyForProvider(trustedRuntime.effectiveProvider);
        const result = await modelWorkScheduler.enqueue({
          id: `general-page:${message.tabId}:${message.scope}:${message.analysisKey}`,
          resourceKey: modelWorkResourceKey(trustedRuntime),
          priority: message.priority,
          dedupeKey: `general-page:${message.tabId}:${message.scope}:${message.analysisKey}`,
          run: () => callTierBGeneralPageBrief({
            endpoint: trustedRuntime.endpoint!,
            model: trustedRuntime.model!,
            apiKey,
            context: message.context,
            allowedUse: message.allowedUse,
            outputLang: message.outputLang,
            screenshotDataUrl,
          }),
        });
        if (result.ok && result.brief) {
          const investigationPending = message.allowedUse !== "page_overview_only" &&
            !message.screenshotDataUrl && Boolean(result.brief.claims?.[0]);
          sendResponse({
            type: "GENERAL_PAGE_ANALYSIS_RESULT",
            tabId: message.tabId,
            ok: true,
            ...(investigationPending ? { investigationPending: true } : {}),
            brief: {
              ...result.brief,
              elapsedMs: Date.now() - startedAt,
            },
          } satisfies GeneralPageAnalysisResultMsg);
          if (investigationPending) {
            scheduleGeneralPageInvestigationPreparation({
              scheduler: modelWorkScheduler,
              request: message,
              brief: result.brief,
              endpoint: trustedRuntime.endpoint,
              model: trustedRuntime.model,
              apiKey,
              resourceKey: modelWorkResourceKey(trustedRuntime),
              sendMessage: (outgoing) => chrome.runtime.sendMessage(outgoing),
            });
          }
          return;
        }
        sendResponse({
          type: "GENERAL_PAGE_ANALYSIS_RESULT",
          tabId: message.tabId,
          ok: false,
          error: result.error ?? "general_page_brief_failed",
        } satisfies GeneralPageAnalysisResultMsg);
      } catch (error) {
        sendResponse({
          type: "GENERAL_PAGE_ANALYSIS_RESULT",
          tabId: message.tabId,
          ok: false,
          error: error instanceof Error ? error.message.slice(0, 200) : "general_page_brief_failed",
        } satisfies GeneralPageAnalysisResultMsg);
      }
    })();
    return true;
  }

  if (message.type === "PAGE_READING_REQUEST") {
    void pageReaderTabTransport.requestPage(message).then((reply) => {
      try { sendResponse(reply); } catch {}
    });
    return true;
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
    const { postId, text, imageUrls, filteredImageCount } = message;
    const outputLang = message.outputLang ?? "zh-TW";
    (async () => {
      try {
        const trustedRuntime = resolveTrustedTierBProviderRuntime(
          "ai_analysis",
          await storedModelRuntimeInput(),
        );
        const provider = trustedRuntime.effectiveProvider;
        if (provider !== GEMINI_NANO_PROVIDER) {
          try {
            maybeCaptureTierB(__trulyTierBCapture, {
              ...message,
              endpoint: trustedRuntime.endpoint,
              model: trustedRuntime.model,
            });
          } catch (e) {
            console.warn("[Truly BG] Tier B capture failed:", e);
          }
        }
        if (!trustedRuntime.canUseModel) {
          throw new Error(trustedRuntime.blockedReason || "tier_b_provider_unavailable");
        }
        if (provider !== GEMINI_NANO_PROVIDER && (!trustedRuntime.endpoint || !trustedRuntime.model)) {
          throw new Error("tier_b_endpoint_model_unavailable");
        }
        const apiKey = await tierBApiKeyForProvider(provider);
        const result = await modelWorkScheduler.enqueue({
          id: `deep:${postId}:${Date.now()}`,
          resourceKey: modelWorkResourceKey(trustedRuntime),
          priority: modelWorkPriorityForDeepSource(message.source),
          run: () => provider === GEMINI_NANO_PROVIDER
            ? callGeminiNanoTierB({ text, imageUrls, filteredImageCount, outputLang })
            : callTierBDeepDetailed({
                endpoint: trustedRuntime.endpoint!,
                model: trustedRuntime.model!,
                apiKey,
                text,
                imageUrls,
                filteredImageCount,
                outputLang,
              }),
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
    const { postId, event } = message;
    const outputLang = message.outputLang ?? "zh-TW";
    (async () => {
      try {
        const trustedRuntime = resolveTrustedTierBProviderRuntime(
          "reading_brief",
          await storedModelRuntimeInput(),
        );
        const provider = trustedRuntime.effectiveProvider;
        if (!trustedRuntime.canUseModel || !providerCanRunTierBFeature("reading_brief", provider)) {
          throw new Error(trustedRuntime.blockedReason || `${provider}_reading_brief_unsupported`);
        }
        if (provider !== GEMINI_NANO_PROVIDER && (!trustedRuntime.endpoint || !trustedRuntime.model)) {
          throw new Error("reading_brief_endpoint_model_unavailable");
        }
        dashboardState.patchEvent(postId, {
          readingBriefPending: true,
          readingBriefError: undefined,
        });
        const startedAt = Date.now();
        const apiKey = await tierBApiKeyForProvider(provider);
        const brief = await modelWorkScheduler.enqueue({
          id: `reading-brief:${postId}:${Date.now()}`,
          resourceKey: modelWorkResourceKey(trustedRuntime),
          priority: modelWorkPriorityForReadingBriefSource(message.source),
          run: () => provider === GEMINI_NANO_PROVIDER
            ? callGeminiNanoReadingBrief({ event, outputLang })
            : callTierBReadingBrief({
                endpoint: trustedRuntime.endpoint!,
                model: trustedRuntime.model!,
                apiKey,
                event,
                outputLang,
              }),
        });
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
        const trustedRuntime = resolveTrustedTierARuntime(await storedModelRuntimeInput());
        const { requestedIds, results } = await classifyTierAPosts({
          ...message,
          ...trustedRuntime,
          apiKey: await tierAApiKeyForProvider(trustedRuntime.provider, trustedRuntime.endpointKind),
        });
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
        // Selector health is maintainer/debug evidence, not an end-user
        // toolbar warning. Keep it available through GET_STATS and clear any
        // stale badge left by older builds.
        chrome.action.setBadgeText({ text: "", tabId });
      } else if (message.status === "healthy") {
        tabHealthState.delete(tabId);
        chrome.action.setBadgeText({ text: "", tabId });
      }
    }
    return false;
  }

  return false;
});

// Slice 6b: current-region hotkey. The command opens the side panel and
// leaves a session-storage marker the panel consumes on bootstrap or via the
// storage listener. A plain command does NOT grant activeTab, so this only
// works when the page-reader content script is already injected (the user
// has read the page in this session); otherwise the panel shows the existing
// toolbar-activation guidance.
export const PENDING_CURRENT_REGION_READ_KEY = "pendingCurrentRegionRead";

export function handleReadCurrentRegionCommand(
  tab: { id?: number; windowId?: number } | undefined,
  now = Date.now(),
): void {
  if (typeof tab?.id !== "number") return;
  chrome.storage.session
    .set({ [PENDING_CURRENT_REGION_READ_KEY]: { tabId: tab.id, ts: now } })
    .catch(() => {});
  if (typeof tab.windowId === "number" && chrome.sidePanel?.open) {
    chrome.sidePanel.open({ windowId: tab.windowId }).catch(() => {});
  }
}

chrome.commands?.onCommand.addListener((command, tab) => {
  if (command === "truly-read-current-region") {
    handleReadCurrentRegionCommand(tab ?? undefined);
  }
});

// Per-tab selector-health state. This remains a debug/stat signal only; the
// toolbar badge is reserved for user-actionable states.
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
if (__TRULY_DEV_BUILD__) {
  chrome.commands?.onCommand.addListener((cmd) => {
    if (cmd === "reload-extension") {
      debugLog("[Truly BG] reload-extension command → chrome.runtime.reload()");
      chrome.runtime.reload();
    }
  });
}

// Expose the buildId so probes can read it via sw.evaluate (Vite inlines
// __TRULY_BUILD_ID__ as a string literal at build time, so it isn't on
// globalThis unless we assign it explicitly).
(globalThis as any).__TRULY_BUILD_ID = __TRULY_BUILD_ID__;
debugLog(`[Truly BG] Service worker loaded buildId=${__TRULY_BUILD_ID__}`);
