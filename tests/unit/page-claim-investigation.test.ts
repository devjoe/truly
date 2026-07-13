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
        q: "Is it true that Example Agency reported 232 affected products on July 8?",
        atom: { s: "Example Agency", p: "reported", o: "232 affected products" },
      },
      source: {
        title: "Synthetic public notice",
        sourceName: "Example News",
        publishedAt: "2026-07-08",
        url: "https://example.test/report",
      },
    });

    expect(task).toMatchObject({
      version: 2,
      scope: "page",
      question: "Is it true that Example Agency reported 232 affected products on July 8",
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
    expect(usableClaimQuestion("USPS 是否收到 900 萬件假郵資包裹，且涉案者是否購買 12 間房？")).toBeUndefined();
    expect(usableClaimQuestion("課程是否提供30小時內容且折扣碼可折350元？")).toBeUndefined();
    expect(usableClaimQuestion("某機構公布 232 項產品名單")).toBeUndefined();
    expect(deterministicClaimQuestion({
      c: "某機構公布 232 項產品名單。",
      why: "影響消費者判斷",
      need: "官方公告與完整名單",
      atom: { s: "某機構", p: "公布", o: "232 項產品名單" },
    })).toBe("「某機構公布 232 項產品名單」是否有外部證據支持？");
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
      c: "產品通過檢驗，且是市場第一。",
      why: "影響購買決策",
      need: "第三方報告",
      atom: { s: "產品", p: "通過", o: "檢驗" },
    })).toBeUndefined();
  });

  it("requires a parser-retained atomic proposition before preparing an action", () => {
    expect(buildPageClaimInvestigationTask({
      analysisKey: "analysis:key",
      scope: "page",
      claimIndex: 0,
      claim: {
        c: "Example Agency reported 232 affected products.",
        why: "The result affects public safety.",
        need: "The agency announcement.",
        q: "Did Example Agency report 232 affected products?",
      },
    })).toBeUndefined();

    expect(buildPageClaimInvestigationTask({
      analysisKey: "analysis:key",
      scope: "page",
      claimIndex: 0,
      claim: {
        c: "Example Agency reported 232 affected products.",
        why: "The result affects public safety.",
        need: "The agency announcement.",
        q: "Did Example Agency report 232 affected products?",
        atom: { s: "Example Agency", p: "published", o: "232 affected products" },
      },
    })).toBeUndefined();
  });

  it("rejects an incomplete claim sentence even when its atom is internally consistent", () => {
    expect(buildPageClaimInvestigationTask({
      analysisKey: "analysis:key",
      scope: "page",
      claimIndex: 0,
      claim: {
        c: "The court upheld bans on athletes in female",
        why: "The ruling affects rights.",
        need: "The complete ruling.",
        q: "Did the court uphold bans on athletes in female?",
        atom: { s: "court", p: "upheld", o: "bans on athletes in female" },
      },
    })).toBeUndefined();
  });

  it("rejects vague atom parts and overlong deterministic questions", () => {
    expect(deterministicClaimQuestion({
      c: "AI 不知道這段內容。",
      why: "產品宣稱 AI 有限制。",
      need: "技術文件",
      atom: { s: "AI", p: "不知道", o: "這段內容" },
    })).toBeUndefined();

    const longObject = `a ${"very ".repeat(35)}long outcome`.trim();
    expect(deterministicClaimQuestion({
      c: `Example Agency reported ${longObject}.`,
      why: "The outcome affects safety.",
      need: "Official evidence.",
      atom: { s: "Example Agency", p: "reported", o: longObject },
    })).toBeUndefined();
  });

  it("rejects a model query that omits the atomic relation", () => {
    expect(usableClaimQuestion(
      "Acme Model 9 passed the safety audit?",
      { s: "Acme Model 9", p: "did not pass", o: "the safety audit" },
      "Acme Model 9 did not pass the safety audit.",
    )).toBeUndefined();
  });

  it("preserves an outer attribution instead of silently checking the inner assertion", () => {
    const attributedClaim = {
      c: "烏克蘭政府估計，俄羅斯飛彈有九成裝著日本製零件。",
      why: "涉及武器供應鏈與出口管制。",
      need: "烏克蘭政府原始估計。",
      atom: { s: "俄羅斯飛彈", p: "有九成裝著", o: "日本製零件" },
    };

    expect(usableClaimQuestion(
      "烏克蘭政府是否估計俄羅斯飛彈有九成裝著日本製零件？",
      attributedClaim.atom,
      attributedClaim.c,
    )).toBeDefined();
    expect(usableClaimQuestion(
      "俄羅斯飛彈是否有九成裝著日本製零件？",
      attributedClaim.atom,
      attributedClaim.c,
    )).toBeUndefined();
    expect(deterministicClaimQuestion(attributedClaim)).toBeUndefined();
  });

  it("keeps charge, bail, conviction, and sentencing stages distinct", () => {
    const chargedClaim = {
      c: "Joseph Horner 被控二級謀殺罪。",
      why: "涉及刑事司法程序",
      need: "檢方起訴文件",
      atom: { s: "Joseph Horner", p: "被控", o: "二級謀殺罪" },
    };

    expect(buildPageClaimInvestigationTask({
      analysisKey: "analysis:key",
      scope: "page",
      claimIndex: 0,
      claim: {
        ...chargedClaim,
        q: "Joseph Horner 是否被控二級謀殺罪？",
      },
    })).toBeDefined();

    const recovered = buildPageClaimInvestigationTask({
      analysisKey: "analysis:key",
      scope: "page",
      claimIndex: 0,
      claim: {
        ...chargedClaim,
        q: "紐約州法院是否裁定 Joseph Horner 二級謀殺罪成立？",
      },
    });
    expect(recovered?.question).toContain("Joseph Horner 被控二級謀殺罪");
    expect(recovered?.question).not.toContain("法院");

    expect(buildPageClaimInvestigationTask({
      analysisKey: "analysis:key",
      scope: "page",
      claimIndex: 0,
      claim: {
        c: "Joseph Horner 被控二級謀殺罪，法院裁定不得交保。",
        why: "涉及刑事司法程序",
        need: "起訴與保釋文件",
        q: "Joseph Horner 是否被控二級謀殺罪且不得交保？",
        atom: { s: "Joseph Horner", p: "被控", o: "二級謀殺罪" },
      },
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
        c: "USPS 收到 900 萬件假郵資包裹，涉案者因此買了 12 間房。",
        why: "涉及郵政詐欺規模。",
        need: "法院文件。",
        q: "USPS 是否收到 900 萬件假郵資包裹？",
        atom: { s: "USPS", p: "收到", o: "900 萬件假郵資包裹" },
      },
    })).toBeUndefined();
    expect(buildPageClaimInvestigationTask({
      analysisKey: "analysis:key",
      scope: "page",
      claimIndex: 0,
      claim: {
        c: "產品宣稱適合孩童，且通過 831 項檢驗",
        why: "影響健康安全",
        need: "產品檢驗報告",
        q: "產品是否適合孩童使用？",
        atom: { s: "產品", p: "宣稱適合", o: "孩童" },
      },
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
        atom: { s: "課程頁面", p: "宣稱", o: "限時折扣" },
      },
    })).toBeUndefined();
  });
});
