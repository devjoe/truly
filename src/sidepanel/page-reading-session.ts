import type { GeneralPageBrief } from "../lib/general-page-analysis";
import type { GeneralPageEffectiveModelContextUse, GeneralPageParserAdvisorAdvice, GeneralPageParserAdvisorCandidateBlock, GeneralPageParserAdvisorRequest } from "../lib/general-page-parser-advisor";
import type { GeneralPageParserAdvisorProviderRuntime } from "../lib/messages";
import { isMeaningfullySamePage, pageUrlIdentity, type PageUrlIdentity } from "../lib/page-url-identity";
import type { ReadingSurface } from "../lib/reading-surface-types";
import type { ReadingTarget } from "../lib/reading-target-types";

export type PageSessionStatus = "idle" | "loading" | "ready" | "error" | "stale";
export type PageActivationSource = "toolbar" | "popup" | "sidepanel" | "hotkey";
export type PageReadingScopeKind = "page" | "focus";
export type PageReadingAdvisorStatus = "not_needed" | "checking" | "ready" | "error";
export type PageReadingAnalysisStatus = "idle" | "running" | "ready" | "error";

export interface PageReadingScreenshotSession {
  status: "offer" | "preview" | "sending" | "sent" | "error";
  dataUrl?: string;
  error?: string;
  updatedAt: number;
}

export interface PageReadingAdvisorSession {
  status: PageReadingAdvisorStatus;
  request?: GeneralPageParserAdvisorRequest;
  advice?: GeneralPageParserAdvisorAdvice;
  effectiveModelContext?: import("../lib/general-page-parser-advisor").GeneralPageEffectiveModelContext;
  providerRuntime?: GeneralPageParserAdvisorProviderRuntime;
  error?: string;
  updatedAt: number;
}

export interface PageReadingAnalysisSession {
  status: PageReadingAnalysisStatus;
  key?: string;
  brief?: GeneralPageBrief;
  error?: string;
  allowedUse?: GeneralPageEffectiveModelContextUse;
  updatedAt: number;
}

export interface PageClaimInvestigationItemSession {
  claimIndex: number;
  /** Missing only for older synthetic fixtures that predate background preparation. */
  status?: "preparing" | "ready" | "ineligible" | "unavailable";
  preparedClaim?: import("../lib/general-page-analysis").GeneralPageBriefClaim;
}

export interface PageClaimInvestigationSession extends Partial<PageClaimInvestigationItemSession> {
  analysisKey: string;
  /** Current bounded batch. Legacy singular fields above remain readable for old ephemeral fixtures. */
  items?: PageClaimInvestigationItemSession[];
}

export interface ApprovedPageClaimProjection {
  items: Array<{
    claimIndex: number;
    claim: import("../lib/general-page-analysis").GeneralPageBriefClaim;
  }>;
  pending: boolean;
}

/**
 * Reading-model claims are provisional. Only claims that the independent
 * Investigation Adapter prepared and the local guard accepted may cross into
 * user-facing Page/Focus UI or exports.
 */
export function projectApprovedPageClaims(
  session: PageClaimInvestigationSession | undefined,
  analysisKey: string | undefined,
): ApprovedPageClaimProjection {
  if (!session || !analysisKey || session.analysisKey !== analysisKey) {
    return { items: [], pending: false };
  }
  const items = session.items ?? (
    typeof session.claimIndex === "number"
      ? [{
          claimIndex: session.claimIndex,
          status: session.status,
          preparedClaim: session.preparedClaim,
        }]
      : []
  );
  return {
    items: items
      .filter((item) => item.status === "ready" && Boolean(item.preparedClaim))
      .map((item) => ({ claimIndex: item.claimIndex, claim: item.preparedClaim! }))
      .sort((a, b) => a.claimIndex - b.claimIndex),
    pending: items.some((item) => item.status === "preparing"),
  };
}

export function investigationItemForClaim(
  session: PageClaimInvestigationSession | undefined,
  claimIndex: number,
): PageClaimInvestigationItemSession | undefined {
  if (!session) return undefined;
  const item = session.items?.find((candidate) => candidate.claimIndex === claimIndex);
  if (item) return item;
  return session.claimIndex === claimIndex
    ? { claimIndex, status: session.status, preparedClaim: session.preparedClaim }
    : undefined;
}

export interface PageReadingScopeState {
  advisor?: PageReadingAdvisorSession;
  analysis?: PageReadingAnalysisSession;
  screenshot?: PageReadingScreenshotSession;
  investigation?: PageClaimInvestigationSession;
}

export interface FocusReadingScopeState extends PageReadingScopeState {
  target?: ReadingTarget;
}

export interface PageReadingSession {
  requestId?: string;
  tabId: number;
  url: string;
  identity: PageUrlIdentity;
  title?: string;
  surface?: ReadingSurface;
  candidateBlocks?: GeneralPageParserAdvisorCandidateBlock[];
  status: PageSessionStatus;
  error?: string;
  updatedAt: number;
  startedAt?: number;
  completedAt?: number;
  elapsedMs?: number;
  activationSource: PageActivationSource;
  autoReadPending?: boolean;
  pageScope: PageReadingScopeState;
  focusScope?: FocusReadingScopeState;
}

export interface MaterializedPageReadingSession extends PageReadingSession {
  target?: ReadingTarget;
  advisor?: PageReadingAdvisorSession;
  analysis?: PageReadingAnalysisSession;
  screenshot?: PageReadingScreenshotSession;
  investigation?: PageClaimInvestigationSession;
}

export function pageScopeForSession(session: PageReadingSession): PageReadingScopeState {
  return session.pageScope;
}

export function focusScopeForSession(session: PageReadingSession): FocusReadingScopeState | undefined {
  return session.focusScope;
}

export function scopeStateForSession(
  session: PageReadingSession,
  scope: PageReadingScopeKind,
): PageReadingScopeState | FocusReadingScopeState {
  return scope === "focus" ? focusScopeForSession(session) ?? {} : pageScopeForSession(session);
}

export function materializeScopeSession(
  session: PageReadingSession,
  scope: PageReadingScopeKind,
): MaterializedPageReadingSession {
  const state = scopeStateForSession(session, scope);
  const target = scope === "focus" ? (state as FocusReadingScopeState).target : undefined;
  return {
    ...session,
    target,
    advisor: state.advisor,
    analysis: state.analysis,
    screenshot: state.screenshot,
    investigation: state.investigation,
  };
}

export function replaceScopeState(
  session: PageReadingSession,
  scope: PageReadingScopeKind,
  state: PageReadingScopeState | FocusReadingScopeState,
): PageReadingSession {
  return scope === "focus"
    ? { ...session, focusScope: state as FocusReadingScopeState }
    : { ...session, pageScope: state };
}

export function clearSessionForMeaningfulNavigation(
  session: PageReadingSession,
  input: { url: string; title?: string; updatedAt: number },
): PageReadingSession {
  return {
    ...session,
    requestId: undefined,
    url: input.url,
    title: input.title || session.title,
    surface: undefined,
    candidateBlocks: undefined,
    pageScope: {},
    focusScope: undefined,
    status: "stale",
    autoReadPending: undefined,
    updatedAt: input.updatedAt,
  };
}

export function beginPageReadingSession(input: {
  previous?: PageReadingSession;
  requestId: string;
  tabId: number;
  url: string;
  identity: PageUrlIdentity;
  title?: string;
  startedAt: number;
  activationSource: PageActivationSource;
  preserveFocus: boolean;
}): PageReadingSession {
  return {
    requestId: input.requestId,
    tabId: input.tabId,
    url: input.url,
    identity: input.identity,
    title: input.title,
    status: "loading",
    pageScope: {},
    focusScope: input.preserveFocus ? input.previous?.focusScope : undefined,
    startedAt: input.startedAt,
    updatedAt: input.startedAt,
    activationSource: input.activationSource,
  };
}

export function completePageReadingSession(input: {
  existing?: PageReadingSession;
  tabId: number;
  requestId?: string;
  surface: ReadingSurface;
  candidateBlocks?: GeneralPageParserAdvisorCandidateBlock[];
  completedAt: number;
  elapsedMs?: number;
  fallbackActivationSource?: PageActivationSource;
}): { session: PageReadingSession; preservedRecovery: boolean } {
  const { existing, surface } = input;
  const samePage = Boolean(existing && existing.status !== "stale" &&
    isMeaningfullySamePage(existing.identity, surface.url));
  const existingPageScope = existing?.pageScope ?? {};
  const screenshot = samePage ? existingPageScope.screenshot : undefined;
  const preservedRecovery = Boolean(screenshot);
  return {
    preservedRecovery,
    session: {
      requestId: input.requestId ?? existing?.requestId,
      tabId: input.tabId,
      url: surface.url,
      identity: pageUrlIdentity(surface.url, surface.canonicalUrl),
      title: surface.title,
      surface,
      candidateBlocks: input.candidateBlocks ?? [],
      status: "ready",
      updatedAt: input.completedAt,
      startedAt: existing?.startedAt ?? (typeof input.elapsedMs === "number" ? input.completedAt - input.elapsedMs : undefined),
      completedAt: input.completedAt,
      elapsedMs: input.elapsedMs,
      activationSource: existing?.activationSource ?? input.fallbackActivationSource ?? "toolbar",
      pageScope: preservedRecovery
        ? {
            advisor: existingPageScope.advisor,
            analysis: existingPageScope.analysis,
            screenshot,
          }
        : {},
      focusScope: samePage ? existing?.focusScope : undefined,
    },
  };
}

export function applyReadingTargetToSession(input: {
  session: PageReadingSession;
  surface: ReadingSurface;
  target: ReadingTarget;
  updatedAt: number;
}): PageReadingSession {
  return {
    ...input.session,
    surface: input.surface,
    status: "ready",
    updatedAt: input.updatedAt,
    pageScope: input.session.pageScope,
    focusScope: { target: input.target },
  };
}

export function failPageReadingSession(input: {
  existing?: PageReadingSession;
  requestId?: string;
  tabId: number;
  url: string;
  identity: PageUrlIdentity;
  title?: string;
  error: string;
  completedAt: number;
  elapsedMs?: number;
  fallbackActivationSource?: PageActivationSource;
}): PageReadingSession {
  return {
    requestId: input.requestId ?? input.existing?.requestId,
    tabId: input.tabId,
    url: input.url,
    identity: input.existing?.identity ?? input.identity,
    title: input.existing?.title ?? input.title,
    surface: input.existing?.surface,
    candidateBlocks: input.existing?.candidateBlocks,
    pageScope: input.existing?.pageScope ?? {},
    focusScope: input.existing?.focusScope,
    status: "error",
    error: input.error,
    updatedAt: input.completedAt,
    startedAt: input.existing?.startedAt ?? (typeof input.elapsedMs === "number" ? input.completedAt - input.elapsedMs : undefined),
    completedAt: input.completedAt,
    elapsedMs: input.elapsedMs,
    activationSource: input.existing?.activationSource ?? input.fallbackActivationSource ?? "toolbar",
  };
}
