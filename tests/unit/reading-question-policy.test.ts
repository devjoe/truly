import { describe, expect, it } from "vitest";

import {
  isActionableLowRiskQuestionText,
  isAiImageFallbackQuestionText,
  isLowActionReadingBriefText,
  isLowValueReadingBriefQuestionText,
  isNaturalReadingBriefFollowUpQuestion,
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

  it("rejects source-seeking verification intent without banning ordinary deixis", () => {
    expect(isNaturalReadingBriefFollowUpQuestion("此貼文所引用之時間線數據來源為何？", "zh-TW")).toBe(false);
    expect(isNaturalReadingBriefFollowUpQuestion("這項研究引用了哪些資料來源？", "zh-TW")).toBe(false);
    expect(isNaturalReadingBriefFollowUpQuestion("這些數據從何而來？", "zh-TW")).toBe(false);
    expect(isNaturalReadingBriefFollowUpQuestion("引用依據是什麼？", "zh-TW")).toBe(false);
    expect(isNaturalReadingBriefFollowUpQuestion("此制度有哪些不同觀點？", "zh-TW")).toBe(true);
    expect(isNaturalReadingBriefFollowUpQuestion("官方資料如何形塑不同政策觀點？", "zh-TW")).toBe(true);
    expect(isNaturalReadingBriefFollowUpQuestion("這項政策的經費來源為何？", "zh-TW")).toBe(true);
    expect(isNaturalReadingBriefFollowUpQuestion("政策爭議的來源為何？", "zh-TW")).toBe(true);
  });

  it("rejects English source requests while keeping source-literacy questions", () => {
    expect(isNaturalReadingBriefFollowUpQuestion("What are the sources for the reported timeline?", "en")).toBe(false);
    expect(isNaturalReadingBriefFollowUpQuestion("Where did these figures come from?", "en")).toBe(false);
    expect(isNaturalReadingBriefFollowUpQuestion("How do source-selection methods affect this benchmark?", "en")).toBe(true);
    expect(isNaturalReadingBriefFollowUpQuestion("What source-selection methods shape this benchmark?", "en")).toBe(true);
    expect(isNaturalReadingBriefFollowUpQuestion("Which sources of institutional resistance shaped the reform?", "en")).toBe(true);
    expect(isNaturalReadingBriefFollowUpQuestion("Where does institutional resistance come from?", "en")).toBe(true);
    expect(isNaturalReadingBriefFollowUpQuestion("Where do these policy tensions come from?", "en")).toBe(true);
  });
});
