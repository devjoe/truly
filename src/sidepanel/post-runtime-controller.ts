import type { DashboardPostEvent } from "../lib/types";
import { addSidepanelPost, type SidepanelPostAdditionState } from "./post-addition";
import type { SidepanelRuntimeState } from "./runtime-state";

export interface CreateSidepanelPostRuntimeControllerOptions {
  runtimeState: SidepanelRuntimeState;
  panelState: SidepanelPostAdditionState;
  selectFallbackAnalysisPost(): boolean;
  renderAnalysisPane(): void;
}

export interface SidepanelPostRuntimeController {
  addPost(event: DashboardPostEvent): void;
}

export function createSidepanelPostRuntimeController({
  runtimeState,
  panelState,
  selectFallbackAnalysisPost,
  renderAnalysisPane,
}: CreateSidepanelPostRuntimeControllerOptions): SidepanelPostRuntimeController {
  function addPost(incomingEvent: DashboardPostEvent): void {
    addSidepanelPost({
      incomingEvent,
      historyMap: runtimeState.historyMap,
      seenIds: runtimeState.seenIds,
      state: panelState,
      selectFallbackAnalysisPost,
      renderAnalysisPane,
    });
  }

  return { addPost };
}
