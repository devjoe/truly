import { t } from "../lib/i18n";
import {
  buildGeneralPageModelContext,
  GENERAL_PAGE_MODEL_MIN_MAIN_TEXT_LENGTH,
  type GeneralPageModelContext,
  type GeneralPageModelIneligibilityReason,
  type GeneralPageModelQualityIssue,
  type GeneralPageModelSourceLink,
} from "../lib/general-page-model-context";
import { GENERAL_PAGE_MIN_SELECTED_TEXT_LENGTH } from "../lib/general-page-extraction";
import {
  buildGeneralPageEffectiveModelContext,
  buildGeneralPageParserAdvisorRequest,
  GENERAL_PAGE_ADVISOR_PROVIDER_CONFIG_SOURCE,
  type GeneralPageEffectiveModelContext,
  type GeneralPageEffectiveModelContextUse,
  type GeneralPageParserAdvisorAdvice,
  type GeneralPageParserAdvisorCandidateBlock,
  type GeneralPageParserAdvisorRequest,
} from "../lib/general-page-parser-advisor";
import {
  canOfferGeneralPageScreenshot,
  generalPageBriefEligibility,
  type GeneralPageAnalysisEligibilityReason,
  type GeneralPageBrief,
} from "../lib/general-page-analysis";
import type { Lang, UserSettings } from "../lib/types";
import { DEFAULT_SETTINGS } from "../lib/types";
import type {
  GeneralPageCandidateBlockTextResultMsg,
  GeneralPageAnalysisResultMsg,
  GeneralPageParserAdvisorProviderRuntime,
  GeneralPageParserAdvisorResultMsg,
  PageReadingErrorMsg,
  PageReadingResultMsg,
  ReadingTargetErrorMsg,
  ReadingTargetResultMsg,
  TrulyMessage,
} from "../lib/messages";
import {
  getTierBProvider,
  resolveEffectiveTierBEndpoint,
  resolveEffectiveTierBModel,
  resolveEffectiveTierBProvider,
} from "../lib/settings";
import { providerRuntimeEndpoint, providerRuntimeModel } from "../lib/model-provider-runtime";
import { providerCapabilities, providerNeedsEndpoint } from "../lib/provider-capabilities";
import type { ReadingSurface } from "../lib/reading-surface-types";
import type { ReadingTarget, ReadingTargetErrorReason } from "../lib/reading-target-types";
import { isSupportedScreenshotDataUrl } from "../lib/screenshot-data-url";
import {
  isMeaningfullySamePage,
  pageUrlIdentity,
  type PageUrlIdentity,
} from "../lib/page-url-identity";
import { safeFilenamePart, saveMarkdownTextFile } from "./browser-actions";
import type { TabId } from "./tabs";

type PagePlatform = "facebook" | "general" | "unsupported";
type PageSessionStatus = "idle" | "loading" | "ready" | "error" | "stale";
type PageActivationSource = "toolbar" | "popup" | "sidepanel" | "hotkey";
const LOADING_ELAPSED_VISIBLE_THRESHOLD_MS = 2_000;

interface PageReadingSession {
  tabId: number;
  url: string;
  identity: PageUrlIdentity;
  title?: string;
  surface?: ReadingSurface;
  target?: ReadingTarget;
  candidateBlocks?: GeneralPageParserAdvisorCandidateBlock[];
  status: PageSessionStatus;
  error?: string;
  updatedAt: number;
  startedAt?: number;
  completedAt?: number;
  elapsedMs?: number;
  activationSource: PageActivationSource;
  advisor?: PageReadingAdvisorSession;
  analysis?: PageReadingAnalysisSession;
  screenshot?: PageReadingScreenshotSession;
}

/**
 * Session-only screenshot confirmation state. The data URL lives in memory
 * for the confirmation preview only; it is never persisted, logged, or kept
 * after the analysis request is sent or cancelled.
 */
interface PageReadingScreenshotSession {
  status: "offer" | "preview" | "sending" | "sent" | "error";
  dataUrl?: string;
  error?: string;
  updatedAt: number;
}

type PageReadingAdvisorStatus = "not_needed" | "checking" | "ready" | "error";
type PageReadingAnalysisStatus = "idle" | "running" | "ready" | "error";

interface PageReadingAdvisorSession {
  status: PageReadingAdvisorStatus;
  request?: GeneralPageParserAdvisorRequest;
  advice?: GeneralPageParserAdvisorAdvice;
  effectiveModelContext?: GeneralPageEffectiveModelContext;
  providerRuntime?: GeneralPageParserAdvisorProviderRuntime;
  error?: string;
  updatedAt: number;
}

interface PageReadingAnalysisSession {
  status: PageReadingAnalysisStatus;
  key?: string;
  brief?: GeneralPageBrief;
  error?: string;
  allowedUse?: GeneralPageEffectiveModelContextUse;
  updatedAt: number;
}

interface BrowserTab {
  id?: number;
  url?: string;
  title?: string;
  active?: boolean;
  windowId?: number;
}

interface PageActivationAuditState {
  tabId: number;
  existingTabId?: number;
  updatedTabId?: number;
  windowId?: number;
  focused?: boolean;
  error?: string;
}

interface TabsApi {
  query(queryInfo: { active?: boolean; currentWindow?: boolean }): Promise<BrowserTab[]>;
  onActivated?: {
    addListener(listener: (activeInfo: { tabId: number; windowId: number }) => void): void;
  };
  onUpdated?: {
    addListener(listener: (tabId: number, changeInfo: { url?: string; status?: string }, tab: BrowserTab) => void): void;
  };
  onRemoved?: {
    addListener(listener: (tabId: number, removeInfo: { windowId: number; isWindowClosing: boolean }) => void): void;
  };
  get?(tabId: number): Promise<BrowserTab>;
  update?(tabId: number, updateProperties: { active?: boolean }): Promise<BrowserTab | undefined>;
  focusWindow?(windowId: number): Promise<unknown>;
  captureVisibleTab?(windowId: number, options: { format?: "jpeg" | "png"; quality?: number }): Promise<string>;
}

interface RuntimeApi {
  sendMessage(message: TrulyMessage): Promise<unknown>;
}

/** chrome.storage.session subset used to consume hotkey read markers. */
export interface PageReadingSessionStore {
  get(key: string): Promise<Record<string, unknown>>;
  remove(key: string): Promise<unknown>;
  onChanged?: {
    addListener(
      listener: (changes: Record<string, { newValue?: unknown }>, areaName: string) => void,
    ): void;
  };
}

export const PENDING_CURRENT_REGION_READ_KEY = "pendingCurrentRegionRead";
const PENDING_CURRENT_REGION_READ_MAX_AGE_MS = 30_000;

export interface SidepanelPageReadingRuntime {
  install(): void;
  requestReadCurrentPage(source?: PageActivationSource): Promise<void>;
  requestPointTarget(tabId: number): Promise<void>;
  auditState(): { activeTabId: number | null; displayTabId: number | null; lastActivation?: PageActivationAuditState };
  handlePageReadingResult(message: PageReadingResultMsg): void;
  handlePageReadingError(message: PageReadingErrorMsg): void;
}

export interface CreateSidepanelPageReadingRuntimeOptions {
  pagePaneEl: HTMLElement;
  runtime: RuntimeApi;
  tabs: TabsApi;
  activateTab(tab: TabId): void;
  getLang(): Lang;
  getSettings?(): UserSettings;
  getTierAEndpoint?(): string | undefined;
  getTierAModel?(): string | undefined;
  now(): number;
  sessionStore?: PageReadingSessionStore;
  /** True when the configured Tier B provider passed the vision probe. */
  getVisionSupported?(): boolean;
}

function escapeHtml(input: string): string {
  return input
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatCount(value: number | undefined): string {
  return String(value ?? 0);
}

function formatUpdatedAt(timestamp: number, lang: Lang): string {
  try {
    return new Intl.DateTimeFormat(lang, {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    }).format(new Date(timestamp));
  } catch {
    return new Date(timestamp).toLocaleTimeString();
  }
}

function formatElapsedSeconds(ms: number, lang: Lang): string {
  const seconds = ms < 10_000
    ? Math.round(ms / 100) / 10
    : Math.round(ms / 1000);
  return lang === "zh-TW" ? `${seconds} 秒` : `${seconds}s`;
}

function visibleLoadingElapsedMs(session: PageReadingSession | undefined, nowMs: number): number | undefined {
  if (!session?.startedAt || session.status !== "loading") return undefined;
  const elapsedMs = Math.max(0, nowMs - session.startedAt);
  return elapsedMs >= LOADING_ELAPSED_VISIBLE_THRESHOLD_MS ? elapsedMs : undefined;
}

function stableElapsedMs(session: PageReadingSession | undefined): number | undefined {
  if (typeof session?.elapsedMs === "number" && Number.isFinite(session.elapsedMs)) {
    return Math.max(0, session.elapsedMs);
  }
  if (typeof session?.startedAt === "number" && typeof session.completedAt === "number") {
    return Math.max(0, session.completedAt - session.startedAt);
  }
  return undefined;
}

function isHttpLikeUrl(rawUrl: string | undefined): boolean {
  if (!rawUrl) return false;
  try {
    const url = new URL(rawUrl);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function platformForUrl(rawUrl: string | undefined): PagePlatform {
  if (!rawUrl) return "unsupported";
  try {
    const url = new URL(rawUrl);
    const host = url.hostname.toLowerCase();
    if (host === "facebook.com" || host.endsWith(".facebook.com")) return "facebook";
    return url.protocol === "http:" || url.protocol === "https:" ? "general" : "unsupported";
  } catch {
    return "unsupported";
  }
}

function hostnameForUrl(rawUrl: string): string {
  try {
    return new URL(rawUrl).hostname;
  } catch {
    return rawUrl;
  }
}

function visibleExcerpt(
  surface: ReadingSurface,
  modelContext?: GeneralPageModelContext,
  effectiveContext?: GeneralPageEffectiveModelContext,
): string {
  const sourceText = effectiveContext?.source === "candidate-block"
    ? effectiveContext.mainText
    : modelContext && (modelContext.targetKind !== "page" || modelContext.qualityIssues.length > 0)
    ? modelContext.mainText
    : surface.excerpt || surface.mainText;
  const text = (sourceText || "").trim().replace(/\s+/g, " ");
  if (text.length <= 1200) return text;
  return `${text.slice(0, 1197)}...`;
}

function buildCopyText(session: PageReadingSession): string {
  const surface = session.surface;
  const lines = [
    `Title: ${surface?.title || session.title || "(untitled)"}`,
    `URL: ${surface?.canonicalUrl || surface?.url || session.url}`,
  ];
  if (surface?.sourceName) lines.push(`Source: ${surface.sourceName}`);
  if (surface?.authorName) lines.push(`Author: ${surface.authorName}`);
  if (surface?.publishedAt) lines.push(`Published: ${surface.publishedAt}`);
  if (surface?.extraction) {
    lines.push(`Extraction: ${surface.extraction.method} / ${surface.extraction.status}`);
    if (surface.extraction.warnings.length > 0)
      lines.push(`Warnings: ${surface.extraction.warnings.join(", ")}`);
  }
  const modelContext = surface ? modelContextForSession({ ...session, surface }) : undefined;
  const excerpt = surface ? visibleExcerpt(surface, modelContext, session.advisor?.effectiveModelContext) : "";
  if (excerpt) lines.push("", "Excerpt:", excerpt);
  const brief = session.analysis?.status === "ready" ? session.analysis.brief : undefined;
  if (brief) lines.push(...generalPageBriefCopyLines(brief, session.analysis?.allowedUse));
  return lines.join("\n");
}

function buildPageMarkdownFilename(session: PageReadingSession): string {
  const date = new Date(session.updatedAt).toISOString().slice(0, 10);
  const title = safeFilenamePart(session.surface?.title || session.title, "page");
  const domain = safeFilenamePart(hostnameForUrl(session.surface?.canonicalUrl || session.surface?.url || session.url), "web");
  return `truly-page-${date}-${domain}-${title}.md`;
}

function generalPageBriefCopyLines(
  brief: GeneralPageBrief,
  allowedUse: GeneralPageEffectiveModelContextUse | undefined,
): string[] {
  const lines = ["", "Page brief:", brief.summary];
  if (allowedUse === "page_overview_only") lines.push("Scope: page overview");
  if (brief.bg?.length) {
    lines.push("", "Page context:");
    for (const item of brief.bg) lines.push(`- ${item.t}: ${item.why}${item.q ? ` (${item.q})` : ""}`);
  }
  if (brief.claims?.length) {
    lines.push("", "Claims to inspect:");
    for (const claim of brief.claims) lines.push(`- ${claim.c}: ${claim.why} Need: ${claim.need}`);
  }
  if (brief.qs?.length) {
    lines.push("", "Questions:");
    for (const question of brief.qs) lines.push(`- [${question.kind}] ${question.q}`);
  }
  if (brief.note) lines.push("", `Note: ${brief.note}`);
  lines.push("", `Analyzed by: ${brief.model}${brief.elapsedMs ? ` (${Math.round(brief.elapsedMs / 100) / 10}s)` : ""}`);
  return lines;
}

function modelContextForSession(session: PageReadingSession & { surface: ReadingSurface }): GeneralPageModelContext {
  if (session.target) {
    return buildGeneralPageModelContext(session.surface, {
      target: session.target,
      minMainTextLength: GENERAL_PAGE_MIN_SELECTED_TEXT_LENGTH,
    });
  }
  return buildGeneralPageModelContext(session.surface, { targetKind: "page" });
}

function sourceLinksHtml(links: GeneralPageModelSourceLink[], title: string): string {
  const visibleLinks = links.slice(0, 6);
  if (visibleLinks.length === 0) return "";
  return `
    <section class="page-reader-source-links">
      <h3>${escapeHtml(title)}</h3>
      <ul>
        ${visibleLinks.map((link) => {
          const label = link.text?.trim() || link.href;
          return `<li><a href="${escapeHtml(link.href)}" target="_blank" rel="noreferrer">${escapeHtml(label)}</a></li>`;
        }).join("")}
      </ul>
    </section>
  `;
}

function extractionDiagnosticsHtml(
  surface: ReadingSurface,
  rows: string[][],
  context: GeneralPageModelContext | undefined,
  tr: (key: string, params?: Record<string, string | number>) => string,
): string {
  const detailsOpen = context?.modelReadiness !== "ready" ||
    surface.extraction.status !== "complete" ||
    surface.extraction.method !== "semantic-html" ||
    surface.extraction.warnings.length > 0;
  return `
    <details class="page-reader-diagnostics page-reader-extraction-diagnostics"${detailsOpen ? " open" : ""}>
      <summary>${escapeHtml(tr("sidepanel.page.diagnostics.extraction"))}</summary>
      <dl class="page-reader-meta">
        ${rows.map(([label, value]) => `<div><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd></div>`).join("")}
      </dl>
    </details>
  `;
}

function modelContextHtml(
  context: GeneralPageModelContext | undefined,
  tr: (key: string, params?: Record<string, string | number>) => string,
): string {
  if (!context) return "";
  const statusText = context.modelReadiness === "ready"
    ? tr("sidepanel.page.model.ready")
    : context.modelReadiness === "caution"
    ? tr("sidepanel.page.model.caution")
    : tr("sidepanel.page.model.blocked");
  const reason = context.ineligibilityReason
    ? tr(modelIneligibilityKey(context.ineligibilityReason))
    : context.qualityIssues.length > 0
    ? context.qualityIssues.map((issue) => tr(modelQualityIssueKey(issue))).join(" ")
    : "";
  const rows: Array<[string, string, string?]> = [
    [tr("sidepanel.page.model.text"), `${context.mainText.length}/${GENERAL_PAGE_MODEL_MIN_MAIN_TEXT_LENGTH}`],
    [tr("sidepanel.page.model.links"), formatCount(context.links.length)],
    [tr("sidepanel.page.model.imageAlt"), formatCount(context.imageAltText.length)],
    [tr("sidepanel.page.model.target"), modelTargetKindLabel(context.targetKind, tr), context.targetKind],
  ];
  const detailsOpen = context.modelReadiness !== "ready";
  const compactReady = context.modelReadiness === "ready";
  return `
    <section class="page-reader-model-context is-${context.modelReadiness}${compactReady ? " is-compact" : ""}">
      <div class="page-reader-model-context-header">
        <h3>${escapeHtml(tr("sidepanel.page.model.title"))}</h3>
        <span>${escapeHtml(statusText)}</span>
      </div>
      ${compactReady ? "" : `<p>${escapeHtml(reason)}</p>`}
      <details class="page-reader-diagnostics"${detailsOpen ? " open" : ""}>
        <summary>${escapeHtml(tr("sidepanel.page.diagnostics.details"))}</summary>
        <dl>
          ${rows.map(([label, value, raw]) => diagnosticRowHtml(label, value, raw)).join("")}
        </dl>
      </details>
    </section>
  `;
}

function diagnosticRowHtml(label: string, value: string, rawValue?: string): string {
  const raw = rawValue && rawValue !== value ? ` data-raw-value="${escapeHtml(rawValue)}"` : "";
  return `<div><dt>${escapeHtml(label)}</dt><dd${raw}>${escapeHtml(value)}</dd></div>`;
}

function modelTargetKindLabel(
  targetKind: GeneralPageModelContext["targetKind"],
  tr: (key: string, params?: Record<string, string | number>) => string,
): string {
  if (targetKind === "selection") return tr("sidepanel.page.model.target.selection");
  if (targetKind === "current-region") return tr("sidepanel.page.model.target.currentRegion");
  return tr("sidepanel.page.model.target.page");
}

function modelIneligibilityKey(reason: GeneralPageModelIneligibilityReason): string {
  switch (reason) {
    case "empty_or_blocked":
      return "sidepanel.page.model.reason.emptyOrBlocked";
    case "main_text_too_short":
      return "sidepanel.page.model.reason.short";
    case "not_web_page":
      return "sidepanel.page.model.reason.notWebPage";
  }
}

function modelQualityIssueKey(issue: GeneralPageModelQualityIssue): string {
  switch (issue) {
    case "fallback_extraction":
      return "sidepanel.page.model.quality.fallback";
    case "partial_extraction":
      return "sidepanel.page.model.quality.partial";
    case "large_navigation_noise":
      return "sidepanel.page.model.quality.navigation";
    case "no_main_content":
      return "sidepanel.page.model.quality.noMain";
    case "dynamic_content_partial":
      return "sidepanel.page.model.quality.dynamic";
  }
}

function resolveAdvisorProviderRuntime(
  settings: UserSettings,
  tierAEndpoint: string | undefined,
  tierAModel: string | undefined,
): GeneralPageParserAdvisorProviderRuntime {
  const provider = getTierBProvider(settings);
  const effectiveProvider = resolveEffectiveTierBProvider(settings);
  const endpoint = providerRuntimeEndpoint(
    effectiveProvider,
    resolveEffectiveTierBEndpoint(settings, tierAEndpoint),
  );
  const model = providerRuntimeModel(
    effectiveProvider,
    resolveEffectiveTierBModel(settings, tierAModel),
  );
  const needsEndpoint = providerNeedsEndpoint(effectiveProvider);
  const canUseModel = Boolean(
    settings.deepClassifyEnabled &&
      provider !== "none" &&
      needsEndpoint &&
      endpoint &&
      model,
  );
  const blockedReason = canUseModel
    ? undefined
    : !settings.deepClassifyEnabled || provider === "none"
    ? "tier_b_not_enabled"
    : needsEndpoint && (!endpoint || !model)
    ? "tier_b_endpoint_or_model_missing"
    : "tier_b_unavailable";
  return {
    configSource: GENERAL_PAGE_ADVISOR_PROVIDER_CONFIG_SOURCE,
    provider,
    effectiveProvider,
    endpoint,
    model,
    canUseModel,
    mode: canUseModel ? "tier-b-short-json" : "rule-based-runtime-baseline",
    blockedReason,
  };
}

function providerRuntimeLabel(providerRuntime?: GeneralPageParserAdvisorProviderRuntime): string {
  if (!providerRuntime) return "";
  const label = providerCapabilities(providerRuntime.effectiveProvider).label.replace("（實驗）", "");
  return providerRuntime.model ? `${label} / ${providerRuntime.model}` : label;
}

function advisorDecisionLabel(
  advisor: PageReadingAdvisorSession,
  tr: (key: string, params?: Record<string, string | number>) => string,
): string {
  if (advisor.status === "not_needed") return tr("sidepanel.page.advisor.decision.notNeeded");
  if (advisor.status === "checking") return tr("sidepanel.page.advisor.decision.checking");
  if (advisor.status === "error") return tr("sidepanel.page.advisor.decision.error");
  return advisorDecisionValueLabel(advisor.advice?.decision, tr);
}

function advisorDecisionRaw(advisor: PageReadingAdvisorSession): string {
  if (advisor.status === "not_needed") return "accept_current";
  if (advisor.status === "checking") return "pending";
  if (advisor.status === "error") return "unavailable";
  return advisor.advice?.decision ?? "none";
}

function advisorDecisionValueLabel(
  decision: string | undefined,
  tr: (key: string, params?: Record<string, string | number>) => string,
): string {
  switch (decision) {
    case "accept_current":
      return tr("sidepanel.page.advisor.decision.acceptCurrent");
    case "prefer_candidate_block":
      return tr("sidepanel.page.advisor.decision.preferCandidate");
    case "downgrade_to_index_or_feed":
      return tr("sidepanel.page.advisor.decision.pageOverview");
    case "mark_blocked_or_empty":
      return tr("sidepanel.page.advisor.decision.blocked");
    case "request_user_selection":
      return tr("sidepanel.page.advisor.decision.userSelection");
    case "request_screenshot_region":
      return tr("sidepanel.page.advisor.decision.screenshot");
    default:
      return tr("sidepanel.page.advisor.decision.none");
  }
}

function allowedUseLabel(
  allowedUse: GeneralPageEffectiveModelContextUse | undefined,
  tr: (key: string, params?: Record<string, string | number>) => string,
): string {
  switch (allowedUse) {
    case "article_or_selection_analysis":
      return tr("sidepanel.page.advisor.allowedUse.article");
    case "page_overview_only":
      return tr("sidepanel.page.advisor.allowedUse.overview");
    case "requires_user_target":
      return tr("sidepanel.page.advisor.allowedUse.target");
    case "blocked":
      return tr("sidepanel.page.advisor.allowedUse.blocked");
    default:
      return "-";
  }
}

function advisorHtml(
  advisor: PageReadingAdvisorSession | undefined,
  tr: (key: string, params?: Record<string, string | number>) => string,
): string {
  if (!advisor) return "";
  const effective = advisor.effectiveModelContext;
  const provider = providerRuntimeLabel(advisor.providerRuntime) || tr("sidepanel.page.advisor.provider.local");
  const statusText = tr(`sidepanel.page.advisor.status.${advisor.status}`);
  const detail = advisor.status === "error"
    ? advisor.error || tr("sidepanel.page.advisor.detail.error")
    : advisor.status === "checking"
    ? tr("sidepanel.page.advisor.detail.checking")
    : advisor.status === "not_needed"
    ? tr("sidepanel.page.advisor.detail.notNeeded")
    : effective?.allowedUse === "page_overview_only"
    ? tr("sidepanel.page.advisor.detail.pageOverview")
    : effective?.allowedUse === "requires_user_target"
    ? tr("sidepanel.page.advisor.detail.needsTarget")
    : tr("sidepanel.page.advisor.detail.ready");
  const modelMode = advisor.providerRuntime?.mode === "tier-b-short-json" && advisor.providerRuntime.canUseModel
    ? tr("sidepanel.page.advisor.mode.modelReady")
    : advisor.providerRuntime?.mode === "tier-b-short-json-fallback"
    ? tr("sidepanel.page.advisor.mode.modelFallback")
    : tr("sidepanel.page.advisor.mode.localBaseline");
  const rows: Array<[string, string, string?]> = [
    [tr("sidepanel.page.advisor.decision"), advisorDecisionLabel(advisor, tr), advisorDecisionRaw(advisor)],
    [tr("sidepanel.page.advisor.provider"), provider],
    [tr("sidepanel.page.advisor.payload"), advisor.request ? `${advisor.request.payloadBudget.estimatedPayloadChars}/${advisor.request.payloadBudget.maxPayloadChars}` : "-"],
    [tr("sidepanel.page.advisor.allowedUse"), allowedUseLabel(effective?.allowedUse, tr), effective?.allowedUse],
    [tr("sidepanel.page.advisor.mode"), modelMode],
  ];
  const decision = advisor.advice?.decision;
  const detailsOpen = advisor.status === "checking" ||
    advisor.status === "error" ||
    effective?.allowedUse === "page_overview_only" ||
    effective?.allowedUse === "requires_user_target" ||
    (Boolean(decision) && decision !== "accept_current");
  return `
    <section class="page-reader-advisor is-${escapeHtml(advisor.status)}">
      <div class="page-reader-advisor-header">
        <h3>${escapeHtml(tr("sidepanel.page.advisor.title"))}</h3>
        <span>${escapeHtml(statusText)}</span>
      </div>
      <p>${escapeHtml(detail)}</p>
      <details class="page-reader-diagnostics"${detailsOpen ? " open" : ""}>
        <summary>${escapeHtml(tr("sidepanel.page.diagnostics.details"))}</summary>
        <dl>
          ${rows.map(([label, value, raw]) => diagnosticRowHtml(label, value, raw)).join("")}
        </dl>
      </details>
    </section>
  `;
}

function analysisHtml(
  analysis: PageReadingAnalysisSession | undefined,
  tr: (key: string, params?: Record<string, string | number>) => string,
): string {
  if (!analysis || analysis.status === "idle") return "";
  const title = tr("sidepanel.page.analysis.title");
  const statusText = tr(`sidepanel.page.analysis.status.${analysis.status}`);
  const body = analysis.status === "running"
    ? `<p>${escapeHtml(tr("sidepanel.page.analysis.running"))}</p>`
    : analysis.status === "error"
    ? `
      <p>${escapeHtml(analysis.error || tr("sidepanel.page.analysis.error"))}</p>
      <button id="pageAnalysisRetry" class="btn-investigation-secondary page-reader-analysis-retry" type="button">${escapeHtml(tr("sidepanel.page.analysis.retry"))}</button>
    `
    : analysis.brief
    ? briefHtml(analysis.brief, analysis.allowedUse, tr)
    : "";
  return `
    <section class="page-reader-analysis is-${escapeHtml(analysis.status)}">
      <div class="page-reader-analysis-header">
        <h3>${escapeHtml(title)}</h3>
        <span>${escapeHtml(statusText)}</span>
      </div>
      ${body}
    </section>
  `;
}

function briefHtml(
  brief: GeneralPageBrief,
  allowedUse: GeneralPageEffectiveModelContextUse | undefined,
  tr: (key: string, params?: Record<string, string | number>) => string,
): string {
  const modelNote = brief.elapsedMs
    ? tr("sidepanel.page.analysis.modelNoteWithElapsed", {
        model: brief.model,
        elapsed: Math.round(brief.elapsedMs / 100) / 10,
      })
    : tr("sidepanel.page.analysis.modelNote", { model: brief.model });
  return `
    ${allowedUse === "page_overview_only" ? `<div class="page-reader-analysis-badge">${escapeHtml(tr("sidepanel.page.analysis.overview"))}</div>` : ""}
    <p class="page-reader-analysis-summary">${escapeHtml(brief.summary)}</p>
    ${briefSectionHtml(tr("sidepanel.page.analysis.context"), brief.bg?.map((item) => `${item.t}: ${item.why}${item.q ? ` ${item.q}` : ""}`) ?? [])}
    ${allowedUse === "page_overview_only" ? "" : briefSectionHtml(tr("sidepanel.page.analysis.claims"), brief.claims?.map((claim) => `${claim.c}: ${claim.why} ${claim.need}`) ?? [])}
    ${briefSectionHtml(tr("sidepanel.page.analysis.questions"), brief.qs?.map((question) => question.q) ?? [])}
    ${brief.note ? `<p class="page-reader-analysis-note">${escapeHtml(brief.note)}</p>` : ""}
    <div class="page-reader-analysis-model">${escapeHtml(modelNote)}</div>
  `;
}

function briefSectionHtml(title: string, items: string[]): string {
  if (items.length === 0) return "";
  return `
    <div class="page-reader-analysis-section">
      <h4>${escapeHtml(title)}</h4>
      <ul>
        ${items.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}
      </ul>
    </div>
  `;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message.slice(0, 200) : "page_reader_unavailable";
}

export function createSidepanelPageReadingRuntime({
  pagePaneEl,
  runtime,
  tabs,
  activateTab,
  getLang,
  getSettings = () => DEFAULT_SETTINGS,
  getTierAEndpoint = () => undefined,
  getTierAModel = () => undefined,
  now,
  sessionStore,
  getVisionSupported = () => false,
}: CreateSidepanelPageReadingRuntimeOptions): SidepanelPageReadingRuntime {
  const sessions = new Map<number, PageReadingSession>();
  let activeTabId: number | null = null;
  let displayTabId: number | null = null;
  let activeUrl = "";
  let activeTitle = "";
  let installed = false;
  let copyState: "idle" | "copied" | "failed" = "idle";
  let downloadState: "idle" | "saved" | "cancelled" | "failed" = "idle";
  let lastActivation: PageActivationAuditState | undefined;
  let loadingTicker: ReturnType<typeof setInterval> | undefined;

  function tr(key: string, params?: Record<string, string | number>): string {
    return t(key, getLang(), params);
  }

  function currentSession(): PageReadingSession | undefined {
    const tabId = typeof displayTabId === "number" ? displayTabId : activeTabId;
    return typeof tabId === "number" ? sessions.get(tabId) : undefined;
  }

  function friendlyPageReadingError(error: string): string {
    if (error === "page_grant_missing" || error.includes("Cannot access contents of the page")) {
      return tr("sidepanel.page.error.needsToolbarActivation");
    }
    if (error === "page_reading_action_unsupported" || error === "reading_target_unsupported") {
      return tr("sidepanel.page.error.unsupportedAction");
    }
    return error;
  }

  function syncLoadingTicker(active: boolean): void {
    if (active && !loadingTicker) {
      loadingTicker = setInterval(() => {
        if (currentSession()?.status === "loading") render();
        else syncLoadingTicker(false);
      }, 1_000);
      return;
    }
    if (!active && loadingTicker) {
      clearInterval(loadingTicker);
      loadingTicker = undefined;
    }
  }

  function pageStatusLabel(session: PageReadingSession | undefined, fallback: string): string {
    if (!session) return fallback;
    const base = tr(`sidepanel.page.status.${session.status}`);
    const loadingElapsed = visibleLoadingElapsedMs(session, now());
    if (session.status === "loading" && typeof loadingElapsed === "number") {
      return tr("sidepanel.page.status.loadingWithElapsed", {
        elapsed: formatElapsedSeconds(loadingElapsed, getLang()),
      });
    }
    if (session.status === "error") {
      const elapsed = stableElapsedMs(session);
      if (typeof elapsed === "number") {
        return tr("sidepanel.page.status.errorWithElapsed", {
          elapsed: formatElapsedSeconds(elapsed, getLang()),
        });
      }
    }
    return base;
  }

  function pageStatusTitle(session: PageReadingSession | undefined, updatedAt: string): string {
    const elapsed = stableElapsedMs(session);
    if (typeof elapsed !== "number" || !updatedAt) return "";
    const key = session?.status === "error"
      ? "sidepanel.page.status.tooltipFailed"
      : "sidepanel.page.status.tooltip";
    return tr(key, {
      elapsed: formatElapsedSeconds(elapsed, getLang()),
      updatedAt,
    });
  }

  function setActiveTab(
    tab: BrowserTab | undefined,
    activate = true,
    displaySync: "browser-activation" | "status-update" | "manual-activation" = "browser-activation",
  ): void {
    const previousDisplayTabId = displayTabId;
    const previousDisplayedSession = currentSession();
    if (typeof tab?.id === "number") activeTabId = tab.id;
    activeUrl = tab?.url ?? activeUrl;
    activeTitle = tab?.title ?? activeTitle;
    const platform = platformForUrl(activeUrl);
    const shouldSyncDisplay = displaySync !== "status-update" ||
      !previousDisplayedSession ||
      previousDisplayTabId === tab?.id;
    if (typeof tab?.id === "number" && shouldSyncDisplay && (platform === "general" || sessions.has(tab.id) || !currentSession())) {
      displayTabId = tab.id;
    }
    if (activate) {
      if (platform === "facebook") activateTab("analysis");
      else if (platform === "general") activateTab("page");
    }
    const session = typeof tab?.id === "number" ? sessions.get(tab.id) : undefined;
    if (session && activeUrl && !isMeaningfullySamePage(session.identity, activeUrl)) {
      session.status = "stale";
      session.url = activeUrl;
      session.title = activeTitle || session.title;
      session.surface = undefined;
      session.target = undefined;
      session.candidateBlocks = undefined;
      session.advisor = undefined;
      session.analysis = undefined;
      session.updatedAt = now();
    }
    render();
  }

  function markTabSessionStale(tabId: number, tab: BrowserTab): void {
    const session = sessions.get(tabId);
    const nextUrl = tab.url;
    if (!session || !nextUrl || isMeaningfullySamePage(session.identity, nextUrl)) return;
    sessions.set(tabId, {
      ...session,
      url: nextUrl,
      title: tab.title || session.title,
      surface: undefined,
      target: undefined,
      candidateBlocks: undefined,
      advisor: undefined,
      analysis: undefined,
      screenshot: undefined,
      status: "stale",
      updatedAt: now(),
    });
    if (tabId === displayTabId) render();
  }

  async function refreshActiveTab(activate = true): Promise<BrowserTab | undefined> {
    const [tab] = await tabs.query({ active: true, currentWindow: true });
    setActiveTab(tab, activate);
    return tab;
  }

  function render(): void {
    const lang = getLang();
    const platform = platformForUrl(activeUrl);
    const session = currentSession();
    const displayedTabId = session?.tabId ?? displayTabId;
    const displayedSessionIsActive = typeof displayedTabId === "number" && displayedTabId === activeTabId;
    const canRead = platform === "general" && typeof activeTabId === "number" && isHttpLikeUrl(activeUrl);
    const canUseLiveTarget = canRead && displayedSessionIsActive && Boolean(session?.surface);
    const statusClass = session?.status ? ` page-status-${session.status}` : "";
    const fallbackStatusLabel = platform === "facebook"
      ? tr("sidepanel.page.status.facebook")
      : platform === "unsupported"
      ? tr("sidepanel.page.status.unsupported")
      : tr("sidepanel.page.status.idle");
    const statusLabel = pageStatusLabel(session, fallbackStatusLabel);
    const title = session?.surface?.title || session?.title || activeTitle || tr("sidepanel.page.untitled");
    const url = session?.surface?.canonicalUrl || session?.surface?.url || session?.url || activeUrl;
    const source = session?.surface?.sourceName || (url ? hostnameForUrl(url) : "");
    const statusDetailText = statusDetail(platform, session, displayedSessionIsActive);
    const errorText = session?.status === "error" ? session.error || tr("sidepanel.page.error.unknown") : "";
    const showErrorBlock = Boolean(errorText && errorText !== statusDetailText);
    const modelContext = session?.surface
      ? modelContextForSession({ ...session, surface: session.surface })
      : undefined;
    const excerpt = session?.surface
      ? visibleExcerpt(session.surface, modelContext, session.advisor?.effectiveModelContext)
      : "";
    const warningText = session?.surface?.extraction.warnings.join(", ") || "";
    const updatedAt = session ? formatUpdatedAt(session.updatedAt, lang) : "";
    const statusTitle = pageStatusTitle(session, updatedAt);
    const metadataRows = session?.surface
      ? [
          [tr("sidepanel.page.meta.method"), session.surface.extraction.method],
          [tr("sidepanel.page.meta.extractionStatus"), session.surface.extraction.status],
          [tr("sidepanel.page.meta.textLength"), formatCount(session.surface.mainText.length)],
          [tr("sidepanel.page.meta.links"), formatCount(session.surface.links?.length)],
          [tr("sidepanel.page.meta.images"), formatCount(session.surface.images?.length)],
          [tr("sidepanel.page.meta.updated"), updatedAt],
        ]
      : [];

    pagePaneEl.innerHTML = `
      <section class="page-reader-header" aria-live="polite">
        <div class="page-reader-heading">
          <div class="page-reader-kicker">${escapeHtml(tr("sidepanel.page.kicker"))}</div>
          <h1>${escapeHtml(tr("sidepanel.page.title"))}</h1>
        </div>
        <div class="page-reader-actions">
          <button id="pageReadCurrent" class="btn-investigation-secondary" type="button" ${canRead ? "" : "disabled"}>${escapeHtml(tr("sidepanel.page.readCurrent"))}</button>
          <button id="pageReadSelection" class="btn-investigation-secondary" type="button" ${canUseLiveTarget ? "" : "disabled"}>${escapeHtml(tr("sidepanel.page.useSelection"))}</button>
        </div>
      </section>
      <section class="page-reader-status${statusClass}"${statusTitle ? ` title="${escapeHtml(statusTitle)}" aria-label="${escapeHtml(statusTitle)}"` : ""}>
        <div class="page-reader-status-label">${escapeHtml(statusLabel)}</div>
        <div class="page-reader-status-detail">${escapeHtml(statusDetailText)}</div>
      </section>
      ${sessionSwitcherHtml(session)}
      ${showErrorBlock ? `<section class="page-reader-error">${escapeHtml(errorText)}</section>` : ""}
      ${session?.surface ? `
        <article class="page-reader-card">
          <div class="page-reader-card-header">
            <div class="page-reader-title-block">
              <h2>${escapeHtml(title)}</h2>
              <div class="page-reader-url">${escapeHtml(source || url)}</div>
            </div>
            <div class="page-reader-card-actions">
              ${displayedSessionIsActive ? "" : `<button id="pageActivateDisplayedTab" class="btn-investigation-secondary" type="button">${escapeHtml(tr("sidepanel.page.switcher.activate"))}</button>`}
              <button id="pageCopyMetadata" class="btn-investigation-secondary" type="button">${escapeHtml(copyState === "copied" ? tr("sidepanel.page.copy.copied") : tr("sidepanel.page.copy"))}</button>
              <button id="pageDownloadMarkdown" class="btn-investigation-secondary" type="button">${escapeHtml(downloadState === "saved" ? tr("sidepanel.page.download.saved") : downloadState === "cancelled" ? tr("sidepanel.page.download.cancelled") : downloadState === "failed" ? tr("sidepanel.page.download.failed") : tr("sidepanel.page.download"))}</button>
            </div>
          </div>
          ${excerpt ? `<p class="page-reader-excerpt">${escapeHtml(excerpt)}</p>` : `<p class="page-reader-empty">${escapeHtml(tr("sidepanel.page.noExcerpt"))}</p>`}
          ${session.surface ? extractionDiagnosticsHtml(session.surface, metadataRows, modelContext, tr) : ""}
          ${modelContextHtml(modelContext, tr)}
          ${advisorHtml(session.advisor, tr)}
          ${displayedSessionIsActive ? screenshotHtml(session, tr) : ""}
          ${analysisHtml(session.analysis, tr)}
          ${sourceLinksHtml(modelContext?.links ?? [], tr("sidepanel.page.sourceLinks"))}
          ${warningText ? `<div class="page-reader-warnings"><span>${escapeHtml(tr("sidepanel.page.warnings"))}</span>${escapeHtml(warningText)}</div>` : ""}
        </article>
      ` : emptyBody(platform, canRead)}
    `;
    syncLoadingTicker(session?.status === "loading");

    pagePaneEl.querySelector<HTMLButtonElement>("#pageReadCurrent")?.addEventListener("click", () => {
      void requestReadCurrentPage("sidepanel");
    });
    pagePaneEl.querySelector<HTMLButtonElement>("#pageReadSelection")?.addEventListener("click", () => {
      void requestSelectionTarget("sidepanel");
    });
    pagePaneEl.querySelectorAll<HTMLButtonElement>("[data-page-session-tab-id]").forEach((button) => {
      button.addEventListener("click", () => {
        const tabId = Number(button.dataset.pageSessionTabId);
        if (!Number.isFinite(tabId) || !sessions.has(tabId)) return;
        displayTabId = tabId;
        copyState = "idle";
        downloadState = "idle";
        activateTab("page");
        render();
      });
    });
    pagePaneEl.querySelector<HTMLButtonElement>("#pageActivateDisplayedTab")?.addEventListener("click", () => {
      if (typeof displayedTabId !== "number") return;
      void activateDisplayedBrowserTab(displayedTabId);
    });
    pagePaneEl.querySelector<HTMLButtonElement>("#pageCopyMetadata")?.addEventListener("click", async () => {
      const latest = currentSession();
      if (!latest) return;
      try {
        await navigator.clipboard.writeText(buildCopyText(latest));
        copyState = "copied";
      } catch {
        copyState = "failed";
      }
      render();
    });
    pagePaneEl.querySelector<HTMLButtonElement>("#pageDownloadMarkdown")?.addEventListener("click", async () => {
      const latest = currentSession();
      if (!latest) return;
      try {
        const outcome = await saveMarkdownTextFile(
          buildCopyText(latest),
          buildPageMarkdownFilename(latest),
          "text/markdown;charset=utf-8",
          { mode: getSettings().markdownDownloadMode },
        );
        downloadState = outcome === "cancelled" ? "cancelled" : "saved";
      } catch {
        downloadState = "failed";
      }
      render();
    });
    pagePaneEl.querySelector<HTMLButtonElement>("#pageAnalysisRetry")?.addEventListener("click", () => {
      const latest = currentSession();
      if (!latest) return;
      runGeneralPageAnalysisIfEligible(latest.tabId, latest, true);
    });
    pagePaneEl.querySelector<HTMLButtonElement>("#pageScreenshotCapture")?.addEventListener("click", () => {
      if (typeof displayedTabId !== "number" || displayedTabId !== activeTabId) return;
      void captureScreenshotPreview(displayedTabId);
    });
    pagePaneEl.querySelector<HTMLButtonElement>("#pageScreenshotConfirm")?.addEventListener("click", () => {
      if (typeof displayedTabId !== "number" || displayedTabId !== activeTabId) return;
      void sendConfirmedScreenshotAnalysis(displayedTabId);
    });
    pagePaneEl.querySelector<HTMLButtonElement>("#pageScreenshotCancel")?.addEventListener("click", () => {
      if (typeof displayedTabId !== "number" || displayedTabId !== activeTabId) return;
      setScreenshot(displayedTabId, undefined);
    });
  }

  function sessionSwitcherHtml(activeSession: PageReadingSession | undefined): string {
    const items = Array.from(sessions.values())
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, 6);
    if (items.length <= 1) return "";
    return `
      <section class="page-reader-switcher" aria-label="${escapeHtml(tr("sidepanel.page.switcher.label"))}">
        <div class="page-reader-switcher-title">${escapeHtml(tr("sidepanel.page.switcher.title"))}</div>
        <div class="page-reader-switcher-list">
          ${items.map((item) => {
            const selected = item.tabId === activeSession?.tabId;
            const live = item.tabId === activeTabId;
            const label = item.surface?.title || item.title || hostnameForUrl(item.url);
            const meta = live ? tr("sidepanel.page.switcher.live") : hostnameForUrl(item.surface?.canonicalUrl || item.surface?.url || item.url);
            return `
              <button
                class="page-reader-switcher-item${selected ? " is-selected" : ""}${live ? " is-live" : ""}"
                type="button"
                data-page-session-tab-id="${escapeHtml(String(item.tabId))}"
                aria-pressed="${selected ? "true" : "false"}"
              >
                <span>${escapeHtml(label)}</span>
                <small>${escapeHtml(meta)}</small>
              </button>
            `;
          }).join("")}
        </div>
      </section>
    `;
  }

  async function activateDisplayedBrowserTab(tabId: number): Promise<void> {
    const activationAudit: PageActivationAuditState = { tabId };
    lastActivation = activationAudit;
    try {
      const existingTab = tabs.get ? await tabs.get(tabId).catch(() => undefined) : undefined;
      activationAudit.existingTabId = existingTab?.id;
      const updatedTab = tabs.update
        ? await tabs.update(tabId, { active: true })
        : existingTab;
      activationAudit.updatedTabId = updatedTab?.id;
      const fallbackSession = sessions.get(tabId);
      const windowId = typeof updatedTab?.windowId === "number"
        ? updatedTab.windowId
        : typeof existingTab?.windowId === "number"
        ? existingTab.windowId
        : undefined;
      activationAudit.windowId = windowId;
      if (typeof windowId === "number") {
        await tabs.focusWindow?.(windowId).then(() => {
          activationAudit.focused = true;
        }).catch((error) => {
          activationAudit.error = errorMessage(error);
        });
      }
      const tab = updatedTab
        ? {
            ...updatedTab,
            id: tabId,
            url: updatedTab.url || fallbackSession?.url,
            title: updatedTab.title || fallbackSession?.title,
            active: true,
          }
        : fallbackSession
        ? {
            id: tabId,
            url: fallbackSession.url,
            title: fallbackSession.title,
            active: true,
          }
        : undefined;
      displayTabId = tabId;
      if (tab) setActiveTab(tab, true, "manual-activation");
      else render();
    } catch (error) {
      activationAudit.error = errorMessage(error);
      displayTabId = tabId;
      render();
    }
  }

  function statusDetail(
    platform: PagePlatform,
    session: PageReadingSession | undefined,
    displayedSessionIsActive: boolean,
  ): string {
    if (session?.status === "error") {
      if (session.error === tr("sidepanel.page.error.needsToolbarActivation")) return session.error;
      return tr("sidepanel.page.detail.error");
    }
    if (session?.surface && !displayedSessionIsActive) return tr("sidepanel.page.detail.savedSession");
    if (platform === "facebook") return tr("sidepanel.page.detail.facebook");
    if (platform === "unsupported") return tr("sidepanel.page.detail.unsupported");
    if (!session) return tr("sidepanel.page.detail.empty");
    if (session.status === "loading") return tr("sidepanel.page.detail.loading");
    if (session.status === "stale") return tr("sidepanel.page.detail.stale");
    return tr("sidepanel.page.detail.ready");
  }

  function emptyBody(platform: PagePlatform, canRead: boolean): string {
    if (platform === "facebook")
      return `<section class="page-reader-empty">${escapeHtml(tr("sidepanel.page.empty.facebook"))}</section>`;
    if (!canRead)
      return `<section class="page-reader-empty">${escapeHtml(tr("sidepanel.page.empty.unsupported"))}</section>`;
    return `<section class="page-reader-empty">${escapeHtml(tr("sidepanel.page.empty.general"))}</section>`;
  }

  function friendlyTargetError(error: ReadingTargetErrorReason): string {
    if (error === "no_meaningful_selection")
      return tr("sidepanel.page.target.error.noSelection");
    if (error === "no_pointer_target")
      return tr("sidepanel.page.target.error.noPointerTarget");
    if (error === "page_grant_missing")
      return tr("sidepanel.page.error.needsToolbarActivation");
    if (error === "target_stale")
      return tr("sidepanel.page.target.error.stale");
    if (error === "reading_target_unsupported")
      return tr("sidepanel.page.error.unsupportedAction");
    return tr("sidepanel.page.target.error.failed");
  }

  function screenshotHtml(session: PageReadingSession, translate: typeof tr): string {
    const offerAllowed = canOfferGeneralPageScreenshot({
      visionSupported: getVisionSupported(),
      decision: session.advisor?.advice?.decision,
      needsScreenshot: session.advisor?.advice?.needsScreenshot,
    });
    const shot = session.screenshot;
    if (!offerAllowed && !shot) return "";
    if (shot?.status === "sent") return "";
    const title = escapeHtml(translate("sidepanel.page.screenshot.title"));
    if (shot?.status === "preview" && shot.dataUrl) {
      return `
        <section class="page-reader-screenshot" data-state="preview">
          <h3>${title}</h3>
          <p>${escapeHtml(translate("sidepanel.page.screenshot.previewExplain"))}</p>
          <img class="page-reader-screenshot-preview" alt="${escapeHtml(translate("sidepanel.page.screenshot.previewAlt"))}" src="${shot.dataUrl}">
          <div class="page-reader-screenshot-actions">
            <button id="pageScreenshotConfirm" class="btn-investigation-secondary" type="button">${escapeHtml(translate("sidepanel.page.screenshot.confirm"))}</button>
            <button id="pageScreenshotCancel" class="btn-investigation-secondary" type="button">${escapeHtml(translate("sidepanel.page.screenshot.cancel"))}</button>
          </div>
        </section>`;
    }
    if (shot?.status === "sending") {
      return `
        <section class="page-reader-screenshot" data-state="sending">
          <h3>${title}</h3>
          <p>${escapeHtml(translate("sidepanel.page.screenshot.sending"))}</p>
        </section>`;
    }
    const errorLine = shot?.status === "error"
      ? `<p class="page-reader-screenshot-error">${escapeHtml(shot.error || translate("sidepanel.page.screenshot.error"))}</p>`
      : "";
    if (!offerAllowed) return "";
    return `
      <section class="page-reader-screenshot" data-state="offer">
        <h3>${title}</h3>
        <p>${escapeHtml(translate("sidepanel.page.screenshot.offerExplain"))}</p>
        ${errorLine}
        <button id="pageScreenshotCapture" class="btn-investigation-secondary" type="button">${escapeHtml(translate("sidepanel.page.screenshot.capture"))}</button>
      </section>`;
  }

  function setScreenshot(tabId: number, screenshot: PageReadingScreenshotSession | undefined): void {
    const session = sessions.get(tabId);
    if (!session || session.status === "stale") return;
    sessions.set(tabId, { ...session, screenshot, updatedAt: session.updatedAt });
    if (tabId === activeTabId || tabId === displayTabId) render();
  }

  async function captureScreenshotPreview(tabId: number): Promise<void> {
    const session = sessions.get(tabId);
    if (!session?.surface || session.status === "stale" || !tabs.captureVisibleTab) return;
    try {
      const tab = tabs.get ? await tabs.get(tabId) : undefined;
      const windowId = typeof tab?.windowId === "number" ? tab.windowId : undefined;
      if (typeof windowId !== "number") throw new Error("window_unavailable");
      const dataUrl = await tabs.captureVisibleTab(windowId, { format: "jpeg", quality: 80 });
      if (!isSupportedScreenshotDataUrl(dataUrl)) throw new Error("capture_invalid_data_url");
      setScreenshot(tabId, { status: "preview", dataUrl, updatedAt: now() });
    } catch {
      setScreenshot(tabId, {
        status: "error",
        error: tr("sidepanel.page.screenshot.error"),
        updatedAt: now(),
      });
    }
  }

  async function sendConfirmedScreenshotAnalysis(tabId: number): Promise<void> {
    const session = sessions.get(tabId);
    const shot = session?.screenshot;
    const effective = session?.advisor?.effectiveModelContext;
    const providerRuntime = session?.advisor?.providerRuntime;
    if (!session?.surface || session.status === "stale") return;
    if (!shot?.dataUrl || !isSupportedScreenshotDataUrl(shot.dataUrl) || !effective || !providerRuntime) return;
    if (!providerRuntime.canUseModel || !providerRuntime.endpoint || !providerRuntime.model) return;

    const analysisContext = analysisContextForEffectiveSession(session, session.surface, effective);
    const eligibility = generalPageBriefEligibility({
      sessionReady: session.status === "ready",
      surfaceCurrent: tabId !== activeTabId || !activeUrl || isMeaningfullySamePage(session.identity, activeUrl),
      context: analysisContext,
      allowedUse: effective.allowedUse,
      provider: providerRuntime.effectiveProvider,
      screenshotConfirmed: true,
    });
    if (!eligibility.ok) {
      setScreenshot(tabId, { status: "error", error: analysisEligibilityMessage(eligibility.reason ?? "provider_not_ready"), updatedAt: now() });
      return;
    }
    const key = `${generalPageAnalysisKey(effective, providerRuntime)}|screenshot`;
    const dataUrl = shot.dataUrl;
    setScreenshot(tabId, { status: "sending", updatedAt: now() });
    setAnalysis(tabId, { status: "running", key, allowedUse: effective.allowedUse, updatedAt: now() });
    try {
      const response = await runtime.sendMessage({
        type: "GENERAL_PAGE_ANALYSIS_REQUEST",
        tabId,
        context: analysisContext,
        allowedUse: effective.allowedUse,
        providerRuntime,
        outputLang: getLang(),
        screenshotDataUrl: dataUrl,
      } satisfies TrulyMessage);
      const current = sessions.get(tabId);
      if (!current || current.status === "stale" || current.analysis?.key !== key) return;
      if (!response || typeof response !== "object" || (response as { type?: unknown }).type !== "GENERAL_PAGE_ANALYSIS_RESULT") {
        setScreenshot(tabId, { status: "error", error: tr("sidepanel.page.screenshot.error"), updatedAt: now() });
        setAnalysisError(tabId, "general_page_brief_no_response", key, effective.allowedUse);
        return;
      }
      const result = response as GeneralPageAnalysisResultMsg;
      if (!result.ok || !result.brief) {
        setScreenshot(tabId, { status: "error", error: result.error || tr("sidepanel.page.screenshot.error"), updatedAt: now() });
        setAnalysisError(tabId, result.error || "general_page_brief_failed", key, effective.allowedUse);
        return;
      }
      setScreenshot(tabId, { status: "sent", updatedAt: now() });
      setAnalysis(tabId, { status: "ready", key, brief: result.brief, allowedUse: effective.allowedUse, updatedAt: now() });
    } catch (error) {
      setScreenshot(tabId, { status: "error", error: errorMessage(error), updatedAt: now() });
      setAnalysisError(tabId, errorMessage(error), key, effective.allowedUse);
    }
  }

  function setAdvisor(tabId: number, advisor: PageReadingAdvisorSession): void {
    const session = sessions.get(tabId);
    if (!session || session.status === "stale") return;
    const nextSession: PageReadingSession = {
      ...session,
      advisor,
      analysis: advisor.effectiveModelContext ? session.analysis : undefined,
      updatedAt: session.updatedAt,
    };
    sessions.set(tabId, nextSession);
    if (tabId === activeTabId || tabId === displayTabId) render();
    if (advisor.effectiveModelContext) runGeneralPageAnalysisIfEligible(tabId, nextSession, false);
  }

  function runGeneralPageAnalysisIfEligible(tabId: number, session: PageReadingSession, force: boolean): void {
    const effective = session.advisor?.effectiveModelContext;
    const providerRuntime = session.advisor?.providerRuntime;
    if (!effective || !providerRuntime) return;
    const surface = session.surface;
    if (!surface) return;
    const analysisContext = analysisContextForEffectiveSession(session, surface, effective);
    const surfaceCurrent = tabId !== activeTabId || !activeUrl || isMeaningfullySamePage(session.identity, activeUrl);
    const eligibility = generalPageBriefEligibility({
      sessionReady: session.status === "ready",
      surfaceCurrent,
      context: analysisContext,
      allowedUse: effective.allowedUse,
      provider: providerRuntime.effectiveProvider,
    });
    if (!eligibility.ok || !providerRuntime.canUseModel || !providerRuntime.endpoint || !providerRuntime.model) {
      if (force) setAnalysisError(tabId, analysisEligibilityMessage(eligibility.reason ?? "provider_not_ready"));
      return;
    }
    const key = generalPageAnalysisKey(effective, providerRuntime);
    if (!force && session.analysis?.key === key && (session.analysis.status === "running" || session.analysis.status === "ready")) {
      return;
    }
    setAnalysis(tabId, {
      status: "running",
      key,
      allowedUse: effective.allowedUse,
      updatedAt: now(),
    });
    void Promise.resolve(runtime.sendMessage({
      type: "GENERAL_PAGE_ANALYSIS_REQUEST",
      tabId,
      context: analysisContext,
      allowedUse: effective.allowedUse,
      providerRuntime,
      outputLang: getLang(),
    } satisfies TrulyMessage)).then((response) => {
      const current = sessions.get(tabId);
      if (!current || current.status === "stale" || current.analysis?.key !== key) return;
      if (!current.surface || !isMeaningfullySamePage(current.identity, current.surface.url)) return;
      if (tabId === activeTabId && activeUrl && !isMeaningfullySamePage(current.identity, activeUrl)) return;
      if (!response || typeof response !== "object" || (response as { type?: unknown }).type !== "GENERAL_PAGE_ANALYSIS_RESULT") {
        setAnalysisError(tabId, "general_page_brief_no_response", key, effective.allowedUse);
        return;
      }
      const result = response as GeneralPageAnalysisResultMsg;
      if (!result.ok || !result.brief) {
        setAnalysisError(tabId, result.error || "general_page_brief_failed", key, effective.allowedUse);
        return;
      }
      setAnalysis(tabId, {
        status: "ready",
        key,
        brief: result.brief,
        allowedUse: effective.allowedUse,
        updatedAt: now(),
      });
    }).catch((error) => {
      setAnalysisError(tabId, errorMessage(error), key, effective.allowedUse);
    });
  }

  function setAnalysis(tabId: number, analysis: PageReadingAnalysisSession): void {
    const session = sessions.get(tabId);
    if (!session || session.status === "stale") return;
    sessions.set(tabId, {
      ...session,
      analysis,
      updatedAt: session.updatedAt,
    });
    if (tabId === activeTabId) render();
  }

  function setAnalysisError(
    tabId: number,
    error: string,
    key?: string,
    allowedUse?: GeneralPageEffectiveModelContextUse,
  ): void {
    setAnalysis(tabId, {
      status: "error",
      key,
      error,
      allowedUse,
      updatedAt: now(),
    });
  }

  function generalPageAnalysisKey(
    effective: GeneralPageEffectiveModelContext,
    providerRuntime: GeneralPageParserAdvisorProviderRuntime,
  ): string {
    return [
      effective.allowedUse,
      effective.source,
      effective.mainText.length,
      effective.mainText.slice(0, 160),
      providerRuntime.effectiveProvider,
      providerRuntime.model,
    ].join("|");
  }

  function analysisContextForEffectiveSession(
    session: PageReadingSession,
    surface: ReadingSurface,
    effective: GeneralPageEffectiveModelContext,
  ): GeneralPageModelContext {
    const base = modelContextForSession({ ...session, surface });
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

  function analysisEligibilityMessage(reason: GeneralPageAnalysisEligibilityReason): string {
    return tr(`sidepanel.page.analysis.reason.${reason}`);
  }

  function startParserAdvisor(
    tabId: number,
    surface: ReadingSurface,
    options: {
      target?: ReadingTarget;
      candidateBlocks?: GeneralPageParserAdvisorCandidateBlock[];
    } = {},
  ): void {
    const target = options.target;
    const context = target
      ? buildGeneralPageModelContext(surface, {
          target,
          minMainTextLength: GENERAL_PAGE_MIN_SELECTED_TEXT_LENGTH,
        })
      : buildGeneralPageModelContext(surface, { targetKind: "page" });
    const request = buildGeneralPageParserAdvisorRequest(context, {
      candidateBlocks: target ? [] : options.candidateBlocks ?? [],
      allowScreenshot: getVisionSupported(),
    });
    const providerRuntime = resolveAdvisorProviderRuntime(
      getSettings(),
      getTierAEndpoint(),
      getTierAModel(),
    );
    const effectiveModelContext = buildGeneralPageEffectiveModelContext(context, request);

    if (!request.escalation.shouldAskModel) {
      setAdvisor(tabId, {
        status: "not_needed",
        request,
        effectiveModelContext,
        providerRuntime,
        updatedAt: now(),
      });
      return;
    }

    setAdvisor(tabId, {
      status: "checking",
      request,
      providerRuntime,
      updatedAt: now(),
    });

    void Promise.resolve(runtime.sendMessage({
      type: "GENERAL_PAGE_PARSER_ADVISOR_REQUEST",
      tabId,
      request,
      providerRuntime,
      outputLang: getLang(),
    } satisfies TrulyMessage)).then(async (response) => {
      const current = sessions.get(tabId);
      if (
        !current?.surface ||
        !isMeaningfullySamePage(pageUrlIdentity(current.surface.url, current.surface.canonicalUrl), surface.url) ||
        (target && current.target?.id !== target.id)
      )
        return;
      if (!response || typeof response !== "object" || (response as { type?: unknown }).type !== "GENERAL_PAGE_PARSER_ADVISOR_RESULT") {
        setAdvisor(tabId, {
          status: "error",
          request,
          providerRuntime,
          effectiveModelContext,
          error: "parser_advisor_no_response",
          updatedAt: now(),
        });
        return;
      }
      const result = response as GeneralPageParserAdvisorResultMsg;
      if (!result.ok || !result.advice) {
        setAdvisor(tabId, {
          status: "error",
          request,
          providerRuntime: result.providerRuntime ?? providerRuntime,
          effectiveModelContext,
          error: result.error || "parser_advisor_failed",
          updatedAt: now(),
        });
        return;
      }
      setAdvisor(tabId, {
        status: "ready",
        request,
        advice: result.advice,
        providerRuntime: result.providerRuntime ?? providerRuntime,
        effectiveModelContext: await buildEffectiveContextForAdvice(tabId, surface, context, request, result.advice),
        updatedAt: now(),
      });
    }).catch((error) => {
      setAdvisor(tabId, {
        status: "error",
        request,
        providerRuntime,
        effectiveModelContext,
        error: errorMessage(error),
        updatedAt: now(),
      });
    });
  }

  async function buildEffectiveContextForAdvice(
    tabId: number,
    surface: ReadingSurface,
    context: GeneralPageModelContext,
    request: GeneralPageParserAdvisorRequest,
    advice: GeneralPageParserAdvisorAdvice,
  ): Promise<GeneralPageEffectiveModelContext> {
    if (advice.decision !== "prefer_candidate_block" || !advice.selectedBlockId) {
      return buildGeneralPageEffectiveModelContext(context, request, advice);
    }
    const selectedBlockText = await requestCandidateBlockText(tabId, surface.id, advice.selectedBlockId);
    return buildGeneralPageEffectiveModelContext(context, request, advice, { selectedBlockText });
  }

  async function requestCandidateBlockText(
    tabId: number,
    surfaceId: string,
    blockId: string,
  ): Promise<string | undefined> {
    try {
      const response = await runtime.sendMessage({
        type: "GENERAL_PAGE_CANDIDATE_BLOCK_TEXT_REQUEST",
        tabId,
        surfaceId,
        blockId,
      } satisfies TrulyMessage);
      if (!response || typeof response !== "object" || (response as { type?: unknown }).type !== "GENERAL_PAGE_CANDIDATE_BLOCK_TEXT_RESULT")
        return undefined;
      const result = response as GeneralPageCandidateBlockTextResultMsg;
      if (result.surfaceId !== surfaceId || result.blockId !== blockId)
        return undefined;
      return result.text;
    } catch {
      return undefined;
    }
  }

  async function requestSelectionTarget(source: PageActivationSource = "sidepanel"): Promise<void> {
    try {
      const tab = await refreshActiveTab(false);
      const tabId = typeof tab?.id === "number" ? tab.id : activeTabId;
      if (typeof tabId !== "number") return;
      const session = sessions.get(tabId);
      if (!session?.surface || session.status === "stale") {
        render();
        return;
      }
      if (!isMeaningfullySamePage(session.identity, tab?.url ?? session.url)) {
        sessions.set(tabId, {
          ...session,
          surface: undefined,
          target: undefined,
          candidateBlocks: undefined,
          advisor: undefined,
          analysis: undefined,
      screenshot: undefined,
          status: "stale",
          url: tab?.url ?? session.url,
          updatedAt: now(),
        });
        render();
        return;
      }
      setAdvisor(tabId, {
        status: "checking",
        providerRuntime: resolveAdvisorProviderRuntime(getSettings(), getTierAEndpoint(), getTierAModel()),
        updatedAt: now(),
      });
      const response = await runtime.sendMessage({
        type: "READING_TARGET_REQUEST",
        tabId,
        trigger: "selection",
        surfaceId: session.surface.id,
        activation: {
          source,
          targetKind: "selection",
          action: "read",
        },
      } satisfies TrulyMessage);
      if (!response || typeof response !== "object" || !("type" in response)) return;
      if (response.type === "READING_TARGET_RESULT") {
        handleReadingTargetResult(response as ReadingTargetResultMsg);
      } else if (response.type === "READING_TARGET_ERROR") {
        handleReadingTargetError(response as ReadingTargetErrorMsg);
      }
    } catch {
      if (typeof activeTabId === "number") {
        handleReadingTargetError({
          type: "READING_TARGET_ERROR",
          tabId: activeTabId,
          error: "target_extraction_failed",
        });
      }
    }
  }

  async function requestPointTarget(tabId: number): Promise<void> {
    try {
      const session = sessions.get(tabId);
      if (!session?.surface || session.status === "stale") {
        // Hotkey without a live read session: no activeTab grant is implied,
        // so show the existing toolbar-activation guidance.
        if (sessions.get(tabId)) {
          handleReadingTargetError({
            type: "READING_TARGET_ERROR",
            tabId,
            error: "page_grant_missing",
          });
        }
        render();
        return;
      }
      setAdvisor(tabId, {
        status: "checking",
        providerRuntime: resolveAdvisorProviderRuntime(getSettings(), getTierAEndpoint(), getTierAModel()),
        updatedAt: now(),
      });
      const response = await runtime.sendMessage({
        type: "READING_TARGET_REQUEST",
        tabId,
        trigger: "hotkey",
        surfaceId: session.surface.id,
        activation: {
          source: "hotkey",
          targetKind: "current-region",
          action: "read",
        },
      } satisfies TrulyMessage);
      if (!response || typeof response !== "object" || !("type" in response)) return;
      if (response.type === "READING_TARGET_RESULT") {
        handleReadingTargetResult(response as ReadingTargetResultMsg);
      } else if (response.type === "READING_TARGET_ERROR") {
        handleReadingTargetError(response as ReadingTargetErrorMsg);
      }
    } catch {
      handleReadingTargetError({
        type: "READING_TARGET_ERROR",
        tabId,
        error: "target_extraction_failed",
      });
    }
  }

  function pendingCurrentRegionValue(raw: unknown): { tabId: number } | undefined {
    if (!raw || typeof raw !== "object") return undefined;
    const candidate = raw as { tabId?: unknown; ts?: unknown };
    if (typeof candidate.tabId !== "number" || typeof candidate.ts !== "number") return undefined;
    if (now() - candidate.ts > PENDING_CURRENT_REGION_READ_MAX_AGE_MS) return undefined;
    return { tabId: candidate.tabId };
  }

  function consumePendingCurrentRegionRead(raw: unknown): void {
    const pending = pendingCurrentRegionValue(raw);
    void sessionStore?.remove(PENDING_CURRENT_REGION_READ_KEY);
    if (!pending) return;
    void requestPointTarget(pending.tabId);
  }

  function installPendingCurrentRegionListener(): void {
    if (!sessionStore) return;
    void sessionStore.get(PENDING_CURRENT_REGION_READ_KEY).then((result) => {
      consumePendingCurrentRegionRead(result?.[PENDING_CURRENT_REGION_READ_KEY]);
    }).catch(() => {});
    sessionStore.onChanged?.addListener((changes, areaName) => {
      if (areaName !== "session") return;
      const change = changes[PENDING_CURRENT_REGION_READ_KEY];
      if (!change || change.newValue === undefined) return;
      consumePendingCurrentRegionRead(change.newValue);
    });
  }

  async function requestReadCurrentPage(source: PageActivationSource = "sidepanel"): Promise<void> {
    try {
      const tab = await refreshActiveTab(false);
      if (typeof tab?.id !== "number") {
        render();
        return;
      }
      const tabUrl = tab.url ?? activeUrl;
      if (!tab.url && !activeUrl) {
        activeTabId = tab.id;
        sessions.set(tab.id, {
          tabId: tab.id,
          url: "",
          identity: pageUrlIdentity(""),
          title: activeTitle,
          status: "error",
          error: tr("sidepanel.page.error.needsToolbarActivation"),
          updatedAt: now(),
          activationSource: source,
        });
        activateTab("page");
        render();
        return;
      }
      if (!isHttpLikeUrl(tabUrl) || platformForUrl(tabUrl) !== "general") {
        render();
        return;
      }
      copyState = "idle";
      downloadState = "idle";
      activeTabId = tab.id;
      displayTabId = tab.id;
      activeUrl = tabUrl;
      activeTitle = tab.title ?? "";
      const startedAt = now();
      sessions.set(tab.id, {
        tabId: tab.id,
        url: activeUrl,
        identity: pageUrlIdentity(activeUrl),
        title: activeTitle,
        status: "loading",
        target: undefined,
        advisor: undefined,
        analysis: undefined,
        screenshot: undefined,
        startedAt,
        updatedAt: startedAt,
        activationSource: source,
      });
      activateTab("page");
      render();
      const response = await runtime.sendMessage({
        type: "PAGE_READING_REQUEST",
        tabId: tab.id,
        inject: true,
        activation: {
          source,
          targetKind: "page",
          action: "read",
        },
      } satisfies TrulyMessage);
      if (!response || typeof response !== "object" || !("type" in response)) return;
      if (response.type === "PAGE_READING_RESULT")
        handlePageReadingResult(response as PageReadingResultMsg);
      else if (response.type === "PAGE_READING_ERROR")
        handlePageReadingError(response as PageReadingErrorMsg);
    } catch (error) {
      if (typeof activeTabId === "number") {
        handlePageReadingError({
          type: "PAGE_READING_ERROR",
          tabId: activeTabId,
          error: errorMessage(error),
        });
      } else {
        render();
      }
    }
  }

  function handlePageReadingResult(message: PageReadingResultMsg): void {
    const tabId = typeof message.tabId === "number" ? message.tabId : activeTabId;
    if (typeof tabId !== "number") return;
    const existing = sessions.get(tabId);
    const completedAt = now();
    const elapsedMs = typeof message.elapsedMs === "number" && Number.isFinite(message.elapsedMs)
      ? Math.max(0, message.elapsedMs)
      : typeof existing?.startedAt === "number"
      ? Math.max(0, completedAt - existing.startedAt)
      : undefined;
    copyState = "idle";
    downloadState = "idle";
    sessions.set(tabId, {
      tabId,
      url: message.surface.url,
      identity: pageUrlIdentity(message.surface.url, message.surface.canonicalUrl),
      title: message.surface.title,
      surface: message.surface,
      target: undefined,
      candidateBlocks: message.candidateBlocks ?? [],
      status: "ready",
      updatedAt: completedAt,
      startedAt: existing?.startedAt ?? (typeof elapsedMs === "number" ? completedAt - elapsedMs : undefined),
      completedAt,
      elapsedMs,
      activationSource: existing?.activationSource ?? "toolbar",
      analysis: undefined,
      screenshot: undefined,
    });
    if (tabId === activeTabId || !displayTabId || displayTabId === tabId) {
      displayTabId = tabId;
      render();
    }
    startParserAdvisor(tabId, message.surface, {
      candidateBlocks: message.candidateBlocks ?? [],
    });
  }

  function handleReadingTargetResult(message: ReadingTargetResultMsg): void {
    const tabId = typeof message.tabId === "number" ? message.tabId : activeTabId;
    if (typeof tabId !== "number") return;
    const existing = sessions.get(tabId);
    if (!existing?.surface || existing.status === "stale") return;
    if (message.target.surfaceId !== existing.surface.id) {
      handleReadingTargetError({
        type: "READING_TARGET_ERROR",
        tabId,
        error: "target_stale",
      });
      return;
    }
    sessions.set(tabId, {
      ...existing,
      target: message.target,
      status: "ready",
      updatedAt: now(),
      analysis: undefined,
      screenshot: undefined,
    });
    copyState = "idle";
    downloadState = "idle";
    if (tabId === activeTabId || tabId === displayTabId) render();
    startParserAdvisor(tabId, existing.surface, {
      target: message.target,
      candidateBlocks: existing.candidateBlocks,
    });
  }

  function handleReadingTargetError(message: ReadingTargetErrorMsg): void {
    const tabId = typeof message.tabId === "number" ? message.tabId : activeTabId;
    if (typeof tabId !== "number") return;
    const existing = sessions.get(tabId);
    if (!existing?.surface) return;
    sessions.set(tabId, {
      ...existing,
      advisor: {
        status: "error",
        error: friendlyTargetError(message.error),
        providerRuntime: resolveAdvisorProviderRuntime(getSettings(), getTierAEndpoint(), getTierAModel()),
        updatedAt: now(),
      },
      analysis: undefined,
      screenshot: undefined,
      updatedAt: now(),
    });
    if (tabId === activeTabId || tabId === displayTabId) render();
  }

  function handlePageReadingError(message: PageReadingErrorMsg): void {
    const tabId = typeof message.tabId === "number" ? message.tabId : activeTabId;
    if (typeof tabId !== "number") return;
    const existing = sessions.get(tabId);
    const completedAt = now();
    const elapsedMs = typeof message.elapsedMs === "number" && Number.isFinite(message.elapsedMs)
      ? Math.max(0, message.elapsedMs)
      : typeof existing?.startedAt === "number"
      ? Math.max(0, completedAt - existing.startedAt)
      : undefined;
    sessions.set(tabId, {
      tabId,
      url: existing?.url || activeUrl,
      identity: existing?.identity || pageUrlIdentity(existing?.url || activeUrl),
      title: existing?.title || activeTitle,
      surface: existing?.surface,
      target: undefined,
      candidateBlocks: existing?.candidateBlocks,
      advisor: undefined,
      analysis: undefined,
      screenshot: undefined,
      status: "error",
      error: friendlyPageReadingError(message.error),
      updatedAt: completedAt,
      startedAt: existing?.startedAt ?? (typeof elapsedMs === "number" ? completedAt - elapsedMs : undefined),
      completedAt,
      elapsedMs,
      activationSource: existing?.activationSource || "toolbar",
    });
    if (tabId === activeTabId || tabId === displayTabId) render();
  }

  function install(): void {
    if (installed) return;
    installed = true;
    void refreshActiveTab(true);
    tabs.onActivated?.addListener((activeInfo) => {
      activeTabId = activeInfo.tabId;
      if (tabs.get) {
        void tabs.get(activeInfo.tabId).then((tab) => setActiveTab(tab, true)).catch(() => render());
      } else {
        void refreshActiveTab(true);
      }
    });
    tabs.onUpdated?.addListener((tabId, changeInfo, tab) => {
      if (changeInfo.url) markTabSessionStale(tabId, tab);
      if (tabId !== activeTabId) return;
      if (!changeInfo.url && changeInfo.status !== "complete") return;
      setActiveTab(tab, true, "status-update");
    });
    tabs.onRemoved?.addListener((tabId) => {
      const wasDisplayed = tabId === displayTabId;
      sessions.delete(tabId);
      if (tabId === displayTabId) {
        displayTabId = typeof activeTabId === "number" && sessions.has(activeTabId)
          ? activeTabId
          : Array.from(sessions.values()).sort((a, b) => b.updatedAt - a.updatedAt)[0]?.tabId ?? null;
      }
      if (tabId === activeTabId || wasDisplayed) render();
    });
    installPendingCurrentRegionListener();
    render();
  }

  return {
    install,
    requestReadCurrentPage,
    requestPointTarget,
    auditState: () => ({ activeTabId, displayTabId, lastActivation }),
    handlePageReadingResult,
    handlePageReadingError,
  };
}
