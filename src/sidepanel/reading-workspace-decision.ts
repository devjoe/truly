import type { DashboardPostEvent } from "../lib/types";

export interface ReadingWorkspaceRuntimeState {
  readingBriefInflight?: boolean;
  canRequestReadingBrief?: boolean;
}

export interface InvestigationActionDecision {
  showSection: boolean;
}

export function sidepanelCommercialScore(event: DashboardPostEvent): number {
  const deep = event.decision.deepClassification;
  if (typeof deep?.commercialIntent === "number") return deep.commercialIntent;
  return event.decision.scores?.commercial ?? 0;
}

export function isFirstReadingBriefBlocking(
  event: DashboardPostEvent,
  state: ReadingWorkspaceRuntimeState,
): boolean {
  if (event.readingBrief) return false;
  return Boolean(
    event.readingBriefPending ||
    state.readingBriefInflight ||
    event.readingBriefError ||
    state.canRequestReadingBrief,
  );
}

export function shouldShowPostReadingSections(
  event: DashboardPostEvent,
  state: ReadingWorkspaceRuntimeState,
): boolean {
  return !isFirstReadingBriefBlocking(event, state);
}

export function resolveInvestigationActionDecision(
  event: DashboardPostEvent,
  state: ReadingWorkspaceRuntimeState,
): InvestigationActionDecision {
  const showSection = shouldShowPostReadingSections(event, state);
  return {
    showSection,
  };
}
