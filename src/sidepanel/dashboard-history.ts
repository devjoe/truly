import type { DashboardPostEvent } from "../lib/types";

export function latestDashboardEvents(
  historyMap: Map<string, DashboardPostEvent[]>,
): DashboardPostEvent[] {
  const events: DashboardPostEvent[] = [];
  for (const history of historyMap.values()) {
    const latest = history[history.length - 1];
    if (latest) events.push(latest);
  }
  return events;
}

export function latestEventFor(
  historyMap: Map<string, DashboardPostEvent[]>,
  postId: string,
): DashboardPostEvent | undefined {
  const history = historyMap.get(postId);
  return history && history.length > 0 ? history[history.length - 1] : undefined;
}

export function patchLatestEvent(
  historyMap: Map<string, DashboardPostEvent[]>,
  postId: string,
  patch: Partial<DashboardPostEvent>,
): void {
  const history = historyMap.get(postId);
  if (!history || history.length === 0) return;
  const latest = history[history.length - 1];
  const next = { ...latest, ...patch };
  const hasFreshSourceContext = Object.prototype.hasOwnProperty.call(patch, "sourceContext");
  const patchedText = patch.fullText ?? patch.text;
  const latestText = latest.fullText ?? latest.text;
  if (!hasFreshSourceContext && typeof patchedText === "string" && patchedText !== latestText) {
    delete next.sourceContext;
  }
  history[history.length - 1] = next;
}

export function appendHistoryEvent(
  historyMap: Map<string, DashboardPostEvent[]>,
  event: DashboardPostEvent,
  cap = 10,
): DashboardPostEvent[] {
  const history = historyMap.get(event.id) ?? [];
  history.push(event);
  while (history.length > cap) history.shift();
  historyMap.set(event.id, history);
  return history;
}

export function findDuplicateAuthor(
  historyMap: Map<string, DashboardPostEvent[]>,
  event: DashboardPostEvent,
  prefixLength = 60,
): string | undefined {
  const prefix = (event.text || "").slice(0, prefixLength);
  if (prefix.length === 0) return undefined;
  for (const [existingId, existingHistory] of historyMap) {
    if (existingId === event.id) continue;
    const existingEvent = existingHistory[existingHistory.length - 1];
    const existingPrefix = (existingEvent?.text || "").slice(0, prefixLength);
    if (existingPrefix.length > 0 && existingPrefix === prefix) {
      return existingEvent.authorName || "(unknown)";
    }
  }
  return undefined;
}
