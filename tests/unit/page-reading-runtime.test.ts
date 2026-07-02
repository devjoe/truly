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
    expect(pagePaneEl.textContent).toContain("設定允許一般網頁的所有網站存取權");
  });

  it("maps page-access errors to a friendly retry explanation", async () => {
    const pagePaneEl = setupDom();
    const sendMessage = vi.fn(async () => ({
      type: "PAGE_READING_ERROR",
      tabId: 42,
      error: "page_grant_missing",
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
    expect(pagePaneEl.textContent).toContain("設定允許一般網頁的所有網站存取權");
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
    expect(pagePaneEl.textContent).toContain("模型脈絡");
    expect(pagePaneEl.textContent).toContain("可送模型（尚未送出）");
    expect(pagePaneEl.textContent).toContain("文字門檻");
    expect(pagePaneEl.textContent).toContain("來源連結");
    expect(pagePaneEl.textContent).toContain("Synthetic source");
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
    expect(pagePaneEl.textContent).toContain("Reading context");
    expect(pagePaneEl.textContent).toContain("本地通過");
    expect(pagePaneEl.textContent).toContain("accept_current");
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

    expect(pagePaneEl.textContent).toContain("模型脈絡");
    expect(pagePaneEl.textContent).toContain("暫不送模型");
    expect(pagePaneEl.textContent).toContain("可讀文字低於目前門檻");
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

    expect(pagePaneEl.textContent).toContain("需改善抽取（尚未送出）");
    expect(pagePaneEl.textContent).toContain("目前使用 fallback 抽取");
    expect(pagePaneEl.textContent).toContain("偵測到大量導覽噪音");
    expect(pagePaneEl.textContent).toContain("Article source");
    expect(pagePaneEl.textContent).not.toContain("請至 Edge 官網下載");
    expect(pagePaneEl.textContent).not.toContain("請至 Firefox 官網下載");
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
    expect(pagePaneEl.textContent).toContain("Reading context");
    expect(pagePaneEl.textContent).toContain("已建立");
    expect(pagePaneEl.textContent).toContain("downgrade_to_index_or_feed");
    expect(pagePaneEl.textContent).toContain("page_overview_only");
    expect(pagePaneEl.textContent).toContain("只適合頁面總覽");
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
    expect(pagePaneEl.textContent).toContain("prefer_candidate_block");
    expect(pagePaneEl.textContent).toContain("article_or_selection_analysis");
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
    expect(pagePaneEl.textContent).toContain("目標");
    expect(pagePaneEl.textContent).toContain("selection");
    expect(pagePaneEl.textContent).toContain("Reading context");
    expect(pagePaneEl.textContent).toContain("accept_current");
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
        mainText: "Sensitive stale runtime fixture text.",
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
