import { afterEach, describe, expect, it, vi } from "vitest";

import {
  buildGeneralPageInvestigationActionPresentation,
  buildGeneralPageInvestigationSpanAdapterPrompt,
  buildGeneralPageInvestigationSpanAdapterSystemPrompt,
  generalPageInvestigationSpanAdapterJsonSchema,
  parseAndMaterializeGeneralPageSpanAdapter,
} from "@src/lib/general-page-investigation-span-adapter";
import type { InvestigationSpanCandidate } from "@src/lib/investigation-span-candidate";
import {
  buildTierBGeneralPageInvestigationSpanAdapterChatBody,
  callTierBGeneralPageInvestigationSpanAdapter,
} from "@src/lib/tier-b-client";

const candidates: InvestigationSpanCandidate[] = [
  { id: "span:1", exactText: "食藥署公布232項產品名單", start: 0, end: 14 },
  { id: "span:2", exactText: "業者必須在七月三十一日前完成下架", start: 20, end: 38 },
];

const preparedWire = {
  schemaVersion: 2,
  decision: "prepared",
  reason: "actionable",
  selections: [{
    candidateId: "span:2",
    evidenceFamily: "official_notice",
    policy: { claimKind: "fact", consequence: "law" },
  }],
};

afterEach(() => vi.unstubAllGlobals());

describe("evaluation-only General Page span Adapter v2", () => {
  it("lets the model select only IDs and small enums while local code owns source text", () => {
    const result = parseAndMaterializeGeneralPageSpanAdapter(JSON.stringify(preparedWire), candidates);

    expect(result).toEqual({
      ok: true,
      value: {
        schemaVersion: 2,
        decision: "prepared",
        reason: "actionable",
        selections: [{
          candidateId: "span:2",
          exactClaim: "業者必須在七月三十一日前完成下架",
          sourceQuote: "業者必須在七月三十一日前完成下架",
          start: 20,
          end: 38,
          evidenceFamily: "official_notice",
          policy: { claimKind: "fact", consequence: "law" },
        }],
      },
    });
  });

  it("constrains the wire to three local IDs and contains no model-authored question or claim text", () => {
    const schema = generalPageInvestigationSpanAdapterJsonSchema(candidates.map(({ id }) => id));
    const selection = schema.properties.selections.items.properties;

    expect(schema.properties.schemaVersion.const).toBe(2);
    expect(schema.properties.selections.maxItems).toBe(3);
    expect(selection.candidateId.enum).toEqual(["span:1", "span:2"]);
    expect(Object.keys(selection)).toEqual(["candidateId", "evidenceFamily", "policy"]);
    expect(JSON.stringify(schema)).not.toMatch(/exactClaim|sourceQuote|displayQ|"q"|"why"|"need"/u);
  });

  it("accepts an explicit abstention and rejects unknown or duplicate IDs", () => {
    expect(parseAndMaterializeGeneralPageSpanAdapter(JSON.stringify({
      schemaVersion: 2,
      decision: "abstain",
      reason: "no_checkworthy_claim",
      selections: [],
    }), candidates)).toMatchObject({ ok: true, value: { decision: "abstain", selections: [] } });

    expect(parseAndMaterializeGeneralPageSpanAdapter(JSON.stringify({
      ...preparedWire,
      selections: [{ ...preparedWire.selections[0], candidateId: "span:9" }],
    }), candidates)).toMatchObject({ ok: false, issue: "unknown_candidate" });

    expect(parseAndMaterializeGeneralPageSpanAdapter(JSON.stringify({
      ...preparedWire,
      selections: [preparedWire.selections[0], preparedWire.selections[0]],
    }), candidates)).toMatchObject({ ok: false, issue: "duplicate_candidate" });
  });

  it("makes self-contained exact-span selection and ownership explicit in the prompt", () => {
    const system = buildGeneralPageInvestigationSpanAdapterSystemPrompt();
    const user = buildGeneralPageInvestigationSpanAdapterPrompt({
      candidates,
      targetKind: "page",
      sourceLang: "zh-TW",
      outputLang: "en",
      source: { title: "Synthetic article", url: "https://example.com/article" },
    });

    expect(system).toContain("Local code owns the exact claim");
    expect(system).toContain("lacks its actor or object");
    expect(system).toContain("the company, the recall, 業者, 該產品");
    expect(system).toContain("IDs and small policy enums only");
    expect(user).toContain('"id":"span:1"');
    expect(user).not.toContain("start");
    expect(user).not.toContain("end");
  });

  it("builds a deterministic localized evidence hint and Gemini handoff from local data", () => {
    const parsed = parseAndMaterializeGeneralPageSpanAdapter(JSON.stringify(preparedWire), candidates);
    if (!parsed.value || parsed.value.decision !== "prepared") throw new Error("fixture failed");
    const presentation = buildGeneralPageInvestigationActionPresentation(parsed.value.selections[0], {
      outputLang: "zh-TW",
      source: { title: "測試文章", url: "https://example.com/article" },
    });

    expect(presentation.displayClaim).toBe("業者必須在七月三十一日前完成下架");
    expect(presentation.evidenceHint).toBe("建議比對官方公告");
    expect(presentation.askAiPrompt).toContain("請查核以下原文陳述");
    expect(presentation.askAiPrompt).toContain("來源中繼資料（不等於證據）");
    expect(presentation.askAiPrompt).toContain("https://example.com/article");
  });

  it("lowers the model-neutral selector to one compact bounded OpenAI-compatible wire", () => {
    const body = buildTierBGeneralPageInvestigationSpanAdapterChatBody({
      endpoint: "http://127.0.0.1:8000/v1",
      model: "test-model",
      structuredOutputMode: "json_schema",
      candidates,
      targetKind: "page",
      outputLang: "zh-TW",
      sourceLang: "zh-TW",
    });

    expect(body.response_format).toMatchObject({
      type: "json_schema",
      json_schema: {
        name: "truly_general_page_investigation_span_adapter_v2",
        strict: true,
        schema: { properties: { selections: { maxItems: 3 } } },
      },
    });
    expect(body.max_tokens).toBe(400);
  });

  it("calls the provider once and returns local materialization plus telemetry", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      choices: [{ finish_reason: "stop", message: { content: JSON.stringify(preparedWire) } }],
      usage: { prompt_tokens: 220, completion_tokens: 50, total_tokens: 270 },
    }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(callTierBGeneralPageInvestigationSpanAdapter({
      endpoint: "http://127.0.0.1:8000/v1",
      model: "test-model",
      structuredOutputMode: "json_schema",
      candidates,
      targetKind: "page",
      outputLang: "zh-TW",
      sourceLang: "zh-TW",
    })).resolves.toMatchObject({
      ok: true,
      attempts: 1,
      usage: { promptTokens: 220, completionTokens: 50, totalTokens: 270 },
      value: { decision: "prepared", selections: [{ exactClaim: candidates[1].exactText }] },
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
