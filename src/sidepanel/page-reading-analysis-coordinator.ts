import {
  buildGeneralPageModelContext,
  type GeneralPageModelContext,
} from "../lib/general-page-model-context";
import {
  generalPageBriefEligibility,
  type GeneralPageAnalysisEligibilityReason,
} from "../lib/general-page-analysis";
import type {
  GeneralPageEffectiveModelContext,
  GeneralPageEffectiveModelContextUse,
} from "../lib/general-page-parser-advisor";
import type {
  GeneralPageAnalysisRequestMsg,
  GeneralPageAnalysisResultMsg,
  GeneralPageParserAdvisorProviderRuntime,
} from "../lib/messages";
import { isMeaningfullySamePage } from "../lib/page-url-identity";
import type { Lang } from "../lib/types";
import {
  scopeStateForSession,
  type MaterializedPageReadingSession,
  type PageReadingAnalysisSession,
  type PageReadingScopeKind,
  type PageReadingSession,
} from "./page-reading-session";

export type PageReadingAnalysisSkipReason =
  | GeneralPageAnalysisEligibilityReason
  | "missing_effective_context"
  | "missing_surface"
  | "provider_not_configured"
  | "already_running_or_ready";

export interface PageReadingAnalysisRun {
  key: string;
  scope: PageReadingScopeKind;
  allowedUse: GeneralPageEffectiveModelContextUse;
  running: PageReadingAnalysisSession;
  message: GeneralPageAnalysisRequestMsg;
}

export type PageReadingAnalysisPlan =
  | {
      kind: "skip";
      reason: PageReadingAnalysisSkipReason;
      eligibilityReason: GeneralPageAnalysisEligibilityReason;
      reportError: boolean;
    }
  | { kind: "start"; run: PageReadingAnalysisRun };

export type PageReadingAnalysisSettlement =
  | { kind: "ready"; analysis: PageReadingAnalysisSession }
  | { kind: "error"; analysis: PageReadingAnalysisSession };

function analysisContext(
  session: MaterializedPageReadingSession,
  effective: GeneralPageEffectiveModelContext,
): GeneralPageModelContext | undefined {
  const surface = session.surface;
  if (!surface) return undefined;
  const target = session.target;
  const base = buildGeneralPageModelContext(surface, target ? { target } : { targetKind: "page" });
  return {
    ...base,
    title: effective.title ?? base.title,
    url: effective.url || base.url,
    mainText: effective.mainText,
    modelEligible: effective.modelEligible,
    modelReadiness: effective.modelReadiness,
    ineligibilityReason: effective.modelEligible ? undefined : base.ineligibilityReason,
  };
}

function analysisKey(
  effective: GeneralPageEffectiveModelContext,
  providerRuntime: GeneralPageParserAdvisorProviderRuntime,
  screenshotConfirmed: boolean,
): string {
  const parts = [
    effective.allowedUse,
    effective.source,
    effective.mainText.length,
    effective.mainText.slice(0, 160),
    providerRuntime.effectiveProvider,
    providerRuntime.model,
  ];
  if (screenshotConfirmed) parts.push("screenshot");
  return parts.join("|");
}

export function planPageReadingAnalysis(input: {
  tabId: number;
  session: MaterializedPageReadingSession;
  scope: PageReadingScopeKind;
  force: boolean;
  activeTabId?: number | null;
  activeUrl?: string;
  outputLang: Lang;
  now: number;
  screenshotDataUrl?: string;
}): PageReadingAnalysisPlan {
  const effective = input.session.advisor?.effectiveModelContext;
  const providerRuntime = input.session.advisor?.providerRuntime;
  if (!effective || !providerRuntime) {
    return { kind: "skip", reason: "missing_effective_context", eligibilityReason: "provider_not_ready", reportError: input.force };
  }
  if (!input.session.surface) {
    return { kind: "skip", reason: "missing_surface", eligibilityReason: "session_not_ready", reportError: input.force };
  }
  const context = analysisContext(input.session, effective);
  if (!context) return { kind: "skip", reason: "missing_surface", eligibilityReason: "session_not_ready", reportError: input.force };
  const surfaceCurrent = input.tabId !== input.activeTabId ||
    !input.activeUrl ||
    isMeaningfullySamePage(input.session.identity, input.activeUrl);
  const screenshotConfirmed = Boolean(input.screenshotDataUrl);
  const eligibility = generalPageBriefEligibility({
    sessionReady: input.session.status === "ready",
    surfaceCurrent,
    context,
    allowedUse: effective.allowedUse,
    provider: providerRuntime.effectiveProvider,
    screenshotConfirmed,
  });
  if (!eligibility.ok) {
    return {
      kind: "skip",
      reason: eligibility.reason ?? "provider_not_ready",
      eligibilityReason: eligibility.reason ?? "provider_not_ready",
      reportError: input.force,
    };
  }
  if (!providerRuntime.canUseModel || !providerRuntime.endpoint || !providerRuntime.model) {
    return { kind: "skip", reason: "provider_not_configured", eligibilityReason: "provider_not_ready", reportError: input.force };
  }

  const key = analysisKey(effective, providerRuntime, screenshotConfirmed);
  const currentAnalysis = scopeStateForSession(input.session, input.scope).analysis;
  if (!input.force && currentAnalysis?.key === key &&
    (currentAnalysis.status === "running" || currentAnalysis.status === "ready")) {
    return { kind: "skip", reason: "already_running_or_ready", eligibilityReason: "provider_not_ready", reportError: false };
  }
  const running: PageReadingAnalysisSession = {
    status: "running",
    key,
    allowedUse: effective.allowedUse,
    updatedAt: input.now,
  };
  return {
    kind: "start",
    run: {
      key,
      scope: input.scope,
      allowedUse: effective.allowedUse,
      running,
      message: {
        type: "GENERAL_PAGE_ANALYSIS_REQUEST",
        tabId: input.tabId,
        analysisKey: key,
        scope: input.scope,
        priority: input.force ? "user_blocking" : "foreground",
        context,
        allowedUse: effective.allowedUse,
        providerRuntime,
        outputLang: input.outputLang,
        ...(input.screenshotDataUrl ? { screenshotDataUrl: input.screenshotDataUrl } : {}),
      },
    },
  };
}

export function pageReadingAnalysisRunIsCurrent(input: {
  run: PageReadingAnalysisRun;
  session?: PageReadingSession;
  tabId: number;
  activeTabId?: number | null;
  activeUrl?: string;
}): boolean {
  const { session, run } = input;
  if (!session || session.status === "stale") return false;
  if (scopeStateForSession(session, run.scope).analysis?.key !== run.key) return false;
  if (!session.surface || !isMeaningfullySamePage(session.identity, session.surface.url)) return false;
  if (input.tabId === input.activeTabId && input.activeUrl &&
    !isMeaningfullySamePage(session.identity, input.activeUrl)) return false;
  return true;
}

export function settlePageReadingAnalysis(input: {
  run: PageReadingAnalysisRun;
  response?: unknown;
  error?: unknown;
  now: number;
}): PageReadingAnalysisSettlement {
  const base = {
    key: input.run.key,
    allowedUse: input.run.allowedUse,
    updatedAt: input.now,
  };
  if (input.error) {
    return {
      kind: "error",
      analysis: { ...base, status: "error", error: errorText(input.error) },
    };
  }
  if (!input.response || typeof input.response !== "object" ||
    (input.response as { type?: unknown }).type !== "GENERAL_PAGE_ANALYSIS_RESULT") {
    return {
      kind: "error",
      analysis: { ...base, status: "error", error: "general_page_brief_no_response" },
    };
  }
  const result = input.response as GeneralPageAnalysisResultMsg;
  if (!result.ok || !result.brief) {
    return {
      kind: "error",
      analysis: { ...base, status: "error", error: result.error || "general_page_brief_failed" },
    };
  }
  return {
    kind: "ready",
    analysis: { ...base, status: "ready", brief: result.brief },
  };
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
