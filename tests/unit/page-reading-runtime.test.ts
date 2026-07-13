import { JSDOM } from "jsdom";
import { describe, expect, it, vi } from "vitest";

import type { TrulyMessage } from "@src/lib/messages";
import type { ReadingSurface } from "@src/lib/reading-surface-types";
import { DEFAULT_SETTINGS } from "@src/lib/types";
import {
  createReadingCommandEnvelope,
  PENDING_PAGE_READING_COMMAND_KEY,
} from "@src/lib/reading-command-envelope";
import { createSidepanelPageReadingRuntime } from "@src/sidepanel/page-reading-runtime";
import type { TabId } from "@src/sidepanel/tabs";

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

function readCurrentButton(pagePaneEl: HTMLElement): HTMLButtonElement | null {
  return pagePaneEl.ownerDocument.querySelector<HTMLButtonElement>("#pageReadCurrent");
}

function surface(overrides: Partial<ReadingSurface> = {}): ReadingSurface {
  return {
    id: "general:https://example.test/article",
    kind: "web-page",
    source: "general",
    url: "https://example.test/article",
    canonicalUrl: "https://example.test/article",
    title: "Runtime Fixture",
    mainText: [
      "Runtime fixture text long enough to show a preview without representing any real page content.",
      "This additional synthetic paragraph keeps the page above the model context threshold while remaining generic.",
      "It mentions review notes, source inspection, and stable extraction metadata without using real website content.",
      "The final sentence makes the fixture suitable for model-readiness display tests.",
    ].join(" "),
    excerpt: "Runtime fixture excerpt.",
    links: [{
      href: "https://example.test/source",
      text: "Synthetic source",
    }],
    extraction: {
      method: "semantic-html",
      status: "complete",
      warnings: [],
    },
    ...overrides,
  };
}

async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

function diagnosticRawValue(root: ParentNode, labelPattern: RegExp): string | undefined {
  const rows = Array.from(root.querySelectorAll("dl div"));
  const row = rows.find((item) => labelPattern.test(item.querySelector("dt")?.textContent?.trim() ?? ""));
  const dd = row?.querySelector("dd");
  return dd?.getAttribute("data-raw-value") ?? dd?.textContent?.trim();
}

describe("sidepanel page reading runtime", () => {
  it("shows elapsed seconds only after a page read takes long enough", async () => {
    vi.useFakeTimers();
    try {
      const pagePaneEl = setupDom();
      let nowMs = 1_000;
      let resolveRead: ((message: TrulyMessage) => void) | undefined;
      const readPromise = new Promise<TrulyMessage>((resolve) => {
        resolveRead = resolve;
      });
      const runtime = createSidepanelPageReadingRuntime({
        pagePaneEl,
        runtime: {
          sendMessage: vi.fn(() => readPromise),
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
        now: () => nowMs,
        hasHostPermission: vi.fn(async () => true),
      });

      const pendingRead = runtime.requestReadCurrentPage("sidepanel");
      await flushMicrotasks();

      const loadingCard = pagePaneEl.querySelector(".page-reader-card.is-loading-target");
      expect(loadingCard).not.toBeNull();
      expect(pagePaneEl.querySelector(".page-reader-status")).toBeNull();
      expect(loadingCard?.querySelector(".page-reader-title-block h2")?.textContent).toBe("Runtime Fixture");
      expect(loadingCard?.querySelector(".page-reader-card-meta")?.textContent).toContain("example.test");
      expect(loadingCard?.querySelector(".page-reader-card-loading-status")?.textContent).toBe("讀取中");
      expect(loadingCard?.querySelector("#pageReadCurrent")).toBeNull();
      expect(loadingCard?.textContent).not.toContain("讀取此頁");
      expect(loadingCard?.querySelector(".page-reader-loading-context")?.getAttribute("aria-disabled")).toBe("true");
      expect(loadingCard?.querySelector(".page-reader-loading-analysis h3")?.textContent).toBe("閱讀脈絡");
      expect(loadingCard?.querySelector(".page-reader-analysis-loading")?.textContent).toBe("整理中…");
      expect(loadingCard?.querySelectorAll(".page-reader-loading-reserve span")).toHaveLength(2);

      nowMs = 3_500;
      const statusNode = pagePaneEl.querySelector(".page-reader-card-loading-status");
      vi.advanceTimersByTime(2_500);
      await flushMicrotasks();

      expect(pagePaneEl.querySelector(".page-reader-card-loading-status")?.textContent).toBe("讀取中 · 2.5 秒");
      expect(pagePaneEl.querySelector(".page-reader-card-loading-status")).toBe(statusNode);

      resolveRead?.({
        type: "PAGE_READING_RESULT",
        tabId: 42,
        surface: surface(),
        elapsedMs: 2_500,
      } satisfies TrulyMessage);
      await pendingRead;

      expect(pagePaneEl.querySelector(".page-reader-card")).not.toBeNull();
      expect(pagePaneEl.querySelector(".page-reader-card-header")).not.toBeNull();
      expect(pagePaneEl.querySelector(".page-reader-loading-context")).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not pull the user back to Web when a pending page read finishes in Focus", async () => {
    const pagePaneEl = setupDom();
    let resolveRead: ((message: TrulyMessage) => void) | undefined;
    const readPromise = new Promise<TrulyMessage>((resolve) => {
      resolveRead = resolve;
    });
    const runtime = createSidepanelPageReadingRuntime({
      pagePaneEl,
      runtime: { sendMessage: vi.fn(() => readPromise) },
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

    const pendingRead = runtime.requestReadCurrentPage("sidepanel");
    await flushMicrotasks();
    runtime.setWorkspace("focus");
    expect(pagePaneEl.querySelector(".page-reader-focus-panel")).not.toBeNull();

    resolveRead?.({
      type: "PAGE_READING_RESULT",
      tabId: 42,
      surface: surface(),
    } satisfies TrulyMessage);
    await pendingRead;

    expect(pagePaneEl.querySelector(".page-reader-focus-panel")).not.toBeNull();
    expect(pagePaneEl.querySelector(".page-reader-card")).toBeNull();
  });

  it("keeps Focus available on Facebook and analyzes only an explicit selection", async () => {
    const pagePaneEl = setupDom();
    const selectedText = [
      "This explicitly selected Facebook passage is long enough for the Focus analysis contract.",
      "Only this passage and its immediate context should become the temporary reading surface.",
    ].join(" ");
    const activateTab = vi.fn();
    const setTabAvailability = vi.fn();
    let lang: "en" | "zh-TW" = "en";
    const sendMessage = vi.fn(async (message: TrulyMessage) => {
      if (message.type === "READING_TARGET_REQUEST") {
        expect(message.surfaceId).toBeUndefined();
        return {
          type: "READING_TARGET_RESULT",
          tabId: 42,
          target: {
            id: "target:selection:facebook",
            surfaceId: "general:https://www.facebook.com/selection",
            kind: "selection",
            text: selectedText,
            surroundingText: "Synthetic Facebook context around the explicit selection.",
            extraction: {
              method: "selection",
              status: "complete",
              warnings: [],
            },
          },
        } satisfies TrulyMessage;
      }
      throw new Error(`unexpected message ${(message as { type: string }).type}`);
    });
    const runtime = createSidepanelPageReadingRuntime({
      pagePaneEl,
      runtime: { sendMessage },
      tabs: {
        query: vi.fn(async () => [{
          id: 42,
          url: "https://www.facebook.com/",
          title: "Facebook",
        }]),
      },
      activateTab,
      setTabAvailability,
      getLang: () => lang,
      now: () => 1_000,
    });

    runtime.install();
    await flushMicrotasks();
    expect(setTabAvailability).toHaveBeenCalledWith(
      "page",
      false,
      "Facebook content is available in the Feed tab.",
    );
    lang = "zh-TW";
    runtime.refresh();
    runtime.setWorkspace("focus");

    const useSelection = pagePaneEl.querySelector<HTMLButtonElement>("#pageReadSelection");
    expect(useSelection?.disabled).toBe(false);
    expect(setTabAvailability).toHaveBeenCalledWith(
      "page",
      false,
      "Facebook 內容請在「Feed」分頁查看。",
    );
    expect(pagePaneEl.textContent).toContain("先在頁面選取一段文字");
    expect(pagePaneEl.textContent).not.toContain("Facebook 內容會顯示在");

    useSelection?.click();
    await flushMicrotasks();
    await flushMicrotasks();

    expect(sendMessage).toHaveBeenCalledWith(expect.objectContaining({
      type: "READING_TARGET_REQUEST",
      tabId: 42,
      trigger: "selection",
      activation: {
        source: "sidepanel",
        targetKind: "selection",
        action: "read",
      },
    }));
    expect(pagePaneEl.querySelector(".page-reader-focus-title")?.textContent).toBe("分析範圍");
    expect(pagePaneEl.querySelector(".page-reader-focus-meta")?.textContent).toContain("選取文字");
    expect(pagePaneEl.querySelector(".page-reader-focus-preview")?.textContent).toContain("This explicitly selected Facebook passage");
    expect(pagePaneEl.querySelector<HTMLDetailsElement>(".page-reader-focus-text")?.open).toBe(false);
    expect(pagePaneEl.querySelector(".page-reader-context-details")).toBeNull();
    expect(pagePaneEl.textContent).toContain(selectedText);
    expect(pagePaneEl.textContent).not.toContain("目前使用你指定的文字或區域");
  });

  it("makes Web the primary surface on general pages without disabling Focus", async () => {
    const pagePaneEl = setupDom();
    const activateTab = vi.fn();
    const setTabAvailability = vi.fn((tab: TabId, available: boolean) => (
      tab === "analysis" && !available
    ));
    const runtime = createSidepanelPageReadingRuntime({
      pagePaneEl,
      runtime: { sendMessage: vi.fn() },
      tabs: {
        query: vi.fn(async () => [{
          id: 42,
          url: "https://example.com/article",
          title: "Example article",
        }]),
      },
      activateTab,
      setTabAvailability,
      getLang: () => "zh-TW",
      now: () => 1_000,
    });

    runtime.install();
    await flushMicrotasks();

    expect(setTabAvailability).toHaveBeenCalledWith("page", true);
    expect(setTabAvailability).toHaveBeenCalledWith("focus", true);
    expect(setTabAvailability).toHaveBeenCalledWith(
      "analysis",
      false,
      "Feed 僅適用於支援的 Facebook 頁面。",
    );
    expect(activateTab).toHaveBeenCalledWith("page");
  });

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
    expect(pagePaneEl.textContent).toContain("設定允許 Web 的所有網站存取權");
    expect(pagePaneEl.querySelector(".page-reader-status-detail")?.textContent).toContain("請先在目標網頁上點 Truly 工具列圖示");
    expect(pagePaneEl.querySelector(".page-reader-status-detail")?.textContent).not.toContain("請重新讀取");
    expect(pagePaneEl.querySelector(".page-reader-error")).toBeNull();
  });

  it("shows the Truly settings page as unsupported instead of a read failure", async () => {
    const pagePaneEl = setupDom();
    Object.defineProperty(globalThis, "chrome", {
      configurable: true,
      value: { runtime: { id: "truly-test" } },
    });
    try {
      const runtime = createSidepanelPageReadingRuntime({
        pagePaneEl,
        runtime: { sendMessage: vi.fn() },
        tabs: {
          query: vi.fn(async () => [{
            id: 77,
            url: "chrome-extension://truly-test/options/options.html",
            title: "Truly 設定",
          }]),
        },
        activateTab: vi.fn(),
        getLang: () => "zh-TW",
        now: () => 1_000,
      });

      runtime.install();
      await flushMicrotasks();
      runtime.handlePageReadingError({
        type: "PAGE_READING_ERROR",
        tabId: 77,
        error: "page_grant_missing",
        elapsedMs: 1,
      });

      expect(pagePaneEl.querySelector(".page-reader-status-label")?.textContent).toBe("不支援此頁");
      expect(pagePaneEl.textContent).toContain("這是 Truly 的設定或內部頁面");
      expect(pagePaneEl.textContent).not.toContain("讀取失敗");
      expect(pagePaneEl.textContent).not.toContain("請先在目標網頁上點 Truly 工具列圖示");
      expect(readCurrentButton(pagePaneEl)).toBeNull();
    } finally {
      Reflect.deleteProperty(globalThis, "chrome");
    }
  });

  it("uses the session-only Truly settings marker when Chrome hides extension page URLs", async () => {
    const pagePaneEl = setupDom();
    const sessionStore = {
      get: vi.fn(async () => ({
        trulyActiveExtensionPage: {
          kind: "options",
          tabId: 77,
          title: "Truly 設定",
          url: "chrome-extension://truly-test/options/options.html",
          ts: 900,
          buildId: "test-build",
        },
      })),
      remove: vi.fn(async () => undefined),
    };
    const runtime = createSidepanelPageReadingRuntime({
      pagePaneEl,
      runtime: { sendMessage: vi.fn() },
      tabs: {
        query: vi.fn(async () => [{ id: 77 }]),
      },
      activateTab: vi.fn(),
      getLang: () => "zh-TW",
      now: () => 1_000,
      sessionStore,
    });

    runtime.install();
    await flushMicrotasks();
    await flushMicrotasks();

    expect(sessionStore.get).toHaveBeenCalledWith("trulyActiveExtensionPage");
    expect(pagePaneEl.querySelector(".page-reader-status-label")?.textContent).toBe("不支援此頁");
    expect(pagePaneEl.textContent).toContain("這是 Truly 的設定或內部頁面");
    expect(pagePaneEl.textContent).not.toContain("請先在目標網頁上點 Truly 工具列圖示");
    expect(readCurrentButton(pagePaneEl)).toBeNull();
  });

  it("refreshes unsupported-page guidance when the Truly page marker arrives late", async () => {
    const pagePaneEl = setupDom();
    let storageListener: ((changes: Record<string, { newValue?: unknown }>, areaName: string) => void) | undefined;
    let marker: Record<string, unknown> = {};
    const sessionStore = {
      get: vi.fn(async () => marker),
      remove: vi.fn(async () => undefined),
      onChanged: {
        addListener: vi.fn((listener) => {
          storageListener = listener;
        }),
      },
    };
    const runtime = createSidepanelPageReadingRuntime({
      pagePaneEl,
      runtime: { sendMessage: vi.fn() },
      tabs: {
        query: vi.fn(async () => [{ id: 77 }]),
      },
      activateTab: vi.fn(),
      getLang: () => "zh-TW",
      now: () => 1_000,
      sessionStore,
    });

    runtime.install();
    await flushMicrotasks();
    expect(pagePaneEl.textContent).toContain("Chrome 沒有提供目前分頁網址");

    marker = {
      trulyActiveExtensionPage: {
        kind: "options",
        tabId: 77,
        title: "Truly 設定",
        url: "chrome-extension://truly-test/options/options.html",
        ts: 1_000,
        buildId: "test-build",
      },
    };
    storageListener?.({
      trulyActiveExtensionPage: {
        newValue: marker.trulyActiveExtensionPage,
      },
    }, "session");
    await flushMicrotasks();
    await flushMicrotasks();

    expect(pagePaneEl.textContent).toContain("這是 Truly 的設定或內部頁面");
    expect(pagePaneEl.textContent).not.toContain("Chrome 沒有提供目前分頁網址");
  });

  it("does not reuse the previous page URL when Chrome hides the newly active tab URL", async () => {
    const pagePaneEl = setupDom();
    let activatedListener: ((activeInfo: { tabId: number; windowId: number }) => void) | undefined;
    const runtime = createSidepanelPageReadingRuntime({
      pagePaneEl,
      runtime: { sendMessage: vi.fn() },
      tabs: {
        query: vi.fn(async () => [{
          id: 42,
          url: "https://news.example.test/story",
          title: "Synthetic News",
        }]),
        get: vi.fn(async (tabId: number) => tabId === 77 ? { id: 77 } : undefined),
        onActivated: {
          addListener: vi.fn((listener) => {
            activatedListener = listener;
          }),
        },
      },
      activateTab: vi.fn(),
      getLang: () => "zh-TW",
      now: () => 1_000,
    });

    runtime.install();
    await flushMicrotasks();
    runtime.handlePageReadingResult({
      type: "PAGE_READING_RESULT",
      tabId: 42,
      surface: surface({
        url: "https://news.example.test/story",
        canonicalUrl: "https://news.example.test/story",
        title: "Synthetic News",
      }),
      elapsedMs: 500,
    });

    expect(pagePaneEl.textContent).toContain("Synthetic News");

    activatedListener?.({ tabId: 77, windowId: 1 });
    await flushMicrotasks();

    expect(pagePaneEl.querySelector(".page-reader-status-label")?.textContent).toBe("不支援此頁");
    expect(pagePaneEl.textContent).toContain("Chrome 沒有提供目前分頁網址");
    expect(pagePaneEl.textContent).toContain("請先點 Truly 工具列圖示");
    expect(pagePaneEl.textContent).not.toContain("讀取失敗");
    expect(pagePaneEl.textContent).not.toContain("Synthetic News");
    expect(pagePaneEl.textContent).not.toContain("news.example.test");
    expect(readCurrentButton(pagePaneEl)).toBeNull();
  });

  it("maps page-access errors to a friendly retry explanation", async () => {
    const pagePaneEl = setupDom();
    const sendMessage = vi.fn(async () => ({
      type: "PAGE_READING_ERROR",
      tabId: 42,
      error: "page_grant_missing",
      elapsedMs: 4_200,
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
    expect(pagePaneEl.querySelector(".page-reader-status-label")?.textContent).toContain("讀取失敗 · 4.2 秒");
    expect(pagePaneEl.querySelector(".page-reader-status")?.getAttribute("title")).toContain("耗時 4.2 秒");
    expect(pagePaneEl.textContent).toContain("請先在目標網頁上點 Truly 工具列圖示");
    expect(pagePaneEl.textContent).toContain("設定允許 Web 的所有網站存取權");
    expect(pagePaneEl.querySelector(".page-reader-status-detail")?.textContent).toContain("請先在目標網頁上點 Truly 工具列圖示");
    expect(pagePaneEl.querySelector(".page-reader-status-detail")?.textContent).not.toContain("請重新讀取");
    expect(pagePaneEl.querySelector(".page-reader-error")).toBeNull();
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
          elapsedMs: 1_800,
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

    expect(pagePaneEl.querySelector(".page-reader-status")).toBeNull();
    expect(pagePaneEl.querySelector(".page-reader-card-meta")?.textContent).toContain("上次讀取");
    expect(pagePaneEl.querySelector(".page-reader-card-meta")?.textContent).not.toContain("已擷取");
    expect(pagePaneEl.querySelector(".page-reader-card-meta")?.getAttribute("title")).toContain("讀取耗時 1.8 秒");
    expect(pagePaneEl.textContent).toContain("Runtime Fixture");
    expect(pagePaneEl.textContent).toContain("Runtime fixture excerpt.");
    expect(pagePaneEl.textContent).not.toContain("頁面狀態");
    expect(pagePaneEl.querySelector(".page-reader-context-summary")).toBeNull();
    expect(pagePaneEl.querySelector(".page-reader-context-indicator")).toBeNull();
    expect(pagePaneEl.textContent).toContain("相關連結");
    expect(pagePaneEl.textContent).toContain("example.test");
    expect(pagePaneEl.textContent).toContain("Synthetic source");
    expect(pagePaneEl.textContent).toContain("技術細節");
    expect(pagePaneEl.textContent).toContain("擷取文字");
    expect(pagePaneEl.textContent).toContain("擷取連結");
    expect(pagePaneEl.textContent).toContain("擷取圖片");
    expect(pagePaneEl.querySelector<HTMLDetailsElement>(".page-reader-technical-details")?.open).toBe(false);
    expect(pagePaneEl.querySelector(".page-reader-preview-details")).toBeNull();
  });

  it("shows one extended preview inside Page context without a nested disclosure", async () => {
    const pagePaneEl = setupDom();
    const longExcerpt = Array.from({ length: 20 }, (_, index) => `Synthetic preview sentence ${index + 1}.`).join(" ");
    const runtime = createSidepanelPageReadingRuntime({
      pagePaneEl,
      runtime: {
        sendMessage: vi.fn(async () => ({
          type: "PAGE_READING_RESULT",
          tabId: 42,
          surface: surface({
            excerpt: longExcerpt,
            links: [
              { href: "https://example.test/related", text: "Local evidence report" },
              { href: "https://source.example/report", text: "▪ Original report" },
            ],
          }),
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

    const excerpts = pagePaneEl.querySelectorAll(".page-reader-context-details .page-reader-excerpt");
    expect(excerpts).toHaveLength(1);
    expect(excerpts[0]?.textContent).toBe(longExcerpt);
    expect(pagePaneEl.querySelector<HTMLDetailsElement>(".page-reader-page-text")?.open).toBe(false);
    expect(pagePaneEl.querySelector(".page-reader-page-text > summary")?.textContent).toBe("頁面文字");
    expect(pagePaneEl.querySelector(".page-reader-preview-details")).toBeNull();
    expect(pagePaneEl.textContent).not.toContain("展開預覽");
    expect(Array.from(pagePaneEl.querySelectorAll(".page-reader-source-links h3")).map((node) => node.textContent))
      .toEqual(["外部來源", "相關連結"]);
    expect(pagePaneEl.querySelector<HTMLAnchorElement>('a[aria-label="Original report (source.example)"]')).not.toBeNull();
    expect(pagePaneEl.querySelector<HTMLAnchorElement>('a[aria-label="Local evidence report (example.test)"]')).not.toBeNull();
  });

  it("labels images as parser captures and discloses the collection limit", async () => {
    const pagePaneEl = setupDom();
    const runtime = createSidepanelPageReadingRuntime({
      pagePaneEl,
      runtime: {
        sendMessage: vi.fn(async () => ({
          type: "PAGE_READING_RESULT",
          tabId: 42,
          surface: surface({
            images: Array.from({ length: 12 }, (_, index) => ({
              src: `https://example.test/image-${index + 1}.jpg`,
              alt: `Synthetic image ${index + 1}`,
            })),
            extraction: {
              method: "fallback",
              status: "partial",
              warnings: ["large-navigation-noise"],
            },
          }),
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

    const imageRow = Array.from(pagePaneEl.querySelectorAll(".page-reader-technical-details dl div"))
      .find((row) => row.querySelector("dt")?.textContent === "擷取圖片");
    expect(imageRow?.querySelector("dd")?.textContent).toBe("12（已達上限）");
    expect(pagePaneEl.textContent).toContain("可用圖片文字");
  });

  it("formats very fast page reads as less than 0.1 seconds in the hover title", async () => {
    const pagePaneEl = setupDom();
    const runtime = createSidepanelPageReadingRuntime({
      pagePaneEl,
      runtime: {
        sendMessage: vi.fn(async () => ({
          type: "PAGE_READING_RESULT",
          tabId: 42,
          surface: surface(),
          elapsedMs: 1,
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

    const title = pagePaneEl.querySelector(".page-reader-card-meta")?.getAttribute("title") || "";
    expect(pagePaneEl.querySelector(".page-reader-card-meta")?.textContent).toContain("上次讀取");
    expect(title).toContain("讀取耗時 少於 0.1 秒");
    expect(title).not.toContain("讀取耗時 0 秒");
  });

  it("keeps reread busy through extraction and Reading Context analysis", async () => {
    const pagePaneEl = setupDom();
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(globalThis.navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    let pageReadCount = 0;
    let analysisCount = 0;
    let resolveReread: ((message: TrulyMessage) => void) | undefined;
    let resolveRereadAnalysis: ((message: TrulyMessage) => void) | undefined;
    const rereadResponse = new Promise<TrulyMessage>((resolve) => {
      resolveReread = resolve;
    });
    const rereadAnalysisResponse = new Promise<TrulyMessage>((resolve) => {
      resolveRereadAnalysis = resolve;
    });
    const sendMessage = vi.fn((message: TrulyMessage) => {
      if (message.type === "PAGE_READING_REQUEST") {
        pageReadCount += 1;
        if (pageReadCount > 1) return rereadResponse;
        return Promise.resolve({
          type: "PAGE_READING_RESULT",
          requestId: message.requestId,
          tabId: 42,
          surface: surface(),
          elapsedMs: 200,
        } satisfies TrulyMessage);
      }
      if (message.type === "GENERAL_PAGE_ANALYSIS_REQUEST") {
        analysisCount += 1;
        if (analysisCount > 1) return rereadAnalysisResponse;
        return Promise.resolve({
          type: "GENERAL_PAGE_ANALYSIS_RESULT",
          tabId: 42,
          ok: true,
          brief: { schemaVersion: 1, summary: "Initial reading context.", model: "brief-model" },
        } satisfies TrulyMessage);
      }
      throw new Error(`unexpected message ${(message as { type: string }).type}`);
    });
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
      getSettings: () => ({
        ...DEFAULT_SETTINGS,
        deepClassifyEnabled: true,
        tierBProvider: "openai-compatible",
        tierBEndpoint: "http://127.0.0.1:4999/v1/chat/completions",
        tierBModel: "brief-model",
      }),
      now: () => 1_000,
      hasHostPermission: vi.fn(async () => true),
    });

    await runtime.requestReadCurrentPage("sidepanel");
    await flushMicrotasks();
    await flushMicrotasks();
    expect(readCurrentButton(pagePaneEl)?.getAttribute("aria-label")).toBe("重新讀取此頁");

    const pendingReread = runtime.requestReadCurrentPage("sidepanel");
    await flushMicrotasks();
    expect(pagePaneEl.querySelector(".page-reader-card.is-loading-target")).toBeNull();
    expect(pagePaneEl.textContent).toContain("Initial reading context.");
    expect(readCurrentButton(pagePaneEl)?.getAttribute("aria-label")).toBe("正在更新此頁");
    expect(readCurrentButton(pagePaneEl)?.getAttribute("aria-busy")).toBe("true");
    expect(readCurrentButton(pagePaneEl)?.getAttribute("aria-disabled")).toBe("true");
    readCurrentButton(pagePaneEl)?.focus();
    expect(pagePaneEl.ownerDocument.activeElement?.id).toBe("pageReadCurrent");
    pagePaneEl.querySelector<HTMLButtonElement>("#pageCopyMetadata")?.click();
    await flushMicrotasks();
    expect(writeText).toHaveBeenCalledWith(expect.stringContaining("Initial reading context."));

    resolveReread?.({
      type: "PAGE_READING_RESULT",
      tabId: 42,
      surface: surface(),
      elapsedMs: 200,
    } satisfies TrulyMessage);
    await pendingReread;
    await flushMicrotasks();
    expect(pagePaneEl.querySelector(".page-reader-analysis.is-running")).toBeNull();
    expect(pagePaneEl.textContent).toContain("Initial reading context.");
    expect(pagePaneEl.textContent).not.toContain("Updated reading context.");
    expect(readCurrentButton(pagePaneEl)?.getAttribute("aria-label")).toBe("正在更新此頁");
    expect(readCurrentButton(pagePaneEl)?.classList.contains("is-reread-busy")).toBe(true);
    expect(readCurrentButton(pagePaneEl)?.classList.contains("is-read-success")).toBe(false);
    expect(pagePaneEl.ownerDocument.activeElement?.id).toBe("pageReadCurrent");

    resolveRereadAnalysis?.({
      type: "GENERAL_PAGE_ANALYSIS_RESULT",
      tabId: 42,
      ok: true,
      brief: { schemaVersion: 1, summary: "Updated reading context.", model: "brief-model" },
    } satisfies TrulyMessage);
    await flushMicrotasks();
    await flushMicrotasks();
    expect(readCurrentButton(pagePaneEl)?.getAttribute("aria-label")).toBe("重新讀取此頁");
    expect(readCurrentButton(pagePaneEl)?.hasAttribute("aria-busy")).toBe(false);
    expect(readCurrentButton(pagePaneEl)?.hasAttribute("aria-disabled")).toBe(false);
    expect(pagePaneEl.textContent).toContain("Updated reading context.");
  });

  it("keeps the last successful result when reread extraction fails", async () => {
    const pagePaneEl = setupDom();
    let pageReadCount = 0;
    const sendMessage = vi.fn(async (message: TrulyMessage) => {
      if (message.type === "PAGE_READING_REQUEST") {
        pageReadCount += 1;
        if (pageReadCount > 1) {
          return {
            type: "PAGE_READING_ERROR",
            requestId: message.requestId,
            tabId: 42,
            error: "synthetic_reread_failure",
          } satisfies TrulyMessage;
        }
        return {
          type: "PAGE_READING_RESULT",
          requestId: message.requestId,
          tabId: 42,
          surface: surface(),
        } satisfies TrulyMessage;
      }
      if (message.type === "GENERAL_PAGE_ANALYSIS_REQUEST") {
        return {
          type: "GENERAL_PAGE_ANALYSIS_RESULT",
          tabId: 42,
          ok: true,
          brief: { schemaVersion: 1, summary: "Last successful context.", model: "brief-model" },
        } satisfies TrulyMessage;
      }
      throw new Error(`unexpected message ${(message as { type: string }).type}`);
    });
    const runtime = createSidepanelPageReadingRuntime({
      pagePaneEl,
      runtime: { sendMessage },
      tabs: { query: vi.fn(async () => [{ id: 42, url: "https://example.test/article", title: "Runtime Fixture" }]) },
      activateTab: vi.fn(),
      getLang: () => "zh-TW",
      getSettings: () => ({
        ...DEFAULT_SETTINGS,
        deepClassifyEnabled: true,
        tierBProvider: "openai-compatible",
        tierBEndpoint: "http://127.0.0.1:4999/v1/chat/completions",
        tierBModel: "brief-model",
      }),
      now: () => 1_000,
      hasHostPermission: vi.fn(async () => true),
    });

    await runtime.requestReadCurrentPage("sidepanel");
    await flushMicrotasks();
    expect(pagePaneEl.textContent).toContain("Last successful context.");

    await runtime.requestReadCurrentPage("sidepanel");
    await flushMicrotasks();

    expect(pagePaneEl.textContent).toContain("Last successful context.");
    expect(pagePaneEl.textContent).toContain("更新失敗，仍顯示上次結果。");
    expect(pagePaneEl.textContent).not.toContain("synthetic_reread_failure");
    expect(readCurrentButton(pagePaneEl)?.getAttribute("aria-label")).toBe("重新讀取此頁");
  });

  it("keeps the last successful result when reread analysis fails", async () => {
    const pagePaneEl = setupDom();
    let pageReadCount = 0;
    let analysisCount = 0;
    const sendMessage = vi.fn(async (message: TrulyMessage) => {
      if (message.type === "PAGE_READING_REQUEST") {
        pageReadCount += 1;
        return {
          type: "PAGE_READING_RESULT",
          requestId: message.requestId,
          tabId: 42,
          surface: surface(pageReadCount > 1 ? { title: "Uncommitted replacement" } : {}),
        } satisfies TrulyMessage;
      }
      if (message.type === "GENERAL_PAGE_ANALYSIS_REQUEST") {
        analysisCount += 1;
        return analysisCount > 1
          ? {
              type: "GENERAL_PAGE_ANALYSIS_RESULT",
              tabId: 42,
              ok: false,
              error: "general_page_brief_timeout",
            } satisfies TrulyMessage
          : {
              type: "GENERAL_PAGE_ANALYSIS_RESULT",
              tabId: 42,
              ok: true,
              brief: { schemaVersion: 1, summary: "Stable previous context.", model: "brief-model" },
            } satisfies TrulyMessage;
      }
      throw new Error(`unexpected message ${(message as { type: string }).type}`);
    });
    const runtime = createSidepanelPageReadingRuntime({
      pagePaneEl,
      runtime: { sendMessage },
      tabs: { query: vi.fn(async () => [{ id: 42, url: "https://example.test/article", title: "Runtime Fixture" }]) },
      activateTab: vi.fn(),
      getLang: () => "zh-TW",
      getSettings: () => ({
        ...DEFAULT_SETTINGS,
        deepClassifyEnabled: true,
        tierBProvider: "openai-compatible",
        tierBEndpoint: "http://127.0.0.1:4999/v1/chat/completions",
        tierBModel: "brief-model",
      }),
      now: () => 1_000,
      hasHostPermission: vi.fn(async () => true),
    });

    await runtime.requestReadCurrentPage("sidepanel");
    await flushMicrotasks();
    await runtime.requestReadCurrentPage("sidepanel");
    await flushMicrotasks();

    expect(pagePaneEl.textContent).toContain("Stable previous context.");
    expect(pagePaneEl.textContent).not.toContain("Uncommitted replacement");
    expect(pagePaneEl.textContent).toContain("更新失敗，仍顯示上次結果。");
    expect(pagePaneEl.querySelector("#pageAnalysisRetry")).toBeNull();
  });

  it("publishes the refreshed surface when analysis is intentionally skipped", async () => {
    const pagePaneEl = setupDom();
    let pageReadCount = 0;
    const sendMessage = vi.fn(async (message: TrulyMessage) => {
      if (message.type !== "PAGE_READING_REQUEST") throw new Error(`unexpected message ${(message as { type: string }).type}`);
      pageReadCount += 1;
      return {
        type: "PAGE_READING_RESULT",
        requestId: message.requestId,
        tabId: 42,
        surface: surface({
          title: pageReadCount > 1 ? "Updated without model analysis" : "Initial without model analysis",
        }),
      } satisfies TrulyMessage;
    });
    const runtime = createSidepanelPageReadingRuntime({
      pagePaneEl,
      runtime: { sendMessage },
      tabs: { query: vi.fn(async () => [{ id: 42, url: "https://example.test/article", title: "Runtime Fixture" }]) },
      activateTab: vi.fn(),
      getLang: () => "zh-TW",
      now: () => 1_000,
      hasHostPermission: vi.fn(async () => true),
    });

    await runtime.requestReadCurrentPage("sidepanel");
    expect(pagePaneEl.textContent).toContain("Initial without model analysis");
    await runtime.requestReadCurrentPage("sidepanel");
    await flushMicrotasks();

    expect(pagePaneEl.textContent).toContain("Updated without model analysis");
    expect(pagePaneEl.textContent).not.toContain("Initial without model analysis");
    expect(readCurrentButton(pagePaneEl)?.hasAttribute("aria-busy")).toBe(false);
  });

  it("rejects a late reread result after meaningful navigation", async () => {
    const pagePaneEl = setupDom();
    let onUpdated: ((tabId: number, changeInfo: { url?: string; status?: string }, tab: { id: number; url: string; title: string }) => void) | undefined;
    let pageReadCount = 0;
    let resolveReread: ((message: TrulyMessage) => void) | undefined;
    let rereadRequestId = "";
    const pendingResponse = new Promise<TrulyMessage>((resolve) => {
      resolveReread = resolve;
    });
    const sendMessage = vi.fn((message: TrulyMessage) => {
      if (message.type !== "PAGE_READING_REQUEST") throw new Error(`unexpected message ${(message as { type: string }).type}`);
      pageReadCount += 1;
      if (pageReadCount > 1) {
        rereadRequestId = message.requestId;
        return pendingResponse;
      }
      return Promise.resolve({
        type: "PAGE_READING_RESULT",
        requestId: message.requestId,
        tabId: 42,
        surface: surface(),
      } satisfies TrulyMessage);
    });
    const runtime = createSidepanelPageReadingRuntime({
      pagePaneEl,
      runtime: { sendMessage },
      tabs: {
        query: vi.fn(async () => [{ id: 42, url: "https://example.test/article", title: "Runtime Fixture" }]),
        onUpdated: { addListener(listener) { onUpdated = listener; } },
      },
      activateTab: vi.fn(),
      getLang: () => "zh-TW",
      now: () => 1_000,
      hasHostPermission: vi.fn(async () => true),
    });

    runtime.install();
    await flushMicrotasks();
    await runtime.requestReadCurrentPage("sidepanel");
    const reread = runtime.requestReadCurrentPage("sidepanel");
    await flushMicrotasks();
    onUpdated?.(42, { url: "https://example.test/new-article" }, {
      id: 42,
      url: "https://example.test/new-article",
      title: "New Article",
    });
    resolveReread?.({
      type: "PAGE_READING_RESULT",
      requestId: rereadRequestId,
      tabId: 42,
      surface: surface({ title: "Late stale replacement" }),
    } satisfies TrulyMessage);
    await reread;
    await flushMicrotasks();

    expect(runtime.auditState().displayedSession?.status).toBe("stale");
    expect(pagePaneEl.textContent).not.toContain("Late stale replacement");
    expect(pagePaneEl.textContent).not.toContain("Runtime fixture excerpt.");
  });

  it("keeps saved page sessions internal without rendering a Web history switcher", async () => {
    const pagePaneEl = setupDom();
    let activeId = 42;
    let onActivated: ((activeInfo: { tabId: number; windowId: number }) => void) | undefined;
    const tabsById = new Map<number, { id: number; url: string; title: string; windowId: number }>([
      [42, { id: 42, url: "https://first.example.test/article", title: "First Article", windowId: 7 }],
      [43, { id: 43, url: "https://second.example.test/article", title: "Second Article", windowId: 7 }],
      [44, { id: 44, url: "https://third.example.test/article", title: "Third Article", windowId: 7 }],
    ]);
    const runtime = createSidepanelPageReadingRuntime({
      pagePaneEl,
      runtime: { sendMessage: vi.fn() },
      tabs: {
        query: vi.fn(async () => [tabsById.get(activeId)!]),
        get: vi.fn(async (tabId: number) => tabsById.get(tabId)!),
        update: vi.fn(async (tabId: number) => tabsById.get(tabId)!),
        focusWindow: vi.fn(async () => undefined),
        onActivated: {
          addListener(listener) {
            onActivated = listener;
          },
        },
      },
      activateTab: vi.fn(),
      getLang: () => "zh-TW",
      now: () => 1_000,
    });

    runtime.install();
    await flushMicrotasks();
    runtime.handlePageReadingResult({
      type: "PAGE_READING_RESULT",
      tabId: 42,
      surface: surface({
        id: "general:https://first.example.test/article",
        url: "https://first.example.test/article",
        canonicalUrl: "https://first.example.test/article",
        title: "First Article",
        excerpt: "First saved excerpt.",
      }),
    });

    activeId = 43;
    onActivated?.({ tabId: 43, windowId: 7 });
    await flushMicrotasks();
    runtime.handlePageReadingResult({
      type: "PAGE_READING_RESULT",
      tabId: 43,
      surface: surface({
        id: "general:https://second.example.test/article",
        url: "https://second.example.test/article",
        canonicalUrl: "https://second.example.test/article",
        title: "Second Article",
        excerpt: "Second saved excerpt.",
      }),
    });

    expect(pagePaneEl.textContent).toContain("Second saved excerpt.");
    expect(pagePaneEl.querySelector(".page-reader-switcher")).toBeNull();
    expect(pagePaneEl.querySelectorAll("[data-page-session-tab-id]")).toHaveLength(0);
    expect(pagePaneEl.textContent).not.toContain("First Article");

    activeId = 44;
    onActivated?.({ tabId: 44, windowId: 7 });
    await flushMicrotasks();
    runtime.handlePageReadingResult({
      type: "PAGE_READING_RESULT",
      tabId: 44,
      surface: surface({
        id: "general:https://third.example.test/article",
        url: "https://third.example.test/article",
        canonicalUrl: "https://third.example.test/article",
        title: "Third Article",
        excerpt: "Third saved excerpt.",
      }),
    });

    expect(pagePaneEl.textContent).toContain("Third saved excerpt.");
    expect(pagePaneEl.querySelector(".page-reader-switcher")).toBeNull();
    expect(pagePaneEl.querySelectorAll("[data-page-session-tab-id]")).toHaveLength(0);
    expect(pagePaneEl.textContent).not.toContain("Second Article");
    expect(pagePaneEl.textContent).not.toContain("First saved excerpt.");
    expect(runtime.auditState().activeTabId).toBe(44);
    runtime.setWorkspace("focus");
    expect(pagePaneEl.querySelector<HTMLButtonElement>("#pageReadSelection")?.disabled).toBe(false);
    expect(pagePaneEl.textContent).not.toContain("切到此分頁");

    runtime.handlePageReadingResult({
      type: "PAGE_READING_RESULT",
      tabId: 44,
      surface: surface({
        id: "general:https://third.example.test/article",
        url: "https://third.example.test/article",
        canonicalUrl: "https://third.example.test/article",
        title: "Third Article",
        excerpt: "Third late result excerpt.",
      }),
    });

    runtime.setWorkspace("page");
    expect(pagePaneEl.textContent).toContain("Third late result excerpt.");
    expect(pagePaneEl.textContent).not.toContain("First saved excerpt.");
    expect(runtime.auditState().activeTabId).toBe(44);
    runtime.setWorkspace("focus");
    expect(pagePaneEl.querySelector<HTMLButtonElement>("#pageReadSelection")?.disabled).toBe(false);
  });

  it("marks clean page readings as current reading context without an advisor request", async () => {
    const pagePaneEl = setupDom();
    const sendMessage = vi.fn(async () => ({
      type: "PAGE_READING_RESULT",
      tabId: 42,
      surface: surface(),
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
    await flushMicrotasks();

    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(pagePaneEl.textContent).not.toContain("頁面狀態");
    expect(pagePaneEl.textContent).toContain("使用目前內容");
    expect(diagnosticRawValue(pagePaneEl, /判斷/)).toBe("accept_current");
    expect(pagePaneEl.querySelector(".page-reader-context-summary")).toBeNull();
    expect(pagePaneEl.querySelector<HTMLDetailsElement>(".page-reader-technical-details")?.open).toBe(false);
  });

  it("auto-generates a session-only General Page brief when Tier B is available", async () => {
    const pagePaneEl = setupDom();
    const copiedTexts: string[] = [];
    Object.defineProperty(globalThis.navigator, "clipboard", {
      configurable: true,
      value: { writeText: vi.fn(async (text: string) => { copiedTexts.push(text); }) },
    });
    const savedMarkdown: string[] = [];
    const saveMarkdownFile = vi.fn(async (text: string) => {
      savedMarkdown.push(text);
      return "fallback-download" as const;
    });
    const sendMessage = vi.fn(async (message: TrulyMessage) => {
      if (message.type === "PAGE_READING_REQUEST") {
        return {
          type: "PAGE_READING_RESULT",
          tabId: 42,
          surface: surface(),
        } satisfies TrulyMessage;
      }
      if (message.type === "GENERAL_PAGE_ANALYSIS_REQUEST") {
        expect(message.allowedUse).toBe("article_or_selection_analysis");
        expect(message.context.targetKind).toBe("page");
        expect(message.context.mainText).toContain("Runtime fixture text long enough");
        return {
          type: "GENERAL_PAGE_ANALYSIS_RESULT",
          tabId: 42,
          ok: true,
          brief: {
            schemaVersion: 1,
            summary: "Synthetic model summary for the current page.",
            bg: [{ t: "Context", why: "The page is a synthetic runtime article." }],
            claims: [{ c: "Runtime claim", why: "It is central to the sample.", need: "Check the source.", q: "What primary source supports the runtime claim?" }],
            qs: [{ q: "What background helps explain the runtime claim?", kind: "context" }],
            note: "Synthetic content-specific caveat.",
            model: "brief-model",
            outputLang: "zh-TW",
            elapsedMs: 1200,
          },
        } satisfies TrulyMessage;
      }
      throw new Error(`unexpected message ${(message as { type: string }).type}`);
    });
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
      getSettings: () => ({
        ...DEFAULT_SETTINGS,
        deepClassifyEnabled: true,
        tierBProvider: "openai-compatible",
        tierBEndpoint: "http://127.0.0.1:4999/v1/chat/completions",
        tierBModel: "brief-model",
      }),
      now: () => 1_000,
      hasHostPermission: vi.fn(async () => true),
      saveMarkdownFile,
    });

    await runtime.requestReadCurrentPage("sidepanel");
    await flushMicrotasks();

    expect(sendMessage).toHaveBeenCalledWith(expect.objectContaining({
      type: "GENERAL_PAGE_ANALYSIS_REQUEST",
      tabId: 42,
      providerRuntime: expect.objectContaining({
        canUseModel: true,
        effectiveProvider: "openai-compatible",
        model: "brief-model",
      }),
    }));
    expect(pagePaneEl.textContent).toContain("閱讀脈絡");
    expect(pagePaneEl.textContent).toContain("Synthetic model summary for the current page.");
    expect(pagePaneEl.textContent).toContain("Runtime claim");
    // Standard briefs use one quiet footer for both model transparency and the
    // preview disclaimer instead of competing left/right notes.
    expect(pagePaneEl.textContent).toContain("brief-model 協助整理");
    expect(pagePaneEl.textContent).not.toContain("Analyzed by brief-model");
    const contentNote = pagePaneEl.querySelector(".page-reader-analysis-note");
    expect(contentNote?.textContent).toBe("Synthetic content-specific caveat.");
    const modelNote = pagePaneEl.querySelector(".page-reader-analysis .reading-brief-model-note");
    const questions = pagePaneEl.querySelector(".page-reader-analysis-questions");
    const closing = pagePaneEl.querySelector(".page-reader-analysis-closing");
    expect(questions?.nextElementSibling).toBe(closing);
    expect(closing?.querySelector(".page-reader-analysis-note")).toBe(contentNote);
    expect(closing?.querySelector(".page-reader-analysis-footer")).toBe(modelNote);
    expect(contentNote?.nextElementSibling).toBe(modelNote);
    expect(modelNote?.getAttribute("title")).toContain("1.2");
    expect(modelNote?.getAttribute("aria-label")).toContain("請以原文與你的思考為準");
    // Follow-up questions carry Feed-style per-question actions.
    expect(pagePaneEl.querySelector(".page-reader-analysis-questions .page-analysis-question-copy")).not.toBeNull();
    const askLink = pagePaneEl.querySelector<HTMLAnchorElement>(".page-reader-analysis-questions .reading-brief-google-link");
    expect(askLink?.href).toContain("google.com/search");
    expect(pagePaneEl.querySelector(".page-reader-analysis-header span")).toBeNull();
    expect(pagePaneEl.querySelectorAll(".page-reader-analysis-section.is-single")).toHaveLength(2);
    const startCheck = pagePaneEl.querySelector<HTMLButtonElement>(".page-claim-start");
    expect(startCheck?.textContent).toBe("開始查核");
    expect(pagePaneEl.querySelector(".page-claim-investigation")).toBeNull();
    expect(pagePaneEl.querySelector(".page-claim-action")).toBeNull();
    startCheck?.click();
    expect(pagePaneEl.querySelector(".page-claim-investigation")?.textContent).toContain("What primary source supports the runtime claim");
    const evidenceLink = pagePaneEl.querySelector<HTMLAnchorElement>(".page-claim-investigation-actions a");
    expect(evidenceLink?.textContent).toBe("搜尋證據");
    expect(evidenceLink?.href).toContain("google.com/search");
    expect(evidenceLink?.href).not.toContain("udm=50");
    expect(pagePaneEl.querySelectorAll(".page-claim-investigation-actions a")).toHaveLength(3);
    pagePaneEl.querySelector<HTMLButtonElement>(".page-claim-copy-question")?.click();
    await flushMicrotasks();
    expect(copiedTexts.at(-1)).toBe("What primary source supports the runtime claim");
    const questionList = pagePaneEl.querySelector(".page-reader-analysis-questions .reading-brief-question-list");
    expect(questionList?.tagName).toBe("UL");
    expect(questionList?.querySelectorAll(":scope > .reading-brief-question-row")).toHaveLength(1);
    expect(questionList?.querySelector(":scope > .reading-brief-question-row")?.tagName).toBe("LI");
    expect(pagePaneEl.querySelector(".page-reader-card > .page-reader-excerpt")).toBeNull();
    expect(pagePaneEl.querySelector(".page-reader-context-details .page-reader-excerpt")).not.toBeNull();
    expect(pagePaneEl.querySelector<HTMLDetailsElement>(".page-reader-context-details")?.open).toBe(false);
    expect(pagePaneEl.querySelector(".page-reader-context-indicator")).toBeNull();
    expect(pagePaneEl.querySelector(".page-reader-card-header #pageCopyMetadata")).toBeNull();
    expect(pagePaneEl.querySelector(".page-reader-context-details .page-reader-source-links")).not.toBeNull();
    expect(pagePaneEl.querySelector(".page-reader-analysis-header h3")?.textContent).toBe("閱讀脈絡");
    const externalTools = pagePaneEl.querySelector(".page-reader-external-tools");
    expect(externalTools?.querySelector(".page-reader-external-tools-label")?.textContent).toBe("外部工具整合");
    expect(externalTools?.querySelector(".page-reader-external-tools-hint")?.textContent)
      .toBe("複製或下載 Markdown，接到 AI 工具、OpenClaw 或筆記。");
    expect(pagePaneEl.querySelector(".page-reader-card-tools #pageCopyMetadata")).not.toBeNull();
    expect(pagePaneEl.querySelector(".page-reader-card-tools #pageDownloadMarkdown")).not.toBeNull();
    pagePaneEl.querySelector<HTMLButtonElement>("#pageCopyMetadata")?.click();
    await flushMicrotasks();
    expect(copiedTexts.at(-1)).toContain("閱讀脈絡\nSynthetic model summary for the current page.");
    expect(copiedTexts.at(-1)).toContain("待確認事項");
    expect(copiedTexts.at(-1)).not.toContain("Runtime fixture excerpt.");
    expect(copiedTexts.at(-1)).not.toContain("Extraction:");
    pagePaneEl.querySelector<HTMLButtonElement>("#pageDownloadMarkdown")?.click();
    await flushMicrotasks();
    expect(savedMarkdown.at(-1)).toContain("# Runtime Fixture");
    expect(savedMarkdown.at(-1)).toContain("## 頁面文字");
    expect(savedMarkdown.at(-1)).toContain("Runtime fixture excerpt.");
    expect(savedMarkdown.at(-1)).toContain("## 來源連結");
    expect(saveMarkdownFile).toHaveBeenCalledWith(
      expect.stringContaining("Synthetic model summary for the current page."),
      expect.stringMatching(/^truly-page-.*\.md$/),
      "text/markdown;charset=utf-8",
      expect.objectContaining({ mode: DEFAULT_SETTINGS.markdownDownloadMode }),
    );
    expect(pagePaneEl.textContent).not.toContain("技術細節");
    expect(pagePaneEl.querySelector(".page-reader-status")).toBeNull();
    expect(pagePaneEl.querySelector(".page-reader-command-bar")).toBeNull();
    expect(pagePaneEl.querySelector(".page-reader-header")).toBeNull();
    expect(pagePaneEl.textContent).not.toContain("分析準備");
    expect(pagePaneEl.textContent).not.toContain("分析範圍");
    expect(pagePaneEl.querySelector(".page-reader-model-context")).toBeNull();
    expect(pagePaneEl.querySelector(".page-reader-advisor")).toBeNull();
    expect(pagePaneEl.querySelector(".page-reader-technical-details")).toBeNull();
  });

  it("keeps raw page preview and status folded while a General Page brief is running", async () => {
    const pagePaneEl = setupDom();
    const sendMessage = vi.fn((message: TrulyMessage) => {
      if (message.type === "PAGE_READING_REQUEST") {
        return Promise.resolve({
          type: "PAGE_READING_RESULT",
          tabId: 42,
          surface: surface({
            excerpt: "Runtime fixture excerpt that should not flash as the primary body while the model is still running.",
          }),
        } satisfies TrulyMessage);
      }
      if (message.type === "GENERAL_PAGE_ANALYSIS_REQUEST") {
        return new Promise<TrulyMessage>(() => {
          /* Keep the brief in the running state for this UI regression. */
        });
      }
      throw new Error(`unexpected message ${(message as { type: string }).type}`);
    });
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
      getSettings: () => ({
        ...DEFAULT_SETTINGS,
        deepClassifyEnabled: true,
        tierBProvider: "openai-compatible",
        tierBEndpoint: "http://127.0.0.1:4999/v1/chat/completions",
        tierBModel: "brief-model",
      }),
      now: () => 1_000,
      hasHostPermission: vi.fn(async () => true),
    });

    await runtime.requestReadCurrentPage("sidepanel");
    await flushMicrotasks();

    expect(pagePaneEl.textContent).toContain("整理中…");
    expect(pagePaneEl.querySelector(".page-reader-card > .page-reader-analysis")).not.toBeNull();
    const loadingHeader = pagePaneEl.querySelector(".page-reader-card > .page-reader-analysis .page-reader-analysis-header");
    expect(loadingHeader?.textContent).toContain("閱讀脈絡");
    expect(loadingHeader?.querySelector(".page-reader-analysis-loading")?.textContent).toBe("整理中…");
    expect(pagePaneEl.querySelector(".page-reader-analysis.is-running")?.children).toHaveLength(1);
    expect(readCurrentButton(pagePaneEl)?.getAttribute("aria-label")).toBe("正在整理此頁");
    expect(readCurrentButton(pagePaneEl)?.getAttribute("aria-disabled")).toBe("true");
    expect(pagePaneEl.querySelector(".page-reader-external-tools")).toBeNull();
    expect(pagePaneEl.querySelector("#pageCopyMetadata, #pageDownloadMarkdown")).toBeNull();
    expect(pagePaneEl.querySelector(".page-reader-card > .page-reader-analysis-header")).toBeNull();
    // While a clean page's brief is running, the pane already uses the final
    // The extracted preview is available only inside the collapsed page-context
    // disclosure, while the reading-context loading state remains primary.
    expect(pagePaneEl.querySelector(".page-reader-card > .page-reader-excerpt")).toBeNull();
    expect(pagePaneEl.querySelector(".page-reader-context-details .page-reader-excerpt")).not.toBeNull();
    expect(pagePaneEl.querySelector(".page-reader-processing-status")).toBeNull();
    const supplemental = pagePaneEl.querySelector<HTMLDetailsElement>(".page-reader-supplemental-details");
    if (supplemental) expect(supplemental.open).toBe(false);
  });

  it("keeps advisor checking behind a neutral page-brief loading state", async () => {
    const pagePaneEl = setupDom();
    const weakSurface = surface({
      mainText: [
        "Navigation Search Login Subscribe and several unrelated synthetic cards.",
        "Synthetic card one contains only a short teaser and a link.",
        "Synthetic card two contains another unrelated teaser and a link.",
      ].join(" "),
      excerpt: "Raw advisor-checking excerpt that must not flash before scope is decided.",
      extraction: {
        method: "fallback",
        status: "partial",
        warnings: ["large-navigation-noise", "no-main-content"],
      },
      links: Array.from({ length: 18 }, (_, index) => ({
        href: `https://example.test/link-${index}`,
        text: `Link ${index}`,
      })),
    });
    const sendMessage = vi.fn((message: TrulyMessage) => {
      if (message.type === "PAGE_READING_REQUEST") {
        return Promise.resolve({
          type: "PAGE_READING_RESULT",
          tabId: 42,
          surface: weakSurface,
        } satisfies TrulyMessage);
      }
      if (message.type === "GENERAL_PAGE_PARSER_ADVISOR_REQUEST") {
        return new Promise<TrulyMessage>(() => {
          /* Keep scope classification pending for this transitional UI regression. */
        });
      }
      throw new Error(`unexpected message ${(message as { type: string }).type}`);
    });
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
      getSettings: () => ({
        ...DEFAULT_SETTINGS,
        deepClassifyEnabled: true,
        tierBProvider: "openai-compatible",
        tierBEndpoint: "http://127.0.0.1:4999/v1/chat/completions",
        tierBModel: "advisor-model",
      }),
      now: () => 1_000,
    });

    await runtime.requestReadCurrentPage("sidepanel");
    await flushMicrotasks();

    expect(sendMessage).toHaveBeenCalledWith(expect.objectContaining({
      type: "GENERAL_PAGE_PARSER_ADVISOR_REQUEST",
    }));
    expect(pagePaneEl.textContent).toContain("整理中…");
    expect(pagePaneEl.querySelector(".page-reader-analysis.is-running")).not.toBeNull();
    expect(pagePaneEl.querySelector(".page-reader-processing-status")).toBeNull();
    expect(pagePaneEl.querySelector(".page-reader-technical-details")).toBeNull();
    expect(pagePaneEl.querySelector(".page-reader-model-context")).toBeNull();
    expect(pagePaneEl.querySelector(".page-reader-advisor")).toBeNull();
    expect(pagePaneEl.querySelector(".page-reader-excerpt, .page-reader-preview")).toBeNull();
    expect(pagePaneEl.querySelector(".page-reader-supplemental-details")).toBeNull();
    expect(pagePaneEl.textContent).not.toContain("Raw advisor-checking excerpt");
  });

  it("renders General Page brief format failures as user-facing copy", async () => {
    const pagePaneEl = setupDom();
    const sendMessage = vi.fn(async (message: TrulyMessage) => {
      if (message.type === "PAGE_READING_REQUEST") {
        return {
          type: "PAGE_READING_RESULT",
          tabId: 42,
          surface: surface(),
        } satisfies TrulyMessage;
      }
      if (message.type === "GENERAL_PAGE_ANALYSIS_REQUEST") {
        return {
          type: "GENERAL_PAGE_ANALYSIS_RESULT",
          tabId: 42,
          ok: false,
          error: "general_page_brief_format_error",
        } satisfies TrulyMessage;
      }
      throw new Error(`unexpected message ${(message as { type: string }).type}`);
    });
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
      getSettings: () => ({
        ...DEFAULT_SETTINGS,
        deepClassifyEnabled: true,
        tierBProvider: "openai-compatible",
        tierBEndpoint: "http://127.0.0.1:4999/v1/chat/completions",
        tierBModel: "brief-model",
      }),
      now: () => 1_000,
    });

    await runtime.requestReadCurrentPage("sidepanel");
    await flushMicrotasks();

    expect(pagePaneEl.textContent).toContain("頁面重點暫時無法產生。");
    expect(pagePaneEl.textContent).not.toContain("general_page_brief_format_error");
    expect(pagePaneEl.querySelector("#pageAnalysisRetry")).not.toBeNull();
    expect(pagePaneEl.querySelector(".page-reader-external-tools")).toBeNull();
    expect(pagePaneEl.querySelector("#pageCopyMetadata, #pageDownloadMarkdown")).toBeNull();
  });

  it("does not auto-read a general page when all-sites access is unavailable", async () => {
    vi.useFakeTimers();
    try {
      const pagePaneEl = setupDom();
      const sendMessage = vi.fn();
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
        hasAllSitesPermission: vi.fn(async () => false),
      });

      runtime.install();
      await flushMicrotasks();
      vi.advanceTimersByTime(1_000);
      await flushMicrotasks();

      expect(sendMessage).not.toHaveBeenCalled();
      expect(pagePaneEl.textContent).toContain("允許讀取此網域");
      expect(pagePaneEl.textContent).toContain("Truly 尚未取得此網站的讀取權限");
      expect(pagePaneEl.querySelector(".page-reader-empty-state #pageAuthorizeDomain")).not.toBeNull();
      expect(pagePaneEl.querySelector(".page-reader-status")).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("requests domain authorization from the page card before reading without persistent access", async () => {
    const pagePaneEl = setupDom();
    const requestHostPermission = vi.fn(async () => true);
    const sendMessage = vi.fn(async (message: TrulyMessage) => {
      if (message.type === "PAGE_READING_REQUEST") {
        return {
          type: "PAGE_READING_RESULT",
          tabId: 42,
          surface: surface(),
        } satisfies TrulyMessage;
      }
      throw new Error(`unexpected message ${(message as { type: string }).type}`);
    });
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
      hasAllSitesPermission: vi.fn(async () => false),
      hasHostPermission: vi.fn(async () => false),
      requestHostPermission,
    });

    runtime.install();
    await flushMicrotasks();
    await flushMicrotasks();

    expect(pagePaneEl.textContent).toContain("允許讀取此網域");
    expect(pagePaneEl.querySelector(".page-reader-card-header #pageAuthorizeDomain")).toBeNull();
    expect(pagePaneEl.querySelector(".page-reader-empty-state #pageAuthorizeDomain")).not.toBeNull();
    pagePaneEl.querySelector<HTMLButtonElement>("#pageAuthorizeDomain")?.click();
    await flushMicrotasks();
    await flushMicrotasks();

    expect(requestHostPermission).toHaveBeenCalledWith("https://example.test/article");
    expect(sendMessage).toHaveBeenCalledWith(expect.objectContaining({
      type: "PAGE_READING_REQUEST",
      tabId: 42,
      inject: true,
    }));
    expect(pagePaneEl.textContent).toContain("Runtime fixture excerpt.");
    expect(pagePaneEl.querySelector(".page-reader-card-meta #pageReadCurrent")).not.toBeNull();
  });

  it("auto-reads the active general page when all-sites access is available", async () => {
    vi.useFakeTimers();
    try {
      const pagePaneEl = setupDom();
      const sendMessage = vi.fn(async (message: TrulyMessage) => {
        if (message.type === "PAGE_READING_REQUEST") {
          return {
            type: "PAGE_READING_RESULT",
            tabId: 42,
            surface: surface(),
          } satisfies TrulyMessage;
        }
        throw new Error(`unexpected message ${(message as { type: string }).type}`);
      });
      let runtime: ReturnType<typeof createSidepanelPageReadingRuntime>;
      const activateTab = vi.fn((tab: TabId) => {
        runtime?.setWorkspace(tab === "focus" ? "focus" : "page");
      });
      runtime = createSidepanelPageReadingRuntime({
        pagePaneEl,
        runtime: { sendMessage },
        tabs: {
          query: vi.fn(async () => [{
            id: 42,
            url: "https://example.test/article",
            title: "Runtime Fixture",
          }]),
        },
        activateTab,
        getLang: () => "zh-TW",
        now: () => 1_000,
        hasAllSitesPermission: vi.fn(async () => true),
      });

      runtime.install();
      await flushMicrotasks();

      // Once all-sites access is confirmed, the auto-read debounce should
      // already present a neutral loading state. Do not flash the manual
      // "not read" guidance while waiting for the page DOM to settle.
      expect(sendMessage).not.toHaveBeenCalled();
      expect(pagePaneEl.querySelector(".page-reader-card-loading-status")?.textContent).toBe("讀取中");
      expect(pagePaneEl.textContent).not.toContain("尚未讀取此頁");
      runtime.setWorkspace("focus");
      expect(pagePaneEl.querySelector(".page-reader-focus-panel")).not.toBeNull();

      vi.advanceTimersByTime(1_000);
      await flushMicrotasks();
      await flushMicrotasks();

      expect(sendMessage).toHaveBeenCalledTimes(1);
      expect(sendMessage).toHaveBeenCalledWith(expect.objectContaining({
        type: "PAGE_READING_REQUEST",
        tabId: 42,
        inject: true,
        activation: expect.objectContaining({
          source: "sidepanel",
          targetKind: "page",
          action: "read",
        }),
      }));
      expect(pagePaneEl.querySelector(".page-reader-focus-panel")).not.toBeNull();
      expect(pagePaneEl.querySelector(".page-reader-card")).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("auto-reads once for the same meaningful URL after status-complete tab updates", async () => {
    vi.useFakeTimers();
    try {
      const pagePaneEl = setupDom();
      let onUpdated: ((tabId: number, changeInfo: { url?: string; status?: string }, tab: { id: number; url: string; title: string }) => void) | undefined;
      const tab = {
        id: 42,
        url: "https://example.test/article?utm_source=feed#comments",
        title: "Runtime Fixture",
      };
      const sendMessage = vi.fn(async (message: TrulyMessage) => {
        if (message.type === "PAGE_READING_REQUEST") {
          return {
            type: "PAGE_READING_RESULT",
            tabId: 42,
            surface: surface({
              url: "https://example.test/article",
              canonicalUrl: "https://example.test/article",
            }),
          } satisfies TrulyMessage;
        }
        throw new Error(`unexpected message ${(message as { type: string }).type}`);
      });
      const runtime = createSidepanelPageReadingRuntime({
        pagePaneEl,
        runtime: { sendMessage },
        tabs: {
          query: vi.fn(async () => [tab]),
          onUpdated: {
            addListener(listener) {
              onUpdated = listener;
            },
          },
        },
        activateTab: vi.fn(),
        getLang: () => "zh-TW",
        now: () => 1_000,
        hasAllSitesPermission: vi.fn(async () => true),
      });

      runtime.install();
      await flushMicrotasks();
      vi.advanceTimersByTime(1_000);
      await flushMicrotasks();
      await flushMicrotasks();

      onUpdated?.(42, { status: "complete" }, tab);
      await flushMicrotasks();
      vi.advanceTimersByTime(1_000);
      await flushMicrotasks();

      expect(sendMessage.mock.calls.filter(([message]) => message.type === "PAGE_READING_REQUEST")).toHaveLength(1);
      expect(pagePaneEl.textContent).toContain("Runtime fixture excerpt.");
    } finally {
      vi.useRealTimers();
    }
  });

  it("shows neutral loading instead of stale guidance while an all-sites reread is debounced", async () => {
    vi.useFakeTimers();
    try {
      const pagePaneEl = setupDom();
      let onUpdated: ((tabId: number, changeInfo: { url?: string; status?: string }, tab: { id: number; url: string; title: string }) => void) | undefined;
      let tab = {
        id: 42,
        url: "https://example.test/article",
        title: "First Runtime Fixture",
      };
      const sendMessage = vi.fn(async (message: TrulyMessage) => {
        if (message.type === "PAGE_READING_REQUEST") {
          return {
            type: "PAGE_READING_RESULT",
            tabId: 42,
            surface: surface({
              id: `general:${tab.url}`,
              url: tab.url,
              canonicalUrl: tab.url,
              title: tab.title,
              excerpt: `${tab.title} excerpt.`,
            }),
          } satisfies TrulyMessage;
        }
        throw new Error(`unexpected message ${(message as { type: string }).type}`);
      });
      const runtime = createSidepanelPageReadingRuntime({
        pagePaneEl,
        runtime: { sendMessage },
        tabs: {
          query: vi.fn(async () => [tab]),
          onUpdated: {
            addListener(listener) {
              onUpdated = listener;
            },
          },
        },
        activateTab: vi.fn(),
        getLang: () => "zh-TW",
        now: () => 1_000,
        hasAllSitesPermission: vi.fn(async () => true),
      });

      runtime.install();
      await flushMicrotasks();
      vi.advanceTimersByTime(1_000);
      await flushMicrotasks();
      await flushMicrotasks();

      expect(pagePaneEl.textContent).toContain("First Runtime Fixture excerpt.");
      expect(sendMessage.mock.calls.filter(([message]) => message.type === "PAGE_READING_REQUEST")).toHaveLength(1);

      tab = {
        id: 42,
        url: "https://example.test/other-article",
        title: "Second Runtime Fixture",
      };
      onUpdated?.(42, { url: tab.url }, tab);
      await flushMicrotasks();

      expect(pagePaneEl.querySelector(".page-reader-card-loading-status")?.textContent).toBe("讀取中");
      expect(pagePaneEl.textContent).not.toContain("頁面已變更");
      expect(pagePaneEl.textContent).not.toContain("First Runtime Fixture excerpt.");
      expect(pagePaneEl.querySelector(".page-reader-processing-status")).toBeNull();
      expect(pagePaneEl.querySelector(".page-reader-technical-details")).toBeNull();
      expect(sendMessage.mock.calls.filter(([message]) => message.type === "PAGE_READING_REQUEST")).toHaveLength(1);

      vi.advanceTimersByTime(1_000);
      await flushMicrotasks();
      await flushMicrotasks();

      expect(sendMessage.mock.calls.filter(([message]) => message.type === "PAGE_READING_REQUEST")).toHaveLength(2);
      expect(pagePaneEl.textContent).toContain("Second Runtime Fixture excerpt.");
    } finally {
      vi.useRealTimers();
    }
  });

  it("auto-generates a General Page brief after an all-sites auto-read when Tier B is available", async () => {
    vi.useFakeTimers();
    try {
      const pagePaneEl = setupDom();
      const sendMessage = vi.fn(async (message: TrulyMessage) => {
        if (message.type === "PAGE_READING_REQUEST") {
          return {
            type: "PAGE_READING_RESULT",
            tabId: 42,
            surface: surface(),
          } satisfies TrulyMessage;
        }
        if (message.type === "GENERAL_PAGE_ANALYSIS_REQUEST") {
          expect(message.allowedUse).toBe("article_or_selection_analysis");
          expect(message.context.targetKind).toBe("page");
          return {
            type: "GENERAL_PAGE_ANALYSIS_RESULT",
            tabId: 42,
            ok: true,
            brief: {
              schemaVersion: 1,
              summary: "Auto-read model summary.",
              bg: [{ t: "Auto context", why: "The side panel was open with all-sites access." }],
              claims: [{ c: "Auto-read claim", why: "It verifies automatic model dispatch.", need: "Compare with the page.", q: "What primary evidence supports the auto-read claim?" }],
              qs: [{ q: "What background explains the auto-read result?", kind: "context" }],
              model: "brief-model",
              outputLang: "zh-TW",
              elapsedMs: 900,
            },
          } satisfies TrulyMessage;
        }
        throw new Error(`unexpected message ${(message as { type: string }).type}`);
      });
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
        getSettings: () => ({
          ...DEFAULT_SETTINGS,
          deepClassifyEnabled: true,
          tierBProvider: "openai-compatible",
          tierBEndpoint: "http://127.0.0.1:4999/v1/chat/completions",
          tierBModel: "brief-model",
        }),
        now: () => 1_000,
        hasAllSitesPermission: vi.fn(async () => true),
      });

      runtime.install();
      await flushMicrotasks();
      vi.advanceTimersByTime(1_000);
      await flushMicrotasks();
      await flushMicrotasks();
      await flushMicrotasks();

      expect(sendMessage.mock.calls.map(([message]) => message.type)).toEqual([
        "PAGE_READING_REQUEST",
        "GENERAL_PAGE_ANALYSIS_REQUEST",
      ]);
      expect(pagePaneEl.textContent).toContain("Auto-read model summary.");
      expect(pagePaneEl.textContent).toContain("Auto-read claim");
    } finally {
      vi.useRealTimers();
    }
  });

  it("shows why a short extraction should not be sent to a model", async () => {
    const pagePaneEl = setupDom();
    const runtime = createSidepanelPageReadingRuntime({
      pagePaneEl,
      runtime: {
        sendMessage: vi.fn(async () => ({
          type: "PAGE_READING_RESULT",
          tabId: 42,
          surface: surface({
            mainText: "Short synthetic text.",
            excerpt: "Short synthetic text.",
            extraction: {
              method: "fallback",
              status: "partial",
              warnings: ["very-short-content"],
            },
          }),
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

    expect(pagePaneEl.textContent).not.toContain("頁面狀態");
    expect(pagePaneEl.textContent).toContain("暫不分析");
    expect(pagePaneEl.querySelector(".page-reader-context-summary-status")?.textContent).toBe("暫不分析");
    expect(pagePaneEl.querySelector(".page-reader-context-summary p")?.textContent)
      .toBe("目前讀到的文字較少，請開啟原文或指定段落後再分析。");
    expect(pagePaneEl.textContent).not.toContain("parser_advisor_no_response");
    expect(pagePaneEl.querySelector(".page-reader-context-summary")?.classList.contains("is-action-required")).toBe(true);
    expect(pagePaneEl.querySelector<HTMLDetailsElement>(".page-reader-technical-details")?.open).toBe(false);
  });

  it("downgrades noisy fallback extraction and hides navigation download links from source context", async () => {
    const pagePaneEl = setupDom();
    const runtime = createSidepanelPageReadingRuntime({
      pagePaneEl,
      runtime: {
        sendMessage: vi.fn(async () => ({
          type: "PAGE_READING_RESULT",
          tabId: 42,
          surface: surface({
            mainText: [
              "為達最佳瀏覽效果，建議使用 Chrome、Firefox 或 Microsoft Edge 的瀏覽器。",
              "請至 Edge 官網下載 請至 FireFox 官網下載 請至 Google 官網下載。",
              "The actual synthetic report describes parser quality and source inspection.",
              "It remains long enough for model-context threshold checks after common browser download noise is removed.",
              "The cleaned passage also explains that fallback extraction should be reviewed before any model call, because layout text may still be mixed with the useful body.",
              "A final synthetic sentence keeps this fixture above the readiness threshold while preserving the caution state from extraction warnings.",
            ].join(" "),
            excerpt: "請至 Edge 官網下載 請至 FireFox 官網下載 請至 Google 官網下載。",
            extraction: {
              method: "fallback",
              status: "partial",
              warnings: ["large-navigation-noise", "no-main-content"],
            },
            links: [
              { href: "https://example.test/", text: "首頁" },
              { href: "https://www.microsoft.com/edge/download", text: "請至 Edge 官網下載" },
              { href: "https://www.mozilla.org/firefox/new", text: "請至 Firefox 官網下載" },
              { href: "https://example.test/source", text: "Article source" },
            ],
          }),
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

    expect(pagePaneEl.textContent).not.toContain("頁面狀態");
    expect(pagePaneEl.textContent).not.toContain("需留意");
    expect(pagePaneEl.querySelector(".page-reader-context-summary p")?.textContent)
      .toBe("頁面含大量導航雜訊，建議直接點擊標題閱讀完整報導。");
    expect(pagePaneEl.textContent).not.toContain("parser_advisor_no_response");
    expect(pagePaneEl.querySelector(".page-reader-context-summary")?.classList.contains("is-caution")).toBe(true);
    expect(pagePaneEl.querySelector<HTMLDetailsElement>(".page-reader-technical-details")?.open).toBe(false);
    const sourceLink = pagePaneEl.querySelector<HTMLAnchorElement>(".page-reader-source-links a");
    expect(sourceLink?.querySelector("span")?.textContent).toBe("Article source");
    expect(sourceLink?.querySelector(".page-reader-source-link-host")?.textContent).toBe("example.test");
    expect(sourceLink?.href).toBe("https://example.test/source");
    expect(pagePaneEl.textContent).toContain("Article source");
    expect(pagePaneEl.textContent).toContain("相關連結");
    expect(pagePaneEl.textContent).not.toContain("請至 Edge 官網下載");
    expect(pagePaneEl.textContent).not.toContain("請至 Firefox 官網下載");
  });

  it("renders metadata dumps as a readable excerpt instead of raw JSON-LD", async () => {
    const pagePaneEl = setupDom();
    const rawJsonLd = JSON.stringify({
      "@context": "https://schema.org",
      "@type": "NewsArticle",
      headline: "Synthetic metadata headline",
      description: "This synthetic metadata description is safe to show when a parser accidentally returns JSON-LD instead of article prose.",
      publisher: { name: "Example News" },
    });
    const runtime = createSidepanelPageReadingRuntime({
      pagePaneEl,
      runtime: {
        sendMessage: vi.fn(async () => ({
          type: "PAGE_READING_RESULT",
          tabId: 42,
          surface: surface({
            mainText: rawJsonLd,
            excerpt: rawJsonLd,
            extraction: {
              method: "semantic-html",
              status: "partial",
              warnings: ["large-navigation-noise"],
            },
          }),
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

    const excerpt = pagePaneEl.querySelector(".page-reader-excerpt")?.textContent ?? "";
    expect(excerpt).toContain("This synthetic metadata description is safe to show");
    expect(excerpt).not.toContain("@context");
    expect(excerpt).not.toContain("\"@type\"");
  });

  it("runs parser advisor after a weak page reading and renders page-overview effective context", async () => {
    const pagePaneEl = setupDom();
    const weakSurface = surface({
      mainText: [
        "首頁 分類 熱門 推薦 下載 導覽 Search Login Subscribe",
        "Card one synthetic teaser with only a short summary and many links.",
        "Card two synthetic teaser with another unrelated headline and link.",
        "Card three synthetic teaser that makes the page look like a feed.",
      ].join(" "),
      excerpt: "首頁 分類 熱門 推薦 下載 導覽 Search Login Subscribe",
      extraction: {
        method: "fallback",
        status: "partial",
        warnings: ["large-navigation-noise", "no-main-content"],
      },
      links: Array.from({ length: 18 }, (_, index) => ({
        href: `https://example.test/link-${index}`,
        text: `Link ${index}`,
      })),
    });
    const sendMessage = vi.fn(async (message: TrulyMessage) => {
      if (message.type === "PAGE_READING_REQUEST") {
        return {
          type: "PAGE_READING_RESULT",
          tabId: 42,
          surface: weakSurface,
        } satisfies TrulyMessage;
      }
      if (message.type === "GENERAL_PAGE_PARSER_ADVISOR_REQUEST") {
        return {
          type: "GENERAL_PAGE_PARSER_ADVISOR_RESULT",
          tabId: 42,
          ok: true,
          providerRuntime: {
            ...message.providerRuntime,
            mode: "rule-based-runtime-baseline",
          },
          advice: {
            schemaVersion: 1,
            pageType: "index_or_feed",
            decision: "downgrade_to_index_or_feed",
            confidence: "high",
            needsUserSelection: false,
            needsScreenshot: false,
            riskTags: ["fallback_extraction", "large_navigation_noise", "index_or_feed"],
            rationale: "Synthetic navigation density is too high for article extraction.",
          },
        } satisfies TrulyMessage;
      }
      throw new Error(`unexpected message ${(message as { type: string }).type}`);
    });
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
    await flushMicrotasks();

    expect(sendMessage).toHaveBeenCalledWith(expect.objectContaining({
      type: "GENERAL_PAGE_PARSER_ADVISOR_REQUEST",
      tabId: 42,
      providerRuntime: expect.objectContaining({
        configSource: "tier-b-provider",
        mode: "rule-based-runtime-baseline",
      }),
    }));
    expect(pagePaneEl.textContent).not.toContain("頁面狀態");
    expect(pagePaneEl.textContent).not.toContain("需留意");
    expect(pagePaneEl.textContent).toContain("只做頁面總覽");
    expect(diagnosticRawValue(pagePaneEl, /判斷/)).toBe("downgrade_to_index_or_feed");
    expect(diagnosticRawValue(pagePaneEl, /用途/)).toBe("page_overview_only");
    expect(pagePaneEl.querySelector(".page-reader-context-summary p")?.textContent)
      .toBe("此頁導覽內容較多，適合瀏覽主題概況；若要閱讀完整報導，請點擊新聞標題。");
    expect(pagePaneEl.querySelector(".page-reader-card > .page-reader-excerpt")).toBeNull();
    expect(pagePaneEl.querySelector(".page-reader-card > .page-reader-preview")).toBeNull();
    expect(pagePaneEl.querySelector(".page-reader-supplemental-details .page-reader-excerpt")?.textContent)
      .toContain("首頁 分類 熱門");
    expect(pagePaneEl.querySelector<HTMLDetailsElement>(".page-reader-supplemental-details")?.open).toBe(false);
  });

  it("uses Tier B provider settings for parser advisor before falling back to local baseline", async () => {
    const pagePaneEl = setupDom();
    const weakSurface = surface({
      mainText: [
        "首頁 分類 熱門 推薦 導覽 Search Login Subscribe",
        "Synthetic card one is only a teaser with a link.",
        "Synthetic card two is another teaser with a link.",
        "Synthetic card three makes the page look like a feed.",
      ].join(" "),
      excerpt: "首頁 分類 熱門 推薦 導覽 Search Login Subscribe",
      extraction: {
        method: "fallback",
        status: "partial",
        warnings: ["large-navigation-noise", "no-main-content"],
      },
      links: Array.from({ length: 16 }, (_, index) => ({
        href: `https://example.test/link-${index}`,
        text: `Link ${index}`,
      })),
    });
    const sendMessage = vi.fn(async (message: TrulyMessage) => {
      if (message.type === "PAGE_READING_REQUEST") {
        return {
          type: "PAGE_READING_RESULT",
          tabId: 42,
          surface: weakSurface,
        } satisfies TrulyMessage;
      }
      if (message.type === "GENERAL_PAGE_PARSER_ADVISOR_REQUEST") {
        expect(message.providerRuntime).toMatchObject({
          canUseModel: true,
          effectiveProvider: "openai-compatible",
          endpoint: "http://127.0.0.1:4999/v1/chat/completions",
          model: "advisor-model",
          mode: "tier-b-short-json",
        });
        return {
          type: "GENERAL_PAGE_PARSER_ADVISOR_RESULT",
          tabId: 42,
          ok: true,
          providerRuntime: {
            ...message.providerRuntime,
            mode: "tier-b-short-json",
          },
          advice: {
            schemaVersion: 1,
            pageType: "index_or_feed",
            decision: "downgrade_to_index_or_feed",
            confidence: "high",
            needsUserSelection: false,
            needsScreenshot: false,
            riskTags: ["fallback_extraction", "large_navigation_noise", "index_or_feed"],
            rationale: "Tier B advisor classifies the synthetic page as an overview target.",
          },
        } satisfies TrulyMessage;
      }
      if (message.type === "GENERAL_PAGE_ANALYSIS_REQUEST") {
        expect(message.providerRuntime).toMatchObject({
          canUseModel: true,
          effectiveProvider: "openai-compatible",
          model: "advisor-model",
        });
        expect(message.allowedUse).toBe("page_overview_only");
        return {
          type: "GENERAL_PAGE_ANALYSIS_RESULT",
          tabId: 42,
          ok: true,
          brief: {
            schemaVersion: 1,
            summary: "Synthetic overview generated after a scope check.",
            claims: [{
              c: "This claim should be stripped by overview guard.",
              why: "Overview mode should not render claims.",
              need: "No claim needed.",
            }],
            qs: [{ q: "Which linked card should the reader understand next?", kind: "understand" }],
            note: "此為新聞彙整頁面，建議點擊各來源連結以獲取詳細報導。",
            model: "advisor-model",
            outputLang: "zh-TW",
          },
        } satisfies TrulyMessage;
      }
      throw new Error(`unexpected message ${(message as { type: string }).type}`);
    });
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
      getSettings: () => ({
        ...DEFAULT_SETTINGS,
        deepClassifyEnabled: true,
        tierBProvider: "openai-compatible",
        tierBEndpoint: "http://127.0.0.1:4999/v1/chat/completions",
        tierBModel: "advisor-model",
      }),
      now: () => 1_000,
    });

    await runtime.requestReadCurrentPage("sidepanel");
    await flushMicrotasks();
    await flushMicrotasks();

    expect(sendMessage).toHaveBeenCalledWith(expect.objectContaining({
      type: "GENERAL_PAGE_PARSER_ADVISOR_REQUEST",
      providerRuntime: expect.objectContaining({
        canUseModel: true,
        mode: "tier-b-short-json",
      }),
    }));
    expect(pagePaneEl.textContent).toContain("OpenAI 相容端點 / advisor-model");
    expect(pagePaneEl.textContent).toContain("頁面總覽");
    expect(pagePaneEl.querySelector(".page-reader-analysis-header h3")?.textContent).toBe("頁面總覽");
    expect(pagePaneEl.querySelector(".page-reader-analysis-scope")).toBeNull();
    expect(diagnosticRawValue(pagePaneEl, /用途/)).toBe("page_overview_only");
    expect(pagePaneEl.textContent).toContain("Synthetic overview generated after a scope check.");
    expect(pagePaneEl.textContent).not.toContain("This claim should be stripped");
    const card = pagePaneEl.querySelector(".page-reader-card");
    expect(card?.children[1]?.classList.contains("page-reader-context-details")).toBe(true);
    expect(card?.children[2]?.classList.contains("page-reader-analysis")).toBe(true);
    expect(pagePaneEl.querySelector(".page-reader-card > .page-reader-excerpt")).toBeNull();
    expect(pagePaneEl.querySelector(".page-reader-card > .page-reader-preview")).toBeNull();
    expect(pagePaneEl.querySelector(".page-reader-context-indicator")).not.toBeNull();
    expect(pagePaneEl.querySelector(".page-reader-context-details > summary")?.getAttribute("aria-label"))
      .toContain("有閱讀提示");
    expect(pagePaneEl.querySelector(".page-reader-context-summary p")?.textContent)
      .toBe("此頁導覽內容較多，適合瀏覽主題概況；若要閱讀完整報導，請點擊新聞標題。");
    expect(pagePaneEl.querySelector(".page-reader-analysis-note")).toBeNull();
    expect(pagePaneEl.textContent).not.toContain("此為新聞彙整頁面");
    expect(pagePaneEl.querySelector(".page-reader-supplemental-details .page-reader-excerpt")?.textContent)
      .toContain("首頁 分類 熱門");
    expect(pagePaneEl.querySelector<HTMLDetailsElement>(".page-reader-page-text")?.open).toBe(false);
    const contextBody = pagePaneEl.querySelector(".page-reader-context-body");
    expect(contextBody?.firstElementChild?.classList.contains("page-reader-context-summary")).toBe(true);
    expect(contextBody?.children[1]?.classList.contains("page-reader-page-text")).toBe(true);
    expect(pagePaneEl.querySelector<HTMLDetailsElement>(".page-reader-supplemental-details")?.open).toBe(false);
  });

  it("does not send General Page brief requests when advisor requires a user target", async () => {
    const pagePaneEl = setupDom();
    const weakSurface = surface({
      mainText: [
        "首頁 分類 熱門 推薦 下載 導覽 Search Login Subscribe",
        "Short synthetic teaser cards make this page ambiguous.",
        "The user should choose a target before analysis.",
      ].join(" "),
      excerpt: "首頁 分類 熱門 推薦 下載 導覽 Search Login Subscribe",
      extraction: {
        method: "fallback",
        status: "partial",
        warnings: ["large-navigation-noise", "no-main-content"],
      },
      links: Array.from({ length: 14 }, (_, index) => ({
        href: `https://example.test/link-${index}`,
        text: `Link ${index}`,
      })),
    });
    const sendMessage = vi.fn(async (message: TrulyMessage) => {
      if (message.type === "PAGE_READING_REQUEST") {
        return {
          type: "PAGE_READING_RESULT",
          tabId: 42,
          surface: weakSurface,
        } satisfies TrulyMessage;
      }
      if (message.type === "GENERAL_PAGE_PARSER_ADVISOR_REQUEST") {
        return {
          type: "GENERAL_PAGE_PARSER_ADVISOR_RESULT",
          tabId: 42,
          ok: true,
          providerRuntime: {
            ...message.providerRuntime,
            mode: "tier-b-short-json",
          },
          advice: {
            schemaVersion: 1,
            pageType: "unknown",
            decision: "request_user_selection",
            confidence: "high",
            needsUserSelection: true,
            needsScreenshot: false,
            riskTags: ["fallback_extraction", "large_navigation_noise", "needs_user_attention"],
            rationale: "Synthetic page needs a specific user target.",
          },
        } satisfies TrulyMessage;
      }
      if (message.type === "GENERAL_PAGE_ANALYSIS_REQUEST") {
        throw new Error("analysis request should not be sent when user target is required");
      }
      throw new Error(`unexpected message ${(message as { type: string }).type}`);
    });
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
      getSettings: () => ({
        ...DEFAULT_SETTINGS,
        deepClassifyEnabled: true,
        tierBProvider: "openai-compatible",
        tierBEndpoint: "http://127.0.0.1:4999/v1/chat/completions",
        tierBModel: "brief-model",
      }),
      now: () => 1_000,
    });

    await runtime.requestReadCurrentPage("sidepanel");
    await flushMicrotasks();

    expect(sendMessage).not.toHaveBeenCalledWith(expect.objectContaining({
      type: "GENERAL_PAGE_ANALYSIS_REQUEST",
    }));
    expect(pagePaneEl.textContent).toContain("需要指定目標");
    expect(diagnosticRawValue(pagePaneEl, /用途/)).toBe("requires_user_target");
    expect(pagePaneEl.querySelector(".page-reader-context-summary-status")?.textContent).toBe("需要指定段落");
    expect(pagePaneEl.querySelector(".page-reader-context-summary p")?.textContent)
      .toBe("這頁無法辨識明確正文，請選取想分析的段落。");
  });

  it("re-extracts full candidate block text before applying prefer-candidate context", async () => {
    const pagePaneEl = setupDom();
    const weakSurface = surface({
      id: "general:https://example.test/candidate",
      url: "https://example.test/candidate",
      canonicalUrl: "https://example.test/candidate",
      mainText: "Short fallback text that should be replaced by a stronger candidate block.",
      excerpt: "Short fallback text.",
      extraction: {
        method: "fallback",
        status: "partial",
        warnings: ["very-short-content"],
      },
    });
    const candidatePreview = "Candidate preview paragraph that is useful but intentionally incomplete.";
    const candidateFullText = [
      candidatePreview,
      "Full candidate continuation should appear in the visible reading preview and later model context.",
    ].join(" ");
    const sendMessage = vi.fn(async (message: TrulyMessage) => {
      if (message.type === "PAGE_READING_REQUEST") {
        return {
          type: "PAGE_READING_RESULT",
          tabId: 42,
          surface: weakSurface,
          candidateBlocks: [{
            id: "block-article",
            label: "article#body",
            role: "semantic-root",
            textPreview: candidatePreview,
            textLength: candidateFullText.length,
            linkCount: 0,
            imageCount: 0,
          }],
        } satisfies TrulyMessage;
      }
      if (message.type === "GENERAL_PAGE_PARSER_ADVISOR_REQUEST") {
        return {
          type: "GENERAL_PAGE_PARSER_ADVISOR_RESULT",
          tabId: 42,
          ok: true,
          providerRuntime: {
            ...message.providerRuntime,
            mode: "rule-based-runtime-baseline",
          },
          advice: {
            schemaVersion: 1,
            pageType: "article",
            decision: "prefer_candidate_block",
            confidence: "high",
            selectedBlockId: "block-article",
            needsUserSelection: false,
            needsScreenshot: false,
            riskTags: ["short_text", "candidate_block_ambiguous"],
            rationale: "Synthetic candidate block is stronger than fallback extraction.",
          },
        } satisfies TrulyMessage;
      }
      if (message.type === "GENERAL_PAGE_CANDIDATE_BLOCK_TEXT_REQUEST") {
        return {
          type: "GENERAL_PAGE_CANDIDATE_BLOCK_TEXT_RESULT",
          tabId: 42,
          surfaceId: weakSurface.id,
          blockId: "block-article",
          text: candidateFullText,
        } satisfies TrulyMessage;
      }
      throw new Error(`unexpected message ${(message as { type: string }).type}`);
    });
    const runtime = createSidepanelPageReadingRuntime({
      pagePaneEl,
      runtime: { sendMessage },
      tabs: {
        query: vi.fn(async () => [{
          id: 42,
          url: "https://example.test/candidate",
          title: "Runtime Fixture",
        }]),
      },
      activateTab: vi.fn(),
      getLang: () => "zh-TW",
      now: () => 1_000,
    });

    await runtime.requestReadCurrentPage("sidepanel");
    await flushMicrotasks();
    await flushMicrotasks();

    expect(sendMessage).toHaveBeenCalledWith(expect.objectContaining({
      type: "GENERAL_PAGE_CANDIDATE_BLOCK_TEXT_REQUEST",
      tabId: 42,
      surfaceId: weakSurface.id,
      blockId: "block-article",
    }));
    expect(pagePaneEl.textContent).toContain("改用較乾淨的正文區塊");
    expect(diagnosticRawValue(pagePaneEl, /判斷/)).toBe("prefer_candidate_block");
    expect(diagnosticRawValue(pagePaneEl, /用途/)).toBe("article_or_selection_analysis");
    expect(pagePaneEl.textContent).toContain("Full candidate continuation should appear");
  });

  it("uses an explicit selection target for reading context", async () => {
    const pagePaneEl = setupDom();
    const selectedText = [
      "This selected runtime passage is intentionally long enough for the selection target flow.",
      "It should replace the whole-page preview while preserving the original page surface.",
    ].join(" ");
    const baseSurface = surface();
    const sendMessage = vi.fn(async (message: TrulyMessage) => {
      if (message.type === "PAGE_READING_REQUEST") {
        return {
          type: "PAGE_READING_RESULT",
          tabId: 42,
          surface: baseSurface,
        } satisfies TrulyMessage;
      }
      if (message.type === "READING_TARGET_REQUEST") {
        return {
          type: "READING_TARGET_RESULT",
          tabId: 42,
          target: {
            id: "target:selection:test",
            surfaceId: baseSurface.id,
            kind: "selection",
            text: selectedText,
            surroundingText: "Synthetic surrounding text for the selected passage.",
            extraction: {
              method: "selection",
              status: "complete",
              warnings: [],
            },
          },
        } satisfies TrulyMessage;
      }
      throw new Error(`unexpected message ${(message as { type: string }).type}`);
    });
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
    runtime.setWorkspace("focus");
    pagePaneEl.querySelector<HTMLButtonElement>("#pageReadSelection")?.click();
    await flushMicrotasks();
    await flushMicrotasks();

    expect(sendMessage).toHaveBeenCalledWith(expect.objectContaining({
      type: "READING_TARGET_REQUEST",
      tabId: 42,
      trigger: "selection",
      surfaceId: baseSurface.id,
      activation: {
        source: "sidepanel",
        targetKind: "selection",
        action: "read",
      },
    }));
    expect(pagePaneEl.textContent).toContain(selectedText);
    expect(pagePaneEl.querySelector(".page-reader-focus-title")?.textContent).toBe("分析範圍");
    expect(pagePaneEl.querySelector(".page-reader-focus-meta")?.textContent).toContain("選取文字");
    expect(pagePaneEl.querySelector(".page-reader-focus-preview")?.textContent).toContain("This selected runtime passage");
    expect(pagePaneEl.querySelector<HTMLDetailsElement>(".page-reader-focus-text")?.open).toBe(false);
    expect(pagePaneEl.querySelector(".page-reader-context-details")).toBeNull();
    expect(pagePaneEl.textContent).not.toContain("頁面狀態");
    expect(diagnosticRawValue(pagePaneEl, /目標/)).toBeUndefined();

    runtime.handlePageReadingResult({
      type: "PAGE_READING_RESULT",
      tabId: 42,
      surface: baseSurface,
    });

    expect(pagePaneEl.querySelector(".page-reader-focus-meta")?.textContent).toContain("選取文字");
    expect(pagePaneEl.textContent).toContain(selectedText);
    expect(pagePaneEl.querySelector(".page-reader-context-details")).toBeNull();
  });

  it("keeps Focus target-centric and routes aggregation guidance into the scope", async () => {
    const pagePaneEl = setupDom();
    const copiedTexts: string[] = [];
    Object.defineProperty(globalThis.navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: vi.fn(async (text: string) => {
          copiedTexts.push(text);
        }),
      },
    });
    const selectedText = [
      "This selected news-aggregation passage is intentionally long enough for focused analysis.",
      "It represents one disaster-news headline and teaser chosen by the reader.",
    ].join(" ");
    const aggregationNote = "此為新聞聚合頁面，建議點擊各來源連結以獲取完整災情報導。";
    const navigationNote = "頁面含大量導航雜訊，建議直接點擊新聞標題獲取詳情。";
    let pageReadCount = 0;
    let selectionRequestCount = 0;
    let selectionAnalysisCount = 0;
    const baseSurface = surface({
      sourceName: "Google 新聞",
      mainText: `${surface().mainText} Additional aggregation navigation and linked headline text.`,
      extraction: {
        method: "semantic-html",
        status: "partial",
        warnings: ["large-navigation-noise"],
      },
    });
    const sendMessage = vi.fn(async (message: TrulyMessage) => {
      if (message.type === "PAGE_READING_REQUEST") {
        pageReadCount += 1;
        return {
          type: "PAGE_READING_RESULT",
          tabId: 42,
          surface: pageReadCount === 1
            ? baseSurface
            : {
                ...baseSurface,
                mainText: `${baseSurface.mainText} Refreshed same-page content.`,
                excerpt: "Refreshed same-page excerpt.",
              },
        } satisfies TrulyMessage;
      }
      if (message.type === "READING_TARGET_REQUEST") {
        selectionRequestCount += 1;
        if (selectionRequestCount === 3) {
          return {
            type: "READING_TARGET_ERROR",
            tabId: 42,
            error: "no_meaningful_selection",
          } satisfies TrulyMessage;
        }
        return {
          type: "READING_TARGET_RESULT",
          tabId: 42,
          target: {
            id: `target:selection:aggregation:${selectionRequestCount}`,
            surfaceId: baseSurface.id,
            kind: "selection",
            text: selectedText,
            surroundingText: "Synthetic aggregation context around the selected headline.",
            extraction: {
              method: "selection",
              status: "complete",
              warnings: [],
            },
          },
        } satisfies TrulyMessage;
      }
      if (message.type === "GENERAL_PAGE_ANALYSIS_REQUEST") {
        const selectionNote = message.context.targetKind === "selection"
          ? ++selectionAnalysisCount === 1 ? aggregationNote : navigationNote
          : undefined;
        return {
          type: "GENERAL_PAGE_ANALYSIS_RESULT",
          tabId: 42,
          ok: true,
          brief: {
            schemaVersion: 1,
            summary: message.context.targetKind === "selection"
              ? "Selected disaster-news context summary."
              : "Whole-page fixture summary.",
            note: selectionNote,
            model: "brief-model",
            outputLang: "zh-TW",
          },
        } satisfies TrulyMessage;
      }
      throw new Error(`unexpected message ${(message as { type: string }).type}`);
    });
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
      getSettings: () => ({
        ...DEFAULT_SETTINGS,
        deepClassifyEnabled: true,
        tierBProvider: "openai-compatible",
        tierBEndpoint: "http://127.0.0.1:4999/v1/chat/completions",
        tierBModel: "brief-model",
      }),
      now: () => 1_000,
    });

    await runtime.requestReadCurrentPage("sidepanel");
    await flushMicrotasks();
    runtime.setWorkspace("page");
    expect(pagePaneEl.textContent).toContain("Whole-page fixture summary.");
    expect(runtime.auditState().displayedSession?.pageAnalysisStatus).toBe("ready");
    runtime.setWorkspace("focus");
    pagePaneEl.querySelector<HTMLButtonElement>("#pageReadSelection")?.click();
    await flushMicrotasks();
    await flushMicrotasks();

    expect(pagePaneEl.querySelectorAll(".page-reader-focus-panel")).toHaveLength(1);
    expect(pagePaneEl.querySelector(".page-reader-card")).toBeNull();
    expect(pagePaneEl.querySelector(".page-reader-focus-analysis .page-reader-analysis")).not.toBeNull();
    expect(pagePaneEl.querySelector(".page-reader-analysis-header h3")?.textContent).toBe("選取內容總覽");
    expect(pagePaneEl.querySelector(".page-reader-focus-meta")?.textContent).toContain("選取文字");
    expect(pagePaneEl.querySelector(".page-reader-focus-meta")?.textContent).toContain("Google 新聞");
    expect(pagePaneEl.querySelector<HTMLButtonElement>("#pageReadSelection")?.textContent).toBe("套用選取內容");
    expect(pagePaneEl.textContent).not.toContain("上次讀取");
    expect(pagePaneEl.textContent).not.toContain("外部工具整合");
    expect(pagePaneEl.querySelector(".page-reader-focus-tools #pageCopyMetadata")).not.toBeNull();
    expect(pagePaneEl.querySelector(".page-reader-focus-tools #pageDownloadMarkdown")).not.toBeNull();
    expect(pagePaneEl.querySelector(".page-reader-focus-advisory")?.textContent)
      .toBe("選取內容來自新聞聚合頁；完整報導請回到原頁開啟新聞標題。");
    expect(pagePaneEl.querySelector(".page-reader-analysis-note")).toBeNull();
    expect(pagePaneEl.textContent?.match(/新聞聚合頁/g)).toHaveLength(1);
    expect(pagePaneEl.textContent).not.toContain(aggregationNote);
    expect(runtime.auditState().displayedSession?.pageAnalysisStatus).toBe("ready");
    pagePaneEl.querySelector<HTMLButtonElement>("#pageCopyMetadata")?.click();
    await flushMicrotasks();
    expect(copiedTexts.at(-1)).toContain("Selected disaster-news context summary.");
    expect(copiedTexts.at(-1)).not.toContain("Whole-page fixture summary.");

    runtime.setWorkspace("page");
    expect(runtime.auditState().displayedSession?.pageAnalysisStatus).toBe("ready");
    expect(pagePaneEl.textContent).toContain("Whole-page fixture summary.");
    expect(pagePaneEl.textContent).not.toContain("Selected disaster-news context summary.");
    pagePaneEl.querySelector<HTMLButtonElement>("#pageCopyMetadata")?.click();
    await flushMicrotasks();
    expect(copiedTexts.at(-1)).toContain("Whole-page fixture summary.");
    expect(copiedTexts.at(-1)).not.toContain("Selected disaster-news context summary.");
    runtime.setWorkspace("focus");
    expect(pagePaneEl.textContent).toContain("Selected disaster-news context summary.");

    pagePaneEl.querySelector<HTMLButtonElement>("#pageReadSelection")?.click();
    await flushMicrotasks();
    await flushMicrotasks();

    expect(pagePaneEl.querySelector(".page-reader-focus-advisory")?.textContent)
      .toBe("選取內容來自導覽較多的頁面；完整內容請回到原頁開啟標題。");
    expect(pagePaneEl.querySelector(".page-reader-analysis-note")).toBeNull();
    expect(pagePaneEl.textContent).not.toContain(navigationNote);

    runtime.setWorkspace("page");
    expect(pagePaneEl.textContent).toContain("Whole-page fixture summary.");
    runtime.setWorkspace("focus");
    expect(pagePaneEl.textContent).toContain("Selected disaster-news context summary.");

    await runtime.requestReadCurrentPage("sidepanel");
    await flushMicrotasks();
    runtime.setWorkspace("page");
    expect(pagePaneEl.textContent).toContain("Whole-page fixture summary.");
    runtime.setWorkspace("focus");
    expect(pagePaneEl.textContent).toContain("Selected disaster-news context summary.");

    pagePaneEl.querySelector<HTMLButtonElement>("#pageReadSelection")?.click();
    await flushMicrotasks();
    await flushMicrotasks();
    expect(pagePaneEl.textContent).toContain("請先在目前網頁選取一段較完整的文字，再套用選取內容");
    expect(pagePaneEl.textContent).toContain("Selected disaster-news context summary.");
    runtime.setWorkspace("page");
    expect(pagePaneEl.textContent).toContain("Whole-page fixture summary.");
  });

  it("routes concurrent Web and Focus analysis responses back to their originating scopes", async () => {
    const pagePaneEl = setupDom();
    const selectedText = [
      "This selected passage is long enough to start a concurrent Focus analysis request.",
      "Its result must remain independent from the whole-page analysis response.",
    ].join(" ");
    let resolvePageAnalysis: ((message: TrulyMessage) => void) | undefined;
    let resolveFocusAnalysis: ((message: TrulyMessage) => void) | undefined;
    const sendMessage = vi.fn(async (message: TrulyMessage) => {
      if (message.type === "PAGE_READING_REQUEST") {
        return {
          type: "PAGE_READING_RESULT",
          tabId: 42,
          surface: surface(),
        } satisfies TrulyMessage;
      }
      if (message.type === "READING_TARGET_REQUEST") {
        return {
          type: "READING_TARGET_RESULT",
          tabId: 42,
          target: {
            id: "target:selection:concurrent",
            surfaceId: surface().id,
            kind: "selection",
            text: selectedText,
            surroundingText: "Synthetic concurrent analysis context.",
            extraction: {
              method: "selection",
              status: "complete",
              warnings: [],
            },
          },
        } satisfies TrulyMessage;
      }
      if (message.type === "GENERAL_PAGE_ANALYSIS_REQUEST") {
        return await new Promise<TrulyMessage>((resolve) => {
          if (message.context.targetKind === "selection") resolveFocusAnalysis = resolve;
          else resolvePageAnalysis = resolve;
        });
      }
      throw new Error(`unexpected message ${(message as { type: string }).type}`);
    });
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
      getSettings: () => ({
        ...DEFAULT_SETTINGS,
        deepClassifyEnabled: true,
        tierBProvider: "openai-compatible",
        tierBEndpoint: "http://127.0.0.1:4999/v1/chat/completions",
        tierBModel: "brief-model",
      }),
      now: () => 1_000,
    });

    await runtime.requestReadCurrentPage("sidepanel");
    await flushMicrotasks();
    expect(resolvePageAnalysis).toBeTypeOf("function");
    runtime.setWorkspace("focus");
    pagePaneEl.querySelector<HTMLButtonElement>("#pageReadSelection")?.click();
    await flushMicrotasks();
    await flushMicrotasks();
    expect(resolveFocusAnalysis).toBeTypeOf("function");

    resolveFocusAnalysis?.({
      type: "GENERAL_PAGE_ANALYSIS_RESULT",
      tabId: 42,
      ok: true,
      brief: {
        schemaVersion: 1,
        summary: "Concurrent Focus summary.",
        model: "brief-model",
        outputLang: "zh-TW",
      },
    } satisfies TrulyMessage);
    await flushMicrotasks();
    resolvePageAnalysis?.({
      type: "GENERAL_PAGE_ANALYSIS_RESULT",
      tabId: 42,
      ok: true,
      brief: {
        schemaVersion: 1,
        summary: "Concurrent Web summary.",
        model: "brief-model",
        outputLang: "zh-TW",
      },
    } satisfies TrulyMessage);
    await flushMicrotasks();

    runtime.setWorkspace("page");
    expect(runtime.auditState().displayedSession?.pageAnalysisStatus).toBe("ready");
    expect(pagePaneEl.textContent).toContain("Concurrent Web summary.");
    runtime.setWorkspace("focus");
    expect(pagePaneEl.textContent).toContain("Concurrent Focus summary.");
  });

  it("fails closed with toolbar guidance for current-region hotkey without a live read session", async () => {
    const pagePaneEl = setupDom();
    let storageListener: ((changes: Record<string, { newValue?: unknown }>, areaName: string) => void) | undefined;
    const sendMessage = vi.fn();
    const sessionStore = {
      get: vi.fn(async () => ({})),
      remove: vi.fn(async () => undefined),
      onChanged: {
        addListener: vi.fn((listener) => {
          storageListener = listener;
        }),
      },
    };
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
      sessionStore,
    });

    runtime.install();
    await flushMicrotasks();
    storageListener?.({
      pendingCurrentRegionRead: {
        newValue: { tabId: 42, ts: 1_000 },
      },
    }, "session");
    await flushMicrotasks();

    expect(sessionStore.remove).toHaveBeenCalledWith("pendingCurrentRegionRead");
    expect(sendMessage).not.toHaveBeenCalledWith(expect.objectContaining({
      type: "READING_TARGET_REQUEST",
    }));
    expect(pagePaneEl.textContent).toContain("讀取失敗");
    expect(pagePaneEl.textContent).toContain("請先在目標網頁上點 Truly 工具列圖示");
  });

  it("consumes a cold-open popup command once and starts the addressed page read", async () => {
    const pagePaneEl = setupDom();
    const command = createReadingCommandEnvelope({
      requestId: "page-read:cold-open-12345678",
      tabId: 42,
      url: "https://example.test/article",
      activation: { source: "popup", targetKind: "page", action: "read" },
      createdAt: 1_000,
    });
    const sessionStore = {
      get: vi.fn(async (key: string) => key === PENDING_PAGE_READING_COMMAND_KEY
        ? { [PENDING_PAGE_READING_COMMAND_KEY]: command }
        : {}),
      remove: vi.fn(async () => undefined),
    };
    const sendMessage = vi.fn(async (message: TrulyMessage) => {
      if (message.type !== "PAGE_READING_REQUEST") throw new Error(`unexpected ${message.type}`);
      return {
        type: "PAGE_READING_RESULT",
        requestId: message.requestId,
        tabId: 42,
        surface: surface(),
      } satisfies TrulyMessage;
    });
    const targetTab = {
      id: 42,
      url: "https://example.test/article",
      title: "Runtime Fixture",
    };
    const runtime = createSidepanelPageReadingRuntime({
      pagePaneEl,
      runtime: { sendMessage },
      tabs: {
        query: vi.fn(async () => [targetTab]),
        get: vi.fn(async () => targetTab),
      },
      activateTab: vi.fn(),
      getLang: () => "zh-TW",
      now: () => 1_100,
      sessionStore,
    });

    runtime.install();
    await flushMicrotasks();
    await flushMicrotasks();
    await flushMicrotasks();

    expect(sessionStore.remove).toHaveBeenCalledWith(PENDING_PAGE_READING_COMMAND_KEY);
    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(sendMessage).toHaveBeenCalledWith(expect.objectContaining({
      type: "PAGE_READING_REQUEST",
      requestId: command.requestId,
      tabId: 42,
      inject: true,
    }));
    expect(pagePaneEl.textContent).toContain("Runtime Fixture");
  });

  it("ignores a stale page response after a newer request identity takes ownership", async () => {
    const pagePaneEl = setupDom();
    const pending: Array<{ message: Extract<TrulyMessage, { type: "PAGE_READING_REQUEST" }>; resolve(value: TrulyMessage): void }> = [];
    const sendMessage = vi.fn((message: TrulyMessage) => {
      if (message.type !== "PAGE_READING_REQUEST") return Promise.resolve(undefined);
      return new Promise<TrulyMessage>((resolve) => pending.push({ message, resolve }));
    });
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
      now: () => 2_000,
    });

    const first = runtime.requestReadCurrentPage("sidepanel");
    await flushMicrotasks();
    const second = runtime.requestReadCurrentPage("sidepanel");
    await flushMicrotasks();
    expect(pending).toHaveLength(2);
    expect(pending[0].message.requestId).not.toBe(pending[1].message.requestId);

    pending[1].resolve({
      type: "PAGE_READING_RESULT",
      requestId: pending[1].message.requestId,
      tabId: 42,
      surface: surface({ title: "Newer Result" }),
    });
    await second;
    pending[0].resolve({
      type: "PAGE_READING_RESULT",
      requestId: pending[0].message.requestId,
      tabId: 42,
      surface: surface({ title: "Stale Result" }),
    });
    await first;

    expect(pagePaneEl.textContent).toContain("Newer Result");
    expect(pagePaneEl.textContent).not.toContain("Stale Result");
  });

  it("shows a friendly explanation for reserved actions that are not enabled", async () => {
    const pagePaneEl = setupDom();
    const runtime = createSidepanelPageReadingRuntime({
      pagePaneEl,
      runtime: {
        sendMessage: vi.fn(async () => ({
          type: "PAGE_READING_ERROR",
          tabId: 42,
          error: "page_reading_action_unsupported",
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

    expect(pagePaneEl.textContent).toContain("讀取失敗");
    expect(pagePaneEl.textContent).toContain("這個閱讀動作尚未啟用");
  });

  it("scrubs stale surface text after a meaningful URL change", async () => {
    const pagePaneEl = setupDom();
    let onUpdated: ((tabId: number, changeInfo: { url?: string; status?: string }, tab: { id?: number; url?: string; title?: string }) => void) | undefined;
    const runtime = createSidepanelPageReadingRuntime({
      pagePaneEl,
      runtime: {
        sendMessage: vi.fn(),
      },
      tabs: {
        query: vi.fn(async () => [{
          id: 42,
          url: "https://example.test/article",
          title: "Runtime Fixture",
        }]),
        onUpdated: {
          addListener: (listener) => {
            onUpdated = listener;
          },
        },
      },
      activateTab: vi.fn(),
      getLang: () => "zh-TW",
      now: () => 1_000,
    });

    runtime.install();
    await Promise.resolve();
    runtime.handlePageReadingResult({
      type: "PAGE_READING_RESULT",
      tabId: 42,
      surface: surface({
        mainText: `${surface().mainText} Sensitive stale runtime fixture text.`,
        excerpt: "Sensitive stale excerpt.",
      }),
    });

    expect(pagePaneEl.textContent).toContain("Sensitive stale excerpt.");
    onUpdated?.(42, { url: "https://example.test/other-article" }, {
      id: 42,
      url: "https://example.test/other-article",
      title: "Other Fixture",
    });

    expect(pagePaneEl.textContent).toContain("頁面已變更");
    expect(pagePaneEl.textContent).not.toContain("Sensitive stale excerpt.");
    expect(pagePaneEl.textContent).not.toContain("Sensitive stale runtime fixture text.");
  });

  it("offers, previews, and sends a user-confirmed screenshot analysis when vision is supported", async () => {
    const pagePaneEl = setupDom();
    const weakSurface = surface({
      mainText: "Sparse app-shell text without enough article content for direct analysis on this page.",
      excerpt: "Sparse app-shell text",
      extraction: {
        method: "fallback",
        status: "partial",
        warnings: ["no-main-content", "dynamic-content-partial"],
      },
    });
    const sentAnalysis: TrulyMessage[] = [];
    const sendMessage = vi.fn(async (message: TrulyMessage) => {
      if (message.type === "PAGE_READING_REQUEST") {
        return { type: "PAGE_READING_RESULT", tabId: 42, surface: weakSurface } satisfies TrulyMessage;
      }
      if (message.type === "GENERAL_PAGE_PARSER_ADVISOR_REQUEST") {
        expect(message.request.escalation.allowedDecisions).toContain("request_screenshot_region");
        return {
          type: "GENERAL_PAGE_PARSER_ADVISOR_RESULT",
          tabId: 42,
          ok: true,
          providerRuntime: { ...message.providerRuntime, mode: "tier-b-short-json" },
          advice: {
            schemaVersion: 1,
            pageType: "app_shell",
            decision: "request_screenshot_region",
            confidence: "medium",
            needsUserSelection: false,
            needsScreenshot: true,
            riskTags: ["needs_visual_grounding"],
            rationale: "Synthetic visual grounding request.",
          },
        } satisfies TrulyMessage;
      }
      if (message.type === "GENERAL_PAGE_ANALYSIS_REQUEST") {
        sentAnalysis.push(message);
        return {
          type: "GENERAL_PAGE_ANALYSIS_RESULT",
          tabId: 42,
          ok: true,
          brief: {
            schemaVersion: 1,
            summary: "Screenshot-grounded synthetic summary.",
            model: "vision-model",
            outputLang: "zh-TW",
          },
        } satisfies TrulyMessage;
      }
      throw new Error(`unexpected message ${(message as { type: string }).type}`);
    });
    const captureVisibleTab = vi.fn(async () => "data:image/jpeg;base64,c3ludGhldGljLXNjcmVlbnNob3Q=");
    const runtime = createSidepanelPageReadingRuntime({
      pagePaneEl,
      runtime: { sendMessage },
      tabs: {
        query: vi.fn(async () => [{
          id: 42,
          url: "https://example.test/article",
          title: "Runtime Fixture",
          windowId: 7,
        }]),
        get: vi.fn(async () => ({ id: 42, url: "https://example.test/article", windowId: 7 })),
        captureVisibleTab,
      },
      activateTab: vi.fn(),
      getLang: () => "zh-TW",
      getSettings: () => ({
        ...DEFAULT_SETTINGS,
        deepClassifyEnabled: true,
        tierBProvider: "openai-compatible",
        tierBEndpoint: "http://127.0.0.1:4999/v1/chat/completions",
        tierBModel: "vision-model",
      }),
      now: () => 1_000,
      getVisionSupported: () => true,
    });

    await runtime.requestReadCurrentPage("sidepanel");
    await flushMicrotasks();

    // Offer card renders; nothing was auto-sent because the advisor demands a user target.
    expect(pagePaneEl.textContent).toContain("截圖輔助分析");
    expect(pagePaneEl.textContent).not.toContain("分析準備");
    expect(pagePaneEl.textContent).not.toContain("分析範圍");
    expect(pagePaneEl.querySelector(".page-reader-warnings")).toBeNull();
    expect(pagePaneEl.textContent).not.toContain("no-main-content");
    expect(sentAnalysis).toHaveLength(0);

    pagePaneEl.querySelector<HTMLButtonElement>("#pageScreenshotCapture")?.click();
    await flushMicrotasks();
    expect(captureVisibleTab).toHaveBeenCalledWith(7, { format: "jpeg", quality: 80 });
    expect(pagePaneEl.querySelector(".page-reader-screenshot-preview")).toBeTruthy();

    runtime.handlePageReadingResult({
      type: "PAGE_READING_RESULT",
      tabId: 42,
      surface: weakSurface,
    });
    expect(pagePaneEl.querySelector(".page-reader-screenshot-preview")).toBeTruthy();

    pagePaneEl.querySelector<HTMLButtonElement>("#pageScreenshotConfirm")?.click();
    await flushMicrotasks();

    expect(sentAnalysis).toHaveLength(1);
    const request = sentAnalysis[0] as Extract<TrulyMessage, { type: "GENERAL_PAGE_ANALYSIS_REQUEST" }>;
    expect("mode" in request).toBe(false);
    expect(request.screenshotDataUrl).toContain("data:image/jpeg;base64");
    expect(pagePaneEl.textContent).toContain("Screenshot-grounded synthetic summary.");
  });

  it("rejects non-image screenshot data URLs before preview or model submission", async () => {
    const pagePaneEl = setupDom();
    const weakSurface = surface({
      mainText: "Sparse app-shell text without enough article content for direct analysis on this page.",
      excerpt: "Sparse app-shell text",
      extraction: {
        method: "fallback",
        status: "partial",
        warnings: ["no-main-content", "dynamic-content-partial"],
      },
    });
    const sentAnalysis: TrulyMessage[] = [];
    const sendMessage = vi.fn(async (message: TrulyMessage) => {
      if (message.type === "PAGE_READING_REQUEST") {
        return { type: "PAGE_READING_RESULT", tabId: 42, surface: weakSurface } satisfies TrulyMessage;
      }
      if (message.type === "GENERAL_PAGE_PARSER_ADVISOR_REQUEST") {
        return {
          type: "GENERAL_PAGE_PARSER_ADVISOR_RESULT",
          tabId: 42,
          ok: true,
          providerRuntime: { ...message.providerRuntime, mode: "tier-b-short-json" },
          advice: {
            schemaVersion: 1,
            pageType: "app_shell",
            decision: "request_screenshot_region",
            confidence: "medium",
            needsUserSelection: false,
            needsScreenshot: true,
            riskTags: ["needs_visual_grounding"],
            rationale: "Synthetic visual grounding request.",
          },
        } satisfies TrulyMessage;
      }
      if (message.type === "GENERAL_PAGE_ANALYSIS_REQUEST") {
        sentAnalysis.push(message);
        return {
          type: "GENERAL_PAGE_ANALYSIS_RESULT",
          tabId: 42,
          ok: true,
          brief: {
            schemaVersion: 1,
            summary: "Unexpected unsafe screenshot summary.",
            model: "vision-model",
            outputLang: "zh-TW",
          },
        } satisfies TrulyMessage;
      }
      throw new Error(`unexpected message ${(message as { type: string }).type}`);
    });
    const captureVisibleTab = vi.fn(async () => "data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==");
    const runtime = createSidepanelPageReadingRuntime({
      pagePaneEl,
      runtime: { sendMessage },
      tabs: {
        query: vi.fn(async () => [{
          id: 42,
          url: "https://example.test/article",
          title: "Runtime Fixture",
          windowId: 7,
        }]),
        get: vi.fn(async () => ({ id: 42, url: "https://example.test/article", windowId: 7 })),
        captureVisibleTab,
      },
      activateTab: vi.fn(),
      getLang: () => "zh-TW",
      getSettings: () => ({
        ...DEFAULT_SETTINGS,
        deepClassifyEnabled: true,
        tierBProvider: "openai-compatible",
        tierBEndpoint: "http://127.0.0.1:4999/v1/chat/completions",
        tierBModel: "vision-model",
      }),
      now: () => 1_000,
      getVisionSupported: () => true,
    });

    await runtime.requestReadCurrentPage("sidepanel");
    await flushMicrotasks();
    pagePaneEl.querySelector<HTMLButtonElement>("#pageScreenshotCapture")?.click();
    await flushMicrotasks();

    expect(pagePaneEl.querySelector(".page-reader-screenshot-preview")).toBeFalsy();
    expect(pagePaneEl.textContent).toContain("截圖流程失敗");
    expect(sentAnalysis).toHaveLength(0);
  });

  it("never offers the screenshot card without vision support", async () => {
    const pagePaneEl = setupDom();
    const weakSurface = surface({
      mainText: "Sparse app-shell text without enough article content for direct analysis on this page.",
      excerpt: "Sparse app-shell text",
      extraction: {
        method: "fallback",
        status: "partial",
        warnings: ["no-main-content", "dynamic-content-partial"],
      },
    });
    const sendMessage = vi.fn(async (message: TrulyMessage) => {
      if (message.type === "PAGE_READING_REQUEST") {
        return { type: "PAGE_READING_RESULT", tabId: 42, surface: weakSurface } satisfies TrulyMessage;
      }
      if (message.type === "GENERAL_PAGE_PARSER_ADVISOR_REQUEST") {
        expect(message.request.escalation.allowedDecisions).not.toContain("request_screenshot_region");
        return {
          type: "GENERAL_PAGE_PARSER_ADVISOR_RESULT",
          tabId: 42,
          ok: true,
          providerRuntime: { ...message.providerRuntime, mode: "rule-based-runtime-baseline" },
          advice: {
            schemaVersion: 1,
            pageType: "unknown",
            decision: "request_user_selection",
            confidence: "medium",
            needsUserSelection: true,
            needsScreenshot: false,
            riskTags: ["needs_user_attention"],
            rationale: "Synthetic selection request.",
          },
        } satisfies TrulyMessage;
      }
      throw new Error(`unexpected message ${(message as { type: string }).type}`);
    });
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
    await flushMicrotasks();

    expect(pagePaneEl.textContent).not.toContain("截圖輔助分析");
    expect(pagePaneEl.querySelector("#pageScreenshotCapture")).toBeNull();
  });

  it("removes tab sessions when Chrome reports the tab closed", async () => {
    const pagePaneEl = setupDom();
    let onRemoved: ((tabId: number, removeInfo: { windowId: number; isWindowClosing: boolean }) => void) | undefined;
    const runtime = createSidepanelPageReadingRuntime({
      pagePaneEl,
      runtime: {
        sendMessage: vi.fn(),
      },
      tabs: {
        query: vi.fn(async () => [{
          id: 42,
          url: "https://example.test/article",
          title: "Runtime Fixture",
        }]),
        onRemoved: {
          addListener: (listener) => {
            onRemoved = listener;
          },
        },
      },
      activateTab: vi.fn(),
      getLang: () => "zh-TW",
      now: () => 1_000,
    });

    runtime.install();
    await Promise.resolve();
    runtime.handlePageReadingResult({
      type: "PAGE_READING_RESULT",
      tabId: 42,
      surface: surface({ excerpt: "Closed tab excerpt." }),
    });

    expect(pagePaneEl.textContent).toContain("Closed tab excerpt.");
    onRemoved?.(42, { windowId: 1, isWindowClosing: false });

    expect(pagePaneEl.textContent).not.toContain("Closed tab excerpt.");
  });
});
