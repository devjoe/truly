import { t } from "../lib/i18n";
import type { Lang } from "../lib/types";
import type { PageReadingErrorMsg, PageReadingResultMsg, TrulyMessage } from "../lib/messages";
import type { ReadingSurface } from "../lib/reading-surface-types";
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
  status: PageSessionStatus;
  error?: string;
  updatedAt: number;
  activationSource: PageActivationSource;
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

function visibleExcerpt(surface: ReadingSurface): string {
  const text = (surface.excerpt || surface.mainText || "").trim().replace(/\s+/g, " ");
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
  const excerpt = surface ? visibleExcerpt(surface) : "";
  if (excerpt) lines.push("", "Excerpt:", excerpt);
  return lines.join("\n");
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
    if (error.includes("Cannot access contents of the page")) {
      return tr("sidepanel.page.error.needsToolbarActivation");
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
      session.updatedAt = now();
    }
    render();
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
    const excerpt = session?.surface ? visibleExcerpt(session.surface) : "";
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
        <button id="pageReadCurrent" class="btn-investigation-secondary" type="button" ${canRead ? "" : "disabled"}>${escapeHtml(tr("sidepanel.page.readCurrent"))}</button>
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
          ${warningText ? `<div class="page-reader-warnings"><span>${escapeHtml(tr("sidepanel.page.warnings"))}</span>${escapeHtml(warningText)}</div>` : ""}
        </article>
      ` : emptyBody(platform, canRead)}
    `;

    pagePaneEl.querySelector<HTMLButtonElement>("#pageReadCurrent")?.addEventListener("click", () => {
      void requestReadCurrentPage("sidepanel");
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
      status: "ready",
      updatedAt: now(),
      activationSource: "sidepanel",
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
      if (tabId !== activeTabId) return;
      if (!changeInfo.url && changeInfo.status !== "complete") return;
      setActiveTab(tab, true);
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
