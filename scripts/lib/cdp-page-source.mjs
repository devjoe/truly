// Live-DOM page source for the product-quality review harness.
//
// The static-fetch review path understates JS-rendered sites relative to the
// real extension, which reads the live DOM after scripts run (finding 4 of
// the 2026-07-02 validation run). This module renders a URL in the existing
// Chrome CDP session and returns post-JS HTML so the same jsdom + extractor
// pipeline can score what the extension would actually see.
//
// Private-tooling boundary: rendered HTML and final URLs stay in tmp/
// artifacts, same as the static path. Nothing here touches extension runtime
// code.

const DEFAULT_RENDER_TIMEOUT_MS = 20_000;
const DEFAULT_SETTLE_MS = 1_500;

export function cdpBaseForPort(port) {
  return `http://127.0.0.1:${Number(port) || 9222}`;
}

export async function fetchRenderedPageHtml(url, options = {}) {
  const cdpBase = options.cdpBase ?? cdpBaseForPort(options.cdpPort);
  const timeoutMs = options.timeoutMs ?? DEFAULT_RENDER_TIMEOUT_MS;
  const settleMs = options.settleMs ?? DEFAULT_SETTLE_MS;

  const target = await fetchJson(`${cdpBase}/json/new?${encodeURIComponent(url)}`, { method: "PUT" });
  if (!target?.webSocketDebuggerUrl || !target?.id)
    throw new Error(`cdp target creation failed for ${url}`);

  try {
    const client = await connect(target.webSocketDebuggerUrl);
    try {
      await client.send("Page.enable");
      await waitForLoad(client, timeoutMs);
      await sleep(settleMs);
      const evaluated = await client.send("Runtime.evaluate", {
        expression: "JSON.stringify({ html: document.documentElement.outerHTML, finalUrl: location.href })",
        returnByValue: true,
      });
      const raw = evaluated?.result?.value;
      const parsed = typeof raw === "string" ? JSON.parse(raw) : null;
      if (!parsed?.html)
        throw new Error("cdp evaluation returned no document HTML");
      return { html: parsed.html, finalUrl: parsed.finalUrl ?? url };
    } finally {
      client.close();
    }
  } finally {
    await fetch(`${cdpBase}/json/close/${target.id}`).catch(() => {});
  }
}

function waitForLoad(client, timeoutMs) {
  return new Promise((resolveLoad) => {
    const timer = setTimeout(() => resolveLoad(undefined), timeoutMs);
    client.onEvent("Page.loadEventFired", () => {
      clearTimeout(timer);
      resolveLoad(undefined);
    });
  });
}

function connect(webSocketDebuggerUrl) {
  return new Promise((resolveConnect, rejectConnect) => {
    const ws = new WebSocket(webSocketDebuggerUrl);
    let nextId = 1;
    const pending = new Map();
    const eventListeners = new Map();

    ws.addEventListener("open", () => resolveConnect({
      send(method, params = {}) {
        return new Promise((resolveSend, rejectSend) => {
          const id = nextId;
          nextId += 1;
          pending.set(id, { resolve: resolveSend, reject: rejectSend });
          ws.send(JSON.stringify({ id, method, params }));
        });
      },
      onEvent(method, listener) {
        eventListeners.set(method, listener);
      },
      close() {
        try { ws.close(); } catch { /* ignore */ }
      },
    }), { once: true });

    ws.addEventListener("error", () => rejectConnect(new Error("cdp websocket connection failed")), { once: true });

    ws.addEventListener("message", (event) => {
      let message;
      try {
        message = JSON.parse(String(event.data));
      } catch {
        return;
      }
      if (typeof message.id === "number" && pending.has(message.id)) {
        const entry = pending.get(message.id);
        pending.delete(message.id);
        if (message.error) entry.reject(new Error(message.error.message ?? "cdp command failed"));
        else entry.resolve(message.result);
        return;
      }
      if (typeof message.method === "string") {
        eventListeners.get(message.method)?.(message.params);
      }
    });
  });
}

async function fetchJson(url, init = {}) {
  const response = await fetch(url, { ...init, signal: AbortSignal.timeout(8_000) });
  if (!response.ok)
    throw new Error(`cdp http ${response.status} for ${url}`);
  return response.json();
}

function sleep(ms) {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
}
