import { describe, expect, it } from "vitest";

import {
  buildGoogleAiModePrompt,
  buildGoogleSearchKeywords,
  buildPageClaimInvestigationTask,
  deterministicClaimQuestion,
  geminiEvidenceSearchUrl,
  pageClaimInvestigationEligibility,
  preparePageClaimInvestigation,
  standardEvidenceSearchUrl,
  usableClaimQuestion,
} from "@src/sidepanel/page-claim-investigation";

describe("page claim investigation contract", () => {
  it("keeps URL out of Google keywords but includes it as AI Mode metadata", () => {
    const claimText = "食藥署表示，中聯油品下架29項產品。";
    const task = buildPageClaimInvestigationTask({
      analysisKey: "analysis:url-metadata",
      scope: "page",
      claimIndex: 0,
      claim: {
        c: claimText,
        why: "涉及食品安全。",
        need: "食藥署公告與產品清單。",
        q: "食藥署是否表示中聯油品下架29項產品？",
        atom: { s: "中聯油品", p: "下架", o: "29項產品" },
        attribution: { source: "食藥署", relation: "表示", modality: "statement" },
        policy: { claimKind: "report", consequence: "safety" },
      },
      groundingText: claimText,
      source: {
        title: "問題油品流向公告",
        sourceName: "食藥署",
        publishedAt: "2026-07-16",
        url: "https://www.fda.gov.tw/example?id=29",
      },
    });

    expect(task).toBeDefined();
    expect(task?.googleKeywords).not.toContain("食藥署表示 中聯油品下架29項產品");
    expect(task?.googleKeywords).toContain("中聯油品");
    expect(task?.googleKeywords).toContain("29項產品");
    expect(task?.googleKeywords).not.toContain("食藥署公告與產品清單");
    expect(task?.googleKeywords).not.toContain("https://");
    expect(task?.googleKeywords).not.toContain("fda.gov.tw");
    expect(task?.aiModePrompt).toContain("來源網址（metadata）");
    expect(task?.aiModePrompt).toContain("https://www.fda.gov.tw/example?id=29");
  });

  it("plans compact Google keywords from claim anchors and a concrete evidence family", () => {
    const exactClaim = "Example Agency reported 232 affected products on July 8.";
    const googleKeywords = buildGoogleSearchKeywords({
      exactClaim,
      why: "The number affects public risk assessment.",
      evidenceNeed: "The agency announcement and affected-product list.",
      question: "Did Example Agency report 232 affected products on July 8?",
      displayQuestion: "Did Example Agency report 232 affected products on July 8?",
    });

    expect(googleKeywords).not.toBe(exactClaim);
    expect(googleKeywords).toContain("Example Agency");
    expect(googleKeywords).toContain("232");
    expect(googleKeywords).not.toContain("agency announcement");
    expect(googleKeywords).not.toContain("Did");
  });

  it("keeps AI instructions localized while preserving the source-language claim", () => {
    const prompt = buildGoogleAiModePrompt({
      exactClaim: "The Pentagon will offer testosterone treatment for US soldiers.",
      why: "這是具體的軍事健康政策。",
      evidenceNeed: "美國國防部的正式公告或計畫文件。",
      question: "Will the Pentagon offer testosterone treatment for US soldiers?",
      displayQuestion: "美國國防部是否將為美軍提供睪固酮治療？",
      sourceContext: {
        title: "US troops to get testosterone treatment to make them strong",
        sourceName: "ft.com",
        url: "https://www.ft.com/content/example",
      },
    });

    expect(prompt).toContain("請查核以下主張，並以繁體中文回答");
    expect(prompt).toContain("查核問題：美國國防部是否將為美軍提供睪固酮治療？");
    expect(prompt).toContain("原文主張：\"The Pentagon will offer testosterone treatment for US soldiers.\"");
    expect(prompt).toContain("來源網址（metadata）：https://www.ft.com/content/example");
    expect(prompt).not.toContain("Please verify this claim");
  });

  it("rejects metadata-only attribution when the claim has no outer source frame", () => {
    const claimText = "美國國防部長赫格塞斯宣布將為30歲以上的美國軍人提供睪固酮篩檢與治療計畫。";
    const sourceQuote = claimText;
    const task = buildPageClaimInvestigationTask({
      analysisKey: "analysis:ft-runtime",
      scope: "page",
      claimIndex: 0,
      claim: {
        c: claimText,
        why: "此為具體軍事政策變動，涉及軍人健康與軍事準備度。",
        need: "國防部官方公告或赫格塞斯的正式聲明文件。",
        q: "美國國防部長赫格塞斯是否宣布將為30歲以上的美國軍人提供睪固酮篩檢與治療計畫？",
        atom: {
          s: "美國國防部長赫格塞斯",
          p: "宣布將為",
          o: "30歲以上的美國軍人提供睪固酮篩檢與治療計畫",
        },
        policy: { claimKind: "fact", consequence: "health" },
        attribution: { source: "ft.com", relation: "report", modality: "report" },
        sourceQuote,
      },
      groundingText: sourceQuote,
      source: {
        title: "US troops to get testosterone treatment to make them strong",
        sourceName: "ft.com",
        url: "https://www.ft.com/content/example",
      },
    });

    expect(task).toBeUndefined();
  });

  it("keeps an exact trailing announcement frame aligned across localized and source actions", () => {
    const sourceQuote = "The Pentagon will offer testosterone treatment for US soldiers, in a programme announced by defence secretary Pete Hegseth.";
    const sourceQuestion = "Is “The Pentagon will offer testosterone treatment for US soldiers, in a programme announced by defence secretary Pete Hegseth” supported by external evidence?";
    const prepared = preparePageClaimInvestigation({
      analysisKey: "analysis:ft-live-output",
      scope: "page",
      claimIndex: 0,
      claim: {
        c: sourceQuote,
        why: "This is a specific policy change involving military health standards.",
        need: "Official Department of Defense program details or related orders.",
        q: sourceQuestion,
        displayQ: "美國國防部是否將為美軍提供睪固酮治療，該計劃由國防部長赫格塞斯宣布？",
        atom: {
          s: "The Pentagon",
          p: "will offer",
          o: "testosterone treatment for US soldiers",
        },
        attribution: {
          source: "defence secretary Pete Hegseth",
          relation: "announced by",
          modality: "statement",
        },
        policy: { claimKind: "report", consequence: "health" },
        sourceQuote,
      },
      groundingText: `${sourceQuote} The initiative is the latest step in Hegseth’s campaign.`,
      source: {
        title: "US troops to get testosterone treatment to make them strong",
        sourceName: "ft.com",
        url: "https://www.ft.com/content/example",
      },
    });

    expect(prepared).toMatchObject({
      decision: "prepared",
      claim: {
        c: sourceQuote,
        atom: {
          s: "The Pentagon",
          p: "will offer",
          o: "testosterone treatment for US soldiers",
        },
      },
      task: {
        intent: {
          displayQuestion: "美國國防部是否將為美軍提供睪固酮治療？",
          question: sourceQuestion.slice(0, -1),
        },
        googleKeywords: "defence secretary Pete Hegseth Pentagon offer testosterone treatment US soldiers",
      },
      canonicalizations: [],
    });
    expect(prepared.decision === "prepared" ? prepared.task.googleKeywords : "").not.toContain("2026-07-15");
    expect(prepared.decision === "prepared" ? prepared.task.aiModePrompt : "").toContain("請查核以下主張");
    expect(prepared.decision === "prepared" ? prepared.task.aiModePrompt : "").toContain(sourceQuote);
  });

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
    expect(task?.googleKeywords).not.toContain("agency announcement product list");
    expect(task?.googleKeywords).not.toContain("Synthetic public notice");
    expect(task?.googleKeywords).not.toContain("Example News");
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

  it("keeps a routine commercial event announcement as reading context only", () => {
    const claim = {
      c: "Example Bar will host its fifth-anniversary party on August 12.",
      why: "It describes a routine promotional event.",
      need: "The venue event page.",
      q: "Will Example Bar host its fifth-anniversary party on August 12?",
      atom: {
        s: "Example Bar",
        p: "will host",
        o: "its fifth-anniversary party on August 12",
      },
      policy: { claimKind: "fact" as const, consequence: "public_interest" as const },
    };

    expect(pageClaimInvestigationEligibility(claim)).toEqual({
      ok: false,
      reason: "low_consequence_routine_event",
    });
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

  it("prepares a claim by inferring one exact grounded typed attribution", () => {
    const claim = {
      c: "烏克蘭政府估計，俄羅斯飛彈有九成裝著日本製零件。",
      why: "涉及武器供應鏈與出口管制。",
      need: "烏克蘭政府原始估計與零件調查資料。",
      q: "俄羅斯飛彈是否有九成裝著日本製零件？",
      atom: { s: "俄羅斯飛彈", p: "有九成裝著", o: "日本製零件" },
      policy: { claimKind: "estimate" as const, consequence: "public_interest" as const },
    };

    const preparation = preparePageClaimInvestigation({
      analysisKey: "analysis:inferred-attribution",
      scope: "page",
      claimIndex: 0,
      claim,
      groundingText: claim.c,
    });

    expect(preparation).toMatchObject({
      decision: "prepared",
      canonicalizations: ["infer_typed_attribution"],
      claim: {
        attribution: { source: "烏克蘭政府", relation: "估計", modality: "estimate" },
      },
      task: {
        intent: {
          question: "「烏克蘭政府估計，俄羅斯飛彈有九成裝著日本製零件」是否有外部證據支持？",
        },
      },
    });
    expect(pageClaimInvestigationEligibility(claim, claim.c)).toEqual({
      ok: false,
      reason: "missing_attribution",
    });
  });

  it("projects one exact atomic span without treating 未來 as negation", () => {
    const claim = {
      c: "丹拿將關閉工廠，並在未來退出市場。",
      why: "影響員工與消費者權益。",
      need: "丹拿公司公告或公司登記文件。",
      q: "丹拿是否將關閉工廠並在未來退出市場？",
      atom: { s: "丹拿", p: "將關閉", o: "工廠" },
      policy: { claimKind: "forecast" as const, consequence: "public_interest" as const },
      sourceQuote: "丹拿將關閉工廠，並在未來退出市場。",
    };

    expect(preparePageClaimInvestigation({
      analysisKey: "analysis:atomic-projection",
      scope: "page",
      claimIndex: 0,
      claim,
      groundingText: `${claim.sourceQuote}\n${claim.sourceQuote}`,
    })).toMatchObject({
      decision: "prepared",
      canonicalizations: ["project_exact_atomic_span"],
      claim: { c: "丹拿將關閉工廠。" },
      task: {
        intent: { question: "「丹拿將關閉工廠」是否有外部證據支持？" },
      },
    });
  });

  it("rejects a compound projection that would remove negation, a date, or a legal stage", () => {
    const base = {
      why: "影響公共安全。",
      need: "主管機關公告與正式紀錄。",
      q: "甲公司是否下架產品？",
      atom: { s: "甲公司", p: "下架", o: "產品" },
      policy: { claimKind: "fact" as const, consequence: "safety" as const },
    };
    const cases = [
      "甲公司下架產品，並未完成安全審查。",
      "甲公司下架產品，並於2026年公布調查結果。",
      "甲公司下架產品，並遭法院判刑。",
    ];

    for (const c of cases) {
      expect(preparePageClaimInvestigation({
        analysisKey: `analysis:unsafe-projection:${c}`,
        scope: "page",
        claimIndex: 0,
        claim: { ...base, c, sourceQuote: c },
        groundingText: c,
      })).toMatchObject({ decision: "rejected", reason: "compound_claim" });
    }
  });

  it("grounds atom parts in one exact source quote even when filler differs from claim.c", () => {
    const sourceQuote = "India has recorded its driest June in 12 years.";
    const claim = {
      c: "India recorded its driest June in 12 years.",
      why: "The rainfall record affects agricultural planning.",
      need: "Official rainfall records and measurement methodology.",
      q: "Did India record its driest June in 12 years?",
      atom: { s: "India", p: "recorded", o: "its driest June in 12 years" },
      policy: { claimKind: "report" as const, consequence: "public_interest" as const },
      sourceQuote,
    };

    expect(pageClaimInvestigationEligibility(claim, sourceQuote)).toEqual({ ok: true });
    expect(pageClaimInvestigationEligibility(
      { ...claim, sourceQuote: "India had its driest June in 12 years." },
      "India had its driest June in 12 years.",
    )).toEqual({ ok: false, reason: "ungrounded_atom" });
  });

  it("rejects unsafe modal, hedge, negation, Chinese modal, and cross-sentence atom gaps", () => {
    const english = {
      c: "India recorded its driest June in 12 years.",
      why: "The rainfall record affects agricultural planning.",
      need: "Official rainfall records and measurement methodology.",
      q: "Did India record its driest June in 12 years?",
      atom: { s: "India", p: "recorded", o: "its driest June in 12 years" },
      policy: { claimKind: "report" as const, consequence: "public_interest" as const },
    };
    for (const sourceQuote of [
      "India has not recorded its driest June in 12 years.",
      "India may have recorded its driest June in 12 years.",
      "India reportedly recorded its driest June in 12 years.",
      "India recorded has its driest June in 12 years.",
      "India recorded may its driest June in 12 years.",
      "India. recorded its driest June in 12 years.",
    ]) {
      expect(pageClaimInvestigationEligibility({ ...english, sourceQuote }, sourceQuote)).toEqual({
        ok: false,
        reason: "ungrounded_atom",
      });
    }

    const chinese = {
      c: "印度可能創下十二年來最乾旱的六月。",
      why: "降雨紀錄影響農業規劃。",
      need: "官方降雨紀錄與測量方法。",
      q: "印度是否創下十二年來最乾旱的六月？",
      atom: { s: "印度", p: "創下", o: "十二年來最乾旱的六月" },
      policy: { claimKind: "report" as const, consequence: "public_interest" as const },
      sourceQuote: "印度可能創下十二年來最乾旱的六月。",
    };
    expect(pageClaimInvestigationEligibility(chinese, chinese.sourceQuote)).toEqual({
      ok: false,
      reason: "ungrounded_atom",
    });
  });

  it("accepts repeated full-text witnesses only when they share one safe gap signature", () => {
    const claim = {
      c: "India recorded its driest June in 12 years.",
      why: "The rainfall record affects agricultural planning.",
      need: "Official rainfall records and measurement methodology.",
      q: "Did India record its driest June in 12 years?",
      atom: { s: "India", p: "recorded", o: "its driest June in 12 years" },
      policy: { claimKind: "report" as const, consequence: "public_interest" as const },
    };
    expect(pageClaimInvestigationEligibility(
      claim,
      "India has recorded its driest June in 12 years. India has recorded its driest June in 12 years.",
    )).toEqual({ ok: true });
    expect(pageClaimInvestigationEligibility(
      claim,
      "India has recorded its driest June in 12 years. India had recorded its driest June in 12 years.",
    )).toEqual({ ok: false, reason: "ungrounded_atom" });
  });

  it("canonicalizes one grounded suffix according-to frame to report", () => {
    const c = "India recorded its driest June in 12 years, according to the India Meteorological Department.";
    const sourceQuote = "India has recorded its driest June in 12 years, and the fifth-driest since records began, according to the India Meteorological Department.";
    const groundingText = `India rainfall archive and India agriculture update. ${sourceQuote} India monsoon outlook.`;
    const preparation = preparePageClaimInvestigation({
      analysisKey: "analysis:suffix-attribution",
      scope: "page",
      claimIndex: 0,
      claim: {
        c,
        why: "The rainfall record affects agricultural planning.",
        need: "India Meteorological Department rainfall records.",
        q: "Did India record its driest June in 12 years?",
        atom: { s: "India", p: "recorded", o: "its driest June in 12 years" },
        attribution: {
          source: "the India Meteorological Department",
          relation: "according to",
          modality: "statement",
        },
        policy: { claimKind: "report", consequence: "public_interest" },
        sourceQuote,
      },
      groundingText,
    });

    expect(preparation).toMatchObject({
      decision: "prepared",
      canonicalizations: ["infer_typed_attribution"],
      claim: {
        attribution: {
          source: "the India Meteorological Department",
          relation: "according to",
          modality: "report",
        },
      },
    });
  });

  it("rejects an according-to suffix that crosses a retraction or competing report", () => {
    const c = "India recorded its driest June in 12 years, according to the India Meteorological Department.";
    for (const unsafeClause of [
      "but the record was later retracted",
      "and the fifth-driest since records began but officials disputed the record",
      "and another agency reported a different result",
      "and experts rejected the record",
      "and analysts called the record unsupported",
    ]) {
      const sourceQuote = `India has recorded its driest June in 12 years, ${unsafeClause}, according to the India Meteorological Department.`;
      expect(preparePageClaimInvestigation({
        analysisKey: `analysis:unsafe-suffix:${unsafeClause}`,
        scope: "page",
        claimIndex: 0,
        claim: {
          c,
          why: "The rainfall record affects agricultural planning.",
          need: "India Meteorological Department rainfall records.",
          q: "Did India record its driest June in 12 years?",
          atom: { s: "India", p: "recorded", o: "its driest June in 12 years" },
          attribution: {
            source: "the India Meteorological Department",
            relation: "according to",
            modality: "statement",
          },
          policy: { claimKind: "report", consequence: "public_interest" },
          sourceQuote,
        },
        groundingText: sourceQuote,
      })).toMatchObject({ decision: "rejected" });
    }
  });

  it("does not infer attribution across an added hedge in the exact quote", () => {
    const c = "Example Agency said, the recall affected 232 products.";
    const sourceQuote = "Example Agency allegedly said, the recall affected 232 products.";
    expect(preparePageClaimInvestigation({
      analysisKey: "analysis:hedged-attribution",
      scope: "page",
      claimIndex: 0,
      claim: {
        c,
        why: "The recall affects public safety.",
        need: "Example Agency's original recall notice.",
        q: "Did Example Agency say the recall affected 232 products?",
        atom: { s: "the recall", p: "affected", o: "232 products" },
        policy: { claimKind: "report", consequence: "safety" },
        sourceQuote,
      },
      groundingText: sourceQuote,
    })).toMatchObject({
      decision: "rejected",
      reason: "missing_attribution",
      canonicalizations: [],
    });
  });

  it("rejects a typed outer attribution invented around a grounded inner atom", () => {
    const sourceQuote = "the recall affected 232 products.";
    expect(pageClaimInvestigationEligibility({
      c: "Example Agency said the recall affected 232 products.",
      why: "The recall affects public safety.",
      need: "Example Agency's original recall notice.",
      q: "Did Example Agency say the recall affected 232 products?",
      atom: { s: "the recall", p: "affected", o: "232 products" },
      attribution: { source: "Example Agency", relation: "said", modality: "statement" },
      policy: { claimKind: "report", consequence: "safety" },
      sourceQuote,
    }, sourceQuote)).toEqual({
      ok: false,
      reason: "invalid_attribution",
    });
  });

  it("replaces a model-expanded relation with one exact grounded data-report frame", () => {
    const c = "中指研究院數據顯示，中國百城房價下跌0.42%。";
    const sourceQuote = "今年中國百城房價下跌0.42%。";
    expect(preparePageClaimInvestigation({
      analysisKey: "analysis:data-report-attribution",
      scope: "page",
      claimIndex: 0,
      claim: {
        c,
        why: "房價變動影響民眾資產判斷。",
        need: "中指研究院原始房價資料集。",
        q: "中國百城房價是否下跌0.42%？",
        atom: { s: "中國百城房價", p: "下跌", o: "0.42%" },
        attribution: { source: "中指研究院", relation: "發布數據顯示", modality: "report" },
        policy: { claimKind: "report", consequence: "money" },
        sourceQuote,
      },
      groundingText: `中指研究院今天公布的數據顯示，${sourceQuote}`,
    })).toMatchObject({
      decision: "prepared",
      canonicalizations: ["infer_typed_attribution"],
      claim: {
        attribution: { source: "中指研究院", relation: "數據顯示", modality: "report" },
      },
    });
  });

  it("does not infer attribution through an unlisted or hedged source bridge", () => {
    const c = "中指研究院數據顯示，中國百城房價下跌0.42%。";
    const sourceQuote = "今年中國百城房價下跌0.42%。";
    const base = {
      c,
      why: "房價變動影響民眾資產判斷。",
      need: "中指研究院原始房價資料集。",
      q: "中國百城房價是否下跌0.42%？",
      atom: { s: "中國百城房價", p: "下跌", o: "0.42%" },
      policy: { claimKind: "report" as const, consequence: "money" as const },
      sourceQuote,
    };

    for (const bridge of ["可能公布的", "據稱公布的", "未公布的", "否認後公布的"]) {
      expect(preparePageClaimInvestigation({
        analysisKey: `analysis:unsafe-bridge:${bridge}`,
        scope: "page",
        claimIndex: 0,
        claim: base,
        groundingText: `中指研究院${bridge}數據顯示，${sourceQuote}`,
      })).toMatchObject({
        decision: "rejected",
        reason: "missing_attribution",
      });
    }
  });

  it("accepts only the closed publication bridge variants for data-report attribution", () => {
    const c = "中指研究院數據顯示，中國百城房價下跌0.42%。";
    const sourceQuote = "今年中國百城房價下跌0.42%。";
    const claim = {
      c,
      why: "房價變動影響民眾資產判斷。",
      need: "中指研究院原始房價資料集。",
      q: "中國百城房價是否下跌0.42%？",
      atom: { s: "中國百城房價", p: "下跌", o: "0.42%" },
      policy: { claimKind: "report" as const, consequence: "money" as const },
      sourceQuote,
    };
    expect(preparePageClaimInvestigation({
      analysisKey: "analysis:published-bridge",
      scope: "page",
      claimIndex: 0,
      claim,
      groundingText: `中指研究院今日所發布的數據顯示，${sourceQuote}`,
    })).toMatchObject({ decision: "prepared" });
    expect(preparePageClaimInvestigation({
      analysisKey: "analysis:partial-data-bridge",
      scope: "page",
      claimIndex: 0,
      claim,
      groundingText: `中指研究院今天公布的部分數據顯示，${sourceQuote}`,
    })).toMatchObject({ decision: "rejected" });
  });

  it("does not infer ambiguous, generic, or ungrounded attribution frames", () => {
    const cases = [
      {
        c: "Agency A said Agency B reported, the recall affected 232 products.",
        atom: { s: "the recall", p: "affected", o: "232 products" },
        groundingText: "Agency A said Agency B reported, the recall affected 232 products.",
      },
      {
        c: "政府估計，俄羅斯飛彈有九成裝著日本製零件。",
        atom: { s: "俄羅斯飛彈", p: "有九成裝著", o: "日本製零件" },
        groundingText: "政府估計，俄羅斯飛彈有九成裝著日本製零件。",
      },
      {
        c: "烏克蘭政府估計，俄羅斯飛彈有九成裝著日本製零件。",
        atom: { s: "俄羅斯飛彈", p: "有九成裝著", o: "日本製零件" },
        groundingText: "俄羅斯飛彈有九成裝著日本製零件。",
      },
    ];

    for (const [index, candidate] of cases.entries()) {
      expect(preparePageClaimInvestigation({
        analysisKey: `analysis:unsafe-attribution:${index}`,
        scope: "page",
        claimIndex: 0,
        claim: {
          c: candidate.c,
          why: "The claim affects public-interest decisions.",
          need: "The named institution's original report.",
          q: "Is this claim supported?",
          atom: candidate.atom,
          policy: { claimKind: "report", consequence: "public_interest" },
        },
        groundingText: candidate.groundingText,
      })).toMatchObject({ decision: "rejected" });
    }
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
    })).toEqual({ ok: false, reason: "compound_claim" });
  });

  it("reports actionable structure failures without weakening the guard", () => {
    const base = {
      c: "Example Agency announced a public safety recall.",
      why: "The recall affects public safety.",
      need: "The official recall notice.",
      q: "Did Example Agency announce a public safety recall?",
      policy: { claimKind: "fact" as const, consequence: "safety" as const },
    };
    expect(pageClaimInvestigationEligibility({
      ...base,
      atom: { s: "Example Agency", p: "declared", o: "a public safety recall" },
    })).toEqual({ ok: false, reason: "atom_span_mismatch" });
    expect(pageClaimInvestigationEligibility({
      ...base,
      atom: { s: "this content", p: "announced", o: "a public safety recall" },
    })).toEqual({ ok: false, reason: "vague_atom" });
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

  it("keeps related-link tail fragments from becoming investigation actions", () => {
    const relatedHeadline = "Example Agency announced a public safety recall.";
    const claim = {
      c: relatedHeadline,
      why: "The recall could affect public safety.",
      need: "The agency recall notice and affected-product list.",
      q: "Did Example Agency announce a public safety recall?",
      atom: { s: "Example Agency", p: "announced", o: "a public safety recall" },
      policy: { claimKind: "fact" as const, consequence: "safety" as const },
      sourceQuote: relatedHeadline,
    };
    const groundingText = [
      "The article body discusses a different policy topic in detail.",
      "Related stories",
      relatedHeadline,
    ].join("\n");

    expect(pageClaimInvestigationEligibility(claim, groundingText)).toEqual({
      ok: false,
      reason: "navigation_fragment",
    });
    expect(buildPageClaimInvestigationTask({
      analysisKey: "analysis:related-tail",
      scope: "page",
      claimIndex: 0,
      claim,
      groundingText,
    })).toBeUndefined();
  });

  it("keeps an identical source quote when at least one duplicate is body content", () => {
    const quote = "Example Agency announced a public safety recall.";
    const claim = {
      c: quote,
      why: "The recall could affect public safety.",
      need: "The agency recall notice and affected-product list.",
      q: "Did Example Agency announce a public safety recall?",
      atom: { s: "Example Agency", p: "announced", o: "a public safety recall" },
      policy: { claimKind: "fact" as const, consequence: "safety" as const },
      sourceQuote: quote,
    };
    const groundingText = [
      "Article body",
      quote,
      "Related stories",
      quote,
    ].join("\n");

    expect(pageClaimInvestigationEligibility(claim, groundingText)).toEqual({ ok: true });
    expect(pageClaimInvestigationEligibility(claim, [
      "Related stories",
      quote,
      "More news",
      quote,
    ].join("\n"))).toEqual({ ok: false, reason: "navigation_fragment" });
  });

  it("fails closed when the only source quote is an incomplete fragment at the extraction boundary", () => {
    const tailFragment = "Example Agency announced a public safety recall affecting several";
    const claim = {
      c: `${tailFragment}.`,
      why: "The recall could affect public safety.",
      need: "The agency recall notice and affected-product list.",
      q: `Did ${tailFragment}?`,
      atom: { s: "Example Agency", p: "announced", o: "a public safety recall affecting several" },
      policy: { claimKind: "fact" as const, consequence: "safety" as const },
      sourceQuote: tailFragment,
    };
    const prefix = "The primary article body discusses a different policy topic in detail. ".repeat(40);
    const groundingText = `${prefix.slice(0, 1_600 - tailFragment.length)}${tailFragment}`;

    expect(groundingText).toHaveLength(1_600);
    expect(pageClaimInvestigationEligibility(claim, groundingText)).toEqual({
      ok: false,
      reason: "navigation_fragment",
    });
  });

  it("does not treat a complete final sentence as a truncated tail fragment", () => {
    const quoteWithoutPunctuation = "Example Agency announced a public safety recall";
    const claim = {
      c: `${quoteWithoutPunctuation}.`,
      why: "The recall could affect public safety.",
      need: "The agency recall notice and affected-product list.",
      q: `Did ${quoteWithoutPunctuation}?`,
      atom: { s: "Example Agency", p: "announced", o: "a public safety recall" },
      policy: { claimKind: "fact" as const, consequence: "safety" as const },
      sourceQuote: quoteWithoutPunctuation,
    };
    const prefix = "The primary article body provides complete context. ".repeat(40);
    const finalSentence = `${quoteWithoutPunctuation}.`;
    const groundingText = `${prefix.slice(0, 1_600 - finalSentence.length)}${finalSentence}`;

    expect(pageClaimInvestigationEligibility(claim, groundingText)).toEqual({ ok: true });
  });

  it("fails closed on comparative claims without a time, market, region, or metric", () => {
    const claim = {
      c: "Example Model performs better than competing tools.",
      why: "The comparison could affect a purchase decision.",
      need: "A named benchmark report with its measurement method.",
      q: "Does Example Model perform better than competing tools?",
      atom: { s: "Example Model", p: "performs better than", o: "competing tools" },
      policy: { claimKind: "fact" as const, consequence: "money" as const },
    };

    expect(pageClaimInvestigationEligibility(claim, claim.c)).toEqual({
      ok: false,
      reason: "underspecified_comparison",
    });

    const missingMarketOrRegion = {
      ...claim,
      c: "In 2026, Example Model scored higher accuracy than Rival Model.",
      q: "In 2026, did Example Model score higher accuracy than Rival Model?",
      atom: { s: "Example Model", p: "scored higher accuracy than", o: "Rival Model" },
    };
    expect(pageClaimInvestigationEligibility(missingMarketOrRegion, missingMarketOrRegion.c)).toEqual({
      ok: false,
      reason: "underspecified_comparison",
    });

    const missingTimeAndMetric = {
      ...claim,
      c: "Huawei overtook Nvidia in its home market.",
      q: "Did Huawei overtake Nvidia in its home market?",
      atom: { s: "Huawei", p: "overtook", o: "Nvidia" },
    };
    expect(pageClaimInvestigationEligibility(missingTimeAndMetric, missingTimeAndMetric.c)).toEqual({
      ok: false,
      reason: "underspecified_comparison",
    });

    const chineseMissingTimeAndMetric = {
      ...claim,
      c: "華為在中國市場超越輝達。",
      q: "華為是否在中國市場超越輝達？",
      atom: { s: "華為", p: "超越", o: "輝達" },
    };
    expect(pageClaimInvestigationEligibility(chineseMissingTimeAndMetric, chineseMissingTimeAndMetric.c)).toEqual({
      ok: false,
      reason: "underspecified_comparison",
    });
  });

  it("keeps a bounded comparison when the source names its time, market, and metric", () => {
    const claim = {
      c: "In a 2026 Taiwan benchmark, Example Model scored 82 accuracy points versus Rival Model's 76.",
      why: "The measured comparison could affect a purchase decision.",
      need: "The named benchmark report, scoring method, and result table.",
      q: "In a 2026 Taiwan benchmark, did Example Model score 82 accuracy points versus Rival Model's 76?",
      atom: { s: "Example Model", p: "scored", o: "82 accuracy points" },
      policy: { claimKind: "fact" as const, consequence: "money" as const },
    };

    expect(pageClaimInvestigationEligibility(claim, claim.c)).toEqual({ ok: true });

    const marketShareClaim = {
      c: "In the 2026 Taiwan smartphone market, Example Phone had a higher market share than Rival Phone.",
      why: "The measured comparison could affect a purchase decision.",
      need: "The 2026 Taiwan smartphone market-share dataset and methodology.",
      q: "In the 2026 Taiwan smartphone market, did Example Phone have a higher market share than Rival Phone?",
      atom: { s: "Example Phone", p: "had a higher market share than", o: "Rival Phone" },
      policy: { claimKind: "fact" as const, consequence: "money" as const },
    };
    expect(pageClaimInvestigationEligibility(marketShareClaim, marketShareClaim.c)).toEqual({ ok: true });

    const overtakingClaim = {
      c: "In the 2026 China smartphone market, Huawei overtook Rival in market share.",
      why: "The measured comparison could affect a purchase decision.",
      need: "The 2026 China smartphone market-share dataset and methodology.",
      q: "In the 2026 China smartphone market, did Huawei overtake Rival in market share?",
      atom: { s: "Huawei", p: "overtook", o: "Rival" },
      policy: { claimKind: "fact" as const, consequence: "money" as const },
    };
    expect(pageClaimInvestigationEligibility(overtakingClaim, overtakingClaim.c)).toEqual({ ok: true });

    const thresholdClaim = {
      c: "Example Service surpassed 10 million users in 2026.",
      why: "The adoption figure affects public-interest planning.",
      need: "The service's 2026 audited user-count report.",
      q: "Did Example Service surpass 10 million users in 2026?",
      atom: { s: "Example Service", p: "surpassed", o: "10 million users" },
      policy: { claimKind: "report" as const, consequence: "public_interest" as const },
    };
    expect(pageClaimInvestigationEligibility(thresholdClaim, thresholdClaim.c)).toEqual({ ok: true });

    const chineseThresholdClaim = {
      c: "範例服務用戶數在2026年超越1000萬。",
      why: "採用規模影響公共利益判斷。",
      need: "範例服務2026年經審計的用戶數報告。",
      q: "範例服務用戶數是否在2026年超越1000萬？",
      atom: { s: "範例服務用戶數", p: "超越", o: "1000萬" },
      policy: { claimKind: "report" as const, consequence: "public_interest" as const },
    };
    expect(pageClaimInvestigationEligibility(chineseThresholdClaim, chineseThresholdClaim.c)).toEqual({ ok: true });
  });

  it("requires an evidence family instead of a generic request for evidence", () => {
    const claim = {
      c: "Example Agency announced a public safety recall.",
      why: "The recall could affect public safety.",
      need: "External evidence.",
      q: "Did Example Agency announce a public safety recall?",
      atom: { s: "Example Agency", p: "announced", o: "a public safety recall" },
      policy: { claimKind: "fact" as const, consequence: "safety" as const },
    };

    expect(pageClaimInvestigationEligibility(claim, claim.c)).toEqual({
      ok: false,
      reason: "generic_evidence_need",
    });
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
    const multiEventReport = "北榮院長陳威明表示，巴威颱風假導致重症患者手術延後，引發家屬抗議，他強調醫療單位最怕放假。";
    expect(buildPageClaimInvestigationTask({
      analysisKey: "analysis:key",
      scope: "page",
      claimIndex: 0,
      claim: {
        c: multiEventReport,
        why: "涉及公共醫療調度。",
        need: "醫院手術與抗議紀錄。",
        q: "北榮院長陳威明是否表示醫療單位最怕放假？",
        atom: { s: "北榮院長陳威明", p: "表示", o: "醫療單位最怕放假" },
        policy: { claimKind: "report", consequence: "public_interest" },
      },
      groundingText: multiEventReport,
    })).toBeUndefined();
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
