import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { connectCdp } from "../../scripts/lib/cdp-client.mjs";

class FakeWebSocket {
  static instances = [];

  constructor(url) {
    this.url = url;
    this.listeners = new Map();
    this.sent = [];
    FakeWebSocket.instances.push(this);
    queueMicrotask(() => this.emit("open", {}));
  }

  addEventListener(type, listener) {
    const listeners = this.listeners.get(type) ?? [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }

  emit(type, event) {
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }

  send(payload) {
    this.sent.push(JSON.parse(payload));
  }

  respond(id, result) {
    this.emit("message", { data: JSON.stringify({ id, result }) });
  }

  close() {
    this.emit("close", {});
  }
}

describe("shared CDP client", () => {
  beforeEach(() => {
    FakeWebSocket.instances = [];
    vi.stubGlobal("WebSocket", FakeWebSocket);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("evaluates by value and preserves the caller timeout", async () => {
    const client = connectCdp("ws://fixture", { commandTimeoutMs: 5000 });
    const socket = FakeWebSocket.instances[0];
    const pending = client.evaluate("1 + 1", 1200);
    await vi.waitFor(() => expect(socket.sent).toHaveLength(1));
    expect(socket.sent[0]).toMatchObject({
      method: "Runtime.evaluate",
      params: { expression: "1 + 1", awaitPromise: true, returnByValue: true, timeout: 1200 },
    });
    socket.respond(socket.sent[0].id, { result: { value: 2 } });
    await expect(pending).resolves.toBe(2);
    client.close();
  });

  it("times out commands instead of leaving audit promises pending", async () => {
    vi.useFakeTimers();
    const client = connectCdp("ws://fixture", { commandTimeoutMs: 20 });
    const pending = client.send("Runtime.enable");
    const rejection = expect(pending).rejects.toThrow("CDP command timed out: Runtime.enable after 20ms");
    await vi.runAllTimersAsync();
    await rejection;
    client.close();
  });

  it("uses focus-safe commands unless a caller explicitly requests Page.bringToFront", async () => {
    const client = connectCdp("ws://fixture");
    const socket = FakeWebSocket.instances[0];
    const evaluation = client.evaluate("document.title");
    await vi.waitFor(() => expect(socket.sent).toHaveLength(1));
    expect(socket.sent.map((command) => command.method)).not.toContain("Page.bringToFront");
    socket.respond(socket.sent[0].id, { result: { value: "Fixture" } });
    await evaluation;

    const focus = client.bringToFront();
    await vi.waitFor(() => expect(socket.sent).toHaveLength(2));
    expect(socket.sent[1].method).toBe("Page.bringToFront");
    socket.respond(socket.sent[1].id, {});
    await focus;
    client.close();
  });
});
