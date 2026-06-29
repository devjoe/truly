import { describe, expect, it, vi } from "vitest";
import { sendRuntimeMessageSafely } from "@src/lib/runtime-message";

describe("runtime message helper", () => {
  it("supports callback-style sendMessage implementations that return undefined", () => {
    const messages: unknown[] = [];
    const sender = (message: unknown) => {
      messages.push(message);
      return undefined;
    };

    sendRuntimeMessageSafely(sender, { type: "MANUAL_VIEW_POST", id: "post-1" });
    sendRuntimeMessageSafely(sender, { type: "TOGGLE_DASHBOARD_FOR_POST", id: "post-1" });

    expect(messages).toEqual([
      { type: "MANUAL_VIEW_POST", id: "post-1" },
      { type: "TOGGLE_DASHBOARD_FOR_POST", id: "post-1" },
    ]);
  });

  it("suppresses rejected Promise-style sendMessage results", async () => {
    const sender = vi.fn(() => Promise.reject(new Error("receiver unavailable")));

    sendRuntimeMessageSafely(sender, { type: "OPEN_OPTIONS_PAGE" });
    await Promise.resolve();

    expect(sender).toHaveBeenCalledWith({ type: "OPEN_OPTIONS_PAGE" });
  });

  it("suppresses synchronous runtime errors", () => {
    expect(() => {
      sendRuntimeMessageSafely(() => {
        throw new Error("runtime unavailable");
      }, { type: "OPEN_OPTIONS_PAGE" });
    }).not.toThrow();
  });
});
