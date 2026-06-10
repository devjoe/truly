import type { DashboardPostEvent } from "../lib/types";
import {
  latestEventFor as latestEventForHistory,
  patchLatestEvent as patchLatestHistoryEvent,
} from "./dashboard-history";
import type { SidepanelRuntimeState } from "./runtime-state";

export interface SidepanelDashboardHistoryRuntime {
  latestEventFor(postId: string): DashboardPostEvent | undefined;
  patchLatestEvent(postId: string, patch: Partial<DashboardPostEvent>): void;
  getDashboardEvents(): DashboardPostEvent[];
}

export function createSidepanelDashboardHistoryRuntime(
  runtimeState: Pick<SidepanelRuntimeState, "historyMap">,
): SidepanelDashboardHistoryRuntime {
  return {
    latestEventFor(postId) {
      return latestEventForHistory(runtimeState.historyMap, postId);
    },
    patchLatestEvent(postId, patch) {
      patchLatestHistoryEvent(runtimeState.historyMap, postId, patch);
    },
    getDashboardEvents() {
      return Array.from(runtimeState.historyMap.values()).flat();
    },
  };
}
