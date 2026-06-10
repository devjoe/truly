import type { DashboardPostEvent } from "../lib/types";
import type { ReadingBriefController } from "./reading-brief-controller";
import type { ReadingWorkspaceRuntimeState } from "./reading-workspace-decision";

export interface BuildReadingWorkspaceStateOptions {
  event: DashboardPostEvent;
  readingBriefController: Pick<ReadingBriefController, "isInflight" | "canRequest">;
}

export function buildReadingWorkspaceState({
  event,
  readingBriefController,
}: BuildReadingWorkspaceStateOptions): ReadingWorkspaceRuntimeState {
  return {
    readingBriefInflight: readingBriefController.isInflight(event.id),
    canRequestReadingBrief: readingBriefController.canRequest(event),
  };
}
