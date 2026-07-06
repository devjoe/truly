import { afterEach, describe, expect, it, vi } from "vitest";

import { fetchRenderedPageHtml } from "../../scripts/lib/cdp-page-source.mjs";

describe("CDP page source helper", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("turns an unsettled CDP target into a recorded timeout and closes the target", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn(async (url) => {
      const value = String(url);
      if (value.includes("/json/new?")) {
        return jsonResponse({
          id: "target-1",
          webSocketDebuggerUrl: "ws://127.0.0.1:9222/devtools/page/target-1",
        });
      }
      if (value.includes("/json/close/target-1"))
        return jsonResponse({ ok: true });
      throw new Error(`unexpected fetch ${value}`);
    });
    const closeMock = vi.fn();
    class NeverOpeningWebSocket {
      addEventListener() {}
      close() {
        closeMock();
      }
    }

    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("WebSocket", NeverOpeningWebSocket);

    const promise = fetchRenderedPageHtml("https://example.test/stuck", {
      cdpBase: "http://127.0.0.1:9222",
      timeoutMs: 1,
      settleMs: 0,
    });
    const observed = promise.catch((error) => error);

    await vi.advanceTimersByTimeAsync(5_002);
    const error = await observed;
    expect(error).toBeInstanceOf(Error);
    expect(error.message).toBe("cdp render timed out for https://example.test/stuck");
    expect(fetchMock).toHaveBeenCalledWith("http://127.0.0.1:9222/json/close/target-1");
    expect(closeMock).not.toHaveBeenCalled();
  });
});

function jsonResponse(body) {
  return {
    ok: true,
    async json() {
      return body;
    },
  };
}
