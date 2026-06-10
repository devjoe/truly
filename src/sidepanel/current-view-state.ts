export interface CurrentViewGateInput {
  analysisAutoFollow: boolean;
  currentViewPostId: string | null;
  incomingPostId: string | null;
  manualFocusHoldUntil: number;
  now: number;
}

export function shouldAcceptCurrentViewPost(input: CurrentViewGateInput): boolean {
  if (!input.analysisAutoFollow) return false;
  if (
    input.now < input.manualFocusHoldUntil &&
    input.currentViewPostId !== null &&
    input.incomingPostId !== input.currentViewPostId
  ) {
    return false;
  }
  return input.currentViewPostId !== input.incomingPostId;
}

export function nextManualFocusHoldUntil(now: number, holdMs: number): number {
  return now + holdMs;
}
