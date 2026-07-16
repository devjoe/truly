import { describe, expect, it } from "vitest";

import {
  buildGeneralPageInvestigationAdapterPrompt,
  parseGeneralPageInvestigationAdapterContent,
  resolveSourceQuote,
} from "@src/lib/general-page-investigation-adapter";
import { buildTierBGeneralPageInvestigationAdapterChatBody } from "@src/lib/tier-b-client";

const input = {
  candidateClaim: {
    c: "食藥署表示，中聯油品下架29項產品。",
    why: "涉及食品安全。",
    need: "食藥署公告與產品清單。",
    q: "食藥署是否表示中聯油品下架29項產品？",
  },
  groundingText: "食藥署今日表示，中聯油品下架29項產品。完整清單另見公告。",
  source: {
    title: "問題油品流向公告",
    sourceName: "食藥署",
    publishedAt: "2026-07-16",
    url: "https://www.fda.gov.tw/example?id=29",
  },
  outputLang: "zh-TW" as const,
};

describe("General Page investigation adapter", () => {
  it("treats the source URL as metadata and page text as the grounding boundary", () => {
    const prompt = buildGeneralPageInvestigationAdapterPrompt(input);

    expect(prompt).toContain("https://www.fda.gov.tw/example?id=29");
    expect(prompt).toContain("URL is metadata only");
    expect(prompt).toContain(input.groundingText);
    expect(prompt).toContain("不得把網址複製到任何輸出欄位");
  });

  it("uses one compact structured-output request", () => {
    const body = buildTierBGeneralPageInvestigationAdapterChatBody({
      endpoint: "http://127.0.0.1:8000/v1",
      model: "fixture-model",
      ...input,
    });

    expect(body.response_format).toEqual({ type: "json_object" });
    expect(body.max_tokens).toBeLessThanOrEqual(480);
    expect(body.temperature).toBe(0);
    expect(body.messages).toHaveLength(2);
    expect(body.messages[0]?.content).toContain("c, q, and atom s, p, and o in the source text language");
    expect(body.messages[0]?.content).toContain("Only why and need use the requested UI language");
    expect(body.messages[0]?.content).toContain("sourceQuote");
  });

  it("normalizes a prepared atomic claim for the existing local guard", () => {
    const raw = JSON.stringify({
      schemaVersion: 1,
      decision: "prepared",
      reason: "actionable",
      claim: {
        c: "食藥署表示，中聯油品下架29項產品。",
        why: "涉及食品安全。",
        need: "食藥署公告與產品清單。",
        q: "食藥署是否表示中聯油品下架29項產品？",
        atom: { s: "中聯油品", p: "下架", o: "29項產品" },
        attribution: { source: "食藥署", relation: "表示", modality: "statement" },
        policy: { claimKind: "report", consequence: "safety" },
      },
    });

    const parsed = parseGeneralPageInvestigationAdapterContent(raw);
    expect(parsed).toMatchObject({
      ok: true,
      value: {
        schemaVersion: 1,
        decision: "prepared",
        claim: {
          atom: { s: "中聯油品", p: "下架", o: "29項產品" },
          policy: { claimKind: "report", consequence: "safety" },
        },
      },
    });
  });

  it("keeps an actionable claim when only the version and optional attribution drift", () => {
    const parsed = parseGeneralPageInvestigationAdapterContent(JSON.stringify({
      schemaVersion: "1.0",
      decision: "prepared",
      reason: "actionable",
      claim: {
        c: "美國國防部長赫格塞斯宣布將為30歲以上的美國軍人提供睪固酮篩檢與治療計畫。",
        why: "此為具體政策變動，涉及軍隊健康標準與資源分配。",
        need: "國防部官方公告或醫療指南。",
        q: "美國國防部長赫格塞斯是否宣布將為30歲以上的美國軍人提供睪固酮篩檢與治療計畫？",
        atom: {
          s: "美國國防部長赫格塞斯",
          p: "宣布",
          o: "為30歲以上的美國軍人提供睪固酮篩檢與治療計畫",
        },
        policy: { claimKind: "report", consequence: "health" },
        attribution: { source: "ft.com", relation: "reporting", modality: "factual" },
      },
    }));

    expect(parsed).toMatchObject({
      ok: true,
      value: {
        schemaVersion: 1,
        decision: "prepared",
        claim: {
          atom: {
            s: "美國國防部長赫格塞斯",
            p: "宣布",
          },
          policy: { claimKind: "report", consequence: "health" },
        },
      },
    });
    expect(parsed.value?.decision === "prepared" ? parsed.value.claim.attribution : undefined).toBeUndefined();
  });

  it("normalizes root attribution and resolves one truly contiguous source quote", () => {
    const claimText = "美國國防部長赫格塞斯宣布將為30歲以上的美國軍人提供睪固酮篩檢與治療計畫。";
    const first = "The Pentagon will offer testosterone treatment for US soldiers";
    const second = "Troops 30 years old and over would have their testosterone levels tested annually";
    const parsed = parseGeneralPageInvestigationAdapterContent(JSON.stringify({
      schemaVersion: 1,
      decision: "prepared",
      reason: "actionable",
      claim: {
        c: claimText,
        why: "涉及軍人健康。",
        need: "國防部公告。",
        q: "美國國防部長赫格塞斯是否宣布將為30歲以上的美國軍人提供睪固酮篩檢與治療計畫？",
        atom: {
          s: "美國國防部長赫格塞斯",
          p: "宣布",
          o: "為30歲以上的美國軍人提供睪固酮篩檢與治療計畫",
        },
        policy: { claimKind: "report", consequence: "health" },
        sourceQuote: `${first}... ${second}`,
      },
      attribution: { source: "ft.com", relation: "report", modality: "report" },
    }));

    expect(parsed.ok).toBe(true);
    expect(parsed.value?.decision === "prepared" ? parsed.value.claim.attribution : undefined).toMatchObject({
      source: "ft.com",
    });
    expect(resolveSourceQuote(
      parsed.value?.decision === "prepared" ? parsed.value.claim.sourceQuote : undefined,
      `${first}, in a programme announced by Pete Hegseth. ${second}, while younger soldiers could opt in.`,
      claimText,
    )).toBe(second);
    expect(resolveSourceQuote(
      first,
      `${first}, in a programme announced by Pete Hegseth. ${second}, while younger soldiers could opt in.`,
      claimText,
    )).toBe(`${second}, while younger soldiers could opt in.`);
  });

  it("accepts abstention but rejects an incomplete prepared claim", () => {
    expect(parseGeneralPageInvestigationAdapterContent(JSON.stringify({
      schemaVersion: 1,
      decision: "abstain",
      reason: "unsafe_structure",
    }))).toMatchObject({ ok: true, value: { decision: "abstain" } });

    expect(parseGeneralPageInvestigationAdapterContent(JSON.stringify({
      schemaVersion: 1,
      decision: "prepared",
      reason: "actionable",
      claim: { c: "不完整。" },
    }))).toMatchObject({ ok: false, value: null });
  });
});
