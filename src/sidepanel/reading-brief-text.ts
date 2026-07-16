// Pure text/data helpers for the sidepanel reading-brief surface. These build
// search queries, strip post deixis, dedupe brief rows, and decide image
// fallbacks from event data alone — no DOM, no module state, no chrome APIs —
// so they are unit-testable in isolation. DOM rendering and the score-based
// trigger predicates stay in sidepanel.ts.
import type {
  DashboardPostEvent,
  ReadingBrief,
  ReadingBriefQuestionKind,
} from "../lib/types";
import type { Lang } from "../lib/types";
import { t } from "../lib/i18n";
import { resolveStructuredPostContext } from "../lib/post-context";
import { cleanSearchContextText } from "./format";

export type ReadingBriefQuestionItem = NonNullable<ReadingBrief["qs"]>[number];

export interface ReadingBriefQuestionActionSource {
  title?: string;
  summary?: string;
  url?: string;
}

/**
 * One bounded semantic projection for every follow-up-question action.
 * `agentTask` is contract-only: no runtime currently sends it to an agent.
 */
export interface ReadingBriefQuestionActionPayload {
  version: 1;
  modelText: string;
  displayText: string;
  copyText: string;
  googleQuery: string;
  aiModePrompt: string;
  agentTask: {
    version: 1;
    type: "reading_follow_up";
    kind: ReadingBriefQuestionKind;
    question: string;
    context?: string;
    sourceUrl?: string;
  };
}

export const AI_IMAGE_READING_BRIEF_FALLBACK_THRESHOLD = 0.8;
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
    if (!/^https?:$/i.test(url.protocol) || url.username || url.password || url.port) return undefined;
    const hostname = url.hostname.replace(/^\[|\]$/g, "").replace(/\.$/, "").toLowerCase();
    if (
      !hostname.includes(".") ||
      hostname.includes(":") ||
      /(?:^|\.)(?:localhost|local|internal|lan|home|test|invalid|example|onion)$/.test(hostname) ||
      /^(?:0|10|127|169\.254|192\.168)\./.test(hostname) ||
      /^172\.(?:1[6-9]|2\d|3[01])\./.test(hostname)
    ) return undefined;
    url.search = "";
    url.hash = "";
    const output = url.toString();
    return Array.from(output).length <= 260 ? output : undefined;
  } catch {
    return undefined;
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

function boundedActionQuestion(value: string, limit: number): string {
  return Array.from(value.trim().replace(/\s+/g, " ")).slice(0, limit).join("");
}

function prependOptionalContext(
  context: string,
  requiredTail: string,
  limit: number,
  separator: " " | "\n",
): string {
  const tail = boundedActionQuestion(requiredTail, limit);
  const remaining = limit - Array.from(tail).length - Array.from(separator).length;
  if (remaining <= 0) return tail;
  const prefix = boundedActionQuestion(context, remaining);
  return prefix ? `${prefix}${separator}${tail}` : tail;
}

function actionSourceContext(source: ReadingBriefQuestionActionSource, lang: Lang, includeUrl: boolean): string {
  const parts: string[] = [];
  if (source.title) appendLabeledContext(parts, queryLabel("source", lang), source.title.replace(URL_RE, ""), 180, querySeparator(lang));
  if (includeUrl && source.url) {
    appendCompactContext(parts, `${queryLabel("link", lang)}${querySeparator(lang)}${cleanQuestionUrl(source.url)}`, 260);
  }
  if (source.summary) appendLabeledContext(parts, queryLabel("summary", lang), source.summary.replace(URL_RE, ""), 180, querySeparator(lang));
  return parts.join(" ");
}

export function readingBriefQuestionActionSource(event: DashboardPostEvent): ReadingBriefQuestionActionSource {
  const postContext = resolveStructuredPostContext(event);
  const sourceTitle = postContext.linkPreview || postContext.sharedContent;
  const sourceUrl =
    firstExternalUrl([
      event.sharedAttachmentText,
      postContext.linkPreview,
      postContext.sharedContent,
      event.reshareOriginalText,
    ].filter(Boolean).join("\n")) ||
    cleanQuestionUrl(event.postUrl);
  const summary = event.decision.deepClassification?.summary || event.summary;
  return {
    ...(sourceTitle ? { title: sourceTitle } : {}),
    ...(summary ? { summary } : {}),
    ...(sourceUrl ? { url: sourceUrl } : {}),
  };
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

export function buildReadingBriefQuestionActionPayload(input: {
  question: string;
  kind: ReadingBriefQuestionKind;
  lang?: Lang;
  source?: ReadingBriefQuestionActionSource;
}): ReadingBriefQuestionActionPayload {
  const lang = input.lang ?? "zh-TW";
  const modelText = boundedActionQuestion(input.question, 140);
  const displayText = boundedActionQuestion(readingBriefQuestionDisplay(modelText), 140) || modelText;
  const sourceTitle = cleanSearchContextText(input.source?.title?.replace(URL_RE, "") ?? "", 180);
  const sourceSummary = cleanSearchContextText(input.source?.summary?.replace(URL_RE, "") ?? "", 180);
  const sourceUrl = cleanQuestionUrl(input.source?.url);
  const source: ReadingBriefQuestionActionSource = {
    ...(sourceTitle ? { title: sourceTitle } : {}),
    ...(sourceSummary ? { summary: sourceSummary } : {}),
    ...(sourceUrl ? { url: sourceUrl } : {}),
  };
  const portableContext = actionSourceContext(source, lang, false);
  const fullContext = actionSourceContext(source, lang, true);
  const questionText = `${queryLabel("question", lang)}${querySeparator(lang)}${displayText}`;
  const copyText = portableContext
    ? prependOptionalContext(portableContext, questionText, 520, "\n")
    : displayText;
  const googleContext = cleanSearchContextText(source.title || source.summary || "", 120);
  const googleQuery = prependOptionalContext(googleContext, displayText, 240, " ");
  const aiModeTail = `${questionText} ${queryLabel("publicSources", lang)}`;
  const aiModePrompt = prependOptionalContext(fullContext, aiModeTail, 760, " ");
  return {
    version: 1,
    modelText,
    displayText,
    copyText,
    googleQuery,
    aiModePrompt,
    agentTask: {
      version: 1,
      type: "reading_follow_up",
      kind: input.kind,
      question: displayText,
      ...(portableContext ? { context: portableContext } : {}),
      ...(source.url ? { sourceUrl: source.url } : {}),
    },
  };
}

export function buildEventReadingBriefQuestionActionPayload(
  event: DashboardPostEvent,
  question: ReadingBriefQuestionItem,
  lang: Lang = "zh-TW",
): ReadingBriefQuestionActionPayload {
  return buildReadingBriefQuestionActionPayload({
    question: question.q,
    kind: question.kind,
    lang,
    source: readingBriefQuestionActionSource(event),
  });
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
