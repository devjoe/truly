import type { DashboardPostEvent } from "../lib/types";

export interface DashboardReplayHandlerDeps {
  setReplayInProgress(inProgress: boolean): void;
  addPost(event: DashboardPostEvent): void;
  selectFallbackAnalysisPost(): boolean;
  renderAnalysisPane(): void;
}

export function handleDashboardReplayEvents(
  events: DashboardPostEvent[],
  deps: DashboardReplayHandlerDeps,
): void {
  deps.setReplayInProgress(true);
  try {
    for (const event of events) deps.addPost(event);
  } finally {
    deps.setReplayInProgress(false);
  }
  if (deps.selectFallbackAnalysisPost()) deps.renderAnalysisPane();
}
