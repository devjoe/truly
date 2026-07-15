import { describe, expect, it } from "vitest";

import {
  buildPageClaimInvestigationTask,
  deterministicClaimQuestion,
  geminiEvidenceSearchUrl,
  pageClaimInvestigationEligibility,
  standardEvidenceSearchUrl,
  usableClaimQuestion,
} from "@src/sidepanel/page-claim-investigation";

describe("page claim investigation contract", () => {
  it("prefers a grounded model question and adds bounded source context", () => {
    const task = buildPageClaimInvestigationTask({
      analysisKey: "analysis:key",
      scope: "page",
      claimIndex: 0,
      groundingText: "Example Agency reported 232 affected products on July 8.",
      claim: {
        c: "Example Agency reported 232 affected products on July 8.",
        why: "The number affects public risk assessment.",
        need: "The agency announcement and product list.",
        q: "Is it true that Example Agency reported 232 affected products on July 8?",
        atom: { s: "Example Agency", p: "reported", o: "232 affected products" },
        policy: { claimKind: "fact", consequence: "safety" },
      },
      source: {
        title: "Synthetic public notice",
        sourceName: "Example News",
        publishedAt: "2026-07-08",
        url: "https://example.test/report",
      },
    });

    expect(task).toMatchObject({
      version: 4,
      scope: "page",
      intent: {
        exactClaim: "Example Agency reported 232 affected products on July 8.",
        evidenceNeed: "The agency announcement and product list.",
        question: "Is it true that Example Agency reported 232 affected products on July 8",
      },
      sourceUrl: "https://example.test/report",
    });
    expect(task?.googleKeywords).toContain("Synthetic public notice");
    expect(task?.googleKeywords).not.toContain("Is “Synthetic public notice");
    expect(task?.aiModePrompt).toContain("Synthetic public notice");
    expect(task?.aiModePrompt).toContain("The agency announcement and product list");
    expect(task?.aiModePrompt).not.toContain("..");
    expect(task?.aiModePrompt).not.toBe(task?.googleKeywords);
    expect(standardEvidenceSearchUrl(task!.googleKeywords)).not.toContain("udm=50");
    expect(geminiEvidenceSearchUrl(task!.aiModePrompt)).toContain("udm=50");
  });

  it("requires typed consequence policy before exposing an investigation action", () => {
    const legacyClaim = {
      c: "Example Agency reported 232 affected products.",
      why: "The result affects public safety.",
      need: "The agency announcement.",
      q: "Did Example Agency report 232 affected products?",
      atom: { s: "Example Agency", p: "reported", o: "232 affected products" },
    };

    expect(pageClaimInvestigationEligibility(legacyClaim)).toEqual({
      ok: false,
      reason: "missing_policy",
    });
    expect(buildPageClaimInvestigationTask({
      analysisKey: "analysis:key",
      scope: "page",
      claimIndex: 0,
      claim: legacyClaim,
    })).toBeUndefined();
  });

  it("keeps low-consequence availability, opinion, and generic controversy as context only", () => {
    const cases = [
      {
        c: "Example Phone is now available in blue.",
        why: "It affects a routine purchase choice.",
        need: "The product page.",
        q: "Is Example Phone now available in blue?",
        atom: { s: "Example Phone", p: "is now available", o: "in blue" },
        policy: { claimKind: "fact" as const, consequence: "money" as const },
      },
      {
        c: "A reviewer said Example Phone is the most beautiful phone.",
        why: "It is a personal product opinion.",
        need: "The review.",
        q: "Did a reviewer say Example Phone is the most beautiful phone?",
        atom: { s: "Example Phone", p: "is", o: "the most beautiful phone" },
        attribution: { source: "A reviewer", relation: "said", modality: "statement" as const },
        policy: { claimKind: "opinion" as const, consequence: "money" as const },
      },
      {
        c: "The redesign sparked controversy online.",
        why: "It describes generic online reaction.",
        need: "Representative reactions.",
        q: "Did the redesign spark controversy online?",
        atom: { s: "redesign", p: "sparked", o: "controversy online" },
        policy: { claimKind: "fact" as const, consequence: "public_interest" as const },
      },
    ];

    expect(cases.map((claim) => pageClaimInvestigationEligibility(claim).reason)).toEqual([
      "low_consequence_availability",
      "unsupported_claim_kind",
      "generic_controversy",
    ]);
  });

  it("uses typed attribution to preserve the source in a deterministic fallback", () => {
    const claim = {
      c: "專家分析估計，這項政策會使每戶增加 200 元成本。",
      why: "涉及家戶支出。",
      need: "專家分析與計算方式。",
      atom: { s: "這項政策", p: "會使", o: "每戶增加 200 元成本" },
      attribution: { source: "專家分析", relation: "估計", modality: "estimate" as const },
      policy: { claimKind: "estimate" as const, consequence: "money" as const },
    };

    expect(pageClaimInvestigationEligibility(claim)).toEqual({ ok: true });
    expect(deterministicClaimQuestion(claim)).toBe(
      "「專家分析估計，這項政策會使每戶增加 200 元成本」是否有外部證據支持？",
    );
    expect(buildPageClaimInvestigationTask({
      analysisKey: "analysis:key",
      scope: "page",
      claimIndex: 0,
      claim,
      groundingText: claim.c,
    })?.intent.question).toContain("專家分析估計");
  });

  it("rejects missing or inconsistent typed attribution", () => {
    const base = {
      c: "專家分析估計，這項政策會使每戶增加 200 元成本。",
      why: "涉及家戶支出。",
      need: "專家分析與計算方式。",
      atom: { s: "這項政策", p: "會使", o: "每戶增加 200 元成本" },
      policy: { claimKind: "estimate" as const, consequence: "money" as const },
    };

    expect(pageClaimInvestigationEligibility(base)).toEqual({
      ok: false,
      reason: "missing_attribution",
    });
    expect(pageClaimInvestigationEligibility({
      ...base,
      attribution: { source: "另一位專家", relation: "估計", modality: "estimate" as const },
    })).toEqual({
      ok: false,
      reason: "invalid_attribution",
    });
    expect(pageClaimInvestigationEligibility({
      ...base,
      attribution: { source: "專家分析", relation: "估計", modality: "report" as const },
    })).toEqual({
      ok: false,
      reason: "invalid_attribution",
    });
  });

  it("accepts English according-to framing where the relation precedes the source", () => {
    const claim = {
      c: "According to Example Agency, the recall affected 232 products.",
      why: "The recall affects public safety.",
      need: "The agency recall notice.",
      q: "According to Example Agency, did the recall affect 232 products?",
      atom: { s: "the recall", p: "affected", o: "232 products" },
      attribution: { source: "Example Agency", relation: "According to", modality: "report" as const },
      policy: { claimKind: "fact" as const, consequence: "safety" as const },
    };

    expect(pageClaimInvestigationEligibility(claim)).toEqual({ ok: true });
    expect(buildPageClaimInvestigationTask({
      analysisKey: "analysis:key",
      scope: "page",
      claimIndex: 0,
      claim,
      groundingText: claim.c,
    })?.intent.question).toContain("According to Example Agency");
  });

  it("requires typed attribution when an according-to source follows the atom", () => {
    const base = {
      c: "India recorded its driest June in 12 years, according to the India Meteorological Department.",
      why: "The rainfall record affects agricultural planning.",
      need: "Official rainfall records.",
      atom: { s: "India", p: "recorded", o: "its driest June in 12 years" },
      policy: { claimKind: "report" as const, consequence: "public_interest" as const },
    };

    expect(pageClaimInvestigationEligibility(base)).toEqual({
      ok: false,
      reason: "missing_attribution",
    });
    const attributed = {
      ...base,
      attribution: {
        source: "the India Meteorological Department",
        relation: "according to",
        modality: "report" as const,
      },
    };
    expect(pageClaimInvestigationEligibility(attributed)).toEqual({ ok: true });
    expect(deterministicClaimQuestion(attributed)).toContain("according to the India Meteorological Department");
  });

  it("rejects generic atom subjects and signed-treaty relative clauses", () => {
    expect(pageClaimInvestigationEligibility({
      c: "The death toll from last week's quakes has risen to 1,943.",
      why: "The count affects disaster response.",
      need: "Official casualty records.",
      atom: { s: "The death toll", p: "has risen to", o: "1,943" },
      policy: { claimKind: "report", consequence: "public_interest" },
    })).toEqual({ ok: false, reason: "generic_subject" });

    expect(pageClaimInvestigationEligibility({
      c: "Australia and Vanuatu signed a treaty that prevents China creating a military base.",
      why: "The treaty affects regional security.",
      need: "The treaty text.",
      atom: { s: "Australia and Vanuatu", p: "signed", o: "a treaty" },
      policy: { claimKind: "fact", consequence: "public_interest" },
    })).toEqual({ ok: false, reason: "invalid_structure" });
  });

  it("requires every atom part to be grounded in the effective Page or Focus text", () => {
    const claim = {
      c: "The US Supreme Court upheld bans on transgender athletes in female sports.",
      why: "The ruling affects rights.",
      need: "The court ruling.",
      q: "Did the US Supreme Court uphold bans on transgender athletes in female sports?",
      atom: { s: "US Supreme Court", p: "upheld bans on", o: "transgender athletes in female sports" },
      policy: { claimKind: "fact" as const, consequence: "rights" as const },
    };
    const unrelatedText = "The US Supreme Court issued a birthright citizenship decision.";

    expect(pageClaimInvestigationEligibility(claim, unrelatedText)).toEqual({
      ok: false,
      reason: "ungrounded_atom",
    });
    expect(buildPageClaimInvestigationTask({
      analysisKey: "analysis:key",
      scope: "page",
      claimIndex: 0,
      claim,
      groundingText: unrelatedText,
    })).toBeUndefined();
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
      policy: { claimKind: "fact" as const, consequence: "law" as const },
    };

    expect(buildPageClaimInvestigationTask({
      analysisKey: "analysis:key",
      scope: "page",
      claimIndex: 0,
      claim: {
        ...chargedClaim,
        q: "Joseph Horner 是否被控二級謀殺罪？",
      },
      groundingText: chargedClaim.c,
    })).toBeDefined();

    const recovered = buildPageClaimInvestigationTask({
      analysisKey: "analysis:key",
      scope: "page",
      claimIndex: 0,
      claim: {
        ...chargedClaim,
        q: "紐約州法院是否裁定 Joseph Horner 二級謀殺罪成立？",
      },
      groundingText: chargedClaim.c,
    });
    expect(recovered?.intent.question).toContain("Joseph Horner 被控二級謀殺罪");
    expect(recovered?.intent.question).not.toContain("法院");

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
