import type { DashboardPostEvent, ReadingBrief } from "../lib/types";
import type { Lang } from "../lib/types";
import { t } from "../lib/i18n";
import {
  isActionableLowRiskQuestionText,
  isLowActionReadingBriefText,
  isLowValueReadingBriefQuestionText,
} from "../lib/reading-question-policy";
import { cleanPreviewText } from "./format";
import {
  aiImageReadingBriefQuestion,
  createReadingBriefRowCollector,
  hasLookupWorthyReadingBriefText,
  needsAiImageReadingBriefQuestionFallback,
  type ReadingBriefQuestionItem,
} from "./reading-brief-text";
import { sidepanelCommercialScore } from "./reading-workspace-decision";

export function isReadingBriefLookupWorthy(event: DashboardPostEvent): boolean {
  const scores = event.decision.scores ?? {};
  const deep = event.decision.deepClassification;
  const iq = deep?.informationQuality;
  const commercial = sidepanelCommercialScore(event);
  return Boolean(
    iq?.needsFactCheck ||
    (iq?.factualRisk ?? 0) >= 0.5 ||
    (scores.political ?? 0) >= 0.6 ||
    commercial >= 0.6 ||
    (deep?.textAiLikelihood ?? 0) >= 0.8 ||
    (deep?.imageAiLikelihood ?? 0) >= 0.8 ||
    (deep?.lowQualitySignal ?? 0) >= 0.6 ||
    (iq?.manipulationRisk ?? 0) >= 0.6
  );
}

function needsReadingBriefQuestionFallback(event: DashboardPostEvent): boolean {
  const scores = event.decision.scores ?? {};
  const deep = event.decision.deepClassification;
  const iq = deep?.informationQuality;
  const commercial = sidepanelCommercialScore(event);
  return Boolean(
    iq?.needsFactCheck ||
    (iq?.factualRisk ?? 0) >= 0.5 ||
    (scores.political ?? 0) >= 0.6 ||
    commercial >= 0.6 ||
    (deep?.lowQualitySignal ?? 0) >= 0.6 ||
    (iq?.manipulationRisk ?? 0) >= 0.6
  );
}

export function readingBriefVerificationRows(event: DashboardPostEvent, brief: ReadingBrief, lang: Lang = "zh-TW"): string[] {
  if (!isReadingBriefLookupWorthy(event)) return [];
  const { rows, addRow } = createReadingBriefRowCollector();
  for (const item of brief.claims ?? []) {
    addRow(item.need
      ? t("sidepanel.dynamic.readingBrief.needEvidence", lang, {
        claim: item.c,
        need: item.need,
      })
      : item.c);
    if (rows.length >= 3) return rows;
  }
  for (const item of brief.checks ?? []) {
    addRow(`${item.label}：${item.q}`);
    if (rows.length >= 3) return rows;
  }
  return rows.slice(0, 3);
}

function isActionableLowRiskQuestion(event: DashboardPostEvent, question: ReadingBriefQuestionItem, brief: ReadingBrief): boolean {
  const text = [
    brief.note,
    event.decision.deepClassification?.summary,
    event.text,
  ].join(" ");
  return isActionableLowRiskQuestionText([question.q, question.kind].join(" "), text);
}

function fallbackReadingBriefQuestion(
  event: DashboardPostEvent,
  brief: ReadingBrief,
  displayRows: string[],
  lang: Lang,
): ReadingBriefQuestionItem | null {
  const candidates = [
    ...(brief.claims ?? []).map((item) => item.q),
    ...(brief.checks ?? []).map((item) => item.q),
    ...(brief.bg ?? []).map((item) => item.q),
  ];
  for (const candidate of candidates) {
    const q = (candidate || "").trim();
    if (q && !isLowValueReadingBriefQuestionText(q)) return { q, kind: "verify" };
  }
  const anchor = event.decision.deepClassification?.summary || displayRows[0] || event.summary || event.text;
  const topic = cleanPreviewText((anchor || "").replace(/^待確認：/, ""), 54).replace(/[。！？!?；;：:]+$/, "");
  if (!topic || topic.length < 4) return null;
  return { q: t("sidepanel.dynamic.readingBrief.fallbackQuestion", lang, { topic }), kind: "verify" };
}

export function visibleReadingBriefQuestions(
  event: DashboardPostEvent,
  brief: ReadingBrief,
  displayRows: string[],
  lang: Lang = "zh-TW",
): ReadingBriefQuestionItem[] {
  const questions = (brief.qs ?? []).filter((item) => !isLowValueReadingBriefQuestionText(item.q));
  const aiImageFallback = needsAiImageReadingBriefQuestionFallback(event)
    ? aiImageReadingBriefQuestion(lang)
    : null;
  const lookupWorthy = isReadingBriefLookupWorthy(event);
  if (lookupWorthy && aiImageFallback) {
    if (questions.length > 0) return questions;
    return [aiImageFallback];
  }
  const briefText = [...displayRows, brief.note ?? ""].join(" ");
  if (isLowActionReadingBriefText(briefText)) return [];
  if (lookupWorthy) {
    if (questions.length > 0) return questions;
    if (hasLookupWorthyReadingBriefText(displayRows, brief)) {
      const fallback = fallbackReadingBriefQuestion(event, brief, displayRows, lang);
      return fallback ? [fallback] : [];
    }
  } else {
    if (questions.length === 0 && hasLookupWorthyReadingBriefText(displayRows, brief)) {
      const fallback = fallbackReadingBriefQuestion(event, brief, displayRows, lang);
      return fallback ? [fallback] : [];
    }
    return questions
      .filter((item) => isActionableLowRiskQuestion(event, item, brief))
      .slice(0, 1);
  }
  if (!needsReadingBriefQuestionFallback(event)) return [];
  const fallback = aiImageFallback ?? fallbackReadingBriefQuestion(event, brief, displayRows, lang);
  return fallback ? [fallback] : [];
}

export function readingBriefFallbackRows(event: DashboardPostEvent, lang: Lang = "zh-TW"): string[] {
  if (!isReadingBriefLookupWorthy(event)) return [];
  return [t("sidepanel.dynamic.readingBrief.fallbackRow", lang)];
}
