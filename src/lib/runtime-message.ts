export type RuntimeMessageSender = (message: unknown) => unknown;

function isCatchable(value: unknown): value is { catch: (handler: () => void) => unknown } {
  return !!value && typeof (value as { catch?: unknown }).catch === "function";
}

export function sendRuntimeMessageSafely(sender: RuntimeMessageSender, message: unknown): void {
  try {
    const maybePromise = sender(message);
    if (isCatchable(maybePromise)) {
      maybePromise.catch(() => {});
    }
  } catch {
    // Ignore unavailable runtime APIs in tests/non-extension contexts.
  }
}
