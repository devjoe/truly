import type { DashboardPostEvent } from "../lib/types";

export interface SidepanelRuntimeState {
  seenIds: Set<string>;
  historyMap: Map<string, DashboardPostEvent[]>;
  expandedIds: Set<string>;
  referenceSectionOpenIds: Set<string>;
  readingBriefRevealedIds: Set<string>;
  postReadingFollowupRevealedIds: Set<string>;
}

export function createSidepanelRuntimeState(): SidepanelRuntimeState {
  return {
    seenIds: new Set<string>(),
    historyMap: new Map<string, DashboardPostEvent[]>(),
    expandedIds: new Set<string>(),
    referenceSectionOpenIds: new Set<string>(),
    readingBriefRevealedIds: new Set<string>(),
    postReadingFollowupRevealedIds: new Set<string>(),
  };
}
