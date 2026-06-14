import type {
  ClassificationScores,
  CustomFoldRule,
  DeepClassification,
  FilterCategory,
  FilterDecision,
  Lang,
  TierAEndpointKind,
  PostData,
  SessionStats,
  TierAScoring,
  UserSettings,
} from "./types";
import { ALL_CATEGORIES, DEFAULT_SETTINGS, MAX_ACTIVE_FOLD_RULES } from "./types";
import type { CustomRulePromptInput } from "./messages";
import { runHeuristicFilter } from "./heuristic-filter";
import type { LlmPostContext } from "./ollama-client";
import {
  applyUserSettingsPatch,
  getTierAProvider,
  normalizeUserSettings,
} from "./settings";
import { providerEndpointKind, providerFixedModel, providerSupportsTierA } from "./provider-capabilities";
import { modelDisplayIdentity } from "./model-display";
import { defaultEndpointForProvider, defaultModelForProvider } from "./model-source-config";
import { resolveLanguage } from "./i18n";

let settings: UserSettings = { ...DEFAULT_SETTINGS };
let stats: SessionStats = createEmptyStats();

let ollamaEndpoint = defaultEndpointForProvider("ollama");
let ollamaModel = defaultModelForProvider("ollama", "reading-prompt");
let ollamaConfigLoaded = false;

async function ensureOllamaConfig(): Promise<void> {
  if (ollamaConfigLoaded) return;
  try {
    const stored = await chrome.storage.local.get(["ollamaEndpoint", "ollamaModel"]);
    if (typeof stored.ollamaEndpoint === "string") ollamaEndpoint = stored.ollamaEndpoint;
    if (typeof stored.ollamaModel === "string") ollamaModel = stored.ollamaModel;
  } catch { /* ignore in test env */ }
  ollamaConfigLoaded = true;
}

export function setOllamaConfig(endpoint?: string, model?: string): void {
  if (typeof endpoint === "string" && endpoint.trim()) {
    ollamaEndpoint = endpoint.trim();
  }
  if (typeof model === "string" && model.trim()) {
    ollamaModel = model.trim();
  }
  ollamaConfigLoaded = true;
}

function createEmptyStats(): SessionStats {
  return {
    postsScanned: 0,
    postsFiltered: 0,
    postsSponsored: 0,
    filteredByCategory: {},
    tierUsage: { tier1: 0, tier2: 0, tier3: 0, tier3Empty: 0 },
  };
}

export function updateSettings(newSettings: Partial<UserSettings>): void {
  settings = applyUserSettingsPatch(settings, newSettings);
}

export function getSettings(): UserSettings {
  return normalizeUserSettings(settings);
}

export function getStats(): SessionStats {
  return { ...stats };
}

export function resetStats(): void {
  stats = createEmptyStats();
}

export function mergeScores(
  existing: ClassificationScores,
  incoming: ClassificationScores,
  override: boolean
): ClassificationScores {
  if (override) return { ...incoming };
  const merged = { ...existing };
  for (const cat of ALL_CATEGORIES) {
    if (incoming[cat] !== undefined) {
      merged[cat] = Math.max(merged[cat] ?? 0, incoming[cat]!);
    }
  }
  return merged;
}

/** Decide whether a non-sponsored post should auto-fold based on developer
 *  custom rules. Four-axis score folding is intentionally retired: Heads-up
 *  should warn before reading instead of hiding normal posts. */
export function computeAutoFoldReason(
  _scores: ClassificationScores,
  customRuleScores: Record<string, number> | undefined,
  s: UserSettings = settings,
): string | undefined {
  if (!s.foldEnabled) return undefined;

  if (customRuleScores) {
    for (const rule of getActiveFoldRules(s)) {
      const score = customRuleScores[rule.id];
      if (typeof score === "number" && score >= rule.threshold) {
        return `符合規則：${rule.name}`;
      }
    }
  }

  return undefined;
}

export function makeDecision(
  scores: ClassificationScores,
  isSponsored: boolean,
  tier: 1 | 3,
  isRecommended?: boolean,
  customRuleScores?: Record<string, number>,
  deepClassification?: DeepClassification,
  tierAScoring?: TierAScoring,
  insufficientText?: boolean,
  timing?: FilterDecision["timing"],
): FilterDecision {
  // Find the highest-scoring non-genuine category for display purposes
  // (regardless of thresholds — the panel needs a primary chip).
  let primaryCategory: FilterCategory | undefined;
  let primaryScore = 0;
  for (const cat of ALL_CATEGORIES) {
    if (cat === "personal") continue;
    const score = scores[cat] ?? 0;
    if (score > primaryScore) {
      primaryCategory = cat;
      primaryScore = score;
    }
  }

  // Sponsored posts always filter. For non-sponsored posts, only
  // developer-only custom fold rules may produce a foldReason; built-in axis
  // scores are reading hints, not auto-hide triggers.
  if (isSponsored) {
    return {
      filtered: true,
      reason: "贊助文",
      primaryCategory,
      primaryScore,
      scores,
      tier,
      isRecommended,
      tierAScoring,
      customRuleScores,
      deepClassification,
      insufficientText,
      timing,
    };
  }

  const foldReason = computeAutoFoldReason(scores, customRuleScores);
  return {
    filtered: false,
    primaryCategory,
    primaryScore,
    scores,
    tier,
    isRecommended,
    tierAScoring,
    customRuleScores,
    deepClassification,
    foldReason,
    insufficientText,
    timing,
  };
}

function isAllowlisted(post: PostData): boolean {
  if (!post.authorName) return false;
  return settings.allowlist.some(
    (name) => name.toLowerCase() === post.authorName!.toLowerCase()
  );
}

// --- Ollama via background service worker ---

// Classification cache keyed by text hash — survives DOM re-renders from
// virtual scrolling, and avoids re-classifying the same content.
// Optionally persisted to chrome.storage.local so it survives page reloads.
const MAX_CACHE_SIZE = 500;
// V14 tags Tier B natural-language output with `outputLang`; a Deep cache hit
// is valid only when it matches the current extension language.
const CACHE_STORAGE_KEY = "classificationCacheV15";
const CACHE_BUILD_ID_KEY = "classificationCacheBuildId";
const PERSIST_DEBOUNCE_MS = 2000;

interface CacheEntry {
  scores: ClassificationScores;
  tierAScoring?: TierAScoring;
  /** Tier B deep-analysis result, populated by the automatic/expand Tier B path.
   *  Carries its own model id so we can invalidate when the operator
   *  switches Tier B model without bumping the global cache version. */
  deepClassification?: DeepClassification;
  /** Per-rule LLM scores keyed by `CustomFoldRule.id`. */
  customRuleScores?: Record<string, number>;
  /** Hash of the active rule set at score time (sorted-by-id JSON of
   *  `{id, prompt}` pairs). On lookup, mismatch → treat as miss. */
  customRuleSetHash?: string;
  /** Tier A timing so cache hits preserve diagnostics and dashboard metadata. */
  timing?: { aMs?: number; aModel?: string };
  ts: number;
}

const classificationCache = new Map<string, CacheEntry>();
let persistTimer: ReturnType<typeof setTimeout> | null = null;
let cacheDirty = false;

function hashText(text: string): string {
  let h1 = 0x811c9dc5;
  let h2 = 0x9e3779b9;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ code, 0x01000193);
    h2 = Math.imul(h2 ^ code, 0x85ebca6b);
  }
  return `${text.length.toString(36)}:${(h1 >>> 0).toString(36)}:${(h2 >>> 0).toString(36)}`;
}

/** Active enabled rules, capped at MAX_ACTIVE_FOLD_RULES. Stable order
 *  (stored array order) so the cap is deterministic. */
export function getActiveFoldRules(s: UserSettings = settings): CustomFoldRule[] {
  if (!Array.isArray(s.customFoldRules)) return [];
  return s.customFoldRules.filter((r) => r && r.enabled).slice(0, MAX_ACTIVE_FOLD_RULES);
}

/** Strip rules to the {id, prompt} pairs sent to Ollama. */
export function activeRulePromptInputs(s: UserSettings = settings): CustomRulePromptInput[] {
  return getActiveFoldRules(s).map((r) => ({ id: r.id, prompt: r.prompt }));
}

/** Hash the active rule set deterministically. Sort by id first so rule
 *  re-ordering doesn't change the hash; hash the {id, prompt} pairs so
 *  prompt edits invalidate. Empty set → `""` (no entry needs revalidation). */
export function computeRuleSetHash(rules: { id: string; prompt: string }[]): string {
  if (!rules || rules.length === 0) return "";
  const sorted = [...rules]
    .map((r) => ({ id: r.id, prompt: r.prompt }))
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const json = JSON.stringify(sorted);
  let h = 5381;
  for (let i = 0; i < json.length; i++) {
    h = ((h << 5) + h + json.charCodeAt(i)) | 0;
  }
  return (h >>> 0).toString(36);
}

// Exported for tests; the LRU + size-cap behavior is critical and we want
// it covered without needing to drive the full classifyPost pipeline.
export function __cacheGetForTesting(
  text: string
): ClassificationScores | undefined {
  return cacheGet(text);
}
export function __cacheSetForTesting(
  text: string,
  scores: ClassificationScores,
  tierAScoring?: TierAScoring,
): void {
  cacheSet(text, scores, tierAScoring);
}
export function __cacheSizeForTesting(): number {
  return classificationCache.size;
}
export const __CACHE_MAX_SIZE_FOR_TESTING = 500;

function cacheGet(text: string): ClassificationScores | undefined {
  const key = hashText(text);
  const cached = classificationCache.get(key);
  if (!cached) return undefined;
  // Rule-set hash mismatch — treat as miss so stale rule scores can't
  // leak through after a user edits / adds / deletes rules.
  const activeHash = computeRuleSetHash(activeRulePromptInputs());
  if ((cached.customRuleSetHash ?? "") !== activeHash) {
    classificationCache.delete(key);
    return undefined;
  }
  // LRU: re-insert to mark as recently used
  classificationCache.delete(key);
  classificationCache.set(key, cached);
  return cached.scores;
}

function currentOutputLang(): Lang {
  return resolveLanguage(settings.language);
}

function cacheGetDeep(text: string, outputLang = currentOutputLang()): DeepClassification | undefined {
  const key = hashText(text);
  const cached = classificationCache.get(key);
  const deep = cached?.deepClassification;
  return deep?.outputLang === outputLang ? deep : undefined;
}

function cacheGetTierAScoring(text: string): TierAScoring | undefined {
  const key = hashText(text);
  const cached = classificationCache.get(key);
  return cached?.tierAScoring;
}

function cacheGetCustomRuleScores(text: string): Record<string, number> | undefined {
  const key = hashText(text);
  const cached = classificationCache.get(key);
  return cached?.customRuleScores;
}

function cacheGetTiming(text: string): CacheEntry["timing"] | undefined {
  const key = hashText(text);
  const cached = classificationCache.get(key);
  return cached?.timing;
}

function cacheSetTiming(text: string, aMs: number, aModel: string): void {
  const key = hashText(text);
  const cached = classificationCache.get(key);
  if (!cached) return;
  classificationCache.set(key, { ...cached, timing: { aMs, aModel }, ts: Date.now() });
  schedulePersist();
}

/** Persist a Tier B deep result onto the existing cache entry for a post.
 *  No-op if the post hasn't been classified yet (Tier A always runs first). */
export function recordDeepClassification(
  text: string,
  deep: DeepClassification,
  outputLang: Lang = currentOutputLang(),
): void {
  const key = hashText(text);
  const cached = classificationCache.get(key);
  if (!cached) return;
  classificationCache.set(key, {
    ...cached,
    deepClassification: { ...deep, outputLang },
    ts: Date.now(),
  });
  cacheDirty = true;
  schedulePersist();
}

function cacheSet(
  text: string,
  scores: ClassificationScores,
  tierAScoring?: TierAScoring,
  customRuleScores?: Record<string, number>,
): void {
  const key = hashText(text);
  const activeHash = computeRuleSetHash(activeRulePromptInputs());
  classificationCache.set(key, {
    scores,
    tierAScoring,
    customRuleScores,
    customRuleSetHash: activeHash,
    ts: Date.now(),
  });
  // Evict oldest if over size limit
  if (classificationCache.size > MAX_CACHE_SIZE) {
    const oldest = classificationCache.keys().next().value;
    if (oldest) classificationCache.delete(oldest);
  }
  schedulePersist();
}

function schedulePersist(): void {
  if (!settings.cacheEnabled) return;
  cacheDirty = true;
  if (persistTimer) return;
  persistTimer = setTimeout(() => {
    persistTimer = null;
    if (!cacheDirty) return;
    cacheDirty = false;
    const blob: Record<string, CacheEntry> = {};
    for (const [k, v] of classificationCache) blob[k] = v;
    try {
      chrome.storage.local.set({ [CACHE_STORAGE_KEY]: blob, [CACHE_BUILD_ID_KEY]: __TRULY_BUILD_ID__ }, () => {
        if (chrome.runtime.lastError) {
          console.warn(
            "[Truly] Cache persist failed:",
            chrome.runtime.lastError.message
          );
        }
      });
    } catch (e) {
      console.warn("[Truly] Cache persist threw:", e);
    }
  }, PERSIST_DEBOUNCE_MS);
}

// Match `classificationCacheV<digits>` — the versioned cache key namespace.
// Any key matching this pattern that isn't the current key is a stale
// blob from a prior schema version and SHALL be deleted on hydrate so
// chrome.storage.local doesn't accumulate dead entries across bumps.
const STALE_CACHE_KEY_RE = /^classificationCacheV\d+$/;

export async function sweepStaleCacheVersions(): Promise<string[]> {
  try {
    const all = await chrome.storage.local.get(null);
    const stale = Object.keys(all).filter(
      (k) => STALE_CACHE_KEY_RE.test(k) && k !== CACHE_STORAGE_KEY,
    );
    if (stale.length > 0) {
      await chrome.storage.local.remove(stale);
      console.log(
        `[Truly] Swept stale cache versions: ${stale.join(", ")}`
      );
    }
    return stale;
  } catch (e) {
    console.warn("[Truly] Stale-cache sweep threw:", e);
    return [];
  }
}

export function hydrateCache(): Promise<void> {
  return new Promise((resolve) => {
    if (!settings.cacheEnabled) {
      resolve();
      return;
    }
    // Fire-and-forget the stale-version sweep alongside the current-version
    // read. Both run against chrome.storage.local independently; we don't
    // need to serialize them — removing V1–V(N-1) doesn't affect reading VN.
    void sweepStaleCacheVersions();
    try {
      chrome.storage.local.get([CACHE_STORAGE_KEY, CACHE_BUILD_ID_KEY], (stored: any) => {
        const blob = stored?.[CACHE_STORAGE_KEY] as
          | Record<string, CacheEntry>
          | undefined;
        if (!blob) {
          resolve();
          return;
        }
        const storedBuildId = stored?.[CACHE_BUILD_ID_KEY] as string | undefined;
        if (storedBuildId && storedBuildId !== __TRULY_BUILD_ID__) {
          console.log(
            `[Truly] Cache buildId mismatch (stored=${storedBuildId} current=${__TRULY_BUILD_ID__}) — discarding stale cache`
          );
          chrome.storage.local.remove([CACHE_STORAGE_KEY, CACHE_BUILD_ID_KEY]);
          resolve();
          return;
        }
        const ttlMs = settings.cacheTtlDays * 24 * 60 * 60 * 1000;
        const now = Date.now();
        // Sort by ts ascending so newest end up last (most-recently-used in LRU)
        const entries = Object.entries(blob)
          .filter(([, v]) => v && typeof v.ts === "number" && now - v.ts < ttlMs)
          .sort((a, b) => a[1].ts - b[1].ts)
          .slice(-MAX_CACHE_SIZE);
        for (const [k, v] of entries) classificationCache.set(k, v);
        console.log(
          `[Truly] Cache hydrated: ${entries.length} entries`
        );
        resolve();
      });
    } catch (e) {
      console.warn("[Truly] Cache hydrate threw:", e);
      resolve();
    }
  });
}

// Test-only: reset all module-level state so unit tests don't leak.
export function __resetForTesting(): void {
  settings = normalizeUserSettings(DEFAULT_SETTINGS);
  stats = createEmptyStats();
  classificationCache.clear();
  cacheDirty = false;
  if (persistTimer) {
    clearTimeout(persistTimer);
    persistTimer = null;
  }
  inFlight.clear();
}

/** Returns the current in-memory cache size. */
export function getCacheSize(): number {
  return classificationCache.size;
}

/** Wipe the in-memory + persisted classification cache. Resolves to the
 *  number of entries that existed before the wipe. */
export async function clearCache(): Promise<number> {
  const before = classificationCache.size;
  classificationCache.clear();
  try {
    await chrome.storage.local.remove([CACHE_STORAGE_KEY, CACHE_BUILD_ID_KEY]);
  } catch {
    /* ignore */
  }
  return before;
}

interface ClassifierResult {
  scores: ClassificationScores;
  tierAScoring?: TierAScoring;
  customRuleScores?: Record<string, number>;
  /** Pipeline-level error when this post's Ollama call failed (fetch,
   *  model error, etc.) and scores are empty. Set by the OLLAMA_RESULT
   *  listener from the SW's request-level error message. */
  pipelineError?: string;
}

// In-flight requests deduplication — same text classified concurrently shares a promise
const inFlight = new Map<string, Promise<ClassifierResult>>();

interface QueuedRequest {
  postId: string;
  text: string;
  context?: import("./ollama-client").LlmPostContext;
  resolve: (r: ClassifierResult) => void;
  /** Captured at dispatch time so the OLLAMA_RESULT listener can default
   *  missing custom-rule scores to all-zeros for THIS request's rule set
   *  (without re-reading liveSettings, which may have changed). */
  activeRuleIds?: string[];
  /** Pipeline-level failure reason set by the OLLAMA_RESULT listener
   *  when a request-level error occurs and this post's entry is missing.
   *  Read by `classifyPost` to surface a meaningful `tierAError`. */
  pipelineError?: string;
}

// Pending Ollama requests: postId → resolve callback. Used by the
// OLLAMA_RESULT listener to deliver results from the fire-and-forget
// service worker path. This replaces the old sendResponse callback
// which was unreliable due to MV3 SW lifecycle killing the port.
const pendingOllamaRequests = new Map<string, QueuedRequest>();

function resolveQueuedRequest(req: QueuedRequest, result: ClassifierResult): void {
  pendingOllamaRequests.delete(req.postId);
  inFlight.delete(hashText(req.text));
  req.resolve(result);
}

function expireQueuedRequest(postId: string, text: string): void {
  pendingOllamaRequests.delete(postId);
  inFlight.delete(hashText(text));
}

// Listen for OLLAMA_RESULT from the service worker
if (typeof chrome !== "undefined" && chrome.runtime?.onMessage) {
  chrome.runtime.onMessage.addListener((message: any) => {
    if (message?.type !== "OLLAMA_RESULT") return false;
    const results = message.results || {};
    const pipelineError: string | undefined = typeof message.error === "string" ? message.error : undefined;
    // `requestedIds` tells us which posts belong to THIS request so we don't
    // wipe pending requests that belong to other concurrent requests. Legacy
    // SW builds that don't send it → fall back to iterating every pending
    // key (preserves the old behaviour to avoid breaking mid-upgrade).
    const requestedIds: string[] | undefined = Array.isArray(message.requestedIds)
      ? message.requestedIds
      : undefined;
    console.log(
      `[Truly] Ollama result received: ${Object.keys(results).length} posts (request size ${requestedIds?.length ?? "?"})${pipelineError ? ` error=${pipelineError}` : ""}`,
    );
    const idsToResolve = requestedIds ?? Array.from(pendingOllamaRequests.keys());
    for (const postId of idsToResolve) {
      const req = pendingOllamaRequests.get(postId);
      if (!req) continue;
      const entry = results[postId] as
        | {
            scores?: ClassificationScores;
            tierAScoring?: TierAScoring;
            customRuleScores?: Record<string, number>;
          }
        | undefined;
      const scores: ClassificationScores = entry?.scores || {};
      const tierAScoring: TierAScoring | undefined = entry?.tierAScoring;
      const rawCustom = entry?.customRuleScores;
      // Custom-rule fallback: if rules were sent but the response is
      // missing the field, default to all-zeros. This is independent of
      // built-in score parsing — a malformed rules block does NOT break
      // category scoring.
      const customRuleScores = normalizeCustomRuleScores(rawCustom, req.activeRuleIds);
      if (Object.keys(scores).length > 0) {
        cacheSet(req.text, scores, tierAScoring, customRuleScores);
      }
      // Surface pipeline-level error (SW fetch failure, model offline, etc.)
      // when this post's entry is missing from the request results.
      if (Object.keys(scores).length === 0 && pipelineError) {
        req.pipelineError = pipelineError;
      }
      inFlight.delete(hashText(req.text));
      req.resolve({ scores, tierAScoring, customRuleScores, pipelineError: req.pipelineError });
      pendingOllamaRequests.delete(postId);
    }
    return false;
  });
}

/** Validate per-rule scores from the LLM response. Numbers outside [0,1]
 *  are clamped; non-numeric / non-finite values default to 0. When the
 *  response omits the field but rules were requested, return all-zeros so
 *  the decision is well-defined (no fold). Returns undefined only when no
 *  rules were sent in the request. */
export function normalizeCustomRuleScores(
  raw: unknown,
  requestedIds?: string[],
): Record<string, number> | undefined {
  if (!requestedIds || requestedIds.length === 0) return undefined;
  const out: Record<string, number> = {};
  const obj = raw && typeof raw === "object" && !Array.isArray(raw)
    ? (raw as Record<string, unknown>)
    : {};
  for (const id of requestedIds) {
    const v = obj[id];
    if (typeof v === "number" && Number.isFinite(v)) {
      out[id] = Math.max(0, Math.min(1, v));
    } else {
      out[id] = 0;
    }
  }
  return out;
}

function classifyWithOllama(
  postId: string,
  text: string,
  context?: import("./ollama-client").LlmPostContext
): Promise<ClassifierResult> {
  const key = hashText(text);

  // Cache hit — instant
  const cached = cacheGet(text);
  if (cached) {
    return Promise.resolve({
      scores: cached,
      tierAScoring: cacheGetTierAScoring(text),
    });
  }

  // Already classifying same text — return same promise
  const existing = inFlight.get(key);
  if (existing) return existing;

  const promise = new Promise<ClassifierResult>((resolve) => {
    const activeRules = activeRulePromptInputs();
    const activeRuleIds = activeRules.map((r) => r.id);
    pendingOllamaRequests.set(postId, { postId, text, context, resolve, activeRuleIds });
    ensureOllamaConfig().then(() => {
      chrome.runtime.sendMessage({
        type: "OLLAMA_CLASSIFY",
        posts: [{ id: postId, text: text.slice(0, 800), context }],
        endpoint: ollamaEndpoint,
        model: ollamaModel,
        provider: getTierAProvider(settings),
        endpointKind: tierAEndpointKind(),
        openAICompatibleFlavor: settings.openAICompatibleFlavor,
        responseFormat: settings.openAIResponseFormat,
        outputMode: settings.tierAOutputMode,
        customRules: activeRules.length > 0 ? activeRules : undefined,
      }).catch((err) => {
        console.warn("[Truly] Ollama dispatch failed, falling back to empty scores:", err);
        const reason = err instanceof Error ? err.message : String(err);
        const req = pendingOllamaRequests.get(postId);
        if (req) resolveQueuedRequest(req, { scores: {}, pipelineError: reason });
        else inFlight.delete(key);
      });
    }).catch((err) => {
      pendingOllamaRequests.delete(postId);
      inFlight.delete(key);
      const reason = err instanceof Error ? err.message : String(err);
      resolve({ scores: {}, pipelineError: reason });
    });
  });

  inFlight.set(key, promise);
  return promise;
}

export function getCachedDecision(text: string): ClassificationScores | undefined {
  return cacheGet(text);
}

function isTierAConfigured(): boolean {
  const provider = getTierAProvider(settings);
  // Backward compatibility: previous builds treated "none" as the local
  // Ollama path. Keep that behavior until the provider UX is migrated fully.
  return providerSupportsTierA(provider) || provider === "none";
}

function isOllamaNativeConfigured(): boolean {
  const provider = getTierAProvider(settings);
  return provider === "ollama" || provider === "none";
}

function tierAEndpointKind(): TierAEndpointKind {
  return providerEndpointKind(getTierAProvider(settings));
}

function tierAModelLabel(): string {
  const provider = getTierAProvider(settings);
  const fixedModel = providerFixedModel(provider);
  return fixedModel
    ? modelDisplayIdentity(fixedModel).label
    : isTierAConfigured() ? ollamaModel : provider;
}

// --- Main classification pipeline ---

export async function classifyPost(
  post: PostData,
  onDecisionRaw: (decision: FilterDecision) => void
): Promise<void> {
  const startTime = performance.now();
  if (!settings.enabled) return;

  stats.postsScanned++;

  const onDecision = onDecisionRaw;

  if (isAllowlisted(post)) {
    onDecision({ filtered: false, scores: {}, tier: 1 });
    return;
  }

  // Tier 1: Heuristics (synchronous, instant)
  const heuristicScores = runHeuristicFilter(post);
  stats.tierUsage.tier1++;

  const hDuration = performance.now() - startTime;
  const initialTiming: FilterDecision["timing"] = { hMs: Math.round(hDuration) };

  const isSponsored = post.element.dataset.trulySponsored === "true";
  const isRecommended = !isSponsored && post.isRecommended === true;
  const shareWithoutComment = post.contentKind === "share_without_comment";
  const hasClassifiableText = post.text.trim().length > 1 && !shareWithoutComment;
  if (isSponsored) stats.postsSponsored++;

  // Sponsored: blur immediately with heuristic scores, then continue to
  // LLM so the overlay can show classification scores progressively.
  if (isSponsored) {
    const decision = makeDecision(heuristicScores, true, 1, isRecommended, undefined, undefined, undefined, false, initialTiming);
    stats.postsFiltered++;
    if (decision.primaryCategory) {
      stats.filteredByCategory[decision.primaryCategory] =
        (stats.filteredByCategory[decision.primaryCategory] ?? 0) + 1;
    }
    onDecision(decision);
    // Don't return — fall through to LLM for score enrichment
  }

  // Cache hit: emit cached scores in the score panel without re-running LLM
  const cachedScores = shareWithoutComment ? undefined : cacheGet(post.text);
  if (cachedScores) {
    const merged = mergeScores(heuristicScores, cachedScores, true);
    const cachedRules = cacheGetCustomRuleScores(post.text);
    const cachedDeep = cacheGetDeep(post.text);
    const cachedTierA = cacheGetTierAScoring(post.text);
    const cachedTiming = cacheGetTiming(post.text);
    onDecision(makeDecision(merged, isSponsored, 3, isRecommended, cachedRules, cachedDeep, cachedTierA, false, { ...initialTiming, ...cachedTiming }));
    return;
  }

  // Progressive render: show heuristic scores in panel immediately
  // (skip if sponsored — already emitted above with filtered=true)
  if (!isSponsored && !shareWithoutComment) {
    onDecision({ ...makeDecision(heuristicScores, false, 1, isRecommended, undefined, undefined, undefined, false, initialTiming), tierAPending: true });
  } else if (!isSponsored && shareWithoutComment) {
    onDecision(makeDecision(heuristicScores, false, 1, isRecommended, undefined, undefined, undefined, false, initialTiming));
  }

  // Tier 3: Ollama LLM (async). Scores feed the panel and the sponsored
  // overlay; for non-sponsored posts they never trigger blur.
  console.log(`[Truly] Tier A check: configured=${isTierAConfigured()} textLen=${post.text.length} contentKind=${post.contentKind ?? "standard"} provider=${getTierAProvider(settings)}`);
  if (isTierAConfigured() && hasClassifiableText) {
    const aStartTime = performance.now();
    const TIER_A_TIMEOUT_MS = 30_000;
    let aTiming: FilterDecision["timing"] | undefined;
    try {
      const llmContext: import("./ollama-client").LlmPostContext = {
        text: post.text,
        authorName: post.authorName,
        postType: post.postType,
        isSponsored: post.element.dataset.trulySponsored === "true",
        isVerified: post.isVerified,
        hasMedia: post.hasMedia,
        engagement: post.engagement,
        reshareOriginalText: post.reshareOriginalText,
        reshareOriginalAuthor: post.reshareOriginalAuthor,
      };
      const ollamaResult = await Promise.race([
        classifyWithOllama(post.id, post.text, llmContext),
        new Promise<never>((_, reject) =>
          setTimeout(() => {
            expireQueuedRequest(post.id, post.text);
            reject(new Error("Tier A timeout"));
          }, TIER_A_TIMEOUT_MS)
        ),
      ]);
      const aDuration = performance.now() - aStartTime;
      const ollamaScores = ollamaResult.scores;
      stats.tierUsage.tier3++;

      aTiming = {
        ...initialTiming,
        aMs: Math.round(aDuration),
        aModel: tierAModelLabel(),
      };
      cacheSetTiming(post.text, aTiming.aMs!, aTiming.aModel!);

      if (Object.keys(ollamaScores).length > 0) {
        const finalScores = mergeScores(heuristicScores, ollamaScores, true);
        console.log(
          `[Truly] Ollama result: ${post.id} scores=${JSON.stringify(ollamaScores)} rules=${JSON.stringify(ollamaResult.customRuleScores ?? null)} tierA=${JSON.stringify(ollamaResult.tierAScoring ?? null)}`
        );
        const decision = makeDecision(
          finalScores,
          isSponsored,
          3,
          isRecommended,
          ollamaResult.customRuleScores,
          undefined,
          ollamaResult.tierAScoring,
          false,
          aTiming,
        );
        onDecision(decision);
      } else {
        stats.tierUsage.tier3Empty++;
        const reason = ollamaResult.pipelineError || "LLM 回傳空結果";
        console.warn(
          `[Truly] Ollama returned empty scores for post ${post.id} (author="${post.authorName ?? "?"}" textLen=${post.text.length}) reason=${reason} — staying on tier=1.`
        );
        onDecision({
          ...makeDecision(heuristicScores, isSponsored, 1, isRecommended, undefined, undefined, undefined, true, aTiming),
          tierAError: reason,
        });
      }
    } catch (err) {
      const duration = performance.now() - aStartTime;
      const isTimeout = err instanceof Error && err.message === "Tier A timeout";
      const errorReason = isTimeout
        ? "分類逾時"
        : err instanceof TypeError && err.message.includes("fetch")
          ? "連線失敗"
          : "無回應";
      console.warn(`[Truly] Ollama classification failed (${errorReason}):`, err);
      if (!aTiming) {
        aTiming = {
          ...initialTiming,
          aMs: Math.round(duration),
          aModel: tierAModelLabel(),
        };
      }
      onDecision({
        ...makeDecision(heuristicScores, isSponsored, 1, isRecommended, undefined, undefined, undefined, false, aTiming),
        tierAError: errorReason,
      });
    }
  } else if (isTierAConfigured() && !shareWithoutComment) {
    // Ollama is enabled but text was too short or filtered out.
    onDecision({
      ...makeDecision(heuristicScores, isSponsored, 1, isRecommended, undefined, undefined, undefined, true, initialTiming),
      tierAError: "內文不足",
    });
  }
}

export function addToAllowlist(name: string): void {
  if (!settings.allowlist.includes(name)) {
    settings.allowlist.push(name);
    chrome.storage?.sync?.set?.({ allowlist: settings.allowlist });
  }
}
