import type { TrulyMessage } from "../lib/messages";
import type { DashboardPostEvent } from "../lib/types";
import { ReadingBriefController } from "./reading-brief-controller";
import type { SidepanelViewPostState } from "./view-post-focus";

export interface SidepanelReadingBriefRuntime {
  readonly lastError?: { message?: string };
  sendMessage(message: TrulyMessage, callback: (response: TrulyMessage | undefined) => void): void;
}

export interface SidepanelReadingBriefTimerRuntime {
  setTimeout(callback: () => void, delayMs: number): number;
  clearTimeout(timerId: number): void;
}

export interface CreateSidepanelReadingBriefControllerOptions {
  state: SidepanelViewPostState & {
    cachedTierAEndpoint?: string;
    cachedTierAModel?: string;
  };
  runtime: SidepanelReadingBriefRuntime;
  timerRuntime: SidepanelReadingBriefTimerRuntime;
  latestEventFor(postId: string): DashboardPostEvent | undefined;
  patchLatestEvent(postId: string, patch: Partial<DashboardPostEvent>): void;
  rerender(postId: string): void;
  now(): number;
}

export function createSidepanelReadingBriefController({
  state,
  runtime,
  timerRuntime,
  latestEventFor,
  patchLatestEvent,
  rerender,
  now,
}: CreateSidepanelReadingBriefControllerOptions): ReadingBriefController {
  return new ReadingBriefController({
    deps: {
      settings: () => state.cachedSettings,
      tierAEndpoint: () => state.cachedTierAEndpoint,
      tierAModel: () => state.cachedTierAModel,
      currentPostId: () => state.currentViewPostId,
      latestEventFor,
      patchLatestEvent,
      rerender,
      sendMessage: (message, callback) => runtime.sendMessage(message, callback),
      lastErrorMessage: () => runtime.lastError?.message,
      now,
      setTimer: (callback, delayMs) => timerRuntime.setTimeout(callback, delayMs),
      clearTimer: (timerId) => timerRuntime.clearTimeout(timerId),
    },
  });
}
