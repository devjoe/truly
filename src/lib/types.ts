export type FilterCategory =
  | "commercial"
  | "political"
  | "emotional"
  | "personal";

export const ALL_CATEGORIES: FilterCategory[] = [
  "commercial",
  "political",
  "emotional",
  "personal",
];

export const CATEGORY_LABEL_ZH: Record<FilterCategory, string> = {
  commercial: "商業",
  political: "政治",
  emotional: "情感",
  personal: "個人",
};

export type ClassificationScores = Partial<Record<FilterCategory, number>>;

export type PostType =
  | "reshare"
  | "group"
  | "reel"
  | "text_only"
  | "page"
  | "standard";

export type PostContentKind =
  | "standard"
  | "share_without_comment"
  | "reshare_with_comment";

export type TextCompleteness =
  | "unknown"
  | "likely_truncated"
  | "visible_complete"
  | "expanded_or_upgraded";

export type ThemeMode = "auto" | "light" | "dark";

/** Concrete UI languages the runtime i18n layer can render. */
export type Lang = "en" | "zh-TW";
/** Stored language preference. `auto` resolves to the detected browser locale
 *  (zh* → zh-TW, otherwise en); see `resolveLanguage` in `./i18n`. */
export type LanguageSetting = Lang | "auto";

/**
 * LLM-emitted "information quality" signals. Every field is optional so
 * that heuristic-only decisions, allowlisted posts, and older cached
 * events keep compiling. See `add-information-quality-analyzer` change.
 */
export type SourceType =
  | "original"
  | "news_repost"
  | "secondhand_rumor"
  | "unclear";

export const SOURCE_TYPES: SourceType[] = [
  "original",
  "news_repost",
  "secondhand_rumor",
  "unclear",
];

export type ManipulationTechnique =
  | "emotional_language"
  | "false_dichotomy"
  | "ad_hominem"
  | "scapegoating"
  | "incoherence"
  | "conspiracy_reasoning";

export const MANIPULATION_TECHNIQUES: ManipulationTechnique[] = [
  "emotional_language",
  "false_dichotomy",
  "ad_hominem",
  "scapegoating",
  "incoherence",
  "conspiracy_reasoning",
];

/** A manipulation technique judgement together with the verbatim excerpt
 *  from the post body that triggered it. Quote is ≤ 80 characters and
 *  MUST be a substring of the original post text. */
export interface ManipulationEvidence {
  technique: ManipulationTechnique;
  quote: string;
}

/** Rubric features the LLM commits to before deriving `aiLikelihood`. The
 *  "LLM-as-judge" literature consistently shows that asking models to emit
 *  intermediate features and then derive a score outperforms asking for the
 *  score directly. Each subfield is independently optional — a model that
 *  drops one or two of them still produces useful output. Numeric fields
 *  are clamped to `[0, 3]` integers; `formulaic` is boolean. */
export interface AiSignals {
  /** 0..3 — count of distinct parallel-construction repetitions
   *  ("不只 A 更是 B; 不只 C 更是 D"). */
  parallel?: number;
  /** Closing sentence is a formulaic AI-style closure
   *  ("讓我們一起…", "綜上所述", "希望對你/我們有幫助"). */
  formulaic?: boolean;
  /** 0..3 — abstract-jargon density ("賦能/閉環/底層邏輯/生態" etc.). */
  abstract?: number;
  /** 0..3 — concrete-fact density (time/place/people/numbers).
   *  HIGHER means MORE concrete = LESS AI-like. */
  specifics?: number;
  /** 0..3 — mechanical sentence-length / structural uniformity. */
  uniformity?: number;
}

export interface InformationQuality {
  sourceType?: SourceType;
  /** 0–1 probability that the post text was produced by a language model,
   *  judged from FORMAL cues (排比重複、過度條列化、空洞通順、公式化結尾) —
   *  NOT from whether the post TOPIC mentions AI. Added V8. */
  aiLikelihood?: number;
  /** Rubric breakdown the LLM emits alongside `aiLikelihood`. Optional —
   *  parser tolerates missing or partial values. Added V9. */
  aiSignals?: AiSignals;
  unsourcedClaim?: boolean;
  /** Optional short excerpts the LLM flagged as unsourced claims. */
  claimSnippets?: string[];
  manipulationTechniques?: ManipulationEvidence[];
}

export type TierAScoringDimension =
  | "aiStyle"
  | "commercialIntent"
  | "lowQuality"
  | "ragebait"
  | "repetitiveMeme"
  | "infoRiskHint";

export const TIER_A_SCORING_DIMENSIONS: TierAScoringDimension[] = [
  "aiStyle",
  "commercialIntent",
  "lowQuality",
  "ragebait",
  "repetitiveMeme",
  "infoRiskHint",
];

/** Tier A is the fast scoring surface consumed by folding rules and the
 *  heads-up panel. It is intentionally score-only: deep explanations,
 *  image grounding, and formal information-quality analysis belong to Tier B.
 *  `collapseScore` is retained for legacy parser/cache compatibility only;
 *  current UI and fold decisions should use explicit axes/custom rules. */
export interface TierAScoring {
  collapseScore?: number;
  confidence?: number;
  dimensions?: Partial<Record<TierAScoringDimension, number>>;
  tags?: string[];
}

export interface ClassificationResult {
  scores: ClassificationScores;
  tier: 1 | 2 | 3;
  cached?: boolean;
}

export interface EngagementHints {
  reactions?: string;
  comments?: string;
  shares?: string;
}

export interface PostData {
  id: string;
  element: HTMLElement;
  text: string;
  authorName?: string;
  /** Group/page/source container name for posts inside Facebook groups. This is
   * context metadata, not authored body text. */
  sourceName?: string;
  timestamp?: string;
  hasMedia: boolean;
  isVerified?: boolean;
  /** Own-post text vs. a share where the user added no comment. */
  contentKind?: PostContentKind;
  /** Best-effort visible title/caption from the shared attachment. This is
   *  not the sharer's own text and must be presented as attachment context. */
  sharedAttachmentText?: string;
  postType?: PostType;
  reshareOriginalText?: string;
  reshareOriginalAuthor?: string;
  engagement?: EngagementHints;
  /** GraphQL post ID — most stable identifier, survives virtual-scroll
   *  remounts. Used by stableEventId when available. */
  gqlPostId?: string;
  /** Best-effort permalink for this post, extracted from visible Facebook
   *  anchors. May be absent when Facebook does not expose a stable post link
   *  in the mounted DOM. */
  postUrl?: string;
  /** Current Facebook page URL at extraction time. Used as a fallback context
   *  link when `postUrl` cannot be found. */
  pageUrl?: string;
  /** Best-effort completeness of the authored text currently available from
   *  Facebook. `likely_truncated` means the post still exposes a "查看更多"-
   *  style control or truncation marker, so downstream analysis may update
   *  after the user expands the post. */
  textCompleteness?: TextCompleteness;
  /** True when FB injected this post from an account the viewer doesn't
   *  follow (algorithm recommendation). Set by the DOM walker via
   *  `detectRecommended`. Mutually exclusive with sponsored: never set on
   *  sponsored posts. */
  isRecommended?: boolean;
}

/** Tier B (deep) classification result — produced when a post enters the
 *  aggressive auto-trigger zone or the user expands post text, and the
 *  multimodal Tier B endpoint is configured. Optional everywhere. */
export interface DeepClassification {
  /** Overall AI/style likelihood kept for backwards compatibility. Newer
   *  Tier B responses should also populate the text/image split below. */
  aiLikelihood?: number;
  /** 0–1 likelihood that the written text itself looks model-generated.
   *  Does not judge whether the topic mentions AI, and does not include
   *  ordinary promotional boilerplate/template copy. */
  textAiLikelihood?: number;
  /** 0–1 likelihood that attached visuals themselves look AI-generated.
   *  Does not include stock photos, screenshots, official charts, or
   *  template graphics. */
  imageAiLikelihood?: number;
  /** 0–1 signal for non-Taiwan lexical usage. This is language convention
   *  evidence only and must not be rendered as author-origin evidence. */
  zhCnLexicalSignal?: number;
  commercialIntent?: number;
  lowQualitySignal?: number;
  informationQuality?: {
    factualRisk?: number;
    manipulationRisk?: number;
    needsFactCheck?: boolean;
    explanation?: string;
  };
  imageInsights?: Array<{ url?: string; index?: number; observation: string }>;
  summary?: string;
  /** Tier B model id, used as a cache invalidator. */
  model: string;
  /** Natural-language output locale used by Tier B model-authored fields.
   *  Numeric Tier A scores do not use this field. */
  outputLang?: Lang;
  /** Outcome of the image-handling path. Set by `callTierBDeep` based
   *  on whether images were sent + how the Tier B backend responded. Optional for
   *  backwards compatibility — cache entries from before this field
   *  existed render identically to "ok". */
  imageStatus?: "ok" | "decode_failed" | "vision_format_failed" | "filtered" | "no_images";
  /** Deterministic post-generation review of model-authored text fields.
   *  This is not a second LLM call and must not alter numeric/schema fields. */
  outputReview?: ModelOutputReview;
}

export type ReadingBriefQuestionKind =
  | "understand"
  | "context"
  | "counter"
  | "verify"
  | "image"
  | "source";

export interface ReadingBriefBackground {
  /** Short background concept/topic the reader may need. */
  t: string;
  /** Why this background matters for this post. */
  why: string;
  /** Optional search/chat-ready question. */
  q?: string;
}

export interface ReadingBriefClaim {
  /** Checkable claim or claim cluster from the post. */
  c: string;
  /** Why this claim matters. */
  why: string;
  /** What kind of evidence would be needed. */
  need: string;
  /** Optional search/chat-ready question. */
  q?: string;
}

export interface ReadingBriefQuestion {
  q: string;
  kind: ReadingBriefQuestionKind;
}

export interface ReadingBriefCheck {
  label: string;
  q: string;
  why: string;
}

/** Tier B-2 sidepanel-only reading brief. It turns the existing Tier B
 *  structured analysis into a practical investigation plan: background,
 *  checkable claims, useful questions, and next checks. It is triggered
 *  only after explicit sidepanel focus, never by feed viewport scanning. */
export interface ReadingBrief {
  bg?: ReadingBriefBackground[];
  claims?: ReadingBriefClaim[];
  qs?: ReadingBriefQuestion[];
  checks?: ReadingBriefCheck[];
  note?: string;
  /** Model id used to produce this brief. */
  model: string;
  /** Natural-language output locale used by model-authored brief fields. */
  outputLang?: Lang;
  /** Wall-clock time spent producing this Tier B-2 brief, measured outside
   *  the model response so it cannot be polluted by generated JSON. */
  elapsedMs?: number;
  /** Deterministic post-generation review of model-authored text fields. */
  outputReview?: ModelOutputReview;
}

export type ModelOutputReviewScope =
  | "tier_b_deep"
  | "tier_b2_reading_brief";

export interface ModelOutputFinding {
  path: string;
  ruleId: string;
  found: string;
  replacement?: string;
  severity: "info" | "warning" | "error";
  autoFixable: boolean;
}

export interface ModelOutputFix {
  path: string;
  ruleId: string;
  before: string;
  after: string;
}

export interface ModelOutputReview {
  source: "model-output-review";
  scope: ModelOutputReviewScope;
  profile: "zh-TW-safe";
  reviewVersion: string;
  checkedAt: string;
  findingCount: number;
  autoFixCount: number;
  findings: ModelOutputFinding[];
  autoFixes: ModelOutputFix[];
}

export interface ZhtwIssue {
  offset: number;
  length: number;
  found: string;
  suggestions: string[];
  ruleType: string;
  severity: "info" | "warning" | "error";
  context?: string;
  english?: string;
}

export type ZhtwSegmentKind =
  | "post_text"
  | "sharer_comment"
  | "shared_content"
  | "link_preview"
  | "image_text";

export interface ZhtwSegmentReview {
  kind: ZhtwSegmentKind;
  label: string;
  issueCount: number;
  badgeCount: number;
  severityCounts: {
    info: number;
    warning: number;
    error: number;
  };
  issueSummary: Record<string, number>;
  examples: ZhtwIssue[];
}

export interface ZhtwReview {
  source: "zhtw-mcp";
  scope: "segmented_post_text" | "post_text" | "model_output";
  profile: "base" | "strict";
  relaxed: boolean;
  issueCount: number;
  badgeCount: number;
  severityCounts: {
    info: number;
    warning: number;
    error: number;
  };
  issueSummary: Record<string, number>;
  segments: ZhtwSegmentReview[];
  examples: ZhtwIssue[];
  signal: number;
  checkedAt: string;
  sourceVersion?: string;
}

export interface FilterDecision {
  filtered: boolean;
  reason?: string;
  primaryCategory?: FilterCategory;
  primaryScore?: number;
  scores: ClassificationScores;
  tier?: 1 | 3;
  summary?: string;
  /** Mirrors `PostData.isRecommended` so the overlay can render a
   *  "演算法推薦" source-context chip without re-scanning the DOM. */
  isRecommended?: boolean;
  /** Tier B deep result, present only when automatic/expand-triggered Tier B
   *  is configured and the call succeeded. */
  deepClassification?: DeepClassification;
  /** Tier A-2 deterministic language-convention review. It is runtime-only
   *  reading context: it must not affect severity, folding, or author-origin
   *  inference. */
  zhtwReview?: ZhtwReview;
  zhtwReviewError?: string;
  /** Tier A fast scoring result used by folding rules / heads-up UI.
   *  Optional during migration because older cached entries and fallback
   *  classifiers only carry legacy `scores`. */
  tierAScoring?: TierAScoring;
  /** Per-rule LLM scores (0–1) for active user-defined fold rules. Keyed
   *  by `CustomFoldRule.id`. Absent when the user has no enabled rules. */
  customRuleScores?: Record<string, number>;
  /** Short label naming the condition that caused the post to fold. Set
   *  by `applyOverlay` when fold decision logic determines this post
   *  should collapse. Surfaced in `.truly-collapse-bar` so the user knows
   *  why. Sponsored short-circuit keeps `reason` for backwards-compat. */
  foldReason?: string;
  /** True when Tier A classification was skipped because text extraction
   *  yielded empty or insufficient content (e.g. only decoy noise). */
  insufficientText?: boolean;
  /** Performance markers for the analysis pipeline (in milliseconds). */
  timing?: {
    hMs?: number; // Heuristic (Tier 1)
    aMs?: number; // Tier A (Local LLM)
    bMs?: number; // Tier B (Deep/Multimodal)
    aModel?: string; // Model name used for Tier A
    bModel?: string; // Model name used for Tier B
  };
  /** True while Tier A is in flight and hasn't completed yet. Set by
   *  progressive render; cleared when the Ollama response arrives or times
   *  out. Consumers can use this to show a spinner/pending state. */
  tierAPending?: boolean;
  /** Traditional-Chinese error reason when Tier A (分類) call fails.
   *  When set, the heads-up panel shows ⚠️ badge + suppresses score chips. */
  tierAError?: string;
  /** Traditional-Chinese error reason when Tier B (分析) call fails.
   *  When set, the heads-up panel shows ⚠️ badge on Tier B section. */
  tierBError?: string;
  /** True while Tier B deep analysis is in flight for this post. Set by the
   *  content script before dispatching `DEEP_CLASSIFY`; cleared on success or
   *  failure so the heads-up panel can show an explicit analysis status. */
  tierBPending?: boolean;
}

/** A user-authored rule that scores each post via the Tier A Ollama call.
 *  When the per-post score crosses `threshold` the post is collapsed
 *  (subject to the master `foldEnabled` switch). Example: name="JJK 結局",
 *  prompt="這篇是否提到咒術迴戰結局？", threshold=0.6. */
export interface CustomFoldRule {
  id: string;
  name: string;
  prompt: string;
  threshold: number;
  enabled: boolean;
}

/** Maximum number of enabled custom rules allowed simultaneously. The cap
 *  exists to keep the Tier A prompt within `num_ctx` tier and bandwidth
 *  budget; see design.md decisions. */
export const MAX_ACTIVE_FOLD_RULES = 10;

export type TierAEndpointKind = "ollama" | "openai-compatible";
export type TierAProvider =
  | "groq"
  | "openai"
  | "anthropic"
  | "ollama"
  | "openai-compatible"
  | "chrome-gemini-nano"
  | "none";
export type TierBProvider =
  | "tier-a"
  | "ollama"
  | "openai-compatible"
  | "chrome-gemini-nano"
  | "none";
export type OpenAICompatibleFlavor = "generic" | "vllm" | "mlx-vlm";
export type OpenAIResponseFormatMode = "json_object" | "json_schema" | "none";
export type TierAOutputMode = "json" | "compact_digits";
export type MarkdownDownloadMode = "directory-picker" | "browser-download";

export interface UserSettings {
  enabled: boolean;
  /** Extension-owned UI theme. `auto` follows the browser / OS color scheme. */
  themeMode: ThemeMode;
  /** Extension-owned UI language. `auto` follows the detected browser locale.
   *  Applied at runtime by the i18n layer, independent of the browser UI
   *  locale — so the in-app toggle switches language without a reload. */
  language: LanguageSetting;
  categoryToggles: Record<FilterCategory, boolean>;
  thresholds: Record<FilterCategory, number>;
  /** Role-based Tier A provider setting. `cloudProvider` remains as the
   *  legacy storage alias for existing users and older extension builds. */
  tierAProvider: TierAProvider;
  /** @deprecated Use `tierAProvider`; kept as a storage compatibility alias. */
  cloudProvider: TierAProvider;
  /** Tier A OpenAI-compatible backend family. Used only when
   *  `tierAProvider === "openai-compatible"` so the request builder can
   *  send backend-specific, non-standard thinking controls explicitly. */
  openAICompatibleFlavor: OpenAICompatibleFlavor;
  /** Tier A OpenAI-compatible structured-output mode. `json_object`
   *  matches Ollama's `format:"json"`; `json_schema` asks compatible
   *  backends for the c/p/e/P object contract directly. */
  openAIResponseFormat: OpenAIResponseFormatMode;
  /** Tier A single-post output contract. `json` is the compatibility path;
   *  `compact_digits` asks the model for one 0-9 digit per score axis
   *  (built-ins plus active custom fold rules). */
  tierAOutputMode: TierAOutputMode;
  sponsoredDisplayMode: "none" | "collapse";
  collapseRightRailAdsEnabled: boolean;
  collapseReelsEnabled: boolean;
  allowlist: string[];
  customPrompt?: string;
  cacheEnabled: boolean;
  cacheTtlDays: number;
  /** Tier B deep classification. When enabled AND `tierBEndpoint` is set,
   *  Truly aggressively fires multimodal calls for posts entering the
   *  viewport prefetch zone. Default `false` — opt-in feature. */
  deepClassifyEnabled: boolean;
  /** Role-based Tier B provider. `tier-a` means reuse the Tier A provider
   *  and its endpoint/model when that provider needs them. */
  tierBProvider: TierBProvider;
  /** Tier B OpenAI-compatible endpoint root (e.g. `http://localhost:8000`).
   *  Empty disables Tier B regardless of `deepClassifyEnabled`. */
  tierBEndpoint: string;
  /** When true, Tier B uses the same endpoint stored for Tier A
   *  (`chrome.storage.local.ollamaEndpoint`) while keeping its own task
   *  prompt/schema. This supports one-model local setups without duplicating
   *  endpoint configuration. */
  tierBUseTierAEndpoint: boolean;
  /** @deprecated Use `tierBEndpoint`; kept as a storage compatibility alias. */
  vllmEndpoint: string;
  /** Model id served by the Tier B endpoint. */
  tierBModel: string;
  /** When true, Tier B uses the same model stored for Tier A
   *  (`chrome.storage.local.ollamaModel`) while keeping its own task
   *  prompt/schema. */
  tierBUseTierAModel: boolean;
  /** @deprecated Use `tierBModel`; kept as a storage compatibility alias. */
  vllmModel: string;
  /** Developer-only master switch for custom fold rules. Sponsored fold is
   *  independent — it stays gated only on `sponsoredDisplayMode`. */
  foldEnabled: boolean;
  /** User-defined custom fold rules. Each enabled rule is sent to the
   *  Tier A call for per-post 0–1 scoring. Cap: 10 enabled at a
   *  time (see `MAX_ACTIVE_FOLD_RULES`). */
  customFoldRules: CustomFoldRule[];
  /** Legacy storage compatibility flag. The Side Panel now always auto-tracks
   *  the most-centered post in the FB viewport; normalization forces this on. */
  analysisAutoFollow: boolean;
  /** Legacy storage compatibility flag. Developer tools are explicit Options
   *  sections now; normal runtime must not show developer diagnostics. */
  developerMode: boolean;
  /** User-facing Markdown save behavior. `directory-picker` asks the user to
   *  confirm a folder with Chrome's File System Access picker; `browser-download`
   *  uses the browser's normal download destination. */
  markdownDownloadMode: MarkdownDownloadMode;
}

export const DEFAULT_SETTINGS: UserSettings = {
  enabled: true,
  themeMode: "auto",
  language: "auto",
  categoryToggles: {
    commercial: true,
    political: true,
    emotional: true,
    personal: false,
  },
  thresholds: {
    commercial: 0.85,
    political: 0.9,
    emotional: 0.85,
    personal: 1.0,
  },
  tierAProvider: "chrome-gemini-nano",
  cloudProvider: "chrome-gemini-nano",
  openAICompatibleFlavor: "generic",
  openAIResponseFormat: "json_object",
  tierAOutputMode: "json",
  sponsoredDisplayMode: "collapse",
  collapseRightRailAdsEnabled: false,
  collapseReelsEnabled: false,
  allowlist: [],
  cacheEnabled: true,
  cacheTtlDays: 1,
  deepClassifyEnabled: false,
  tierBProvider: "chrome-gemini-nano",
  tierBEndpoint: "",
  tierBUseTierAEndpoint: false,
  vllmEndpoint: "",
  tierBModel: "qwen3.6-35b",
  tierBUseTierAModel: false,
  vllmModel: "qwen3.6-35b",
  foldEnabled: false,
  customFoldRules: [],
  analysisAutoFollow: true,
  developerMode: false,
  markdownDownloadMode: "browser-download",
};

export interface DashboardPostEvent {
  id: string;
  /** Short preview used in the collapsed card row. */
  text: string;
  /** Longer version (≤2000 chars) surfaced when the dashboard card is
   *  expanded. Optional so older call sites don't break. */
  fullText?: string;
  /** Structured source material captured before any prompt serialization.
   *  Prefer this over reparsing `fullText` when separating authored text,
   *  shared content, link previews, image text, and image alt. */
  sourceContext?: unknown;
  authorName?: string;
  /** Group/page/source container name when available. Used to keep source
   * labels out of post body text in Side Panel, Tier B-2, zhtw, and exports. */
  sourceName?: string;
  hasMedia: boolean;
  isSponsored: boolean;
  timestamp: string;
  /** Milliseconds elapsed from classifyPost start to THIS decision emit. */
  elapsedMs: number;
  decision: FilterDecision;
  postType?: PostType;
  reshareOriginalText?: string;
  reshareOriginalAuthor?: string;
  summary?: string;
  contentKind?: PostContentKind;
  sharedAttachmentText?: string;
  /** Best-effort single-post permalink. Omitted when not discoverable. */
  postUrl?: string;
  /** Current Facebook page URL captured with the event. */
  pageUrl?: string;
  /** Best-effort completeness of the text used by this event. */
  textCompleteness?: TextCompleteness;
  /** Tier B-2 reading brief generated after the sidepanel focuses this post.
   *  Kept on the event so replay/copy/export can reuse the same structured
   *  evidence without re-querying the model. */
  readingBrief?: ReadingBrief;
  readingBriefPending?: boolean;
  /** True when `readingBrief` is kept only as a temporary display fallback
   *  while a changed Tier B/post-text input is waiting for a refreshed B-2
   *  response. */
  readingBriefStale?: boolean;
  readingBriefError?: string;
  /** Tier A-2 deterministic language-convention review of the original post
   *  text. This is separate from Tier B's `zhCnLexicalSignal`: it is evidence
   *  about wording conventions only, not author origin or factuality. */
  zhtwReview?: ZhtwReview;
  zhtwReviewError?: string;
}

export interface SessionStats {
  postsScanned: number;
  postsFiltered: number;
  postsSponsored: number;
  filteredByCategory: Partial<Record<FilterCategory, number>>;
  /** Counts per tier. `tier3Empty` is a subset of `tier3`: the LLM was
   *  invoked successfully but the parsed response yielded no usable
   *  score keys (schema drift, truncation, parse failure). Surfaced so
   *  the operator can spot the "80% fall-through" failure mode without
   *  having to scrape SW console logs. */
  tierUsage: { tier1: number; tier2: number; tier3: number; tier3Empty: number };
  /** Content-script selector health for the active Facebook tab. */
  selectorHealth?: "unknown" | "healthy" | "unhealthy";
  /** In-memory classification cache size, included for debug surfaces. */
  cacheSize?: number;
}
