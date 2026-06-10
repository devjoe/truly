import type { TrulyMessage } from "../lib/messages";
import type { DashboardPostEvent } from "../lib/types";
import { normalizeUserSettings } from "../lib/settings";
import {
  acceptCurrentViewPost,
  focusSidepanelPost,
  type SidepanelViewPostState,
} from "./view-post-focus";
import { handleSidepanelRuntimeMessage } from "./runtime-message-router";

export interface SidepanelRuntimeOnMessage {
  addListener(listener: (message: TrulyMessage) => false): void;
}

export interface OpenSidepanelDashboardForPostOptions {
  postId: string;
  state: SidepanelViewPostState;
  holdMs: number;
  now: number;
  renderAnalysisPane(): void;
  activateAnalysisTab?(): void;
}

export function openSidepanelDashboardForPost(options: OpenSidepanelDashboardForPostOptions): void {
  focusSidepanelPost(options);
}

export interface InstallSidepanelRuntimeMessageListenerOptions {
  runtimeOnMessage: SidepanelRuntimeOnMessage;
  state: SidepanelViewPostState;
  holdMs: number;
  now(): number;
  applyDeveloperMode(enabled: boolean): void;
  addPost(event: DashboardPostEvent): void;
  replayDashboardEvents(events: DashboardPostEvent[]): void;
  renderAnalysisPane(): void;
  activateAnalysisTab?(): void;
  applyTheme?(settings: SidepanelViewPostState["cachedSettings"]): void;
}

export function installSidepanelRuntimeMessageListener({
  runtimeOnMessage,
  state,
  holdMs,
  now,
  applyDeveloperMode,
  addPost,
  replayDashboardEvents,
  renderAnalysisPane,
  activateAnalysisTab,
  applyTheme,
}: InstallSidepanelRuntimeMessageListenerOptions): void {
  runtimeOnMessage.addListener((message) => {
    return handleSidepanelRuntimeMessage(message, {
      settingsUpdated: (settings) => {
        const previousLanguage = state.cachedSettings.language;
        state.cachedSettings = normalizeUserSettings(settings);
        applyDeveloperMode(state.cachedSettings.developerMode === true);
        applyTheme?.(state.cachedSettings);
        if (state.cachedSettings.language !== previousLanguage) renderAnalysisPane();
      },
      postClassified: addPost,
      dashboardReplay: replayDashboardEvents,
      openDashboardForPost: (id) => {
        openSidepanelDashboardForPost({
          postId: id,
          state,
          holdMs,
          now: now(),
          renderAnalysisPane,
          activateAnalysisTab,
        });
      },
      currentViewPost: (id) => {
        acceptCurrentViewPost({
          postId: id,
          state,
          now: now(),
          renderAnalysisPane,
        });
      },
      manualViewPost: (id) => {
        focusSidepanelPost({
          postId: id,
          state,
          holdMs,
          now: now(),
          renderAnalysisPane,
        });
      },
    });
  });
}
