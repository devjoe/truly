import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

type SsrInternals = typeof import("../../src/content_scripts/feed-interception").__ssrCacheInternals;

describe("SSR cache bridge validation", () => {
  let internals: SsrInternals;
  let storageGet: ReturnType<typeof vi.fn>;
  let storageSet: ReturnType<typeof vi.fn>;
  let postMessage: ReturnType<typeof vi.fn>;

  const validUrl = "https://www.facebook.com/groups/example/posts/123";
  const validPost = {
    postId: "post-1",
    text: "Sponsored context from SSR",
    authorName: "City Watch",
    isSponsored: true,
    postType: "standard",
    ignored: "<script>alert(1)</script>",
  };

  beforeAll(async () => {
    vi.stubGlobal("__TRULY_DEV_BUILD__", false);
    postMessage = vi.fn();
    vi.stubGlobal("window", {
      location: { origin: "https://www.facebook.com" },
      postMessage,
    });
    storageGet = vi.fn();
    storageSet = vi.fn();
    vi.stubGlobal("chrome", {
      runtime: { id: "test-extension" },
      storage: {
        local: {
          get: storageGet,
          set: storageSet,
        },
      },
    });
    internals = (await import("../../src/content_scripts/feed-interception")).__ssrCacheInternals;
  });

  beforeEach(() => {
    storageGet.mockReset();
    storageSet.mockReset().mockResolvedValue(undefined);
    postMessage.mockReset();
  });

  it("stores only validated and normalized same-origin Facebook SSR posts", () => {
    internals.handleSsrCacheStore(validUrl, [validPost]);

    expect(storageSet).toHaveBeenCalledTimes(1);
    const stored = storageSet.mock.calls[0][0];
    const key = `${internals.KEY_PREFIX}${validUrl}`;
    expect(stored[key].posts).toEqual([
      {
        postId: "post-1",
        text: "Sponsored context from SSR",
        authorName: "City Watch",
        isSponsored: true,
        postType: "standard",
      },
    ]);
  });

  it("rejects off-origin cache keys before writing to extension storage", () => {
    internals.handleSsrCacheStore("https://evil.example/posts/123", [validPost]);

    expect(storageSet).not.toHaveBeenCalled();
  });

  it("rejects malformed, oversized, or non-array post payloads", () => {
    internals.handleSsrCacheStore(validUrl, { posts: [validPost] });
    internals.handleSsrCacheStore(validUrl, [{ ...validPost, text: "x".repeat(5001) }]);
    internals.handleSsrCacheStore(validUrl, Array.from({ length: 31 }, (_, index) => ({
      ...validPost,
      postId: `post-${index}`,
    })));

    expect(storageSet).not.toHaveBeenCalled();
  });

  it("does not return poisoned cached entries to the MAIN-world bridge", async () => {
    const key = `${internals.KEY_PREFIX}${validUrl}`;
    storageGet.mockResolvedValue({
      [key]: {
        ts: Date.now(),
        posts: [{ ...validPost, authorName: "" }],
      },
    });

    await internals.handleSsrCacheQuery(validUrl, "ssrq-1-1234567890");

    expect(postMessage).toHaveBeenCalledWith(
      { type: "TRULY_SSR_CACHE_REPLY", reqId: "ssrq-1-1234567890", posts: null },
      "https://www.facebook.com",
    );
  });

  it("drops invalid cache query ids without replying", async () => {
    await internals.handleSsrCacheQuery(validUrl, "../bad id");

    expect(storageGet).not.toHaveBeenCalled();
    expect(postMessage).not.toHaveBeenCalled();
  });
});
