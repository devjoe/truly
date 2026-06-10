// Direct Ollama HTTP client. Runs in the isolated content script context
// (filter-engine), which is granted host_permissions for localhost:11434
// in manifest.json — content scripts can fetch host_permissions URLs without
// CORS restrictions, so the previous service-worker round-trip is no longer
// needed. Eliminating the SW round-trip kills the chronic
// "message port closed before a response was received" errors that the
// chrome.runtime.sendMessage path produced when the content script context
// changed mid-flight (page reload, etc.).

import type {
  EngagementHints,
  OpenAICompatibleFlavor,
  OpenAIResponseFormatMode,
  PostType,
  TierAOutputMode,
  TierAEndpointKind,
  TierAScoring,
} from "./types";
import { TIER_A_SCORING_DIMENSIONS } from "./types";

export const VALID_CATEGORIES = [
  "commercial",
  "political",
  "emotional",
  "personal",
];

const SHORT_KEY_MAP: Record<string, string> = {
  c: "commercial",
  p: "political",
  e: "emotional",
  P: "personal",
};

// No `/no_think` prefix: the Ollama API-level `think: false` flag (see
// callOllamaSingle) disables Qwen3 thinking mode on the
// request path, so the in-prompt directive is redundant. Dropping it also
// keeps the prompt neutral for Gemma 4 (and other non-qwen models), which
// would otherwise treat `/no_think` as 10 literal tokens of noise.
const SYSTEM_PROMPT = `你是貼文分類器。只輸出 JSON，不輸出其他內容：
{"c":0.9,"p":0,"e":0.2,"P":0}
c=明確販售/業配/導購/私訊拿連結；一般活動、旅遊資訊、個人推薦勿高分 p=政治/政策 e=情緒強度 P=作者本人親身經歷（轉述他人/新聞/劇情/作品內容：P=0）`;

const BASE_TOKEN_BUDGET = 150;
const TOKENS_PER_CUSTOM_RULE = 15;

function computeOutputTokenBudget(customRulesCount: number = 0): number {
  return BASE_TOKEN_BUDGET + customRulesCount * TOKENS_PER_CUSTOM_RULE;
}

const COMPACT_OUTPUT_TOKEN_BUDGET = 8;

function buildCompactSystemPrompt(scoreCount: number): string {
  const customNote = scoreCount > VALID_CATEGORIES.length
    ? `\n第 5 碼起是自訂規則，每條規則追加 1 碼。`
    : "";
  return `你是貼文四軸評分器。只回 ${scoreCount} 個 ASCII 數字，不要空格或標點。
前 4 碼順序固定：商業、政治、情緒、個人。
商業=commercial，明確販售、業配、課程、折扣、團購、導購、留言私訊拿連結；一般活動、旅遊資訊、個人推薦不要只因提到產品或地點而給高分。
政治=political，政治、政策、選舉。
情緒=emotional，煽動、憤怒、恐懼、震驚強度。
個人=personal，作者自己的生活、行程、體驗、感受；今天去做了什麼要高分；分析他人、新聞、作品、角色都給0。${customNote}
每碼 0-9：0=無，5=中等，9=很高。`;
}

const COMPACT_FEW_SHOT_EXAMPLES = [
  {
    content: `倒數一天線上課程開賣，留言+1我把連結傳給你。`,
    digits: "9000",
  },
  {
    content: `震驚！某政客收受外國資金，證據確鑿！轉發讓更多人知道！`,
    digits: "0980",
  },
  {
    content: `今天完成大小劍山單攻，凌晨出發，全程16小時完成。`,
    digits: "0039",
  },
  {
    content: `這篇分析電影主角最後一戰的劇情安排，順便整理導演訪談。`,
    digits: "0000",
  },
  {
    content: `你現在受的苦，是過去種的因；你現在種的善，是未來的福。`,
    digits: "0050",
  },
];

const FEW_SHOT_USER_TEXTS = [
  "倒數一天線上課程開賣，留言+1我把連結傳給你。",
  "震驚！某政客收受外國資金，證據確鑿！轉發讓更多人知道！",
  "今天完成大小劍山單攻，凌晨出發，全程16小時完成。",
  "這篇分析電影主角最後一戰的劇情安排，順便整理導演訪談。",
];

const FEW_SHOT_ASSISTANT_JSON = [
  `{"c":0.9,"p":0,"e":0.2,"P":0}`,
  `{"c":0,"p":0.9,"e":0.7,"P":0}`,
  `{"c":0,"p":0,"e":0.3,"P":0.9}`,
  `{"c":0,"p":0,"e":0,"P":0}`,
];

function buildFewShot(
  customRuleCount: number,
): { role: "user" | "assistant"; content: string }[] {
  const zeroRules = customRuleCount > 0
    ? "," + Array.from({ length: customRuleCount }, (_, i) => `"r${i + 1}":0`).join(",")
    : "";
  const messages: { role: "user" | "assistant"; content: string }[] = [];
  for (let i = 0; i < FEW_SHOT_USER_TEXTS.length; i++) {
    messages.push({ role: "user", content: FEW_SHOT_USER_TEXTS[i] });
    messages.push({ role: "assistant", content: FEW_SHOT_ASSISTANT_JSON[i].slice(0, -1) + zeroRules + "}" });
  }
  return messages;
}

const POST_TYPE_LABEL: Record<PostType, string> = {
  reshare: "轉發",
  group: "社團",
  reel: "Reel 短影片",
  text_only: "純文字",
  page: "粉專",
  standard: "一般",
};

export interface LlmPostContext {
  text: string;
  authorName?: string;
  postType?: PostType;
  isSponsored?: boolean;
  isVerified?: boolean;
  hasMedia?: boolean;
  engagement?: EngagementHints;
  reshareOriginalText?: string;
  reshareOriginalAuthor?: string;
}

/** Minimal prompt for Tier A classification — text only, no metadata. */
export function buildTierAPrompt(ctx: LlmPostContext): string {
  return ctx.text.slice(0, 500);
}

// Legacy: keep buildUserPrompt for prompt-builder compatibility.
export function buildUserPrompt(ctx: LlmPostContext): string {
  const lines: string[] = ["## 貼文資訊"];
  if (ctx.postType)
    lines.push(`- 類型：${POST_TYPE_LABEL[ctx.postType] || ctx.postType}`);
  if (ctx.authorName) {
    let author = ctx.authorName;
    if (ctx.isVerified) author += "（已認證）";
    lines.push(`- 作者：${author}`);
  }
  if (ctx.isSponsored) lines.push("- 贊助：是（Facebook 標記的付費廣告）");
  if (ctx.hasMedia) lines.push("- 媒體：有圖片/影片");
  if (ctx.engagement) {
    const parts: string[] = [];
    if (ctx.engagement.reactions) parts.push(ctx.engagement.reactions);
    if (ctx.engagement.comments) parts.push(ctx.engagement.comments);
    if (ctx.engagement.shares) parts.push(ctx.engagement.shares);
    if (parts.length > 0) lines.push(`- 互動：${parts.join("、")}`);
  }

  lines.push("");
  lines.push("## 貼文內容");

  if (ctx.postType === "reshare" && ctx.reshareOriginalText) {
    lines.push(`### 轉發者評論`);
    lines.push(`"""${ctx.text.slice(0, 300)}"""`);
    lines.push("");
    lines.push(`### 原始貼文（${ctx.reshareOriginalAuthor || "unknown"}）`);
    lines.push(`"""${ctx.reshareOriginalText.slice(0, 400)}"""`);
  } else {
    lines.push(`"""${ctx.text.slice(0, 500)}"""`);
  }

  return lines.join("\n");
}

export function buildSingleMessages(
  ctx: LlmPostContext,
  customRules?: { id: string; prompt: string }[],
) {
  const ruleCount = customRules?.length ?? 0;
  const userContent = buildTierAPrompt(ctx) + buildCustomRulesBlock(customRules);
  return [
    { role: "system" as const, content: SYSTEM_PROMPT },
    ...buildFewShot(ruleCount),
    { role: "user" as const, content: userContent },
  ];
}

export function buildCompactRulesBlock(
  rules?: { id: string; prompt: string }[],
): string {
  if (!rules || rules.length === 0) return "";
  const lines: string[] = [
    "",
    "## 額外自訂分類",
    `前 ${VALID_CATEGORIES.length} 碼仍是商業/政治/情緒/個人。`,
    "第 5 碼起依序追加下列規則分數；只在貼文明確符合規則時給高分，否定或只是相近主題不要高分。",
    "自訂規則只判斷規則文字本身，不要把政治、情緒或商業分數代入規則碼。",
    "否定範例：規則問「是否要求留言拿連結？」時，貼文「留言我不會傳連結」的規則碼是 0；貼文「留言+1我傳連結」的規則碼是 9。",
    "規則碼也是 0-9：0=不符合，5=可能相關，9=明確符合。",
  ];
  rules.forEach((r, i) => {
    lines.push(
      `第 ${VALID_CATEGORIES.length + i + 1} 碼 ${r.id}: ${r.prompt}`,
    );
  });
  return lines.join("\n");
}

export function buildCompactSingleMessages(
  ctx: LlmPostContext,
  customRules?: { id: string; prompt: string }[],
) {
  const scoreCount = VALID_CATEGORIES.length + (customRules?.length ?? 0);
  const extraZeros = "0".repeat(customRules?.length ?? 0);
  return [
    { role: "system" as const, content: buildCompactSystemPrompt(scoreCount) },
    ...COMPACT_FEW_SHOT_EXAMPLES.flatMap((ex) => [
      { role: "user" as const, content: ex.content },
      { role: "assistant" as const, content: ex.digits + extraZeros },
    ]),
    {
      role: "user" as const,
      content: buildTierAPrompt(ctx) + buildCompactRulesBlock(customRules),
    },
  ];
}

export function normalizeScores(scores: any): Record<string, number> {
  const result: Record<string, number> = {};
  if (
    typeof scores.category === "string" &&
    VALID_CATEGORIES.includes(scores.category)
  ) {
    result[scores.category] = 1.0;
    return result;
  }
  // short keys (new compact format)
  for (const [short, long] of Object.entries(SHORT_KEY_MAP)) {
    const v = scores[short];
    if (typeof v === "number") result[long] = Math.max(0, Math.min(1, v));
    else if (v === true) result[long] = 1.0;
    else if (v === false) result[long] = 0.0;
  }
  // canonical long keys (backward compat)
  for (const cat of VALID_CATEGORIES) {
    if (result[cat] !== undefined) continue;
    const v = scores[cat];
    if (typeof v === "number") result[cat] = Math.max(0, Math.min(1, v));
    else if (v === true) result[cat] = 1.0;
    else if (v === false) result[cat] = 0.0;
  }
  return result;
}

export function parseCompactScores(
  raw: string,
  customRules?: { id: string }[],
): {
  scores: Record<string, number>;
  customRuleScores?: Record<string, number>;
} | null {
  const compact = raw.trim();
  const ruleCount = customRules?.length ?? 0;
  const expectedLength = VALID_CATEGORIES.length + ruleCount;
  if (!new RegExp(`^[0-9]{${expectedLength}}$`).test(compact)) return null;
  const result: Record<string, number> = {};
  for (let i = 0; i < VALID_CATEGORIES.length; i++) {
    result[VALID_CATEGORIES[i]] = Number(compact[i]) / 10;
  }
  let customRuleScores: Record<string, number> | undefined;
  if (customRules && customRules.length > 0) {
    customRuleScores = {};
    for (let i = 0; i < customRules.length; i++) {
      customRuleScores[customRules[i].id] =
        Number(compact[VALID_CATEGORIES.length + i]) / 10;
    }
  }
  return { scores: result, customRuleScores };
}

const TIER_A_DIMENSION_INPUT: Record<
  string,
  keyof NonNullable<TierAScoring["dimensions"]>
> = {
  ai_style: "aiStyle",
  aiStyle: "aiStyle",
  commercial_intent: "commercialIntent",
  commercialIntent: "commercialIntent",
  low_quality: "lowQuality",
  lowQuality: "lowQuality",
  ragebait: "ragebait",
  repetitive_meme: "repetitiveMeme",
  repetitiveMeme: "repetitiveMeme",
  info_risk_hint: "infoRiskHint",
  infoRiskHint: "infoRiskHint",
};

function clampUnit(v: unknown): number | undefined {
  if (typeof v !== "number" || !Number.isFinite(v)) return undefined;
  return Math.max(0, Math.min(1, v));
}

/**
 * Normalize the Tier A score-only contract. Accept both the new nested
 * `tier_a` object and a few top-level aliases so prompt migrations do not
 * strand otherwise-valid category scores. `collapseScore` is legacy
 * compatibility data; current UI/folding logic should rely on explicit axes
 * and custom-rule scores.
 */
export function normalizeTierAScoring(raw: any): TierAScoring | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const hasNestedTierA = raw.tier_a && typeof raw.tier_a === "object";
  const source = hasNestedTierA ? raw.tier_a : raw;
  const out: TierAScoring = {};
  let hasAny = false;

  const collapseScore = clampUnit(
    source.collapse_score ?? source.collapseScore,
  );
  if (collapseScore !== undefined) {
    out.collapseScore = collapseScore;
    hasAny = true;
  }

  const confidence = clampUnit(source.confidence);
  if (confidence !== undefined) {
    out.confidence = confidence;
    hasAny = true;
  }

  const rawDimensions =
    source.dimensions && typeof source.dimensions === "object"
      ? (source.dimensions as Record<string, unknown>)
      : {};
  const dimensions: NonNullable<TierAScoring["dimensions"]> = {};
  for (const [inputKey, outputKey] of Object.entries(TIER_A_DIMENSION_INPUT)) {
    const score = clampUnit(rawDimensions[inputKey]);
    if (score !== undefined) dimensions[outputKey] = score;
  }
  for (const dim of TIER_A_SCORING_DIMENSIONS) {
    const score = clampUnit(rawDimensions[dim]);
    if (score !== undefined) dimensions[dim] = score;
  }
  if (Object.keys(dimensions).length > 0) {
    for (const dim of TIER_A_SCORING_DIMENSIONS) {
      if (dimensions[dim] === undefined) dimensions[dim] = 0;
    }
    out.dimensions = dimensions;
    hasAny = true;
  }

  if (Array.isArray(source.tags)) {
    const tags = source.tags
      .filter((x: unknown): x is string => typeof x === "string")
      .map((x: string) => x.trim())
      .filter((x: string) => /^[a-z0-9_:-]{1,48}$/i.test(x))
      .slice(0, 8);
    if (tags.length > 0) {
      out.tags = Array.from(new Set<string>(tags));
      hasAny = true;
    }
  }

  if (hasAny && !out.dimensions) {
    out.dimensions = {
      aiStyle: 0,
      commercialIntent: 0,
      lowQuality: 0,
      ragebait: 0,
      repetitiveMeme: 0,
      infoRiskHint: 0,
    };
  }

  return hasAny ? out : undefined;
}

// ---------------------------------------------------------------------------
// Context-window sizing
// ---------------------------------------------------------------------------
//
// Ollama's KV cache is sized by num_ctx — setting it too high saturates
// memory bandwidth (verified on DGX Spark: 256K ctx → 31 tok/s vs ~150 tok/s
// with 8K ctx for the same 9.7B model). Tier A now sends one post per request,
// so a fixed 4K context gives enough headroom without over-allocating KV cache.

export function computeTierANumCtx(): number {
  return 4096;
}

export interface OllamaPost {
  id: string;
  text: string;
  context?: LlmPostContext;
}

export interface OllamaSingleResult {
  scores: Record<string, number>;
  tierAScoring?: TierAScoring;
  customRuleScores?: Record<string, number>;
  raw?: string;
  parseError?: string;
  fallback?: {
    from: "compact_digits";
    to: "json";
    reason: string;
    expectedLength: number;
    rawSample?: string;
  };
}

/** Build the user-defined custom-rule scoring block appended to the
 *  prompt. Empty input → empty string (no prompt overhead). */
export function buildCustomRulesBlock(
  rules?: { id: string; prompt: string }[],
): string {
  if (!rules || rules.length === 0) return "";
  const lines: string[] = [
    "",
    "## 自訂規則",
    "在 JSON 內附加以下 key（0=完全不符合，1=完全符合）：",
    "每條規則只判斷貼文是否明確符合該規則，不要把政治、情緒或商業分數代入；否定或只是相近主題請給 0。",
    "否定範例：規則問「是否要求留言拿連結？」時，貼文「留言我不會傳連結」的規則分數是 0；貼文「留言+1我傳連結」的規則分數是 1。",
  ];
  rules.forEach((r, i) => {
    lines.push(`- r${i + 1}：${r.prompt}`);
  });
  return lines.join("\n");
}

/** Pick `customRuleScores` out of a parsed Ollama response. Looks for flat
 *  keys `r1`, `r2`, … and maps them back to the ordered rule IDs. Also
 *  handles legacy nested `customRuleScores` objects for backward compat. */
export function parseCustomRuleScores(
  parsed: unknown,
  customRules?: { id: string }[],
): Record<string, number> | undefined {
  if (!parsed || typeof parsed !== "object") return undefined;
  const obj = parsed as Record<string, unknown>;

  // New flat-key format: r1, r2, ...
  if (customRules && customRules.length > 0) {
    const out: Record<string, number> = {};
    for (let i = 0; i < customRules.length; i++) {
      const key = `r${i + 1}`;
      const v = obj[key];
      if (typeof v === "number" && Number.isFinite(v)) {
        out[customRules[i].id] = Math.max(0, Math.min(1, v));
      }
    }
    if (Object.keys(out).length > 0) return out;
  }

  // Legacy nested format: { customRuleScores: { uuid: 0.5, ... } }
  const raw = obj.customRuleScores;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof v === "number" && Number.isFinite(v)) {
      out[k] = Math.max(0, Math.min(1, v));
    }
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

/** Extract the first balanced JSON object from a string. Handles nested
 *  braces and trailing content (e.g. model hallucinating extra fields
 *  after the main JSON object). Returns null if no JSON object found. */
function extractFirstJsonObject(raw: string): string | null {
  const start = raw.indexOf("{");
  if (start === -1) return null;
  let depth = 0;
  for (let i = start; i < raw.length; i++) {
    if (raw[i] === "{") depth++;
    else if (raw[i] === "}") depth--;
    if (depth === 0) return raw.slice(start, i + 1);
  }
  return null; // unbalanced braces
}

/**
 * Detect whether an endpoint URL points at an OpenAI-compatible inference
 * server (vLLM, llama.cpp's OpenAI server, etc.) rather than Ollama's
 * native API. The two diverge in: route (`/v1/chat/completions` vs
 * `/api/chat`), body shape (no `think:false`, no `options.num_ctx`), and
 * response shape (`choices[0].message.content` vs `message.content`).
 *
 * Detection rules:
 *   - Endpoint path ends in `/v1` (canonical OpenAI-compat root)
 *   - Endpoint port is `8000` (vLLM default, distinct from Ollama 11434)
 * Either match → OpenAI-compat. Conservative — Ollama users typically
 * configure `http://host:11434` with no path; vLLM users would set
 * `http://host:8000` or `http://host:8000/v1`.
 */
export function isOpenAICompatEndpoint(endpoint: string): boolean {
  if (/\/v1\/?$/.test(endpoint)) return true;
  try {
    const u = new URL(endpoint);
    return u.port === "8000";
  } catch {
    return false;
  }
}

/** Strip a trailing `/v1` so the caller can append routes uniformly. */
function endpointBase(endpoint: string): string {
  return endpoint.replace(/\/v1\/?$/, "").replace(/\/$/, "");
}

export interface TierARequestOptions {
  endpointKind?: TierAEndpointKind;
  openAICompatibleFlavor?: OpenAICompatibleFlavor;
  responseFormat?: OpenAIResponseFormatMode;
  outputMode?: TierAOutputMode;
  returnUnparseable?: boolean;
}

export interface TierACompactDigitsProbeResult {
  ok: boolean;
  expectedLength: number;
  raw: string;
  error?: string;
}

function compactOutputTokenBudget(customRulesCount: number = 0): number {
  const scoreCount = VALID_CATEGORIES.length + customRulesCount;
  return Math.max(COMPACT_OUTPUT_TOKEN_BUDGET, scoreCount + 2);
}

function shouldUseOpenAICompat(
  endpoint: string,
  endpointKind?: TierAEndpointKind,
): boolean {
  if (endpointKind) return endpointKind === "openai-compatible";
  return isOpenAICompatEndpoint(endpoint);
}

function scoreObjectSchema(customRules?: { id: string; prompt: string }[]) {
  const properties: Record<string, { type: string; minimum?: number; maximum?: number }> = {
    c: { type: "number", minimum: 0, maximum: 1 },
    p: { type: "number", minimum: 0, maximum: 1 },
    e: { type: "number", minimum: 0, maximum: 1 },
    P: { type: "number", minimum: 0, maximum: 1 },
  };
  const required = ["c", "p", "e", "P"];
  for (let i = 0; i < (customRules?.length ?? 0); i++) {
    const key = `r${i + 1}`;
    properties[key] = { type: "number", minimum: 0, maximum: 1 };
    required.push(key);
  }
  return {
    type: "object",
    properties,
    required,
    additionalProperties: false,
  };
}

function buildResponseFormat(
  mode: OpenAIResponseFormatMode | undefined,
  customRules: { id: string; prompt: string }[] | undefined,
): object | undefined {
  if (!mode || mode === "none") return undefined;
  if (mode === "json_object") return { type: "json_object" };
  return {
    type: "json_schema",
    json_schema: {
      name: "tier_a_classification",
      strict: true,
      schema: scoreObjectSchema(customRules),
    },
  };
}

function applyOpenAICompatOptions(
  body: Record<string, unknown>,
  customRules: { id: string; prompt: string }[] | undefined,
  options?: TierARequestOptions,
): Record<string, unknown> {
  const responseFormat = buildResponseFormat(
    options?.responseFormat ?? "json_object",
    customRules,
  );
  if (responseFormat) body.response_format = responseFormat;

  if (options?.openAICompatibleFlavor === "vllm") {
    body.chat_template_kwargs = { enable_thinking: false };
  } else if (options?.openAICompatibleFlavor === "mlx-vlm") {
    body.enable_thinking = false;
  }
  return body;
}

export async function callOllamaSingle(
  post: OllamaPost,
  endpoint: string,
  model: string,
  customRules?: { id: string; prompt: string }[],
  options?: TierARequestOptions,
): Promise<OllamaSingleResult | null> {
  const outputMode = options?.outputMode ?? "json";
  const useCompact = outputMode === "compact_digits";
  const expectedCompactLength = VALID_CATEGORIES.length + (customRules?.length ?? 0);
  const unparseable = (parseError: string, raw: string = ""): OllamaSingleResult | null => {
    if (!options?.returnUnparseable) return null;
    return { scores: {}, raw, parseError };
  };
  const fallbackToJson = async (
    reason: string,
    raw?: string,
  ): Promise<OllamaSingleResult | null> => {
    if (!useCompact) return null;
    const rawSample = raw ? raw.trim().slice(0, 120) : undefined;
    console.warn(
      `[Truly] Tier A compact_digits fallback for post ${post.id}: reason=${reason}, expectedLength=${expectedCompactLength}${rawSample ? `, raw=${rawSample}` : ""}`,
    );
    const fallback = await callOllamaSingle(post, endpoint, model, customRules, {
      ...options,
      outputMode: "json",
    });
    if (!fallback || Object.keys(fallback.scores).length === 0) {
      console.warn(
        `[Truly] Tier A compact_digits fallback failed for post ${post.id}: reason=${reason}`,
      );
      return fallback;
    }
    console.info(
      `[Truly] Tier A compact_digits fallback succeeded for post ${post.id}: reason=${reason}`,
    );
    return {
      ...fallback,
      fallback: {
        from: "compact_digits",
        to: "json",
        reason,
        expectedLength: expectedCompactLength,
        rawSample,
      },
    };
  };

  try {
    const context = post.context ?? { text: post.text };
    const messages = useCompact
      ? buildCompactSingleMessages(context, customRules)
      : buildSingleMessages(context, customRules);

    const outputTokenBudget = useCompact
      ? compactOutputTokenBudget(customRules?.length || 0)
      : computeOutputTokenBudget(customRules?.length || 0);
    const useOpenAICompat = shouldUseOpenAICompat(endpoint, options?.endpointKind);
    const url = useOpenAICompat
      ? `${endpointBase(endpoint)}/v1/chat/completions`
      : `${endpoint}/api/chat`;
    const openAIOptions = useCompact
      ? { ...options, responseFormat: "none" as const }
      : options;
    const body = useOpenAICompat
      ? applyOpenAICompatOptions({
          model,
          messages,
          temperature: 0,
          max_tokens: outputTokenBudget,
        }, customRules, openAIOptions)
      : {
          model,
          messages,
          stream: false,
          think: false,
          ...(useCompact ? {} : { format: "json" }),
          options: {
            temperature: 0,
            num_predict: outputTokenBudget,
            num_ctx: computeTierANumCtx(),
          },
        };
    const resp = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!resp.ok) {
      console.warn(
        `[Truly] Ollama single HTTP ${resp.status} for post ${post.id}`,
      );
      if (useCompact) return fallbackToJson(`http_${resp.status}`);
      return unparseable(`http_${resp.status}`);
    }
    const data = await resp.json();
    const raw = useOpenAICompat
      ? data.choices?.[0]?.message?.content || ""
      : data.message?.content || "";
    const compact = parseCompactScores(raw, customRules);
    if (compact) {
      if (useCompact) {
        console.debug(
          `[Truly] Tier A compact_digits parsed for post ${post.id}: expectedLength=${expectedCompactLength}`,
        );
      }
      return {
        scores: compact.scores,
        tierAScoring: normalizeTierAScoring(compact.scores),
        customRuleScores: compact.customRuleScores,
        raw,
      };
    }
    if (useCompact) {
      return fallbackToJson("compact_parse_failed", raw);
    }
    const jsonStr = extractFirstJsonObject(raw);
    if (!jsonStr) {
      console.warn(
        `[Truly] Ollama single: no compact score or JSON object in response for post ${post.id}. Raw: ${raw.slice(0, 300)}`,
      );
      return unparseable("no_json_object", raw);
    }
    try {
      const parsed = JSON.parse(jsonStr);
      const scores = normalizeScores(parsed);
      if (Object.keys(scores).length === 0) {
        console.warn(
          `[Truly] Ollama single: parsed JSON but 0 matching score keys for post ${post.id}. Parsed: ${JSON.stringify(parsed)}`,
        );
      }
      // Custom-rule parse is independent — failure here MUST NOT break
      // built-in score forwarding. When the field is missing-but-rules-
      // were-sent, the caller (filter-engine OLLAMA_RESULT listener) will
      // default to all-zeros.
      let customRuleScores: Record<string, number> | undefined;
      try {
        customRuleScores = parseCustomRuleScores(parsed, customRules);
      } catch {
        customRuleScores = undefined;
      }
      return {
        scores,
        tierAScoring: normalizeTierAScoring(parsed),
        customRuleScores,
        raw,
        parseError: Object.keys(scores).length === 0 ? "empty_scores" : undefined,
      };
    } catch (e) {
      console.warn(
        `[Truly] Ollama single: JSON.parse failed for post ${post.id}:`,
        e,
        "raw match:",
        jsonStr.slice(0, 300),
      );
      return unparseable("json_parse_failed", raw);
    }
  } catch (err) {
    console.warn("[Truly] Ollama single error:", err);
    if (useCompact) {
      const reason = err instanceof Error ? err.message.slice(0, 80) : "exception";
      return fallbackToJson(`exception:${reason}`);
    }
    return unparseable(err instanceof Error ? `exception:${err.message.slice(0, 120)}` : "exception");
  }
}

export async function probeTierACompactDigitsSupport(
  endpoint: string,
  model: string,
  customRules?: { id: string; prompt: string }[],
  options?: TierARequestOptions,
): Promise<TierACompactDigitsProbeResult> {
  const expectedLength = VALID_CATEGORIES.length + (customRules?.length ?? 0);
  try {
    const context: LlmPostContext = {
      text: "今天下班後去河堤散步，風很舒服。留言我不會傳連結，只是記錄生活。",
      postType: "text_only",
      authorName: "生活筆記",
    };
    const messages = buildCompactSingleMessages(context, customRules);
    const outputTokenBudget = compactOutputTokenBudget(customRules?.length || 0);
    const useOpenAICompat = shouldUseOpenAICompat(endpoint, options?.endpointKind);
    const url = useOpenAICompat
      ? `${endpointBase(endpoint)}/v1/chat/completions`
      : `${endpoint}/api/chat`;
    const body = useOpenAICompat
      ? applyOpenAICompatOptions({
          model,
          messages,
          temperature: 0,
          max_tokens: outputTokenBudget,
        }, customRules, { ...options, responseFormat: "none" })
      : {
          model,
          messages,
          stream: false,
          think: false,
          options: {
            temperature: 0,
            num_predict: outputTokenBudget,
            num_ctx: computeTierANumCtx(),
          },
        };

    const resp = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10_000),
    });
    if (!resp.ok) {
      return {
        ok: false,
        expectedLength,
        raw: "",
        error: `HTTP ${resp.status}`,
      };
    }
    const data = await resp.json();
    const raw = (useOpenAICompat
      ? data.choices?.[0]?.message?.content || ""
      : data.message?.content || "") as string;
    const parsed = parseCompactScores(raw, customRules);
    if (!parsed) {
      return {
        ok: false,
        expectedLength,
        raw,
        error: `expected exactly ${expectedLength} digits`,
      };
    }
    return { ok: true, expectedLength, raw: raw.trim() };
  } catch (err) {
    return {
      ok: false,
      expectedLength,
      raw: "",
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
