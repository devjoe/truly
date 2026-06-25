import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

type FeedInterception = typeof import("../../src/content_scripts/feed-interception");

describe("sponsored session memory", () => {
  let feed: FeedInterception;

  beforeAll(async () => {
    vi.stubGlobal("__TRULY_DEV_BUILD__", false);
    vi.stubGlobal("window", {
      location: { origin: "https://www.facebook.com" },
      postMessage: vi.fn(),
    });
    vi.stubGlobal("chrome", {
      runtime: { id: "test-extension" },
      storage: {
        local: {
          get: vi.fn(),
          set: vi.fn(),
        },
      },
    });
    vi.stubGlobal("document", {
      querySelectorAll: vi.fn(() => []),
    });
    feed = await import("../../src/content_scripts/feed-interception");
  });

  beforeEach(() => {
    feed.__resetForTesting();
  });

  it("does not mark unrelated posts from the same author as sponsored", () => {
    feed.handleGraphQLPosts([
      {
        postId: "ad-1",
        text: "Sponsored product launch with a distinctive text seed",
        authorName: "Same Author",
        isSponsored: true,
      },
    ]);

    expect(feed.isKnownSponsored("A normal update with unrelated wording", "Same Author")).toBe(false);
  });

  it("still remembers sponsored text seeds across DOM remounts", () => {
    feed.handleGraphQLPosts([
      {
        postId: "ad-1",
        text: "Sponsored product launch with a distinctive text seed",
        authorName: "Advertiser",
        isSponsored: true,
      },
    ]);

    expect(
      feed.isKnownSponsored(
        "Sponsored product launch with a distinctive text seed and extra visible copy",
        "Different Author",
      ),
    ).toBe(true);
  });
});
