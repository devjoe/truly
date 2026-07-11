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

function pureAppShellClassification(note: string | undefined): boolean {
  if (!note) return false;
  const normalized = note.trim().replace(/\s+/g, " ");
  const strictMatch = [
    /^(?:此|這)(?:頁|頁面)?(?:為|是)(?:一個)?(?:搜尋|搜索|動態應用程式|應用程式|瀏覽器(?:操作|設定)?)(?:介面|頁面)(?:，|,)?(?:並)?(?:非|不是|並非)(?:一般)?文章(?:頁面)?[。.!]?$/u,
    /^(?:此|這)(?:頁|頁面)?(?:為|是)(?:一個)?(?:搜尋|搜索|動態應用程式|應用程式|瀏覽器(?:操作|設定)?)(?:介面|頁面)[。.!]?$/u,
    /^(?:this|the current)(?: page)? is (?:an? )?(?:search interface|dynamic app(?:lication)? shell|application interface|browser (?:instruction|settings?) page)(?:,? (?:and is )?not (?:an? )?article(?: page)?)?[.!]?$/iu,
  ].some((pattern) => pattern.test(normalized));
  if (strictMatch) return true;
  if (normalized.length > 140) return false;
  const shellClassification = /(?:搜尋|搜索|工具|應用程式|瀏覽器|索引|列表).{0,12}(?:介面|頁面|入口|功能)|(?:search|tool|application|browser|index|listing).{0,14}(?:interface|shell|page|entry point)/iu.test(normalized);
  const hasContentSpecificDetail = /官方|來源|證據|時效|過時|風險|警告|日期|發布|最新|[：:]|、|前[一二三四五六七八九十\d]|第[一二三四五六七八九十\d]|結果來自|official|source|evidence|outdated|risk|warning|published|latest|first \d/iu.test(normalized);
  return shellClassification && !hasContentSpecificDetail;
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
  analysisNote: string | undefined,
  tr: Translate,
): PageContextPresentation | undefined {
  const warnings = surface.extraction.warnings;
  const effective = advisor?.effectiveModelContext;
  const allowedUse = effective?.allowedUse;
  const pageType = effective?.pageType ?? advisor?.advice?.pageType;
  const appShellContext = pageType === "app_shell" || pureAppShellClassification(analysisNote);
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
      summary: tr(appShellContext
        ? "sidepanel.page.context.summary.appShellRequiresTarget"
        : "sidepanel.page.context.summary.requiresTarget"),
    };
  }
  if (allowedUse === "page_overview_only") {
    return {
      tone: "info",
      summary: tr(appShellContext
        ? "sidepanel.page.context.summary.appShellOverview"
        : warnings.includes("large-navigation-noise")
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
    ? contextPresentation(input.surface, input.context, input.advisor, note, input.tr)
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
  ) || Boolean(
    input.workspace === "page" &&
    pageContext &&
    (allowedUse === "requires_user_target" || allowedUse === "page_overview_only") &&
    pureAppShellClassification(note),
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
