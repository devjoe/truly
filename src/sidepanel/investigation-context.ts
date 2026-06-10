import type { DashboardPostEvent, DeepClassification } from "../lib/types";
import type { Lang } from "../lib/types";
import { t } from "../lib/i18n";
import { modelDisplayIdentity } from "../lib/model-display";
import { resolveStructuredPostContext } from "../lib/post-context";
import { summarizeZhtwFindingsForSidePanel } from "../lib/zhtw-review";
import { readingBriefContextRows } from "./reading-brief-text";
import { readingBriefVerificationRows } from "./reading-brief-visibility";

export interface InvestigationContext {
  author?: string;
  postUrl?: string;
  pageUrl?: string;
  capturedAt: string;
  contentType?: string;
  originalText?: string;
  originalTextLabel?: string;
  sharedText?: string;
  sharedTextLabel?: string;
  linkPreviewText?: string;
  imageTexts: string[];
  imageAltTexts: string[];
  originalAuthor?: string;
  summary?: string;
  signals: string[];
  recommendedAction?: string;
  imageObservations: string[];
  aiJudgements: string[];
  informationQuality: string[];
  reshareContext: string[];
  suggestedQuestions: string[];
  readingContext: string[];
  verificationItems: string[];
  languageNotes: string[];
  modelAttribution?: string;
  modelSignature: string[];
  handoffTask: string[];
}

export const META_AI_URL = "https://www.meta.ai/";

const COMMERCIAL_SIGNAL_THRESHOLD = 0.75;
const EMOTIONAL_SIGNAL_THRESHOLD = 0.6;
const EMOTIONAL_STRONG_SIGNAL_THRESHOLD = 0.75;
const DEFAULT_HANDOFF_LANG: Lang = "zh-TW";

function joinList(items: string[], lang: Lang): string {
  return items.join(lang === "zh-TW" ? "、" : ", ");
}

function notePrefix(lang: Lang): string {
  return lang === "zh-TW" ? "備註：" : "Note: ";
}

function trHandoff(key: string, lang: Lang, vars?: Record<string, string | number>): string {
  return t(`sidepanel.dynamic.handoff.${key}`, lang, vars);
}

function trimText(text: string | undefined, limit = 2000): string | undefined {
  const normalized = (text || "").replace(/\s+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  if (!normalized) return undefined;
  return normalized.length > limit ? `${normalized.slice(0, limit).trim()}……` : normalized;
}

function cleanHandoffUrl(raw: string | undefined): string | undefined {
  const input = raw?.trim();
  if (!input) return undefined;
  try {
    const url = new URL(input);
    for (const key of [...url.searchParams.keys()]) {
      if (
        key.startsWith("__") ||
        [
          "fbclid",
          "mibextid",
          "rdid",
          "share_url",
          "notif_id",
          "notif_t",
          "should_open_composer",
          "wp_discovery_redirect",
        ].includes(key)
      ) {
        url.searchParams.delete(key);
      }
    }
    url.hash = "";
    return url.toString();
  } catch {
    return input;
  }
}

function score(value: number | undefined): string | undefined {
  return typeof value === "number" ? value.toFixed(1) : undefined;
}

function formatDuration(ms: number | undefined, lang: Lang): string | undefined {
  if (typeof ms !== "number") return undefined;
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return t("content.headsup.seconds", lang, { value: (ms / 1000).toFixed(1) });
}

function dedupe(items: Array<string | undefined>): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of items) {
    const normalized = item?.trim();
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    out.push(normalized);
  }
  return out;
}

function contentType(event: DashboardPostEvent, lang: Lang): string | undefined {
  if (event.contentKind) {
    const label = trHandoff(`contentKind.${event.contentKind}`, lang);
    if (label !== `sidepanel.dynamic.handoff.contentKind.${event.contentKind}`) return label;
  }
  if (event.postType) {
    const label = trHandoff(`postType.${event.postType}`, lang);
    if (label !== `sidepanel.dynamic.handoff.postType.${event.postType}`) return label;
  }
  return undefined;
}

function qualitySignals(deep: DeepClassification | undefined, lang: Lang): string[] {
  const iq = deep?.informationQuality;
  if (!deep && !iq) return [];
  const rows: string[] = [];
  if (iq?.needsFactCheck || (iq?.factualRisk ?? 0) >= 0.7) rows.push(trHandoff("signal.factCheckSuggested", lang));
  const factual = score(iq?.factualRisk);
  if (factual && (iq?.factualRisk ?? 0) >= 0.7) rows.push(trHandoff("signal.factRisk", lang, { score: factual }));
  const manipulation = score(iq?.manipulationRisk);
  if (manipulation && (iq?.manipulationRisk ?? 0) >= 0.5) rows.push(trHandoff("signal.manipulationRisk", lang, { score: manipulation }));
  const lowQuality = score(deep?.lowQualitySignal);
  if (lowQuality && (deep?.lowQualitySignal ?? 0) >= 0.5) rows.push(trHandoff("signal.lowQuality", lang, { score: lowQuality }));
  if (iq?.explanation) rows.push(iq.explanation);
  return rows;
}

function aiJudgements(deep: DeepClassification | undefined, lang: Lang): string[] {
  if (!deep) return [];
  const rows: string[] = [];
  const textAi = score(deep.textAiLikelihood);
  if (textAi && (deep.textAiLikelihood ?? 0) >= 0.7) rows.push(trHandoff("signal.textAi", lang, { score: textAi }));
  const imageAi = score(deep.imageAiLikelihood);
  if (imageAi && (deep.imageAiLikelihood ?? 0) >= 0.7) rows.push(trHandoff("signal.imageAi", lang, { score: imageAi }));
  if (rows.length > 0 && deep.summary) rows.push(deep.summary);
  return rows;
}

function summaryFor(event: DashboardPostEvent): string | undefined {
  return trimText(event.summary || event.decision.deepClassification?.summary, 400);
}

function commercialSignalScore(event: DashboardPostEvent): number {
  const deep = event.decision.deepClassification;
  if (typeof deep?.commercialIntent === "number") return deep.commercialIntent;
  return event.decision.scores?.commercial ?? 0;
}

function mainSignals(event: DashboardPostEvent, lang: Lang): string[] {
  const scores = event.decision.scores ?? {};
  const deep = event.decision.deepClassification;
  const rows: Array<string | undefined> = [];
  if (event.isSponsored) rows.push(trHandoff("signal.sponsored", lang));
  if (commercialSignalScore(event) >= COMMERCIAL_SIGNAL_THRESHOLD) rows.push(trHandoff("signal.commercial", lang));
  if ((scores.political ?? 0) >= 0.6) rows.push(trHandoff("signal.political", lang));
  if ((scores.emotional ?? 0) >= EMOTIONAL_STRONG_SIGNAL_THRESHOLD) rows.push(trHandoff("signal.emotionalStrong", lang));
  else if ((scores.emotional ?? 0) >= EMOTIONAL_SIGNAL_THRESHOLD) rows.push(trHandoff("signal.emotional", lang));
  if ((scores.personal ?? 0) >= 0.7) rows.push(trHandoff("signal.personal", lang));
  if (deep?.informationQuality?.needsFactCheck || (deep?.informationQuality?.factualRisk ?? 0) >= 0.7) {
    rows.push(trHandoff("signal.needsCheck", lang));
  }
  const textAi = score(deep?.textAiLikelihood);
  if (textAi && (deep?.textAiLikelihood ?? 0) >= 0.7) rows.push(trHandoff("signal.textAi", lang, { score: textAi }));
  const imageAi = score(deep?.imageAiLikelihood);
  if (imageAi && (deep?.imageAiLikelihood ?? 0) >= 0.7) rows.push(trHandoff("signal.imageAi", lang, { score: imageAi }));
  return dedupe(rows);
}

function recommendedActionFor(event: DashboardPostEvent, lang: Lang): string | undefined {
  const deep = event.decision.deepClassification;
  if (deep?.informationQuality?.needsFactCheck || (deep?.informationQuality?.factualRisk ?? 0) >= 0.7) {
    return trHandoff("action.factCheck", lang);
  }
  if ((deep?.textAiLikelihood ?? 0) >= 0.7 || (deep?.imageAiLikelihood ?? 0) >= 0.7) {
    return trHandoff("action.ai", lang);
  }
  if (commercialSignalScore(event) >= COMMERCIAL_SIGNAL_THRESHOLD) {
    return trHandoff("action.commercial", lang);
  }
  return undefined;
}

function handoffTaskFor(event: DashboardPostEvent, lang: Lang): string[] {
  const deep = event.decision.deepClassification;
  const rows = [
    trHandoff("task.base", lang),
  ];
  if (deep?.informationQuality?.needsFactCheck || (deep?.informationQuality?.factualRisk ?? 0) >= 0.7) {
    rows.push(trHandoff("task.factCheck", lang));
  } else if ((deep?.textAiLikelihood ?? 0) >= 0.7 || (deep?.imageAiLikelihood ?? 0) >= 0.7) {
    rows.push(trHandoff("task.ai", lang));
  } else if (commercialSignalScore(event) >= COMMERCIAL_SIGNAL_THRESHOLD) {
    rows.push(trHandoff("task.commercial", lang));
  } else {
    rows.push(trHandoff("task.general", lang));
  }
  return rows;
}

function modelSignature(event: DashboardPostEvent, lang: Lang): string[] {
  const timing = event.decision.timing;
  const aModel = timing?.aModel ? modelDisplayIdentity(timing.aModel) : null;
  const bRawModel = timing?.bModel || event.decision.deepClassification?.model;
  const bModel = bRawModel ? modelDisplayIdentity(bRawModel) : null;
  const aMs = formatDuration(timing?.aMs, lang);
  const bMs = formatDuration(timing?.bMs, lang);
  const rows: string[] = [];

  if (aModel && bModel && aModel.key === bModel.key) {
    const parts = [trHandoff("model.single", lang, { model: aModel.label })];
    const durations = dedupe([
      aMs ? `${trHandoff("model.preReading", lang)} ${aMs}` : undefined,
      bMs ? `${trHandoff("model.summary", lang)} ${bMs}` : undefined,
    ]);
    if (durations.length > 0) parts.push(lang === "zh-TW" ? `（${durations.join("；")}）` : ` (${durations.join("; ")})`);
    rows.push(parts.join(""));
  } else {
    if (aModel) rows.push(`${trHandoff("model.preReading", lang)}${lang === "zh-TW" ? "：" : ": "}${aModel.label}${aMs ? (lang === "zh-TW" ? `（約 ${aMs}）` : ` (about ${aMs})`) : ""}`);
    if (bModel) rows.push(`${trHandoff("model.summary", lang)}${lang === "zh-TW" ? "：" : ": "}${bModel.label}${bMs ? (lang === "zh-TW" ? `（約 ${bMs}）` : ` (about ${bMs})`) : ""}`);
  }

  rows.push(trHandoff("model.note", lang));
  return rows;
}

function suggestedQuestions(event: DashboardPostEvent, lang: Lang): string[] {
  const deep = event.decision.deepClassification;
  const rows: Array<string | undefined> = [];
  if (deep?.informationQuality?.needsFactCheck || (deep?.informationQuality?.factualRisk ?? 0) >= 0.7) {
    rows.push(trHandoff("question.factCheck", lang));
  }
  if ((deep?.textAiLikelihood ?? 0) >= 0.7) rows.push(trHandoff("question.textAi", lang));
  if ((deep?.imageAiLikelihood ?? 0) >= 0.7 && event.hasMedia) rows.push(trHandoff("question.imageSupport", lang));
  if (commercialSignalScore(event) >= COMMERCIAL_SIGNAL_THRESHOLD) rows.push(trHandoff("question.commercial", lang));
  if ((deep?.lowQualitySignal ?? 0) >= 0.5) rows.push(trHandoff("question.quality", lang));
  if ((event.decision.scores?.emotional ?? 0) >= 0.6 || (deep?.informationQuality?.manipulationRisk ?? 0) >= 0.5) {
    rows.push(trHandoff("question.emotional", lang));
  }
  if ((event.decision.scores?.political ?? 0) >= 0.6) rows.push(trHandoff("question.neutral", lang));
  return dedupe(rows).slice(0, 4);
}

function readingContextLines(event: DashboardPostEvent, lang: Lang): string[] {
  const brief = event.readingBrief;
  if (!brief) {
    if (event.readingBriefPending) {
      return [trHandoff("reading.pending", lang)];
    }
    if (event.readingBriefError) {
      return [trHandoff("reading.error", lang, { error: event.readingBriefError })];
    }
    return [];
  }
  return readingBriefContextRows(brief);
}

function verificationLines(event: DashboardPostEvent): string[] {
  const brief = event.readingBrief;
  if (!brief) return [];
  return readingBriefVerificationRows(event, brief);
}

function modelAttribution(event: DashboardPostEvent, lang: Lang): string | undefined {
  const modelLabels = dedupe([
    event.decision.deepClassification?.model,
    event.decision.timing?.bModel,
    event.readingBrief?.model,
  ].map((model) => model ? modelDisplayIdentity(model).label : undefined));
  if (modelLabels.length === 0) return undefined;
  return trHandoff("modelAttribution", lang, { models: joinList(modelLabels, lang) });
}

function zhtwRuleTypeLabelForHandoff(ruleType: string, lang: Lang): string {
  if (ruleType === "translationese") return trHandoff("zhtw.rule.translationese", lang);
  if (ruleType === "cross_strait" || ruleType === "lexical" || ruleType === "confusable") return trHandoff("zhtw.rule.lexical", lang);
  if (ruleType === "punctuation") return trHandoff("zhtw.rule.punctuation", lang);
  if (ruleType === "grammar") return trHandoff("zhtw.rule.grammar", lang);
  if (ruleType === "ai_style") return trHandoff("zhtw.rule.ai_style", lang);
  return ruleType;
}

function languageNotes(event: DashboardPostEvent, lang: Lang): string[] {
  if (lang !== "zh-TW") return [];
  const review = event.zhtwReview ?? event.decision.zhtwReview;
  const findings = summarizeZhtwFindingsForSidePanel(review).slice(0, 8);
  return findings.map((finding) => {
    const source = Array.from(new Set(finding.segmentLabels.filter((label) => label !== "貼文文字"))).join(" / ");
    const types = Array.from(new Set(finding.ruleTypes.map((ruleType) => zhtwRuleTypeLabelForHandoff(ruleType, lang)))).join(" / ");
    const meta = [types, source].filter(Boolean).join(lang === "zh-TW" ? "；" : "; ");
    return meta ? `${finding.text}（${meta}）` : finding.text;
  });
}

export function buildPostInvestigationContext(event: DashboardPostEvent, lang: Lang = DEFAULT_HANDOFF_LANG): InvestigationContext {
  const deep = event.decision.deepClassification;
  const postContext = resolveStructuredPostContext(event);
  const originalText = trimText(postContext.isShare ? postContext.sharerComment : postContext.ownText);
  const sharedText = trimText(postContext.sharedContent, 1200);
  const linkPreviewText = trimText(postContext.linkPreview, 1000);
  const imageTexts = dedupe(postContext.imageTexts).slice(0, 4);
  const imageAltTexts = dedupe(postContext.imageAltTexts).slice(0, 4);
  const quality = qualitySignals(deep, lang);
  const reshareContext = dedupe([
    event.contentKind === "share_without_comment" ? trHandoff("reshare.noComment", lang) : undefined,
    event.contentKind === "reshare_with_comment" ? trHandoff("reshare.withComment", lang) : undefined,
    postContext.originalAuthor ? trHandoff("reshare.originalAuthor", lang, { author: postContext.originalAuthor }) : undefined,
  ]);

  return {
    author: event.authorName,
    postUrl: cleanHandoffUrl(event.postUrl),
    pageUrl: cleanHandoffUrl(event.pageUrl),
    capturedAt: event.timestamp,
    contentType: contentType(event, lang),
    originalText,
    originalTextLabel: postContext.isShare ? trHandoff("label.sharerComment", lang) : trHandoff("label.postText", lang),
    sharedText,
    sharedTextLabel: postContext.originalAuthor
      ? trHandoff("label.sharedContentBy", lang, { author: postContext.originalAuthor })
      : trHandoff("label.sharedContent", lang),
    linkPreviewText,
    imageTexts,
    imageAltTexts,
    originalAuthor: postContext.originalAuthor,
    summary: summaryFor(event),
    signals: mainSignals(event, lang),
    recommendedAction: recommendedActionFor(event, lang),
    imageObservations: dedupe((deep?.imageInsights ?? []).map((item) => item.observation)),
    aiJudgements: dedupe(aiJudgements(deep, lang)),
    informationQuality: dedupe(quality),
    reshareContext,
    suggestedQuestions: suggestedQuestions(event, lang),
    readingContext: readingContextLines(event, lang),
    verificationItems: verificationLines(event),
    languageNotes: languageNotes(event, lang),
    modelAttribution: modelAttribution(event, lang),
    modelSignature: modelSignature(event, lang),
    handoffTask: handoffTaskFor(event, lang),
  };
}

function firstMetaAiQuestion(context: InvestigationContext): string | undefined {
  const verificationItems = (context as { verificationItems?: string[] }).verificationItems ?? [];
  const readingBrief = (context as { readingBrief?: string[] }).readingBrief ?? [];
  return verificationItems[0] ||
    context.suggestedQuestions[0] ||
    readingBrief[0] ||
    context.recommendedAction;
}

function metaAiReferenceSignals(signals: string[], lang: Lang): string[] {
  const usefulSignals = new Set([
    trHandoff("signal.sponsored", lang),
    trHandoff("signal.commercial", lang),
    trHandoff("signal.political", lang),
    trHandoff("signal.emotionalStrong", lang),
    trHandoff("signal.emotional", lang),
    trHandoff("signal.needsCheck", lang),
  ]);
  return signals.filter((signal) => usefulSignals.has(signal));
}

function metaAiModelProvenance(context: InvestigationContext, lang: Lang): string | undefined {
  const attribution = (context as { modelAttribution?: string }).modelAttribution;
  if (attribution) return attribution;
  const models = dedupe(context.modelSignature
    .filter((row) => !row.startsWith(notePrefix(lang)))
    .map((row) => row
      .replace(lang === "zh-TW" ? /^(閱讀前提示|摘要|模型)：/ : /^(Pre-reading prompt|Summary|Model): /, "")
      .replace(/（.*?）/g, "")
      .replace(/\s\(.*?\)/g, "")
      .trim()));
  if (models.length === 0) return undefined;
  return trHandoff("modelAttribution", lang, { models: joinList(models, lang) });
}

function pushPromptField(lines: string[], label: string, value: string | undefined, lang: Lang): void {
  const text = value?.trim();
  if (!text) return;
  lines.push(`${label}${lang === "zh-TW" ? "：" : ": "}${text}`);
}

function pushPromptBulletField(lines: string[], label: string, value: string | undefined, lang: Lang): void {
  const text = value?.trim();
  if (!text) return;
  lines.push(`- ${label}${lang === "zh-TW" ? "：" : ": "}${text}`);
}

export function formatMetaAiAnalysisPrompt(context: InvestigationContext, lang: Lang = DEFAULT_HANDOFF_LANG): string {
  const signals = metaAiReferenceSignals(context.signals, lang);
  const lines = [
    trHandoff("meta.intro", lang),
    "",
    trHandoff("meta.linkInstruction", lang),
    "",
    trHandoff("meta.answer", lang),
    trHandoff("meta.answer1", lang),
    trHandoff("meta.answer2", lang),
    trHandoff("meta.answer3", lang),
    "",
    trHandoff("meta.locators", lang),
  ];
  pushPromptField(lines, trHandoff("meta.postUrl", lang), context.postUrl, lang);
  if (!context.postUrl) pushPromptField(lines, trHandoff("meta.pageUrl", lang), context.pageUrl, lang);
  pushPromptField(lines, trHandoff("meta.author", lang), context.author, lang);
  pushPromptField(lines, trHandoff("meta.contentType", lang), context.contentType, lang);
  lines.push("", trHandoff("meta.context", lang));
  pushPromptBulletField(lines, trHandoff("meta.summary", lang), trimText(context.summary, 240), lang);
  if (signals.length > 0) pushPromptBulletField(lines, trHandoff("meta.signals", lang), joinList(signals, lang), lang);
  pushPromptBulletField(lines, trHandoff("meta.question", lang), firstMetaAiQuestion(context), lang);
  pushPromptBulletField(lines, trHandoff("meta.source", lang), metaAiModelProvenance(context, lang), lang);
  lines.push("", trHandoff("meta.excerpt", lang));
  pushPromptField(lines, context.originalTextLabel || trHandoff("label.postExcerpt", lang), trimText(context.originalText, 600), lang);
  pushPromptField(lines, context.sharedTextLabel || trHandoff("label.sharedExcerpt", lang), trimText(context.sharedText, 600), lang);
  pushPromptField(lines, trHandoff("label.linkPreview", lang), trimText(context.linkPreviewText, 420), lang);
  lines.push("", trHandoff("meta.final", lang));
  return `${lines.join("\n").replace(/\n{3,}/g, "\n\n").trim()}\n`;
}

function pushSection(lines: string[], title: string, body: string[] | undefined): void {
  const filtered = (body ?? []).map((line) => line.trim()).filter(Boolean);
  if (filtered.length === 0) return;
  lines.push("", `## ${title}`);
  lines.push(...filtered);
}

function pushSubsection(lines: string[], title: string, body: string[] | undefined): void {
  const filtered = (body ?? []).map((line) => line.trim()).filter(Boolean);
  if (filtered.length === 0) return;
  lines.push("", `### ${title}`);
  lines.push(...filtered);
}

function pushRichSection(lines: string[], title: string, body: string[]): void {
  const hasContent = body.some((line) => line.trim());
  if (!hasContent) return;
  const trimmed = [...body];
  while (trimmed.length > 0 && !trimmed[0].trim()) trimmed.shift();
  while (trimmed.length > 0 && !trimmed[trimmed.length - 1].trim()) trimmed.pop();
  lines.push("", `## ${title}`, ...trimmed);
}

function bullet(items: string[]): string[] {
  return items.map((item) => `- ${item}`);
}

function yamlString(value: string | undefined): string {
  if (!value) return "\"\"";
  return JSON.stringify(value);
}

function yamlList(values: string[]): string[] {
  if (values.length === 0) return ["[]"];
  return values.map((value) => `  - ${yamlString(value)}`);
}

function frontmatter(context: InvestigationContext, lang: Lang): string[] {
  return [
    "---",
    "source: truly",
    "format: facebook-post-handoff",
    "version: 1",
    `captured_at: ${yamlString(context.capturedAt)}`,
    `author: ${yamlString(context.author)}`,
    `post_url: ${yamlString(context.postUrl)}`,
    `page_url: ${yamlString(context.pageUrl)}`,
    `content_type: ${yamlString(context.contentType)}`,
    "signals:",
    ...yamlList(context.signals),
    "models:",
    ...yamlList(context.modelSignature.filter((line) => !line.startsWith(notePrefix(lang)))),
    "---",
    "",
  ];
}

export function formatInvestigationMarkdown(context: InvestigationContext, lang: Lang = DEFAULT_HANDOFF_LANG): string {
  const lines: string[] = [
    ...frontmatter(context, lang),
    `# ${trHandoff("markdown.title", lang)}`,
    "",
    `## ${trHandoff("markdown.task", lang)}`,
    ...bullet(context.handoffTask),
    "",
    `## ${trHandoff("markdown.source", lang)}`,
  ];
  if (context.author) lines.push(`- ${trHandoff("markdown.author", lang)}${lang === "zh-TW" ? "：" : ": "}${context.author}`);
  lines.push(`- ${trHandoff("markdown.postUrl", lang)}${lang === "zh-TW" ? "：" : ": "}${context.postUrl || trHandoff("markdown.unavailable", lang)}`);
  lines.push(`- ${trHandoff("markdown.pageUrl", lang)}${lang === "zh-TW" ? "：" : ": "}${context.pageUrl || trHandoff("markdown.unavailable", lang)}`);
  lines.push(`- ${trHandoff("markdown.capturedAt", lang)}${lang === "zh-TW" ? "：" : ": "}${context.capturedAt}`);
  if (context.contentType) lines.push(`- ${trHandoff("markdown.contentType", lang)}${lang === "zh-TW" ? "：" : ": "}${context.contentType}`);

  const quick: string[] = [];
  if (context.summary) quick.push(`- ${trHandoff("markdown.quickSummary", lang)}${lang === "zh-TW" ? "：" : ": "}${context.summary}`);
  if (context.signals.length > 0) quick.push(`- ${trHandoff("markdown.mainSignals", lang)}${lang === "zh-TW" ? "：" : ": "}${joinList(context.signals, lang)}`);
  if (context.recommendedAction) quick.push(`- ${trHandoff("markdown.recommendedAction", lang)}${lang === "zh-TW" ? "：" : ": "}${context.recommendedAction}`);

  const judgementLines: string[] = [];
  if (context.modelAttribution) judgementLines.push(`_${context.modelAttribution}_`);
  pushSubsection(judgementLines, trHandoff("markdown.quickRead", lang), quick);
  pushSubsection(judgementLines, trHandoff("markdown.readingContext", lang), bullet(context.readingContext));
  pushSubsection(judgementLines, trHandoff("markdown.verification", lang), bullet(context.verificationItems));
  pushSubsection(judgementLines, trHandoff("markdown.questions", lang), bullet(context.suggestedQuestions));
  pushRichSection(lines, trHandoff("markdown.modelJudgement", lang), judgementLines);

  const evidenceLines: string[] = [];
  if (context.imageObservations.length > 0) {
    evidenceLines.push(`### ${trHandoff("markdown.imageObservation", lang)}`, ...bullet(context.imageObservations), "");
  }
  if (context.aiJudgements.length > 0) {
    evidenceLines.push(`### ${trHandoff("markdown.aiJudgement", lang)}`, ...bullet(context.aiJudgements), "");
  }
  if (context.informationQuality.length > 0) {
    evidenceLines.push(`### ${trHandoff("markdown.infoQuality", lang)}`, ...bullet(context.informationQuality), "");
  }
  if (context.reshareContext.length > 0) {
    evidenceLines.push(`### ${trHandoff("markdown.reshare", lang)}`, ...bullet(context.reshareContext));
  }
  pushSection(lines, trHandoff("markdown.evidence", lang), evidenceLines);

  pushSection(lines, trHandoff("markdown.language", lang), bullet(context.languageNotes));
  const sourceLines: string[] = [];
  if (context.originalText) {
    sourceLines.push(`### ${context.originalTextLabel || trHandoff("label.postText", lang)}`, context.originalText, "");
  }
  if (context.sharedText) {
    sourceLines.push(`### ${context.sharedTextLabel || trHandoff("label.sharedContent", lang)}`, context.sharedText, "");
  }
  if (context.linkPreviewText) {
    sourceLines.push(`### ${trHandoff("label.linkPreview", lang)}`, context.linkPreviewText, "");
  }
  if (context.imageTexts.length > 0) {
    sourceLines.push(`### ${trHandoff("label.imageText", lang)}`, ...bullet(context.imageTexts), "");
  }
  if (context.imageAltTexts.length > 0) {
    sourceLines.push(`### ${trHandoff("label.imageAlt", lang)}`, ...bullet(context.imageAltTexts), "");
  }
  pushSection(lines, trHandoff("markdown.original", lang), sourceLines);

  return `${lines.join("\n").replace(/\n{4,}/g, "\n\n\n").trim()}\n`;
}
