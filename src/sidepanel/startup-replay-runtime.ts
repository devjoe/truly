import type { TrulyMessage } from "../lib/messages";
import type { DashboardPostEvent } from "../lib/types";
import { requestStartupReplay } from "./startup-replay-controller";

export interface StartupReplayRuntime {
  readonly lastError?: unknown;
  sendMessage(
    message: TrulyMessage,
    callback: (response: TrulyMessage | undefined) => void,
  ): void;
}

export interface StartupReplaySessionStorage {
  get(key: "pendingOpenPost"): Promise<unknown>;
  remove(key: "pendingOpenPost"): Promise<unknown>;
}

export interface InstallStartupReplayRuntimeOptions {
  runtime: StartupReplayRuntime;
  sessionStorage: StartupReplaySessionStorage;
  handleReplay(events: DashboardPostEvent[]): void;
  requestCurrentViewPost(): void;
  openDashboardForPost(id: string): void;
}

export function installStartupReplayRuntime({
  runtime,
  sessionStorage,
  handleReplay,
  requestCurrentViewPost,
  openDashboardForPost,
}: InstallStartupReplayRuntimeOptions): void {
  requestStartupReplay({
    sendMessage: (message, callback) => {
      runtime.sendMessage(message, callback);
    },
    hasRuntimeError: () => Boolean(runtime.lastError),
    handleReplay,
    requestCurrentViewPost,
    readPendingOpenPost: () => sessionStorage.get("pendingOpenPost"),
    clearPendingOpenPost: () => sessionStorage.remove("pendingOpenPost"),
    openDashboardForPost,
  });
}
