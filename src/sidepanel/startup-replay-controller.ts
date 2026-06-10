import type { TrulyMessage } from "../lib/messages";
import type { DashboardPostEvent } from "../lib/types";

export interface StartupReplayControllerOptions {
  sendMessage(
    message: TrulyMessage,
    callback: (response: TrulyMessage | undefined) => void,
  ): void;
  hasRuntimeError(): boolean;
  handleReplay(events: DashboardPostEvent[]): void;
  requestCurrentViewPost(): void;
  readPendingOpenPost(): Promise<unknown>;
  clearPendingOpenPost(): Promise<unknown>;
  openDashboardForPost(id: string): void;
}

export function requestStartupReplay({
  sendMessage,
  hasRuntimeError,
  handleReplay,
  requestCurrentViewPost,
  readPendingOpenPost,
  clearPendingOpenPost,
  openDashboardForPost,
}: StartupReplayControllerOptions): void {
  sendMessage({ type: "DASHBOARD_REPLAY_REQUEST" }, (response) => {
    if (hasRuntimeError()) return;
    if (response && response.type === "DASHBOARD_REPLAY") {
      handleReplay(response.events);
      requestCurrentViewPost();
    }
    // Now that all replayed cards are in the DOM, process any queued
    // navigation command.
    readPendingOpenPost()
      .then((result) => {
        const id = (result as { pendingOpenPost?: unknown } | undefined)?.pendingOpenPost;
        if (typeof id !== "string" || !id) return;
        clearPendingOpenPost().catch(() => {});
        openDashboardForPost(id);
      })
      .catch(() => {});
  });
}
