import { describe, expect, it, vi } from "vitest";

import { queueReadingCommand } from "@src/background/reading-command-mailbox";
import {
  createReadingCommandEnvelope,
  createReadingRequestId,
  PAGE_READING_COMMAND_MAX_AGE_MS,
  PENDING_PAGE_READING_COMMAND_KEY,
  parseReadingCommandEnvelope,
} from "@src/lib/reading-command-envelope";

function envelope(createdAt = 10_000) {
  return createReadingCommandEnvelope({
    requestId: "page-read:fixture-12345678",
    tabId: 42,
    url: "https://example.test/article",
    activation: { source: "popup", targetKind: "page", action: "read" },
    createdAt,
  });
}

describe("reading command envelope", () => {
  it("creates stable request identities and parses only command metadata", () => {
    expect(createReadingRequestId(() => "fixed-uuid")).toBe("page-read:fixed-uuid");
    const parsed = parseReadingCommandEnvelope({
      ...envelope(),
      mainText: "must not cross the mailbox seam",
      analysis: { summary: "must not persist" },
    }, 10_100);
    expect(parsed).toEqual(envelope());
    expect(parsed).not.toHaveProperty("mainText");
    expect(parsed).not.toHaveProperty("analysis");
  });

  it("rejects expired, future, and non-page commands", () => {
    expect(parseReadingCommandEnvelope(envelope(), 10_000 + PAGE_READING_COMMAND_MAX_AGE_MS + 1)).toBeUndefined();
    expect(parseReadingCommandEnvelope(envelope(20_000), 10_000)).toBeUndefined();
    expect(parseReadingCommandEnvelope({
      ...envelope(),
      activation: { source: "popup", targetKind: "selection", action: "read" },
    }, 10_000)).toBeUndefined();
  });

  it("stores one trusted command and emits only a low-latency hint", async () => {
    const storage = { set: vi.fn(async () => undefined) };
    const notify = vi.fn(async () => undefined);
    const result = await queueReadingCommand({
      message: { type: "QUEUE_PAGE_READING_COMMAND", envelope: envelope() },
      sender: { id: "extension-id", url: "chrome-extension://extension-id/popup/popup.html" },
      extensionId: "extension-id",
      storage,
      notify,
      now: () => 10_100,
    });
    expect(result).toEqual({
      type: "QUEUE_PAGE_READING_COMMAND_RESULT",
      requestId: envelope().requestId,
      ok: true,
    });
    expect(storage.set).toHaveBeenCalledWith({ [PENDING_PAGE_READING_COMMAND_KEY]: envelope() });
    expect(notify).toHaveBeenCalledTimes(1);
  });

  it("rejects untrusted extension senders without writing storage", async () => {
    const storage = { set: vi.fn(async () => undefined) };
    const result = await queueReadingCommand({
      message: { type: "QUEUE_PAGE_READING_COMMAND", envelope: envelope() },
      sender: { id: "other-extension", url: "chrome-extension://other-extension/popup.html" },
      extensionId: "extension-id",
      storage,
      notify: async () => undefined,
      now: () => 10_100,
    });
    expect(result.ok).toBe(false);
    expect(result.error).toBe("untrusted_reading_command_sender");
    expect(storage.set).not.toHaveBeenCalled();
  });
});
