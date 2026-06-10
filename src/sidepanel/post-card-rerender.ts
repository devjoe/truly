import type { DashboardPostEvent } from "../lib/types";

export interface RerenderSidepanelPostCardOptions {
  postId: string;
  currentViewPostId: string | null;
  historyMap: Map<string, DashboardPostEvent[]>;
  suppressTooltip(): void;
  renderAnalysisPane(): void;
}

export interface RerenderSidepanelPostCardResult {
  renderedDebugCard: boolean;
  renderedAnalysisPane: boolean;
}

export function rerenderSidepanelPostCard({
  postId,
  currentViewPostId,
  historyMap,
  suppressTooltip,
  renderAnalysisPane,
}: RerenderSidepanelPostCardOptions): RerenderSidepanelPostCardResult {
  suppressTooltip();
  const history = historyMap.get(postId);
  if (!history || history.length === 0) {
    return { renderedDebugCard: false, renderedAnalysisPane: false };
  }

  if (currentViewPostId === postId) {
    renderAnalysisPane();
    return { renderedDebugCard: false, renderedAnalysisPane: true };
  }

  return { renderedDebugCard: false, renderedAnalysisPane: false };
}
