import type { DashboardPostEvent } from "../lib/types";
import { syncAnalysisReferenceOpenState } from "./analysis-reference-state";

export interface RenderAnalysisPaneContentOptions {
  analysisPaneEl: HTMLElement;
  postId: string | null;
  history?: DashboardPostEvent[];
  referenceSectionOpenIds: Set<string>;
  renderPlaceholder(hasRequestedPost: boolean): HTMLElement;
  renderCard(event: DashboardPostEvent, history: DashboardPostEvent[]): HTMLElement;
}

export interface RenderAnalysisPaneContentResult {
  renderedPost: boolean;
  event?: DashboardPostEvent;
}

export function renderAnalysisPaneContent({
  analysisPaneEl,
  postId,
  history,
  referenceSectionOpenIds,
  renderPlaceholder,
  renderCard,
}: RenderAnalysisPaneContentOptions): RenderAnalysisPaneContentResult {
  const event = history && history.length > 0 ? history[history.length - 1] : undefined;

  syncAnalysisReferenceOpenState({
    analysisPaneEl,
    postId,
    referenceSectionOpenIds,
  });

  while (analysisPaneEl.firstChild) analysisPaneEl.removeChild(analysisPaneEl.firstChild);

  if (!event || !history) {
    analysisPaneEl.appendChild(renderPlaceholder(Boolean(postId)));
    return { renderedPost: false };
  }

  analysisPaneEl.appendChild(renderCard(event, history));
  return { renderedPost: true, event };
}
