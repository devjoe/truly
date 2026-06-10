import type { DashboardPostEvent } from "../lib/types";
import { appendHistoryEvent, latestEventFor } from "./dashboard-history";
import {
  mergeProgressivePostContext,
  mergeReadingBriefState,
} from "./event-merge-state";

export interface DashboardPostIngestionInput {
  incomingEvent: DashboardPostEvent;
  historyMap: Map<string, DashboardPostEvent[]>;
  seenIds: Set<string>;
}

export interface DashboardPostIngestionResult {
  event: DashboardPostEvent;
  history: DashboardPostEvent[];
  previous?: DashboardPostEvent;
  isNew: boolean;
}

export function ingestDashboardPostEvent({
  incomingEvent,
  historyMap,
  seenIds,
}: DashboardPostIngestionInput): DashboardPostIngestionResult {
  const previous = latestEventFor(historyMap, incomingEvent.id);
  const event = mergeReadingBriefState(
    mergeProgressivePostContext(incomingEvent, previous),
    previous,
  );
  const isNew = !seenIds.has(event.id);
  if (isNew) seenIds.add(event.id);
  const history = appendHistoryEvent(historyMap, event);
  return { event, history, previous, isNew };
}
