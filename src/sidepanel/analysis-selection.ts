import type { DashboardPostEvent } from "../lib/types";

function eventTime(event: DashboardPostEvent): number {
  const t = Date.parse(event.timestamp);
  return Number.isFinite(t) ? t : 0;
}

function newest(events: DashboardPostEvent[]): DashboardPostEvent | null {
  let picked: DashboardPostEvent | null = null;
  let pickedTime = -Infinity;
  for (const event of events) {
    const t = eventTime(event);
    if (!picked || t >= pickedTime) {
      picked = event;
      pickedTime = t;
    }
  }
  return picked;
}

/**
 * Pick a user-facing fallback for the Analysis tab when the sidepanel opens
 * from replay before the content script has broadcast CURRENT_VIEW_POST.
 */
export function selectDefaultAnalysisPostId(
  events: DashboardPostEvent[],
): string | null {
  if (events.length === 0) return null;

  const visible = events.filter(
    (event) => !event.isSponsored && !event.decision.filtered,
  );
  const notFiltered = events.filter((event) => !event.decision.filtered);

  return (
    newest(visible) ??
    newest(notFiltered) ??
    newest(events)
  )?.id ?? null;
}
