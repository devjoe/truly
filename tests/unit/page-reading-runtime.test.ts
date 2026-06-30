import { JSDOM } from "jsdom";
import { describe, expect, it, vi } from "vitest";

import type { TrulyMessage } from "@src/lib/messages";
import type { ReadingSurface } from "@src/lib/reading-surface-types";
import { createSidepanelPageReadingRuntime } from "@src/sidepanel/page-reading-runtime";

function setupDom(): HTMLElement {
  const dom = new JSDOM("<!doctype html><div id=\"page-pane\"></div>", {
    url: "chrome-extension://example/sidepanel/sidepanel.html",
  });
  globalThis.document = dom.window.document;
  globalThis.HTMLElement = dom.window.HTMLElement;
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: dom.window.navigator,
  });
  return dom.window.document.getElementById("page-pane")!;
}

function surface(overrides: Partial<ReadingSurface> = {}): ReadingSurface {
  return {
    id: "general:https://example.test/article",
    kind: "web-page",
    source: "general",
    url: "https://example.test/article",
    canonicalUrl: "https://example.test/article",
    title: "Runtime Fixture",
    mainText: "Runtime fixture text long enough to show a preview without representing any real page content.",
    excerpt: "Runtime fixture excerpt.",
    extraction: {
      method: "semantic-html",
      status: "complete",
      warnings: [],
    },
    ...overrides,
  };
}

describe("sidepanel page reading runtime", () => {
  it("shows toolbar activation guidance when the active tab URL is hidden", async () => {
    const pagePaneEl = setupDom();
    const runtime = createSidepanelPageReadingRuntime({
      pagePaneEl,
      runtime: {
        sendMessage: vi.fn(),
      },
      tabs: {
        query: vi.fn(async () => [{ id: 42 }]),
      },
      activateTab: vi.fn(),
      getLang: () => "zh-TW",
      now: () => 1_000,
    });

    await runtime.requestReadCurrentPage("sidepanel");

    expect(pagePaneEl.textContent).toContain("讀取失敗");
    expect(pagePaneEl.textContent).toContain("請先在目標網頁上點 Truly 工具列圖示");
  });

  it("maps Chrome page-access errors to a friendly retry explanation", async () => {
    const pagePaneEl = setupDom();
    const sendMessage = vi.fn(async () => ({
      type: "PAGE_READING_ERROR",
      tabId: 42,
      error: "Cannot access contents of the page. Extension manifest must request permission to access the respective host.",
    } satisfies TrulyMessage));
    const runtime = createSidepanelPageReadingRuntime({
      pagePaneEl,
      runtime: { sendMessage },
      tabs: {
        query: vi.fn(async () => [{
          id: 42,
          url: "https://example.test/article",
          title: "Runtime Fixture",
        }]),
      },
      activateTab: vi.fn(),
      getLang: () => "zh-TW",
      now: () => 1_000,
    });

    await runtime.requestReadCurrentPage("sidepanel");

    expect(sendMessage).toHaveBeenCalledWith(expect.objectContaining({
      type: "PAGE_READING_REQUEST",
      tabId: 42,
      inject: true,
    }));
    expect(pagePaneEl.textContent).toContain("讀取失敗");
    expect(pagePaneEl.textContent).toContain("請先在目標網頁上點 Truly 工具列圖示");
  });

  it("renders a successful page reading result", async () => {
    const pagePaneEl = setupDom();
    const runtime = createSidepanelPageReadingRuntime({
      pagePaneEl,
      runtime: {
        sendMessage: vi.fn(async () => ({
          type: "PAGE_READING_RESULT",
          tabId: 42,
          surface: surface(),
        } satisfies TrulyMessage)),
      },
      tabs: {
        query: vi.fn(async () => [{
          id: 42,
          url: "https://example.test/article",
          title: "Runtime Fixture",
        }]),
      },
      activateTab: vi.fn(),
      getLang: () => "zh-TW",
      now: () => 1_000,
    });

    await runtime.requestReadCurrentPage("sidepanel");

    expect(pagePaneEl.textContent).toContain("已讀取");
    expect(pagePaneEl.textContent).toContain("Runtime Fixture");
    expect(pagePaneEl.textContent).toContain("Runtime fixture excerpt.");
  });
});
