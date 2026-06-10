import type { DashboardPostEvent } from "../lib/types";
import { renderAnalysisPaneContent } from "./analysis-pane-content";

export interface AnalysisPaneControllerState {
  currentViewPostId: string | null;
}

export interface AnalysisPaneReadingBriefScheduler {
  scheduleCurrent(): void;
}

export interface RenderSidepanelAnalysisPaneOptions {
  analysisPaneEl: HTMLElement;
  state: AnalysisPaneControllerState;
  historyMap: Map<string, DashboardPostEvent[]>;
  referenceSectionOpenIds: Set<string>;
  readingBriefController: AnalysisPaneReadingBriefScheduler;
  renderPlaceholder(hasRequestedPost: boolean): HTMLElement;
  renderCard(event: DashboardPostEvent, history: DashboardPostEvent[]): HTMLElement;
}

export function renderSidepanelAnalysisPane({
  analysisPaneEl,
  state,
  historyMap,
  referenceSectionOpenIds,
  readingBriefController,
  renderPlaceholder,
  renderCard,
}: RenderSidepanelAnalysisPaneOptions): void {
  const id = state.currentViewPostId;
  const history = id ? historyMap.get(id) : undefined;
  const result = renderAnalysisPaneContent({
    analysisPaneEl,
    postId: id,
    referenceSectionOpenIds,
    history,
    renderPlaceholder,
    renderCard,
  });
  if (result.renderedPost) readingBriefController.scheduleCurrent();
}
