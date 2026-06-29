import { beforeAll, describe, expect, it, vi } from "vitest";

type FeedInterception = typeof import("../../src/content_scripts/feed-interception");

type Rect = {
  width: number;
  height: number;
};

class FakeElement {
  readonly nodeType = 1;
  parentElement: FakeElement | null = null;
  children: FakeElement[] = [];
  dataset: Record<string, string> = {};
  id = "";
  className = "";
  innerText = "";
  textContent = "";

  constructor(
    private readonly rect: Rect,
    private readonly attrs: Record<string, string> = {},
    private readonly selectors: Record<string, FakeElement | null> = {},
  ) {}

  append(child: FakeElement) {
    child.parentElement = this;
    this.children.push(child);
  }

  get childNodes(): FakeElement[] {
    return this.children;
  }

  contains(target: FakeElement): boolean {
    return this === target || this.children.some((child) => child.contains(target));
  }

  getAttribute(name: string): string | null {
    return this.attrs[name] ?? null;
  }

  getBoundingClientRect(): Rect {
    return this.rect;
  }

  querySelector(selector: string): FakeElement | null {
    return this.selectors[selector] ?? null;
  }

  querySelectorAll(): FakeElement[] {
    return [];
  }
}

describe("Facebook feed post boundary", () => {
  let feed: FeedInterception;

  beforeAll(async () => {
    vi.stubGlobal("__TRULY_DEV_BUILD__", false);
    vi.stubGlobal("Node", { ELEMENT_NODE: 1, TEXT_NODE: 3 });
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

  it("returns the real post, not the group page wrapper that contains a nested feed", () => {
    const heading = new FakeElement({ width: 80, height: 24 });
    const nestedFeed = new FakeElement({ width: 760, height: 900 });
    const root = new FakeElement({ width: 1200, height: 1800 });
    const pageWrapper = new FakeElement(
      { width: 900, height: 2400 },
      {},
      { '[role="feed"]': nestedFeed, "h1, h2, h3, h4, h5, h6": heading },
    );
    pageWrapper.innerText = "Write something in this group";
    pageWrapper.textContent = pageWrapper.innerText;
    const post = new FakeElement(
      { width: 680, height: 520 },
      {},
      { '[role="feed"]': null, "h1, h2, h3, h4, h5, h6": heading },
    );
    post.innerText = "Synthetic author Synthetic post body Like Comment Share";
    post.textContent = post.innerText;
    const actionRow = new FakeElement({ width: 650, height: 56 });
    const commentButton = new FakeElement({ width: 120, height: 32 });

    root.append(pageWrapper);
    pageWrapper.append(post);
    post.append(actionRow);
    actionRow.append(commentButton);

    expect(
      feed.findPostBoundary(commentButton as unknown as HTMLElement, root as unknown as HTMLElement),
    ).toBe(post);
  });
});
