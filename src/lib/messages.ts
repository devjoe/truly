/**
 * Typed message bus.
 *
 * Chrome extension code was previously passing around `{ type: "FOO_BAR", ... }`
 * objects as `any`, relying on string literals at every call site. This file
 * centralises the message schema as a TypeScript discriminated union so
 * adding a new message type is one-line change and all listeners get
 * compile-time exhaustiveness checking.
 *
 * Scope: runtime-level messages (content script ↔ service worker ↔ extension
 * pages). Window-level messages (MAIN ↔ isolated world via `window.postMessage`)
 * stay with the page-bridge code because they are not Chrome runtime messages.
 *
 * Usage:
 *   import type { TrulyMessage, PostClassifiedMsg } from "../lib/messages";
 *   chrome.runtime.sendMessage<TrulyMessage>({ type: "POST_CLASSIFIED", event });
 *   chrome.runtime.onMessage.addListener((msg: TrulyMessage) => { ... });
 */

import type {
  DashboardPostEvent,
  OpenAICompatibleFlavor,
  OpenAIResponseFormatMode,
  TierAOutputMode,
  SessionStats,
  TierAEndpointKind,
  TierAProvider,
  TierBProvider,
  UserSettings,
  Lang,
} from "./types";
import type { LlmPostContext } from "./ollama-client";
import type { ReadinessFeature, ReadinessRecord, ReadinessSnapshot } from "./readiness";

// ---------------------------------------------------------------------------
// Live dashboard pipeline (content script → service worker → side panel)
// ---------------------------------------------------------------------------

export interface PostClassifiedMsg {
  type: "POST_CLASSIFIED";
  event: DashboardPostEvent;
}

export interface DashboardReplayRequestMsg {
  type: "DASHBOARD_REPLAY_REQUEST";
}

export interface DashboardReplayMsg {
  type: "DASHBOARD_REPLAY";
  events: DashboardPostEvent[];
}

/** Broadcast from CS when the post most-centered in the FB viewport
 *  changes. The sidepanel's 閱讀 tab listens for this to update its
 *  always-expanded analysis pane. `id: null` means no post is currently
 *  in the viewport (top of feed, between feed loads). */
export interface CurrentViewPostMsg {
  type: "CURRENT_VIEW_POST";
  id: string | null;
}

/** Sidepanel asks the active Facebook content script to re-broadcast the
 *  current most-centered post. This covers cold-open/focus cases where the
 *  last CURRENT_VIEW_POST broadcast happened before the sidepanel listener
 *  was ready. */
export interface RequestCurrentViewPostMsg {
  type: "REQUEST_CURRENT_VIEW_POST";
}

/** Broadcast from the heads-up panel when the user clicks the summary
 *  row, signalling explicit interest in a specific post. The sidepanel's
 *  分析 pane honors this regardless of `analysisAutoFollow`. */
export interface ManualViewPostMsg {
  type: "MANUAL_VIEW_POST";
  id: string;
}

// ---------------------------------------------------------------------------
// Selector health (content script → service worker)
// ---------------------------------------------------------------------------

export interface SelectorHealthUpdateMsg {
  type: "SELECTOR_HEALTH_UPDATE";
  status: "healthy" | "unhealthy";
}

// ---------------------------------------------------------------------------
// Ollama classification proxy (content script → service worker → Ollama)
// ---------------------------------------------------------------------------

export interface OllamaClassifyRequest {
  id: string;
  text: string;
  context?: LlmPostContext;
}

/** Active fold rules sent in the Tier A prompt. The CS forwards
 *  `customFoldRules.filter(r => r.enabled).slice(0, MAX_ACTIVE_FOLD_RULES)` —
 *  the SW does NOT re-cap, since the cap is a UX/cost concern owned by
 *  the caller. Empty array (or omitted) means "no rules block in prompt". */
export interface CustomRulePromptInput {
  id: string;
  prompt: string;
}

export interface OllamaClassifyMsg {
  type: "OLLAMA_CLASSIFY";
  posts: OllamaClassifyRequest[];
  endpoint: string;
  model: string;
  provider?: TierAProvider;
  endpointKind?: TierAEndpointKind;
  openAICompatibleFlavor?: OpenAICompatibleFlavor;
  responseFormat?: OpenAIResponseFormatMode;
  outputMode?: TierAOutputMode;
  customRules?: CustomRulePromptInput[];
}

export interface OllamaResultMsg {
  type: "OLLAMA_RESULT";
  results: Record<string, unknown>;
  /** Post IDs that were submitted in this async request. Receiver uses this
   *  to distinguish "not in this request — leave pending" from "in this
   *  request but the model returned no entry — resolve as empty". */
  requestedIds: string[];
  /** Pipeline-level error when the entire request failed (fetch
   *  error, timeout, model offline). Individual post entries in `results`
   *  may also be missing; this gives the receiver a human-readable fallback
   *  reason for every missing post in the request. */
  error?: string;
}

export interface OllamaHealthCheckMsg {
  type: "OLLAMA_HEALTH_CHECK";
  endpoint: string;
  endpointKind?: TierAEndpointKind;
}

export interface OllamaHealthCheckResultMsg {
  type: "OLLAMA_HEALTH_CHECK_RESULT";
  ok: boolean;
  models?: string[];
  error?: string;
}

export interface OllamaResponseFormatCheckMsg {
  type: "OLLAMA_RESPONSE_FORMAT_CHECK";
  endpoint: string;
  model: string;
  endpointKind: TierAEndpointKind;
  openAICompatibleFlavor?: OpenAICompatibleFlavor;
  responseFormat?: OpenAIResponseFormatMode;
  outputMode?: TierAOutputMode;
}

export interface OllamaResponseFormatCheckResultMsg {
  type: "OLLAMA_RESPONSE_FORMAT_CHECK_RESULT";
  ok: boolean;
  error?: string;
  raw?: string;
  parseError?: string;
}

export interface OllamaCompactDigitsCheckMsg {
  type: "OLLAMA_COMPACT_DIGITS_CHECK";
  endpoint: string;
  model: string;
  endpointKind: TierAEndpointKind;
  openAICompatibleFlavor?: OpenAICompatibleFlavor;
  customRules?: CustomRulePromptInput[];
}

export interface OllamaCompactDigitsCheckResultMsg {
  type: "OLLAMA_COMPACT_DIGITS_CHECK_RESULT";
  ok: boolean;
  expectedLength?: number;
  raw?: string;
  error?: string;
}

export interface GeminiNanoProbeMsg {
  type: "GEMINI_NANO_PROBE";
  mode: "tier-a" | "tier-b";
}

export interface GeminiNanoProbeResultMsg {
  type: "GEMINI_NANO_PROBE_RESULT";
  ok: boolean;
  availability: string;
  error?: string;
}

export interface GeminiNanoSmokeMsg {
  type: "GEMINI_NANO_SMOKE";
  mode: "tier-a" | "tier-b";
  imageDataUrl?: string;
}

export interface GeminiNanoSmokeResultMsg {
  type: "GEMINI_NANO_SMOKE_RESULT";
  ok: boolean;
  mode: "tier-a" | "tier-b";
  summary?: string;
  error?: string;
}

/**
 * Tier B deep classification — content script asks the SW to call the Tier B
 * with the post text + image URLs after the post enters the aggressive
 * auto-trigger zone or the user expands post text. SW routes to the configured
 * Tier B endpoint.
 * Gated by `UserSettings.deepClassifyEnabled` AND `tierBEndpoint`
 * non-empty on the caller side.
 */
export interface DeepClassifyMsg {
  type: "DEEP_CLASSIFY";
  postId: string;
  text: string;
  imageUrls: string[];
  /** Count of post-content images dropped by `extractPostImages`'s
   *  Tier B unsafe URL pre-filter. Lets `callTierBDeep` set
   *  `imageStatus: "filtered"` when imageUrls is empty BUT the post
   *  did have images we refused to send. */
  filteredImageCount?: number;
  endpoint: string;
  model: string;
  provider?: TierBProvider | UserSettings["tierAProvider"];
  /** Desired locale for Tier B natural-language fields. Follows extension
   *  settings, not Facebook UI locale or post language. */
  outputLang?: Lang;
  /** Why Tier B was triggered. "auto" is the sequential-queue path.
   *  "manual" is retained for legacy captured/replayed payloads. */
  source?: "expand" | "manual" | "auto";
}

export interface DeepClassifyResultMsg {
  type: "DEEP_CLASSIFY_RESULT";
  postId: string;
  ok: boolean;
  deep?: import("./types").DeepClassification;
  error?: string;
}

/**
 * Tier B-2 reading brief — sidepanel asks the service worker to turn an
 * already-completed Tier B result into a compact reading/investigation plan.
 * This is triggered only by sidepanel focus, not feed viewport scanning.
 */
export interface ReadingBriefRequestMsg {
  type: "READING_BRIEF_REQUEST";
  postId: string;
  endpoint: string;
  model: string;
  provider?: TierBProvider | UserSettings["tierAProvider"];
  /** Desired locale for Reading Brief natural-language fields. Follows
   *  extension settings, not Facebook UI locale or post language. */
  outputLang?: Lang;
  event: DashboardPostEvent;
}

export interface ReadingBriefResultMsg {
  type: "READING_BRIEF_RESULT";
  postId: string;
  ok: boolean;
  brief?: import("./types").ReadingBrief;
  error?: string;
}

export interface ReadinessRunChecksMsg {
  type: "READINESS_RUN_CHECKS";
  settings: UserSettings;
  features?: ReadinessFeature[];
  tierAEndpoint?: string;
  tierAModel?: string;
  buildId?: string;
}

export interface ReadinessRunChecksResultMsg {
  type: "READINESS_RUN_CHECKS_RESULT";
  ok: boolean;
  records: ReadinessRecord[];
  snapshot?: ReadinessSnapshot;
  error?: string;
}

// ---------------------------------------------------------------------------
// Popup / options ↔ content script
// ---------------------------------------------------------------------------

export interface SettingsUpdatedMsg {
  type: "SETTINGS_UPDATED";
  settings: UserSettings;
}

export interface GetStatsMsg {
  type: "GET_STATS";
}

// Response shape for GET_STATS (not a message itself, just the callback value)
export type GetStatsResponse = SessionStats;

// ---------------------------------------------------------------------------
// Dashboard ↔ feed correlation
// ---------------------------------------------------------------------------

/** Dashboard requests the content script to scroll the matching FB post
 *  into view. The id is the dashboard's stable hash (author + text), not
 *  the FB post id — content scripts maintain a stableId → element map. */
export interface ScrollToPostMsg {
  type: "SCROLL_TO_POST";
  id: string;
}

/** Any surface (overlay, popup) requests that the side panel be opened
 *  and focused on a specific dashboard card (by stable id). Flow:
 *  source → service worker → chrome.sidePanel.open() + forward to sidepanel →
 *  sidepanel switches to Feed tab, scrolls, expands, flashes. */
export interface OpenDashboardForPostMsg {
  type: "OPEN_DASHBOARD_FOR_POST";
  id: string;
}

/** User toggles the side panel from an in-feed control. Unlike
 *  OPEN_DASHBOARD_FOR_POST, this may close the panel when it is already
 *  open in the current window. */
export interface ToggleDashboardForPostMsg {
  type: "TOGGLE_DASHBOARD_FOR_POST";
  id: string;
}

export interface GetSidePanelStateMsg {
  type: "GET_SIDE_PANEL_STATE";
  windowId: number;
}

export interface GetSidePanelStateResultMsg {
  type: "GET_SIDE_PANEL_STATE_RESULT";
  windowId: number;
  isOpen: boolean;
}

/** Content-script recovery actions cannot reliably call extension-page APIs
 *  directly, so they ask the service worker to open the full options page. */
export interface OpenOptionsPageMsg {
  type: "OPEN_OPTIONS_PAGE";
}

/** Broadcast to every Facebook tab telling its content script to wipe
 *  the in-memory classificationCache map (the persisted chrome.storage
 *  copy is cleared by the sender first). Sent by the sidepanel "清除
 *  分類快取" button. */
export interface CacheClearedMsg {
  type: "CACHE_CLEARED";
}

/** Probe a component's compiled buildId. Used to detect MV3 SW staleness:
 *  Chrome caches the compiled SW per-profile so a rebuilt dist may sit
 *  unused while the runtime keeps running an old version. Comparing
 *  GET_VERSION_RESULT.buildId against `dist/build-id.txt` reveals it. */
export interface GetVersionMsg {
  type: "GET_VERSION";
}
export interface GetVersionResultMsg {
  type: "GET_VERSION_RESULT";
  buildId: string;
  component: string;
}

// ---------------------------------------------------------------------------
// Debug snapshot — sidepanel "📦 匯出狀態" button asks every component for
// its console ring buffer (`installLogBuffer` in src/lib/log-buffer.ts).
// ---------------------------------------------------------------------------

export interface ExportLogBufferMsg {
  type: "EXPORT_LOG_BUFFER";
}
export interface FbTabStats {
  articleCount: number;
  trulyTaggedCount: number;
  overlayCount: number;
  headsUpPanelCount: number;
  sponsoredFoldedCount: number;
  rightRailAdFoldedCount: number;
  reelFoldedCount: number;
  url: string;
  scrollY: number;
  documentHeight: number;
}
export interface ExportLogBufferResultMsg {
  type: "EXPORT_LOG_BUFFER_RESULT";
  component: string;
  buildId: string;
  entries: import("./log-buffer").LogEntry[];
  /** Only populated by content-script responders — DOM signals from
   *  the FB tab the CS is attached to. Sidepanel/SW leave this undefined. */
  fbStats?: FbTabStats;
}

// ---------------------------------------------------------------------------
// Discriminated union of every runtime message
// ---------------------------------------------------------------------------

export type TrulyMessage =
  | PostClassifiedMsg
  | DashboardReplayRequestMsg
  | DashboardReplayMsg
  | CurrentViewPostMsg
  | RequestCurrentViewPostMsg
  | ManualViewPostMsg
  | SelectorHealthUpdateMsg
  | OllamaClassifyMsg
  | OllamaResultMsg
  | OllamaHealthCheckMsg
  | OllamaHealthCheckResultMsg
  | OllamaResponseFormatCheckMsg
  | OllamaResponseFormatCheckResultMsg
  | OllamaCompactDigitsCheckMsg
  | OllamaCompactDigitsCheckResultMsg
  | GeminiNanoProbeMsg
  | GeminiNanoProbeResultMsg
  | GeminiNanoSmokeMsg
  | GeminiNanoSmokeResultMsg
  | DeepClassifyMsg
  | DeepClassifyResultMsg
  | ReadingBriefRequestMsg
  | ReadingBriefResultMsg
  | ReadinessRunChecksMsg
  | ReadinessRunChecksResultMsg
  | SettingsUpdatedMsg
  | GetStatsMsg
  | ScrollToPostMsg
  | OpenDashboardForPostMsg
  | ToggleDashboardForPostMsg
  | GetSidePanelStateMsg
  | GetSidePanelStateResultMsg
  | OpenOptionsPageMsg
  | CacheClearedMsg
  | GetVersionMsg
  | GetVersionResultMsg
  | ExportLogBufferMsg
  | ExportLogBufferResultMsg;

export type TrulyMessageType = TrulyMessage["type"];

/**
 * Narrow an unknown value (from chrome.runtime.onMessage) to a TrulyMessage.
 * Listeners should check this first before switching on `msg.type`.
 */
export function isTrulyMessage(x: unknown): x is TrulyMessage {
  return (
    typeof x === "object" &&
    x !== null &&
    typeof (x as { type?: unknown }).type === "string"
  );
}
