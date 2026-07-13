import { JSDOM } from "jsdom";
import { describe, expect, it, vi } from "vitest";

import { createReadingBriefQuestionList } from "@src/sidepanel/reading-brief-renderer";

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
