// Tier B classifier: OpenAI-compatible chat completions with optional
// multimodal input. Distinct from `ollama-client.ts`, which serves Tier A's
// fast scoring path. Truly reaches here only when automatic/expand
// Tier B is configured.

import type {
  DashboardPostEvent,
  DeepClassification,
  Lang,
  ReadingBrief,
  ReadingBriefQuestionKind,
} from "./types";
import { compactZhtwEvidence } from "./zhtw-review";
import { resolveStructuredPostContext } from "./post-context";
import { applyDeepOutputReview, applyReadingBriefOutputReview } from "./model-output-review";
import { jsonRequestHeaders } from "./request-auth";

export type { DeepClassification };

export const TIER_B_DEEP_TIMEOUT_MS = 45_000;
export const TIER_B_READING_BRIEF_TIMEOUT_MS = 45_000;
export const TIER_B_CONTEXT_LIMIT_TOKENS = 16_384;
// Keep a client-side guard even though vLLM also receives
// `truncate_prompt_tokens`. CJK-heavy posts can approach two tokens per
// character, so half the token cap is a conservative text-char budget.
export const TIER_B_TEXT_CONTEXT_LIMIT_CHARS = Math.floor(TIER_B_CONTEXT_LIMIT_TOKENS / 2);

const CONDITIONAL_STAKEHOLDER_GUIDANCE =
  "若貼文只是 settled factual answer 或低風險生活內容，請直接簡短回答，不要發明利害關係人辯論、法律 caveat 或歷史爭議；若貼文涉及 contested policy、主權、身分認同、來源歸因、操縱、CIB 或公共爭議，才以繁體中文公平呈現主要利害關係人的觀點，不要將任何一方的主張當作事實，並找出橋接各方的罕見共識";

const ZHTW_OUTPUT_GUIDANCE =
  "所有自然語言欄位使用台灣慣用繁體中文；避免中國慣用語、翻譯腔、簡體字與不自然標點";

const TEMPORAL_CONTEXT_GUIDANCE =
  "不要依賴模型內建知識判斷現在年份；若判斷「現在、今年、去年、近期、昨天、明天、最新、過期」等相對時間，必須使用使用者訊息提供的時間脈絡";

const CONDITIONAL_STAKEHOLDER_GUIDANCE_EN =
  "If the post is a settled factual answer or low-risk everyday content, answer briefly and do not invent stakeholder disputes, legal caveats, or historical controversies. Only when the post involves contested policy, sovereignty, identity, attribution, manipulation, CIB, or public controversy, fairly present the main stakeholders' perspectives in English, do not treat any side's claim as fact, and identify rare common ground that bridges the sides";

const TEMPORAL_CONTEXT_GUIDANCE_EN =
  "Do not rely on the model's internal knowledge to decide the current year. When judging relative time such as now, this year, last year, recently, yesterday, tomorrow, latest, or expired, use the time context supplied in the user message";

export const DEEP_SYSTEM_PROMPT = `你是 Facebook 貼文「深度分析」專家。先讀過貼文文字與媒體圖片，再輸出 JSON：
{
  "sum": "≤40字綜合摘要，含圖片內容線索",
  "txt_ai": 0–1,
  "img_ai": 0–1,
  "com": 0–1,
  "lq": 0–1,
  "fr": 0–1,
  "mr": 0–1,
  "fc": bool,
  "why": "≤40字判讀理由",
  "imgs": [{"i":1,"note":"≤30字圖片觀察"}]
}
規則：
- ${CONDITIONAL_STAKEHOLDER_GUIDANCE}
- ${ZHTW_OUTPUT_GUIDANCE}
- ${TEMPORAL_CONTEXT_GUIDANCE}
- 若貼文文字包含「分享文結構」，請分清楚「分享者評論」與「被分享內容」；不要把原始貼文立場自動當成分享者立場
- txt_ai 只判斷「文字本身是否像 AI 生成」。不要因為主題提到 AI、模型、Copilot、工具、或科技新聞而加分；普通宣傳文案不等於 AI 文
- txt_ai 的正向跡象包含：高度工整且過度完整的段落、報告式或模板化列點、語氣過度平衡、轉折與結論像自動生成摘要、缺少自然個人書寫的細節與節奏。不確定時給 0.3–0.6；多個跡象同時出現才給 ≥0.7
- 若 txt_ai ≥ 0.7，sum 或 why 必須明確寫出文字生成跡象，例如「段落高度工整、語氣像模型摘要」
- img_ai 只判斷「圖片本身是否像 AI 生成」。官方截圖、速查表、Logo、表格、圖卡、stock photo、Canva/模板素材不等於 AI 圖；沒有圖片或圖片無法判斷時填 0
- com 只判斷較明確的販售、業配、課程、折扣、團購、導購、留言私訊拿連結或合作推廣脈絡；一般活動、旅遊資訊、官方服務說明或個人推薦不要只因提到產品/地點而高分
- lq 判斷內容農場、低資訊密度、模板化、來源薄弱或品質疑慮
- fr 判斷事實風險：是否包含需對照可信來源的具體主張
- mr 判斷操弄風險：是否放大情緒、製造對立或強烈引導立場
- fc 表示是否建議查核；fr 高或具體主張缺乏來源時為 true
- imgs 只填 i 與 note；i 是送入圖片順序 1–4，不要回填 URL 或 data URI
- 不要輸出其他欄位
- 不要解釋、不要 markdown，只回傳 JSON。
`;

export const DEEP_SYSTEM_PROMPT_EN = `You are a Facebook post deep-analysis specialist. The post may be written in any language. Always write every natural-language output field in English, regardless of the Facebook UI language or the post language. Read the post text and media images first, then output JSON:
{
  "sum": "integrated summary <=40 English words, including image clues",
  "txt_ai": 0-1,
  "img_ai": 0-1,
  "com": 0-1,
  "lq": 0-1,
  "fr": 0-1,
  "mr": 0-1,
  "fc": bool,
  "why": "judgement reason <=40 English words",
  "imgs": [{"i":1,"note":"image observation <=30 English words"}]
}
Rules:
- ${CONDITIONAL_STAKEHOLDER_GUIDANCE_EN}
- ${TEMPORAL_CONTEXT_GUIDANCE_EN}
- If the post text contains a share/repost structure, separate the sharer's comment from the shared content. Do not automatically attribute the original post's stance to the sharer.
- txt_ai judges only whether the writing itself looks AI-generated. Do not increase the score just because the topic mentions AI, models, Copilot, tools, or tech news. Ordinary promotional copy is not automatically AI-generated.
- Positive txt_ai signs include: highly polished and overly complete paragraphs, report-like or templated bullet lists, overly balanced tone, transitions and conclusions that resemble generated summaries, and lack of natural personal details or rhythm. If uncertain, use 0.3-0.6; use >=0.7 only when multiple signs appear together.
- If txt_ai >= 0.7, sum or why must explicitly name the writing-generation clue, for example "overly structured paragraphs and model-summary tone".
- img_ai judges only whether the image itself looks AI-generated. Official screenshots, cheat sheets, logos, tables, cards, stock photos, or Canva/template materials are not automatically AI images. Use 0 when there is no image or the image cannot be judged.
- com judges clear sales, sponsorship, courses, discounts, group buys, affiliate guidance, "message for link", or collaboration promotion. Do not mark general activities, travel information, official service descriptions, or personal recommendations high just because they mention a product/place.
- lq judges content-farm signals, low information density, template style, weak sourcing, or quality concerns.
- fr judges factual risk: whether the post contains concrete claims that should be checked against credible sources.
- mr judges manipulation risk: whether it amplifies emotion, creates opposition, or strongly steers a position.
- fc means fact-checking is recommended; set true when fr is high or concrete claims lack sources.
- imgs only contains i and note; i is the sent image order 1-4. Do not include URL or data URI.
- Do not output extra fields.
- Do not explain, do not use markdown, and return JSON only.
`;

export const READING_BRIEF_SYSTEM_PROMPT = `你是 Facebook 貼文的「閱讀重點」規劃員。你會收到貼文文字、既有深度分析 JSON、圖片觀察與來源脈絡。請輸出一份可操作的閱讀簡報 JSON：
{
  "bg": [{"t":"≤12字背景","why":"≤28字原因","q":"≤36字問題"}],
  "claims": [{"c":"≤36字主張","why":"≤28字重要性","need":"≤24字證據","q":"≤36字問題"}],
  "qs": [{"q":"≤36字問題","kind":"understand|context|counter|verify|image|source"}],
  "checks": [{"label":"≤10字項目","q":"≤36字問題","why":"≤28字原因"}],
  "note": "≤36字提醒"
}
規則：
- 保持極短。每個字串都用短句，不要解釋背景細節
- ${CONDITIONAL_STAKEHOLDER_GUIDANCE}
- ${ZHTW_OUTPUT_GUIDANCE}
- ${TEMPORAL_CONTEXT_GUIDANCE}
- bg 最多 2 筆，claims/qs/checks 各最多 3 筆；沒有有用項目就回空陣列
- bg.t 必須是名詞短語，不要以「的」「之」結尾；bg.why 必須是完整短句
- 這不是事實查核結果；只提出閱讀者下一步該理解或查核什麼
- 只有高事實風險、公共議題、數字主張或明確來源疑慮才把內容放進 claims/checks
- 若 riskProfile.lookupWorthy=false，claims/checks 必須回空陣列；qs 預設回空陣列。只有技術工具、原始碼、官方文件、安裝/API/論文/benchmark、法規/證照/資格這類可直接行動的問題，才可輸出最多 1 筆 understand/context
- 生活、旅遊、鳥照、寵物、賽事紀錄、官方社群分享、個人心得、一般活動紀錄等低風險內容，優先輸出 1 筆 bg 或 note；不要硬列查核主張或延伸問題
- 商業、公共議題、高事實風險、AI 圖文疑慮或低品質訊號明確時，才輸出可查核主張、來源問題或下一步查核
- 不要發明外部事實、來源、網址、人物背景或動機
- qs/checks 的 q 會直接交給搜尋引擎；不得只寫「這篇貼文」「此內容」「它」等代稱，必須補入可搜尋的具體名詞、人物、機構、事件或關鍵詞
- 若是轉貼，分開看分享者評論與被分享內容
- 若圖片只是截圖、Logo、圖表或裝飾，不要過度解讀
- zhtw 只提供「用語慣例」線索；只有在有助閱讀、搜尋關鍵字或查核時才使用
- 不得根據 zhtw 推論作者來源、分享者來源、國籍、政治身分、帳號真偽、動機或內容真假
- 若 zhtw 對查核有幫助，可把台灣常用詞納入 qs/checks/note；若無助，完全不要提
- 不要輸出其他欄位
- 不要 markdown，只回傳 JSON。
`;

export const READING_BRIEF_SYSTEM_PROMPT_EN = `You are a Reading Brief planner for Facebook posts. The post may be written in any language. Always write every natural-language output field in English, regardless of the Facebook UI language or the post language. You will receive post text, an existing deep-analysis JSON, image observations, and source context. Output an actionable reading brief JSON:
{
  "bg": [{"t":"background <=12 English words","why":"reason <=28 English words","q":"question <=36 English words"}],
  "claims": [{"c":"claim <=36 English words","why":"importance <=28 English words","need":"evidence needed <=24 English words","q":"question <=36 English words"}],
  "qs": [{"q":"question <=36 English words","kind":"understand|context|counter|verify|image|source"}],
  "checks": [{"label":"item <=10 English words","q":"question <=36 English words","why":"reason <=28 English words"}],
  "note": "reminder <=36 English words"
}
Rules:
- Keep it extremely short. Every string should be a short phrase or sentence; do not explain background details.
- ${CONDITIONAL_STAKEHOLDER_GUIDANCE_EN}
- ${TEMPORAL_CONTEXT_GUIDANCE_EN}
- bg has at most 2 items; claims/qs/checks each have at most 3 items. Return empty arrays when there are no useful items.
- bg.t must be a noun phrase; bg.why must be a complete short sentence.
- This is not a fact-check result. It only proposes what the reader should understand or verify next.
- Put content into claims/checks only for high factual risk, public issues, numeric claims, or clear source concerns.
- If riskProfile.lookupWorthy=false, claims/checks must be empty and qs should be empty by default. Only output at most 1 understand/context question for directly actionable topics such as technical tools, source code, official documents, installation/API/papers/benchmarks, laws, licenses, or qualifications.
- For low-risk life, travel, bird photos, pets, sports records, official social sharing, personal reflections, or general activity records, prefer 1 bg item or note; do not force checkable claims or follow-up questions.
- Output checkable claims, source questions, or next checks only when commercial, public-issue, high-factual-risk, AI image/text concern, or low-quality signals are clear.
- Do not invent external facts, sources, URLs, biographies, or motives.
- qs/checks.q may be sent directly to a search/chat engine. Do not write only "this post", "this content", or "it"; include searchable names, people, organizations, events, or keywords.
- If this is a repost, separate the sharer's comment from the shared content.
- If images are screenshots, logos, charts, or decorations, do not over-interpret them.
- Do not output extra fields.
- Do not use markdown; return JSON only.
`;

export function tierBOutputLang(outputLang?: Lang): Lang {
  return outputLang === "en" ? "en" : "zh-TW";
}

export function deepSystemPrompt(outputLang?: Lang): string {
  return tierBOutputLang(outputLang) === "en" ? DEEP_SYSTEM_PROMPT_EN : DEEP_SYSTEM_PROMPT;
}

export function readingBriefSystemPrompt(outputLang?: Lang): string {
  return tierBOutputLang(outputLang) === "en" ? READING_BRIEF_SYSTEM_PROMPT_EN : READING_BRIEF_SYSTEM_PROMPT;
}

interface ChatContent {
  type: "text" | "image_url";
  text?: string;
  image_url?: { url: string };
}

interface PromptTemporalContext {
  nowUtc: string;
  localDateTime: string;
  timezone: string;
  currentYear: number;
}

function currentTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

function localDateParts(now: Date, timeZone: string): Record<string, string> {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(now);
  return Object.fromEntries(parts.map((part) => [part.type, part.value]));
}

export function buildPromptTemporalContext(now = new Date()): PromptTemporalContext {
  const timezone = currentTimezone();
  const parts = localDateParts(now, timezone);
  const localDateTime = `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}`;
  return {
    nowUtc: now.toISOString(),
    localDateTime,
    timezone,
    currentYear: Number(parts.year) || now.getUTCFullYear(),
  };
}

function temporalContextBlock(
  context = buildPromptTemporalContext(),
  outputLang: Lang = "zh-TW",
): string {
  if (outputLang === "en") {
    return [
      "## Time Context",
      `Current date/time (UTC): ${context.nowUtc}`,
      `User local time: ${context.localDateTime}`,
      `User timezone: ${context.timezone}`,
      `Current year: ${context.currentYear}`,
      "Use this as the basis for relative-time and freshness judgments. Do not use the model's built-in current year.",
    ].join("\n");
  }
  return [
    "## 時間脈絡",
    `目前日期時間（UTC）：${context.nowUtc}`,
    `使用者本地時間：${context.localDateTime}`,
    `使用者時區：${context.timezone}`,
    `目前年份：${context.currentYear}`,
    "請以此作為相對時間與時效性判斷基準，不要使用模型內建的現在年份。",
  ].join("\n");
}

/**
 * Build the user-message content array for the Tier B OpenAI-compatible
 * `/v1/chat/completions`. Images are appended as `image_url` parts;
 * callers prefetch/re-encode them before dispatch.
 */
export function buildTierBUserContent(
  text: string,
  imageUrls: string[],
  outputLang?: Lang,
): ChatContent[] {
  const parts: ChatContent[] = [];
  const lang = tierBOutputLang(outputLang);
  const postLabel = lang === "en" ? "## Post Text" : "## 貼文文字";
  const answerLabel = lang === "en"
    ? "\n\n## Required Answer Language\nAlways answer in English. The post itself may be in any language."
    : "";
  const header = `${temporalContextBlock(buildPromptTemporalContext(), lang)}${answerLabel}\n\n${postLabel}\n${text.slice(0, TIER_B_TEXT_CONTEXT_LIMIT_CHARS)}`;
  parts.push({ type: "text", text: header });
  for (const url of imageUrls.slice(0, 4)) {
    parts.push({ type: "image_url", image_url: { url } });
  }
  return parts;
}

export interface TierBDeepRequest {
  endpoint: string;
  model: string;
  apiKey?: string;
  text: string;
  imageUrls: string[];
  /** Count of images dropped by `extractPostImages`'s Tier B unsafe
   *  pre-filter. When `imageUrls` is empty AND this is > 0, the
   *  result's `imageStatus` is `"filtered"` rather than `"no_images"`. */
  filteredImageCount?: number;
  timeoutMs?: number;
  outputLang?: Lang;
}

export type TierBDeepErrorCode =
  | "tier_b_network_error"
  | "tier_b_timeout"
  | "tier_b_http_error"
  | "tier_b_format_error"
  | "tier_b_response_truncated"
  | "tier_b_reasoning_without_json"
  | "tier_b_failed";

export interface TierBDeepResult {
  ok: boolean;
  deep: DeepClassification | null;
  error?: TierBDeepErrorCode | string;
}

export interface TierBReadingBriefRequest {
  endpoint: string;
  model: string;
  apiKey?: string;
  event: DashboardPostEvent;
  timeoutMs?: number;
  outputLang?: Lang;
}

export interface TierBVisionProbeRequest {
  endpoint: string;
  model: string;
  apiKey?: string;
  timeoutMs?: number;
}

export interface TierBVisionProbeResult {
  ok: boolean;
  raw?: string;
  error?: "vision_probe_network_error" | "vision_probe_timeout" | "vision_probe_http_error" | "vision_probe_format_error";
}

export interface TierBChatBody {
  model: string;
  messages: Array<{ role: "system" | "user"; content: string | ChatContent[] }>;
  temperature: number;
  max_tokens: number;
  response_format?: { type: "json_object" };
  reasoning_effort?: "none";
  truncate_prompt_tokens: number;
  chat_template_kwargs: { enable_thinking: boolean };
}

export const TIER_B_VISION_PROBE_IMAGE =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNQTf7/HwAEvwKHHvca0gAAAABJRU5ErkJggg==";

export function tierBCompletionsUrl(endpoint: string): string {
  const baseUrl = endpoint.replace(/\/v1\/?$/, "").replace(/\/$/, "");
  return `${baseUrl}/v1/chat/completions`;
}

export function shouldRequestOpenAICompatNoThinking(endpoint: string, model: string): boolean {
  try {
    const url = new URL(endpoint);
    if (url.port === "11434") return true;
    const localHost = ["localhost", "127.0.0.1", "::1", "[::1]"].includes(url.hostname);
    if (localHost && model.includes(":") && !model.includes("/")) return true;
  } catch {
    // Fall through to the model-id heuristic below.
  }
  return model.includes(":") && !model.includes("/");
}

export function buildTierBDeepChatBody(
  req: TierBDeepRequest,
  includeImages = true,
): TierBChatBody {
  const body: TierBChatBody = {
    model: req.model,
    messages: [
      { role: "system", content: deepSystemPrompt(req.outputLang) },
      {
        role: "user",
        content: buildTierBUserContent(
          req.text,
          includeImages ? req.imageUrls : [],
          req.outputLang,
        ),
      },
    ],
    temperature: 0,
    // ---- max_tokens sizing ----
    // Worst-case Tier B JSON response (4 image slots filled, all CJK
    // text fields at max length, all numeric fields at 0.99):
    //   ~830 characters total (712 ASCII + 118 CJK)
    //   ~426 tokens with Qwen3.6 tokenizer (CJK ≈ 1.8 tok/char, ASCII ≈ 0.3 tok/char)
    //   × 1.4 safety buffer = 596 → round to 600.
    // When the response schema grows, rebuild the worst-case JSON, count
    // tokens, multiply by 1.4, and update this constant.
    max_tokens: 600,
    response_format: { type: "json_object" },
    truncate_prompt_tokens: TIER_B_CONTEXT_LIMIT_TOKENS,
    chat_template_kwargs: { enable_thinking: false },
  };
  if (shouldRequestOpenAICompatNoThinking(req.endpoint, req.model)) {
    body.reasoning_effort = "none";
  }
  return body;
}

function clampText(v: unknown, max: number): string | undefined {
  if (typeof v !== "string") return undefined;
  const s = v.replace(/\s+/g, " ").trim();
  return s ? s.slice(0, max) : undefined;
}

function normalizeBriefArray<T>(
  raw: unknown,
  limit: number,
  map: (item: unknown) => T | undefined,
): T[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const out: T[] = [];
  for (const item of raw) {
    const mapped = map(item);
    if (mapped) out.push(mapped);
    if (out.length >= limit) break;
  }
  return out.length > 0 ? out : undefined;
}

export function normalizeReadingBrief(raw: any, model: string, outputLang?: Lang): ReadingBrief {
  const lang = tierBOutputLang(outputLang);
  const brief: ReadingBrief = { model, outputLang: lang };
  brief.bg = normalizeBriefArray(raw?.bg, 2, (item) => {
    if (!item || typeof item !== "object") return undefined;
    const x = item as Record<string, unknown>;
    const t = clampText(x.t, 24);
    const why = clampText(x.why, 60);
    if (!t || !why) return undefined;
    const q = clampText(x.q, 80);
    return q ? { t, why, q } : { t, why };
  });
  brief.claims = normalizeBriefArray(raw?.claims, 3, (item) => {
    if (!item || typeof item !== "object") return undefined;
    const x = item as Record<string, unknown>;
    const c = clampText(x.c, 70);
    const why = clampText(x.why, 60);
    const need = clampText(x.need, 60);
    if (!c || !why || !need) return undefined;
    const q = clampText(x.q, 80);
    return q ? { c, why, need, q } : { c, why, need };
  });
  brief.qs = normalizeBriefArray(raw?.qs, 3, (item) => {
    if (!item || typeof item !== "object") return undefined;
    const x = item as Record<string, unknown>;
    const q = clampText(x.q, 80);
    const kind = typeof x.kind === "string" ? x.kind : "";
    if (!q || !["understand", "context", "counter", "verify", "image", "source"].includes(kind)) {
      return undefined;
    }
    return { q, kind: kind as ReadingBriefQuestionKind };
  });
  brief.checks = normalizeBriefArray(raw?.checks, 3, (item) => {
    if (!item || typeof item !== "object") return undefined;
    const x = item as Record<string, unknown>;
    const label = clampText(x.label, 20);
    const q = clampText(x.q, 80);
    const why = clampText(x.why, 60);
    if (!label || !q || !why) return undefined;
    return { label, q, why };
  });
  const note = clampText(raw?.note, 60);
  if (note) brief.note = note;
  return lang === "zh-TW" ? applyReadingBriefOutputReview(brief) : brief;
}

interface ParsedReadingBriefContent {
  ok: boolean;
  value: ReadingBrief | null;
  error?: string;
}

export function parseTierBReadingBriefContent(
  raw: string,
  model: string,
  outputLang?: Lang,
): ParsedReadingBriefContent {
  const jsonText = extractDeepJsonObject(raw);
  if (!jsonText) {
    return { ok: false, value: null, error: "no_strict_json_object" };
  }
  try {
    return { ok: true, value: normalizeReadingBrief(JSON.parse(jsonText), model, outputLang) };
  } catch (e) {
    return {
      ok: false,
      value: null,
      error: e instanceof Error ? e.message.slice(0, 160) : "bad_json",
    };
  }
}

export function buildReadingBriefPrompt(event: DashboardPostEvent, outputLang?: Lang): string {
  const lang = tierBOutputLang(outputLang);
  const deep = event.decision.deepClassification;
  const scores = event.decision.scores ?? {};
  const iq = deep?.informationQuality;
  const context = resolveStructuredPostContext(event);
  const factualRisk = iq?.factualRisk ?? 0;
  const commercial = deep?.commercialIntent ?? scores.commercial ?? 0;
  const riskProfile = {
    highRisk: Boolean(
      iq?.needsFactCheck ||
        factualRisk >= 0.7,
    ),
    lookupWorthy: Boolean(
      iq?.needsFactCheck ||
        factualRisk >= 0.5 ||
        (scores.political ?? 0) >= 0.6 ||
        commercial >= 0.6 ||
        (deep?.textAiLikelihood ?? 0) >= 0.8 ||
        (deep?.imageAiLikelihood ?? 0) >= 0.8 ||
        (deep?.lowQualitySignal ?? 0) >= 0.6 ||
        (iq?.manipulationRisk ?? 0) >= 0.6,
    ),
    lowRiskPersonal: Boolean(
      !iq?.needsFactCheck &&
        factualRisk < 0.4 &&
        (scores.political ?? 0) < 0.6 &&
        commercial < 0.6 &&
        (deep?.textAiLikelihood ?? 0) < 0.8 &&
        (deep?.imageAiLikelihood ?? 0) < 0.8 &&
        (deep?.lowQualitySignal ?? 0) < 0.6 &&
        (iq?.manipulationRisk ?? 0) < 0.6,
    ),
  };
  const payload: Record<string, unknown> = {
    outputLanguage: lang === "en" ? "English" : "Taiwan Traditional Chinese",
    temporalContext: buildPromptTemporalContext(),
    post: {
      author: event.authorName,
      text: (context.isShare ? context.sharerComment : context.ownText).slice(0, 3000),
      sharedText: context.sharedContent.slice(0, 1600),
      linkPreview: context.linkPreview.slice(0, 1000),
      imageText: context.imageTexts.slice(0, 4),
      imageAlt: context.imageAltTexts.slice(0, 4),
      originalAuthor: context.originalAuthor,
      contentKind: event.contentKind,
      postType: event.postType,
      hasMedia: event.hasMedia,
      postUrl: event.postUrl,
      pageUrl: event.pageUrl,
    },
    tierB: deep ? {
      summary: deep.summary,
      textAiLikelihood: deep.textAiLikelihood,
      imageAiLikelihood: deep.imageAiLikelihood,
      commercialIntent: deep.commercialIntent,
      lowQualitySignal: deep.lowQualitySignal,
      informationQuality: deep.informationQuality,
      imageInsights: deep.imageInsights,
      imageStatus: deep.imageStatus,
    } : undefined,
    tierA: {
      scores: event.decision.scores,
      primaryCategory: event.decision.primaryCategory,
      primaryScore: event.decision.primaryScore,
    },
    riskProfile,
  };
  if (lang === "zh-TW") {
    payload.zhtw = compactZhtwEvidence(event.zhtwReview ?? event.decision.zhtwReview);
  }
  const instruction = lang === "en"
    ? "Produce a reading brief from the following JSON. The post may be in any language; write all output fields in English."
    : "請根據以下 JSON 產生閱讀簡報。";
  return `${instruction}\n${JSON.stringify(payload)}`;
}

export function buildTierBReadingBriefChatBody(req: TierBReadingBriefRequest): TierBChatBody {
  const body: TierBChatBody = {
    model: req.model,
    messages: [
      { role: "system", content: readingBriefSystemPrompt(req.outputLang) },
      { role: "user", content: buildReadingBriefPrompt(req.event, req.outputLang) },
    ],
    temperature: 0,
    max_tokens: 1200,
    response_format: { type: "json_object" },
    truncate_prompt_tokens: TIER_B_CONTEXT_LIMIT_TOKENS,
    chat_template_kwargs: { enable_thinking: false },
  };
  if (shouldRequestOpenAICompatNoThinking(req.endpoint, req.model)) {
    body.reasoning_effort = "none";
  }
  return body;
}

export function buildTierBVisionProbeChatBody(req: TierBVisionProbeRequest): TierBChatBody {
  const body: TierBChatBody = {
    model: req.model,
    messages: [
      {
        role: "system",
        content: "You are a vision capability probe. Answer with one lowercase English color word only.",
      },
      {
        role: "user",
        content: [
          {
            type: "text",
            text: "What is the dominant color of the attached image? Answer with one word only.",
          },
          { type: "image_url", image_url: { url: TIER_B_VISION_PROBE_IMAGE } },
        ],
      },
    ],
    temperature: 0,
    max_tokens: 8,
    truncate_prompt_tokens: 512,
    chat_template_kwargs: { enable_thinking: false },
  };
  if (shouldRequestOpenAICompatNoThinking(req.endpoint, req.model)) {
    body.reasoning_effort = "none";
  }
  return body;
}

export async function callTierBVisionProbe(
  req: TierBVisionProbeRequest,
): Promise<TierBVisionProbeResult> {
  const url = tierBCompletionsUrl(req.endpoint);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), req.timeoutMs ?? 12_000);
  try {
    const resp = await fetch(url, {
      method: "POST",
      headers: jsonRequestHeaders(req.apiKey),
      body: JSON.stringify(buildTierBVisionProbeChatBody(req)),
      signal: ctrl.signal,
    });
    if (!resp.ok) {
      let errBody = "";
      try { errBody = (await resp.text()).slice(0, 240); } catch { /* ignore */ }
      console.warn(`[Truly Tier B vision] HTTP ${resp.status}: ${errBody}`);
      return { ok: false, error: "vision_probe_http_error", raw: errBody };
    }
    const data = await resp.json();
    const raw = String(data?.choices?.[0]?.message?.content || "").trim();
    return {
      ok: /\b(blue|cyan)\b/i.test(raw),
      raw: raw.slice(0, 120),
      error: /\b(blue|cyan)\b/i.test(raw) ? undefined : "vision_probe_format_error",
    };
  } catch (error) {
    console.warn("[Truly Tier B vision] error:", error);
    const code = error instanceof DOMException && error.name === "AbortError"
      ? "vision_probe_timeout"
      : "vision_probe_network_error";
    return { ok: false, error: code };
  } finally {
    clearTimeout(timer);
  }
}

export async function callTierBReadingBrief(
  req: TierBReadingBriefRequest,
): Promise<ReadingBrief | null> {
  const url = tierBCompletionsUrl(req.endpoint);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), req.timeoutMs ?? TIER_B_READING_BRIEF_TIMEOUT_MS);
  try {
    const resp = await fetch(url, {
      method: "POST",
      headers: jsonRequestHeaders(req.apiKey),
      body: JSON.stringify(buildTierBReadingBriefChatBody(req)),
      signal: ctrl.signal,
    });
    if (!resp.ok) {
      let errBody = "";
      try { errBody = (await resp.text()).slice(0, 400); } catch { /* ignore */ }
      console.warn(`[Truly Tier B-2] HTTP ${resp.status}: ${errBody}`);
      return null;
    }
    const data = await resp.json();
    const raw = data?.choices?.[0]?.message?.content || "";
    const parsed = parseTierBReadingBriefContent(raw, req.model, req.outputLang);
    if (!parsed.ok) {
      console.warn(`[Truly Tier B-2] ${parsed.error}:`, raw.slice(0, 200));
      return null;
    }
    return parsed.value;
  } catch (e) {
    console.warn("[Truly Tier B-2] error:", e);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Call the configured Tier B OpenAI-compatible chat completions endpoint
 * with the deep-analysis
 * prompt and a (text, image[]) user message. Returns the parsed
 * `DeepClassification` or `null` on failure. Tolerant: any error
 * leaves Tier A unchanged on the caller side.
 *
 * Image-decode resilience: when the backend 400s with the python-side
 * "not enough values to unpack" / "image" error (which we've seen
 * fire for FB CDN URLs whose content the backend image decoder can't decode
 * — animated WebP, video thumbnails, signed URLs that 403 the
 * server-side fetcher), we retry once text-only. Better to ship a
 * partial result than a null one.
 */
export async function callTierBDeep(
  req: TierBDeepRequest,
): Promise<DeepClassification | null> {
  const result = await callTierBDeepDetailed(req);
  return result.ok ? result.deep : null;
}

export async function callTierBDeepDetailed(
  req: TierBDeepRequest,
): Promise<TierBDeepResult> {
  const url = tierBCompletionsUrl(req.endpoint);
  const filteredCount = req.filteredImageCount ?? 0;
  const sentImages = req.imageUrls.length > 0;

  const first = await postOnce(url, req, /*includeImages=*/ true);
  if (first.ok && first.value) {
    if (sentImages) first.value.imageStatus = "ok";
    else first.value.imageStatus = filteredCount > 0 ? "filtered" : "no_images";
    return { ok: true, deep: first.value };
  }

  if (first.retryTextOnly && sentImages) {
    console.warn(
      `[Truly Tier B] retry text-only after image path failure (was ${req.imageUrls.length} image(s))`,
    );
    const second = await postOnce(url, req, /*includeImages=*/ false);
    if (second.ok && second.value) {
      second.value.imageStatus = first.retryImageStatus ?? "decode_failed";
      return { ok: true, deep: second.value };
    }
    return {
      ok: false,
      deep: null,
      error: second.error ?? first.error ?? "tier_b_failed",
    };
  }
  return {
    ok: false,
    deep: null,
    error: first.error ?? "tier_b_failed",
  };
}

interface PostOutcome {
  ok: boolean;
  value: DeepClassification | null;
  error?: TierBDeepErrorCode | string;
  /** True when the failure looked like a backend image-decode crash and a
   *  text-only retry is worth attempting. */
  retryTextOnly: boolean;
  retryImageStatus?: NonNullable<DeepClassification["imageStatus"]>;
}

interface ParsedDeepContent {
  ok: boolean;
  value: DeepClassification | null;
  error?: string;
}

export function extractDeepJsonObject(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  const fenced = trimmed.match(/```(?:json)?[ \t]*\r?\n([\s\S]*?)\r?\n?```/i);
  const candidate = fenced ? fenced[1].trim() : trimmed;
  if (!candidate.startsWith("{") || !candidate.endsWith("}")) return null;
  return candidate;
}

export function parseTierBDeepContent(raw: string, model: string, outputLang?: Lang): ParsedDeepContent {
  const jsonText = extractDeepJsonObject(raw);
  if (!jsonText) {
    return { ok: false, value: null, error: "no_strict_json_object" };
  }
  try {
    return { ok: true, value: normalizeDeep(JSON.parse(jsonText), model, outputLang) };
  } catch (e) {
    return {
      ok: false,
      value: null,
      error: e instanceof Error ? e.message.slice(0, 160) : "bad_json",
    };
  }
}

async function postOnce(
  url: string,
  req: TierBDeepRequest,
  includeImages: boolean,
): Promise<PostOutcome> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), req.timeoutMs ?? TIER_B_DEEP_TIMEOUT_MS);
  try {
    const resp = await fetch(url, {
      method: "POST",
      headers: jsonRequestHeaders(req.apiKey),
      body: JSON.stringify(buildTierBDeepChatBody(req, includeImages)),
      signal: ctrl.signal,
    });
    if (!resp.ok) {
      let errBody = "";
      try { errBody = (await resp.text()).slice(0, 400); } catch { /* ignore */ }
      console.warn(`[Truly Tier B] HTTP ${resp.status}: ${errBody}`);
      // Classic Python-side image decode crash. Retry text-only.
      const looksLikeImageCrash =
        resp.status === 400 &&
        (errBody.includes("not enough values to unpack") ||
         errBody.includes("image") ||
         errBody.includes("PIL"));
      // When images caused the crash, log the URLs we sent so a future
      // pre-filter pattern can be designed against real samples. Only
      // logged when includeImages is true so retry calls stay quiet.
      if (looksLikeImageCrash && includeImages && req.imageUrls.length > 0) {
        for (const u of req.imageUrls) {
          console.warn(`[Truly Tier B] crash-url: ${u}`);
        }
      }
      return {
        ok: false,
        value: null,
        error: "tier_b_http_error",
        retryTextOnly: looksLikeImageCrash,
        retryImageStatus: looksLikeImageCrash ? "decode_failed" : undefined,
      };
    }
    const data = await resp.json();
    const choice = data?.choices?.[0];
    const raw = choice?.message?.content || "";
    const parsed = parseTierBDeepContent(raw, req.model, req.outputLang);
    if (!parsed.ok) {
      const reasoning = choice?.message?.reasoning || "";
      const finishReason = choice?.finish_reason;
      const error =
        finishReason === "length" && !raw && reasoning
          ? "tier_b_response_truncated"
          : !raw && reasoning
            ? "tier_b_reasoning_without_json"
            : "tier_b_format_error";
      console.warn(`[Truly Tier B] ${parsed.error}:`, raw.slice(0, 1200));
      return {
        ok: false,
        value: null,
        error,
        retryTextOnly: includeImages && req.imageUrls.length > 0,
        retryImageStatus: includeImages && req.imageUrls.length > 0
          ? "vision_format_failed"
          : undefined,
      };
    }
    return { ok: true, value: parsed.value, retryTextOnly: false };
  } catch (e) {
    console.warn("[Truly Tier B] error:", e);
    const error = e instanceof DOMException && e.name === "AbortError"
      ? "tier_b_timeout"
      : "tier_b_network_error";
    return { ok: false, value: null, error, retryTextOnly: false };
  } finally {
    clearTimeout(timer);
  }
}

function clampUnit(v: unknown): number | undefined {
  if (typeof v !== "number" || !Number.isFinite(v)) return undefined;
  return Math.max(0, Math.min(1, v));
}

export function normalizeDeep(raw: any, model: string, outputLang?: Lang): DeepClassification {
  const lang = tierBOutputLang(outputLang);
  const out: DeepClassification = { model, outputLang: lang };
  const aiLikelihood = clampUnit(raw.ai_likelihood ?? raw.aiLikelihood);
  const textAiLikelihood = clampUnit(raw.txt_ai ?? raw.text_ai_likelihood ?? raw.textAiLikelihood);
  const imageAiLikelihood = clampUnit(raw.img_ai ?? raw.image_ai_likelihood ?? raw.imageAiLikelihood);
  if (textAiLikelihood !== undefined) out.textAiLikelihood = textAiLikelihood;
  if (imageAiLikelihood !== undefined) out.imageAiLikelihood = imageAiLikelihood;
  const zhCnLexicalSignal = clampUnit(raw.zh ?? raw.zh_cn_lexical_signal ?? raw.zhCnLexicalSignal);
  if (zhCnLexicalSignal !== undefined) out.zhCnLexicalSignal = zhCnLexicalSignal;
  if (aiLikelihood !== undefined) out.aiLikelihood = aiLikelihood;
  else {
    const splitScores = [textAiLikelihood, imageAiLikelihood].filter((v): v is number => typeof v === "number");
    if (splitScores.length > 0) out.aiLikelihood = Math.max(...splitScores);
  }
  const commercialIntent = clampUnit(raw.com ?? raw.commercial_intent ?? raw.commercialIntent);
  if (commercialIntent !== undefined) out.commercialIntent = commercialIntent;
  const lowQualitySignal = clampUnit(raw.lq ?? raw.low_quality_signal ?? raw.lowQualitySignal);
  if (lowQualitySignal !== undefined) out.lowQualitySignal = lowQualitySignal;
  const iq = raw.information_quality && typeof raw.information_quality === "object"
    ? raw.information_quality
    : {};
  const hasInlineIq =
    raw.fr !== undefined ||
    raw.mr !== undefined ||
    raw.fc !== undefined ||
    raw.why !== undefined;
  if ((raw.information_quality && typeof raw.information_quality === "object") || hasInlineIq) {
    const informationQuality: NonNullable<DeepClassification["informationQuality"]> = {};
    const factualRisk = clampUnit(raw.fr ?? iq.factual_risk ?? iq.factualRisk);
    if (factualRisk !== undefined) informationQuality.factualRisk = factualRisk;
    const manipulationRisk = clampUnit(raw.mr ?? iq.manipulation_risk ?? iq.manipulationRisk);
    if (manipulationRisk !== undefined) informationQuality.manipulationRisk = manipulationRisk;
    if (typeof raw.fc === "boolean") informationQuality.needsFactCheck = raw.fc;
    else if (typeof iq.needs_fact_check === "boolean") informationQuality.needsFactCheck = iq.needs_fact_check;
    else if (typeof iq.needsFactCheck === "boolean") informationQuality.needsFactCheck = iq.needsFactCheck;
    const explanation = raw.why ?? iq.explanation;
    if (typeof explanation === "string" && explanation.trim().length > 0) {
      informationQuality.explanation = explanation.trim().slice(0, 80);
    }
    if (Object.keys(informationQuality).length > 0) {
      out.informationQuality = informationQuality;
    }
  }
  const rawImageInsights = Array.isArray(raw.imgs)
    ? raw.imgs
    : Array.isArray(raw.image_insights)
      ? raw.image_insights
      : [];
  if (rawImageInsights.length > 0) {
    const insights = rawImageInsights
      .filter((x: any) =>
        x &&
        (typeof x.note === "string" || typeof x.observation === "string")
      )
      .slice(0, 4)
      .map((x: any) => {
        const insight: NonNullable<DeepClassification["imageInsights"]>[number] = {
          observation: (typeof x.note === "string" ? x.note : x.observation).slice(0, 80),
        };
        const url = typeof x.u === "string" ? x.u : typeof x.url === "string" ? x.url : "";
        if (url.trim()) insight.url = url.trim();
        const index = typeof x.i === "number" ? x.i : typeof x.index === "number" ? x.index : undefined;
        if (typeof index === "number" && Number.isFinite(index)) {
          insight.index = Math.max(1, Math.min(4, Math.round(index)));
        }
        return insight;
      });
    if (insights.length > 0) out.imageInsights = insights;
  }
  const summary = raw.sum ?? raw.summary;
  if (typeof summary === "string" && summary.trim().length > 0) {
    out.summary = summary.trim().slice(0, 80);
  }
  return lang === "zh-TW" ? applyDeepOutputReview(out) : out;
}
