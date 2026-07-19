import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { JSDOM } from "jsdom";

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

  it("redacts Page/Web screenshot data URLs from exported sidepanel DOM", () => {
    const dom = new JSDOM(`
      <body>
        <section class="page-reader-screenshot" data-state="preview">
          <img class="page-reader-screenshot-preview" alt="Preview" src="data:image/jpeg;base64,c2NyZWVuc2hvdA==">
        </section>
        <img class="other-preview" src="data:image/png;base64,c2Vjb25kYXJ5">
      </body>
    `);

    const html = internals.redactSidepanelDomHtml(dom.window.document.body);

    expect(html).not.toContain("data:image/");
    expect(html).not.toContain("c2NyZWVuc2hvdA");
    expect(html).toContain(internals.REDACTED_SCREENSHOT_DATA_URL);
    expect(html).toContain("data-snapshot-redacted=\"screenshot-preview\"");
  });
});
