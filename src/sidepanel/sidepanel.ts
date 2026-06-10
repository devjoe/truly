import type {
  DashboardPostEvent,
} from "../lib/types";
import { initTabs } from "./tabs";
import { installTooltips, suppressTooltip } from "./tooltip";
import { panelState } from "./state";
// Re-exported so existing importers (e.g. sidepanel-render.test.ts) keep a
// stable entrypoint after the formatters moved to ./format.
export { analysisPreviewText } from "./format";
import {
  installSidepanelRuntimeMessageListener,
} from "./runtime-message-listener";
import { rerenderSidepanelPostCard } from "./post-card-rerender";
import { selectFallbackAnalysisPost } from "./fallback-analysis-post";
import { installStartupReplayRuntime } from "./startup-replay-runtime";
import { createSidepanelReadingBriefController } from "./reading-brief-runtime-controller";
import { createSidepanelRuntimeState } from "./runtime-state";
import { createSidepanelPostRuntimeController } from "./post-runtime-controller";
import { createSidepanelCurrentViewRuntime } from "./current-view-runtime-controller";
import { createSidepanelReadingSurface } from "./reading-surface-runtime";
import { createSidepanelDashboardReplayRuntime } from "./dashboard-replay-runtime-controller";
import { createSidepanelStorageRuntimeController } from "./storage-runtime-controller";
import { createSidepanelDashboardHistoryRuntime } from "./dashboard-history-runtime";
import { createSidepanelTabActivationRuntime } from "./tab-activation-runtime-controller";
import { initializeSidepanelBootstrap } from "./bootstrap-lifecycle";
import type { FeedExpandedRenderOptions } from "./feed-expanded-renderer";
import { createExtensionThemeController } from "../lib/theme-mode";
import { createExtensionLanguageController } from "../lib/i18n";
import type { UserSettings } from "../lib/types";

export { mergeProgressivePostContext } from "./event-merge-state";

console.log(`[Truly Sidepanel] Loaded buildId=${__TRULY_BUILD_ID__}`);

const runtimeState = createSidepanelRuntimeState();
const historyRuntime = createSidepanelDashboardHistoryRuntime(runtimeState);
const themeController = createExtensionThemeController();
const languageController = createExtensionLanguageController();

const analysisPaneEl = document.getElementById("analysis-pane")!;

// currentViewPostId / manualFocusHoldUntil / replayInProgress live in panelState
// (./state). MANUAL_FOCUS_HOLD_MS gates the manual-focus hold; see
// panelState.manualFocusHoldUntil.
const MANUAL_FOCUS_HOLD_MS = 2500;

const tabActivationRuntime = createSidepanelTabActivationRuntime();

/**
 * Analysis surface expanded view. Contains only classification-result
 * content: full text, info quality, reading context, and handoff actions.
 * Deliberately excludes raw JSON, decision trail, metadata.
 */
export function renderFeedExpanded(
  event: DashboardPostEvent,
  history: DashboardPostEvent[],
  options: FeedExpandedRenderOptions = {},
): HTMLElement {
  return readingSurface.renderFeedExpanded(event, history, options);
}

function rerenderCard(postId: string): void {
  rerenderSidepanelPostCard({
    postId,
    currentViewPostId: panelState.currentViewPostId,
    historyMap: runtimeState.historyMap,
    suppressTooltip,
    renderAnalysisPane,
  });
}

const readingBriefController = createSidepanelReadingBriefController({
  state: panelState,
  runtime: chrome.runtime,
  timerRuntime: window,
  latestEventFor: historyRuntime.latestEventFor,
  patchLatestEvent: historyRuntime.patchLatestEvent,
  rerender: rerenderCard,
  now: () => Date.now(),
});

const readingSurface = createSidepanelReadingSurface({
  analysisPaneEl,
  runtimeState,
  panelState,
  readingBriefController,
  rerenderCard,
  getLang: () => languageController.current(),
});

const postRuntimeController = createSidepanelPostRuntimeController({
  runtimeState,
  panelState,
  selectFallbackAnalysisPost: () => selectFallbackAnalysisPost({ state: panelState, historyMap: runtimeState.historyMap }),
  renderAnalysisPane,
});

const currentViewRuntime = createSidepanelCurrentViewRuntime({
  state: panelState,
  holdMs: MANUAL_FOCUS_HOLD_MS,
  runtime: chrome.runtime,
  documentRef: document,
  windowRef: window,
  now: Date.now,
  renderAnalysisPane,
  activateAnalysisTab: tabActivationRuntime.activateAnalysisTab,
});

const dashboardReplayRuntime = createSidepanelDashboardReplayRuntime({
  state: panelState,
  runtimeState,
  postRuntimeController,
  renderAnalysisPane,
});

const storageRuntime = createSidepanelStorageRuntimeController({
  storage: chrome.storage,
  state: panelState,
  applyDeveloperMode: () => {},
  applyTheme: (settings: UserSettings) => {
    themeController.setMode(settings.themeMode);
    languageController.setLanguage(settings.language);
  },
  renderAnalysisPane,
});

function renderAnalysisPane(): void {
  readingSurface.renderAnalysisPane();
}

function installOptionsPageShortcut(): void {
  document.getElementById("openOptionsPage")?.addEventListener("click", () => {
    chrome.tabs.create({ url: chrome.runtime.getURL("options/options.html") });
  });
}

// Listen for POST_CLASSIFIED + DASHBOARD_REPLAY messages from the SW.
installSidepanelRuntimeMessageListener({
  runtimeOnMessage: chrome.runtime.onMessage,
  state: panelState,
  holdMs: MANUAL_FOCUS_HOLD_MS,
  now: Date.now,
  applyDeveloperMode: () => {},
  applyTheme: (settings) => {
    themeController.setMode(settings.themeMode);
    languageController.setLanguage(settings.language);
  },
  addPost: postRuntimeController.addPost,
  replayDashboardEvents: dashboardReplayRuntime.replayDashboardEvents,
  renderAnalysisPane,
  activateAnalysisTab: tabActivationRuntime.activateAnalysisTab,
});

// Request replay on mount so the panel doesn't start empty after reopen.
// After replay, check if the service worker queued an
// OPEN_DASHBOARD_FOR_POST via session storage (cold-start case: the
// panel wasn't open when the overlay 🔍 was clicked, so the
// runtime.sendMessage was lost because this script hadn't loaded yet).
installStartupReplayRuntime({
  runtime: chrome.runtime,
  sessionStorage: chrome.storage.session,
  handleReplay: dashboardReplayRuntime.replayDashboardEvents,
  requestCurrentViewPost: currentViewRuntime.requestCurrentViewPost,
  openDashboardForPost: currentViewRuntime.openDashboardForPost,
});

currentViewRuntime.installRefreshListeners();

const activateTab = initializeSidepanelBootstrap({
  installTooltips,
  installOptionsPageShortcut,
  initTabs,
  initializeStorageState: storageRuntime.initializeStorageState,
});
tabActivationRuntime.setActivateTab(activateTab);
