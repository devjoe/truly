import { JSDOM } from "jsdom";
import { describe, expect, it, vi } from "vitest";

import type { TrulyMessage } from "@src/lib/messages";
import type { ReadingSurface } from "@src/lib/reading-surface-types";
import { DEFAULT_SETTINGS } from "@src/lib/types";
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

  it("switches among saved page sessions without implicitly activating Chrome tabs", async () => {
    const pagePaneEl = setupDom();
    let activeId = 42;
    let onActivated: ((activeInfo: { tabId: number; windowId: number }) => void) | undefined;
    const tabsById = new Map<number, { id: number; url: string; title: string; windowId: number }>([
      [42, { id: 42, url: "https://first.example.test/article", title: "First Article", windowId: 7 }],
      [43, { id: 43, url: "https://second.example.test/article", title: "Second Article", windowId: 7 }],
    ]);
    const update = vi.fn(async (tabId: number, updateProperties: { active?: boolean }) => {
      if (updateProperties.active) activeId = tabId;
      return tabsById.get(tabId)!;
    });
    const focusWindow = vi.fn(async () => undefined);
    const runtime = createSidepanelPageReadingRuntime({
      pagePaneEl,
      runtime: { sendMessage: vi.fn() },
      tabs: {
        query: vi.fn(async () => [tabsById.get(activeId)!]),
        get: vi.fn(async (tabId: number) => tabsById.get(tabId)!),
        update,
        focusWindow,
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

    expect(pagePaneEl.textContent).toContain("已讀網頁");
    expect(pagePaneEl.textContent).toContain("Second saved excerpt.");

    const firstButton = Array.from(pagePaneEl.querySelectorAll<HTMLButtonElement>("[data-page-session-tab-id]"))
      .find((button) => button.textContent?.includes("First Article"));
    firstButton?.click();

    expect(pagePaneEl.textContent).toContain("First saved excerpt.");
    expect(update).not.toHaveBeenCalled();
    expect(focusWindow).not.toHaveBeenCalled();
    expect(runtime.auditState().activeTabId).toBe(43);
    expect(pagePaneEl.querySelector<HTMLButtonElement>("#pageReadSelection")?.disabled).toBe(true);
    expect(pagePaneEl.textContent).toContain("切到此分頁");

    pagePaneEl.querySelector<HTMLButtonElement>("#pageActivateDisplayedTab")?.click();
    await flushMicrotasks();
    await flushMicrotasks();

    expect(update).toHaveBeenCalledWith(42, { active: true });
    expect(focusWindow).toHaveBeenCalledWith(7);
    expect(runtime.auditState().activeTabId).toBe(42);
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
    expect(pagePaneEl.textContent).toContain("Reading context");
    expect(pagePaneEl.textContent).toContain("本地通過");
    expect(pagePaneEl.textContent).toContain("accept_current");
  });

  it("auto-generates a session-only General Page brief when Tier B is available", async () => {
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
        expect(message.context.mainText).toContain("Runtime fixture text long enough");
        return {
          type: "GENERAL_PAGE_ANALYSIS_RESULT",
          tabId: 42,
          ok: true,
          brief: {
            schemaVersion: 1,
            summary: "Synthetic model summary for the current page.",
            bg: [{ t: "Context", why: "The page is a synthetic runtime article." }],
            claims: [{ c: "Runtime claim", why: "It is central to the sample.", need: "Check the source." }],
            qs: [{ q: "What source supports the runtime claim?", kind: "source" }],
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
    expect(pagePaneEl.textContent).toContain("頁面重點");
    expect(pagePaneEl.textContent).toContain("Synthetic model summary for the current page.");
    expect(pagePaneEl.textContent).toContain("Runtime claim");
    expect(pagePaneEl.textContent).toContain("brief-model 使用 1.2 秒");
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
            summary: "Synthetic overview generated after Tier B parser advisor.",
            claims: [{
              c: "This claim should be stripped by overview guard.",
              why: "Overview mode should not render claims.",
              need: "No claim needed.",
            }],
            qs: [{ q: "Which linked card should the reader inspect?", kind: "source" }],
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
    expect(pagePaneEl.textContent).toContain("page_overview_only");
    expect(pagePaneEl.textContent).toContain("Synthetic overview generated after Tier B parser advisor.");
    expect(pagePaneEl.textContent).not.toContain("This claim should be stripped");
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
    expect(pagePaneEl.textContent).toContain("requires_user_target");
    expect(pagePaneEl.textContent).toContain("需要使用者選取段落");
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
    expect(sentAnalysis).toHaveLength(0);

    pagePaneEl.querySelector<HTMLButtonElement>("#pageScreenshotCapture")?.click();
    await flushMicrotasks();
    expect(captureVisibleTab).toHaveBeenCalledWith(7, { format: "jpeg", quality: 80 });
    expect(pagePaneEl.querySelector(".page-reader-screenshot-preview")).toBeTruthy();

    pagePaneEl.querySelector<HTMLButtonElement>("#pageScreenshotConfirm")?.click();
    await flushMicrotasks();

    expect(sentAnalysis).toHaveLength(1);
    const request = sentAnalysis[0] as Extract<TrulyMessage, { type: "GENERAL_PAGE_ANALYSIS_REQUEST" }>;
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
