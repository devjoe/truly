import browser from "webextension-polyfill";
import type { UserSettings } from "../lib/types";
import { normalizeUserSettings } from "../lib/settings";
import { createExtensionThemeController } from "../lib/theme-mode";
import { createExtensionLanguageController, resolveLanguage, t } from "../lib/i18n";
import type { Lang } from "../lib/types";
import { getFacebookPageSupport } from "../lib/facebook-page-support";
import { providerNeedsEndpoint } from "../lib/provider-capabilities";
import { defaultEndpointForProvider, defaultModelForProvider } from "../lib/model-source-config";
import {
  isReadinessRecordFresh,
  readinessFingerprint,
  type ReadinessRecord,
} from "../lib/readiness";
import { loadReadinessSnapshot } from "../lib/readiness-storage";
import type { GetSidePanelStateResultMsg } from "../lib/messages";

console.log(`[Truly Popup] Loaded buildId=${__TRULY_BUILD_ID__}`);

async function loadSettings(): Promise<UserSettings> {
  const result = await browser.storage.sync.get("settings");
  return normalizeUserSettings(result.settings as Partial<UserSettings> | undefined);
}

async function saveSettings(settings: UserSettings): Promise<void> {
  const normalized = normalizeUserSettings(settings);
  await browser.storage.sync.set({ settings: normalized });
  // Content scripts only learn about settings changes from SETTINGS_UPDATED
  // (there is no storage.onChanged listener for `settings`), so a popup toggle
  // must reach EVERY open Facebook tab — not just the active one — or other
  // tabs keep running with the old enabled/config state until reloaded.
  try {
    await browser.runtime.sendMessage({ type: "SETTINGS_UPDATED", settings: normalized });
  } catch {
    /* ignore — side panel may not be open */
  }
  try {
    const tabs = await browser.tabs.query({});
    for (const tab of tabs) {
      if (typeof tab.id === "number") {
        browser.tabs.sendMessage(tab.id, {
          type: "SETTINGS_UPDATED",
          settings: normalized,
        }).catch(() => {});
      }
    }
  } catch {
    /* tabs API may be unavailable in some contexts */
  }
}

function isReady(record: ReadinessRecord | undefined): boolean {
  return record?.status === "passed" || record?.status === "slow_but_usable";
}

function readinessSummary(record: ReadinessRecord | undefined, fallback: string, lang: Lang): string {
  if (!record) return fallback;
  return t(`readiness.status.${record.status}`, lang);
}

async function init() {
  const settings = await loadSettings();
  createExtensionThemeController().setMode(settings.themeMode);
  const lang: Lang = resolveLanguage(settings.language);
  createExtensionLanguageController().setLanguage(settings.language);
  const tierAConfig = await browser.storage.local.get(["ollamaEndpoint", "ollamaModel"]);
  const readinessSnapshot = await loadReadinessSnapshot(browser.storage.local as any);
  const [activeTab] = await browser.tabs.query({
    active: true,
    currentWindow: true,
  });
  let activeUrl = activeTab?.url ?? "";
  const auditActiveUrl = new URLSearchParams(window.location.search).get("auditActiveUrl");

  // Directly opening popup.html for screenshot audits makes the extension page
  // the active tab. The real browser-action popup keeps the Facebook tab as
  // the active context, so fall back to any visible Facebook tab.
  if (auditActiveUrl) {
    activeUrl = auditActiveUrl;
  } else if (!activeUrl || activeUrl.startsWith(`chrome-extension://${chrome.runtime.id}/`)) {
    const fbTabs = await browser.tabs.query({ url: ["*://*.facebook.com/*"] });
    if (fbTabs[0]) {
      activeUrl = fbTabs[0].url ?? "";
    }
  }

  const pageSupport = getFacebookPageSupport(activeUrl);

  const pageDot = document.getElementById("pageDot")!;
  const readinessTitle = document.getElementById("readinessTitle")!;
  const readinessDetail = document.getElementById("readinessDetail")!;
  const infoToggle = document.getElementById("infoToggle") as HTMLButtonElement;
  const unsupportedDetail = document.getElementById("unsupportedDetail")!;
  const dashboardLink = document.getElementById("dashboardLink") as HTMLButtonElement;
  const dashboardLabel = document.getElementById("dashboardLabel")!;
  let sidePanelOpen = false;
  const sidePanelCanClose = typeof chrome.sidePanel?.close === "function";
  let isCheckingSidePanelState = pageSupport.supported && sidePanelCanClose;

  const inheritedTierAEndpoint = typeof tierAConfig.ollamaEndpoint === "string"
    ? tierAConfig.ollamaEndpoint.trim()
    : defaultEndpointForProvider("ollama");
  const inheritedTierAModel = typeof tierAConfig.ollamaModel === "string"
    ? tierAConfig.ollamaModel.trim()
    : defaultModelForProvider("ollama", "reading-prompt");
  const readinessEnvironment = {
    tierAEndpoint: inheritedTierAEndpoint,
    tierAModel: inheritedTierAModel,
    buildId: __TRULY_BUILD_ID__,
  };
  const realtimeFingerprint = readinessFingerprint("realtime", settings, readinessEnvironment);
  const aiAnalysisFingerprint = readinessFingerprint("ai_analysis", settings, readinessEnvironment);
  const realtimeReadiness = isReadinessRecordFresh(
    readinessSnapshot.realtime,
    realtimeFingerprint,
  ) ? readinessSnapshot.realtime : undefined;
  const aiAnalysisReadiness = isReadinessRecordFresh(
    readinessSnapshot.ai_analysis,
    aiAnalysisFingerprint,
  ) ? readinessSnapshot.ai_analysis : undefined;
  const hasDeepEndpoint = settings.tierBProvider === "tier-a" || settings.tierBUseTierAEndpoint
    ? inheritedTierAEndpoint.length > 0
    : !providerNeedsEndpoint(settings.tierBProvider)
    ? settings.tierBProvider !== "none"
    : settings.tierBEndpoint.trim().length > 0;
  const hasDeepAnalysis = hasDeepEndpoint && settings.deepClassifyEnabled === true;

  function setDashboardActionLabel(label: string): void {
    dashboardLabel.textContent = label;
    dashboardLink.setAttribute("aria-label", label);
    dashboardLink.setAttribute("title", label);
  }

  function escapeHtml(input: string): string {
    return input
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  type FeatureMark = "ok" | "slow" | "off" | "failed";

  function featureItem(labelKey: "popup.feature.preReading" | "popup.feature.summary" | "popup.feature.deepReading", mark: FeatureMark): string {
    const markKey = mark === "ok"
      ? "popup.feature.checkOk"
      : mark === "slow"
      ? "popup.feature.checkSlow"
      : mark === "failed"
      ? "popup.feature.checkFailed"
      : "popup.feature.checkOff";
    const pillClass = `feature-pill feature-pill-${mark}`;
    return `<span class="${pillClass}"><span class="feature-mark" aria-label="${escapeHtml(t(markKey, lang))}">${escapeHtml(t(markKey, lang))}</span><span class="feature-name">${escapeHtml(t(labelKey, lang))}</span></span>`;
  }

  function featureList(summaryMark: FeatureMark, deepMark: FeatureMark): string {
    return `<div class="feature-pills">${[
      featureItem("popup.feature.preReading", "ok"),
      featureItem("popup.feature.summary", summaryMark),
      featureItem("popup.feature.deepReading", deepMark),
    ].join("")}</div>`;
  }

  function hideExpandable(): void {
    infoToggle.hidden = true;
    infoToggle.setAttribute("aria-expanded", "false");
    infoToggle.setAttribute("aria-label", t("popup.unsupported.expandLabel", lang));
    unsupportedDetail.hidden = true;
  }

  function showExpandable(): void {
    infoToggle.hidden = false;
    infoToggle.setAttribute("aria-expanded", "false");
    infoToggle.setAttribute("aria-label", t("popup.unsupported.expandLabel", lang));
    unsupportedDetail.hidden = true;
  }

  function renderReadiness(): void {
    const canUseSidePanelAction = settings.enabled && pageSupport.supported;
    const showCloseAction = canUseSidePanelAction && sidePanelOpen;
    dashboardLink.disabled = !canUseSidePanelAction;
    dashboardLink.setAttribute("aria-disabled", dashboardLink.disabled ? "true" : "false");
    dashboardLink.dataset.sidepanelOpen = showCloseAction ? "true" : "false";
    setDashboardActionLabel(
      pageSupport.supported
        ? showCloseAction
          ? t("popup.closeSidebar", lang)
          : t("popup.openSidebar", lang)
        : t("popup.unavailable", lang)
    );

    // The status dot is the verdict carrier for text-title states. The ready
    // state hides it: per-feature pills already convey status, and a single
    // green dot would even contradict an amber "slow" pill.
    pageDot.hidden = false;

    if (isCheckingSidePanelState) {
      readinessTitle.textContent = t("popup.ready.title", lang);
      readinessDetail.textContent = t("popup.checkingSidePanel", lang);
      pageDot.className = "status-dot checking";
      dashboardLink.dataset.sidepanelOpen = "false";
      setDashboardActionLabel(t("popup.openSidebar", lang));
      hideExpandable();
      return;
    }

    if (!settings.enabled) {
      readinessTitle.textContent = t("popup.paused.title", lang);
      readinessDetail.textContent = t("popup.paused.detail", lang);
      pageDot.className = "status-dot off";
      dashboardLink.dataset.sidepanelOpen = "false";
      setDashboardActionLabel(t("popup.enableToUse", lang));
      hideExpandable();
      return;
    }

    if (!pageSupport.supported) {
      readinessTitle.textContent = t("popup.unsupported.title", lang);
      readinessDetail.textContent = pageSupport.isFacebook
        ? t("popup.unsupported.detailFb", lang)
        : t("popup.unsupported.detailNonFb", lang);
      pageDot.className = "status-dot warn";
      showExpandable();
      return;
    }

    if (!isReady(realtimeReadiness)) {
      readinessTitle.textContent = realtimeReadiness
        ? t("popup.tierANeedsWork", lang)
        : t("popup.oneStep", lang);
      readinessDetail.textContent = realtimeReadiness
        ? readinessSummary(realtimeReadiness, t("popup.retestTierA", lang), lang)
        : t("popup.testTierA", lang);
      pageDot.className = "status-dot warn";
      hideExpandable();
      return;
    }

    // Tier A passed — pre-reading prompt is always available here. Show the
    // unified feature-status panel; summary / deep reading carry their own
    // per-feature mark so the panel keeps one visual language across states.
    let tierBMark: FeatureMark;
    if (!hasDeepAnalysis) {
      tierBMark = "off"; // intentionally not enabled — calm, not an error
    } else if (isReady(aiAnalysisReadiness)) {
      tierBMark = aiAnalysisReadiness?.status === "slow_but_usable" ? "slow" : "ok";
    } else if (aiAnalysisReadiness) {
      tierBMark = "failed"; // a fresh check ran and did not pass (e.g. connection_failed)
    } else {
      tierBMark = "slow"; // configured but never verified — pending, needs a check
    }
    readinessTitle.textContent = t("popup.ready.title", lang);
    readinessDetail.innerHTML = featureList(tierBMark, tierBMark);
    pageDot.hidden = true;
    hideExpandable();
  }

  async function refreshSidePanelState(): Promise<void> {
    if (!pageSupport.supported || !sidePanelCanClose) {
      sidePanelOpen = false;
      isCheckingSidePanelState = false;
      renderReadiness();
      return;
    }
    try {
      const win = await chrome.windows.getCurrent();
      if (typeof win.id !== "number") {
        sidePanelOpen = false;
        return;
      }
      const response = await browser.runtime.sendMessage({
        type: "GET_SIDE_PANEL_STATE",
        windowId: win.id,
      }) as GetSidePanelStateResultMsg | undefined;
      sidePanelOpen = response?.type === "GET_SIDE_PANEL_STATE_RESULT" && response.isOpen === true;
    } catch {
      sidePanelOpen = false;
    } finally {
      isCheckingSidePanelState = false;
      renderReadiness();
    }
  }

  renderReadiness();
  await refreshSidePanelState();

  const masterToggle = document.getElementById(
    "masterToggle"
  ) as HTMLInputElement;
  masterToggle.checked = settings.enabled;
  masterToggle.addEventListener("change", async () => {
    settings.enabled = masterToggle.checked;
    renderReadiness();
    await saveSettings(settings); // broadcasts to every open FB tab
  });

  dashboardLink.addEventListener("click", async (e) => {
    e.preventDefault();
    if (dashboardLink.disabled) return;
    const win = await chrome.windows.getCurrent();
    if (win.id != null) {
      if (sidePanelOpen && sidePanelCanClose) {
        await chrome.sidePanel.close({ windowId: win.id }).catch(() => {});
        sidePanelOpen = false;
      } else {
        await chrome.sidePanel.open({ windowId: win.id }).catch(() => {});
        sidePanelOpen = true;
      }
    }
    window.close();
  });

  document.getElementById("advancedLink")!.addEventListener("click", (e) => {
    e.preventDefault();
    browser.runtime.openOptionsPage();
  });

  infoToggle.addEventListener("click", () => {
    const expanded = infoToggle.getAttribute("aria-expanded") === "true";
    const next = !expanded;
    infoToggle.setAttribute("aria-expanded", next ? "true" : "false");
    infoToggle.setAttribute(
      "aria-label",
      t(next ? "popup.unsupported.collapseLabel" : "popup.unsupported.expandLabel", lang),
    );
    unsupportedDetail.hidden = !next;
  });
}

init();
