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

  it("recognizes only the spaced English ad header sequence", () => {
    expect(
      feed.isSpacedEnglishAdHeaderText(
        "營養師輕食 S s o p r n e o t d g 0 t f f h 2 c 9 7 t f h m 4 h h f A 4 t t d g ·",
      ),
    ).toBe(true);
    expect(
      feed.isSpacedEnglishAdHeaderText(
        "營養師輕食Ssoprneotdg0tffh2c97tfhm4hhfA4ttdg32t4c67096l3u691i1252i1u03 · Shared with Public",
      ),
    ).toBe(false);
    expect(feed.isSpacedEnglishAdHeaderText("This post mentions sponsored content")).toBe(false);
  });

  it("recognizes only a short English Ad metadata label", () => {
    expect(feed.isShortEnglishAdLabelText("Ad")).toBe(true);
    expect(feed.isShortEnglishAdLabelText("Ad ·")).toBe(true);
    expect(feed.isShortEnglishAdLabelText("Ad · 🌐")).toBe(true);
    expect(feed.isShortEnglishAdLabelText("Ad • 🌐")).toBe(true);
    expect(feed.isShortSponsoredLabelText("Ad")).toBe(true);
    expect(feed.isShortSponsoredLabelText("Ad · 🌐")).toBe(true);
    expect(feed.isShortEnglishAdLabelText("Ad hoc")).toBe(false);
    expect(feed.isShortSponsoredLabelText("Ad hoc")).toBe(false);
    expect(feed.isShortSponsoredLabelText("AuthorAdShared with Public")).toBe(false);
  });

});
