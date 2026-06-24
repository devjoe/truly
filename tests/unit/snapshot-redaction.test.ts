import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

type SnapshotInternals = typeof import("../../src/sidepanel/snapshot").__snapshotInternals;

describe("debug snapshot secret redaction", () => {
  let internals: SnapshotInternals;
  let syncGet: ReturnType<typeof vi.fn>;
  let sessionGet: ReturnType<typeof vi.fn>;
  let localGet: ReturnType<typeof vi.fn>;

  beforeAll(async () => {
    vi.stubGlobal("__TRULY_BUILD_ID__", "test-build");
    syncGet = vi.fn();
    sessionGet = vi.fn();
    localGet = vi.fn();
    vi.stubGlobal("chrome", {
      storage: {
        sync: { get: syncGet },
        session: { get: sessionGet },
        local: { get: localGet },
      },
      runtime: { sendMessage: vi.fn() },
      tabs: {
        query: vi.fn(),
        sendMessage: vi.fn(),
        captureVisibleTab: vi.fn(),
      },
    });
    vi.stubGlobal("document", { body: { outerHTML: "<body></body>" } });
    internals = (await import("../../src/sidepanel/snapshot")).__snapshotInternals;
  });

  beforeEach(() => {
    syncGet.mockReset();
    sessionGet.mockReset();
    localGet.mockReset();
  });

  it("redacts API key shaped fields recursively", () => {
    expect(internals.redactStorageSecrets({
      settings: { language: "en" },
      tierAApiKey: "secret-a",
      nested: {
        api_key: "secret-b",
        apiKeyAccepted: true,
      },
      list: [{ tierBApiKey: "secret-c" }],
    })).toEqual({
      settings: { language: "en" },
      tierAApiKey: internals.REDACTED_SECRET,
      nested: {
        api_key: internals.REDACTED_SECRET,
        apiKeyAccepted: true,
      },
      list: [{ tierBApiKey: internals.REDACTED_SECRET }],
    });
  });

  it("does not read storage.local and redacts session-only API keys", async () => {
    syncGet.mockResolvedValue({ settings: { language: "zh-TW" } });
    sessionGet.mockResolvedValue({
      pendingOpenPost: "post-1",
      tierAApiKey: "session-secret-a",
      tierBApiKey: "session-secret-b",
    });

    const storage = await internals.readStorage();

    expect(localGet).not.toHaveBeenCalled();
    expect(storage).toEqual({
      sync: { settings: { language: "zh-TW" } },
      session: {
        pendingOpenPost: "post-1",
        tierAApiKey: internals.REDACTED_SECRET,
        tierBApiKey: internals.REDACTED_SECRET,
      },
    });
  });
});
