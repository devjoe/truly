import type { DashboardPostEvent, DeepClassification, Lang, ReadingBrief } from "./types";
import type { OllamaPost, OllamaSingleResult } from "./ollama-client";
import type { CustomRulePromptInput } from "./messages";
import {
  buildReadingBriefPrompt,
  readingBriefSystemPrompt,
  normalizeDeep,
  normalizeReadingBrief,
  tierBOutputLang,
  type TierBDeepResult,
  type TierBDeepErrorCode,
} from "./tier-b-client";

export const GEMINI_NANO_PROVIDER = "chrome-gemini-nano";
export const GEMINI_NANO_TIER_A_TIMEOUT_MS = 10_000;
export const GEMINI_NANO_TIER_B_TIMEOUT_MS = 20_000;

type NanoInputModality = "text" | "image";
type NanoAvailability = "available" | "downloadable" | "downloading" | "unavailable" | "unknown";

interface NanoLanguageModelSession {
  prompt(input: unknown, options?: { signal?: AbortSignal }): Promise<string>;
  destroy?: () => void;
}

interface NanoLanguageModelNamespace {
  availability(options?: unknown): Promise<NanoAvailability | string>;
  create(options?: unknown): Promise<NanoLanguageModelSession>;
}

interface NanoGlobal {
  LanguageModel?: NanoLanguageModelNamespace;
}

export interface GeminiNanoAvailabilityResult {
  ok: boolean;
  availability: NanoAvailability | string;
  error?: string;
}

export interface GeminiNanoTierBRequest {
  text: string;
  imageUrls: string[];
  filteredImageCount?: number;
  timeoutMs?: number;
  outputLang?: Lang;
}

export interface GeminiNanoReadingBriefRequest {
  event: DashboardPostEvent;
  timeoutMs?: number;
  outputLang?: Lang;
}

function nanoNamespace(): NanoLanguageModelNamespace | undefined {
  return (globalThis as unknown as NanoGlobal).LanguageModel;
}

function nanoOptions(modalities: NanoInputModality[], responseConstraint?: unknown): Record<string, unknown> {
  const options: Record<string, unknown> = {
    expectedInputs: modalities.map((type) => ({ type })),
    expectedOutputs: [{ type: "text" }],
  };
  if (responseConstraint) options.responseConstraint = responseConstraint;
  return options;
}

export async function probeGeminiNanoAvailability(
  modalities: NanoInputModality[] = ["text"],
): Promise<GeminiNanoAvailabilityResult> {
  const lm = nanoNamespace();
  if (!lm) return { ok: false, availability: "unavailable", error: "LanguageModel unavailable" };
  try {
    const availability = await lm.availability(nanoOptions(modalities));
    return { ok: availability === "available", availability };
  } catch (error) {
    return {
      ok: false,
      availability: "unknown",
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function promptWithTimeout(
  session: NanoLanguageModelSession,
  input: unknown,
  timeoutMs: number,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const ctrl = new AbortController();
    const timer = setTimeout(() => {
      ctrl.abort();
      reject(new DOMException("Gemini Nano request timed out", "AbortError"));
    }, timeoutMs);
    session.prompt(input, { signal: ctrl.signal }).then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

function extractJsonObject(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const fenced = trimmed.match(/```(?:json)?[ \t]*\r?\n([\s\S]*?)\r?\n?```/i);
  const candidate = fenced ? fenced[1].trim() : trimmed;
  if (!candidate.startsWith("{") || !candidate.endsWith("}")) return null;
  return candidate;
}

function parseJsonObject(raw: string): Record<string, unknown> {
  const json = extractJsonObject(raw);
  if (!json) throw new Error("no_strict_json_object");
  const parsed = JSON.parse(json);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("json_not_object");
  }
  return parsed as Record<string, unknown>;
}

function clampUnit(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

function normalizeTaiwanTerms(text: string): string {
  return text
    .replaceAll("信息", "資訊")
    .replaceAll("质量", "品質")
    .replaceAll("质量", "品質")
    .replaceAll("视频", "影片");
}

const TIER_A_SCHEMA = {
  type: "object",
  properties: {
    commercial: { type: "number" },
    political: { type: "number" },
    emotional: { type: "number" },
    personal: { type: "number" },
    customRuleScores: { type: "object" },
  },
  required: ["commercial", "political", "emotional", "personal"],
  additionalProperties: true,
};

function tierAPrompt(post: OllamaPost, customRules?: CustomRulePromptInput[]): string {
  const rules = customRules && customRules.length > 0
    ? [
        "",
        "自訂折疊規則：",
        ...customRules.map((rule, idx) => `r${idx + 1}: ${rule.prompt}`),
      ].join("\n")
    : "";
  return `你是 Truly 的即時分類器。請只輸出 JSON，不要 markdown。
用 0 到 1 分數判斷 Facebook 貼文：
- commercial: 明確販售、業配、折扣、團購、導購、私訊拿連結或合作推廣。
- political: 公共政策、政治人物、政黨、政府行動、主權或公共爭議。
- emotional: 情緒強度、憤怒、恐懼、煽動或強烈立場引導。
- personal: 個人生活、心得、經驗或日常分享。
若有自訂規則，請在 customRuleScores 內用 r1、r2... 給 0 到 1 分數。
所有文字判斷以台灣慣用繁體中文理解。${rules}

貼文：
${post.text.slice(0, 4000)}`;
}

export function normalizeGeminiNanoTierA(
  raw: string,
  customRules?: CustomRulePromptInput[],
): OllamaSingleResult {
  const parsed = parseJsonObject(raw);
  const scores = {
    commercial: clampUnit(parsed.commercial),
    political: clampUnit(parsed.political),
    emotional: clampUnit(parsed.emotional),
    personal: clampUnit(parsed.personal),
  };
  const result: OllamaSingleResult = { scores };
  const rawRuleScores = parsed.customRuleScores;
  if (customRules?.length && rawRuleScores && typeof rawRuleScores === "object" && !Array.isArray(rawRuleScores)) {
    const customRuleScores: Record<string, number> = {};
    customRules.forEach((rule, idx) => {
      customRuleScores[rule.id] = clampUnit((rawRuleScores as Record<string, unknown>)[`r${idx + 1}`]);
    });
    result.customRuleScores = customRuleScores;
  }
  return result;
}

async function createNanoSession(
  modalities: NanoInputModality[],
  responseConstraint: unknown,
): Promise<NanoLanguageModelSession> {
  const lm = nanoNamespace();
  if (!lm) throw new Error("LanguageModel unavailable");
  return lm.create(nanoOptions(modalities, responseConstraint));
}

export async function callGeminiNanoTierA(
  posts: OllamaPost[],
  customRules?: CustomRulePromptInput[],
): Promise<Record<string, OllamaSingleResult>> {
  const results: Record<string, OllamaSingleResult> = {};
  for (const post of posts) {
    let session: NanoLanguageModelSession | null = null;
    try {
      session = await createNanoSession(["text"], TIER_A_SCHEMA);
      const raw = await promptWithTimeout(
        session,
        tierAPrompt(post, customRules),
        GEMINI_NANO_TIER_A_TIMEOUT_MS,
      );
      results[post.id] = normalizeGeminiNanoTierA(raw, customRules);
    } finally {
      session?.destroy?.();
    }
  }
  return results;
}

const TIER_B_SCHEMA = {
  type: "object",
  properties: {
    commercial: { type: "number" },
    political: { type: "number" },
    emotional: { type: "number" },
    personal: { type: "number" },
    image_relevant: { type: "boolean" },
    image_status: {
      type: "string",
      enum: ["ok", "partial", "no_readable_text", "failed", "not_provided"],
    },
    image_count_seen: { type: "number" },
    ocr_image_count: { type: "number" },
    visible_text: { type: "array", items: { type: "string" } },
    risk: { type: "string", enum: ["low", "medium", "high"] },
    answer_zh_tw: { type: "string" },
    notes: { type: "array", items: { type: "string" } },
  },
  required: [
    "commercial",
    "political",
    "emotional",
    "personal",
    "image_relevant",
    "image_status",
    "image_count_seen",
    "ocr_image_count",
    "visible_text",
    "risk",
    "answer_zh_tw",
    "notes",
  ],
  additionalProperties: false,
};

function tierBPrompt(text: string, hasImages: boolean, outputLang?: Lang): string {
  const lang = tierBOutputLang(outputLang);
  if (lang === "en") {
    return `You are a Facebook post deep analyzer. The post may be written in any language. Always write answer_zh_tw and notes in English. Output JSON only; do not use markdown.
Tasks:
1. Judge commercial/political/emotional/personal scores.
2. If images are present, best-effort observe image content and readable text. If you cannot see or read something, do not invent it.
3. Write answer_zh_tw and notes in English even though the field name is kept for schema compatibility.
4. Do not judge the text as AI-generated just because the topic mentions AI. This schema only needs basic risk and image status.
5. If the post involves public controversy, fairly present stakeholder perspectives. Do not treat any side's claim as fact.

Image status:
- No image: image_relevant=false, image_status="not_provided", image_count_seen=0, ocr_image_count=0, visible_text=[]
- Image exists but no readable text: image_status="no_readable_text"
- Image is partially readable: image_status="partial"
- Image understanding failed but text can still be analyzed: image_status="failed"

Images attached now: ${hasImages ? "yes" : "no"}

Post text:
${text.slice(0, 6000)}`;
  }
  return `你是 Facebook 貼文深度分析器。請只輸出 JSON，不要 markdown。
任務：
1. 判斷 commercial/political/emotional/personal 四軸分數。
2. 若有圖片，best-effort 觀察圖片與可讀文字；看不到或讀不到也不要編造。
3. 用台灣慣用繁體中文寫 answer_zh_tw 與 notes。
4. 不要因為主題提到 AI 就判定文字是 AI 生成；這份 schema 只需要基礎風險與圖片狀態。
5. 若貼文涉及公共爭議，請公平呈現利害關係人觀點，不要將任何一方主張當作事實。

圖片狀態：
- 沒有圖片：image_relevant=false, image_status="not_provided", image_count_seen=0, ocr_image_count=0, visible_text=[]
- 有圖片但無可讀字：image_status="no_readable_text"
- 圖片部分可讀：image_status="partial"
- 圖片理解失敗但文字可分析：image_status="failed"

目前是否附圖：${hasImages ? "是" : "否"}

貼文文字：
${text.slice(0, 6000)}`;
}

async function dataUrlToBlob(dataUrl: string): Promise<Blob> {
  const resp = await fetch(dataUrl);
  return resp.blob();
}

async function buildNanoPromptInput(text: string, imageUrls: string[], outputLang?: Lang): Promise<unknown> {
  if (imageUrls.length === 0) return tierBPrompt(text, false, outputLang);
  const content: unknown[] = [{ type: "text", value: tierBPrompt(text, true, outputLang) }];
  for (const imageUrl of imageUrls.slice(0, 4)) {
    content.push({ type: "image", value: await dataUrlToBlob(imageUrl) });
  }
  return [{ role: "user", content }];
}

function normalizeGeminiNanoTierBRaw(
  parsed: Record<string, unknown>,
  imageCount: number,
  filteredImageCount = 0,
  outputLang?: Lang,
): DeepClassification {
  const lang = tierBOutputLang(outputLang);
  const maybeNormalizeTaiwanTerms = (text: string) => lang === "zh-TW" ? normalizeTaiwanTerms(text) : text;
  const visibleText = Array.isArray(parsed.visible_text)
    ? parsed.visible_text.filter((x): x is string => typeof x === "string").map(maybeNormalizeTaiwanTerms)
    : [];
  const notes = Array.isArray(parsed.notes)
    ? parsed.notes.filter((x): x is string => typeof x === "string").map(maybeNormalizeTaiwanTerms)
    : [];
  const risk = typeof parsed.risk === "string" ? parsed.risk : "low";
  const summary = typeof parsed.answer_zh_tw === "string"
    ? maybeNormalizeTaiwanTerms(parsed.answer_zh_tw).slice(0, 80)
    : "";
  const factualRisk = risk === "high" ? 0.9 : risk === "medium" ? 0.55 : 0.2;
  const manipulationRisk = Math.max(clampUnit(parsed.emotional), risk === "high" ? 0.65 : 0.2);
  const imageInsights = [...visibleText, ...notes]
    .slice(0, 4)
    .map((text, index) => ({ index: Math.min(index + 1, Math.max(1, imageCount)), observation: text.slice(0, 80) }));
  const rawForDeep = {
    sum: summary,
    txt_ai: 0,
    img_ai: 0,
    com: clampUnit(parsed.commercial),
    lq: risk === "high" ? 0.65 : risk === "medium" ? 0.35 : 0.1,
    fr: factualRisk,
    mr: manipulationRisk,
    fc: risk === "high",
    why: summary || notes[0] || "",
    imgs: imageInsights.map((x) => ({ i: x.index, note: x.observation })),
  };
  const deep = normalizeDeep(rawForDeep, GEMINI_NANO_PROVIDER, lang);
  if (imageCount > 0) {
    deep.imageStatus = parsed.image_status === "failed"
      ? "vision_format_failed"
      : "ok";
  } else {
    deep.imageStatus = filteredImageCount > 0 ? "filtered" : "no_images";
  }
  return deep;
}

export async function callGeminiNanoTierB(
  req: GeminiNanoTierBRequest,
): Promise<TierBDeepResult> {
  const imageUrls = req.imageUrls.slice(0, 4);
  let session: NanoLanguageModelSession | null = null;
  try {
    const modalities: NanoInputModality[] = imageUrls.length > 0 ? ["text", "image"] : ["text"];
    session = await createNanoSession(modalities, TIER_B_SCHEMA);
    const input = await buildNanoPromptInput(req.text, imageUrls, req.outputLang);
    const raw = await promptWithTimeout(
      session,
      input,
      req.timeoutMs ?? GEMINI_NANO_TIER_B_TIMEOUT_MS,
    );
    const parsed = parseJsonObject(raw);
    return {
      ok: true,
      deep: normalizeGeminiNanoTierBRaw(parsed, imageUrls.length, req.filteredImageCount, req.outputLang),
    };
  } catch (error) {
    const code: TierBDeepErrorCode =
      error instanceof DOMException && error.name === "AbortError"
        ? "tier_b_timeout"
        : error instanceof SyntaxError
          ? "tier_b_format_error"
          : "tier_b_failed";
    const detail = error instanceof Error ? error.message.slice(0, 160) : String(error).slice(0, 160);
    return {
      ok: false,
      deep: null,
      error: detail ? `${code}: ${detail}` : code,
    };
  } finally {
    session?.destroy?.();
  }
}

const READING_BRIEF_SCHEMA = {
  type: "object",
  properties: {
    bg: {
      type: "array",
      items: {
        type: "object",
        properties: {
          t: { type: "string" },
          why: { type: "string" },
          q: { type: "string" },
        },
        required: ["t", "why"],
        additionalProperties: false,
      },
    },
    claims: {
      type: "array",
      items: {
        type: "object",
        properties: {
          c: { type: "string" },
          why: { type: "string" },
          need: { type: "string" },
          q: { type: "string" },
        },
        required: ["c", "why", "need"],
        additionalProperties: false,
      },
    },
    qs: {
      type: "array",
      items: {
        type: "object",
        properties: {
          q: { type: "string" },
          kind: { type: "string", enum: ["understand", "context", "counter", "verify", "image", "source"] },
        },
        required: ["q", "kind"],
        additionalProperties: false,
      },
    },
    checks: {
      type: "array",
      items: {
        type: "object",
        properties: {
          label: { type: "string" },
          q: { type: "string" },
          why: { type: "string" },
        },
        required: ["label", "q", "why"],
        additionalProperties: false,
      },
    },
    note: { type: "string" },
  },
  required: ["bg", "claims", "qs", "checks"],
  additionalProperties: false,
};

export async function callGeminiNanoReadingBrief(
  req: GeminiNanoReadingBriefRequest,
): Promise<ReadingBrief | null> {
  let session: NanoLanguageModelSession | null = null;
  try {
    session = await createNanoSession(["text"], READING_BRIEF_SCHEMA);
    const raw = await promptWithTimeout(
      session,
      `${readingBriefSystemPrompt(req.outputLang)}\n\n${buildReadingBriefPrompt(req.event, req.outputLang)}`,
      req.timeoutMs ?? GEMINI_NANO_TIER_B_TIMEOUT_MS,
    );
    const parsed = parseJsonObject(raw);
    return normalizeReadingBrief(parsed, GEMINI_NANO_PROVIDER, req.outputLang);
  } catch {
    return null;
  } finally {
    session?.destroy?.();
  }
}
