import type { DashboardPostEvent, ReadingBrief } from "../lib/types";
import type { Lang } from "../lib/types";
import { t } from "../lib/i18n";
import {
  duplicatesReadingBriefVerification,
  isActionableLowRiskQuestionText,
  isNaturalReadingBriefFollowUpQuestion,
  isReadingBriefFollowUpKind,
  isLowActionReadingBriefText,
  isLowValueReadingBriefQuestionText,
} from "../lib/reading-question-policy";
import {
  aiImageReadingBriefQuestion,
  createReadingBriefRowCollector,
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

export function visibleReadingBriefQuestions(
  event: DashboardPostEvent,
  brief: ReadingBrief,
  displayRows: string[],
  lang: Lang = "zh-TW",
): ReadingBriefQuestionItem[] {
  const verificationTexts = [
    ...(brief.claims ?? []).flatMap((item) => [item.c, item.need, item.q]),
    ...(brief.checks ?? []).flatMap((item) => [item.label, item.q, item.why]),
  ];
  const questions = (brief.qs ?? []).filter((item) =>
    isReadingBriefFollowUpKind(item.kind) &&
    isNaturalReadingBriefFollowUpQuestion(item.q, lang) &&
    !duplicatesReadingBriefVerification(item.q, verificationTexts) &&
    !isLowValueReadingBriefQuestionText(item.q));
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
    return [];
  } else {
    return questions
      .filter((item) => isActionableLowRiskQuestion(event, item, brief))
      .slice(0, 1);
  }
}

export function readingBriefFallbackRows(event: DashboardPostEvent, lang: Lang = "zh-TW"): string[] {
  if (!isReadingBriefLookupWorthy(event)) return [];
  return [t("sidepanel.dynamic.readingBrief.fallbackRow", lang)];
}
