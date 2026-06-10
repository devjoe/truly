import { describe, expect, it } from "vitest";

import {
  isActionableLowRiskQuestionText,
  isAiImageFallbackQuestionText,
  isLowActionReadingBriefText,
  isLowValueReadingBriefQuestionText,
} from "@src/lib/reading-question-policy";

describe("reading question policy", () => {
  it("keeps official-source questions actionable even in low-risk posts", () => {
    expect(isActionableLowRiskQuestionText("官方公告是否有版本更新？")).toBe(true);
    expect(isActionableLowRiskQuestionText("這個 SDK 的 GitHub repo 在哪裡？")).toBe(true);
  });

  it("suppresses low-value low-risk questions", () => {
    expect(isActionableLowRiskQuestionText("這篇是否無需事實查核？")).toBe(false);
    expect(isLowValueReadingBriefQuestionText("這是否只是純個人分享？")).toBe(true);
    expect(isLowActionReadingBriefText("純生活分享，無需查核")).toBe(true);
  });

  it("allows the AI-image fallback question as a deliberate exception", () => {
    const question = "這張圖片是否為 AI 生成或模板素材？";
    expect(isAiImageFallbackQuestionText(question)).toBe(true);
    expect(isActionableLowRiskQuestionText(question, "低風險個人分享")).toBe(true);
  });
});
