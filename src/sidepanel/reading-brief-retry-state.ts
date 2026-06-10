import type { DashboardPostEvent } from "../lib/types";

export interface PrepareReadingBriefRetryInput {
  event: DashboardPostEvent;
  history?: DashboardPostEvent[];
}

export interface PrepareReadingBriefRetryResult {
  cleaned: DashboardPostEvent;
  replacedHistoryLatest: boolean;
}

export function prepareReadingBriefRetry({
  event,
  history,
}: PrepareReadingBriefRetryInput): PrepareReadingBriefRetryResult {
  const latest = history && history.length > 0 ? history[history.length - 1] : event;
  const cleaned: DashboardPostEvent = {
    ...latest,
    readingBrief: undefined,
    readingBriefPending: undefined,
    readingBriefError: undefined,
  };
  if (history && history.length > 0) {
    history[history.length - 1] = cleaned;
    return { cleaned, replacedHistoryLatest: true };
  }
  return { cleaned, replacedHistoryLatest: false };
}
