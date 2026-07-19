import { writeFileSync } from "node:fs";

const DEFAULT_COMMAND_TIMEOUT_MS = 10_000;

export function connectCdp(webSocketDebuggerUrl, options = {}) {
  if (typeof WebSocket !== "function") {
    throw new Error("global WebSocket is unavailable in this Node runtime");
  }

  const commandTimeoutMs = options.commandTimeoutMs ?? DEFAULT_COMMAND_TIMEOUT_MS;
  const screenshotBeyondViewport = options.screenshotBeyondViewport ?? false;
  const ws = new WebSocket(webSocketDebuggerUrl);
  let nextId = 1;
  const pending = new Map();
  const opened = new Promise((resolveOpen, rejectOpen) => {
    ws.addEventListener("open", resolveOpen, { once: true });
    ws.addEventListener("error", () => rejectOpen(new Error("CDP websocket connection failed")), { once: true });
  });

  function rejectPending(error) {
    for (const { reject, timer } of pending.values()) {
      clearTimeout(timer);
      reject(error);
    }
    pending.clear();
  }

  ws.addEventListener("message", (event) => {
    let message;
    try {
      message = JSON.parse(event.data);
    } catch {
      return;
    }
    if (!message.id || !pending.has(message.id)) return;
    const entry = pending.get(message.id);
    pending.delete(message.id);
    clearTimeout(entry.timer);
    if (message.error) entry.reject(new Error(message.error.message ?? JSON.stringify(message.error)));
    else entry.resolve(message.result);
  });
  ws.addEventListener("close", () => rejectPending(new Error("CDP websocket closed")), { once: true });

  async function send(method, params = {}, timeoutMs = commandTimeoutMs) {
    await opened;
    const id = nextId++;
    const response = new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`CDP command timed out: ${method} after ${timeoutMs}ms`));
      }, timeoutMs);
      pending.set(id, { resolve, reject, timer });
    });
    ws.send(JSON.stringify({ id, method, params }));
    return response;
  }

  const client = {
    send,
    async evaluate(expression, timeoutMs = commandTimeoutMs) {
      const result = await send("Runtime.evaluate", {
        expression,
        awaitPromise: true,
        returnByValue: true,
        timeout: timeoutMs,
      }, Math.max(timeoutMs + 1000, 3000));
      if (result.exceptionDetails) {
        throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text || "Runtime.evaluate failed");
      }
      return result.result?.value ?? null;
    },
    async evaluateJson(expression, timeoutMs = commandTimeoutMs) {
      const raw = await client.evaluate(`(async () => JSON.stringify(await (${expression})))()`, timeoutMs);
      return raw ? JSON.parse(raw) : null;
    },
    async screenshot(path, screenshotOptions = {}) {
      await send("Page.enable").catch(() => {});
      const result = await send("Page.captureScreenshot", {
        format: "png",
        fromSurface: true,
        captureBeyondViewport: screenshotOptions.captureBeyondViewport ?? screenshotBeyondViewport,
      });
      writeFileSync(path, Buffer.from(result.data, "base64"));
    },
    async setViewport(width, height) {
      await send("Emulation.setDeviceMetricsOverride", {
        width,
        height,
        deviceScaleFactor: 1,
        mobile: false,
      });
    },
    async clearViewport() {
      await send("Emulation.clearDeviceMetricsOverride").catch(() => {});
    },
    async reload() {
      await send("Page.enable").catch(() => {});
      await send("Page.reload", { ignoreCache: true });
    },
    async closeTarget() {
      await send("Page.close").catch(() => {});
    },
    async clickAt(x, y) {
      await send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y, button: "none" });
      await send("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", clickCount: 1 });
      await send("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", clickCount: 1 });
    },
    async bringToFront() {
      await send("Page.bringToFront");
    },
    close() {
      ws.close();
    },
  };

  return client;
}
