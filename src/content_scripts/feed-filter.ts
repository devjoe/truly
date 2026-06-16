// Content scripts must be IIFE (no ES module imports allowed in MV3 content scripts)
const browser = chrome;
import { DEFAULT_SETTINGS } from "../lib/types";
import type { DashboardPostEvent, FilterDecision, PostData, UserSettings, DeepClassification, ZhtwReview, TextCompleteness } from "../lib/types";
import type { TrulyMessage, DeepClassifyMsg, DeepClassifyResultMsg, ReadingBriefResultMsg, ExportLogBufferResultMsg } from "../lib/messages";
import { installLogBuffer, snapshotLogBuffer } from "../lib/log-buffer";
import { buildStructuredPostContext, buildTierBPostText } from "../lib/post-context";
import { normalizeStructuredPostContext } from "../lib/source-context-normalizer";
import type { StructuredPostContext } from "../lib/source-context-types";
import { providerNeedsEndpoint } from "../lib/provider-capabilities";
import { resolveTierBFeatureGate } from "../lib/feature-readiness";
import { resolveLanguage } from "../lib/i18n";
import { debugLog } from "../lib/logger";

// Capture console output before any [Truly] line fires so the
// debug snapshot bundle can replay them.
installLogBuffer();
import {
  startFeedInterception,
  rescanVisiblePosts,
  setHealthCallback,
  extractPostBody,
  extractSharedAttachmentText,
  extractPostIdentity,
  extractPrimaryMessageText,
  cleanText,
  skipMixedFeedContainer,
  extractReshareWithComment,
} from "./feed-interception";
import {
  applyOverlay,
  clearAllHeadsUpSurfaces,
  clearHeadsUpSurface,
  reserveHeadsUpSlot,
  setHeadsUpThemeMode,
  setSponsoredDisplayMode,
  setOllamaModel,
  syncHeadsUpThemes,
  syncLocalizedContentSurfaces,
} from "./overlay";
import {
  classifyPost,
  clearCache,
  getCacheSize,
  getStats,
  hydrateCache,
  recordDeepClassification,
  resetStats,
  setOllamaConfig,
  updateSettings,
} from "../lib/filter-engine";
import { extractPostImages } from "../lib/image-extraction";
import { prefetchImagesForTierB } from "../lib/image-prefetch";
import {
  normalizeUserSettings,
  resolveEffectiveTierBEndpoint,
  resolveEffectiveTierBModel,
  resolveEffectiveTierBProvider,
} from "../lib/settings";
import { stripLeadingPostIdentity } from "../lib/post-text";
import { scanSourceWithZhtw, ZHTW_MCP_SOURCE_VERSION } from "../lib/zhtw-scanner";
import { buildZhtwTextSegments } from "../lib/zhtw-review";
import { defaultEndpointForProvider, defaultModelForProvider } from "../lib/model-source-config";
import { scanCollapsibleSurfaces, startSurfaceCollapseObserver, updateSurfaceCollapseSettings, updateSurfaceCollapseLanguage } from "./surface-collapse";

// Live copy of current settings. Refreshed on `loadAndApplySettings()`
// and on SETTINGS_UPDATED messages. Read by the Tier B dispatch path
// so a settings flip takes effect for the next queue pick without page reload.
let liveSettings: UserSettings = { ...DEFAULT_SETTINGS };
let liveTierAEndpoint = defaultEndpointForProvider("ollama");
let liveTierAModel = defaultModelForProvider("ollama", "reading-prompt");
let visiblePostRescanTimer: number | null = null;
let lastObservedHref = "";

function currentContentLang() {
  return resolveLanguage(liveSettings.language);
}

async function loadAndApplySettings() {
  const [result, stored] = await Promise.all([
    browser.storage.sync.get(["settings"]),
    browser.storage.local.get(["ollamaEndpoint", "ollamaModel"]),
  ]);
  const settings = normalizeUserSettings(result.settings as Partial<UserSettings> | undefined);
  liveSettings = settings;
  updateSettings(settings);
  setHeadsUpThemeMode(settings.themeMode);
  setSponsoredDisplayMode(settings.sponsoredDisplayMode);
  updateSurfaceCollapseSettings(settings, currentContentLang());

  liveTierAEndpoint = (stored.ollamaEndpoint as string) || defaultEndpointForProvider("ollama");
  liveTierAModel = (stored.ollamaModel as string) || defaultModelForProvider("ollama", "reading-prompt");
  setOllamaConfig(liveTierAEndpoint, liveTierAModel);
  setOllamaModel(liveTierAModel);
}

// ---------------------------------------------------------------------------
// Tier B: sequential-queue deep multimodal classification
// ---------------------------------------------------------------------------
//
// IntersectionObserver uses rootMargin=600px so posts up to 600px below
// the fold already start the 300ms candidate phase. By the time they
// scroll into view, they're often already in the queue (or inflight).
//
// Posts entering the rootMargin zone wait 300ms, then join a FIFO queue
// processed one-at-a-time. The most-centered visible post always jumps to
// the front. Posts leaving the zone during candidate phase are cancelled;
// enqueued posts that leave are removed.
// "查看更多" clicks bypass the queue so expanded text can be analyzed quickly.
// When the queue is drained, idle pre-fetch picks the closest below-fold
// post so the Tier B endpoint stays warm and results arrive before the user scrolls down.
const postIdToData = new Map<string, PostData>();
const POST_DATA_MAX_SIZE = 500;
const postIdToTierA = new Map<string, FilterDecision>();
const zhtwReviewCache = new Map<string, ZhtwReview>();
const zhtwInflight = new Map<string, string>();
const zhtwAppliedKey = new Map<string, string>();

// Per-post normalized text signature seen at the last Tier B dispatch.
// Auto prefetch updates the baseline. A user clicking "查看更多" reruns
// Tier B whenever the cleaned text actually grows, because the newly revealed
// tail often contains the conclusion, CTA, caveat, or source context.
const lastDispatchedLength = new Map<string, number>();
const lastDispatchedTextHash = new Map<string, string>();
const inFlightDispatchedTextHash = new Map<string, string>();
const readingBriefPrefetchInflight = new Set<string>();
const readingBriefPrefetchCompleted = new Set<string>();

function rememberPostData(stableId: string, post: PostData): void {
  if (postIdToData.has(stableId)) postIdToData.delete(stableId);
  postIdToData.set(stableId, post);

  while (postIdToData.size > POST_DATA_MAX_SIZE) {
    const oldest = postIdToData.keys().next().value;
    if (!oldest) break;
    postIdToData.delete(oldest);
  }
}

// ---- sequential queue state ----
const TIER_B_CANDIDATE_MS = 300;
const tierBQueue: Array<{ el: HTMLElement; stableId: string }> = [];
let tierBInflight = false;
let tierBInflightStableId: string | null = null;
const tierBCandidates = new Map<string, ReturnType<typeof setTimeout>>();

// Audit log for measuring queue behaviour. Stamped on window so CDP
// probes can read it. Reset on page reload. Also mirrored to
// document.documentElement.dataset so MAIN-world CDP can read it
// (ISOLATED world window is invisible to MAIN).
(window as any).__trulyAuditLog = [] as Array<{ ts: number; event: string; stableId: string;[k: string]: unknown }>;
const __trulyAuditLog = (window as any).__trulyAuditLog as Array<{ ts: number; event: string; stableId: string;[k: string]: unknown }>;
// Tracks posts that are in the rootMargin zone but not yet in the actual
// viewport. When they cross into the viewport we log "viewport-enter".
const __trulyMarginOnly = new Set<string>();
function __trulyFlushAuditToDom() {
  try { document.documentElement.dataset.trulyAuditLog = JSON.stringify(__trulyAuditLog.slice(-200)); } catch {}
}
function __trulyAudit(entry: Record<string, unknown>) {
  __trulyAuditLog.push(entry as any);
  __trulyFlushAuditToDom();
}

function tierBOnEnter(el: HTMLElement, stableId: string) {
  if (!liveSettings.deepClassifyEnabled) {
    __trulyAudit({ ts: performance.now(), event: "skip-deep-disabled", stableId });
    return;
  }
  const provider = resolveEffectiveTierBProvider(liveSettings);
  const endpoint = resolveEffectiveTierBEndpoint(liveSettings, liveTierAEndpoint);
  if (providerNeedsEndpoint(provider) && !endpoint) {
    __trulyAudit({ ts: performance.now(), event: "skip-no-endpoint", stableId });
    return;
  }
  if (skipMixedFeedContainer(el)) {
    __trulyAudit({ ts: performance.now(), event: "skip-mixed-container", stableId });
    tierBOnLeave(stableId);
    return;
  }
  if (tierBQueue.some(e => e.stableId === stableId) || tierBInflightStableId === stableId) return;
  if (tierBCandidates.has(stableId)) return;
  // Skip posts that already have a Tier B result (FB virtual-scroll
  // remounts fire new IO events for posts that were already classified).
  const prevDecision = postIdToTierA.get(stableId);
  if (prevDecision?.deepClassification) return;

  const vh = window.innerHeight;
  const rect = el.getBoundingClientRect();
  const actuallyVisible = rect.bottom > 0 && rect.top < vh;
  const now = performance.now();
  __trulyAudit({ ts: now, event: "enter", stableId, actuallyVisible, distBelow: actuallyVisible ? 0 : Math.round(rect.top - vh) });

  const timer = setTimeout(() => {
    tierBCandidates.delete(stableId);
    if (!document.contains(el)) {
      __trulyAudit({ ts: performance.now(), event: "skip-detached-before-enqueue", stableId });
      return;
    }
    if (skipMixedFeedContainer(el)) {
      __trulyAudit({ ts: performance.now(), event: "skip-mixed-before-enqueue", stableId });
      return;
    }
    if (tierBQueue.some(e => e.stableId === stableId) || tierBInflightStableId === stableId) {
      __trulyAudit({ ts: performance.now(), event: "skip-duplicate-before-enqueue", stableId });
      return;
    }
    __trulyAudit({ ts: performance.now(), event: "enqueue", stableId, candidateMs: TIER_B_CANDIDATE_MS, queueDepth: tierBQueue.length + 1 });
    tierBQueue.push({ el, stableId });
    tierBDrain();
  }, TIER_B_CANDIDATE_MS);
  tierBCandidates.set(stableId, timer);
}

function tierBOnLeave(stableId: string) {
  const timer = tierBCandidates.get(stableId);
  if (timer) {
    clearTimeout(timer);
    tierBCandidates.delete(stableId);
    return;
  }
  const idx = tierBQueue.findIndex(e => e.stableId === stableId);
  if (idx >= 0) tierBQueue.splice(idx, 1);
}

async function tierBDrain() {
  if (tierBInflight || tierBQueue.length === 0) return;
  tierBInflight = true;

  try {
    while (tierBQueue.length > 0) {
      let pickIdx = 0;
      const vh = window.innerHeight;
      const center = vh / 2;
      let bestDist = Infinity;

      for (let i = 0; i < tierBQueue.length; i++) {
        const { el } = tierBQueue[i];
        if (!document.contains(el)) {
          tierBQueue.splice(i, 1);
          i--;
          continue;
        }
        if (skipMixedFeedContainer(el)) {
          tierBQueue.splice(i, 1);
          i--;
          continue;
        }
        const rect = el.getBoundingClientRect();
        if (rect.bottom <= 0 || rect.top >= vh) continue;
        const elCenter = (rect.top + rect.bottom) / 2;
        const dist = Math.abs(elCenter - center);
        if (dist < bestDist) {
          bestDist = dist;
          pickIdx = i;
        }
      }

      if (pickIdx >= tierBQueue.length) break;
      const entry = tierBQueue.splice(pickIdx, 1)[0];
      if (!entry || !document.contains(entry.el)) continue;

      tierBInflightStableId = entry.stableId;
      __trulyAudit({ ts: performance.now(), event: "dequeue", stableId: entry.stableId, remaining: tierBQueue.length });
      try {
        await dispatchDeepClassify(entry.el, "auto");
      } catch (err) {
        console.warn("[Truly] Tier B dispatch failed:", err);
        __trulyAudit({ ts: performance.now(), event: "deep-dispatch-error", stableId: entry.stableId });
      }
      tierBInflightStableId = null;
    }
  } finally {
    tierBInflightStableId = null;
    tierBInflight = false;
  }

  // Idle pre-fetch: when no visible posts are waiting, warm Tier B with the
  // closest below-fold post (within 2× viewport height). The result paints
  // immediately when the user scrolls down.
  tierBIdlePrefetch();
}

async function tierBIdlePrefetch() {
  if (tierBQueue.length > 0) return; // visible posts arrived in the meantime
  if (tierBInflight) return;

  const vh = window.innerHeight;
  let bestEl: HTMLElement | null = null;
  let bestStableId: string | null = null;
  let bestDist = Infinity;

  for (const [stableId, post] of postIdToData) {
    const el = post.element;
    if (!document.contains(el)) continue;
    if (skipMixedFeedContainer(el)) continue;
    const rect = el.getBoundingClientRect();
    if (rect.top <= vh) continue; // already visible or above
    if (rect.top - vh > vh * 2) continue; // too far below, don't speculatively burn Tier B

    const decision = postIdToTierA.get(stableId);
    if (decision?.deepClassification) continue; // already has Tier B result
    if (tierBQueue.some(e => e.stableId === stableId)) continue;
    if (tierBInflightStableId === stableId) continue;
    if (tierBCandidates.has(stableId)) continue;

    const dist = rect.top - vh;
    if (dist < bestDist) {
      bestDist = dist;
      bestEl = el;
      bestStableId = stableId;
    }
  }

  if (bestEl && bestStableId) {
    __trulyAudit({ ts: performance.now(), event: "idle-prefetch", stableId: bestStableId, distPx: bestDist });
    tierBInflight = true;
    tierBInflightStableId = bestStableId;
    try {
      await dispatchDeepClassify(bestEl, "auto");
      __trulyAudit({ ts: performance.now(), event: "idle-prefetch-done", stableId: bestStableId });
    } catch (err) {
      console.warn("[Truly] Tier B idle prefetch failed:", err);
      __trulyAudit({ ts: performance.now(), event: "idle-prefetch-error", stableId: bestStableId });
    } finally {
      tierBInflightStableId = null;
      tierBInflight = false;
    }

    // After idle pre-fetch completes, drain again in case new posts
    // entered the viewport while we were working.
    tierBDrain();
  }
}

function decodeTierBError(raw: string): string {
  switch (raw) {
    case "tier_b_network_error":
    case "vllm_failed":
      return "tier_b_network_error";
    case "tier_b_timeout":
      return "tier_b_timeout";
    case "tier_b_http_error":
      return "tier_b_http_error";
    case "tier_b_format_error":
    case "tier_b_response_truncated":
    case "tier_b_reasoning_without_json":
    case "tier_b_failed":
      return "tier_b_format_error";
    case "image_decode_failed": return "image_decode_failed";
    case "timeout": return "tier_b_timeout";
    default: return raw;
  }
}

function hashString(text: string): string {
  let h = 5381;
  for (let i = 0; i < text.length; i += 1) h = ((h << 5) + h + text.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

function zhtwCacheKey(post: PostData): string | null {
  const segments = buildZhtwTextSegments(post);
  if (segments.length === 0) return null;
  return `${ZHTW_MCP_SOURCE_VERSION}:${hashString(JSON.stringify(segments.map((segment) => [
    segment.kind,
    segment.text,
  ])))}`;
}

function emitPostClassified(
  stableId: string,
  post: PostData,
  decision: FilterDecision,
  opts: {
    elapsedMs?: number;
    fullText?: string;
    summary?: string;
    textCompleteness?: TextCompleteness;
    sourceContext?: StructuredPostContext;
  } = {},
): DashboardPostEvent {
  const postUrl = post.postUrl ?? extractPostUrlFromArticle(post.element);
  const pageUrl = post.pageUrl ?? window.location.href;
  post.postUrl = postUrl;
  post.pageUrl = pageUrl;
  const fullText = opts.fullText ?? post.text;
  const textCompleteness = opts.textCompleteness ?? inferTextCompleteness(post, fullText);
  const sourceContext = normalizeStructuredPostContext(opts.sourceContext ?? buildStructuredPostContext({
    ...post,
    text: fullText,
    fullText,
  }));
  const event: DashboardPostEvent = {
    id: stableId,
    text: fullText.slice(0, 200),
    fullText: fullText.slice(0, 2000),
    sourceContext,
    authorName: post.authorName,
    sourceName: post.sourceName,
    hasMedia: post.hasMedia,
    isSponsored: post.element.dataset.trulySponsored === "true",
    timestamp: new Date().toISOString(),
    elapsedMs: opts.elapsedMs ?? 0,
    decision,
    summary: opts.summary ?? decision.deepClassification?.summary,
    postType: post.postType,
    contentKind: post.contentKind,
    sharedAttachmentText: post.sharedAttachmentText,
    reshareOriginalText: post.reshareOriginalText,
    reshareOriginalAuthor: post.reshareOriginalAuthor,
    postUrl,
    pageUrl,
    textCompleteness,
    zhtwReview: decision.zhtwReview,
    zhtwReviewError: decision.zhtwReviewError,
  };
  const msg: TrulyMessage = {
    type: "POST_CLASSIFIED",
    event,
  };
  browser.runtime.sendMessage(msg).catch(() => {});
  return event;
}

function isMeaningfullyVisible(el: HTMLElement): boolean {
  const rect = el.getBoundingClientRect();
  const vh = window.innerHeight || document.documentElement.clientHeight;
  return rect.bottom > 0 && rect.top < vh;
}

function readingBriefPrefetchKey(event: DashboardPostEvent, outputLang = currentContentLang()): string {
  return `${event.id}:${outputLang}:${hashString(event.fullText || event.text || "")}`;
}

function rememberCompletedReadingBriefPrefetch(key: string): void {
  if (readingBriefPrefetchCompleted.has(key)) readingBriefPrefetchCompleted.delete(key);
  readingBriefPrefetchCompleted.add(key);

  while (readingBriefPrefetchCompleted.size > POST_DATA_MAX_SIZE) {
    const oldest = readingBriefPrefetchCompleted.values().next().value;
    if (!oldest) break;
    readingBriefPrefetchCompleted.delete(oldest);
  }
}

function maybePrefetchReadingBrief(event: DashboardPostEvent, post: PostData): void {
  if (!event.decision.deepClassification) return;
  if (event.readingBrief || event.readingBriefPending || event.readingBriefError) return;
  if (!isMeaningfullyVisible(post.element)) return;

  const gate = resolveTierBFeatureGate("reading_brief", liveSettings, {
    tierAEndpoint: liveTierAEndpoint,
    tierAModel: liveTierAModel,
  });
  if (!gate.canRun) {
    __trulyAudit({
      ts: performance.now(),
      event: "reading-brief-prefetch-skip",
      stableId: event.id,
      reason: gate.blockedStatus ?? "blocked",
    });
    return;
  }

  const outputLang = currentContentLang();
  const key = readingBriefPrefetchKey(event, outputLang);
  if (readingBriefPrefetchInflight.has(key) || readingBriefPrefetchCompleted.has(key)) return;

  readingBriefPrefetchInflight.add(key);
  __trulyAudit({ ts: performance.now(), event: "reading-brief-prefetch", stableId: event.id });

  const req: TrulyMessage = {
    type: "READING_BRIEF_REQUEST",
    postId: event.id,
    endpoint: gate.endpoint,
    model: gate.model,
    provider: gate.effectiveProvider,
    outputLang,
    event,
  };
  browser.runtime.sendMessage(req).then((reply: ReadingBriefResultMsg | undefined) => {
    if (reply?.ok) {
      rememberCompletedReadingBriefPrefetch(key);
      __trulyAudit({ ts: performance.now(), event: "reading-brief-prefetch-done", stableId: event.id });
      return;
    }
    __trulyAudit({
      ts: performance.now(),
      event: "reading-brief-prefetch-failed",
      stableId: event.id,
      error: reply?.error ?? "missing_reply",
    });
  }).catch((error) => {
    __trulyAudit({
      ts: performance.now(),
      event: "reading-brief-prefetch-error",
      stableId: event.id,
      error: error instanceof Error ? error.message : String(error),
    });
  }).finally(() => {
    readingBriefPrefetchInflight.delete(key);
  });
}

function applyZhtwReview(stableId: string, post: PostData, review: ZhtwReview): void {
  if (currentContentLang() !== "zh-TW") return;
  const current = postIdToTierA.get(stableId);
  if (!current) return;
  const key = zhtwCacheKey(post);
  if (key) zhtwAppliedKey.set(stableId, key);
  const updated: FilterDecision = {
    ...current,
    zhtwReview: review,
    zhtwReviewError: undefined,
  };
  postIdToTierA.set(stableId, updated);
  applyOverlay(post, updated, { lang: currentContentLang() });
  emitPostClassified(stableId, post, updated);
}

function triggerZhtwReview(stableId: string, post: PostData): void {
  if (currentContentLang() !== "zh-TW") return;
  const key = zhtwCacheKey(post);
  if (!key) return;

  const current = postIdToTierA.get(stableId);
  if (current?.zhtwReview && !current.zhtwReviewError && zhtwAppliedKey.get(stableId) === key) return;

  const cached = zhtwReviewCache.get(key);
  if (cached) {
    applyZhtwReview(stableId, post, cached);
    return;
  }

  if (zhtwInflight.get(stableId) === key) return;
  zhtwInflight.set(stableId, key);
  scanSourceWithZhtw(post)
    .then((review) => {
      zhtwReviewCache.set(key, review);
      if (zhtwInflight.get(stableId) !== key) return;
      const latestPost = postIdToData.get(stableId) ?? post;
      const latestKey = zhtwCacheKey(latestPost);
      if (latestKey !== key) {
        if (zhtwInflight.get(stableId) === key) zhtwInflight.delete(stableId);
        if (latestKey) window.setTimeout(() => triggerZhtwReview(stableId, latestPost), 0);
        return;
      }
      applyZhtwReview(stableId, latestPost, review);
    })
    .catch((err) => {
      console.warn(`[Truly] zhtw review failed: id=${stableId}`, err);
      const currentDecision = postIdToTierA.get(stableId);
      if (!currentDecision) return;
      const updated: FilterDecision = {
        ...currentDecision,
        zhtwReviewError: err instanceof Error ? err.message.slice(0, 120) : "zhtw_failed",
      };
      postIdToTierA.set(stableId, updated);
      emitPostClassified(stableId, postIdToData.get(stableId) ?? post, updated);
    })
    .finally(() => {
      if (zhtwInflight.get(stableId) === key) zhtwInflight.delete(stableId);
    });
}

function normalizeDispatchText(text: string): string {
  return text
    .replace(/查看更多内容|查看更多|See more|もっと見る|더 보기/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const TRUNCATED_TEXT_MARKER_RE = /(?:……|\.\.\.)\s*(?:查看更多内容|查看更多|顯示更多|See more|Show more|もっと見る|더 보기)/i;

function hasPostExpandControl(postEl: HTMLElement): boolean {
  for (const candidate of Array.from(postEl.querySelectorAll<HTMLElement>('[role="button"]'))) {
    const btn = isExpandButton(candidate);
    if (btn && !isNestedArticleControl(btn, postEl)) return true;
  }
  return false;
}

function inferTextCompleteness(post: PostData, text: string = post.text): TextCompleteness {
  if (post.textCompleteness === "expanded_or_upgraded") return "expanded_or_upgraded";
  if (TRUNCATED_TEXT_MARKER_RE.test(text) || hasPostExpandControl(post.element)) return "likely_truncated";
  return post.textCompleteness ?? "visible_complete";
}

function textCompletenessRank(value: TextCompleteness | undefined): number {
  if (value === "expanded_or_upgraded") return 3;
  if (value === "visible_complete") return 2;
  if (value === "likely_truncated") return 1;
  return 0;
}

function mergePreservedPostData(next: PostData, previous: PostData | undefined): PostData {
  if (!previous) return next;
  const previousLen = normalizeDispatchText(previous.text || "").length;
  const nextLen = normalizeDispatchText(next.text || "").length;
  const previousRank = textCompletenessRank(previous.textCompleteness);
  const nextRank = textCompletenessRank(next.textCompleteness);
  const shouldKeepPreviousText =
    previousRank > nextRank &&
    previousLen > nextLen + 30;
  if (!shouldKeepPreviousText) return next;

  return {
    ...previous,
    element: next.element,
    hasMedia: previous.hasMedia || next.hasMedia,
    isRecommended: previous.isRecommended ?? next.isRecommended,
    postUrl: next.postUrl || previous.postUrl,
    pageUrl: next.pageUrl || previous.pageUrl,
  };
}

function hashDispatchText(text: string): string {
  let hash = 2166136261;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function mergeLiveExpandedPost(stored: PostData, fresh: PostData | null, el: HTMLElement): PostData {
  if (!fresh) return { ...stored, element: el };
  const storedIsShare =
    stored.contentKind === "share_without_comment" ||
    stored.contentKind === "reshare_with_comment" ||
    stored.postType === "reshare";
  if (!storedIsShare || fresh.contentKind !== "standard") return { ...fresh, element: el };

  const expandedSharedText =
    fresh.sharedAttachmentText ||
    fresh.reshareOriginalText ||
    fresh.text ||
    stored.sharedAttachmentText ||
    stored.reshareOriginalText;

  return {
    ...fresh,
    text: stored.text,
    contentKind: stored.contentKind,
    postType: stored.postType || "reshare",
    sharedAttachmentText: stored.contentKind === "share_without_comment"
      ? expandedSharedText
      : fresh.sharedAttachmentText ?? stored.sharedAttachmentText,
    reshareOriginalText: stored.contentKind === "reshare_with_comment"
      ? expandedSharedText
      : stored.reshareOriginalText,
    reshareOriginalAuthor: stored.reshareOriginalAuthor || fresh.reshareOriginalAuthor,
    element: el,
  };
}

/** Build the DEEP_CLASSIFY payload by re-extracting post text from the
 *  live DOM (not from the stale `post.text` snapshot — feed-interception
 *  captured that BEFORE the user clicked 查看更多 / See more). Returns
 *  null if Tier B isn't enabled, no endpoint, or the post hasn't passed
 *  Tier A yet. `source` is just for log clarity (auto vs expand/manual). */
async function dispatchDeepClassify(el: HTMLElement, source: "auto" | "expand" | "manual"): Promise<void> {
  const stableId = el.dataset.trulyStableId;
  const trulyId = el.dataset.trulyId;
  const id = stableId || trulyId;
  if (id && skipMixedFeedContainer(el)) {
    __trulyAudit({ ts: performance.now(), event: "skip-mixed-container", stableId: id, source });
    return Promise.resolve();
  }
  if (!id) return Promise.resolve();
  const storedPost = postIdToData.get(id);
  if (!storedPost) {
    __trulyAudit({ ts: performance.now(), event: "skip-missing-post", stableId: id, source });
    return Promise.resolve();
  }
  const post = source === "expand" || source === "manual"
    ? mergeLiveExpandedPost(storedPost, postFromArticle(el), el)
    : storedPost;
  if (post !== storedPost) rememberPostData(id, post);

  // Re-extract text from the live element so post-expand content reaches
  // Tier B and Tier A-2 zhtw. Fall back to the snapshot if extractor
  // returns nothing.
  let liveText = "";
  try {
    liveText = extractPrimaryMessageText(el, {
      authorName: post.authorName,
      sourceName: post.sourceName,
    }) || cleanText(extractPostBody(el));
  } catch {
    /* fall through to post.text */
  }
  const rawText = liveText && liveText.length > post.text.length ? liveText : post.text;
  const identity = { authorName: post.authorName, sourceName: post.sourceName };
  const visibleText = stripLeadingPostIdentity(rawText, identity);
  let text = buildTierBPostText(post, visibleText);
  let sourceContext = buildStructuredPostContext({
    ...post,
    text: rawText,
    fullText: rawText,
  });
  const expandedRawFallback = stripLeadingPostIdentity(post.text, identity);
  if (
    source === "expand" &&
    !TRUNCATED_TEXT_MARKER_RE.test(expandedRawFallback) &&
    normalizeDispatchText(expandedRawFallback).length > normalizeDispatchText(text).length + 30
  ) {
    text = expandedRawFallback;
    sourceContext = buildStructuredPostContext({
      ...post,
      text: expandedRawFallback,
      fullText: expandedRawFallback,
    });
  }
  const textCompleteness: TextCompleteness =
    source === "expand" ? "expanded_or_upgraded" : inferTextCompleteness({ ...post, element: el }, text);
  const dispatchPost: PostData = post.text === text && post.textCompleteness === textCompleteness
    ? post
    : { ...post, text, textCompleteness };
  rememberPostData(id, dispatchPost);
  triggerZhtwReview(id, dispatchPost);
  const outputLang = currentContentLang();

  if (!liveSettings.deepClassifyEnabled) {
    __trulyAudit({ ts: performance.now(), event: "skip-deep-disabled", stableId: id, source });
    return Promise.resolve();
  }
  const provider = resolveEffectiveTierBProvider(liveSettings);
  const endpoint = resolveEffectiveTierBEndpoint(liveSettings, liveTierAEndpoint);
  if (providerNeedsEndpoint(provider) && !endpoint) {
    __trulyAudit({ ts: performance.now(), event: "skip-no-endpoint", stableId: id, source });
    return Promise.resolve();
  }
  const model = resolveEffectiveTierBModel(liveSettings, liveTierAModel);
  if (!model) {
    __trulyAudit({ ts: performance.now(), event: "skip-no-model", stableId: id, source });
    return Promise.resolve();
  }

  const normalizedText = normalizeDispatchText(text);
  const textHash = hashDispatchText(normalizedText);
  const snapshotText = buildTierBPostText(
    post,
    stripLeadingPostIdentity(post.text, identity),
  );
  const normalizedSnapshot = normalizeDispatchText(snapshotText);
  const snapshotHash = hashDispatchText(normalizedSnapshot);
  const prevLen = Math.max(lastDispatchedLength.get(id) ?? 0, source === "expand" ? normalizedSnapshot.length : 0);
  const prevHash = lastDispatchedTextHash.get(id) ?? (source === "expand" ? snapshotHash : undefined);
  if (source === "expand" && prevLen > 0 && normalizedText.length <= prevLen && textHash === prevHash) {
    debugLog(
      `[Truly] Tier B skip-${source}: id=${id} len=${normalizedText.length} prev=${prevLen} ` +
        `hashChanged=${textHash !== prevHash} (no expanded text growth)`,
    );
    __trulyAudit({
      ts: performance.now(),
      event: "skip-expand-no-growth",
      stableId: id,
      source,
      textLen: normalizedText.length,
      prevLen,
      hashChanged: textHash !== prevHash,
    });
    const cachedDecision = postIdToTierA.get(id);
    if (cachedDecision) {
      emitPostClassified(id, dispatchPost, cachedDecision, {
        fullText: text,
        textCompleteness: "expanded_or_upgraded",
        sourceContext,
      });
    }
    return Promise.resolve();
  }
  const inFlightHash = inFlightDispatchedTextHash.get(id);
  if (source !== "manual" && inFlightHash === textHash) {
    debugLog(
      `[Truly] Tier B skip-${source}: id=${id} len=${normalizedText.length} ` +
        `(duplicate dispatch in flight)`,
    );
    __trulyAudit({
      ts: performance.now(),
      event: "skip-duplicate-in-flight",
      stableId: id,
      source,
      textLen: normalizedText.length,
    });
    return Promise.resolve();
  }
  lastDispatchedLength.set(id, normalizedText.length);
  lastDispatchedTextHash.set(id, textHash);
  inFlightDispatchedTextHash.set(id, textHash);

  const clearInFlight = () => {
    if (inFlightDispatchedTextHash.get(id) === textHash) {
      inFlightDispatchedTextHash.delete(id);
    }
  };

  const { urls: extractedUrls, filteredCount: filteredFromExtract } = extractPostImages(el);

  // Client-side prefetch: fetch each kept URL with the user's FB session
  // cookies, re-encode to JPEG via canvas. This sidesteps both the
  // IP+cookie-bound 403 class (remote endpoint has a different IP) and
  // the SVG / animation-frame PIL crash class. See the image-prefetch module
  // comment for rationale and trade-offs.
  let dataUrls: string[];
  let droppedCount: number;
  try {
    ({ dataUrls, droppedCount } = await prefetchImagesForTierB(extractedUrls));
  } catch (error) {
    __trulyAudit({
      ts: performance.now(),
      event: "prefetch-error",
      stableId: id,
      source,
      imageCount: extractedUrls.length,
      error: error instanceof Error ? error.message : String(error),
    });
    clearInFlight();
    throw error;
  }
  const imageUrls = dataUrls;
  const filteredImageCount = filteredFromExtract + droppedCount;
  const totalImageBytes = imageUrls.reduce((s, u) => s + u.length, 0);

  if (!text.trim() && imageUrls.length === 0) {
    debugLog(
      `[Truly] Tier B skip-${source}: id=${id} empty payload (textLen=0 images=0 filteredImages=${filteredImageCount})`,
    );
    __trulyAudit({
      ts: performance.now(),
      event: "skip-empty-payload",
      stableId: id,
      source,
      textLen: 0,
      images: imageUrls.length,
      filteredImageCount,
    });
    clearInFlight();
    return Promise.resolve();
  }

  debugLog(
    `[Truly] Tier B ${source}-fire: id=${id} textLen=${text.length} (snapshot=${post.text.length}) images=${imageUrls.length} (extracted=${extractedUrls.length} extractFiltered=${filteredFromExtract} prefetchDropped=${droppedCount}) imageBytes=${totalImageBytes} provider=${provider} endpoint=${endpoint || "-"}`,
  );
  __trulyAudit({
    ts: performance.now(),
    event: "dispatch",
    stableId: id,
    source,
    textLen: text.length,
    snapshotLen: post.text.length,
    images: imageUrls.length,
    extractedImages: extractedUrls.length,
    filteredImageCount,
  });

  const req: DeepClassifyMsg = {
    type: "DEEP_CLASSIFY",
    postId: id,
    text,
    imageUrls,
    filteredImageCount,
    endpoint,
    model,
    provider,
    outputLang,
    source,
  };
  const pendingDecision = postIdToTierA.get(id);
  if (pendingDecision) {
    const updated: FilterDecision = {
      ...pendingDecision,
      tierBPending: true,
      tierBError: undefined,
    };
    postIdToTierA.set(id, updated);
    applyOverlay(dispatchPost, updated, { lang: currentContentLang() });
  }
  const bStartTime = performance.now();
  return browser.runtime.sendMessage(req).then((reply: DeepClassifyResultMsg | undefined) => {
    const bDuration = performance.now() - bStartTime;
    if (!reply || !reply.ok || !reply.deep) {
      console.warn(`[Truly] Tier B failed: id=${id} error=${reply?.error}`);
      __trulyAudit({
        ts: performance.now(),
        event: "failed",
        stableId: id,
        source,
        elapsedMs: Math.round(bDuration),
        error: reply?.error ?? "missing_reply",
      });
      const cachedDecision = postIdToTierA.get(id);
      if (cachedDecision) {
        const updated: FilterDecision = {
          ...cachedDecision,
          tierBPending: false,
          tierBError: reply?.error ? decodeTierBError(reply.error) : "missing_reply",
        };
        postIdToTierA.set(id, updated);
        applyOverlay(dispatchPost, updated, { lang: currentContentLang() });
        emitPostClassified(id, dispatchPost, updated, { fullText: text, textCompleteness, sourceContext });
      }
      return;
    }
    const deep: DeepClassification = reply.deep;
    debugLog(`[Truly] Tier B done: id=${id} aiLikelihood=${deep.aiLikelihood} imageStatus=${deep.imageStatus ?? "?"}`);
    __trulyAudit({
      ts: performance.now(),
      event: "done",
      stableId: id,
      source,
      elapsedMs: Math.round(bDuration),
      imageStatus: deep.imageStatus ?? null,
    });
    recordDeepClassification(text, deep, outputLang);
    const cachedDecision = postIdToTierA.get(id);
    if (cachedDecision) {
      const updated: FilterDecision = {
        ...cachedDecision,
        tierBPending: false,
        tierBError: undefined,
        deepClassification: deep,
        timing: {
          ...cachedDecision.timing,
          bMs: Math.round(bDuration),
          bModel: model,
        },
      };
      postIdToTierA.set(id, updated);
      applyOverlay(dispatchPost, updated, { lang: currentContentLang() });
      const event = emitPostClassified(id, dispatchPost, updated, {
        fullText: text,
        summary: deep.summary,
        textCompleteness,
        sourceContext,
      });
      if (source === "auto") maybePrefetchReadingBrief(event, dispatchPost);
    }
  }).catch((e) => {
    console.warn(`[Truly] Tier B sendMessage error for ${id}:`, e);
    __trulyAudit({
      ts: performance.now(),
      event: "send-error",
      stableId: id,
      source,
      error: e instanceof Error ? e.message : String(e),
    });
    const cachedDecision = postIdToTierA.get(id);
    if (cachedDecision) {
      const updated: FilterDecision = {
        ...cachedDecision,
        tierBPending: false,
        tierBError: "tier_b_network_error",
      };
      postIdToTierA.set(id, updated);
      applyOverlay(dispatchPost, updated, { lang: currentContentLang() });
      emitPostClassified(id, dispatchPost, updated, { fullText: text, textCompleteness, sourceContext });
    }
  }).finally(clearInFlight);
}

// ---------------------------------------------------------------------------
// Most-centered post observer — feeds the sidepanel's 閱讀 tab.
// ---------------------------------------------------------------------------
// IntersectionObserver tracks every [data-truly-id] post. After a 200ms
// debounce on changes, we pick the entry whose bounding-box center is
// closest to viewport center and broadcast its stable id. Driving the
// pick from the IO callback (instead of every scroll event) keeps the
// work scoped to actual visibility transitions; the debounce dedupes
// rapid scrolls.
const intersectingPosts = new Set<HTMLElement>();
let lastBroadcastViewId: string | null | undefined = undefined;
let viewBroadcastTimer: number | null = null;

function broadcastCurrentViewPost(id: string | null, force = false): void {
  if (!force && id === lastBroadcastViewId) return;
  lastBroadcastViewId = id;
  browser.runtime.sendMessage({ type: "CURRENT_VIEW_POST", id } as TrulyMessage).catch(() => {});
}

function pickAndBroadcastCurrentView(force = false): void {
  viewBroadcastTimer = null;
  if (intersectingPosts.size === 0) {
    broadcastCurrentViewPost(null, force);
    return;
  }
  const vh = window.innerHeight || document.documentElement.clientHeight;
  const center = vh / 2;
  let bestId: string | null = null;
  let bestDistance = Infinity;
  for (const el of intersectingPosts) {
    const rect = el.getBoundingClientRect();
    if (rect.bottom <= 0 || rect.top >= vh) continue;
    if (skipMixedFeedContainer(el)) {
      intersectingPosts.delete(el);
      continue;
    }
    // Skip folded posts (sponsored / auto-fold). The collapse bar
    // already conveys the signal on the FB feed and the heads-up panel
    // is suppressed for them — surfacing them in the 分析 pane would
    // contradict the de-prioritization the user set up.
    if (el.querySelector(".truly-collapse-bar")) continue;
    const elCenter = (rect.top + rect.bottom) / 2;
    const dist = Math.abs(elCenter - center);
    if (dist < bestDistance) {
      bestDistance = dist;
      bestId = el.dataset.trulyStableId || el.dataset.trulyId || null;
    }
  }
  broadcastCurrentViewPost(bestId, force);
}

function scheduleViewBroadcast(): void {
  if (viewBroadcastTimer !== null) return;
  viewBroadcastTimer = window.setTimeout(pickAndBroadcastCurrentView, 200);
}

const mostCenteredObserver = new IntersectionObserver(
  (entries) => {
    const vh = window.innerHeight;
    for (const e of entries) {
      const el = e.target as HTMLElement;
      if (e.isIntersecting) {
        const stableId = el.dataset.trulyStableId || el.dataset.trulyId || "";
        if (skipMixedFeedContainer(el)) {
          if (stableId) tierBOnLeave(stableId);
          intersectingPosts.delete(el);
          continue;
        }
        if (stableId) tierBOnEnter(el, stableId);
        // Only count for sidepanel when actually in viewport, not just
        // the rootMargin zone (200px below fold).
        const rect = el.getBoundingClientRect();
        const inViewport = rect.bottom > 0 && rect.top < vh;
        if (inViewport) {
          if (__trulyMarginOnly.has(stableId)) {
            __trulyMarginOnly.delete(stableId);
            __trulyAudit({ ts: performance.now(), event: "viewport-enter", stableId });
          }
          intersectingPosts.add(el);
        } else if (rect.top >= vh && stableId) {
          // Post is in rootMargin zone (below fold), not yet visible
          __trulyMarginOnly.add(stableId);
        }
      } else {
        intersectingPosts.delete(el);
        const stableId = el.dataset.trulyStableId || el.dataset.trulyId || "";
        if (stableId) {
          __trulyMarginOnly.delete(stableId);
          tierBOnLeave(stableId);
        }
      }
    }
    scheduleViewBroadcast();
  },
  { threshold: [0, 0.25, 0.5, 0.75, 1], rootMargin: "0px 0px 600px 0px" },
);

window.addEventListener("scroll", () => {
  scheduleViewBroadcast();
  repairMissingHeadsUpPanels();
  tierBDrain(); // posts in queue may have scrolled into actual viewport
}, { passive: true });

// Click on "查看更多" / "See more" is a stronger user-intent signal than
// viewport prefetch — fire deep-classify immediately (and again, with the
// now-full text). The button is a `[role="button"]` whose visible text matches
// one of the locale strings. We let the DOM expand for a tick before
// re-extracting.
const EXPAND_BUTTON_TEXTS = [
  "查看更多",       // zh-TW
  "See more",       // en
  "查看更多内容",   // zh-CN
  "もっと見る",      // ja
  "더 보기",        // ko
];
const NON_POST_EXPAND_TEXT_RE = /(留言|回覆|回應|comment|comments|reply|replies)/i;
function isExpandButton(target: EventTarget | null): HTMLElement | null {
  if (!(target instanceof Element)) return null;
  const btn = target.closest('[role="button"]') as HTMLElement | null;
  if (!btn) return null;
  const txt = (btn.textContent || "").trim();
  if (!txt) return null;
  if (NON_POST_EXPAND_TEXT_RE.test(txt)) return null;
  return EXPAND_BUTTON_TEXTS.includes(txt) ? btn : null;
}

function isNestedArticleControl(btn: HTMLElement, postEl: HTMLElement): boolean {
  const article = btn.closest('[role="article"]') as HTMLElement | null;
  return !!article && article !== postEl && postEl.contains(article);
}

function currentPostDispatchText(postEl: HTMLElement): string {
  try {
    return normalizeDispatchText(cleanText(extractPostBody(postEl)));
  } catch {
    return "";
  }
}

function resolveCurrentPostElement(postEl: HTMLElement): HTMLElement | null {
  if (document.contains(postEl)) return postEl;

  const stableId = postEl.dataset.trulyStableId;
  const trulyId = postEl.dataset.trulyId;
  if (!stableId && !trulyId) return null;

  for (const el of Array.from(document.querySelectorAll<HTMLElement>("[data-truly-id]"))) {
    if (stableId && el.dataset.trulyStableId === stableId) return el;
    if (trulyId && el.dataset.trulyId === trulyId) return el;
  }
  return null;
}

async function waitForExpandedText(postEl: HTMLElement, beforeText: string): Promise<HTMLElement | null> {
  const beforeLen = beforeText.length;
  let lastText = beforeText;
  let stableFrames = 0;
  let currentEl: HTMLElement | null = postEl;
  const startedAt = performance.now();

  return new Promise((resolve) => {
    let done = false;
    let observer: MutationObserver | null = null;

    const finish = (el: HTMLElement | null) => {
      if (done) return;
      done = true;
      observer?.disconnect();
      resolve(el);
    };

    const tick = () => {
      if (done) return;
      currentEl = resolveCurrentPostElement(currentEl || postEl);
      if (!currentEl) {
        finish(null);
        return;
      }
      const text = currentPostDispatchText(currentEl);
      if (text.length > beforeLen) {
        if (text === lastText) {
          stableFrames += 1;
        } else {
          stableFrames = 0;
          lastText = text;
        }
        if (stableFrames >= 2) {
          finish(currentEl);
          return;
        }
      } else {
        lastText = text;
        stableFrames = 0;
      }
      if (performance.now() - startedAt >= 1200) {
        finish(currentEl);
        return;
      }
      requestAnimationFrame(tick);
    };

    try {
      observer = new MutationObserver(() => {
        stableFrames = 0;
      });
      observer.observe(postEl, { childList: true, characterData: true, subtree: true });
    } catch {
      observer = null;
    }
    requestAnimationFrame(tick);
  });
}

document.addEventListener(
  "click",
  (ev) => {
    const btn = isExpandButton(ev.target);
    if (!btn) return;
    const postEl = btn.closest('[data-truly-id]') as HTMLElement | null;
    if (!postEl) return;
    const beforeText = currentPostDispatchText(postEl);
    void waitForExpandedText(postEl, beforeText).then((currentEl) => {
      if (currentEl) void dispatchDeepClassify(currentEl, "expand");
    });
  },
  // capture so we don't miss clicks on inner spans whose handler stops
  // bubbling. passive avoids paying scroll-jank cost on big feeds.
  { capture: true, passive: true },
);

// Stable ID for dashboard card dedup. Prefers the GraphQL post ID when
// available — it's the most stable identifier and survives virtual-scroll
// remounts + text-extraction variance (decoy pollution, Show more, etc.).
// Falls back to a djb2 hash of author + first-60-chars for posts where
// no GraphQL match exists.
function stableEventId(post: PostData): string {
  if (post.gqlPostId) return "truly-dash-gql-" + post.gqlPostId;
  const text = stripLeadingPostIdentity(post.text || post.sharedAttachmentText || "", {
    authorName: post.authorName,
    sourceName: post.sourceName,
  });
  const key = (post.authorName || "") + "\n" + text.slice(0, 60);
  let h = 5381;
  for (let i = 0; i < key.length; i++) {
    h = ((h << 5) + h + key.charCodeAt(i)) | 0;
  }
  return "truly-dash-" + (h >>> 0).toString(36);
}

function normalizeFacebookPostUrl(rawHref: string): string | null {
  if (!rawHref) return null;
  let url: URL;
  try {
    url = new URL(rawHref, window.location.href);
  } catch {
    return null;
  }
  if (!/(\.|^)facebook\.com$/i.test(url.hostname)) return null;

  const path = url.pathname;
  const isPostPath =
    /^\/groups\/[^/]+\/posts\/[^/]+\/?/i.test(path) ||
    /^\/[^/]+\/posts\/[^/]+\/?/i.test(path) ||
    /^\/permalink\.php$/i.test(path) ||
    /^\/story\.php$/i.test(path) ||
    /^\/photo\.php$/i.test(path) ||
    /^\/photo\/?$/i.test(path) ||
    /^\/share\/[prv]?\/[^/]+\/?/i.test(path);
  if (!isPostPath) return null;

  url.hash = "";
  return url.href;
}

function extractPostUrlFromArticle(article: HTMLElement): string | undefined {
  const candidates: Array<{ url: string; priority: number }> = [];
  for (const anchor of Array.from(article.querySelectorAll<HTMLAnchorElement>("a[href]"))) {
    const normalized = normalizeFacebookPostUrl(anchor.href || anchor.getAttribute("href") || "");
    if (!normalized) continue;

    const path = new URL(normalized).pathname;
    let priority = 10;
    if (/^\/groups\/[^/]+\/posts\//i.test(path)) priority = 1;
    else if (/^\/[^/]+\/posts\//i.test(path)) priority = 2;
    else if (/^\/story\.php$/i.test(path) || /^\/permalink\.php$/i.test(path)) priority = 3;
    else if (/^\/photo/i.test(path)) priority = 4;
    else if (/^\/share\//i.test(path)) priority = 5;
    candidates.push({ url: normalized, priority });
  }
  candidates.sort((a, b) => a.priority - b.priority || a.url.length - b.url.length);
  return candidates[0]?.url;
}

// Map from stable dashboard ID → most recent DOM element for that post.
// Used by SCROLL_TO_POST to jump the page to a card the user clicked in
// the dashboard. WeakRef would be ideal but we want explicit cleanup on
// remount, so we just overwrite on each scan emit and trim periodically.
const dashIdToElement = new Map<string, HTMLElement>();
const DASH_ID_MAP_MAX = 500;
function rememberPostElement(stableId: string, el: HTMLElement): void {
  dashIdToElement.set(stableId, el);
  while (dashIdToElement.size > DASH_ID_MAP_MAX) {
    // Drop oldest insertion (Map preserves insertion order).
    const firstKey = dashIdToElement.keys().next().value;
    if (firstKey === undefined) break;
    dashIdToElement.delete(firstKey);
  }
}

function hasRenderedHeadsUp(el: HTMLElement): boolean {
  const host = el.querySelector<HTMLElement>(".truly-headsup-host");
  if (!host) return false;
  return !!(host.shadowRoot?.querySelector(".truly-headsup") || host.querySelector(".truly-headsup"));
}

function repairMissingHeadsUpPanels(): void {
  const seenStableIds = new Set<string>();
  let repaired = 0;
  for (const el of Array.from(document.querySelectorAll<HTMLElement>("[data-truly-stable-id], [data-truly-id]"))) {
    if (el.parentElement?.closest("[data-truly-id]")) continue;
    if (!document.contains(el)) continue;
    if (el.querySelector(".truly-collapse-bar")) continue;
    if (hasRenderedHeadsUp(el)) continue;
    if (skipMixedFeedContainer(el)) continue;

    const stableId = el.dataset.trulyStableId || el.dataset.trulyId;
    if (!stableId || seenStableIds.has(stableId)) continue;
    seenStableIds.add(stableId);

    const decision = postIdToTierA.get(stableId);
    const post = postFromArticle(el) || postIdToData.get(stableId);
    if (!decision || !post) continue;

    const repairedPost = post.element === el ? post : { ...post, element: el };
    rememberPostData(stableId, repairedPost);
    rememberPostElement(stableId, el);
    applyOverlay(repairedPost, decision, { lang: currentContentLang() });
    mostCenteredObserver.observe(el);
    repaired += 1;
    if (repaired >= 8) break;
  }
  if (repaired > 0) {
    debugLog(`[Truly] Repaired missing heads-up panels: ${repaired}`);
  }
}

function scheduleVisiblePostRescan(reason: string, delayMs = 250): void {
  if (visiblePostRescanTimer) window.clearTimeout(visiblePostRescanTimer);
  visiblePostRescanTimer = window.setTimeout(() => {
    visiblePostRescanTimer = null;
    if (!liveSettings.enabled) return;
    debugLog(`[Truly] Rescanning visible posts: ${reason}`);
    rescanVisiblePosts();
    repairMissingHeadsUpPanels();
  }, delayMs);
}

function installLocationRescanMonitor(): void {
  lastObservedHref = window.location.href;
  window.setInterval(() => {
    const current = window.location.href;
    if (current === lastObservedHref) return;
    lastObservedHref = current;
    scheduleVisiblePostRescan("location-change", 500);
  }, 750);
}

function mergePreservedTierBState(next: FilterDecision, previous: FilterDecision | undefined): FilterDecision {
  if (!previous) return next;
  const lang = currentContentLang();
  const zhtwPatch: Partial<FilterDecision> = lang === "zh-TW" && !next.zhtwReview && !next.zhtwReviewError
    ? { zhtwReview: previous.zhtwReview, zhtwReviewError: previous.zhtwReviewError }
    : {};
  const nextHasTierBState = !!next.tierBPending || !!next.tierBError || !!next.deepClassification;
  if (nextHasTierBState) return Object.keys(zhtwPatch).length > 0 ? { ...next, ...zhtwPatch } : next;

  const previousHasTierBState = !!previous.tierBPending || !!previous.tierBError || !!previous.deepClassification;
  if (!previousHasTierBState) return Object.keys(zhtwPatch).length > 0 ? { ...next, ...zhtwPatch } : next;
  if (previous.deepClassification && previous.deepClassification.outputLang !== lang) {
    return Object.keys(zhtwPatch).length > 0 ? { ...next, ...zhtwPatch } : next;
  }

  return {
    ...next,
    ...zhtwPatch,
    tierBPending: previous.tierBPending,
    tierBError: previous.tierBError,
    deepClassification: previous.deepClassification,
    timing: {
      ...previous.timing,
      ...next.timing,
      bMs: previous.timing?.bMs,
      bModel: previous.timing?.bModel,
    },
  };
}

/** Scroll the matching post into view + flash a yellow highlight border
 *  for ~1500ms. Called by the SCROLL_TO_POST message handler. */
function scrollToDashPost(stableId: string): boolean {
  const el = dashIdToElement.get(stableId);
  if (!el || !document.contains(el)) return false;
  el.scrollIntoView({ block: "center", behavior: "smooth" });
  el.classList.add("truly-dash-flash");
  setTimeout(() => el.classList.remove("truly-dash-flash"), 1800);
  return true;
}

function handleNewPost(post: PostData) {
  if (skipMixedFeedContainer(post.element)) return;
  const cleanPostText = stripLeadingPostIdentity(post.text, {
    authorName: post.authorName,
    sourceName: post.sourceName,
  });
  const postWithCleanText = cleanPostText === post.text ? post : { ...post, text: cleanPostText };
  const normalizedPost: PostData = {
    ...postWithCleanText,
    textCompleteness: inferTextCompleteness(postWithCleanText, cleanPostText),
  };

  debugLog(
    `[Truly] New post: id=${normalizedPost.id} author="${normalizedPost.authorName || "?"}" text="${normalizedPost.text.slice(0, 80)}..."`
  );
  if (!liveSettings.enabled) {
    clearHeadsUpSurface(normalizedPost);
    return;
  }
  reserveHeadsUpSlot(normalizedPost, currentContentLang());
  const startedAt = performance.now();
  classifyPost(normalizedPost, (decision: FilterDecision) => {
    // Round to integer only when >= 1ms. Sub-ms tier-1 heuristics get
    // reported as 0, which the dashboard renders as "<1ms".
    const rawElapsed = performance.now() - startedAt;
    const elapsedMs = rawElapsed >= 1 ? Math.round(rawElapsed) : 0;
    debugLog(
      `[Truly] Decision: id=${normalizedPost.id} filtered=${decision.filtered} reason="${decision.reason || "none"}" foldReason="${decision.foldReason || "none"}" scores=${JSON.stringify(decision.scores)} customRules=${JSON.stringify(decision.customRuleScores ?? null)}`
    );
    const stableId = stableEventId(normalizedPost);
    normalizedPost.element.dataset.trulyStableId = stableId;
    const postUrl = normalizedPost.postUrl ?? extractPostUrlFromArticle(normalizedPost.element);
    const pageUrl = normalizedPost.pageUrl ?? window.location.href;
    normalizedPost.postUrl = postUrl;
    normalizedPost.pageUrl = pageUrl;
    const mergedPost = mergePreservedPostData(normalizedPost, postIdToData.get(stableId));
    const mergedDecision = mergePreservedTierBState(decision, postIdToTierA.get(stableId));
    applyOverlay(mergedPost, mergedDecision, { lang: currentContentLang() });
    rememberPostElement(stableId, mergedPost.element);
    // Tier B prep: retain the latest post + decision under the stable id
    // so the queue / expand paths can build the DEEP_CLASSIFY payload
    // without re-extracting text / re-running classification.
    rememberPostData(stableId, mergedPost);
    postIdToTierA.set(stableId, mergedDecision);
    triggerZhtwReview(stableId, mergedPost);
    mostCenteredObserver.observe(mergedPost.element);
    emitPostClassified(stableId, mergedPost, mergedDecision, { elapsedMs });
  }).then(() => {
    // All decisions emitted — the heads-up panel is always rendered
    // directly via onDecision → applyOverlay → renderHeadsUpPanel.
    // No pending panel cleanup needed.
  });
}

function postFromArticleDom(article: HTMLElement, id: string, stored?: PostData): PostData | null {
  const extractedIdentity = extractPostIdentity(article);
  const identity = {
    authorName: stored?.authorName || extractedIdentity.authorName,
    sourceName: stored?.sourceName || extractedIdentity.sourceName,
  };
  const text = extractPrimaryMessageText(article, identity) ||
    stripLeadingPostIdentity(cleanText(extractPostBody(article)), identity);
  const sharedAttachmentText = extractSharedAttachmentText(article);
  if (!text && !sharedAttachmentText) return null;
  const reshare = extractReshareWithComment(article, text, identity.authorName || "");
  const post: PostData = {
    id,
    element: article,
    text: reshare?.sharerText || text,
    authorName: identity.authorName || "",
    sourceName: identity.sourceName,
    hasMedia: article.querySelector("img, video") !== null,
    contentKind: !text && sharedAttachmentText
      ? "share_without_comment"
      : reshare
        ? "reshare_with_comment"
        : "standard",
    sharedAttachmentText,
    reshareOriginalAuthor: reshare?.originalAuthor,
    reshareOriginalText: reshare?.originalText,
    postUrl: extractPostUrlFromArticle(article),
    pageUrl: window.location.href,
  };
  return {
    ...post,
    textCompleteness: inferTextCompleteness(post, post.text),
  };
}

function postFromArticle(article: HTMLElement): PostData | null {
  const stableId = article.dataset.trulyStableId;
  const trulyId = article.dataset.trulyId;
  const stored = (stableId && postIdToData.get(stableId)) || (trulyId && postIdToData.get(trulyId)) || null;
  const fresh = trulyId ? postFromArticleDom(article, stored?.id || trulyId, stored ?? undefined) : null;
  if (!stored) return fresh;
  if (!fresh) return { ...stored, element: article };

  const storedTextLength = (stored.text || "").trim().length;
  const freshTextLength = (fresh.text || "").trim().length;
  const shouldPreferFresh =
    freshTextLength > storedTextLength ||
    (!stored.sharedAttachmentText && !!fresh.sharedAttachmentText);
  if (!shouldPreferFresh) return { ...stored, element: article };

  return {
    ...stored,
    ...fresh,
    authorName: stored.authorName || fresh.authorName,
    sourceName: stored.sourceName || fresh.sourceName,
    isVerified: stored.isVerified,
    isRecommended: stored.isRecommended,
    postType: stored.postType || fresh.postType,
    gqlPostId: stored.gqlPostId,
    engagement: stored.engagement,
    postUrl: stored.postUrl || fresh.postUrl,
    pageUrl: fresh.pageUrl || stored.pageUrl,
    textCompleteness: inferTextCompleteness({ ...fresh, element: article }, fresh.text),
  };
}

document.addEventListener("truly-retry-classification", (ev) => {
  const article = (ev.target as Element | null)?.closest?.("[data-truly-id]") as HTMLElement | null;
  if (!article) return;
  const post = postFromArticle(article);
  if (!post) return;
  const stableId = article.dataset.trulyStableId || article.dataset.trulyId;
  if (stableId) {
    postIdToTierA.delete(stableId);
    zhtwAppliedKey.delete(stableId);
    lastDispatchedLength.delete(stableId);
    lastDispatchedTextHash.delete(stableId);
    inFlightDispatchedTextHash.delete(stableId);
  }
  handleNewPost(post);
});

document.addEventListener("truly-retry-analysis", (ev) => {
  const article = (ev.target as Element | null)?.closest?.("[data-truly-id]") as HTMLElement | null;
  if (!article) return;
  const stableId = article.dataset.trulyStableId || article.dataset.trulyId;
  if (stableId) {
    lastDispatchedLength.delete(stableId);
    lastDispatchedTextHash.delete(stableId);
    inFlightDispatchedTextHash.delete(stableId);
  }
  void dispatchDeepClassify(article, "manual");
});

// Listen for messages from popup / options / dashboard
browser.runtime.onMessage.addListener((message: TrulyMessage, _sender: unknown, sendResponse: (response?: unknown) => void) => {
  if (message.type === "GET_VERSION") {
    sendResponse({ type: "GET_VERSION_RESULT", buildId: __TRULY_BUILD_ID__, component: "content-script" });
    return false;
  }
  if (message.type === "EXPORT_LOG_BUFFER") {
    const reply: ExportLogBufferResultMsg = {
      type: "EXPORT_LOG_BUFFER_RESULT",
      component: "content-script",
      buildId: __TRULY_BUILD_ID__,
      entries: snapshotLogBuffer(),
      fbStats: {
        articleCount: document.querySelectorAll('[role="article"]').length,
        trulyTaggedCount: document.querySelectorAll("[data-truly-id]").length,
        overlayCount: document.querySelectorAll(".truly-overlay").length,
        headsUpPanelCount: [...document.querySelectorAll<HTMLElement>(".truly-headsup-host")].filter(
          (host) => host.shadowRoot?.querySelector(".truly-headsup") || host.querySelector(".truly-headsup"),
        ).length,
        sponsoredFoldedCount: document.querySelectorAll(".truly-collapse-bar").length,
        rightRailAdFoldedCount: document.querySelectorAll('[data-truly-surface-collapsed="right-rail-ad"]').length,
        reelFoldedCount: document.querySelectorAll('[data-truly-surface-collapsed="reel-section"]').length,
        url: window.location.href,
        scrollY: window.scrollY,
        documentHeight: document.documentElement.scrollHeight,
      },
    };
    sendResponse(reply);
    return false;
  }
  if (message.type === "SETTINGS_UPDATED") {
    const previousLang = currentContentLang();
    const wasEnabled = liveSettings.enabled;
    liveSettings = normalizeUserSettings(message.settings);
    updateSettings(liveSettings);
    setHeadsUpThemeMode(liveSettings.themeMode);
    const nextLang = currentContentLang();
    if (message.settings.sponsoredDisplayMode) {
      setSponsoredDisplayMode(message.settings.sponsoredDisplayMode);
    }
    updateSurfaceCollapseSettings(liveSettings, nextLang);
    if (previousLang !== nextLang) {
      syncLocalizedContentSurfaces(nextLang);
      updateSurfaceCollapseLanguage(nextLang);
    }
    if (!liveSettings.enabled) {
      clearAllHeadsUpSurfaces();
    } else if (!wasEnabled) {
      scheduleVisiblePostRescan("extension-enabled", 50);
    } else if (previousLang !== nextLang) {
      scheduleVisiblePostRescan("language-change", 50);
    }
    return false;
  }
  if (message.type === "GET_STATS") {
    // Sidepanel's Debug tab reads `cacheSize` and `selectorHealth` on top
    // of the SessionStats struct — attach them here so it renders real
    // values instead of the "-" / "unknown" fallbacks.
    sendResponse({
      ...getStats(),
      cacheSize: getCacheSize(),
      selectorHealth: currentSelectorHealth,
    });
    return false;
  }
  if (message.type === "REQUEST_CURRENT_VIEW_POST") {
    pickAndBroadcastCurrentView(true);
    sendResponse({ ok: true, id: lastBroadcastViewId });
    return false;
  }
  if (message.type === "SCROLL_TO_POST") {
    scrollToDashPost(message.id);
    return false;
  }
  if (message.type === "CACHE_CLEARED") {
    // Sidepanel wiped chrome.storage; drop our in-memory copy too so
    // the next scan re-classifies posts via LLM (the schema may have
    // changed between cache versions).
    void clearCache();
    return false;
  }
  // Important: ignore other message types so we don't interfere with SW handlers
  return false;
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== "local") return;
  if (typeof changes.ollamaEndpoint?.newValue === "string") {
    liveTierAEndpoint = changes.ollamaEndpoint.newValue;
    setOllamaConfig(liveTierAEndpoint, liveTierAModel);
  }
  if (typeof changes.ollamaModel?.newValue === "string") {
    liveTierAModel = changes.ollamaModel.newValue;
    setOllamaConfig(liveTierAEndpoint, liveTierAModel);
    setOllamaModel(liveTierAModel);
  }
});

// Mirror of the latest selector-health callback so GET_STATS can report
// it without reaching into feed-interception internals.
let currentSelectorHealth: "unknown" | "healthy" | "unhealthy" = "unknown";

function parseRgb(raw: string): [number, number, number] | null {
  const m = raw.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
  if (!m) return null;
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

function syncFacebookThemeClass(): void {
  try {
    const rgb = parseRgb(getComputedStyle(document.body).backgroundColor);
    if (!rgb) return;
    const [r, g, b] = rgb;
    const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    document.documentElement.classList.toggle("truly-fb-dark", luminance < 128);
    syncHeadsUpThemes();
  } catch {
    /* best effort only */
  }
}

function installFacebookThemeSync(): void {
  const scheduleSync = () => setTimeout(syncFacebookThemeClass, 0);
  syncFacebookThemeClass();
  for (const delayMs of [100, 500, 1500, 3000, 8000]) {
    setTimeout(syncFacebookThemeClass, delayMs);
  }
  window.addEventListener("load", scheduleSync, { once: true });
  window.addEventListener("pageshow", scheduleSync);
  document.addEventListener("visibilitychange", scheduleSync);
  window.setInterval(syncFacebookThemeClass, 2500);

  const obs = new MutationObserver(syncFacebookThemeClass);
  obs.observe(document.documentElement, { attributes: true, attributeFilter: ["class", "style"] });
  if (document.body) {
    obs.observe(document.body, { attributes: true, attributeFilter: ["class", "style"] });
  }
}

// Mark that content script loaded
(window as any).__trulyLoaded = true;
// Stamp buildId on the DOM so MAIN-world probes (page.evaluate) can read
// it — the isolated CS world's `window` isn't visible from MAIN.
try { document.documentElement.dataset.trulyBuildId = __TRULY_BUILD_ID__; } catch {}
debugLog(`[Truly] Content script loaded buildId=${__TRULY_BUILD_ID__} on ${window.location.href}`);

// Init
async function init() {
  installFacebookThemeSync();
  await loadAndApplySettings();
  await hydrateCache();

  setHealthCallback((status) => {
    debugLog(`[Truly] selector health → ${status}`);
    currentSelectorHealth = status;
    const msg: TrulyMessage = { type: "SELECTOR_HEALTH_UPDATE", status };
    browser.runtime.sendMessage(msg).catch(() => {});
  });

  startFeedInterception(handleNewPost);
  startSurfaceCollapseObserver();
  installLocationRescanMonitor();
  window.setInterval(scanCollapsibleSurfaces, 2000);
  window.setInterval(repairMissingHeadsUpPanels, 1500);
  resetStats();
}

init();
