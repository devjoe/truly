import { describe, expect, it, vi } from "vitest";

import { createPageReaderTabTransport } from "@src/background/page-reader-tab-transport";
import type { TrulyMessage } from "@src/lib/messages";
import type { ReadingSurface } from "@src/lib/reading-surface-types";

const surface: ReadingSurface = {
  id: "general:https://example.test/article",
  kind: "web-page",
  source: "general",
  url: "https://example.test/article",
  mainText: "Synthetic page-reader transport text.",
  extraction: { method: "semantic-html", status: "complete", warnings: [] },
};

describe("page reader tab transport", () => {
  it("reuses a current content script and preserves page request identity", async () => {
    let nowMs = 100;
    const executeScript = vi.fn(async () => undefined);
    const sendMessage = vi.fn(async (_tabId: number, message: TrulyMessage) => {
      if (message.type === "GET_VERSION") {
        return { type: "GET_VERSION_RESULT", component: "page-reader-content-script", buildId: "build-1" };
      }
      return { type: "PAGE_READING_RESULT", surface };
    });
    const transport = createPageReaderTabTransport({
      scripting: { executeScript },
      tabs: { sendMessage },
      expectedBuildId: "build-1",
      now: () => nowMs,
    });
    nowMs = 135;
    const result = await transport.requestPage({
      type: "PAGE_READING_REQUEST",
      requestId: "page-read:transport-12345678",
      tabId: 42,
      inject: true,
      activation: { source: "sidepanel", targetKind: "page", action: "read" },
    });
    expect(executeScript).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      type: "PAGE_READING_RESULT",
      requestId: "page-read:transport-12345678",
      tabId: 42,
      elapsedMs: 0,
    });
  });

  it("injects once when the page reader is absent before sending the request", async () => {
    const executeScript = vi.fn(async () => undefined);
    const sendMessage = vi.fn()
      .mockRejectedValueOnce(new Error("Receiving end does not exist"))
      .mockResolvedValueOnce({ type: "PAGE_READING_RESULT", surface });
    const transport = createPageReaderTabTransport({
      scripting: { executeScript },
      tabs: { sendMessage },
      expectedBuildId: "build-1",
      now: () => 100,
    });
    const result = await transport.requestPage({
      type: "PAGE_READING_REQUEST",
      tabId: 42,
      inject: true,
    });
    expect(executeScript).toHaveBeenCalledTimes(1);
    expect(result.type).toBe("PAGE_READING_RESULT");
  });

  it("maps restricted-page failures without leaking Chrome error text", async () => {
    const transport = createPageReaderTabTransport({
      scripting: {
        executeScript: vi.fn(async () => {
          throw new Error("Cannot access contents of the page. Extension manifest must request permission.");
        }),
      },
      tabs: { sendMessage: vi.fn(async () => undefined) },
      expectedBuildId: "build-1",
    });
    await expect(transport.requestTarget({
      type: "READING_TARGET_REQUEST",
      tabId: 42,
      trigger: "selection",
      activation: { source: "sidepanel", targetKind: "selection", action: "read" },
    })).resolves.toEqual({
      type: "READING_TARGET_ERROR",
      tabId: 42,
      error: "page_grant_missing",
    });
  });

  it("normalizes invalid candidate responses with surface and block identity", async () => {
    const transport = createPageReaderTabTransport({
      scripting: { executeScript: vi.fn(async () => undefined) },
      tabs: { sendMessage: vi.fn(async () => ({ type: "GET_VERSION_RESULT", component: "page-reader-content-script", buildId: "build-1" })) },
      expectedBuildId: "build-1",
    });
    await expect(transport.requestCandidateBlock({
      type: "GENERAL_PAGE_CANDIDATE_BLOCK_TEXT_REQUEST",
      tabId: 42,
      surfaceId: surface.id,
      blockId: "candidate:1",
    })).resolves.toEqual({
      type: "GENERAL_PAGE_CANDIDATE_BLOCK_TEXT_ERROR",
      tabId: 42,
      surfaceId: surface.id,
      blockId: "candidate:1",
      error: "candidate_block_extraction_failed",
    });
  });
});
