import type { DashboardPostEvent, UserSettings } from "../lib/types";
import { ingestDashboardPostEvent } from "./dashboard-post-ingestion";

export interface SidepanelPostAdditionState {
  cachedSettings: UserSettings;
  currentViewPostId: string | null;
  replayInProgress: boolean;
}

export interface AddSidepanelPostOptions {
  incomingEvent: DashboardPostEvent;
  historyMap: Map<string, DashboardPostEvent[]>;
  seenIds: Set<string>;
  state: SidepanelPostAdditionState;
  selectFallbackAnalysisPost(): boolean;
  renderAnalysisPane(): void;
}

export interface AddSidepanelPostResult {
  event: DashboardPostEvent;
  history: DashboardPostEvent[];
  isNew: boolean;
  attachedDebugCard: boolean;
  renderedAnalysisPane: boolean;
}

export function addSidepanelPost({
  incomingEvent,
  historyMap,
  seenIds,
  state,
  selectFallbackAnalysisPost,
  renderAnalysisPane,
}: AddSidepanelPostOptions): AddSidepanelPostResult {
  const { event, history, isNew } = ingestDashboardPostEvent({
    incomingEvent,
    historyMap,
    seenIds,
  });

  let renderedAnalysisPane = false;
  if (!state.replayInProgress && (state.currentViewPostId === event.id || selectFallbackAnalysisPost())) {
    renderAnalysisPane();
    renderedAnalysisPane = true;
  }

  return { event, history, isNew, attachedDebugCard: false, renderedAnalysisPane };
}
