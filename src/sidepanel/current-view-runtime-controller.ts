import type { TrulyMessage } from "../lib/messages";
import {
  installCurrentViewRefreshListeners,
  requestCurrentViewPost as requestCurrentViewPostFromController,
} from "./current-view-request-controller";
import {
  openSidepanelDashboardForPost,
} from "./runtime-message-listener";
import type { SidepanelViewPostState } from "./view-post-focus";

export interface CurrentViewRuntime {
  sendMessage(message: TrulyMessage): Promise<unknown> | void;
}

export interface CreateSidepanelCurrentViewRuntimeOptions {
  state: SidepanelViewPostState;
  holdMs: number;
  runtime: CurrentViewRuntime;
  documentRef: Document;
  windowRef: Window;
  now(): number;
  renderAnalysisPane(): void;
  activateAnalysisTab?(): void;
}

export interface SidepanelCurrentViewRuntime {
  openDashboardForPost(id: string): void;
  requestCurrentViewPost(): void;
  installRefreshListeners(): void;
}

export function createSidepanelCurrentViewRuntime({
  state,
  holdMs,
  runtime,
  documentRef,
  windowRef,
  now,
  renderAnalysisPane,
  activateAnalysisTab,
}: CreateSidepanelCurrentViewRuntimeOptions): SidepanelCurrentViewRuntime {
  function openDashboardForPost(id: string): void {
    openSidepanelDashboardForPost({
      postId: id,
      state,
      holdMs,
      now: now(),
      renderAnalysisPane,
      activateAnalysisTab,
    });
  }

  function requestCurrentViewPost(): void {
    requestCurrentViewPostFromController({
      state,
      sendMessage: (msg) => runtime.sendMessage(msg),
    });
  }

  function installRefreshListeners(): void {
    installCurrentViewRefreshListeners({
      documentRef,
      windowRef,
      requestCurrentViewPost,
    });
  }

  return {
    openDashboardForPost,
    requestCurrentViewPost,
    installRefreshListeners,
  };
}
