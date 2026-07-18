import { describe, expect, it, vi } from "vitest";

import {
  GENERAL_PAGE_INVESTIGATION_ADAPTER_RESPONSE_SCHEMA,
  buildGeneralPageInvestigationAdapterPrompt,
  parseGeneralPageInvestigationAdapterContent,
  resolveSourceQuote,
} from "@src/lib/general-page-investigation-adapter";
import {
  buildTierBGeneralPageInvestigationAdapterChatBody,
  callTierBGeneralPageInvestigationAdapter,
} from "@src/lib/tier-b-client";

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
    expect(prompt.indexOf("## Untrusted candidate clue")).toBeLessThan(prompt.indexOf("## Exact grounding text — sole copying boundary"));
  });

  it("uses the strict fixed-key schema only when the caller declares that capability", () => {
    const body = buildTierBGeneralPageInvestigationAdapterChatBody({
      endpoint: "http://127.0.0.1:8000/v1",
      model: "fixture-model",
      structuredOutputMode: "json_schema",
      sourceLang: "zh-TW",
      ...input,
    });

    expect(body.response_format).toEqual({
      type: "json_schema",
      json_schema: {
        name: "truly_general_page_investigation_adapter_v1",
        strict: true,
        schema: GENERAL_PAGE_INVESTIGATION_ADAPTER_RESPONSE_SCHEMA,
      },
    });
    expect(body.max_tokens).toBe(1_800);
    expect(body.temperature).toBe(0);
    expect(body.messages).toHaveLength(2);
    expect(body.messages[0]?.content).toContain("Keep c, q, sourceQuote, and atom s, p, and o in Taiwan Traditional Chinese");
    expect(body.messages[0]?.content).toContain("Exact grounding text is Taiwan Traditional Chinese");
    expect(body.messages[0]?.content).toContain("why, need, and displayQ use the requested UI language");
    expect(body.messages[0]?.content).toContain("sourceQuote");
    expect(body.messages[0]?.content).toContain("candidate is only a clue");
    expect(body.messages[0]?.content).toContain("exact substrings of c");
    expect(body.messages[0]?.content).toContain("copy sourceQuote first");
    expect(body.messages[0]?.content).toContain("exact ordered substrings of both sourceQuote and c");
    expect(body.messages[0]?.content).toContain("low-risk product availability");
    expect(body.messages[0]?.content).toContain("routine commercial events");
    expect(body.messages[0]?.content).toContain("related or recommended link");
    expect(body.messages[0]?.content).toContain("named evidence family");
    expect(body.messages[0]?.content).toContain("comparative claim");
    expect(body.messages[0]?.content).toContain("claim=null");
    expect(body.messages[0]?.content).toContain("attribution:null");

    expect(GENERAL_PAGE_INVESTIGATION_ADAPTER_RESPONSE_SCHEMA).toMatchObject({
      additionalProperties: false,
      required: ["schemaVersion", "decision", "reason", "claim"],
      properties: {
        schemaVersion: { type: "integer", const: 1 },
        decision: { enum: ["prepared", "abstain"] },
        claim: {
          anyOf: [
            { type: "null" },
            {
              additionalProperties: false,
              required: ["c", "why", "need", "q", "displayQ", "atom", "attribution", "policy", "sourceQuote"],
            },
          ],
        },
      },
    });
    const claimSchema = GENERAL_PAGE_INVESTIGATION_ADAPTER_RESPONSE_SCHEMA.properties.claim.anyOf[1];
    expect(claimSchema.properties.c.maxLength).toBe(200);
    expect(claimSchema.properties.sourceQuote).toEqual({ type: "string", minLength: 8, maxLength: 360 });
    expect(claimSchema.properties.atom).toMatchObject({
      additionalProperties: false,
      required: ["s", "p", "o"],
    });
    expect(claimSchema.properties.attribution.anyOf[1]).toMatchObject({
      additionalProperties: false,
      required: ["source", "relation", "modality"],
    });
  });

  it("keeps the explicit legacy capability on json_object without silent upgrade", () => {
    const body = buildTierBGeneralPageInvestigationAdapterChatBody({
      endpoint: "http://127.0.0.1:8000/v1",
      model: "fixture-model",
      structuredOutputMode: "json_object",
      ...input,
    });

    expect(body.response_format).toEqual({ type: "json_object" });
    expect(body.max_tokens).toBe(480);
  });

  it("rejects a missing runtime capability instead of silently using json_object", () => {
    expect(() => buildTierBGeneralPageInvestigationAdapterChatBody({
      endpoint: "http://127.0.0.1:8000/v1",
      model: "fixture-model",
      ...input,
    } as never)).toThrow("investigation_adapter_structured_output_mode_required");
  });

  it("normalizes the canonical constrained wire shape into the existing union", () => {
    const canonicalClaim = {
      c: "中聯油品下架29項產品。",
      why: "涉及食品安全。",
      need: "食藥署公告與產品清單。",
      q: "中聯油品是否下架29項產品？",
      displayQ: "中聯油品是否下架29項產品？",
      atom: { s: "中聯油品", p: "下架", o: "29項產品" },
      attribution: null,
      policy: { claimKind: "fact", consequence: "safety" },
      sourceQuote: "中聯油品下架29項產品。",
    };
    const internalClaim = {
      c: canonicalClaim.c,
      why: canonicalClaim.why,
      need: canonicalClaim.need,
      q: canonicalClaim.q,
      displayQ: canonicalClaim.displayQ,
      atom: canonicalClaim.atom,
      policy: canonicalClaim.policy,
      sourceQuote: canonicalClaim.sourceQuote,
    };
    expect(parseGeneralPageInvestigationAdapterContent(JSON.stringify({
      schemaVersion: 1,
      decision: "prepared",
      reason: "actionable",
      claim: canonicalClaim,
    }))).toEqual({
      ok: true,
      value: {
        schemaVersion: 1,
        decision: "prepared",
        reason: "actionable",
        claim: internalClaim,
      },
    });
    expect(parseGeneralPageInvestigationAdapterContent(JSON.stringify({
      schemaVersion: 1,
      decision: "abstain",
      reason: "unsafe_structure",
      claim: null,
    }))).toEqual({
      ok: true,
      value: { schemaVersion: 1, decision: "abstain", reason: "unsafe_structure" },
    });
  });

  it("rejects a localized atom that cannot be witnessed inside the source-language quote", () => {
    expect(parseGeneralPageInvestigationAdapterContent(JSON.stringify({
      schemaVersion: 1,
      decision: "prepared",
      reason: "actionable",
      claim: {
        c: "Example Agency表示，Example Product下架29項產品。",
        why: "涉及消費安全。",
        need: "主管機關公告與產品清單。",
        q: "Example Agency是否表示Example Product下架29項產品？",
        atom: { s: "Example Product", p: "下架", o: "29項產品" },
        attribution: { source: "Example Agency", relation: "表示", modality: "statement" },
        policy: { claimKind: "report", consequence: "safety" },
        sourceQuote: "Example Agency said Example Product recalled 29 products.",
      },
    }))).toMatchObject({ ok: false, value: null, error: "invalid_schema" });
  });

  it("rejects an incomplete prepared sentence at the adapter boundary", () => {
    const prefix = "Example Agency announced a public safety measure ";
    const incomplete = `${prefix}${"a".repeat(199 - Array.from(prefix).length)}`;
    expect(Array.from(incomplete)).toHaveLength(199);

    expect(parseGeneralPageInvestigationAdapterContent(JSON.stringify({
      schemaVersion: 1,
      decision: "prepared",
      reason: "actionable",
      claim: {
        c: incomplete,
        why: "The announcement affects public safety.",
        need: "The official agency announcement.",
        q: "Did Example Agency announce the public safety measure?",
        atom: { s: "Example Agency", p: "announced", o: "a public safety measure" },
        attribution: null,
        policy: { claimKind: "fact", consequence: "safety" },
        sourceQuote: incomplete,
      },
    }))).toMatchObject({ ok: false, value: null, error: "invalid_schema" });
  });

  it("allows natural question capitalization without weakening the evidence witness", () => {
    expect(parseGeneralPageInvestigationAdapterContent(JSON.stringify({
      schemaVersion: 1,
      decision: "prepared",
      reason: "actionable",
      claim: {
        c: "The analyzed content is synthetic.",
        why: "The result protects the deterministic UI audit.",
        need: "The synthetic fixture contract.",
        q: "Is the analyzed content synthetic?",
        atom: { s: "The analyzed content", p: "is", o: "synthetic" },
        attribution: null,
        policy: { claimKind: "fact", consequence: "public_interest" },
        sourceQuote: "The analyzed content is synthetic.",
      },
    }))).toMatchObject({ ok: true, value: { decision: "prepared" } });
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

  it("normalizes root attribution but resolves only an exact contiguous source quote", () => {
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
        sourceQuote: claimText,
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
    )).toBeUndefined();
    expect(resolveSourceQuote(
      `${second}, while younger soldiers could opt in.`,
      `${first}, in a programme announced by Pete Hegseth. ${second}, while younger soldiers could opt in.`,
      claimText,
    )).toBe(`${second}, while younger soldiers could opt in.`);
    expect(resolveSourceQuote(
      first,
      `${first}. Duplicate: ${first}.`,
      claimText,
    )).toBe(first);
    expect(resolveSourceQuote("aaaaaaaa", "aaaaaaaaa", claimText)).toBeUndefined();
    expect(resolveSourceQuote(
      first,
      `${second}, while younger soldiers could opt in.`,
      claimText,
    )).toBeUndefined();
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

  it("requires the canonical four-key wire contract only for schema-capable requests", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const schemaRequest = {
      endpoint: "http://127.0.0.1:8000/v1",
      model: "fixture-model",
      structuredOutputMode: "json_schema" as const,
      ...input,
    };
    const legacyRequest = { ...schemaRequest, structuredOutputMode: "json_object" as const };
    const response = (content: string) => ({
      ok: true,
      json: async () => ({ choices: [{ finish_reason: "stop", message: { content } }] }),
    });
    const legacyAbstain = JSON.stringify({
      schemaVersion: 1,
      decision: "abstain",
      reason: "unsupported_claim",
    });
    const legacyPrepared = JSON.stringify({
      schemaVersion: 1,
      decision: "prepared",
      reason: "actionable",
      claim: {
        c: "中聯油品下架29項產品。",
        why: "涉及食品安全。",
        need: "食藥署公告與產品清單。",
        q: "中聯油品是否下架29項產品？",
        atom: { s: "中聯油品", p: "下架", o: "29項產品" },
        policy: { claimKind: "fact", consequence: "safety" },
        sourceQuote: "中聯油品下架29項產品。",
      },
    });
    try {
      fetchMock.mockResolvedValueOnce(response(legacyAbstain));
      await expect(callTierBGeneralPageInvestigationAdapter(schemaRequest)).resolves.toMatchObject({
        ok: false,
        error: "investigation_adapter_invalid_schema",
      });

      fetchMock.mockResolvedValueOnce(response(legacyPrepared));
      await expect(callTierBGeneralPageInvestigationAdapter(schemaRequest)).resolves.toMatchObject({
        ok: false,
        error: "investigation_adapter_invalid_schema",
      });

      fetchMock.mockResolvedValueOnce(response(legacyAbstain));
      await expect(callTierBGeneralPageInvestigationAdapter(legacyRequest)).resolves.toMatchObject({
        ok: true,
        value: { decision: "abstain", reason: "unsupported_claim" },
      });

      fetchMock.mockResolvedValueOnce(response(legacyPrepared));
      await expect(callTierBGeneralPageInvestigationAdapter(legacyRequest)).resolves.toMatchObject({
        ok: true,
        value: { decision: "prepared", claim: { sourceQuote: "中聯油品下架29項產品。" } },
      });
      expect(fetchMock).toHaveBeenCalledTimes(4);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("classifies truncated, parse, schema, and source-quote failures without retrying", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const request = {
      endpoint: "http://127.0.0.1:8000/v1",
      model: "fixture-model",
      structuredOutputMode: "json_schema" as const,
      ...input,
    };
    const response = (content: string, finishReason = "stop") => ({
      ok: true,
      json: async () => ({ choices: [{ finish_reason: finishReason, message: { content } }] }),
    });
    try {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => { throw new SyntaxError("Unexpected token < in JSON"); },
      });
      await expect(callTierBGeneralPageInvestigationAdapter(request)).resolves.toMatchObject({
        ok: false,
        error: "investigation_adapter_invalid_json",
      });
      expect(fetchMock).toHaveBeenCalledTimes(1);

      fetchMock.mockResolvedValueOnce(response("{}", "length"));
      await expect(callTierBGeneralPageInvestigationAdapter(request)).resolves.toMatchObject({
        ok: false,
        error: "investigation_adapter_truncated",
      });
      expect(fetchMock).toHaveBeenCalledTimes(2);

      fetchMock.mockResolvedValueOnce(response("not-json"));
      await expect(callTierBGeneralPageInvestigationAdapter(request)).resolves.toMatchObject({
        ok: false,
        error: "investigation_adapter_invalid_json",
      });
      expect(fetchMock).toHaveBeenCalledTimes(3);

      fetchMock.mockResolvedValueOnce(response(JSON.stringify({
        schemaVersion: 1,
        decision: "prepared",
        reason: "unsupported_claim",
        claim: null,
      })));
      await expect(callTierBGeneralPageInvestigationAdapter(request)).resolves.toMatchObject({
        ok: false,
        error: "investigation_adapter_invalid_schema",
      });
      expect(fetchMock).toHaveBeenCalledTimes(4);

      fetchMock.mockResolvedValueOnce(response(JSON.stringify({
        schemaVersion: 1,
        decision: "prepared",
        reason: "actionable",
        claim: {
          c: "中聯油品下架29項產品。",
          why: "涉及食品安全。",
          need: "食藥署公告與產品清單。",
          q: "中聯油品是否下架29項產品？",
          displayQ: "中聯油品是否下架29項產品？",
          atom: { s: "中聯油品", p: "下架", o: "29項產品" },
          attribution: null,
          policy: { claimKind: "fact", consequence: "safety" },
          sourceQuote: "據其他資料，中聯油品下架29項產品。",
        },
      })));
      await expect(callTierBGeneralPageInvestigationAdapter(request)).resolves.toMatchObject({
        ok: false,
        error: "investigation_adapter_source_quote_error",
      });
      expect(fetchMock).toHaveBeenCalledTimes(5);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("marks a reason-specific prompt as evaluation-only semantic repair", () => {
    const prompt = buildGeneralPageInvestigationAdapterPrompt({ ...input, repairReason: "compound_claim" });
    expect(prompt).toContain("single allowed semantic repair attempt");
    expect(prompt).toContain("evaluation-only");
    expect(prompt).toContain("Local guard reason: compound_claim");
    expect(prompt).toContain("never work around the guard");
  });
});
