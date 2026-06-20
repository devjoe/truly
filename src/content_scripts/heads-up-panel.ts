// Unified "預防針" (heads-up) panel — replaces both the in-heading
// prelude badge and the below-post score panel. Mounted inside a stable
// .truly-headsup-host first child of [data-truly-id] so users see classification
// cues BEFORE reading the post body, and so future Shadow DOM migration has
// a durable outer DOM contract.
//
// Visual style targets FB's gray sub-chrome (the bar style used for
// "Suggested for you · Why am I seeing this?" hints) so the panel
// reads as part of the page rather than as an extension overlay.

import type {
  ClassificationScores,
  DeepClassification,
  FilterDecision,
  Lang,
  PostData,
  ThemeMode,
  ZhtwReview,
} from "../lib/types";
import { t } from "../lib/i18n";
import { normalizeThemeMode } from "../lib/theme-mode";
import { dedupeModelDisplayNames, modelDisplayIdentity } from "../lib/model-display";
import { defaultModelForProvider } from "../lib/model-source-config";
import { shouldRenderPersonalContextChip } from "../lib/heads-up-chip-policy";
import { HEADS_UP_CSS } from "./heads-up-styles";
import {
  formatZhtwTermExplanation,
  shouldShowZhtwInHeadsUp,
  summarizeZhtwTermsForHeadsUp,
  zhtwHeadsUpIssueCount,
  zhtwTermDisplayGroup,
} from "../lib/zhtw-review";

type Severity = "high" | "mid" | "low" | "pending";

const SEVERITY_CLASS: Record<Severity, string> = {
  high: "truly-headsup-high",
  mid: "truly-headsup-mid",
  low: "truly-headsup-low",
  pending: "truly-headsup-pending",
};

const HEADSUP_HOST_CLASS = "truly-headsup-host";
const HEADSUP_PLACEHOLDER_CLASS = "truly-headsup-placeholder";
const SHADOW_STYLE_ID = "truly-headsup-shadow-styles";
const SHADOW_HEADS_UP_CSS = HEADS_UP_CSS.replace(/\bhtml\.truly-fb-dark\s+/g, ":host(.truly-fb-dark) ");
const lastRenderedSeverity = new Map<string, Severity>();

const ICON_COMMERCIAL = "💰";
const ICON_POLITICAL = "🗳";
const ICON_EMOTIONAL = "🎭";
const ICON_EMOTIONAL_STRONG = "🎭+";
const ICON_AI = "🤖";
const ICON_RULE = "🔍";
const ICON_FACT_CHECK = "🔎";
const ICON_INSUFFICIENT = "📭";
const ICON_LOW_QUALITY = "📉";
const ICON_RAGEBAIT = "🔥";
const TIER_B_SUMMARY_THRESHOLD = 0.5;
const COMMERCIAL_HEADLINE_THRESHOLD = 0.75;
const EMOTIONAL_HEADLINE_THRESHOLD = 0.5;
const EMOTIONAL_STRONG_HEADLINE_THRESHOLD = 0.75;
const AI_CHIP_THRESHOLD = 0.7;
const AI_HEADLINE_THRESHOLD = 0.8;
const FACT_CHECK_HEADLINE_THRESHOLD = 0.7;
const PERSONAL_CONTEXT_THRESHOLD = 0.7;
const PERSONAL_CONTEXT_SUPPRESS_THRESHOLD = 0.75;

const SIGNAL_SCORE_CATEGORY: Record<string, keyof ClassificationScores> = {
  [ICON_COMMERCIAL]: "commercial",
  [ICON_POLITICAL]: "political",
  [ICON_EMOTIONAL]: "emotional",
  [ICON_EMOTIONAL_STRONG]: "emotional",
};

const SIGNAL_LABEL_KEY: Record<string, string> = {
  [ICON_COMMERCIAL]: "content.headsup.signal.commercial",
  [ICON_POLITICAL]: "content.headsup.signal.political",
  [ICON_EMOTIONAL]: "content.headsup.signal.emotional",
  [ICON_EMOTIONAL_STRONG]: "content.headsup.signal.emotionalStrong",
  [ICON_AI]: "content.headsup.signal.ai",
  [ICON_RULE]: "content.headsup.signal.rule",
  [ICON_FACT_CHECK]: "content.headsup.signal.factCheck",
  [ICON_INSUFFICIENT]: "content.headsup.signal.insufficient",
  [ICON_LOW_QUALITY]: "content.headsup.signal.lowQuality",
  [ICON_RAGEBAIT]: "content.headsup.signal.ragebait",
};

const SIGNAL_TOOLTIP_KEY: Record<string, string> = {
  [ICON_COMMERCIAL]: "content.headsup.tooltip.commercial",
  [ICON_POLITICAL]: "content.headsup.tooltip.political",
  [ICON_EMOTIONAL]: "content.headsup.tooltip.emotional",
  [ICON_EMOTIONAL_STRONG]: "content.headsup.tooltip.emotionalStrong",
  [ICON_AI]: "content.headsup.tooltip.ai",
  [ICON_RULE]: "content.headsup.tooltip.rule",
  [ICON_FACT_CHECK]: "content.headsup.tooltip.factCheck",
  [ICON_INSUFFICIENT]: "content.headsup.tooltip.insufficient",
  [ICON_LOW_QUALITY]: "content.headsup.tooltip.lowQuality",
  [ICON_RAGEBAIT]: "content.headsup.tooltip.ragebait",
};

const DEEP_SIGNAL_TOOLTIP_KEY: Record<string, string> = {
  factRisk: "content.headsup.tooltip.factRisk",
  manipulationRisk: "content.headsup.tooltip.manipulationRisk",
  lowQuality: "content.headsup.tooltip.lowQualityShort",
};

interface HeadsUpRenderOptions {
  lang?: Lang;
  force?: boolean;
}

function signalLabel(icon: string, lang: Lang): string {
  const key = SIGNAL_LABEL_KEY[icon];
  return key ? t(key, lang) : "";
}

function signalTooltip(icon: string, lang: Lang): string {
  const key = SIGNAL_TOOLTIP_KEY[icon];
  return key ? t(key, lang) : "";
}

let cachedOllamaModel = defaultModelForProvider("ollama", "reading-prompt");
let headsUpThemeMode: ThemeMode = "auto";
let headsUpIdSeq = 0;
export function setOllamaModel(model: string): void {
  cachedOllamaModel = model;
}

export function setHeadsUpThemeMode(mode: ThemeMode): void {
  headsUpThemeMode = normalizeThemeMode(mode);
  syncAllHeadsUpHostThemes();
}

function severityRank(severity: Severity): number {
  if (severity === "high") return 3;
  if (severity === "mid") return 2;
  if (severity === "low") return 1;
  return 0;
}

function shouldAnimateSeverityArrival(article: HTMLElement, post: PostData, severity: Severity): boolean {
  const key = article.dataset.trulyStableId || article.dataset.trulyId || post.id;
  if (!key) return severity !== "pending";
  const previous = lastRenderedSeverity.get(key);
  lastRenderedSeverity.set(key, severity);
  if (severity === "pending") return false;
  if (!previous) return true;
  return severityRank(severity) > severityRank(previous);
}

function displayModelName(raw: string): string {
  return modelDisplayIdentity(raw).label;
}

function buildJudgementModelNames(decision: FilterDecision): string[] {
  return dedupeModelDisplayNames([
    decision.timing?.aModel,
    decision.timing?.bModel,
    decision.deepClassification?.model,
  ]);
}

function parseRgb(raw: string): [number, number, number, number] | null {
  const m = raw.match(/rgba?\(\s*(\d+),\s*(\d+),\s*(\d+)(?:,\s*([0-9.]+))?/);
  if (!m) return null;
  return [Number(m[1]), Number(m[2]), Number(m[3]), m[4] === undefined ? 1 : Number(m[4])];
}

function isDarkColor(raw: string): boolean | null {
  const rgba = parseRgb(raw);
  if (!rgba) return null;
  const [r, g, b, a] = rgba;
  if (a === 0) return null;
  const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return luminance < 128;
}

function formatSeconds(ms: number, lang: Lang): string {
  return t("content.headsup.seconds", lang, { value: (ms / 1000).toFixed(1) });
}

function buildCompletionTooltip(
  label: string,
  model: string | undefined,
  ms: number | undefined,
  lang: Lang,
): string {
  const parts: string[] = [];
  if (model) parts.push(t("content.headsup.model", lang, { model: displayModelName(model) }));
  if (typeof ms === "number") parts.push(t("content.headsup.elapsed", lang, { elapsed: formatSeconds(ms, lang) }));
  const done = t("content.headsup.done", lang, { label });
  if (parts.length === 0) return done;
  return lang === "zh-TW" ? `${done}${parts.join("，")}。` : `${done} ${parts.join(", ")}.`;
}

function buildAnalysisCompletionTooltip(decision: FilterDecision, lang: Lang): string {
  const tierBModel = decision.timing?.bModel || decision.deepClassification?.model;
  const lines = [
    buildCompletionTooltip(t("content.headsup.readingPrompt", lang), decision.timing?.aModel, decision.timing?.aMs, lang),
    buildCompletionTooltip(t("content.headsup.summary", lang), tierBModel, decision.timing?.bMs, lang),
  ];
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Severity classification (logic preserved from former prelude-badge.ts)
// ---------------------------------------------------------------------------

interface HeadsUpSignals {
  severity: Severity;
  tierAIcons: string[];
  tierBIcons: string[];
  topIcons: string[];
  ruleHits: number;
  personalContext: boolean;
}

type SignalCandidate = { score: number; icon: string };

function tierBSuppressesTierA(tierBIcon: string, tierAIcon: string): boolean {
  // Suppression is semantic, not numeric. Same-label Tier B results do not add
  // user-facing information, so they only update detail/score authority.
  if (tierBIcon === tierAIcon) return false;
  // Tier B "情緒挑動" is a more specific form of Tier A emotion labels.
  if (tierBIcon === ICON_RAGEBAIT && (tierAIcon === ICON_EMOTIONAL || tierAIcon === ICON_EMOTIONAL_STRONG)) return true;
  return false;
}

function maxDefined(values: Array<number | undefined>): number | undefined {
  const nums = values.filter((v): v is number => typeof v === "number");
  return nums.length > 0 ? Math.max(...nums) : undefined;
}

function deepAiLikelihood(deep: DeepClassification | undefined): number | undefined {
  if (!deep) return undefined;
  const split = maxDefined([
    shouldDisplayDeepTextAi(deep) ? deep.textAiLikelihood : undefined,
    shouldDisplayDeepImageAi(deep) ? deep.imageAiLikelihood : undefined,
  ]);
  if (split !== undefined) return split;
  if (deep.textAiLikelihood !== undefined || deep.imageAiLikelihood !== undefined) return undefined;
  return deep.aiLikelihood;
}

export function classifyHeadsUpSignals(decision: FilterDecision | undefined): HeadsUpSignals {
  if (!decision) return { severity: "pending", tierAIcons: [], tierBIcons: [], topIcons: [], ruleHits: 0, personalContext: false };
  if (isTierAInFlight(decision)) return { severity: "pending", tierAIcons: [], tierBIcons: [], topIcons: [], ruleHits: 0, personalContext: false };

  const scores = decision.scores || {};
  const deep = decision.deepClassification;
  const aiLikelihood = deepAiLikelihood(deep) ?? 0;
  const commercialIntent = Math.max(scores.commercial ?? 0, deep?.commercialIntent ?? 0);
  const lowQuality = deep?.lowQualitySignal ?? 0;
  const manipulationRisk = deep?.informationQuality?.manipulationRisk ?? 0;
  const factualRisk = deep?.informationQuality?.factualRisk ?? 0;
  const factCheckScore = Math.max(factualRisk, deep?.informationQuality?.needsFactCheck ? 0.85 : 0);
  const ruleHits = decision.customRuleScores
    ? Object.entries(decision.customRuleScores).filter(([, v]) => typeof v === "number" && v >= 0.5).length
    : 0;

  const tierACandidates: SignalCandidate[] = [];
  const tierBCandidates: SignalCandidate[] = [];
  if ((scores.commercial ?? 0) >= COMMERCIAL_HEADLINE_THRESHOLD) tierACandidates.push({ score: scores.commercial ?? 0, icon: ICON_COMMERCIAL });
  if ((scores.political ?? 0) >= 0.5) tierACandidates.push({ score: scores.political ?? 0, icon: ICON_POLITICAL });
  if ((scores.emotional ?? 0) >= EMOTIONAL_STRONG_HEADLINE_THRESHOLD) {
    tierACandidates.push({ score: scores.emotional ?? 0, icon: ICON_EMOTIONAL_STRONG });
  } else if ((scores.emotional ?? 0) >= EMOTIONAL_HEADLINE_THRESHOLD) {
    tierACandidates.push({ score: scores.emotional ?? 0, icon: ICON_EMOTIONAL });
  }
  if (ruleHits >= 1) tierACandidates.push({ score: 0.85, icon: ICON_RULE });
  if (decision.insufficientText) tierACandidates.push({ score: 0.5, icon: ICON_INSUFFICIENT });

  if ((deep?.commercialIntent ?? 0) >= COMMERCIAL_HEADLINE_THRESHOLD) tierBCandidates.push({ score: deep?.commercialIntent ?? 0, icon: ICON_COMMERCIAL });
  if (factCheckScore >= FACT_CHECK_HEADLINE_THRESHOLD) tierBCandidates.push({ score: factCheckScore, icon: ICON_FACT_CHECK });
  if ((deepAiLikelihood(deep) ?? 0) >= AI_HEADLINE_THRESHOLD) tierBCandidates.push({ score: deepAiLikelihood(deep) ?? 0, icon: ICON_AI });
  if (lowQuality >= TIER_B_SUMMARY_THRESHOLD) tierBCandidates.push({ score: lowQuality, icon: ICON_LOW_QUALITY });
  if (manipulationRisk >= 0.8) tierBCandidates.push({ score: manipulationRisk, icon: ICON_RAGEBAIT });

  tierACandidates.sort((a, b) => b.score - a.score);
  tierBCandidates.sort((a, b) => b.score - a.score);
  const tierBTop = tierBCandidates.slice(0, 2);
  const tierATop = tierACandidates
    .filter((tierA) => {
      const strongestSuppressor = Math.max(
        ...tierBTop
          .filter((tierB) => tierBSuppressesTierA(tierB.icon, tierA.icon))
          .map((tierB) => tierB.score),
        0,
      );
      return tierA.score >= strongestSuppressor;
    })
    .slice(0, 2);
  const tierAIcons = tierATop.map((c) => c.icon);
  const tierBIcons = tierBTop
    .filter((c) => !tierAIcons.includes(c.icon))
    .map((c) => c.icon);
  const topIcons = [...tierAIcons, ...tierBIcons];
  const personalContext = !decision.filtered &&
    (scores.personal ?? 0) >= PERSONAL_CONTEXT_THRESHOLD &&
    commercialIntent < PERSONAL_CONTEXT_SUPPRESS_THRESHOLD &&
    lowQuality < TIER_B_SUMMARY_THRESHOLD &&
    factCheckScore < FACT_CHECK_HEADLINE_THRESHOLD &&
    manipulationRisk < TIER_B_SUMMARY_THRESHOLD;

  const maxScore = Math.max(
    commercialIntent,
    scores.political ?? 0,
    scores.emotional ?? 0,
    aiLikelihood,
    lowQuality,
    factCheckScore,
    manipulationRisk,
    decision.insufficientText ? 0.5 : 0,
  );

  let severity: Severity;
  if (maxScore >= 0.8 || ruleHits >= 1) severity = "high";
  else if (maxScore >= 0.5) severity = "mid";
  else severity = "low";

  return { severity, tierAIcons, tierBIcons, topIcons, ruleHits, personalContext };
}

function isTierAInFlight(decision: FilterDecision): boolean {
  return !!decision.tierAPending && !decision.tierAError && decision.tier !== 3;
}

interface AiChipSpec {
  label: string;
  score: number;
  title: string;
}

function buildAiChipSpecs(decision: FilterDecision, post: PostData, lang: Lang): AiChipSpec[] {
  if (decision.filtered) return [];
  const deep = decision.deepClassification;
  if (deep) {
    const split: AiChipSpec[] = [];
    if (shouldDisplayDeepTextAi(deep, post.text)) {
      split.push({
        label: t("content.headsup.signal.textAi", lang),
        score: deep.textAiLikelihood as number,
        title: t("content.headsup.textAiTooltip", lang, { percent: ((deep.textAiLikelihood as number) * 100).toFixed(0) }),
      });
    }
    if (shouldDisplayDeepImageAi(deep)) {
      split.push({
        label: t("content.headsup.signal.imageAi", lang),
        score: deep.imageAiLikelihood as number,
        title: t("content.headsup.imageAiTooltip", lang, { percent: ((deep.imageAiLikelihood as number) * 100).toFixed(0) }),
      });
    }
    if (split.length > 0) return split;
    return [];
  }

  return [];
}

// ---------------------------------------------------------------------------
// Render entry points
// ---------------------------------------------------------------------------

export function renderHeadsUpPanel(
  article: HTMLElement,
  post: PostData,
  decision: FilterDecision,
  options: HeadsUpRenderOptions = {},
): void {
  const lang = options.lang ?? "zh-TW";
  if (hasAncestorHeadsUpSurface(article)) {
    clearHeadsUpPanel(article);
    return;
  }

  if (article.querySelector(".truly-collapse-bar")) {
    clearHeadsUpPanel(article);
    return;
  }

  const existingHost = article.querySelector<HTMLElement>(`.${HEADSUP_HOST_CLASS}`);
  const existing = findHeadsUpPanel(article);
  const existingTier = existing ? Number(existing.dataset.trulyPanelTier || "0") : 0;

  // Tier B errors or deep results arrive after Tier A. Treat them as
  // late-arriving state even when the cached Tier A decision carries a
  // lower tier number than the panel currently on screen.
  const incomingHasTierBState = !!decision.tierBError || !!decision.tierBPending || !!decision.deepClassification;
  const tierBChanged =
    incomingHasTierBState && !!decision.tierBError !== !!existing?.querySelector(".truly-badge-tier-b.truly-badge-failed");
  const tierBPending =
    incomingHasTierBState && !!decision.tierBPending !== !!existing?.querySelector(".truly-headsup-progress-label");
  const tierBCompleted =
    incomingHasTierBState && !!decision.deepClassification !== !!existing?.querySelector(".truly-badge-tier-b.truly-badge-complete");

  // Same-or-lower tier: don't replace. Avoids DOM thrash
  // when FB virtual-scrolls a post back and classifyPost re-fires
  // (heuristic first, then cache-hit LLM). Allow upgrade from
  // tier=1 to tier=3.
  if (!options.force && existing && (decision.tier ?? 1) < existingTier && !tierBChanged && !tierBPending && !tierBCompleted) {
    return;
  }

  if (!options.force && (decision.tier ?? 1) === existingTier && !tierBChanged && !tierBPending && !tierBCompleted) {
    const tierAErrorChanged =
      !!decision.tierAError !== !!existing?.querySelector(".truly-badge-tier-a.truly-badge-failed");
    if (!tierAErrorChanged) return;
  }

  // Preserve expanded state across progressive Tier A → Tier B updates.
  const wasExpanded = existing?.classList.contains("truly-headsup-expanded") ?? false;
  const tierBJustCompleted =
    !!decision.deepClassification && !existing?.querySelector(".truly-badge-tier-b.truly-badge-complete");

  const panel = buildPanel(article, post, decision, wasExpanded, tierBJustCompleted, lang);
  const host = ensureHeadsUpHost(article);
  removeNestedHeadsUpHosts(article, host);
  const root = ensureHeadsUpRoot(host);
  root.replaceChildren(buildShadowStyle(), panel);
  if (existing && existing.parentElement !== host) existing.remove();
  for (const placeholder of article.querySelectorAll<HTMLElement>(`.${HEADSUP_PLACEHOLDER_CLASS}`)) {
    if (placeholder.closest(`.${HEADSUP_HOST_CLASS}`) !== host) placeholder.remove();
  }
}

export function ensureHeadsUpPlaceholder(article: HTMLElement, lang: Lang = "zh-TW"): void {
  if (hasAncestorHeadsUpSurface(article)) {
    clearHeadsUpPanel(article);
    return;
  }
  if (article.querySelector(".truly-collapse-bar") || hasHeadsUpSurface(article)) return;
  const host = ensureHeadsUpHost(article);
  removeNestedHeadsUpHosts(article, host);
  const root = ensureHeadsUpRoot(host);
  const placeholder = document.createElement("div");
  placeholder.className = HEADSUP_PLACEHOLDER_CLASS;
  placeholder.textContent = t("content.headsup.pending", lang);
  placeholder.setAttribute("aria-hidden", "true");
  root.replaceChildren(buildShadowStyle(), placeholder);
}

export function clearHeadsUpPanel(article: HTMLElement): void {
  for (const host of article.querySelectorAll<HTMLElement>(`.${HEADSUP_HOST_CLASS}`)) {
    host.remove();
  }
  for (const stale of article.querySelectorAll<HTMLElement>(".truly-headsup, .truly-headsup-placeholder")) {
    stale.remove();
  }
}

function hasAncestorHeadsUpSurface(article: HTMLElement): boolean {
  const ancestorPost = article.parentElement?.closest<HTMLElement>("[data-truly-id], [data-truly-stable-id]");
  if (!ancestorPost) return false;
  return hasOwnHeadsUpSurface(ancestorPost);
}

function hasOwnHeadsUpSurface(article: HTMLElement): boolean {
  const host = ownHeadsUpHost(article);
  if (!host) return false;
  if (host.shadowRoot?.querySelector(".truly-headsup, .truly-headsup-placeholder")) return true;
  return host.querySelector(".truly-headsup, .truly-headsup-placeholder") !== null;
}

function ownHeadsUpHost(article: HTMLElement): HTMLElement | null {
  return Array.from(article.children).find(
    (child): child is HTMLElement =>
      child instanceof HTMLElement && child.classList.contains(HEADSUP_HOST_CLASS),
  ) ?? null;
}

function removeNestedHeadsUpHosts(article: HTMLElement, keepHost: HTMLElement): void {
  for (const host of article.querySelectorAll<HTMLElement>(`.${HEADSUP_HOST_CLASS}`)) {
    if (host !== keepHost) host.remove();
  }
}

function ensureHeadsUpHost(article: HTMLElement): HTMLElement {
  const existing = ownHeadsUpHost(article);
  if (existing) {
    syncHeadsUpHostTheme(existing);
    return existing;
  }
  const host = document.createElement("div");
  host.className = HEADSUP_HOST_CLASS;
  syncHeadsUpHostTheme(host);
  article.insertBefore(host, article.firstChild);
  return host;
}

export function findHeadsUpPanel(article: HTMLElement): HTMLElement | null {
  const host = ownHeadsUpHost(article);
  const shadowPanel = host?.shadowRoot?.querySelector<HTMLElement>(".truly-headsup") ?? null;
  return shadowPanel ?? host?.querySelector<HTMLElement>(".truly-headsup") ?? null;
}

export function hasHeadsUpPanel(article: HTMLElement): boolean {
  return findHeadsUpPanel(article) !== null;
}

function hasHeadsUpSurface(article: HTMLElement): boolean {
  const host = ownHeadsUpHost(article);
  if (!host) return article.querySelector(".truly-headsup, .truly-headsup-placeholder") !== null;
  if (host.shadowRoot?.querySelector(".truly-headsup, .truly-headsup-placeholder")) return true;
  return host.querySelector(".truly-headsup, .truly-headsup-placeholder") !== null;
}

function ensureHeadsUpRoot(host: HTMLElement): ShadowRoot {
  syncHeadsUpHostTheme(host);
  return host.shadowRoot ?? host.attachShadow({ mode: "open" });
}

function syncHeadsUpHostTheme(host: HTMLElement): void {
  if (headsUpThemeMode === "light") {
    host.classList.remove("truly-fb-dark");
    return;
  }
  if (headsUpThemeMode === "dark") {
    host.classList.add("truly-fb-dark");
    return;
  }

  let node: HTMLElement | null = host.parentElement;
  while (node) {
    const dark = isDarkColor(getComputedStyle(node).backgroundColor);
    if (dark !== null) {
      host.classList.toggle("truly-fb-dark", dark);
      return;
    }
    node = node.parentElement;
  }
  const bodyDark = isDarkColor(getComputedStyle(document.body).backgroundColor);
  host.classList.toggle(
    "truly-fb-dark",
    bodyDark ?? document.documentElement.classList.contains("truly-fb-dark"),
  );
}

export function syncAllHeadsUpHostThemes(): void {
  for (const host of document.querySelectorAll<HTMLElement>(`.${HEADSUP_HOST_CLASS}`)) {
    syncHeadsUpHostTheme(host);
  }
}

function buildShadowStyle(): HTMLStyleElement {
  const style = document.createElement("style");
  style.id = SHADOW_STYLE_ID;
  style.textContent = SHADOW_HEADS_UP_CSS;
  return style;
}

// ---------------------------------------------------------------------------
// Builders
// ---------------------------------------------------------------------------

function buildTierABadge(decision: FilterDecision, lang: Lang): HTMLElement | null {
  // The normal classification state is already carried by the left pending
  // headline and by the eventual content labels. Keep only the failure badge
  // here so the right side does not duplicate "分類中/分類完成".
  if (!decision.tierAError) return null;
  const el = document.createElement("span");
  el.className = "truly-badge-tier-a";
  el.classList.add("truly-badge-failed");
  el.textContent = t("content.headsup.tierA.failed", lang);
  el.title = t("content.headsup.rawError", lang, { error: decision.tierAError });
  return el;
}

function buildTierBBadge(decision: FilterDecision, lang: Lang): HTMLElement | null {
  const hasDeep = !!decision.deepClassification;
  const hasError = !!decision.tierBError;
  const isPending = decision.tierBPending && !hasError;
  if (!hasDeep && !hasError && !isPending) return null;

  const el = document.createElement("span");
  el.className = "truly-badge-tier-b";
  if (hasError) {
    el.classList.add("truly-badge-failed");
    el.textContent = t("content.headsup.tierB.failed", lang);
    el.title = t("content.headsup.rawError", lang, { error: decision.tierBError! });
  } else {
    if (isPending) {
      el.classList.add("truly-badge-pending", "truly-headsup-progress-label");
      el.textContent = hasDeep ? t("content.headsup.tierB.updating", lang) : t("content.headsup.tierB.analyzing", lang);
      const tooltip = hasDeep
        ? t("content.headsup.tierB.updatingTooltip", lang)
        : t("content.headsup.tierB.analyzingTooltip", lang);
      el.title = tooltip;
      el.setAttribute("aria-label", tooltip);
      el.setAttribute("role", "status");
      el.setAttribute("aria-live", "polite");
      return el;
    }
    el.classList.add("truly-badge-complete");
    el.textContent = t("content.headsup.tierB.complete", lang);
    const tooltip = buildAnalysisCompletionTooltip(decision, lang);
    el.title = tooltip;
    el.setAttribute("aria-label", tooltip);
  }
  return el;
}

function applyHeadsUpReveal(el: HTMLElement, shouldReveal: boolean): void {
  if (shouldReveal) el.classList.add("truly-headsup-reveal-enter");
}

function buildPanel(
  article: HTMLElement,
  post: PostData,
  decision: FilterDecision,
  startExpanded: boolean,
  animateTierBEnter: boolean,
  lang: Lang,
): HTMLElement {
  const signals = classifyHeadsUpSignals(decision);
  const tierAInFlight = isTierAInFlight(decision);
  const animateSeverityArrival = shouldAnimateSeverityArrival(article, post, signals.severity);
  const detail = buildDetail(article, post, decision, lang);
  const canExpand = !!detail;
  const expanded = canExpand && startExpanded;

  const panel = document.createElement("div");
  panel.className = `truly-headsup ${SEVERITY_CLASS[signals.severity]}`;
  if (tierAInFlight) panel.classList.add("truly-headsup-working");
  if (expanded) panel.classList.add("truly-headsup-expanded");
  panel.dataset.trulyPanelTier = String(decision.tier ?? 1);

  const detailId = `truly-headsup-detail-${++headsUpIdSeq}`;
  const summary = buildSummary(decision, post, signals, expanded, detailId, animateTierBEnter, canExpand, animateSeverityArrival, lang);
  if (detail) detail.id = detailId;

  panel.appendChild(summary);
  if (detail) panel.appendChild(detail);

  const notifyManualView = () => {
    // Tell the sidepanel's 分析 pane about explicit user interest.
    // Honored regardless of `analysisAutoFollow`; in manual mode this
    // is the ONLY trigger that updates the pane.
    const id = article.dataset.trulyStableId || article.dataset.trulyId;
    if (id) {
      try {
        chrome.runtime.sendMessage({ type: "MANUAL_VIEW_POST", id }).catch(() => {});
      } catch { /* no-op when chrome.runtime is unavailable (tests) */ }
    }
  };

  const toggleExpanded = () => {
    panel.classList.toggle("truly-headsup-expanded");
    const expanded = panel.classList.contains("truly-headsup-expanded");
    summary.setAttribute("aria-expanded", expanded ? "true" : "false");
    const toggle = panel.querySelector<HTMLElement>(".truly-headsup-toggle");
    if (toggle) toggle.textContent = expanded ? t("content.headsup.toggleClose", lang) : t("content.headsup.toggleOpen", lang);
    notifyManualView();
  };

  summary.addEventListener("click", (e) => {
    const t = e.target as HTMLElement | null;
    const interactive = t?.closest<HTMLElement>("button, a");
    if (interactive && interactive !== summary) return;
    if (tierAInFlight) {
      notifyManualView();
      return;
    }
    if (canExpand) toggleExpanded();
    else notifyManualView();
  });

  return panel;
}

function buildSummary(
  decision: FilterDecision,
  post: PostData,
  signals: HeadsUpSignals,
  startExpanded: boolean,
  detailId: string,
  animateTierBEnter: boolean,
  canExpand = true,
  animateSeverityArrival = false,
  lang: Lang,
): HTMLButtonElement {
  const summary = document.createElement("button");
  summary.className = "truly-headsup-summary";
  summary.type = "button";
  if (canExpand) {
    summary.setAttribute("aria-expanded", startExpanded ? "true" : "false");
    summary.setAttribute("aria-controls", detailId);
    summary.setAttribute("aria-label", t("content.headsup.toggleAria", lang));
  } else {
    summary.setAttribute("aria-label", t("content.headsup.summaryAria", lang));
    summary.setAttribute("aria-disabled", "true");
  }
  const tierAInFlight = isTierAInFlight(decision);
  if (tierAInFlight) {
    summary.setAttribute("aria-label", t("content.headsup.pendingAria", lang));
    summary.setAttribute("aria-disabled", "true");
  }

  const dot = document.createElement("span");
  dot.className = "truly-headsup-dot";
  if (animateSeverityArrival) dot.classList.add("truly-headsup-dot-arrive");
  summary.appendChild(dot);

  // Headline label: 1-2 explicit signal names. Low-risk cases intentionally
  // omit warning copy; process state already lives in the status area.
  const aiChips = tierAInFlight ? [] : buildAiChipSpecs(decision, post, lang);
  const zhtwChip = buildZhtwSummaryChip(decision.zhtwReview, animateTierBEnter, lang);
  const shareContextChip = tierAInFlight ? null : buildShareContextChip(post, lang);
  const deepLabels = tierAInFlight ? [] : buildTierBHeadlineLabels(signals, aiChips.length > 0, lang);
  let headline = tierAInFlight ? t("content.headsup.pending", lang) : buildHeadlineLabel(signals, post, aiChips, lang);
  if (headline) {
    const label = document.createElement("span");
    label.className = "truly-headsup-label";
    if (tierAInFlight) label.classList.add("truly-headsup-label-pending");
    applyHeadsUpReveal(label, animateTierBEnter && post.contentKind === "share_without_comment");
    label.textContent = headline;
    const title = tierAInFlight ? "" : tooltipForSignalLabels(signals.tierAIcons, decision, lang);
    if (title) {
      label.title = title;
      label.setAttribute("aria-label", `${headline}。${title.replace(/\n/g, " ")}`);
    } else if (!tierAInFlight && signals.personalContext && headline === t("content.headsup.signal.personal", lang)) {
      label.title = tooltipWithOptionalScore(t("content.headsup.signal.personal", lang), decision.scores?.personal, t("content.headsup.tooltip.personal", lang), lang);
      label.setAttribute("aria-label", `${headline}。${label.title}`);
    } else if (!tierAInFlight && post.contentKind === "share_without_comment") {
      label.title = t("content.headsup.share.noCommentTooltip", lang);
      label.setAttribute("aria-label", `${headline}。${label.title}`);
    }
    summary.appendChild(label);
  }

  if (zhtwChip) summary.appendChild(zhtwChip);

  if (tierAInFlight) return summary;

  if (shareContextChip) summary.appendChild(shareContextChip);

  for (const deepLabel of deepLabels) {
    const label = document.createElement("span");
    label.className = "truly-headsup-tag truly-headsup-deep-label";
    applyHeadsUpReveal(label, animateTierBEnter);
    label.textContent = deepLabel;
    label.title = tooltipForSignalLabel(deepLabel, lang) || t("content.headsup.deepLabelFallback", lang);
    summary.appendChild(label);
  }

  if (decision.deepClassification) {
    const imageStatus = decision.deepClassification.imageStatus;
    if (imageStatus === "decode_failed" || imageStatus === "vision_format_failed" || imageStatus === "filtered") {
      const warn = document.createElement("span");
      warn.className = "truly-tier-b-image-warning";
      applyHeadsUpReveal(warn, animateTierBEnter);
      warn.textContent = "📷⚠";
      warn.title = imageStatus === "vision_format_failed"
        ? t("content.headsup.imageWarning.format", lang)
        : t("content.headsup.imageWarning.textOnly", lang);
      summary.appendChild(warn);
    }
  }

  const personalLabel = t("content.headsup.signal.personal", lang);
  if (signals.personalContext && signals.topIcons.length > 0 && shouldRenderPersonalContextChip(headline, personalLabel)) {
    const personalChip = document.createElement("span");
    personalChip.className = "truly-headsup-tag truly-personal-context-chip";
    personalChip.textContent = personalLabel;
    personalChip.title = tooltipWithOptionalScore(personalLabel, decision.scores?.personal, t("content.headsup.tooltip.personal", lang), lang);
    summary.appendChild(personalChip);
  }

  for (const aiChip of aiChips) {
    const chip = document.createElement("span");
    chip.className = "truly-iq-ai-chip";
    applyHeadsUpReveal(chip, animateTierBEnter && !!decision.deepClassification);
    const label = document.createElement("span");
    label.textContent = `${aiChip.label}：`;
    const score = document.createElement("span");
    score.className = "truly-iq-ai-score";
    score.textContent = aiChip.score.toFixed(1);
    chip.append(label, score);
    chip.title = aiChip.title;
    summary.appendChild(chip);
  }

  // Spacer: pushes pipeline badges + toggle to the right edge.
  const spacer = document.createElement("span");
  spacer.className = "truly-headsup-spacer";
  summary.appendChild(spacer);

  // Pipeline status badges — deep analysis, plus 📊 classification only on failure.
  // Kept in their own group so
  // they read as status, while the detail toggle remains the only action.
  const statusGroup = document.createElement("span");
  statusGroup.className = "truly-headsup-statuses";
  const hasPipelineError = !!decision.tierAError || !!decision.tierBError;
  statusGroup.setAttribute("role", hasPipelineError ? "alert" : "status");
  statusGroup.setAttribute("aria-live", hasPipelineError ? "assertive" : "polite");
  statusGroup.setAttribute("aria-atomic", "true");
  const tierABadge = buildTierABadge(decision, lang);
  if (tierABadge) statusGroup.appendChild(tierABadge);

  const tierBBadge = buildTierBBadge(decision, lang);
  if (tierBBadge) {
    applyHeadsUpReveal(tierBBadge, animateTierBEnter && !!decision.deepClassification);
    statusGroup.appendChild(tierBBadge);
  }
  if (statusGroup.childElementCount > 0) summary.appendChild(statusGroup);

  // Detail toggle — sits rightmost, after the badges.
  if (canExpand) {
    const toggle = document.createElement("span");
    toggle.className = "truly-headsup-toggle";
    applyHeadsUpReveal(toggle, animateTierBEnter && !!decision.deepClassification);
    toggle.textContent = t("content.headsup.toggleOpen", lang);
    summary.appendChild(toggle);
  } else if (decision.tierBPending && !decision.tierBError) {
    const placeholder = document.createElement("span");
    placeholder.className = "truly-headsup-toggle-placeholder";
    placeholder.textContent = t("content.headsup.toggleOpen", lang);
    placeholder.setAttribute("aria-hidden", "true");
    summary.appendChild(placeholder);
  }

  return summary;
}

function zhtwTooltip(review: ZhtwReview, lang: Lang): string {
  const terms = summarizeZhtwTermsForHeadsUp(review);
  const lexical = terms.filter((term) => zhtwTermDisplayGroup(term) === "lexical");
  const style = terms.filter((term) => zhtwTermDisplayGroup(term) === "style");
  const other = terms.filter((term) => zhtwTermDisplayGroup(term) === "other");
  const lines = [t("content.headsup.zhtw.title", lang, { count: zhtwHeadsUpIssueCount(review) })];
  const appendGroup = (label: string, items: typeof terms) => {
    if (items.length === 0) return;
    lines.push("", label);
    for (const item of items) lines.push(`• ${formatZhtwTermExplanation(item)}`);
  };
  appendGroup(t("content.headsup.zhtw.lexical", lang), lexical);
  appendGroup(t("content.headsup.zhtw.style", lang), style);
  appendGroup(t("content.headsup.zhtw.other", lang), other);
  lines.push("", t("content.headsup.zhtw.caution", lang));
  return lines.join("\n");
}

function buildZhtwSummaryChip(review: ZhtwReview | undefined, reveal: boolean, lang: Lang): HTMLElement | null {
  if (lang !== "zh-TW") return null;
  if (!shouldShowZhtwInHeadsUp(review)) return null;
  const chip = document.createElement("span");
  chip.className = "truly-headsup-tag truly-zhtw-chip";
  chip.textContent = t("content.headsup.zhtw.label", lang);
  chip.title = zhtwTooltip(review as ZhtwReview, lang);
  applyHeadsUpReveal(chip, reveal);
  return chip;
}

function buildHeadlineLabel(signals: HeadsUpSignals, post: PostData | undefined, aiChips: AiChipSpec[], lang: Lang): string {
  const names = signals.tierAIcons.map((i) => signalLabel(i, lang)).filter(Boolean);
  if (names.length === 0 && post?.contentKind === "share_without_comment") {
    const hasImageAi = aiChips.some((chip) => chip.label === t("content.headsup.signal.imageAi", lang));
    if (signals.tierBIcons.includes(ICON_FACT_CHECK)) return t("content.headsup.share.needsCheck", lang);
    if (hasImageAi) return t("content.headsup.share.imageAi", lang);
    if (signals.tierBIcons.length > 0 || aiChips.length > 0) return t("content.headsup.share.needsAttention", lang);
    return t("content.headsup.share.content", lang);
  }
  if (names.length === 0 && signals.personalContext) return t("content.headsup.signal.personal", lang);
  if (names.length === 0) return "";
  return names.join("｜");
}

function buildShareContextChip(post: PostData, lang: Lang): HTMLElement | null {
  if (post.contentKind !== "reshare_with_comment") {
    return null;
  }
  const chip = document.createElement("span");
  chip.className = "truly-headsup-tag truly-share-context-chip";
  chip.textContent = t("content.headsup.share.label", lang);
  const originalAuthor = post.reshareOriginalAuthor
    ? t("content.headsup.share.originalAuthor", lang, { author: post.reshareOriginalAuthor })
    : "";
  chip.title = t("content.headsup.share.title", lang, { originalAuthor });
  return chip;
}

function buildTierBHeadlineLabels(signals: HeadsUpSignals, hasAiChip: boolean, lang: Lang): string[] {
  return signals.tierBIcons
    .filter((i) => !(hasAiChip && i === ICON_AI))
    .map((i) => signalLabel(i, lang))
    .filter(Boolean);
}

function tooltipWithOptionalScore(label: string, score: number | undefined, text: string, lang: Lang): string {
  return typeof score === "number"
    ? lang === "zh-TW" ? `${label}（${score.toFixed(1)}）：${text}` : `${label} (${score.toFixed(1)}): ${text}`
    : lang === "zh-TW" ? `${label}：${text}` : `${label}: ${text}`;
}

function tooltipForSignalLabels(icons: string[], decision: FilterDecision, lang: Lang): string {
  return icons
    .map((icon) => {
      const label = signalLabel(icon, lang);
      const tooltip = signalTooltip(icon, lang);
      const scoreCategory = SIGNAL_SCORE_CATEGORY[icon];
      const score = scoreCategory ? decision.scores?.[scoreCategory] : undefined;
      return label && tooltip ? tooltipWithOptionalScore(label, score, tooltip, lang) : undefined;
    })
    .filter((line): line is string => !!line)
    .join("\n\n");
}

function tooltipForSignalLabel(label: string, lang: Lang): string {
  const icon = Object.keys(SIGNAL_LABEL_KEY).find((item) => signalLabel(item, lang) === label);
  return icon ? signalTooltip(icon, lang) : "";
}

function userFacingPipelineError(kind: "classification" | "analysis", raw: string, lang: Lang): string {
  const prefix = kind === "classification" ? "classification" : "analysis";
  if (/tier_b_network_error|vllm_failed|failed to fetch|fetch failed|econnrefused|econnreset|networkerror|無法連線|連線失敗/i.test(raw)) {
    return t(`content.headsup.error.${prefix}.connection`, lang);
  }
  if (/tier_b_timeout|timeout|timed out|逾時/i.test(raw)) {
    return t(`content.headsup.error.${prefix}.timeout`, lang);
  }
  if (/tier_b_http_error|tier_b_format_error|tier_b_response_truncated|tier_b_reasoning_without_json|tier_b_failed|image_decode_failed|json|parse|schema|format|格式/i.test(raw)) {
    return t(`content.headsup.error.${prefix}.format`, lang);
  }
  if (/model|404|not found|不存在|未提供/i.test(raw)) {
    return t(`content.headsup.error.${prefix}.model`, lang);
  }
  return t(`content.headsup.error.${prefix}.generic`, lang);
}

function shouldPrioritizeRetry(raw: string): boolean {
  return /tier_b_network_error|vllm_failed|tier_b_timeout|timeout|timed out|逾時|failed to fetch|fetch failed|econnreset|networkerror|連線失敗|無回應/i.test(raw);
}

function openOptionsPage(): void {
  try {
    const maybePromise = chrome.runtime.sendMessage({ type: "OPEN_OPTIONS_PAGE" });
    if (maybePromise && typeof maybePromise.catch === "function") {
      maybePromise.catch(() => {});
    }
  } catch {
    /* no-op in tests/non-extension contexts */
  }
}

function toggleDashboardForPost(id: string | undefined): void {
  if (!id) return;
  try {
    chrome.runtime.sendMessage({ type: "MANUAL_VIEW_POST", id }).catch(() => {});
    chrome.runtime.sendMessage({ type: "TOGGLE_DASHBOARD_FOR_POST", id }).catch(() => {});
  } catch {
    /* no-op in tests/non-extension contexts */
  }
}

function retryPipeline(kind: "classification" | "analysis", article: HTMLElement): void {
  const eventName = kind === "classification" ? "truly-retry-classification" : "truly-retry-analysis";
  article.dispatchEvent(new CustomEvent(eventName, { bubbles: true }));
}

function buildPipelineError(kind: "classification" | "analysis", raw: string, article: HTMLElement, lang: Lang): HTMLElement {
  const err = document.createElement("div");
  err.className = "truly-headsup-error";
  err.setAttribute("role", "alert");
  err.title = t("content.headsup.rawError", lang, { error: raw });

  const message = document.createElement("span");
  message.textContent = userFacingPipelineError(kind, raw, lang);
  err.appendChild(message);

  const appendRetryAction = () => {
    const action = document.createElement("button");
    action.type = "button";
    action.className = "truly-headsup-error-action";
    action.textContent = t("content.headsup.error.retry", lang);
    action.addEventListener("click", (e) => {
      e.stopPropagation();
      retryPipeline(kind, article);
    });
    err.appendChild(action);
  };

  const appendSettingsAction = () => {
    const action = document.createElement("button");
    action.type = "button";
    action.className = "truly-headsup-error-action";
    action.textContent = t("content.headsup.error.settings", lang);
    action.addEventListener("click", (e) => {
      e.stopPropagation();
      openOptionsPage();
    });
    err.appendChild(action);
  };

  if (shouldPrioritizeRetry(raw)) {
    appendRetryAction();
    appendSettingsAction();
  } else {
    appendSettingsAction();
    appendRetryAction();
  }

  const details = document.createElement("details");
  details.className = "truly-headsup-error-raw";
  const summary = document.createElement("summary");
  summary.textContent = t("content.headsup.error.details", lang);
  const code = document.createElement("code");
  code.textContent = raw;
  details.appendChild(summary);
  details.appendChild(code);
  err.appendChild(details);

  return err;
}

function buildQuickReasonBullets(
  article: HTMLElement,
  decision: FilterDecision,
  lang: Lang,
): string[] {
  const signals = classifyHeadsUpSignals(decision);
  const scores = decision.scores || {};
  const reasons: string[] = [];
  const add = (text: string) => {
    if (!reasons.includes(text)) reasons.push(text);
  };
  const hasSponsorshipReason = article.dataset.trulySponsored === "true";
  const hasDeep = !!decision.deepClassification;

  for (const icon of signals.topIcons) {
    if (icon === ICON_COMMERCIAL && !hasSponsorshipReason) {
      // Taxonomy definition lives in the summary label tooltip.
    } else if (icon === ICON_POLITICAL) {
      // Taxonomy definition lives in the summary label tooltip.
    } else if (icon === ICON_EMOTIONAL) {
      // Taxonomy definition lives in the summary label tooltip.
    } else if (icon === ICON_FACT_CHECK && !hasDeep) {
      // Taxonomy definition lives in the summary label tooltip; Tier B
      // concrete rationale is rendered by buildDeepAnalysisSummaryBullet().
    } else if (icon === ICON_LOW_QUALITY && !hasDeep) {
      // Taxonomy definition lives in the summary label tooltip; Tier B
      // concrete rationale is rendered by buildDeepAnalysisSummaryBullet().
    } else if (icon === ICON_RAGEBAIT && !hasDeep) {
      // Taxonomy definition lives in the summary label tooltip; Tier B
      // concrete rationale is rendered by buildDeepAnalysisSummaryBullet().
    } else if (icon === ICON_RULE) {
      add(t("content.headsup.quick.rule", lang));
    } else if (icon === ICON_INSUFFICIENT) {
      add(t("content.headsup.quick.insufficient", lang));
    }
  }

  if (signals.personalContext || ((scores.personal ?? 0) >= PERSONAL_CONTEXT_THRESHOLD && reasons.length === 0)) {
    // Positive context definition lives in the summary label/chip tooltip.
  }

  return reasons;
}

function firstSentence(text: string | undefined): string | undefined {
  const normalized = text?.replace(/\s+/g, " ").trim();
  if (!normalized) return undefined;
  const match = normalized.match(/^(.{1,90}?[。！？!?])/);
  return (match?.[1] ?? normalized.slice(0, 90)).trim();
}

function comparableDetailText(text: string | undefined): string {
  return (text ?? "")
    .replace(/\s+/g, "")
    .replace(/[，。！？；：、,.!?;:"'「」『』（）()【】\[\]\-—]/g, "")
    .toLowerCase();
}

function isDuplicateDetailText(candidate: string | undefined, reference: string | undefined): boolean {
  const a = comparableDetailText(candidate);
  const b = comparableDetailText(reference);
  if (!a || !b) return false;
  if (a === b) return true;
  const min = Math.min(a.length, b.length);
  return min >= 24 && (a.includes(b) || b.includes(a));
}

function makeDetailTextTracker(initialTexts: Array<string | undefined> = []) {
  const texts: string[] = [];
  const add = (text: string | undefined) => {
    const normalized = comparableDetailText(text);
    if (normalized) texts.push(text as string);
  };
  const has = (text: string | undefined) => texts.some((existing) => isDuplicateDetailText(text, existing));
  for (const text of initialTexts) add(text);
  return { add, has };
}

const TEXT_AI_EVIDENCE_RE = /AI ?生成|模型生成|生成式文字|生成文|機器生成|內容農場|高度模板化|模板化|公式化|空泛|機械式|罐頭文|AI 文|高度工整|過度工整|報告式|模型摘要|自動生成摘要|語氣過度平衡/i;
const TEXT_AI_STYLE_EVIDENCE_RE = /高度模板化|模板化|公式化|空泛|機械式|罐頭文|高度工整|過度工整|報告式|模型摘要|自動生成摘要|語氣過度平衡/i;
const AI_TOPIC_RE = /AI|人工智慧|生成式|大語言模型|LLM|ChatGPT|Claude|Gemini|Copilot|vLLM|模型|機器學習/i;
const PERSONAL_CONTEXT_RE = /我(今天|昨天|最近|剛|每天|自己|覺得|認為|使用|用了|遇到|發現|分享)|我們(剛|最近|今天|昨天|公司|團隊|測試|使用|遇到)|個人(覺得|經驗|心得|推薦)/;
const GENERATED_IMAGE_EVIDENCE_RE = /AI ?生成|AI ?合成|生成圖|合成圖|不自然|畸形|失真|臉部變形|手指|錯字|模糊文字|光影不自然/i;
const NON_AI_VISUAL_RE = /非 ?AI|不是 ?AI|非生成|官方|截圖|螢幕截圖|速查表|cheat ?sheet|Logo|表格|圖表|資訊圖表|指令對照|產品示意|設計圖/i;

function textAiReason(deep: DeepClassification): string | null {
  const candidates = [
    deep.informationQuality?.explanation,
    deep.summary,
  ].filter((item): item is string => !!item?.trim());
  const reason = candidates.find((item) => TEXT_AI_EVIDENCE_RE.test(item));
  if (!reason) return null;
  return firstSentence(reason) ?? null;
}

function imageReasonText(deep: DeepClassification): string {
  return [
    deep.summary,
    ...(deep.imageInsights ?? []).map((item) => item.observation),
  ].filter(Boolean).join(" ");
}

function imageReasonWithoutNegatedAi(text: string): string {
  return text.replace(/非 ?AI ?生成|不是 ?AI ?生成|非生成|非 ?AI|不是 ?AI/gi, "");
}

function imageAiReason(deep: DeepClassification): string | null {
  const reasonText = imageReasonText(deep);
  if (!GENERATED_IMAGE_EVIDENCE_RE.test(imageReasonWithoutNegatedAi(reasonText))) return null;
  const insight = deep.imageInsights?.find((item) => item.observation?.trim())?.observation;
  if (insight) return firstSentence(insight) ?? insight;
  return firstSentence(deep.summary) ?? null;
}

function shouldDisplayDeepTextAi(deep: DeepClassification, postText = ""): boolean {
  if (typeof deep.textAiLikelihood !== "number" || deep.textAiLikelihood < AI_CHIP_THRESHOLD) return false;
  const reason = textAiReason(deep);
  if (!reason) return false;
  const topicOnlyRisk = AI_TOPIC_RE.test(postText) && !TEXT_AI_EVIDENCE_RE.test(postText);
  const personalContext = PERSONAL_CONTEXT_RE.test(postText) || /個人推薦|個人經驗|每天.*用|實測|心得/.test(deep.summary ?? "");
  return !(topicOnlyRisk && personalContext && !TEXT_AI_STYLE_EVIDENCE_RE.test(reason));
}

function shouldDisplayDeepImageAi(deep: DeepClassification): boolean {
  if (typeof deep.imageAiLikelihood !== "number" || deep.imageAiLikelihood < AI_CHIP_THRESHOLD) return false;
  const reasonText = imageReasonText(deep);
  const positiveReasonText = imageReasonWithoutNegatedAi(reasonText);
  if (!GENERATED_IMAGE_EVIDENCE_RE.test(positiveReasonText)) return false;
  return !(NON_AI_VISUAL_RE.test(reasonText) && !GENERATED_IMAGE_EVIDENCE_RE.test(positiveReasonText));
}

function formatDeepScore(score: number): string {
  return score.toFixed(1);
}

function buildSignalChip(label: string, score: number, className = "", tooltip = ""): HTMLElement {
  const chip = document.createElement("span");
  chip.className = `truly-headsup-signal-chip${className ? ` ${className}` : ""}`;
  chip.textContent = `${label} ${formatDeepScore(score)}`;
  if (tooltip) chip.title = tooltip;
  return chip;
}

function buildFactCheckActionChip(lang: Lang): HTMLElement {
  const chip = document.createElement("span");
  chip.className = "truly-headsup-action-chip truly-headsup-action-chip-trailing";
  chip.textContent = t("content.headsup.factCheckAction", lang);
  chip.title = t("content.headsup.factCheckActionTooltip", lang);
  return chip;
}

function shouldSuggestFactCheck(deep: DeepClassification | undefined): boolean {
  if (!deep) return false;
  return (
    deep.informationQuality?.needsFactCheck === true ||
    (deep.informationQuality?.factualRisk ?? 0) >= FACT_CHECK_HEADLINE_THRESHOLD
  );
}

function buildDeepAnalysisSummaryBullet(
  deep: DeepClassification,
  lang: Lang,
  options: {
    showFactCheckAction?: boolean;
    detailLead?: string;
    duplicateText?: (text: string | undefined) => boolean;
  } = {},
): HTMLElement | null {
  let hasDeepQuality = false;
  const item = document.createElement("li");
  item.className = "truly-headsup-bullet";
  const chipRow = document.createElement("span");
  chipRow.className = "truly-headsup-bullet-chips";

  const showFactCheckAction = options.showFactCheckAction ?? true;
  const suggestFactCheck = shouldSuggestFactCheck(deep);

  const addSignal = (label: string, score: number | undefined, threshold = 0.5) => {
    if (typeof score !== "number" || score < threshold) return;
    const tooltipKey = label === t("content.headsup.signal.factRisk", lang)
      ? DEEP_SIGNAL_TOOLTIP_KEY.factRisk
      : label === t("content.headsup.signal.manipulationRisk", lang)
        ? DEEP_SIGNAL_TOOLTIP_KEY.manipulationRisk
        : label === t("content.headsup.signal.lowQualityShort", lang)
          ? DEEP_SIGNAL_TOOLTIP_KEY.lowQuality
          : "";
    chipRow.appendChild(buildSignalChip(label, score, "", tooltipKey ? t(tooltipKey, lang) : ""));
    hasDeepQuality = true;
  };

  addSignal(t("content.headsup.signal.factRisk", lang), deep.informationQuality?.factualRisk, FACT_CHECK_HEADLINE_THRESHOLD);
  addSignal(t("content.headsup.signal.manipulationRisk", lang), deep.informationQuality?.manipulationRisk);
  addSignal(t("content.headsup.signal.lowQualityShort", lang), deep.lowQualitySignal);

  if (chipRow.childElementCount > 0) item.appendChild(chipRow);

  if (
    deep.informationQuality?.explanation &&
    !isDuplicateDetailText(deep.informationQuality.explanation, options.detailLead) &&
    !options.duplicateText?.(deep.informationQuality.explanation)
  ) {
    const text = document.createElement("span");
    text.className = "truly-headsup-bullet-text";
    text.textContent = deep.informationQuality.explanation;
    item.appendChild(text);
    hasDeepQuality = true;
  }

  if (suggestFactCheck && showFactCheckAction) {
    item.appendChild(buildFactCheckActionChip(lang));
    hasDeepQuality = true;
  }

  return hasDeepQuality ? item : null;
}

function buildAiReasonBullets(
  deep: DeepClassification,
  lang: Lang,
  options: { detailLead?: string; duplicateText?: (text: string | undefined) => boolean } = {},
): HTMLElement[] {
  const textReason = textAiReason(deep);
  const imageReason = imageAiReason(deep);
  const hasTextAi = shouldDisplayDeepTextAi(deep) && !!textReason;
  const hasImageAi = shouldDisplayDeepImageAi(deep) && !!imageReason;
  const hasLegacyAi =
    !hasTextAi &&
    !hasImageAi &&
    typeof deep.aiLikelihood === "number" &&
    deep.aiLikelihood >= AI_CHIP_THRESHOLD;
  if (!hasTextAi && !hasImageAi && !hasLegacyAi) return [];

  const build = (labelText: string, score: number, reason: string): HTMLElement | null => {
    if (isDuplicateDetailText(reason, options.detailLead) || options.duplicateText?.(reason)) return null;
    const item = document.createElement("li");
    item.className = "truly-headsup-bullet";
    const chipRow = document.createElement("span");
    chipRow.className = "truly-headsup-bullet-chips";
    chipRow.appendChild(buildSignalChip(labelText, score));
    item.appendChild(chipRow);
    const text = document.createElement("span");
    text.className = "truly-headsup-bullet-text";
    text.textContent = reason;
    item.appendChild(text);
    return item;
  };

  if (hasLegacyAi) {
    const item = build("AI", deep.aiLikelihood as number, t("content.headsup.aiFallbackReason", lang));
    return item ? [item] : [];
  }

  const bullets: HTMLElement[] = [];
  if (hasTextAi) {
    const item = build(t("content.headsup.signal.textAi", lang), deep.textAiLikelihood as number, textReason as string);
    if (item) bullets.push(item);
  }
  if (hasImageAi) {
    const item = build(t("content.headsup.signal.imageAi", lang), deep.imageAiLikelihood as number, imageReason as string);
    if (item) bullets.push(item);
  }
  return bullets;
}

function textBullet(text: string, className = ""): HTMLLIElement {
  const item = document.createElement("li");
  item.className = `truly-headsup-bullet${className ? ` ${className}` : ""}`;
  item.textContent = text;
  return item;
}

function detailItemTexts(item: HTMLElement): string[] {
  const scopedTexts = Array.from(item.querySelectorAll<HTMLElement>(".truly-headsup-bullet-text"))
    .map((el) => el.textContent ?? "")
    .filter((text) => !!comparableDetailText(text));
  return scopedTexts.length > 0 ? scopedTexts : [item.textContent ?? ""];
}

function buildZhtwDetailBullet(review: ZhtwReview | undefined, lang: Lang): HTMLElement | null {
  if (lang !== "zh-TW") return null;
  if (!shouldShowZhtwInHeadsUp(review)) return null;
  const examples = summarizeZhtwTermsForHeadsUp(review);
  if (examples.length === 0) return null;
  const item = document.createElement("li");
  item.className = "truly-headsup-bullet";
  const text = document.createElement("span");
  text.className = "truly-headsup-bullet-text";
  text.textContent = t("content.headsup.zhtw.detail", lang, {
    examples: examples.map(formatZhtwTermExplanation).join(lang === "zh-TW" ? "；" : "; "),
  });
  item.appendChild(text);
  return item;
}

function buildDetailBullets(article: HTMLElement, decision: FilterDecision, lang: Lang, detailLead?: string): HTMLElement | null {
  const items: HTMLElement[] = [];
  const detailTexts = makeDetailTextTracker([detailLead]);
  const append = (item: HTMLElement | null) => {
    if (!item || items.length >= 5) return;
    const texts = detailItemTexts(item);
    if (texts.some((text) => detailTexts.has(text))) return;
    items.push(item);
    for (const text of texts) detailTexts.add(text);
  };

  for (const reason of buildQuickReasonBullets(article, decision, lang)) {
    append(textBullet(reason));
  }

  const deep = decision.deepClassification;
  const factCheckCta = shouldSuggestFactCheck(deep);
  if (deep) {
    for (const item of buildAiReasonBullets(deep, lang, {
      detailLead,
      duplicateText: detailTexts.has,
    })) append(item);
    append(buildDeepAnalysisSummaryBullet(deep, lang, {
      showFactCheckAction: !factCheckCta,
      detailLead,
      duplicateText: detailTexts.has,
    }));
  }

  if (decision.customRuleScores) {
    const hits = Object.entries(decision.customRuleScores)
      .map(([id, score]) => ({ id, score }))
      .filter((r) => typeof r.score === "number" && r.score >= 0.5)
      .slice(0, 2);
    if (hits.length > 0) {
      append(textBullet(t("content.headsup.quick.customRules", lang, {
        rules: hits.map((h) => `${h.id} ${h.score.toFixed(1)}`).join(lang === "zh-TW" ? "、" : ", "),
      })));
    }
  }

  if (items.length === 0) return null;
  const list = document.createElement("ul");
  list.className = "truly-headsup-bullets";
  for (const item of items) list.appendChild(item);
  return list;
}

function buildDetail(
  article: HTMLElement,
  post: PostData,
  decision: FilterDecision,
  lang: Lang,
): HTMLElement | null {
  const detail = document.createElement("div");
  detail.className = "truly-headsup-detail";

  // Tier A error explanation
  if (decision.tierAError) {
    detail.appendChild(buildPipelineError("classification", decision.tierAError, article, lang));
  }

  // Tier B error explanation
  if (decision.tierBError) {
    detail.appendChild(buildPipelineError("analysis", decision.tierBError, article, lang));
  }

  const summary = decision.deepClassification?.summary?.trim();
  const factCheckCta = shouldSuggestFactCheck(decision.deepClassification);
  const pendingSummary = decision.tierBPending
    ? decision.deepClassification
      ? t("content.headsup.pendingDetail", lang)
      : ""
    : "";
  const detailLead = summary || pendingSummary;
  const hasDeep = !!decision.deepClassification;
  // Render the side-panel entry point even when Tier B failed (no deepClassification):
  // the panel still offers manual fact-check, investigation, and Reading Brief retry.
  if (hasDeep || decision.tierBError) {
    const row = document.createElement("div");
    row.className = "truly-headsup-detail-top";
    if (detailLead) {
      const text = document.createElement("p");
      text.className = "truly-headsup-detail-summary";
      if (!summary && pendingSummary) text.classList.add("truly-headsup-detail-summary-pending");
      text.textContent = detailLead;
      row.appendChild(text);
    }
    const panelButton = document.createElement("button");
    panelButton.type = "button";
    panelButton.className = "truly-analysis-panel-btn";
    const ctaText = !hasDeep
      ? t("content.headsup.openInPanel", lang)
      : factCheckCta
        ? t("content.headsup.factCheckAction", lang)
        : t("content.headsup.deepRead", lang);
    panelButton.textContent = ctaText;
    panelButton.title = t("content.headsup.openAction", lang, { action: ctaText });
    panelButton.setAttribute("aria-label", t("content.headsup.openAction", lang, { action: ctaText }));
    panelButton.addEventListener("click", (e) => {
      e.stopPropagation();
      e.preventDefault();
      toggleDashboardForPost(article.dataset.trulyStableId || article.dataset.trulyId);
    });
    const actionRow = document.createElement("div");
    actionRow.className = "truly-headsup-detail-actions";
    actionRow.appendChild(panelButton);
    row.appendChild(actionRow);
    detail.appendChild(row);
  }

  const bullets = buildDetailBullets(article, decision, lang, detailLead);
  const zhtwBullet = buildZhtwDetailBullet(decision.zhtwReview, lang);
  const shouldIncludeZhtw = !!zhtwBullet && (detail.childElementCount > 0 || !!bullets);
  if (bullets) {
    if (shouldIncludeZhtw && bullets.childElementCount < 5) bullets.appendChild(zhtwBullet as HTMLElement);
    detail.appendChild(bullets);
  } else if (shouldIncludeZhtw) {
    const list = document.createElement("ul");
    list.className = "truly-headsup-bullets";
    list.appendChild(zhtwBullet as HTMLElement);
    detail.appendChild(list);
  }

  const judgementModels = decision.deepClassification ? buildJudgementModelNames(decision) : [];
  if (judgementModels.length > 0) {
    const note = document.createElement("p");
    note.className = "truly-headsup-model-note";
    note.textContent = t("content.headsup.modelNote", lang, {
      models: judgementModels.join(lang === "zh-TW" ? "、" : ", "),
    });
    detail.appendChild(note);
  }

  if (detail.childElementCount === 0) return null;
  return detail;
}
