import type { TrulyMessage } from "../lib/messages";
import type { UserSettings } from "../lib/types";

export interface CurrentViewRequestState {
  cachedSettings: UserSettings;
}

export interface CurrentViewRequestControllerOptions {
  state: CurrentViewRequestState;
  sendMessage(message: TrulyMessage): Promise<unknown> | void;
}

export interface InstallCurrentViewRefreshListenersOptions {
  documentRef: Document;
  windowRef: Window;
  requestCurrentViewPost(): void;
}

export function requestCurrentViewPost({
  state,
  sendMessage,
}: CurrentViewRequestControllerOptions): boolean {
  if (!state.cachedSettings.analysisAutoFollow) return false;
  const msg: TrulyMessage = { type: "REQUEST_CURRENT_VIEW_POST" };
  void Promise.resolve(sendMessage(msg)).catch(() => {});
  return true;
}

export function installCurrentViewRefreshListeners({
  documentRef,
  windowRef,
  requestCurrentViewPost,
}: InstallCurrentViewRefreshListenersOptions): void {
  documentRef.addEventListener("visibilitychange", () => {
    if (documentRef.visibilityState === "visible") requestCurrentViewPost();
  });

  windowRef.addEventListener("focus", requestCurrentViewPost);
}
