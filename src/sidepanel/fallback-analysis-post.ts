import type { DashboardPostEvent, UserSettings } from "../lib/types";
import { selectDefaultAnalysisPostId } from "./analysis-selection";
import { latestDashboardEvents } from "./dashboard-history";

export interface FallbackAnalysisPostState {
  cachedSettings: UserSettings;
  currentViewPostId: string | null;
}

export interface SelectFallbackAnalysisPostOptions {
  state: FallbackAnalysisPostState;
  historyMap: Map<string, DashboardPostEvent[]>;
}

export function selectFallbackAnalysisPost({
  state,
  historyMap,
}: SelectFallbackAnalysisPostOptions): boolean {
  if (!state.cachedSettings.analysisAutoFollow) return false;
  if (state.currentViewPostId !== null) return false;
  const nextId = selectDefaultAnalysisPostId(latestDashboardEvents(historyMap));
  if (!nextId || nextId === state.currentViewPostId) return false;
  state.currentViewPostId = nextId;
  return true;
}
