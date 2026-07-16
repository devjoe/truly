import { JSDOM } from "jsdom";
import { describe, expect, it, vi } from "vitest";

import { createReadingBriefQuestionList } from "@src/sidepanel/reading-brief-renderer";
import { renderReadingBriefSectionElement } from "@src/sidepanel/reading-brief-section-renderer";
import { visibleReadingBriefQuestions } from "@src/sidepanel/reading-brief-visibility";
import { buildReadingBriefQuestionActionPayload } from "@src/sidepanel/reading-brief-text";
import type { ReadingBriefRequestGate } from "@src/sidepanel/reading-brief-gate";
import type { DashboardPostEvent, ReadingBrief } from "@src/lib/types";

const runnableReadingBriefGate = {
  canRequest: true,
  featureGate: {
    feature: "reading_brief",
    provider: "openai-compatible",
    effectiveProvider: "openai-compatible",
    endpoint: "http://localhost:11434",
    model: "synthetic-model",
    canRun: true,
    canTest: true,
  },
} satisfies ReadingBriefRequestGate;

describe("shared reading brief question list", () => {
  it("uses one semantic row and action contract for Feed, Web, and Focus", () => {
    const dom = new JSDOM("<!doctype html><body></body>", { url: "https://example.test/" });
    globalThis.document = dom.window.document;
    const onCopy = vi.fn();

    const block = createReadingBriefQuestionList({
      label: "延伸問題",
      items: [
        buildReadingBriefQuestionActionPayload({ question: "第一個延伸問題？", kind: "context" }),
        buildReadingBriefQuestionActionPayload({
          question: "第二個較長的延伸問題，用來驗證換行時 action 仍維持同一欄？",
          kind: "counter",
        }),
      ],
      lang: "zh-TW",
      blockClassName: "page-reader-analysis-section page-reader-analysis-questions",
      copyButtonClassName: "page-analysis-question-copy",
      onCopy,
    });

    expect(block.classList.contains("reading-brief-question-block")).toBe(true);
    expect(block.querySelector(".reading-brief-block-label")?.textContent).toBe("延伸問題");
    const list = block.querySelector(".reading-brief-question-list");
    expect(list?.tagName).toBe("UL");
    expect(list?.querySelectorAll(":scope > .reading-brief-question-row")).toHaveLength(2);
    expect(list?.querySelector(":scope > .reading-brief-question-row")?.tagName).toBe("LI");
    expect(block.querySelectorAll(".reading-brief-question-actions")).toHaveLength(2);
    expect(block.querySelectorAll(".reading-brief-google-link")).toHaveLength(2);

    const copy = block.querySelector<HTMLButtonElement>(".page-analysis-question-copy");
    copy?.click();
    expect(onCopy).toHaveBeenCalledWith(copy, "第一個延伸問題？");
  });

  it("marks a single-question list without changing its semantic structure", () => {
    const dom = new JSDOM("<!doctype html><body></body>", { url: "https://example.test/" });
    globalThis.document = dom.window.document;

    const block = createReadingBriefQuestionList({
      label: "延伸問題",
      items: [buildReadingBriefQuestionActionPayload({ question: "唯一的延伸問題？", kind: "understand" })],
      lang: "zh-TW",
    });

    expect(block.classList.contains("is-single")).toBe(true);
    expect(block.querySelector(".reading-brief-question-list")?.tagName).toBe("UL");
    expect(block.querySelector(".reading-brief-question-row")?.tagName).toBe("LI");
  });
});

describe("reading brief question action payload", () => {
  it("separates model, display, copy, search, AI Mode, and non-runtime agent representations", () => {
    const action = buildReadingBriefQuestionActionPayload({
      question: "這篇文章有哪些不同觀點？",
      kind: "counter",
      lang: "zh-TW",
      source: {
        title: "測試政策新聞",
        summary: "頁面整理一項合成政策的支持與反對意見。",
        url: "https://example.com/policy?fbclid=tracking&token=secret#private",
      },
    });

    expect(action).toMatchObject({
      version: 1,
      modelText: "這篇文章有哪些不同觀點？",
      displayText: "有哪些不同觀點？",
      agentTask: {
        version: 1,
        type: "reading_follow_up",
        kind: "counter",
        question: "有哪些不同觀點？",
      },
    });
    expect(action.copyText).toContain("來源：測試政策新聞");
    expect(action.copyText).toContain("問題：有哪些不同觀點？");
    expect(action.copyText).not.toContain("https://");
    expect(action.googleQuery).toBe("測試政策新聞 有哪些不同觀點？");
    expect(action.googleQuery).not.toContain("https://");
    expect(action.aiModePrompt).toContain("連結：https://example.com/policy");
    expect(action.aiModePrompt).not.toContain("secret");
    expect(action.aiModePrompt).toContain("請優先找可公開查證的來源");
    expect(action.agentTask.sourceUrl).toBe("https://example.com/policy");
  });

  it("preserves required action text while truncating only optional context", () => {
    const question = `${"很長的政策名稱".repeat(14)}有哪些不同觀點？`;
    const action = buildReadingBriefQuestionActionPayload({
      question,
      kind: "counter",
      lang: "zh-TW",
      source: {
        title: "很長的來源標題".repeat(40),
        summary: "很長的摘要脈絡".repeat(40),
        url: `https://example.com/${"long-path/".repeat(20)}`,
      },
    });

    expect(action.copyText.endsWith(action.displayText)).toBe(true);
    expect(action.googleQuery.endsWith(action.displayText)).toBe(true);
    expect(action.aiModePrompt).toContain(`問題：${action.displayText}`);
    expect(action.aiModePrompt.endsWith("請優先找可公開查證的來源。")).toBe(true);
    expect(Array.from(action.copyText).length).toBeLessThanOrEqual(520);
    expect(Array.from(action.googleQuery).length).toBeLessThanOrEqual(240);
    expect(Array.from(action.aiModePrompt).length).toBeLessThanOrEqual(760);
  });

  it("does not splice a page summary into a self-contained question action", () => {
    const action = buildReadingBriefQuestionActionPayload({
      question: "Which document supports the July 8 sports eligibility ruling?",
      kind: "context",
      lang: "en",
      source: {
        title: "Supreme Court policy coverage",
        summary: "The Supreme Court issued a separate tax ruling with a different outcome.",
        url: "https://example.com/policy",
      },
    });

    expect(action.copyText).toBe(action.displayText);
    expect(action.googleQuery).toBe(action.displayText);
    expect(action.aiModePrompt).not.toContain("tax ruling");
    expect(action.agentTask.context).toBeUndefined();
    expect(action.agentTask.sourceUrl).toBe("https://example.com/policy");
  });

  it("uses the post summary instead of a link-preview title for a deictic post question", () => {
    const action = buildReadingBriefQuestionActionPayload({
      question: "這篇貼文有哪些不同觀點？",
      kind: "counter",
      source: {
        title: "外部連結的另一個主題",
        summary: "貼文整理合成政策的支持與反對意見。",
      },
    });

    expect(action.copyText).toContain("合成政策的支持與反對意見");
    expect(action.copyText).not.toContain("外部連結的另一個主題");
    expect(action.googleQuery).toContain("合成政策的支持與反對意見");
    expect(action.agentTask.context).toContain("合成政策的支持與反對意見");
  });

  it("does not send local, credentialed, or query metadata URLs to AI Mode", () => {
    for (const url of [
      ["http://", "local", "host/private"].join(""),
      ["http://", "192", ".168.1.9/private"].join(""),
      "https://user:secret@example.com/private",
      ["http://", "gx10", ".local:8000/v1"].join(""),
    ]) {
      const action = buildReadingBriefQuestionActionPayload({
        question: "有哪些不同觀點？",
        kind: "counter",
        source: { title: "Public title", url },
      });
      expect(action.aiModePrompt).not.toContain(url);
      expect(action.agentTask.sourceUrl).toBeUndefined();
    }
  });

  it("copies the portable payload while keeping the visible label concise", () => {
    const dom = new JSDOM("<!doctype html><body></body>", { url: "https://example.test/" });
    globalThis.document = dom.window.document;
    const onCopy = vi.fn();
    const action = buildReadingBriefQuestionActionPayload({
      question: "這篇文章有哪些不同觀點？",
      kind: "counter",
      source: { title: "測試政策新聞" },
    });
    const block = createReadingBriefQuestionList({
      label: "延伸問題",
      items: [action],
      lang: "zh-TW",
      onCopy,
    });

    expect(block.querySelector(".reading-brief-question-text")?.textContent).toBe(action.displayText);
    expect(block.querySelector<HTMLButtonElement>(".reading-brief-copy-btn")?.dataset.question).toBe(action.copyText);
    const copy = block.querySelector<HTMLButtonElement>(".reading-brief-copy-btn");
    copy?.click();
    expect(onCopy).toHaveBeenCalledWith(copy, action.copyText);
    const href = block.querySelector<HTMLAnchorElement>(".reading-brief-google-link")?.href;
    expect(new URL(href!).searchParams.get("q")).toBe(action.aiModePrompt);
    expect(new URL(href!).searchParams.get("udm")).toBe("50");
  });
});

describe("reading brief loading surface", () => {
  const event = {
    id: "synthetic-loading-event",
    text: "Synthetic Facebook post",
    hasMedia: false,
    decision: {
      scores: {},
      deepClassification: {
        summary: "Synthetic summary",
        outputLang: "zh-TW",
        commercialIntent: 0,
        textAiLikelihood: 0,
        imageAiLikelihood: 0,
        lowQualitySignal: 0,
      },
    },
  } as DashboardPostEvent;

  it("reserves a non-interactive visual frame while keeping one live status", () => {
    const dom = new JSDOM("<!doctype html><body></body>", { url: "https://example.test/" });
    globalThis.document = dom.window.document;

    const section = renderReadingBriefSectionElement({
      event,
      pending: true,
      requestGate: runnableReadingBriefGate,
      revealedIds: new Set(),
      onRetry: vi.fn(),
    });

    expect(section?.classList.contains("is-loading")).toBe(true);
    expect(section?.getAttribute("aria-busy")).toBe("true");
    expect(section?.querySelectorAll('[role="status"][aria-live="polite"]')).toHaveLength(1);
    const reserve = section?.querySelector(".reading-brief-loading-reserve");
    expect(reserve?.getAttribute("aria-hidden")).toBe("true");
    expect(reserve?.querySelectorAll("span")).toHaveLength(5);
    expect(reserve?.querySelector("button, a, input, [tabindex]")).toBeNull();
  });

  it("removes the reserve once the reading brief is ready", () => {
    const dom = new JSDOM("<!doctype html><body></body>", { url: "https://example.test/" });
    globalThis.document = dom.window.document;
    const readyEvent = {
      ...event,
      readingBrief: {
        model: "synthetic-model",
        outputLang: "zh-TW",
        bg: [{ t: "背景", why: "協助理解內容。" }],
      },
    } as DashboardPostEvent;

    const section = renderReadingBriefSectionElement({
      event: readyEvent,
      pending: false,
      requestGate: { ...runnableReadingBriefGate, canRequest: false },
      revealedIds: new Set(),
      onRetry: vi.fn(),
    });

    expect(section?.classList.contains("is-loading")).toBe(false);
    expect(section?.hasAttribute("aria-busy")).toBe(false);
    expect(section?.querySelector(".reading-brief-loading-reserve")).toBeNull();
    expect(section?.querySelector(".reading-brief-body")).not.toBeNull();
  });
});

describe("reading brief follow-up semantics", () => {
  const lookupWorthyEvent = {
    text: "Enzo 稱梅西最後一次參加世界盃。",
    summary: "貼文談論世界盃賽事。",
    hasMedia: false,
    decision: {
      scores: { political: 0 },
      deepClassification: {
        summary: "貼文包含需要確認的賽事與參賽狀態。",
        commercialIntent: 0,
        textAiLikelihood: 0,
        imageAiLikelihood: 0,
        lowQualitySignal: 0.7,
        informationQuality: {
          factualRisk: 0.9,
          manipulationRisk: 0,
          needsFactCheck: true,
        },
      },
    },
  } as DashboardPostEvent;

  it("does not relabel legacy verification queries as follow-up questions", () => {
    const brief = {
      model: "legacy-model",
      outputLang: "zh-TW",
      claims: [{
        c: "Enzo 稱梅西最後一次參加世界盃",
        why: "核心時序主張",
        need: "梅西 2026 世界盃參賽狀態",
        q: "梅西是否參加 2026 世界盃？",
      }],
      qs: [
        { q: "梅西是否參加 2026 世界盃？", kind: "verify" },
        { q: "Enzo Fernandez 2026 World Cup England goal", kind: "context" },
      ],
    } as ReadingBrief;

    expect(visibleReadingBriefQuestions(lookupWorthyEvent, brief, [
      "Enzo 稱梅西最後一次參加世界盃（需要證據：梅西 2026 世界盃參賽狀態）",
    ], "zh-TW")).toEqual([]);
  });

  it("keeps a natural background question in the requested language", () => {
    const brief = {
      model: "current-model",
      outputLang: "zh-TW",
      qs: [{
        q: "Enzo 與梅西在阿根廷國家隊的合作歷程為何？",
        kind: "context",
      }],
    } as ReadingBrief;

    expect(visibleReadingBriefQuestions(lookupWorthyEvent, brief, [], "zh-TW"))
      .toEqual(brief.qs);
  });
});
