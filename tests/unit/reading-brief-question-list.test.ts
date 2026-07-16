import { JSDOM } from "jsdom";
import { describe, expect, it, vi } from "vitest";

import { createReadingBriefQuestionList } from "@src/sidepanel/reading-brief-renderer";
import { visibleReadingBriefQuestions } from "@src/sidepanel/reading-brief-visibility";
import type { DashboardPostEvent, ReadingBrief } from "@src/lib/types";

describe("shared reading brief question list", () => {
  it("uses one semantic row and action contract for Feed, Web, and Focus", () => {
    const dom = new JSDOM("<!doctype html><body></body>", { url: "https://example.test/" });
    globalThis.document = dom.window.document;
    const onCopy = vi.fn();

    const block = createReadingBriefQuestionList({
      label: "延伸問題",
      items: [
        { displayQuestion: "第一個延伸問題？", searchQuery: "第一個延伸問題 synthetic" },
        { displayQuestion: "第二個較長的延伸問題，用來驗證換行時 action 仍維持同一欄？", searchQuery: "第二個延伸問題 synthetic" },
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
      items: [{ displayQuestion: "唯一的延伸問題？", searchQuery: "唯一的延伸問題 synthetic" }],
      lang: "zh-TW",
    });

    expect(block.classList.contains("is-single")).toBe(true);
    expect(block.querySelector(".reading-brief-question-list")?.tagName).toBe("UL");
    expect(block.querySelector(".reading-brief-question-row")?.tagName).toBe("LI");
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
