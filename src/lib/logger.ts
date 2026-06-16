export function isDebugLoggingEnabled(): boolean {
  const maybeGlobal = globalThis as typeof globalThis & {
    __TRULY_DEBUG_LOGS?: boolean;
  };
  if (maybeGlobal.__TRULY_DEBUG_LOGS === true) return true;
  if (__TRULY_DEV_BUILD__) return true;

  try {
    if (typeof window !== "undefined" && "localStorage" in window) {
      return window.localStorage.getItem("trulyDebugLogs") === "1";
    }
  } catch {
    /* localStorage can be unavailable in extension service workers. */
  }

  return false;
}

export function debugLog(...args: unknown[]): void {
  if (isDebugLoggingEnabled()) {
    console.log(...args);
  }
}
