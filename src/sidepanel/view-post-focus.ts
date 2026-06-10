import type { UserSettings } from "../lib/types";
import {
  nextManualFocusHoldUntil,
  shouldAcceptCurrentViewPost,
} from "./current-view-state";

export interface SidepanelViewPostState {
  cachedSettings: UserSettings;
  currentViewPostId: string | null;
  manualFocusHoldUntil: number;
}

export interface FocusSidepanelPostOptions {
  postId: string;
  state: SidepanelViewPostState;
  holdMs: number;
  now: number;
  renderAnalysisPane(): void;
  activateAnalysisTab?(): void;
}

export interface AcceptCurrentViewPostOptions {
  postId: string | null;
  state: SidepanelViewPostState;
  now: number;
  renderAnalysisPane(): void;
}

export function focusSidepanelPost({
  postId,
  state,
  holdMs,
  now,
  renderAnalysisPane,
  activateAnalysisTab,
}: FocusSidepanelPostOptions): void {
  state.manualFocusHoldUntil = nextManualFocusHoldUntil(now, holdMs);
  state.currentViewPostId = postId;
  renderAnalysisPane();
  activateAnalysisTab?.();
}

export function acceptCurrentViewPost({
  postId,
  state,
  now,
  renderAnalysisPane,
}: AcceptCurrentViewPostOptions): boolean {
  if (!shouldAcceptCurrentViewPost({
    analysisAutoFollow: state.cachedSettings.analysisAutoFollow,
    currentViewPostId: state.currentViewPostId,
    incomingPostId: postId,
    manualFocusHoldUntil: state.manualFocusHoldUntil,
    now,
  })) {
    return false;
  }

  state.currentViewPostId = postId;
  renderAnalysisPane();
  return true;
}
