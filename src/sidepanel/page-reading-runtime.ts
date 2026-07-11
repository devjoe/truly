import { t } from "../lib/i18n";
import {
  buildGeneralPageModelContext,
  GENERAL_PAGE_MODEL_MIN_MAIN_TEXT_LENGTH,
  type GeneralPageModelContext,
  type GeneralPageModelIneligibilityReason,
  type GeneralPageModelQualityIssue,
  type GeneralPageModelSourceLink,
} from "../lib/general-page-model-context";
import {
  GENERAL_PAGE_DEFAULT_MAX_IMAGES,
  GENERAL_PAGE_MIN_SELECTED_TEXT_LENGTH,
} from "../lib/general-page-extraction";
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
  type GeneralPageAnalysisMode,
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
import type { ReadingExtractionWarning, ReadingSurface } from "../lib/reading-surface-types";
import type { ReadingTarget, ReadingTargetErrorReason } from "../lib/reading-target-types";
import { isSupportedScreenshotDataUrl } from "../lib/screenshot-data-url";
import {
  isMeaningfullySamePage,
  pageUrlIdentity,
  type PageUrlIdentity,
} from "../lib/page-url-identity";
import {
  classifyPageReadability,
  classifyPageReadabilityForTab,
  type PageReadabilityPlatform,
  type UnsupportedPageKind,
} from "../lib/page-readability";
import {
  hasGeneralPageAllSitesPermission,
  hasGeneralPageHostPermission,
  requestGeneralPageHostPermission,
} from "../lib/general-page-host-permission";
import { copyReadingBriefQuestion, safeFilenamePart, saveMarkdownTextFile } from "./browser-actions";
import { googleSearchUrl, readingBriefQuestionDisplay } from "./reading-brief-text";
import { modelDisplayIdentity } from "../lib/model-display";
import type { TabId } from "./tabs";
import {
  createReadingRequestId,
  PENDING_PAGE_READING_COMMAND_KEY,
  parseReadingCommandEnvelope,
} from "../lib/reading-command-envelope";

type PagePlatform = PageReadabilityPlatform;
type PageSessionStatus = "idle" | "loading" | "ready" | "error" | "stale";
type PageActivationSource = "toolbar" | "popup" | "sidepanel" | "hotkey";
export type PageWorkspace = "page" | "focus";
const LOADING_ELAPSED_VISIBLE_THRESHOLD_MS = 2_000;
const AUTO_READ_DEBOUNCE_MS = 700;
const READ_SUCCESS_FEEDBACK_MS = 1_800;

interface PageReadingSession {
  requestId?: string;
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
  /** True while an all-sites auto-read is waiting for the DOM-settle debounce. */
  autoReadPending?: boolean;
  advisor?: PageReadingAdvisorSession;
  analysis?: PageReadingAnalysisSession;
  screenshot?: PageReadingScreenshotSession;
  pageScope?: PageReadingScopeState;
  focusScope?: FocusReadingScopeState;
}

interface PageReadingScopeState {
  advisor?: PageReadingAdvisorSession;
  analysis?: PageReadingAnalysisSession;
  screenshot?: PageReadingScreenshotSession;
}

interface FocusReadingScopeState extends PageReadingScopeState {
  target?: ReadingTarget;
}

type PageReadingScopeKind = "page" | "focus";

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
  mode?: GeneralPageAnalysisMode;
  brief?: GeneralPageBrief;
  error?: string;
  allowedUse?: GeneralPageEffectiveModelContextUse;
  updatedAt: number;
}

function pageScopeForSession(session: PageReadingSession): PageReadingScopeState {
  return session.pageScope ?? {
    advisor: session.target ? undefined : session.advisor,
    analysis: session.target ? undefined : session.analysis,
    screenshot: session.target ? undefined : session.screenshot,
  };
}

function focusScopeForSession(session: PageReadingSession): FocusReadingScopeState | undefined {
  if (session.focusScope) return session.focusScope;
  return session.target
    ? {
        target: session.target,
        advisor: session.advisor,
        analysis: session.analysis,
        screenshot: session.screenshot,
      }
    : undefined;
}

function scopeStateForSession(
  session: PageReadingSession,
  scope: PageReadingScopeKind,
): PageReadingScopeState | FocusReadingScopeState {
  return scope === "focus" ? focusScopeForSession(session) ?? {} : pageScopeForSession(session);
}

function materializeScopeSession(
  session: PageReadingSession,
  scope: PageReadingScopeKind,
): PageReadingSession {
  const state = scopeStateForSession(session, scope);
  const target = scope === "focus" ? (state as FocusReadingScopeState).target : undefined;
  return {
    ...session,
    target,
    advisor: state.advisor,
    analysis: state.analysis,
    screenshot: state.screenshot,
  };
}

function replaceScopeState(
  session: PageReadingSession,
  scope: PageReadingScopeKind,
  state: PageReadingScopeState | FocusReadingScopeState,
): PageReadingSession {
  return scope === "focus"
    ? { ...session, focusScope: state as FocusReadingScopeState }
    : { ...session, pageScope: state };
}

interface BrowserTab {
  id?: number;
  url?: string;
  title?: string;
  active?: boolean;
  windowId?: number;
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
export const ACTIVE_EXTENSION_PAGE_MARKER_KEY = "trulyActiveExtensionPage";
const ACTIVE_EXTENSION_PAGE_MARKER_MAX_AGE_MS = 30_000;

interface ActiveExtensionPageMarker {
  kind: "options";
  tabId?: number;
  title?: string;
  url?: string;
  ts: number;
  buildId?: string;
}

export interface SidepanelPageReadingRuntime {
  install(): void;
  refresh(): void;
  setWorkspace(workspace: PageWorkspace): void;
  requestReadCurrentPage(source?: PageActivationSource): Promise<void>;
  requestPointTarget(tabId: number): Promise<void>;
  auditState(): {
    activeTabId: number | null;
    displayTabId: number | null;
    displayedSession?: {
      requestId?: string;
      status: PageSessionStatus;
      hasSurface: boolean;
      screenshotStatus?: PageReadingScreenshotSession["status"];
      screenshotHasDataUrl: boolean;
      advisorStatus?: PageReadingAdvisorStatus;
      advisorDecision?: GeneralPageParserAdvisorAdvice["decision"] | "none";
      analysisStatus?: PageReadingAnalysisStatus;
      targetKind?: GeneralPageModelContext["targetKind"];
      allowedUse?: GeneralPageEffectiveModelContextUse;
    };
  };
  handlePageReadingResult(message: PageReadingResultMsg): void;
  handlePageReadingError(message: PageReadingErrorMsg): void;
}

export interface CreateSidepanelPageReadingRuntimeOptions {
  pagePaneEl: HTMLElement;
  runtime: RuntimeApi;
  tabs: TabsApi;
  activateTab(tab: TabId): void;
  setTabAvailability?(tab: TabId, available: boolean, reason?: string): boolean | void;
  getLang(): Lang;
  getSettings?(): UserSettings;
  getTierAEndpoint?(): string | undefined;
  getTierAModel?(): string | undefined;
  now(): number;
  sessionStore?: PageReadingSessionStore;
  /** True when the configured Tier B provider passed the vision probe. */
  getVisionSupported?(): boolean;
  /** True when Truly can read general pages without a fresh toolbar activeTab grant. */
  hasAllSitesPermission?(): Promise<boolean>;
  /** True when Truly has persistent read access to the active page origin. */
  hasHostPermission?(url: string): Promise<boolean>;
  /** Requests persistent read access to the active page origin. */
  requestHostPermission?(url: string): Promise<boolean>;
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
      hourCycle: "h23",
    }).format(new Date(timestamp));
  } catch {
    return new Date(timestamp).toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
  }
}

function formatElapsedSeconds(ms: number, lang: Lang): string {
  if (ms < 100) return lang === "zh-TW" ? "少於 0.1 秒" : "<0.1s";
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

function platformForUrl(rawUrl: string | undefined): PagePlatform {
  return classifyPageReadability(rawUrl, extensionRuntimeId()).platform;
}

function unsupportedKindForTab(rawUrl: string | undefined, title: string | undefined): UnsupportedPageKind {
  return classifyPageReadabilityForTab(rawUrl, title, extensionRuntimeId()).unsupportedKind ?? "unknown";
}

function extensionRuntimeId(): string | undefined {
  return (globalThis as typeof globalThis & { chrome?: { runtime?: { id?: string } } }).chrome?.runtime?.id;
}

function pushAuditEvent(event: string, details: Record<string, unknown> = {}): void {
  const locationSearch = (globalThis as typeof globalThis & { location?: { search?: string } }).location?.search ?? "";
  if (!locationSearch.includes("generalPageReaderAudit")) return;
  const target = globalThis as typeof globalThis & {
    __trulyPageReadingAuditEvents?: Array<Record<string, unknown>>;
  };
  target.__trulyPageReadingAuditEvents ??= [];
  target.__trulyPageReadingAuditEvents.push({
    event,
    ...details,
  });
}

function hostnameForUrl(rawUrl: string): string {
  try {
    return new URL(rawUrl).hostname;
  } catch {
    return rawUrl;
  }
}

function sourceLinkLabel(link: GeneralPageModelSourceLink): string {
  const text = link.text?.trim().replace(/^[•▪·●◦]+\s*/u, "");
  if (text) return text;
  const host = hostnameForUrl(link.href).replace(/^www\./i, "");
  if (host && host !== link.href) return host;
  return link.href;
}

function sourceLinkHost(link: GeneralPageModelSourceLink): string {
  return hostnameForUrl(link.href).replace(/^www\./i, "");
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
  const text = displaySafeExcerptText(sourceText || surface.excerpt || surface.mainText || "");
  if (text.length <= 1200) return text;
  return `${text.slice(0, 1197)}...`;
}

function displaySafeExcerptText(value: string): string {
  const text = (value || "").trim().replace(/\s+/g, " ");
  if (!looksLikeMetadataDump(text))
    return text;

  const metadataExcerpt = excerptFromMetadataDump(text);
  if (metadataExcerpt)
    return metadataExcerpt;

  return "";
}

function looksLikeMetadataDump(text: string): boolean {
  if (!text)
    return false;
  if (/^\s*\{/.test(text) && /"@(?:context|type)"\s*:/.test(text))
    return true;
  if (/^\s*\[?\s*\{/.test(text) && /"(?:headline|description|datePublished|publisher|author)"\s*:/.test(text)) {
    const punctuationCount = (text.match(/[{}[\]":,]/g) ?? []).length;
    return punctuationCount / Math.max(text.length, 1) > 0.08;
  }
  return false;
}

function excerptFromMetadataDump(text: string): string {
  const candidates = [
    /"description"\s*:\s*"((?:\\.|[^"\\]){40,600})"/,
    /"headline"\s*:\s*"((?:\\.|[^"\\]){20,240})"/,
    /"name"\s*:\s*"((?:\\.|[^"\\]){20,240})"/,
  ];
  for (const pattern of candidates) {
    const raw = text.match(pattern)?.[1];
    const decoded = raw ? decodeJsonStringFragment(raw) : "";
    if (decoded)
      return decoded;
  }
  return "";
}

function decodeJsonStringFragment(value: string): string {
  try {
    return JSON.parse(`"${value}"`).trim().replace(/\s+/g, " ");
  } catch {
    return value.replace(/\\"/g, "\"").replace(/\\n/g, " ").replace(/\s+/g, " ").trim();
  }
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
  lines.push("AI preview: Please rely on the original text and your own judgement.");
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

function sourceLinkSectionHtml(links: GeneralPageModelSourceLink[], title: string): string {
  if (links.length === 0) return "";
  return `
    <section class="page-reader-source-links">
      <h3>${escapeHtml(title)}</h3>
      <ul>
        ${links.map((link) => {
          const label = sourceLinkLabel(link);
          const host = sourceLinkHost(link);
          const showHost = host && host.toLocaleLowerCase() !== label.toLocaleLowerCase();
          const ariaLabel = showHost ? `${label} (${host})` : label;
          return `<li><a href="${escapeHtml(link.href)}" target="_blank" rel="noreferrer" aria-label="${escapeHtml(ariaLabel)}"><span>${escapeHtml(label)}</span>${showHost ? `<span class="page-reader-source-link-host">${escapeHtml(host)}</span>` : ""}</a></li>`;
        }).join("")}
      </ul>
    </section>
  `;
}

function sourceLinksHtml(
  links: GeneralPageModelSourceLink[],
  pageUrl: string,
  tr: (key: string, params?: Record<string, string | number>) => string,
): string {
  const visibleLinks = links.slice(0, 6);
  if (visibleLinks.length === 0) return "";
  const pageHost = hostnameForUrl(pageUrl).replace(/^www\./i, "").toLocaleLowerCase();
  const externalLinks = visibleLinks.filter((link) => sourceLinkHost(link).toLocaleLowerCase() !== pageHost);
  const relatedLinks = visibleLinks.filter((link) => sourceLinkHost(link).toLocaleLowerCase() === pageHost);
  return [
    sourceLinkSectionHtml(externalLinks, tr("sidepanel.page.externalSources")),
    sourceLinkSectionHtml(relatedLinks, tr("sidepanel.page.relatedLinks")),
  ].filter(Boolean).join("");
}

function pagePreviewHtml(excerpt: string, tr: (key: string, params?: Record<string, string | number>) => string): string {
  if (!excerpt) return `<p class="page-reader-empty">${escapeHtml(tr("sidepanel.page.noExcerpt"))}</p>`;
  return `
    <details class="page-reader-page-text page-reader-supplemental-details">
      <summary>${escapeHtml(tr("sidepanel.page.context.pageText"))}</summary>
      <p class="page-reader-excerpt">${escapeHtml(excerpt)}</p>
    </details>
  `;
}

type PageContextPresentationTone = "info" | "caution" | "action-required";

interface PageContextPresentation {
  tone: PageContextPresentationTone;
  summary: string;
  status?: string;
}

function pageContextPresentation(
  surface: ReadingSurface,
  context: GeneralPageModelContext | undefined,
  advisor: PageReadingAdvisorSession | undefined,
  tr: (key: string, params?: Record<string, string | number>) => string,
): PageContextPresentation | undefined {
  const warnings = surface.extraction.warnings;
  const effective = advisor?.effectiveModelContext;
  const allowedUse = effective?.allowedUse;

  if (effective?.source === "candidate-block" && allowedUse === "article_or_selection_analysis")
    return undefined;

  if (warnings.includes("login-or-paywall-like"))
    return {
      tone: "action-required",
      status: tr("sidepanel.page.context.status.blocked"),
      summary: tr("sidepanel.page.context.advisory.paywall"),
    };

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

  if (warnings.includes("dynamic-content-partial"))
    return { tone: "caution", summary: tr("sidepanel.page.context.advisory.dynamic") };
  if (warnings.includes("large-navigation-noise"))
    return { tone: "caution", summary: tr("sidepanel.page.context.advisory.navigation") };
  if (warnings.includes("no-main-content"))
    return { tone: "caution", summary: tr("sidepanel.page.context.summary.noMain") };
  if (warnings.includes("very-short-content"))
    return { tone: "caution", summary: tr("sidepanel.page.context.summary.short") };
  if (surface.extraction.status === "partial" || context?.modelReadiness === "caution")
    return { tone: "caution", summary: tr("sidepanel.page.context.summary.partial") };
  if (advisor?.status === "error")
    return { tone: "caution", summary: tr("sidepanel.page.advisor.detail.error") };
  return undefined;
}

function briefNoteMatchesPageContext(
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
  return allowedUse === "page_overview_only" && briefNoteIsAggregationGuidance(note);
}

function briefNoteIsAggregationGuidance(note: string | undefined): boolean {
  return Boolean(note) &&
    /新聞(?:彙整|聚合)頁面|索引|列表|(?:各)?來源連結|news aggregation|index|feed|source links?/iu.test(note ?? "");
}

function extractionWarningLabel(
  warning: ReadingExtractionWarning,
  tr: (key: string, params?: Record<string, string | number>) => string,
): string {
  const key: Record<ReadingExtractionWarning, string> = {
    "no-main-content": "sidepanel.page.warning.noMainContent",
    "selection-only": "sidepanel.page.warning.selectionOnly",
    "very-short-content": "sidepanel.page.warning.veryShortContent",
    "large-navigation-noise": "sidepanel.page.warning.largeNavigationNoise",
    "login-or-paywall-like": "sidepanel.page.warning.loginOrPaywall",
    "dynamic-content-partial": "sidepanel.page.warning.dynamicPartial",
  };
  return tr(key[warning]);
}

function technicalDetailsHtml(
  rows: Array<[string, string, string?]>,
  warnings: ReadingExtractionWarning[],
  tr: (key: string, params?: Record<string, string | number>) => string,
): string {
  const detailsOpen = false;
  const technicalRows = [...rows];
  if (warnings.length > 0) {
    technicalRows.push([
      tr("sidepanel.page.meta.warnings"),
      warnings.map((warning) => extractionWarningLabel(warning, tr)).join(" · "),
      warnings.join(", "),
    ]);
  }
  return `
    <details class="page-reader-diagnostics page-reader-technical-details"${detailsOpen ? " open" : ""}>
      <summary>${escapeHtml(tr("sidepanel.page.diagnostics.details"))}</summary>
      <dl class="page-reader-meta">
        ${technicalRows.map(([label, value, raw]) => diagnosticRowHtml(label, value, raw)).join("")}
      </dl>
    </details>
  `;
}

function pageContextHtml(
  blocks: string[],
  presentation: PageContextPresentation | undefined,
  open: boolean,
  tr: (key: string, params?: Record<string, string | number>) => string,
): string {
  const summaryHtml = presentation
    ? `
      <section class="page-reader-context-summary is-${presentation.tone}" role="note">
        ${presentation.status ? `<div class="page-reader-context-summary-status">${escapeHtml(presentation.status)}</div>` : ""}
        <p>${escapeHtml(presentation.summary)}</p>
      </section>
    `
    : "";
  const body = [summaryHtml, ...blocks].filter(Boolean).join("");
  if (!body) return "";
  const summaryLabel = presentation
    ? tr("sidepanel.page.context.hasAdvisory")
    : tr("sidepanel.page.details");
  const indicator = presentation
    ? `<span class="page-reader-context-indicator" aria-hidden="true">${INFO_ICON_SVG}</span>`
    : "";
  return `
    <details class="page-reader-context-details page-reader-supplemental-details"${open ? " open" : ""}>
      <summary aria-label="${escapeHtml(summaryLabel)}"${presentation ? ` title="${escapeHtml(tr("sidepanel.page.context.advisory.tooltip"))}"` : ""}><span>${escapeHtml(tr("sidepanel.page.details"))}</span>${indicator}</summary>
      <div class="page-reader-context-body page-reader-supplemental-body">${body}</div>
    </details>
  `;
}

function focusTargetPreview(text: string): string {
  const normalized = text.trim().replace(/\s+/g, " ");
  if (normalized.length <= 120) return normalized;
  return `${normalized.slice(0, 119)}…`;
}

function focusScopeHtml(
  target: ReadingTarget,
  canUpdate: boolean,
  source: string,
  advisory: string,
  error: string,
  analysisBlock: string,
  toolButtons: string,
  tr: (key: string, params?: Record<string, string | number>) => string,
): string {
  const isSelection = target.kind === "selection";
  const kindLabel = tr(isSelection
    ? "sidepanel.page.model.target.selection"
    : "sidepanel.page.model.target.currentRegion");
  const detailLabel = tr(isSelection
    ? "sidepanel.page.focus.selectionText"
    : "sidepanel.page.focus.regionText");
  return `
    <section class="page-reader-focus-panel page-reader-focus-scope" data-state="ready">
      <div class="page-reader-focus-header">
        <div>
          <h3 class="page-reader-focus-title">${escapeHtml(tr("sidepanel.page.advisor.title"))}</h3>
          <div class="page-reader-focus-meta">${escapeHtml(tr(
            source ? "sidepanel.page.focus.scopeMetaWithSource" : "sidepanel.page.focus.scopeMeta",
            {
              kind: kindLabel,
              count: target.text.trim().length,
              source,
            },
          ))}</div>
        </div>
        <button id="pageReadSelection" class="btn-investigation-secondary" type="button" ${canUpdate ? "" : "disabled"}>${escapeHtml(tr("sidepanel.page.focus.update"))}</button>
      </div>
      <p class="page-reader-focus-preview">${escapeHtml(focusTargetPreview(target.text))}</p>
      <details class="page-reader-focus-text page-reader-supplemental-details">
        <summary>${escapeHtml(detailLabel)}</summary>
        <div class="page-reader-focus-fulltext">${escapeHtml(target.text)}</div>
      </details>
      ${error ? `<p class="page-reader-focus-error" role="alert">${escapeHtml(error)}</p>` : ""}
      ${advisory ? `<p class="page-reader-focus-advisory" role="note">${escapeHtml(advisory)}</p>` : ""}
      ${analysisBlock ? `<div class="page-reader-focus-analysis">${analysisBlock}</div>` : ""}
      ${toolButtons ? `<footer class="page-reader-focus-tools">${toolButtons}</footer>` : ""}
    </section>
  `;
}

function modelContextHtml(
  context: GeneralPageModelContext | undefined,
  analysis: PageReadingAnalysisSession | undefined,
  tr: (key: string, params?: Record<string, string | number>) => string,
): string {
  if (!context) return "";
  const statusText = modelContextStatusText(context, analysis, tr);
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
  const detailsOpen = false;
  const needsVisibleReason = context.modelReadiness !== "ready";
  const compactReady = true;
  return `
    <section class="page-reader-model-context is-${context.modelReadiness}${compactReady ? " is-compact" : ""}${needsVisibleReason ? " is-decision" : ""}">
      <div class="page-reader-model-context-header">
        <h3>${escapeHtml(tr("sidepanel.page.model.title"))}</h3>
        <span>${escapeHtml(statusText)}</span>
      </div>
      ${needsVisibleReason ? `<p>${escapeHtml(reason)}</p>` : ""}
      <details class="page-reader-diagnostics"${detailsOpen ? " open" : ""}>
        <summary>${escapeHtml(tr("sidepanel.page.diagnostics.details"))}</summary>
        <dl>
          ${rows.map(([label, value, raw]) => diagnosticRowHtml(label, value, raw)).join("")}
        </dl>
      </details>
    </section>
  `;
}

function modelContextReasonText(
  context: GeneralPageModelContext,
  tr: (key: string, params?: Record<string, string | number>) => string,
): string {
  if (context.ineligibilityReason) return tr(modelIneligibilityKey(context.ineligibilityReason));
  if (context.qualityIssues.length > 0) {
    return context.qualityIssues.map((issue) => tr(modelQualityIssueKey(issue))).join(" ");
  }
  return "";
}

function advisorDetailText(
  advisor: PageReadingAdvisorSession,
  tr: (key: string, params?: Record<string, string | number>) => string,
): string {
  const effective = advisor.effectiveModelContext;
  if (advisor.status === "error") return advisor.error || tr("sidepanel.page.advisor.detail.error");
  if (advisor.status === "checking") return tr("sidepanel.page.advisor.detail.checking");
  if (advisor.status === "not_needed") return tr("sidepanel.page.advisor.detail.notNeeded");
  if (effective?.allowedUse === "page_overview_only") return tr("sidepanel.page.advisor.detail.pageOverview");
  if (effective?.allowedUse === "requires_user_target") return tr("sidepanel.page.advisor.detail.needsTarget");
  return tr("sidepanel.page.advisor.detail.ready");
}

function generalPageAnalysisErrorText(
  error: string | undefined,
  tr: (key: string, params?: Record<string, string | number>) => string,
): string {
  switch (error) {
    case "general_page_brief_format_error":
    case "general_page_brief_no_response":
    case "general_page_brief_failed":
    case "general_page_brief_http_error":
    case "general_page_brief_network_error":
    case "general_page_brief_timeout":
    case "general_page_brief_provider_unavailable":
    case "general_page_brief_invalid_screenshot_data_url":
      return tr("sidepanel.page.analysis.error");
    default:
      return error && !/^general_page_brief_/.test(error)
        ? error
        : tr("sidepanel.page.analysis.error");
  }
}

function pageTechnicalDiagnosticRows(
  context: GeneralPageModelContext | undefined,
  advisor: PageReadingAdvisorSession | undefined,
  tr: (key: string, params?: Record<string, string | number>) => string,
): Array<[string, string, string?]> {
  const rows: Array<[string, string, string?]> = [];
  if (context) {
    rows.push(
      [tr("sidepanel.page.meta.imageAlt"), formatCount(context.imageAltText.length)],
      [tr("sidepanel.page.model.target"), modelTargetKindLabel(context.targetKind, tr), context.targetKind],
    );
  }
  if (!advisor) return rows;
  const effective = advisor.effectiveModelContext;
  const provider = providerRuntimeLabel(advisor.providerRuntime) || tr("sidepanel.page.advisor.provider.local");
  const modelMode = advisor.providerRuntime?.mode === "tier-b-short-json" && advisor.providerRuntime.canUseModel
    ? tr("sidepanel.page.advisor.mode.modelReady")
    : advisor.providerRuntime?.mode === "tier-b-short-json-fallback"
    ? tr("sidepanel.page.advisor.mode.modelFallback")
    : tr("sidepanel.page.advisor.mode.localBaseline");
  rows.push(
    [tr("sidepanel.page.advisor.decision"), advisorDecisionLabel(advisor, tr), advisorDecisionRaw(advisor)],
    [tr("sidepanel.page.advisor.allowedUse"), allowedUseLabel(effective?.allowedUse, tr), effective?.allowedUse],
    [tr("sidepanel.page.advisor.provider"), provider],
    [tr("sidepanel.page.advisor.payload"), advisor.request ? `${advisor.request.payloadBudget.estimatedPayloadChars}/${advisor.request.payloadBudget.maxPayloadChars}` : "-"],
    [tr("sidepanel.page.advisor.mode"), modelMode],
  );
  return rows;
}

function shouldHideReadyPipelineState(
  context: GeneralPageModelContext | undefined,
  advisor: PageReadingAdvisorSession | undefined,
  analysis: PageReadingAnalysisSession | undefined,
): boolean {
  // "running" counts as clean-ready too: while the quick brief is being
  // generated for an otherwise clean page, the pane keeps the final compact
  // layout (title + loading line) instead of flashing pipeline diagnostics
  // for a few seconds and then collapsing them when the brief arrives.
  // Errors flip status to "error", which brings the diagnostics back.
  if (!context || !advisor || (analysis?.status !== "ready" && analysis?.status !== "running")) return false;
  if (context.modelReadiness !== "ready" || context.targetKind !== "page") return false;
  const effective = advisor.effectiveModelContext;
  const cleanScope = advisor.status === "not_needed" ||
    (advisor.status === "ready" &&
      advisor.advice?.decision === "accept_current" &&
      effective?.allowedUse === "article_or_selection_analysis");
  return cleanScope;
}

function shouldHidePendingPageAdvisorState(
  context: GeneralPageModelContext | undefined,
  advisor: PageReadingAdvisorSession | undefined,
): boolean {
  // Scope classification is an internal transition, not a user decision.
  // Keep whole-page reads on the same neutral loading surface used by brief
  // generation until the advisor produces a durable result. Final caution,
  // blocked, and recovery states remain visible after checking completes.
  return context?.targetKind === "page" && advisor?.status === "checking";
}

function shouldHideCleanTechnicalDetails(
  surface: ReadingSurface | undefined,
  context: GeneralPageModelContext | undefined,
  advisor: PageReadingAdvisorSession | undefined,
  analysis: PageReadingAnalysisSession | undefined,
): boolean {
  if (!surface || !shouldHideReadyPipelineState(context, advisor, analysis)) return false;
  return surface.extraction.method === "semantic-html" &&
    surface.extraction.status === "complete" &&
    surface.extraction.warnings.length === 0;
}

function modelContextStatusText(
  context: GeneralPageModelContext,
  analysis: PageReadingAnalysisSession | undefined,
  tr: (key: string, params?: Record<string, string | number>) => string,
): string {
  if (analysis?.status === "running") return tr("sidepanel.page.model.sentRunning");
  if (analysis?.status === "ready") return tr("sidepanel.page.model.sentReady");
  if (analysis?.status === "error") return tr("sidepanel.page.model.sentError");
  if (context.modelReadiness === "ready") return tr("sidepanel.page.model.ready");
  if (context.modelReadiness === "caution") return tr("sidepanel.page.model.caution");
  return tr("sidepanel.page.model.blocked");
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
  const detail = advisorDetailText(advisor, tr);
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
  const needsVisibleDecision = effective?.allowedUse === "page_overview_only" ||
    effective?.allowedUse === "requires_user_target" ||
    (Boolean(decision) && decision !== "accept_current");
  const detailsOpen = false;
  const compactReady = advisor.status !== "checking" && advisor.status !== "error";
  return `
    <section class="page-reader-advisor is-${escapeHtml(advisor.status)}${compactReady ? " is-compact" : ""}${needsVisibleDecision ? " is-decision" : ""}">
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

// Inline SVG strings mirror the Feed renderers' createCopyIcon /
// createDownloadIcon so Page/Web actions look identical to Feed actions.
const COPY_ICON_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="4" y="4" width="11" height="11" rx="2"></rect><rect x="9" y="9" width="11" height="11" rx="2"></rect></svg>`;
const DOWNLOAD_ICON_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3v12"></path><path d="M8 11l4 4 4-4"></path><path d="M5 21h14"></path></svg>`;
const INFO_ICON_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"></circle><path d="M12 11v5"></path><path d="M12 8h.01"></path></svg>`;

function analysisHtml(
  analysis: PageReadingAnalysisSession | undefined,
  tr: (key: string, params?: Record<string, string | number>) => string,
  pageTitle?: string,
  omitBriefNote = false,
  titleOverride?: string,
): string {
  if (!analysis || analysis.status === "idle") return "";
  const overview = analysis.allowedUse === "page_overview_only";
  const overviewClass = overview ? " is-overview" : "";
  const title = titleOverride || tr(overview ? "sidepanel.page.analysis.overview" : "sidepanel.page.analysis.title");
  const statusText = tr(`sidepanel.page.analysis.status.${analysis.status}`);
  if (analysis.status === "running") {
    return `
      <section class="page-reader-analysis is-running${overviewClass}" role="status" aria-live="polite" aria-busy="true">
        <div class="page-reader-analysis-header">
          <h3>${escapeHtml(title)}</h3>
          <div class="reading-brief-loading page-reader-analysis-loading">${escapeHtml(tr("sidepanel.page.analysis.running"))}</div>
        </div>
      </section>
    `;
  }
  const visibleStatus = analysis.status === "ready"
    ? ""
    : `<span>${escapeHtml(statusText)}</span>`;
  const body = analysis.status === "error"
    ? `
      <p>${escapeHtml(generalPageAnalysisErrorText(analysis.error, tr))}</p>
      <button id="pageAnalysisRetry" class="btn-investigation-secondary page-reader-analysis-retry" type="button">${escapeHtml(tr("sidepanel.page.analysis.retry"))}</button>
    `
    : analysis.brief
    ? briefHtml(analysis.brief, analysis.allowedUse, tr, pageTitle, omitBriefNote)
    : "";
  return `
    <section class="page-reader-analysis is-${escapeHtml(analysis.status)}${overviewClass}">
      <div class="page-reader-analysis-header">
        <h3>${escapeHtml(title)}</h3>
        ${visibleStatus}
      </div>
      ${body}
    </section>
  `;
}

function briefHtml(
  brief: GeneralPageBrief,
  allowedUse: GeneralPageEffectiveModelContextUse | undefined,
  tr: (key: string, params?: Record<string, string | number>) => string,
  pageTitle?: string,
  omitNote = false,
): string {
  const modelLabel = modelDisplayIdentity(brief.model).label || brief.model;
  const attributionTitle = brief.elapsedMs
    ? tr("sidepanel.dynamic.readingBrief.modelNoteWithElapsed", {
        model: modelLabel,
        elapsed: Math.round(brief.elapsedMs / 100) / 10,
      })
    : tr("sidepanel.dynamic.readingBrief.modelNoteNoElapsed", { model: modelLabel });
  const overview = allowedUse === "page_overview_only";
  // Keep content-specific caveats next to the summary they qualify. Model
  // provenance remains a separate, compact footer.
  const noteHtml = brief.note && !omitNote
    ? `<p class="page-reader-analysis-note">${escapeHtml(brief.note)}</p>`
    : "";
  const attribution = tr("sidepanel.page.analysis.attribution", { model: modelLabel });
  return `
    <p class="page-reader-analysis-summary">${escapeHtml(brief.summary)}</p>
    ${briefSectionHtml("", brief.bg?.map((item) => `${item.t}: ${item.why}${item.q ? ` ${item.q}` : ""}`) ?? [])}
    ${overview ? "" : briefSectionHtml(tr("sidepanel.dynamic.readingBrief.verify"), brief.claims?.map((claim) => tr("sidepanel.dynamic.readingBrief.needEvidence", { claim: claim.c, need: claim.need })) ?? [])}
    ${briefQuestionsHtml(brief.qs ?? [], pageTitle, tr)}
    <div class="page-reader-analysis-closing">
      ${noteHtml}
      <p class="page-reader-analysis-footer reading-brief-model-note" role="note" title="${escapeHtml(attributionTitle)}" aria-label="${escapeHtml(attributionTitle)}">${escapeHtml(attribution)}</p>
    </div>
  `;
}

/**
 * Questions render as Feed-style rows with per-question copy and
 * "Ask Gemini" actions, reusing the Feed reading-brief classes so both
 * panes stay visually aligned. Rows use divs (not ul) so the audit's
 * design-restraint list-section counting keeps treating single-item
 * sections as compact.
 */
function briefQuestionsHtml(
  questions: Array<{ q: string }>,
  pageTitle: string | undefined,
  tr: (key: string, params?: Record<string, string | number>) => string,
): string {
  if (questions.length === 0) return "";
  const rows = questions.map((question) => {
    const display = readingBriefQuestionDisplay(question.q);
    const query = [display, pageTitle?.trim()].filter(Boolean).join(" ").slice(0, 200);
    return `
      <div class="reading-brief-question-row">
        <span class="reading-brief-question-text">${escapeHtml(display)}</span>
        <span class="reading-brief-question-actions">
          <button type="button" class="reading-brief-copy-btn page-analysis-question-copy" data-question="${escapeHtml(display)}" title="${escapeHtml(tr("sidepanel.dynamic.readingBrief.copyQuestion"))}" aria-label="${escapeHtml(tr("sidepanel.dynamic.readingBrief.copyQuestionAria", { question: display }))}">${COPY_ICON_SVG}</button>
          <a class="reading-brief-google-link" href="${escapeHtml(googleSearchUrl(query))}" target="_blank" rel="noopener noreferrer" title="${escapeHtml(tr("sidepanel.dynamic.readingBrief.askGeminiTitle"))}" aria-label="${escapeHtml(tr("sidepanel.dynamic.readingBrief.askGeminiAria", { query }))}">${escapeHtml(tr("sidepanel.dynamic.readingBrief.askGemini"))}</a>
        </span>
      </div>
    `;
  }).join("");
  const singleClass = questions.length === 1 ? " is-single" : "";
  return `
    <div class="page-reader-analysis-section page-reader-analysis-questions${singleClass}">
      <h4>${escapeHtml(tr("sidepanel.page.analysis.questions"))}</h4>
      ${rows}
    </div>
  `;
}

function briefSectionHtml(title: string, items: string[]): string {
  if (items.length === 0) return "";
  const heading = title ? `<h4>${escapeHtml(title)}</h4>` : "";
  if (items.length === 1) {
    return `
      <div class="page-reader-analysis-section is-single">
        ${heading}
        <p>${escapeHtml(items[0])}</p>
      </div>
    `;
  }
  return `
    <div class="page-reader-analysis-section">
      ${heading}
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
  setTabAvailability,
  getLang,
  getSettings = () => DEFAULT_SETTINGS,
  getTierAEndpoint = () => undefined,
  getTierAModel = () => undefined,
  now,
  sessionStore,
  getVisionSupported = () => false,
  hasAllSitesPermission = hasGeneralPageAllSitesPermission,
  hasHostPermission = hasGeneralPageHostPermission,
  requestHostPermission = requestGeneralPageHostPermission,
}: CreateSidepanelPageReadingRuntimeOptions): SidepanelPageReadingRuntime {
  const sessions = new Map<number, PageReadingSession>();
  const focusTargetErrors = new Map<number, string>();
  let activeTabId: number | null = null;
  let displayTabId: number | null = null;
  let activeUrl = "";
  let activeTitle = "";
  let installed = false;
  let copyState: "idle" | "copied" | "failed" = "idle";
  let downloadState: "idle" | "saved" | "cancelled" | "failed" = "idle";
  let pageWorkspace: PageWorkspace = "page";
  let loadingTicker: ReturnType<typeof setInterval> | undefined;
  let autoReadTimer: ReturnType<typeof setTimeout> | undefined;
  let autoReadToken = 0;
  const pendingRereadFeedback = new Set<number>();
  const consumedReadingCommandIds = new Set<string>();
  let readSuccessFeedbackTabId: number | undefined;
  let readSuccessFeedbackTimer: ReturnType<typeof setTimeout> | undefined;
  let activeExtensionPageMarker: ActiveExtensionPageMarker | undefined;
  let hostPermissionState: {
    url: string;
    status: "unknown" | "checking" | "granted" | "missing" | "requesting" | "failed";
  } | undefined;

  function tr(key: string, params?: Record<string, string | number>): string {
    return t(key, getLang(), params);
  }

  function currentSession(): PageReadingSession | undefined {
    const tabId = typeof displayTabId === "number" ? displayTabId : activeTabId;
    return typeof tabId === "number" ? sessions.get(tabId) : undefined;
  }

  function setWorkspace(workspace: PageWorkspace): void {
    if (pageWorkspace === workspace) return;
    pageWorkspace = workspace;
    render();
  }

  function syncHostPermissionState(url: string, platform: PagePlatform): void {
    if (platform !== "general" || !url) {
      if (hostPermissionState) {
        hostPermissionState = undefined;
      }
      return;
    }
    if (hostPermissionState?.url === url && hostPermissionState.status !== "unknown") return;
    hostPermissionState = { url, status: "checking" };
    void hasHostPermission(url).then((granted) => {
      if (hostPermissionState?.url !== url) return;
      hostPermissionState = { url, status: granted ? "granted" : "missing" };
      render();
    }).catch(() => {
      if (hostPermissionState?.url !== url) return;
      hostPermissionState = { url, status: "missing" };
      render();
    });
  }

  function activePagePermissionStatus(): "unknown" | "checking" | "granted" | "missing" | "requesting" | "failed" {
    return hostPermissionState?.url === activeUrl ? hostPermissionState.status : "checking";
  }

  function activePageNeedsDomainGrant(): boolean {
    const permissionStatus = activePagePermissionStatus();
    return permissionStatus === "missing" || permissionStatus === "failed";
  }

  function pageReadActionHtml(canRead: boolean, hasSurface: boolean, showReadSuccess: boolean): string {
    if (!canRead || pageWorkspace !== "page") return "";
    const permissionStatus = activePagePermissionStatus();
    const needsDomainGrant = permissionStatus === "missing" || permissionStatus === "failed";
    const waitingForDomainGrant = permissionStatus === "checking" || permissionStatus === "requesting";
    if (waitingForDomainGrant) return "";
    if (needsDomainGrant) {
      const title = tr("sidepanel.page.authorizeDomainTitle");
      const label = tr("sidepanel.page.authorizeDomain");
      return `
        <button
          id="pageAuthorizeDomain"
          class="page-reader-target-action is-authorize"
          type="button"
          title="${escapeHtml(title)}"
          aria-label="${escapeHtml(title)}"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true">
            <path d="M12 3v3"></path>
            <path d="M12 18v3"></path>
            <path d="M4.2 7.5 6.8 9"></path>
            <path d="m17.2 15 2.6 1.5"></path>
            <path d="m4.2 16.5 2.6-1.5"></path>
            <path d="m17.2 9 2.6-1.5"></path>
            <path d="M8 12a4 4 0 1 0 8 0 4 4 0 0 0-8 0Z"></path>
          </svg>
          <span>${escapeHtml(label)}</span>
        </button>
      `;
    }
    const title = showReadSuccess
      ? tr("sidepanel.page.readCurrentSuccess")
      : hasSurface
        ? tr("sidepanel.page.readCurrentReloadTitle")
        : tr("sidepanel.page.readCurrentTitle");
    const label = hasSurface ? title : tr("sidepanel.page.readCurrent");
    return `
      <button
        id="pageReadCurrent"
        class="page-reader-target-action${hasSurface ? " is-icon-only" : " is-read"}${showReadSuccess ? " is-read-success" : ""}"
        type="button"
        title="${escapeHtml(title)}"
        aria-label="${escapeHtml(title)}"
        aria-live="polite"
      >
        ${showReadSuccess
          ? `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true"><path d="m5 12.5 4.25 4.25L19 7"></path></svg>`
          : `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true"><path d="M21 12a9 9 0 1 1-2.64-6.36"></path><path d="M21 4v6h-6"></path></svg>`}
        <span>${escapeHtml(label)}</span>
      </button>
    `;
  }

  function clearReadSuccessFeedback(tabId?: number): void {
    if (typeof tabId === "number" && readSuccessFeedbackTabId !== tabId) return;
    if (readSuccessFeedbackTimer) clearTimeout(readSuccessFeedbackTimer);
    readSuccessFeedbackTimer = undefined;
    readSuccessFeedbackTabId = undefined;
  }

  function showReadSuccessFeedback(tabId: number): void {
    clearReadSuccessFeedback();
    readSuccessFeedbackTabId = tabId;
    readSuccessFeedbackTimer = setTimeout(() => {
      readSuccessFeedbackTimer = undefined;
      if (readSuccessFeedbackTabId !== tabId) return;
      readSuccessFeedbackTabId = undefined;
      if (tabId === activeTabId || tabId === displayTabId) render();
    }, READ_SUCCESS_FEEDBACK_MS);
  }

  async function requestActiveDomainAuthorization(): Promise<void> {
    if (!activeUrl || platformForUrl(activeUrl) !== "general") return;
    hostPermissionState = { url: activeUrl, status: "requesting" };
    render();
    const granted = await requestHostPermission(activeUrl).catch(() => false);
    if (hostPermissionState?.url !== activeUrl) return;
    hostPermissionState = { url: activeUrl, status: granted ? "granted" : "failed" };
    render();
    if (granted) await requestReadCurrentPage("sidepanel");
  }

  function clearAutoReadTimer(): void {
    if (!autoReadTimer) return;
    clearTimeout(autoReadTimer);
    autoReadTimer = undefined;
  }

  function cancelPendingAutoRead(): void {
    clearAutoReadTimer();
    autoReadToken += 1;
  }

  function shouldAutoReadActivePage(includePending = false): boolean {
    if (typeof activeTabId !== "number") return false;
    if (platformForUrl(activeUrl) !== "general") return false;
    const session = sessions.get(activeTabId);
    if (!session) return true;
    if (session.status === "loading") return includePending && session.autoReadPending === true;
    const samePage = isMeaningfullySamePage(session.identity, activeUrl);
    if (samePage && session.surface && session.status !== "stale") return false;
    return true;
  }

  function showPendingAutoRead(tabId: number, url: string): void {
    const existing = sessions.get(tabId);
    const startedAt = existing?.autoReadPending && typeof existing.startedAt === "number"
      ? existing.startedAt
      : now();
    sessions.set(tabId, {
      ...(existing ?? {
        tabId,
        activationSource: "sidepanel" as const,
      }),
      url,
      identity: pageUrlIdentity(url),
      title: activeTitle || existing?.title,
      surface: undefined,
      target: undefined,
      candidateBlocks: undefined,
      status: "loading",
      error: undefined,
      updatedAt: startedAt,
      startedAt,
      completedAt: undefined,
      elapsedMs: undefined,
      activationSource: "sidepanel",
      autoReadPending: true,
      advisor: undefined,
      analysis: undefined,
      screenshot: undefined,
      pageScope: {},
      focusScope: undefined,
    });
    if (tabId === activeTabId || tabId === displayTabId) render();
  }

  async function maybeAutoReadActivePage(token: number, expectedTabId: number, expectedUrl: string): Promise<void> {
    if (token !== autoReadToken) return;
    if (activeTabId !== expectedTabId || activeUrl !== expectedUrl || !shouldAutoReadActivePage(true)) return;
    await requestReadCurrentPage("sidepanel", { activateWorkspace: false });
  }

  function scheduleAutoReadActivePage(): void {
    clearAutoReadTimer();
    autoReadToken += 1;
    if (!installed || !shouldAutoReadActivePage(true)) return;
    const expectedTabId = activeTabId;
    const expectedUrl = activeUrl;
    if (typeof expectedTabId !== "number") return;
    const token = autoReadToken;
    void hasAllSitesPermission().then((hasPermission) => {
      if (!hasPermission || token !== autoReadToken) return;
      if (activeTabId !== expectedTabId || activeUrl !== expectedUrl || !shouldAutoReadActivePage(true)) return;
      showPendingAutoRead(expectedTabId, expectedUrl);
      autoReadTimer = setTimeout(() => {
        autoReadTimer = undefined;
        void maybeAutoReadActivePage(token, expectedTabId, expectedUrl);
      }, AUTO_READ_DEBOUNCE_MS);
      (autoReadTimer as { unref?: () => void }).unref?.();
    }).catch(() => {});
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
        if (currentSession()?.status === "loading") updateLoadingElapsedStatus();
        else syncLoadingTicker(false);
      }, 1_000);
      return;
    }
    if (!active && loadingTicker) {
      clearInterval(loadingTicker);
      loadingTicker = undefined;
    }
  }

  function updateLoadingElapsedStatus(): void {
    const session = currentSession();
    if (session?.status !== "loading") return;
    const label = pagePaneEl.querySelector<HTMLElement>(
      ".page-reader-card-loading-status, .page-reader-status-label",
    );
    if (!label) return;
    label.textContent = pageStatusLabel(session, tr("sidepanel.page.status.loading"));
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
    const previousActiveTabId = activeTabId;
    const nextTabId = tab?.id;
    const isNewActiveTab = typeof nextTabId === "number" && nextTabId !== previousActiveTabId;
    if (typeof nextTabId === "number") activeTabId = nextTabId;
    activeUrl = tab?.url ?? (isNewActiveTab ? "" : activeUrl);
    activeTitle = tab?.title ?? (isNewActiveTab ? "" : activeTitle);
    const platform = platformForUrl(activeUrl);
    if (typeof nextTabId === "number" && platform === "unsupported") {
      const unsupportedSession = sessions.get(nextTabId);
      if (unsupportedSession && !unsupportedSession.surface) sessions.delete(nextTabId);
      displayTabId = nextTabId;
    }
    const shouldSyncDisplay = displaySync !== "status-update" ||
      !previousDisplayedSession ||
      previousDisplayTabId === nextTabId;
    if (typeof nextTabId === "number" && shouldSyncDisplay && (platform === "general" || sessions.has(nextTabId) || !currentSession())) {
      displayTabId = nextTabId;
    }
    if (activate) {
      if (platform === "facebook") activateTab("analysis");
      else if (platform === "general") activateTab("page");
    }
    const session = typeof nextTabId === "number" ? sessions.get(nextTabId) : undefined;
    if (session && activeUrl && !isMeaningfullySamePage(session.identity, activeUrl)) {
      if (typeof nextTabId === "number") focusTargetErrors.delete(nextTabId);
      session.status = "stale";
      session.url = activeUrl;
      session.title = activeTitle || session.title;
      session.surface = undefined;
      session.target = undefined;
      session.candidateBlocks = undefined;
      session.advisor = undefined;
      session.analysis = undefined;
      session.screenshot = undefined;
      session.pageScope = {};
      session.focusScope = undefined;
      session.autoReadPending = undefined;
      session.updatedAt = now();
    }
    render();
    scheduleAutoReadActivePage();
    void refreshActiveExtensionPageMarker();
  }

  function markTabSessionStale(tabId: number, tab: BrowserTab): void {
    const session = sessions.get(tabId);
    const nextUrl = tab.url;
    if (!session || !nextUrl || isMeaningfullySamePage(session.identity, nextUrl)) return;
    focusTargetErrors.delete(tabId);
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
      pageScope: {},
      focusScope: undefined,
      status: "stale",
      autoReadPending: undefined,
      updatedAt: now(),
    });
    if (tabId === displayTabId) render();
  }

  async function refreshActiveTab(activate = true): Promise<BrowserTab | undefined> {
    const [tab] = await tabs.query({ active: true, currentWindow: true });
    setActiveTab(tab, activate);
    return tab;
  }

  function parseActiveExtensionPageMarker(raw: unknown): ActiveExtensionPageMarker | undefined {
    if (!raw || typeof raw !== "object") return undefined;
    const candidate = raw as Partial<ActiveExtensionPageMarker>;
    if (candidate.kind !== "options") return undefined;
    if (typeof candidate.ts !== "number" || !Number.isFinite(candidate.ts)) return undefined;
    if (now() - candidate.ts > ACTIVE_EXTENSION_PAGE_MARKER_MAX_AGE_MS) return undefined;
    return {
      kind: "options",
      tabId: typeof candidate.tabId === "number" && Number.isFinite(candidate.tabId) ? candidate.tabId : undefined,
      title: typeof candidate.title === "string" ? candidate.title : undefined,
      url: typeof candidate.url === "string" ? candidate.url : undefined,
      ts: candidate.ts,
      buildId: typeof candidate.buildId === "string" ? candidate.buildId : undefined,
    };
  }

  async function refreshActiveExtensionPageMarker(): Promise<void> {
    if (!sessionStore) return;
    if (activeUrl) {
      if (activeExtensionPageMarker) {
        activeExtensionPageMarker = undefined;
        render();
      }
      return;
    }
    const result: Record<string, unknown> = await sessionStore.get(ACTIVE_EXTENSION_PAGE_MARKER_KEY)
      .catch(() => ({} as Record<string, unknown>));
    const marker = parseActiveExtensionPageMarker(result?.[ACTIVE_EXTENSION_PAGE_MARKER_KEY]);
    const changed = Boolean(marker) !== Boolean(activeExtensionPageMarker) ||
      marker?.ts !== activeExtensionPageMarker?.ts;
    activeExtensionPageMarker = marker;
    if (changed) render();
  }

  function render(): void {
    const lang = getLang();
    const platform = platformForUrl(activeUrl);
    const session = currentSession();
    const activeWorkspace = pageWorkspace;
    const viewSession: PageReadingSession | undefined = session?.surface
      ? materializeScopeSession(session, activeWorkspace)
      : session;
    const displayedTabId = session?.tabId ?? displayTabId;
    const displayedSessionIsActive = typeof displayedTabId === "number" && displayedTabId === activeTabId;
    const canRead = platform === "general" && typeof activeTabId === "number";
    let availabilityFallback: TabId | undefined;
    if (platform === "facebook") {
      setTabAvailability?.("analysis", true);
      setTabAvailability?.("focus", true);
      if (setTabAvailability?.(
        "page",
        false,
        tr("sidepanel.tab.pageUnavailableFacebook"),
      )) availabilityFallback = "analysis";
    } else if (platform === "general") {
      setTabAvailability?.("page", true);
      setTabAvailability?.("focus", true);
      if (setTabAvailability?.(
        "analysis",
        false,
        tr("sidepanel.tab.feedUnavailableWeb"),
      )) availabilityFallback = "page";
    } else {
      // Keep Web available as the explanatory surface for browser, extension,
      // and other protected pages; Feed and selection analysis cannot act here.
      setTabAvailability?.("page", true);
      const feedWasSelected = setTabAvailability?.(
        "analysis",
        false,
        tr("sidepanel.tab.feedUnavailableWeb"),
      );
      const focusWasSelected = setTabAvailability?.(
        "focus",
        false,
        tr("sidepanel.tab.focusUnavailablePage"),
      );
      if (feedWasSelected || focusWasSelected) availabilityFallback = "page";
    }
    syncHostPermissionState(activeUrl, platform);
    const canUseLiveTarget = displayedSessionIsActive && (
      (canRead && Boolean(session?.surface)) || platform === "facebook"
    );
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
    const modelContext = viewSession?.surface
      ? modelContextForSession({ ...viewSession, surface: viewSession.surface })
      : undefined;
    const excerpt = viewSession?.surface
      ? visibleExcerpt(viewSession.surface, modelContext, viewSession.advisor?.effectiveModelContext)
      : "";
    const hidePendingAdvisorState = shouldHidePendingPageAdvisorState(modelContext, viewSession?.advisor);
    const hideReadyPipelineState = hidePendingAdvisorState ||
      shouldHideReadyPipelineState(modelContext, viewSession?.advisor, viewSession?.analysis);
    const hideTechnicalDetails = hidePendingAdvisorState ||
      shouldHideCleanTechnicalDetails(viewSession?.surface, modelContext, viewSession?.advisor, viewSession?.analysis);
    const hasReadySurface = Boolean(session?.surface && session.status === "ready");
    const updatedAt = session ? formatUpdatedAt(session.updatedAt, lang) : "";
    const statusTitle = pageStatusTitle(session, updatedAt);
    const metadataRows: Array<[string, string, string?]> = session?.surface
      ? [
          [tr("sidepanel.page.meta.method"), session.surface.extraction.method],
          [tr("sidepanel.page.meta.extractionStatus"), session.surface.extraction.status],
          [tr("sidepanel.page.meta.textLength"), formatCount(session.surface.mainText.length)],
          [tr("sidepanel.page.meta.links"), formatCount(session.surface.links?.length)],
          [
            tr("sidepanel.page.meta.images"),
            (session.surface.images?.length ?? 0) >= GENERAL_PAGE_DEFAULT_MAX_IMAGES
              ? tr("sidepanel.page.meta.limitReached", { count: formatCount(session.surface.images?.length) })
              : formatCount(session.surface.images?.length),
          ],
        ]
      : [];
    const technicalDetails = session?.surface && !hideTechnicalDetails
      ? technicalDetailsHtml(
          [...metadataRows, ...pageTechnicalDiagnosticRows(modelContext, viewSession?.advisor, tr)],
          session.surface.extraction.warnings,
          tr,
        )
      : "";
    const screenshotBlock = viewSession && displayedSessionIsActive ? screenshotHtml(viewSession, tr) : "";
    const displayedAnalysis: PageReadingAnalysisSession | undefined = hidePendingAdvisorState
      ? { status: "running", updatedAt: viewSession?.advisor?.updatedAt ?? now() }
      : viewSession?.analysis;
    const contextPresentation = activeWorkspace === "page" && !hidePendingAdvisorState && viewSession?.surface
      ? pageContextPresentation(viewSession.surface, modelContext, viewSession.advisor, tr)
      : undefined;
    const focusBriefNote = displayedAnalysis?.brief?.note;
    const focusAggregationAdvisory = activeWorkspace === "focus" &&
      briefNoteIsAggregationGuidance(focusBriefNote)
      ? tr("sidepanel.page.focus.aggregationAdvisory")
      : activeWorkspace === "focus" && briefNoteMatchesPageContext(
        focusBriefNote,
        viewSession?.surface?.extraction.warnings ?? [],
        displayedAnalysis?.allowedUse,
      )
      ? tr("sidepanel.page.focus.navigationAdvisory")
      : "";
    const omitBriefNote = Boolean(
      activeWorkspace === "page" &&
      contextPresentation &&
      displayedAnalysis?.brief?.note &&
      briefNoteMatchesPageContext(
        displayedAnalysis.brief.note,
        viewSession?.surface?.extraction.warnings ?? [],
        displayedAnalysis.allowedUse,
      ),
    ) || Boolean(focusAggregationAdvisory);
    const focusAnalysisTitle = activeWorkspace === "focus" && viewSession?.target
      ? tr(viewSession.target.kind === "selection"
        ? "sidepanel.page.focus.selectionOverview"
        : "sidepanel.page.focus.regionOverview")
      : undefined;
    const analysisBlock = analysisHtml(
      displayedAnalysis,
      tr,
      viewSession?.surface?.title || viewSession?.title,
      omitBriefNote,
      focusAnalysisTitle,
    );
    const sourceLinksBlock = hidePendingAdvisorState
      ? ""
      : sourceLinksHtml(modelContext?.links ?? [], url, tr);
    const cleanReadyBodyOrder = hideReadyPipelineState;
    const shouldPrioritizeAnalysis = Boolean(analysisBlock && displayedAnalysis?.status !== "idle");
    const modelPipeline = screenshotBlock;
    const previewBlock = pagePreviewHtml(excerpt, tr);
    const pageContextPreviewBlock = hidePendingAdvisorState ? "" : previewBlock;
    const pageReadAction = pageReadActionHtml(
      canRead && displayedSessionIsActive,
      Boolean(session?.surface),
      Boolean(session?.surface && readSuccessFeedbackTabId === displayedTabId),
    );
    const cardToolButtons = session?.surface
      ? `
        <div class="page-reader-card-tools">
          <button id="pageCopyMetadata" class="btn-investigation-secondary page-reader-card-action" type="button">${COPY_ICON_SVG}<span class="btn-investigation-text">${escapeHtml(copyState === "copied" ? tr("sidepanel.page.copy.copied") : tr("sidepanel.page.copy"))}</span></button>
          <button id="pageDownloadMarkdown" class="btn-investigation-secondary page-reader-card-action" type="button">${DOWNLOAD_ICON_SVG}<span class="btn-investigation-text">${escapeHtml(downloadState === "saved" ? tr("sidepanel.page.download.saved") : downloadState === "cancelled" ? tr("sidepanel.page.download.cancelled") : downloadState === "failed" ? tr("sidepanel.page.download.failed") : tr("sidepanel.page.download"))}</span></button>
        </div>
      `
      : "";
    const cardFooterActions = cardToolButtons
      ? `
        <footer class="page-reader-card-footer page-reader-external-tools">
          <div class="page-reader-external-tools-label">${escapeHtml(tr("sidepanel.dynamic.actions.title"))}</div>
          <div class="page-reader-external-tools-hint">${escapeHtml(tr("sidepanel.dynamic.actions.hint"))}</div>
          ${cardToolButtons}
        </footer>
      `
      : "";
    const pageContextBlock = pageContextHtml(
      [pageContextPreviewBlock, sourceLinksBlock, technicalDetails],
      contextPresentation,
      false,
      tr,
    );
    const emptyBodyBlock = !session?.surface && !showErrorBlock && session?.status !== "loading" && platform === "general"
      ? emptyBody(
          platform,
          canRead,
          title,
          source || (url ? hostnameForUrl(url) : ""),
          pageReadAction,
          activePageNeedsDomainGrant(),
        )
      : "";
    const loadingBodyBlock = !session?.surface && session?.status === "loading" &&
      platform === "general" && activeWorkspace === "page"
      ? loadingBody(
          title,
          source || (url ? hostnameForUrl(url) : ""),
          statusLabel,
        )
      : "";
    const focusTargetError = typeof displayedTabId === "number" ? focusTargetErrors.get(displayedTabId) : undefined;
    const focusWorkspaceBlock = activeWorkspace === "focus" &&
      typeof activeTabId === "number" &&
      (platform === "general" || platform === "facebook")
      ? viewSession?.target
        ? focusScopeHtml(
            viewSession.target,
            canUseLiveTarget,
            source || (url ? hostnameForUrl(url) : ""),
            focusAggregationAdvisory,
            focusTargetError || "",
            analysisBlock,
            cardToolButtons,
            tr,
          )
        : `
        <section class="page-reader-focus-panel" data-state="${focusTargetError ? "error" : viewSession?.target ? "ready" : "empty"}">
          <div>
            <h3 class="page-reader-focus-title">${escapeHtml(tr("sidepanel.page.focus.title"))}</h3>
            <div class="page-reader-focus-detail">${escapeHtml(focusTargetError || (viewSession?.target ? tr("sidepanel.page.focus.ready") : tr("sidepanel.page.focus.empty")))}</div>
          </div>
          <button id="pageReadSelection" class="btn-investigation-secondary" type="button" ${canUseLiveTarget ? "" : "disabled"}>${escapeHtml(viewSession?.target ? tr("sidepanel.page.focus.update") : tr("sidepanel.page.useSelection"))}</button>
        </section>
      `
      : "";
    const cardMetaHtml = session?.surface
      ? `
        <div class="page-reader-card-meta"${statusTitle ? ` title="${escapeHtml(statusTitle)}"` : ""}>
          ${source || url ? `<span>${escapeHtml(source || hostnameForUrl(url))}</span>` : ""}
          ${updatedAt ? `<span>${escapeHtml(tr("sidepanel.page.status.lastRead", { updatedAt }))}</span>` : ""}
          ${pageReadAction}
        </div>
      `
      : "";
    const hasQuietEmptyBody = Boolean(emptyBodyBlock) && (!session || session.status === "idle");
    const statusBlock = hasReadySurface || hasQuietEmptyBody || Boolean(loadingBodyBlock) ||
      (activeWorkspace === "focus" && session?.status !== "error")
      ? ""
      : `
        <section class="page-reader-status${statusClass}${session?.surface ? "" : " is-standalone"}"${statusTitle ? ` title="${escapeHtml(statusTitle)}" aria-label="${escapeHtml(statusTitle)}"` : ""} aria-live="polite">
          <div class="page-reader-status-main">
            <div class="page-reader-status-label">${escapeHtml(statusLabel)}</div>
            <div class="page-reader-status-detail">${escapeHtml(statusDetailText)}</div>
          </div>
        </section>
      `;

    pagePaneEl.innerHTML = `
      ${statusBlock}
      ${showErrorBlock ? `<section class="page-reader-error">${escapeHtml(errorText)}</section>` : ""}
      ${focusWorkspaceBlock}
      ${session?.surface && activeWorkspace === "page" ? `
        <article class="page-reader-card">
          <div class="page-reader-card-header">
            <div class="page-reader-title-block">
              <h2>${escapeHtml(title)}</h2>
              ${cardMetaHtml}
            </div>
          </div>
          ${activeWorkspace === "page" ? pageContextBlock : ""}
          ${shouldPrioritizeAnalysis && !cleanReadyBodyOrder ? analysisBlock : ""}
          ${cleanReadyBodyOrder || shouldPrioritizeAnalysis ? "" : modelPipeline}
          ${cleanReadyBodyOrder || !shouldPrioritizeAnalysis ? analysisBlock : ""}
          ${cardFooterActions}
        </article>
      ` : loadingBodyBlock || emptyBodyBlock}
    `;
    syncLoadingTicker(session?.status === "loading");

    pagePaneEl.querySelector<HTMLButtonElement>("#pageReadSelection")?.addEventListener("click", () => {
      void requestSelectionTarget("sidepanel");
    });
    pagePaneEl.querySelector<HTMLButtonElement>("#pageReadCurrent")?.addEventListener("click", () => {
      void requestReadCurrentPage("sidepanel");
    });
    pagePaneEl.querySelector<HTMLButtonElement>("#pageAuthorizeDomain")?.addEventListener("click", () => {
      void requestActiveDomainAuthorization();
    });
    pagePaneEl.querySelector<HTMLButtonElement>("#pageCopyMetadata")?.addEventListener("click", async () => {
      const latest = currentSession();
      if (!latest) return;
      const scoped = materializeScopeSession(latest, pageWorkspace);
      try {
        await navigator.clipboard.writeText(buildCopyText(scoped));
        copyState = "copied";
      } catch {
        copyState = "failed";
      }
      render();
    });
    pagePaneEl.querySelector<HTMLButtonElement>("#pageDownloadMarkdown")?.addEventListener("click", async () => {
      const latest = currentSession();
      if (!latest) return;
      const scoped = materializeScopeSession(latest, pageWorkspace);
      try {
        const outcome = await saveMarkdownTextFile(
          buildCopyText(scoped),
          buildPageMarkdownFilename(scoped),
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
      runGeneralPageAnalysisIfEligible(
        latest.tabId,
        materializeScopeSession(latest, pageWorkspace),
        true,
        "quick",
        pageWorkspace,
      );
    });
    for (const questionCopyBtn of pagePaneEl.querySelectorAll<HTMLButtonElement>(".page-analysis-question-copy")) {
      questionCopyBtn.addEventListener("click", (event) => {
        event.stopPropagation();
        copyReadingBriefQuestion(questionCopyBtn, questionCopyBtn.dataset.question || "", getLang());
      });
    }
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
    if (availabilityFallback) activateTab(availabilityFallback);
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
    if (platform === "unsupported") return tr(unsupportedDetailKey(activeUnsupportedKind()));
    if (!session) return tr("sidepanel.page.detail.empty");
    if (session.status === "loading") return tr("sidepanel.page.detail.loading");
    if (session.status === "stale") return tr("sidepanel.page.detail.stale");
    return tr("sidepanel.page.detail.ready");
  }

  function activeUnsupportedKind(): UnsupportedPageKind {
    const inferred = unsupportedKindForTab(activeUrl, activeTitle);
    if (inferred !== "url_unavailable") return inferred;
    if (
      activeExtensionPageMarker &&
      typeof activeTabId === "number" &&
      activeExtensionPageMarker.tabId === activeTabId
    ) return "truly_extension";
    return "url_unavailable";
  }

  function emptyBody(
    platform: PagePlatform,
    canRead: boolean,
    targetTitle = "",
    targetMeta = "",
    actionHtml = "",
    needsDomainGrant = false,
  ): string {
    if (platform === "facebook")
      return `<section class="page-reader-empty">${escapeHtml(tr("sidepanel.page.empty.facebook"))}</section>`;
    if (!canRead)
      return `<section class="page-reader-empty">${escapeHtml(tr("sidepanel.page.empty.unsupported"))}</section>`;
    return `
      <article class="page-reader-card is-empty-target">
        <div class="page-reader-card-header">
          <div class="page-reader-title-block">
            <h2>${escapeHtml(targetTitle || tr("sidepanel.page.untitled"))}</h2>
            ${targetMeta ? `<div class="page-reader-card-meta"><span>${escapeHtml(targetMeta)}</span></div>` : ""}
          </div>
        </div>
        <section class="page-reader-empty page-reader-empty-state">
          <p>${escapeHtml(tr(needsDomainGrant ? "sidepanel.page.empty.permission" : "sidepanel.page.empty.general"))}</p>
          ${actionHtml}
        </section>
      </article>
    `;
  }

  function loadingBody(targetTitle: string, targetMeta: string, loadingLabel: string): string {
    return `
      <article class="page-reader-card is-loading-target" aria-busy="true">
        <div class="page-reader-card-header">
          <div class="page-reader-title-block">
            <h2>${escapeHtml(targetTitle || tr("sidepanel.page.untitled"))}</h2>
            <div class="page-reader-card-meta">
              ${targetMeta ? `<span>${escapeHtml(targetMeta)}</span>` : ""}
              <span class="page-reader-card-loading-status" role="status" aria-live="polite">${escapeHtml(loadingLabel)}</span>
            </div>
          </div>
        </div>
        <div class="page-reader-loading-context" aria-disabled="true">
          <span>${escapeHtml(tr("sidepanel.page.details"))}</span>
        </div>
        <section class="page-reader-analysis is-running page-reader-loading-analysis" aria-live="polite" aria-busy="true">
          <div class="page-reader-analysis-header">
            <h3>${escapeHtml(tr("sidepanel.page.analysis.title"))}</h3>
            <div class="reading-brief-loading page-reader-analysis-loading">${escapeHtml(tr("sidepanel.page.analysis.running"))}</div>
          </div>
          <div class="page-reader-loading-reserve" aria-hidden="true">
            <span></span>
            <span></span>
          </div>
        </section>
      </article>
    `;
  }

  function unsupportedDetailKey(kind: UnsupportedPageKind): string {
    switch (kind) {
      case "truly_extension":
        return "sidepanel.page.detail.unsupportedTruly";
      case "browser_internal":
        return "sidepanel.page.detail.unsupportedBrowser";
      case "other_extension":
        return "sidepanel.page.detail.unsupportedExtension";
      case "chrome_web_store":
        return "sidepanel.page.detail.unsupportedWebStore";
      case "file":
        return "sidepanel.page.detail.unsupportedFile";
      case "special_scheme":
        return "sidepanel.page.detail.unsupportedSpecial";
      case "url_unavailable":
        return "sidepanel.page.detail.unsupportedUrlUnavailable";
      case "unknown":
      default:
        return "sidepanel.page.detail.unsupported";
    }
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
    pushAuditEvent("screenshotHtml", {
      tabId: session.tabId,
      activeTabId,
      displayTabId,
      title: session.title,
      url: session.url,
      offerAllowed,
      shotStatus: shot?.status,
      hasDataUrl: Boolean(shot?.dataUrl),
    });
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
    if (!session || session.status === "stale") {
      pushAuditEvent("setScreenshotSkipped", {
        tabId,
        reason: !session ? "missing_session" : "stale_session",
        nextStatus: screenshot?.status,
      });
      return;
    }
    pushAuditEvent("setScreenshot", {
      tabId,
      nextStatus: screenshot?.status ?? "cleared",
      hasDataUrl: Boolean(screenshot?.dataUrl),
    });
    const pageScope = pageScopeForSession(session);
    sessions.set(tabId, replaceScopeState(session, "page", {
      ...pageScope,
      screenshot,
    }));
    if (tabId === activeTabId || tabId === displayTabId) render();
  }

  async function captureScreenshotPreview(tabId: number): Promise<void> {
    cancelPendingAutoRead();
    const session = sessions.get(tabId);
    pushAuditEvent("captureScreenshotPreviewStart", {
      tabId,
      hasSession: Boolean(session),
      hasSurface: Boolean(session?.surface),
      status: session?.status,
      hasCaptureVisibleTab: Boolean(tabs.captureVisibleTab),
    });
    if (!session?.surface || session.status === "stale" || !tabs.captureVisibleTab) return;
    try {
      const tab = tabs.get ? await tabs.get(tabId) : undefined;
      const windowId = typeof tab?.windowId === "number" ? tab.windowId : undefined;
      if (typeof windowId !== "number") throw new Error("window_unavailable");
      const dataUrl = await tabs.captureVisibleTab(windowId, { format: "jpeg", quality: 80 });
      pushAuditEvent("captureScreenshotPreviewDataUrl", {
        tabId,
        windowId,
        dataUrlType: typeof dataUrl,
        supported: isSupportedScreenshotDataUrl(dataUrl),
      });
      if (!isSupportedScreenshotDataUrl(dataUrl)) throw new Error("capture_invalid_data_url");
      setScreenshot(tabId, { status: "preview", dataUrl, updatedAt: now() });
    } catch {
      pushAuditEvent("captureScreenshotPreviewError", { tabId });
      setScreenshot(tabId, {
        status: "error",
        error: tr("sidepanel.page.screenshot.error"),
        updatedAt: now(),
      });
    }
  }

  async function sendConfirmedScreenshotAnalysis(tabId: number): Promise<void> {
    cancelPendingAutoRead();
    const storedSession = sessions.get(tabId);
    const session = storedSession ? materializeScopeSession(storedSession, "page") : undefined;
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
    const mode: GeneralPageAnalysisMode = "full";
    const key = `${generalPageAnalysisKey(effective, providerRuntime, mode)}|screenshot`;
    const dataUrl = shot.dataUrl;
    setScreenshot(tabId, { status: "sending", updatedAt: now() });
    setAnalysis(tabId, { status: "running", key, mode, allowedUse: effective.allowedUse, updatedAt: now() }, "page");
    try {
      const response = await runtime.sendMessage({
        type: "GENERAL_PAGE_ANALYSIS_REQUEST",
        tabId,
        context: analysisContext,
        allowedUse: effective.allowedUse,
        mode,
        providerRuntime,
        outputLang: getLang(),
        screenshotDataUrl: dataUrl,
      } satisfies TrulyMessage);
      const current = sessions.get(tabId);
      if (!current || current.status === "stale" || pageScopeForSession(current).analysis?.key !== key) return;
      if (!response || typeof response !== "object" || (response as { type?: unknown }).type !== "GENERAL_PAGE_ANALYSIS_RESULT") {
        setScreenshot(tabId, { status: "error", error: tr("sidepanel.page.screenshot.error"), updatedAt: now() });
        setAnalysisError(tabId, "general_page_brief_no_response", key, effective.allowedUse, "page");
        return;
      }
      const result = response as GeneralPageAnalysisResultMsg;
      if (!result.ok || !result.brief) {
        setScreenshot(tabId, { status: "error", error: result.error || tr("sidepanel.page.screenshot.error"), updatedAt: now() });
        setAnalysisError(tabId, result.error || "general_page_brief_failed", key, effective.allowedUse, "page");
        return;
      }
      setScreenshot(tabId, { status: "sent", updatedAt: now() });
      setAnalysis(tabId, { status: "ready", key, mode, brief: result.brief, allowedUse: effective.allowedUse, updatedAt: now() }, "page");
    } catch (error) {
      setScreenshot(tabId, { status: "error", error: errorMessage(error), updatedAt: now() });
      setAnalysisError(tabId, errorMessage(error), key, effective.allowedUse, "page");
    }
  }

  function setAdvisor(
    tabId: number,
    advisor: PageReadingAdvisorSession,
    scope: PageReadingScopeKind = "page",
  ): void {
    const session = sessions.get(tabId);
    if (!session || session.status === "stale") return;
    const currentScope = scopeStateForSession(session, scope);
    const nextSession = replaceScopeState(session, scope, {
      ...currentScope,
      advisor,
      analysis: advisor.effectiveModelContext ? currentScope.analysis : undefined,
    });
    sessions.set(tabId, nextSession);
    if (advisor.effectiveModelContext) {
      runGeneralPageAnalysisIfEligible(
        tabId,
        materializeScopeSession(nextSession, scope),
        false,
        "quick",
        scope,
      );
    }
    if (tabId === activeTabId || tabId === displayTabId) render();
  }

  function runGeneralPageAnalysisIfEligible(
    tabId: number,
    session: PageReadingSession,
    force: boolean,
    mode: GeneralPageAnalysisMode = "quick",
    scope: PageReadingScopeKind = session.target ? "focus" : "page",
  ): void {
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
    const key = generalPageAnalysisKey(effective, providerRuntime, mode);
    const currentScope = scopeStateForSession(session, scope);
    if (!force && currentScope.analysis?.key === key &&
      (currentScope.analysis.status === "running" || currentScope.analysis.status === "ready")) {
      return;
    }
    setAnalysis(tabId, {
      status: "running",
      key,
      mode,
      allowedUse: effective.allowedUse,
      updatedAt: now(),
    }, scope);
    void Promise.resolve(runtime.sendMessage({
      type: "GENERAL_PAGE_ANALYSIS_REQUEST",
      tabId,
      context: analysisContext,
      allowedUse: effective.allowedUse,
      mode,
      providerRuntime,
      outputLang: getLang(),
    } satisfies TrulyMessage)).then((response) => {
      const current = sessions.get(tabId);
      if (!current || current.status === "stale" || scopeStateForSession(current, scope).analysis?.key !== key) return;
      if (!current.surface || !isMeaningfullySamePage(current.identity, current.surface.url)) return;
      if (tabId === activeTabId && activeUrl && !isMeaningfullySamePage(current.identity, activeUrl)) return;
      if (!response || typeof response !== "object" || (response as { type?: unknown }).type !== "GENERAL_PAGE_ANALYSIS_RESULT") {
        setAnalysisError(tabId, "general_page_brief_no_response", key, effective.allowedUse, scope);
        return;
      }
      const result = response as GeneralPageAnalysisResultMsg;
      if (!result.ok || !result.brief) {
        setAnalysisError(tabId, result.error || "general_page_brief_failed", key, effective.allowedUse, scope);
        return;
      }
      setAnalysis(tabId, {
        status: "ready",
        key,
        mode,
        brief: result.brief,
        allowedUse: effective.allowedUse,
        updatedAt: now(),
      }, scope);
    }).catch((error) => {
      setAnalysisError(tabId, errorMessage(error), key, effective.allowedUse, scope);
    });
  }

  function setAnalysis(
    tabId: number,
    analysis: PageReadingAnalysisSession,
    scope: PageReadingScopeKind = "page",
  ): void {
    const session = sessions.get(tabId);
    if (!session || session.status === "stale") return;
    const currentScope = scopeStateForSession(session, scope);
    sessions.set(tabId, replaceScopeState(session, scope, {
      ...currentScope,
      analysis,
    }));
    if (tabId === activeTabId) render();
  }

  function setAnalysisError(
    tabId: number,
    error: string,
    key?: string,
    allowedUse?: GeneralPageEffectiveModelContextUse,
    scope: PageReadingScopeKind = "page",
  ): void {
    setAnalysis(tabId, {
      status: "error",
      key,
      error,
      allowedUse,
      updatedAt: now(),
    }, scope);
  }

  function generalPageAnalysisKey(
    effective: GeneralPageEffectiveModelContext,
    providerRuntime: GeneralPageParserAdvisorProviderRuntime,
    mode: GeneralPageAnalysisMode,
  ): string {
    return [
      mode,
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
    const scope: PageReadingScopeKind = target ? "focus" : "page";
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
      }, scope);
      return;
    }

    setAdvisor(tabId, {
      status: "checking",
      request,
      providerRuntime,
      updatedAt: now(),
    }, scope);

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
        (target && focusScopeForSession(current)?.target?.id !== target.id)
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
        }, scope);
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
        }, scope);
        return;
      }
      setAdvisor(tabId, {
        status: "ready",
        request,
        advice: result.advice,
        providerRuntime: result.providerRuntime ?? providerRuntime,
        effectiveModelContext: await buildEffectiveContextForAdvice(tabId, surface, context, request, result.advice),
        updatedAt: now(),
      }, scope);
    }).catch((error) => {
      setAdvisor(tabId, {
        status: "error",
        request,
        providerRuntime,
        effectiveModelContext,
        error: errorMessage(error),
        updatedAt: now(),
      }, scope);
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
      pageWorkspace = "focus";
      activateTab("focus");
      const tab = await refreshActiveTab(false);
      const tabId = typeof tab?.id === "number" ? tab.id : activeTabId;
      if (typeof tabId !== "number") return;
      const session = sessions.get(tabId);
      const platform = platformForUrl(tab?.url ?? activeUrl);
      const canBootstrapSelection = platform === "facebook";
      if ((!session?.surface && !canBootstrapSelection) || session?.status === "stale") {
        render();
        return;
      }
      if (session?.surface && !isMeaningfullySamePage(session.identity, tab?.url ?? session.url)) {
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
      focusTargetErrors.delete(tabId);
      render();
      const response = await runtime.sendMessage({
        type: "READING_TARGET_REQUEST",
        tabId,
        trigger: "selection",
        surfaceId: session?.surface?.id,
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
      pageWorkspace = "focus";
      activateTab("focus");
      const session = sessions.get(tabId);
      if (!session?.surface || session.status === "stale") {
        // Hotkey without a live read session: no activeTab grant is implied,
        // so show the existing toolbar-activation guidance.
        handlePageReadingError({
          type: "PAGE_READING_ERROR",
          tabId,
          error: "page_grant_missing",
        });
        return;
      }
      render();
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
    void sessionStore.get(PENDING_PAGE_READING_COMMAND_KEY).then((result) => {
      consumePendingPageReadingCommand(result?.[PENDING_PAGE_READING_COMMAND_KEY]);
    }).catch(() => {});
    void sessionStore.get(PENDING_CURRENT_REGION_READ_KEY).then((result) => {
      consumePendingCurrentRegionRead(result?.[PENDING_CURRENT_REGION_READ_KEY]);
    }).catch(() => {});
    sessionStore.onChanged?.addListener((changes, areaName) => {
      if (areaName !== "session") return;
      if (changes[ACTIVE_EXTENSION_PAGE_MARKER_KEY]) {
        void refreshActiveExtensionPageMarker();
      }
      const pageCommandChange = changes[PENDING_PAGE_READING_COMMAND_KEY];
      if (pageCommandChange?.newValue !== undefined) {
        consumePendingPageReadingCommand(pageCommandChange.newValue);
      }
      const change = changes[PENDING_CURRENT_REGION_READ_KEY];
      if (!change || change.newValue === undefined) return;
      consumePendingCurrentRegionRead(change.newValue);
    });
  }

  function consumePendingPageReadingCommand(raw: unknown): void {
    const envelope = parseReadingCommandEnvelope(raw, now());
    void sessionStore?.remove(PENDING_PAGE_READING_COMMAND_KEY);
    if (!envelope || consumedReadingCommandIds.has(envelope.requestId)) return;
    consumedReadingCommandIds.add(envelope.requestId);
    void (async () => {
      const tab = tabs.get ? await tabs.get(envelope.tabId).catch(() => undefined) : undefined;
      if (!tab || typeof tab.id !== "number" || !tab.url) return;
      if (!isMeaningfullySamePage(pageUrlIdentity(envelope.url), tab.url)) return;
      if (platformForUrl(tab.url) !== "general") return;
      await requestReadCurrentPage(envelope.activation.source, {
        tab,
        requestId: envelope.requestId,
      });
    })();
  }

  async function requestReadCurrentPage(
    source: PageActivationSource = "sidepanel",
    options: { activateWorkspace?: boolean; tab?: BrowserTab; requestId?: string } = {},
  ): Promise<void> {
    clearAutoReadTimer();
    autoReadToken += 1;
    let requestId = options.requestId;
    try {
      const tab = options.tab ?? await refreshActiveTab(false);
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
      if (platformForUrl(tabUrl) !== "general") {
        render();
        return;
      }
      copyState = "idle";
      downloadState = "idle";
      activeTabId = tab.id;
      displayTabId = tab.id;
      activeUrl = tabUrl;
      activeTitle = tab.title ?? "";
      const previousSession = sessions.get(tab.id);
      const preserveFocusScope = previousSession &&
        isMeaningfullySamePage(previousSession.identity, activeUrl)
        ? focusScopeForSession(previousSession)
        : undefined;
      if (previousSession?.surface && previousSession.status === "ready") {
        pendingRereadFeedback.add(tab.id);
      } else {
        pendingRereadFeedback.delete(tab.id);
      }
      clearReadSuccessFeedback(tab.id);
      const startedAt = now();
      requestId ??= createReadingRequestId();
      sessions.set(tab.id, {
        requestId,
        tabId: tab.id,
        url: activeUrl,
        identity: pageUrlIdentity(activeUrl),
        title: activeTitle,
        status: "loading",
        target: undefined,
        advisor: undefined,
        analysis: undefined,
        screenshot: undefined,
        pageScope: {},
        focusScope: preserveFocusScope,
        startedAt,
        updatedAt: startedAt,
        activationSource: source,
      });
      if (options.activateWorkspace !== false) activateTab("page");
      render();
      const response = await runtime.sendMessage({
        type: "PAGE_READING_REQUEST",
        requestId,
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
          requestId,
          tabId: activeTabId,
          error: errorMessage(error),
        });
      } else {
        render();
      }
    }
  }

  function shouldRevealIncomingPageRead(tabId: number): boolean {
    return !displayTabId || displayTabId === tabId || !sessions.has(displayTabId);
  }

  function handlePageReadingResult(message: PageReadingResultMsg): void {
    const tabId = typeof message.tabId === "number" ? message.tabId : activeTabId;
    if (typeof tabId !== "number") return;
    const existing = sessions.get(tabId);
    if (message.requestId && existing?.requestId && message.requestId !== existing.requestId) return;
    const preservePendingFocus = pageWorkspace === "focus" && existing?.status === "loading";
    const shouldShowRereadSuccess = pendingRereadFeedback.delete(tabId);
    const duplicateReadySurface = existing?.status === "ready" &&
      existing.surface?.id === message.surface.id &&
      isMeaningfullySamePage(existing.identity, message.surface.url) &&
      existing.surface.mainText === message.surface.mainText &&
      existing.surface.excerpt === message.surface.excerpt &&
      existing.surface.selectedText === message.surface.selectedText &&
      existing.surface.extraction.method === message.surface.extraction.method &&
      existing.surface.extraction.status === message.surface.extraction.status &&
      existing.surface.extraction.warnings.join("|") === message.surface.extraction.warnings.join("|");
    if (duplicateReadySurface) return;
    const completedAt = now();
    const elapsedMs = typeof message.elapsedMs === "number" && Number.isFinite(message.elapsedMs)
      ? Math.max(0, message.elapsedMs)
      : typeof existing?.startedAt === "number"
      ? Math.max(0, completedAt - existing.startedAt)
      : undefined;
    const nextIdentity = pageUrlIdentity(message.surface.url, message.surface.canonicalUrl);
    const existingPageScope = existing ? pageScopeForSession(existing) : {};
    const preserveScreenshot = existing && existingPageScope.screenshot &&
      existing.status !== "stale" &&
      isMeaningfullySamePage(existing.identity, message.surface.url)
      ? existingPageScope.screenshot
      : undefined;
    const preserveRecoveryState = Boolean(preserveScreenshot);
    const preserveFocusScope = existing &&
      existing.status !== "stale" &&
      isMeaningfullySamePage(existing.identity, message.surface.url)
      ? focusScopeForSession(existing)
      : undefined;
    const revealIncoming = shouldRevealIncomingPageRead(tabId);
    copyState = "idle";
    downloadState = "idle";
    if (!preservePendingFocus && (revealIncoming || tabId === activeTabId || tabId === displayTabId)) {
      pageWorkspace = "page";
    }
    sessions.set(tabId, {
      requestId: message.requestId ?? existing?.requestId,
      tabId,
      url: message.surface.url,
      identity: nextIdentity,
      title: message.surface.title,
      surface: message.surface,
      target: undefined,
      candidateBlocks: message.candidateBlocks ?? [],
      advisor: undefined,
      status: "ready",
      updatedAt: completedAt,
      startedAt: existing?.startedAt ?? (typeof elapsedMs === "number" ? completedAt - elapsedMs : undefined),
      completedAt,
      elapsedMs,
      activationSource: existing?.activationSource ?? "toolbar",
      analysis: undefined,
      screenshot: undefined,
      pageScope: preserveRecoveryState
        ? {
            advisor: existingPageScope.advisor,
            analysis: existingPageScope.analysis,
            screenshot: preserveScreenshot,
          }
        : {},
      focusScope: preserveFocusScope,
    });
    if (revealIncoming) {
      displayTabId = tabId;
    }
    if (shouldShowRereadSuccess) showReadSuccessFeedback(tabId);
    if (!preserveRecoveryState) {
      startParserAdvisor(tabId, message.surface, {
        candidateBlocks: message.candidateBlocks ?? [],
      });
    } else if (tabId === activeTabId || displayTabId === tabId) {
      render();
    }
  }

  function handleReadingTargetResult(message: ReadingTargetResultMsg): void {
    const tabId = typeof message.tabId === "number" ? message.tabId : activeTabId;
    if (typeof tabId !== "number") return;
    const existing = sessions.get(tabId);
    if (existing?.status === "stale") return;
    const canBootstrapSelection = tabId === activeTabId && platformForUrl(activeUrl) === "facebook";
    if (!existing?.surface && !canBootstrapSelection) return;
    const selectionSurface: ReadingSurface = existing?.surface ?? {
      id: message.target.surfaceId,
      kind: "web-page",
      source: "general",
      url: activeUrl,
      canonicalUrl: activeUrl,
      title: activeTitle || tr("sidepanel.page.focus.title"),
      sourceName: hostnameForUrl(activeUrl),
      mainText: message.target.text,
      selectedText: message.target.text,
      excerpt: message.target.text,
      extraction: {
        method: "selection",
        status: "complete",
        warnings: ["selection-only"],
      },
    };
    if (message.target.surfaceId !== selectionSurface.id) {
      handleReadingTargetError({
        type: "READING_TARGET_ERROR",
        tabId,
        error: "target_stale",
      });
      return;
    }
    const nextSession: PageReadingSession = existing?.surface ? existing : {
      tabId,
      url: activeUrl,
      identity: pageUrlIdentity(activeUrl),
      title: activeTitle,
      surface: selectionSurface,
      status: "ready",
      updatedAt: now(),
      completedAt: now(),
      activationSource: "sidepanel",
    };
    sessions.set(tabId, {
      ...nextSession,
      surface: selectionSurface,
      target: undefined,
      status: "ready",
      updatedAt: now(),
      analysis: undefined,
      screenshot: undefined,
      pageScope: pageScopeForSession(nextSession),
      focusScope: {
        target: message.target,
      },
    });
    copyState = "idle";
    downloadState = "idle";
    focusTargetErrors.delete(tabId);
    displayTabId = tabId;
    pageWorkspace = "focus";
    activateTab("focus");
    if (tabId === activeTabId || tabId === displayTabId) render();
    startParserAdvisor(tabId, selectionSurface, {
      target: message.target,
      candidateBlocks: nextSession.candidateBlocks,
    });
  }

  function handleReadingTargetError(message: ReadingTargetErrorMsg): void {
    const tabId = typeof message.tabId === "number" ? message.tabId : activeTabId;
    if (typeof tabId !== "number") return;
    const existing = sessions.get(tabId);
    focusTargetErrors.set(tabId, friendlyTargetError(message.error));
    if (!existing?.surface) {
      pageWorkspace = "focus";
      activateTab("focus");
      if (tabId === activeTabId || tabId === displayTabId) render();
      return;
    }
    if (shouldRevealIncomingPageRead(tabId)) {
      displayTabId = tabId;
    }
    if (shouldRevealIncomingPageRead(tabId)) {
      displayTabId = tabId;
    }
    if (tabId === activeTabId || tabId === displayTabId) render();
  }

  function handlePageReadingError(message: PageReadingErrorMsg): void {
    const tabId = typeof message.tabId === "number" ? message.tabId : activeTabId;
    if (typeof tabId !== "number") return;
    pendingRereadFeedback.delete(tabId);
    clearReadSuccessFeedback(tabId);
    const existing = sessions.get(tabId);
    if (message.requestId && existing?.requestId && message.requestId !== existing.requestId) return;
    const completedAt = now();
    const elapsedMs = typeof message.elapsedMs === "number" && Number.isFinite(message.elapsedMs)
      ? Math.max(0, message.elapsedMs)
      : typeof existing?.startedAt === "number"
      ? Math.max(0, completedAt - existing.startedAt)
      : undefined;
    const sessionUrl = existing?.url || activeUrl;
    if (platformForUrl(sessionUrl) === "unsupported" && !existing?.surface) {
      sessions.delete(tabId);
      if (tabId === activeTabId || tabId === displayTabId) render();
      return;
    }
    sessions.set(tabId, {
      requestId: message.requestId ?? existing?.requestId,
      tabId,
      url: sessionUrl,
      identity: existing?.identity || pageUrlIdentity(sessionUrl),
      title: existing?.title || activeTitle,
      surface: existing?.surface,
      target: undefined,
      candidateBlocks: existing?.candidateBlocks,
      advisor: undefined,
      analysis: undefined,
      screenshot: undefined,
      pageScope: existing ? pageScopeForSession(existing) : {},
      focusScope: existing ? focusScopeForSession(existing) : undefined,
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
      if (tabs.get) {
        void tabs.get(activeInfo.tabId)
          .then((tab) => setActiveTab(tab ?? { id: activeInfo.tabId }, true))
          .catch(() => setActiveTab({ id: activeInfo.tabId }, true));
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
      focusTargetErrors.delete(tabId);
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
    refresh: render,
    setWorkspace,
    requestReadCurrentPage,
    requestPointTarget,
    auditState: () => {
      const session = currentSession();
      const scopedSession = session ? materializeScopeSession(session, pageWorkspace) : undefined;
      const pageScope = session ? pageScopeForSession(session) : undefined;
      const focusScope = session ? focusScopeForSession(session) : undefined;
      return {
        activeTabId,
        displayTabId,
        displayedSession: scopedSession
          ? {
              requestId: scopedSession.requestId,
              status: scopedSession.status,
              hasSurface: Boolean(scopedSession.surface),
              screenshotStatus: scopedSession.screenshot?.status,
              screenshotHasDataUrl: Boolean(scopedSession.screenshot?.dataUrl),
              advisorStatus: scopedSession.advisor?.status,
              advisorDecision: scopedSession.advisor?.advice?.decision ?? "none",
              analysisStatus: scopedSession.analysis?.status,
              autoReadPending: scopedSession.autoReadPending,
              targetKind: scopedSession.surface ? modelContextForSession({ ...scopedSession, surface: scopedSession.surface }).targetKind : undefined,
              allowedUse: scopedSession.advisor?.effectiveModelContext?.allowedUse,
              pageAnalysisStatus: pageScope?.analysis?.status,
              focusAnalysisStatus: focusScope?.analysis?.status,
            }
          : undefined,
      };
    },
    handlePageReadingResult,
    handlePageReadingError,
  };
}
