// Pure text/data helpers for the sidepanel reading-brief surface. These build
// search queries, strip post deixis, dedupe brief rows, and decide image
// fallbacks from event data alone — no DOM, no module state, no chrome APIs —
// so they are unit-testable in isolation. DOM rendering and the score-based
// trigger predicates stay in sidepanel.ts.
import type { DashboardPostEvent, ReadingBrief } from "../lib/types";
import type { Lang } from "../lib/types";
import { t } from "../lib/i18n";
import { resolveStructuredPostContext } from "../lib/post-context";
import { cleanSearchContextText } from "./format";

export type ReadingBriefQuestionItem = NonNullable<ReadingBrief["qs"]>[number];

export const AI_IMAGE_READING_BRIEF_FALLBACK_THRESHOLD = 0.8;
const GEMINI_QUERY_CONTEXT_LIMIT = 420;
const URL_RE = /https?:\/\/[^\s)）\]】>"'「」]+/g;

export function googleSearchUrl(query: string): string {
  const url = new URL("https://www.google.com/search");
  url.searchParams.set("q", query);
  url.searchParams.set("udm", "50");
  return url.toString();
}

function appendCompactContext(parts: string[], raw: string | undefined, limit = 180): void {
  const text = cleanSearchContextText(raw || "", limit);
  if (!text) return;
  const normalized = text.replace(/\s+/g, "").toLowerCase();
  if (parts.some((part) => part.replace(/\s+/g, "").toLowerCase() === normalized)) return;
  parts.push(text);
}

function appendLabeledContext(parts: string[], label: string, raw: string | undefined, limit = 180, separator = "："): void {
  const text = cleanSearchContextText(raw || "", limit);
  if (!text) return;
  appendCompactContext(parts, `${label}${separator}${text}`, limit + label.length + separator.length);
}

function cleanQuestionUrl(raw: string | undefined): string | undefined {
  const input = raw?.trim();
  if (!input) return undefined;
  try {
    const url = new URL(input);
    for (const key of [...url.searchParams.keys()]) {
      if (key.startsWith("__") || ["fbclid", "mibextid", "rdid", "share_url"].includes(key)) {
        url.searchParams.delete(key);
      }
    }
    url.hash = "";
    return url.toString();
  } catch {
    return input;
  }
}

function firstExternalUrl(text: string | undefined): string | undefined {
  const matches = text?.match(URL_RE) ?? [];
  return cleanQuestionUrl(matches.find((raw) => {
    try {
      const host = new URL(raw).hostname.replace(/^www\./, "").toLowerCase();
      return host &&
        !host.endsWith("facebook.com") &&
        !host.endsWith("fbcdn.net") &&
        !host.endsWith("messenger.com");
    } catch {
      return false;
    }
  }));
}

function querySeparator(lang: Lang): string {
  return lang === "zh-TW" ? "：" : ": ";
}

function queryLabel(key: string, lang: Lang): string {
  return t(`sidepanel.dynamic.readingBrief.query.${key}`, lang);
}

export function questionSourceContext(event: DashboardPostEvent, lang: Lang = "zh-TW"): string {
  const postContext = resolveStructuredPostContext(event);
  const parts: string[] = [];
  const sourceTitle = postContext.linkPreview || postContext.sharedContent;
  const sourceUrl =
    firstExternalUrl([
      event.sharedAttachmentText,
      postContext.linkPreview,
      postContext.sharedContent,
      event.reshareOriginalText,
    ].filter(Boolean).join("\n")) ||
    cleanQuestionUrl(event.postUrl);
  if (sourceTitle) appendLabeledContext(parts, queryLabel("source", lang), sourceTitle, 180, querySeparator(lang));
  if (sourceUrl) appendCompactContext(parts, `${queryLabel("link", lang)}${querySeparator(lang)}${sourceUrl}`, 260);
  const summary = event.decision.deepClassification?.summary || event.summary;
  if (summary) appendLabeledContext(parts, queryLabel("summary", lang), summary, 180, querySeparator(lang));
  return parts.join(" ");
}

export function searchQuestionContext(event: DashboardPostEvent, _brief?: ReadingBrief, lang: Lang = "zh-TW"): string {
  const parts: string[] = [];
  appendCompactContext(parts, questionSourceContext(event, lang), GEMINI_QUERY_CONTEXT_LIMIT);
  let combined = "";
  for (const part of parts) {
    const next = combined ? `${combined}；${part}` : part;
    if (next.length > GEMINI_QUERY_CONTEXT_LIMIT) break;
    combined = next;
  }
  return combined;
}

export function stripQuestionDeixis(question: string): string {
  return question
    .replace(/這篇(?:貼文|文章|內容)?/g, "")
    .replace(/此(?:貼文|文章|內容)/g, "")
    .replace(/該(?:貼文|文章|內容)/g, "")
    .replace(/本(?:貼文|文章|內容)/g, "")
    .replace(/(?:這|此|該)則(?:貼文|內容)?/g, "")
    .replace(/^貼文(?:中|裡|內)?(?:的)?/, "")
    .replace(/^[的之]/, "")
    .replace(/\s+/g, " ")
    .replace(/^[：:，,、\s]+/, "")
    .trim();
}

export function readingBriefQuestionDisplay(question: string): string {
  const clean = stripQuestionDeixis(question);
  return clean || question.trim();
}

export function readingBriefQuestionSearchQuery(event: DashboardPostEvent, question: string, brief?: ReadingBrief, lang: Lang = "zh-TW"): string {
  const cleanQuestion = cleanSearchContextText(stripQuestionDeixis(question) || question, 120);
  const context = searchQuestionContext(event, brief, lang);
  if (!context) return cleanQuestion || question.trim();
  if (hasSearchArtifact(cleanQuestion)) return `${context} ${queryLabel("officialInfo", lang)}`;
  const combined = `${context} ${queryLabel("question", lang)}${querySeparator(lang)}${cleanQuestion} ${queryLabel("publicSources", lang)}`
    .replace(/\s+/g, " ")
    .trim();
  return combined || cleanQuestion || question.trim();
}

export function hasSearchArtifact(text: string): boolean {
  return /https?:\/\/|(?:^|\s)(?:curl|wget|npm|pnpm|brew|git)\s|fsSL|[a-z]{2,}:\/{1,2}|\.g(?:\s|$)/i.test(text);
}

export function needsAiImageReadingBriefQuestionFallback(event: DashboardPostEvent): boolean {
  return event.hasMedia &&
    (event.decision.deepClassification?.imageAiLikelihood ?? 0) >= AI_IMAGE_READING_BRIEF_FALLBACK_THRESHOLD;
}

export function hasLookupWorthyReadingBriefText(rows: string[], brief: ReadingBrief): boolean {
  const text = [...rows, brief.note ?? ""].join(" ");
  return /需查證|建議查證|政治議題|公共議題|政治討論|需要證據|事實風險|操弄風險|資訊來源|來源疑慮|各方觀點差異|官方(?:文件|文檔|資料|公告)|GitHub|原始碼/.test(text) &&
    !/無明顯(?:公共議題|高?事實風險|來源疑慮)|無(?:高?事實風險|公共議題|來源疑慮|查核必要|需查證|資訊品質疑慮)|無需(?:事實)?查核/.test(text);
}

export function readingBriefQuestionLabel(_event: DashboardPostEvent, lang: Lang = "zh-TW"): string {
  return t("sidepanel.dynamic.readingBrief.questions", lang);
}

export function createReadingBriefRowCollector(): {
  rows: string[];
  addRow: (text: string | undefined) => void;
} {
  const rows: string[] = [];
  const addRow = (text: string | undefined): void => {
    const row = (text || "").trim();
    if (!row) return;
    const normalized = row.replace(/\s+/g, "").toLowerCase();
    const duplicate = rows.some((existing) => {
      const base = existing.replace(/\s+/g, "").toLowerCase();
      if (base === normalized) return true;
      const min = Math.min(base.length, normalized.length);
      return min >= 8 && (base.includes(normalized) || normalized.includes(base));
    });
    if (!duplicate) rows.push(row);
  };
  return { rows, addRow };
}

export function readingBriefContextRows(brief: ReadingBrief): string[] {
  const { rows, addRow } = createReadingBriefRowCollector();
  const cleanTopic = (text: string | undefined): string => (text || "")
    .trim()
    .replace(/[：:，,、；;。.!！?？\s]+$/g, "")
    .replace(/[的之]$/g, "")
    .trim();
  for (const item of brief.bg ?? []) {
    const topic = cleanTopic(item.t);
    addRow(topic ? `${topic}：${item.why}` : item.why);
    break;
  }
  if (brief.note) addRow(brief.note);
  return rows.slice(0, 2);
}

export function aiImageReadingBriefQuestion(lang: Lang = "zh-TW"): ReadingBriefQuestionItem {
  return { q: t("sidepanel.dynamic.readingBrief.aiImageQuestion", lang), kind: "image" };
}
