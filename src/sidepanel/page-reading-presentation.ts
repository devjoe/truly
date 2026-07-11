import type { GeneralPageModelContext } from "../lib/general-page-model-context";
import type { GeneralPageEffectiveModelContextUse } from "../lib/general-page-parser-advisor";
import type { ReadingExtractionWarning, ReadingSurface } from "../lib/reading-surface-types";
import type { ReadingTarget } from "../lib/reading-target-types";
import type {
  PageReadingAdvisorSession,
  PageReadingAnalysisSession,
  PageSessionStatus,
} from "./page-reading-session";

export type ReadingWorkspace = "page" | "focus";
export type PageContextPresentationTone = "info" | "caution" | "action-required";

export interface PageContextPresentation {
  tone: PageContextPresentationTone;
  summary: string;
  status?: string;
}

export interface PageReadingPresentation {
  surfaceState: "empty" | "loading" | "ready" | "error" | "stale";
  focusState: "empty" | "ready" | "error";
  hidePendingAdvisorState: boolean;
  hideReadyPipelineState: boolean;
  hideTechnicalDetails: boolean;
  pageContext?: PageContextPresentation;
  focusAdvisory?: "aggregation" | "navigation";
  focusOverview?: "selection" | "region";
  omitBriefNote: boolean;
}

type Translate = (key: string, params?: Record<string, string | number>) => string;

function aggregationGuidance(note: string | undefined): boolean {
  return Boolean(note) &&
    /新聞(?:彙整|聚合)頁面|索引|列表|(?:各)?來源連結|news aggregation|index|feed|source links?/iu.test(note ?? "");
}

function noteMatchesPageContext(
  note: string | undefined,
  warnings: ReadingExtractionWarning[],
  allowedUse: GeneralPageEffectiveModelContextUse | undefined,
): boolean {
  if (!note) return false;
  const patterns: Partial<Record<ReadingExtractionWarning, RegExp>> = {
    "large-navigation-noise": /(?:導覽|導航).*(?:雜訊|噪音)|(?:navigation).*(?:noise)|(?:點擊|click).*(?:標題|headline).*(?:完整|full)/iu,
    "no-main-content": /(?:正文|主內容|main[ -]?content).*(?:找不到|未找到|missing|not found)/iu,
    "very-short-content": /(?:文字|內容).*(?:較少|過短)|(?:text|content).*(?:short|limited)/iu,
    "login-or-paywall-like": /登入|付費牆|login|paywall/iu,
    "dynamic-content-partial": /(?:動態|載入).*(?:不完整|尚未完成)|(?:dynamic|loading).*(?:partial|incomplete)/iu,
  };
  if (warnings.some((warning) => patterns[warning]?.test(note) === true)) return true;
  return allowedUse === "page_overview_only" && aggregationGuidance(note);
}

function contextPresentation(
  surface: ReadingSurface,
  context: GeneralPageModelContext | undefined,
  advisor: PageReadingAdvisorSession | undefined,
  tr: Translate,
): PageContextPresentation | undefined {
  const warnings = surface.extraction.warnings;
  const effective = advisor?.effectiveModelContext;
  const allowedUse = effective?.allowedUse;
  if (effective?.source === "candidate-block" && allowedUse === "article_or_selection_analysis") return undefined;
  if (warnings.includes("login-or-paywall-like")) {
    return {
      tone: "action-required",
      status: tr("sidepanel.page.context.status.blocked"),
      summary: tr("sidepanel.page.context.advisory.paywall"),
    };
  }
  if (allowedUse === "blocked") {
    return {
      tone: "action-required",
      status: tr("sidepanel.page.context.status.blocked"),
      summary: tr("sidepanel.page.advisor.detail.needsTarget"),
    };
  }
  if (allowedUse === "requires_user_target") {
    return {
      tone: "action-required",
      status: tr("sidepanel.page.context.status.needsTarget"),
      summary: tr("sidepanel.page.context.summary.requiresTarget"),
    };
  }
  if (allowedUse === "page_overview_only") {
    return {
      tone: "info",
      summary: tr(warnings.includes("large-navigation-noise")
        ? "sidepanel.page.context.summary.overviewNavigation"
        : "sidepanel.page.context.summary.overview"),
    };
  }
  if (context?.modelReadiness === "blocked") {
    const summary = warnings.includes("very-short-content")
      ? tr("sidepanel.page.context.summary.short")
      : warnings.includes("no-main-content")
      ? tr("sidepanel.page.context.summary.noMain")
      : tr("sidepanel.page.advisor.detail.needsTarget");
    return {
      tone: "action-required",
      status: tr("sidepanel.page.context.status.blocked"),
      summary,
    };
  }
  if (warnings.includes("dynamic-content-partial")) return { tone: "caution", summary: tr("sidepanel.page.context.advisory.dynamic") };
  if (warnings.includes("large-navigation-noise")) return { tone: "caution", summary: tr("sidepanel.page.context.advisory.navigation") };
  if (warnings.includes("no-main-content")) return { tone: "caution", summary: tr("sidepanel.page.context.summary.noMain") };
  if (warnings.includes("very-short-content")) return { tone: "caution", summary: tr("sidepanel.page.context.summary.short") };
  if (surface.extraction.status === "partial" || context?.modelReadiness === "caution") {
    return { tone: "caution", summary: tr("sidepanel.page.context.summary.partial") };
  }
  if (advisor?.status === "error") return { tone: "caution", summary: tr("sidepanel.page.advisor.detail.error") };
  return undefined;
}

function hideReadyPipeline(
  context: GeneralPageModelContext | undefined,
  advisor: PageReadingAdvisorSession | undefined,
  analysis: PageReadingAnalysisSession | undefined,
): boolean {
  if (!context || !advisor || (analysis?.status !== "ready" && analysis?.status !== "running")) return false;
  if (context.modelReadiness !== "ready" || context.targetKind !== "page") return false;
  const effective = advisor.effectiveModelContext;
  return advisor.status === "not_needed" ||
    (advisor.status === "ready" && advisor.advice?.decision === "accept_current" &&
      effective?.allowedUse === "article_or_selection_analysis");
}

export function projectPageReadingPresentation(input: {
  workspace: ReadingWorkspace;
  status?: PageSessionStatus;
  surface?: ReadingSurface;
  context?: GeneralPageModelContext;
  advisor?: PageReadingAdvisorSession;
  analysis?: PageReadingAnalysisSession;
  target?: ReadingTarget;
  hasFocusError?: boolean;
  tr: Translate;
}): PageReadingPresentation {
  const warnings = input.surface?.extraction.warnings ?? [];
  const allowedUse = input.analysis?.allowedUse ?? input.advisor?.effectiveModelContext?.allowedUse;
  const note = input.analysis?.brief?.note;
  const hidePendingAdvisorState = input.context?.targetKind === "page" && input.advisor?.status === "checking";
  const hideReadyPipelineState = hidePendingAdvisorState || hideReadyPipeline(input.context, input.advisor, input.analysis);
  const hideTechnicalDetails = hidePendingAdvisorState || Boolean(
    input.surface &&
    hideReadyPipelineState &&
    input.surface.extraction.method === "semantic-html" &&
    input.surface.extraction.status === "complete" &&
    warnings.length === 0,
  );
  const pageContext = input.workspace === "page" && !hidePendingAdvisorState && input.surface
    ? contextPresentation(input.surface, input.context, input.advisor, input.tr)
    : undefined;
  const focusAdvisory = input.workspace !== "focus"
    ? undefined
    : aggregationGuidance(note)
    ? "aggregation"
    : noteMatchesPageContext(note, warnings, allowedUse)
    ? "navigation"
    : undefined;
  const omitBriefNote = Boolean(
    input.workspace === "page" && pageContext && note && noteMatchesPageContext(note, warnings, allowedUse),
  ) || Boolean(focusAdvisory);
  const surfaceState = input.surface
    ? "ready"
    : input.status === "loading"
    ? "loading"
    : input.status === "error"
    ? "error"
    : input.status === "stale"
    ? "stale"
    : "empty";
  return {
    surfaceState,
    focusState: input.hasFocusError ? "error" : input.target ? "ready" : "empty",
    hidePendingAdvisorState,
    hideReadyPipelineState,
    hideTechnicalDetails,
    pageContext,
    focusAdvisory,
    focusOverview: input.workspace === "focus" && input.target
      ? input.target.kind === "selection" ? "selection" : "region"
      : undefined,
    omitBriefNote,
  };
}
