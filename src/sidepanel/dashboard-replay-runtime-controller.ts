import type { DashboardPostEvent, UserSettings } from "../lib/types";
import { handleDashboardReplayEvents } from "./dashboard-replay-handler";
import { selectFallbackAnalysisPost } from "./fallback-analysis-post";
import type { SidepanelPostRuntimeController } from "./post-runtime-controller";
import type { SidepanelRuntimeState } from "./runtime-state";

export interface SidepanelDashboardReplayRuntimeState {
  replayInProgress: boolean;
  currentViewPostId: string | null;
  cachedSettings: UserSettings;
}

export interface CreateSidepanelDashboardReplayRuntimeOptions {
  state: SidepanelDashboardReplayRuntimeState;
  runtimeState: Pick<SidepanelRuntimeState, "historyMap">;
  postRuntimeController: Pick<SidepanelPostRuntimeController, "addPost">;
  renderAnalysisPane(): void;
}

export interface SidepanelDashboardReplayRuntimeController {
  replayDashboardEvents(events: DashboardPostEvent[]): void;
}

export function createSidepanelDashboardReplayRuntime({
  state,
  runtimeState,
  postRuntimeController,
  renderAnalysisPane,
}: CreateSidepanelDashboardReplayRuntimeOptions): SidepanelDashboardReplayRuntimeController {
  return {
    replayDashboardEvents(events) {
      handleDashboardReplayEvents(events, {
        setReplayInProgress: (inProgress) => {
          state.replayInProgress = inProgress;
        },
        addPost: postRuntimeController.addPost,
        selectFallbackAnalysisPost: () => selectFallbackAnalysisPost({
          state,
          historyMap: runtimeState.historyMap,
        }),
        renderAnalysisPane,
      });
    },
  };
}
