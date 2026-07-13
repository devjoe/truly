import { describe, expect, it } from "vitest";

import {
  buildPageClaimInvestigationTask,
  deterministicClaimQuestion,
  geminiEvidenceSearchUrl,
  standardEvidenceSearchUrl,
  usableClaimQuestion,
} from "@src/sidepanel/page-claim-investigation";

describe("page claim investigation contract", () => {
  it("prefers a grounded model question and adds bounded source context", () => {
    const task = buildPageClaimInvestigationTask({
      analysisKey: "analysis:key",
      scope: "page",
      claimIndex: 0,
      claim: {
        c: "Example Agency reported 232 affected products on July 8.",
        why: "The number affects public risk assessment.",
        need: "The agency announcement and product list.",
        q: "Which 232 products did Example Agency report on July 8?",
      },
      source: {
        title: "Synthetic public notice",
        sourceName: "Example News",
        publishedAt: "2026-07-08",
        url: "https://example.test/report",
      },
    });

    expect(task).toMatchObject({
      version: 1,
      scope: "page",
      question: "Which 232 products did Example Agency report on July 8",
      sourceUrl: "https://example.test/report",
    });
    expect(task?.searchQuery).toContain("Synthetic public notice");
    expect(task?.searchQuery).toContain("Example News");
    expect(standardEvidenceSearchUrl(task!.searchQuery)).not.toContain("udm=50");
    expect(geminiEvidenceSearchUrl(task!.searchQuery)).toContain("udm=50");
  });

  it("rejects unsafe or vague model queries and forms a natural fallback question", () => {
    expect(usableClaimQuestion("這篇文章是真的假的？")).toBeUndefined();
    expect(usableClaimQuestion("請用 Google 搜尋 https://example.test")).toBeUndefined();
    expect(usableClaimQuestion("gstudent.com.tw courses 001-social 課程 0713 漲價 折扣")).toBeUndefined();
    expect(usableClaimQuestion("產品是否通過檢驗？又是否為市場第一？")).toBeUndefined();
    expect(deterministicClaimQuestion({
      c: "某機構公布 232 項產品名單",
      why: "影響消費者判斷",
      need: "官方公告與完整名單",
    })).toBe("「某機構公布 232 項產品名單」是否有官方公告與完整名單支持？");
    expect(deterministicClaimQuestion({
      c: "Google搜尋結果會優先顯示偏好來源",
      why: "影響資訊來源選擇",
      need: "Google Search 官方說明",
    })).toBeUndefined();
    expect(deterministicClaimQuestion({
      c: "Google「偏好來源」功能會把指定網站優先顯示在搜尋結果",
      why: "影響資訊來源選擇",
      need: "官方功能說明",
    })).toBeUndefined();
    expect(deterministicClaimQuestion({
      c: "產品通過檢驗，且是市場第一",
      why: "影響購買決策",
      need: "第三方報告",
    })).toBeUndefined();
  });

  it("fails closed when the claim cannot form a useful task", () => {
    expect(buildPageClaimInvestigationTask({
      analysisKey: "analysis:key",
      scope: "focus",
      claimIndex: 0,
      claim: { c: "短", why: "不明", need: "來源" },
    })).toBeUndefined();
    expect(buildPageClaimInvestigationTask({
      analysisKey: "analysis:key",
      scope: "page",
      claimIndex: 0,
      claim: {
        c: "課程頁面宣稱限時折扣",
        why: "影響購買決策",
        need: "gstudent.com.tw/courses/001-social 的價格紀錄",
        q: "gstudent.com.tw courses 001-social 課程折扣",
      },
    })).toBeUndefined();
  });
});
