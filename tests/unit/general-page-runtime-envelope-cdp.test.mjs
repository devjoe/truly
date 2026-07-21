import { describe, expect, it } from "vitest";

import {
  findInvestigationServiceWorker,
  isPrivateCaptureOutputPath,
  selectInvestigationServiceWorker,
} from "../../scripts/collect-general-page-runtime-envelopes-cdp.mjs";

describe("General Page runtime-envelope CDP collector", () => {
  it("limits raw captures to private temporary paths", () => {
    expect(isPrivateCaptureOutputPath("tmp/private-capture.json", "/workspace/truly")).toBe(true);
    expect(isPrivateCaptureOutputPath("/private/tmp/capture.json", "/workspace/truly")).toBe(true);
    expect(isPrivateCaptureOutputPath("docs/capture.json", "/workspace/truly")).toBe(false);
  });

  it("selects an extension service worker without activating a target", () => {
    const target = selectInvestigationServiceWorker([
      { type: "page", url: "https://example.test", webSocketDebuggerUrl: "ws://page" },
      { type: "service_worker", url: "https://example.test/sw.js", webSocketDebuggerUrl: "ws://web" },
      { type: "service_worker", url: "chrome-extension://fixture/background/service-worker.js", webSocketDebuggerUrl: "ws://extension" },
    ]);
    expect(target?.webSocketDebuggerUrl).toBe("ws://extension");
  });

  it("probes extension identity instead of arming the first worker", async () => {
    const closed = [];
    const connect = (url) => ({
      evaluate: async () => url === "ws://truly"
        ? { name: "Truly", available: true }
        : { name: "Other", available: false },
      close: () => closed.push(url),
    });
    const target = await findInvestigationServiceWorker([
      { type: "service_worker", url: "chrome-extension://other/background.js", webSocketDebuggerUrl: "ws://other" },
      { type: "service_worker", url: "chrome-extension://truly/background.js", webSocketDebuggerUrl: "ws://truly" },
    ], connect);
    expect(target?.webSocketDebuggerUrl).toBe("ws://truly");
    expect(closed).toEqual(["ws://other", "ws://truly"]);
  });
});
