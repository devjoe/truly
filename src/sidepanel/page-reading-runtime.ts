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
  type GeneralPageParserAdvisorAdvice,
  type GeneralPageParserAdvisorCandidateBlock,
  type GeneralPageParserAdvisorRequest,
} from "../lib/general-page-parser-advisor";
import type { Lang, UserSettings } from "../lib/types";
import { DEFAULT_SETTINGS } from "../lib/types";
import type {
  GeneralPageCandidateBlockTextResultMsg,
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
import {
  isMeaningfullySamePage,
  pageUrlIdentity,
  type PageUrlIdentity,
} from "../lib/page-url-identity";
import type { TabId } from "./tabs";

type PagePlatform = "facebook" | "general" | "unsupported";
type PageSessionStatus = "idle" | "loading" | "ready" | "error" | "stale";
type PageActivationSource = "toolbar" | "popup" | "sidepanel" | "hotkey";

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
  activationSource: PageActivationSource;
  advisor?: PageReadingAdvisorSession;
}

type PageReadingAdvisorStatus = "not_needed" | "checking" | "ready" | "error";

interface PageReadingAdvisorSession {
  status: PageReadingAdvisorStatus;
  request?: GeneralPageParserAdvisorRequest;
  advice?: GeneralPageParserAdvisorAdvice;
  effectiveModelContext?: GeneralPageEffectiveModelContext;
  providerRuntime?: GeneralPageParserAdvisorProviderRuntime;
  error?: string;
  updatedAt: number;
}

interface BrowserTab {
  id?: number;
  url?: string;
  title?: string;
  active?: boolean;
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
}

interface RuntimeApi {
  sendMessage(message: TrulyMessage): Promise<unknown>;
}

export interface SidepanelPageReadingRuntime {
  install(): void;
  requestReadCurrentPage(source?: PageActivationSource): Promise<void>;
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
  return lines.join("\n");
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
  const rows = [
    [tr("sidepanel.page.model.text"), `${context.mainText.length}/${GENERAL_PAGE_MODEL_MIN_MAIN_TEXT_LENGTH}`],
    [tr("sidepanel.page.model.links"), formatCount(context.links.length)],
    [tr("sidepanel.page.model.imageAlt"), formatCount(context.imageAltText.length)],
    [tr("sidepanel.page.model.target"), context.targetKind],
  ];
  return `
    <section class="page-reader-model-context is-${context.modelReadiness}">
      <div class="page-reader-model-context-header">
        <h3>${escapeHtml(tr("sidepanel.page.model.title"))}</h3>
        <span>${escapeHtml(statusText)}</span>
      </div>
      <p>${escapeHtml(context.modelReadiness === "ready" ? tr("sidepanel.page.model.readyDetail") : reason)}</p>
      <dl>
        ${rows.map(([label, value]) => `<div><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd></div>`).join("")}
      </dl>
    </section>
  `;
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
  return advisor.advice?.decision ?? "none";
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
  const rows = [
    [tr("sidepanel.page.advisor.decision"), advisorDecisionLabel(advisor, tr)],
    [tr("sidepanel.page.advisor.provider"), provider],
    [tr("sidepanel.page.advisor.payload"), advisor.request ? `${advisor.request.payloadBudget.estimatedPayloadChars}/${advisor.request.payloadBudget.maxPayloadChars}` : "-"],
    [tr("sidepanel.page.advisor.allowedUse"), effective?.allowedUse ?? "-"],
  ];
  const modelMode = advisor.providerRuntime?.mode === "tier-b-short-json" && advisor.providerRuntime.canUseModel
    ? tr("sidepanel.page.advisor.mode.modelReady")
    : advisor.providerRuntime?.mode === "tier-b-short-json-fallback"
    ? tr("sidepanel.page.advisor.mode.modelFallback")
    : tr("sidepanel.page.advisor.mode.localBaseline");
  return `
    <section class="page-reader-advisor is-${escapeHtml(advisor.status)}">
      <div class="page-reader-advisor-header">
        <h3>${escapeHtml(tr("sidepanel.page.advisor.title"))}</h3>
        <span>${escapeHtml(statusText)}</span>
      </div>
      <p>${escapeHtml(detail)}</p>
      <dl>
        ${rows.map(([label, value]) => `<div><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd></div>`).join("")}
      </dl>
      <div class="page-reader-advisor-note">${escapeHtml(modelMode)}</div>
    </section>
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
}: CreateSidepanelPageReadingRuntimeOptions): SidepanelPageReadingRuntime {
  const sessions = new Map<number, PageReadingSession>();
  let activeTabId: number | null = null;
  let activeUrl = "";
  let activeTitle = "";
  let installed = false;
  let copyState: "idle" | "copied" | "failed" = "idle";

  function tr(key: string, params?: Record<string, string | number>): string {
    return t(key, getLang(), params);
  }

  function currentSession(): PageReadingSession | undefined {
    return typeof activeTabId === "number" ? sessions.get(activeTabId) : undefined;
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

  function setActiveTab(tab: BrowserTab | undefined, activate = true): void {
    if (typeof tab?.id === "number") activeTabId = tab.id;
    activeUrl = tab?.url ?? activeUrl;
    activeTitle = tab?.title ?? activeTitle;
    const platform = platformForUrl(activeUrl);
    if (activate) {
      if (platform === "facebook") activateTab("analysis");
      else if (platform === "general") activateTab("page");
    }
    const session = currentSession();
    if (session && activeUrl && !isMeaningfullySamePage(session.identity, activeUrl)) {
      session.status = "stale";
      session.url = activeUrl;
      session.title = activeTitle || session.title;
      session.surface = undefined;
      session.target = undefined;
      session.candidateBlocks = undefined;
      session.advisor = undefined;
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
      status: "stale",
      updatedAt: now(),
    });
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
    const canRead = platform === "general" && typeof activeTabId === "number" && isHttpLikeUrl(activeUrl);
    const statusClass = session?.status ? ` page-status-${session.status}` : "";
    const statusLabel = session
      ? tr(`sidepanel.page.status.${session.status}`)
      : platform === "facebook"
      ? tr("sidepanel.page.status.facebook")
      : platform === "unsupported"
      ? tr("sidepanel.page.status.unsupported")
      : tr("sidepanel.page.status.idle");
    const title = session?.surface?.title || session?.title || activeTitle || tr("sidepanel.page.untitled");
    const url = session?.surface?.canonicalUrl || session?.surface?.url || session?.url || activeUrl;
    const source = session?.surface?.sourceName || (url ? hostnameForUrl(url) : "");
    const modelContext = session?.surface
      ? modelContextForSession({ ...session, surface: session.surface })
      : undefined;
    const excerpt = session?.surface
      ? visibleExcerpt(session.surface, modelContext, session.advisor?.effectiveModelContext)
      : "";
    const warningText = session?.surface?.extraction.warnings.join(", ") || "";
    const updatedAt = session ? formatUpdatedAt(session.updatedAt, lang) : "";
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
          <button id="pageReadSelection" class="btn-investigation-secondary" type="button" ${canRead && session?.surface ? "" : "disabled"}>${escapeHtml(tr("sidepanel.page.useSelection"))}</button>
        </div>
      </section>
      <section class="page-reader-status${statusClass}">
        <div class="page-reader-status-label">${escapeHtml(statusLabel)}</div>
        <div class="page-reader-status-detail">${escapeHtml(statusDetail(platform, session))}</div>
      </section>
      ${session?.status === "error" ? `<section class="page-reader-error">${escapeHtml(session.error || tr("sidepanel.page.error.unknown"))}</section>` : ""}
      ${session?.surface ? `
        <article class="page-reader-card">
          <div class="page-reader-card-header">
            <div class="page-reader-title-block">
              <h2>${escapeHtml(title)}</h2>
              <div class="page-reader-url">${escapeHtml(source || url)}</div>
            </div>
            <button id="pageCopyMetadata" class="btn-investigation-secondary" type="button">${escapeHtml(copyState === "copied" ? tr("sidepanel.page.copy.copied") : tr("sidepanel.page.copy"))}</button>
          </div>
          ${excerpt ? `<p class="page-reader-excerpt">${escapeHtml(excerpt)}</p>` : `<p class="page-reader-empty">${escapeHtml(tr("sidepanel.page.noExcerpt"))}</p>`}
          <dl class="page-reader-meta">
            ${metadataRows.map(([label, value]) => `<div><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd></div>`).join("")}
          </dl>
          ${modelContextHtml(modelContext, tr)}
          ${advisorHtml(session.advisor, tr)}
          ${sourceLinksHtml(modelContext?.links ?? [], tr("sidepanel.page.sourceLinks"))}
          ${warningText ? `<div class="page-reader-warnings"><span>${escapeHtml(tr("sidepanel.page.warnings"))}</span>${escapeHtml(warningText)}</div>` : ""}
        </article>
      ` : emptyBody(platform, canRead)}
    `;

    pagePaneEl.querySelector<HTMLButtonElement>("#pageReadCurrent")?.addEventListener("click", () => {
      void requestReadCurrentPage("sidepanel");
    });
    pagePaneEl.querySelector<HTMLButtonElement>("#pageReadSelection")?.addEventListener("click", () => {
      void requestSelectionTarget("sidepanel");
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
  }

  function statusDetail(platform: PagePlatform, session: PageReadingSession | undefined): string {
    if (session?.status === "error") return tr("sidepanel.page.detail.error");
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
    if (error === "page_grant_missing")
      return tr("sidepanel.page.error.needsToolbarActivation");
    if (error === "target_stale")
      return tr("sidepanel.page.target.error.stale");
    if (error === "reading_target_unsupported")
      return tr("sidepanel.page.error.unsupportedAction");
    return tr("sidepanel.page.target.error.failed");
  }

  function setAdvisor(tabId: number, advisor: PageReadingAdvisorSession): void {
    const session = sessions.get(tabId);
    if (!session || session.status === "stale") return;
    sessions.set(tabId, {
      ...session,
      advisor,
      updatedAt: session.updatedAt,
    });
    if (tabId === activeTabId) render();
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
      allowScreenshot: false,
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
      activeTabId = tab.id;
      activeUrl = tabUrl;
      activeTitle = tab.title ?? "";
      sessions.set(tab.id, {
        tabId: tab.id,
        url: activeUrl,
        identity: pageUrlIdentity(activeUrl),
        title: activeTitle,
        status: "loading",
        target: undefined,
        advisor: undefined,
        updatedAt: now(),
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
    copyState = "idle";
    sessions.set(tabId, {
      tabId,
      url: message.surface.url,
      identity: pageUrlIdentity(message.surface.url, message.surface.canonicalUrl),
      title: message.surface.title,
      surface: message.surface,
      target: undefined,
      candidateBlocks: message.candidateBlocks ?? [],
      status: "ready",
      updatedAt: now(),
      activationSource: "sidepanel",
    });
    if (tabId === activeTabId) render();
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
    });
    if (tabId === activeTabId) render();
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
      updatedAt: now(),
    });
    if (tabId === activeTabId) render();
  }

  function handlePageReadingError(message: PageReadingErrorMsg): void {
    const tabId = typeof message.tabId === "number" ? message.tabId : activeTabId;
    if (typeof tabId !== "number") return;
    const existing = sessions.get(tabId);
    sessions.set(tabId, {
      tabId,
      url: existing?.url || activeUrl,
      identity: existing?.identity || pageUrlIdentity(existing?.url || activeUrl),
      title: existing?.title || activeTitle,
      surface: existing?.surface,
      target: undefined,
      candidateBlocks: existing?.candidateBlocks,
      advisor: undefined,
      status: "error",
      error: friendlyPageReadingError(message.error),
      updatedAt: now(),
      activationSource: existing?.activationSource || "sidepanel",
    });
    if (tabId === activeTabId) render();
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
      setActiveTab(tab, true);
    });
    tabs.onRemoved?.addListener((tabId) => {
      sessions.delete(tabId);
      if (tabId === activeTabId) render();
    });
    render();
  }

  return {
    install,
    requestReadCurrentPage,
    handlePageReadingResult,
    handlePageReadingError,
  };
}
