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
  schemaVersion: 3,
  selectedCandidateIds: ["span:2"],
};

afterEach(() => vi.unstubAllGlobals());

describe("General Page ranked exact-span selector v3", () => {
  it("lets the model select only ordered IDs while local code owns source text", () => {
    const result = parseAndMaterializeGeneralPageSpanAdapter(JSON.stringify(preparedWire), candidates);

    expect(result).toEqual({
      ok: true,
      value: {
        schemaVersion: 3,
        selections: [{
          candidateId: "span:2",
          exactClaim: "業者必須在七月三十一日前完成下架",
          sourceQuote: "業者必須在七月三十一日前完成下架",
          start: 20,
          end: 38,
        }],
      },
    });
  });

  it("constrains the wire to three ordered local IDs and contains no model-authored claim metadata", () => {
    const schema = generalPageInvestigationSpanAdapterJsonSchema(candidates.map(({ id }) => id));

    expect(schema.properties.schemaVersion.const).toBe(3);
    expect(schema.properties.selectedCandidateIds.maxItems).toBe(3);
    expect(schema.properties.selectedCandidateIds.items.enum).toEqual(["span:1", "span:2"]);
    expect(schema.properties.selectedCandidateIds).not.toHaveProperty("uniqueItems");
    expect(JSON.stringify(schema)).not.toMatch(/exactClaim|sourceQuote|displayQ|"q"|"why"|"need"/u);
    expect(JSON.stringify(schema)).not.toMatch(/policy|consequence|evidenceFamily/u);
  });

  it("uses an empty ordered ID list for abstention and rejects unknown or duplicate IDs", () => {
    expect(parseAndMaterializeGeneralPageSpanAdapter(JSON.stringify({
      schemaVersion: 3,
      selectedCandidateIds: [],
    }), candidates)).toMatchObject({ ok: true, value: { schemaVersion: 3, selections: [] } });

    expect(parseAndMaterializeGeneralPageSpanAdapter(JSON.stringify({
      schemaVersion: 3,
      selectedCandidateIds: ["span:9"],
    }), candidates)).toMatchObject({ ok: false, issue: "unknown_candidate" });

    expect(parseAndMaterializeGeneralPageSpanAdapter(JSON.stringify({
      schemaVersion: 3,
      selectedCandidateIds: ["span:2", "span:2"],
    }), candidates)).toMatchObject({ ok: false, issue: "duplicate_candidate" });

    expect(parseAndMaterializeGeneralPageSpanAdapter(JSON.stringify({
      schemaVersion: 3,
      selectedCandidateIds: [2],
    }), candidates)).toMatchObject({ ok: false, issue: "selection_shape" });
  });

  it("preserves model ranking order without adding another ranker", () => {
    const result = parseAndMaterializeGeneralPageSpanAdapter(JSON.stringify({
      schemaVersion: 3,
      selectedCandidateIds: ["span:2", "span:1"],
    }), candidates);

    expect(result.value?.selections.map(({ candidateId }) => candidateId)).toEqual(["span:2", "span:1"]);
  });

  it("makes domain-neutral ranking, abstention, and exact ownership explicit in the prompt", () => {
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
    expect(system).toContain("Filter before ranking");
    expect(system).toContain("Reject an entire candidate if any part");
    expect(system).toContain("Then rank only the survivors");
    expect(system).toContain("meta-statements about what the page cites");
    expect(system).toContain("incidental details whose verification would not materially change");
    expect(system).toContain("the company, the recall, 業者, 該產品");
    expect(system).toContain('"schemaVersion":3');
    expect(system).toContain("array order is the ranking");
    expect(system).toContain("Entertainment, sports, consumer");
    expect(system).toContain("does not qualify merely because it is concrete");
    expect(system).toContain("Public interest");
    expect(system).toContain("Do not fill a quota");
    expect(system).toContain("Choose the smallest useful set");
    expect(system).toContain("Usually return one action");
    expect(system).toContain("first ID must be the single action");
    expect(user).toContain('"id":"span:1"');
    expect(user).not.toContain("start");
    expect(user).not.toContain("end");
  });

  it("builds a deterministic localized generic evidence handoff from local data", () => {
    const parsed = parseAndMaterializeGeneralPageSpanAdapter(JSON.stringify(preparedWire), candidates);
    if (!parsed.value || parsed.value.selections.length === 0) throw new Error("fixture failed");
    const presentation = buildGeneralPageInvestigationActionPresentation(parsed.value.selections[0], {
      outputLang: "zh-TW",
      source: { title: "測試文章", url: "https://example.com/article" },
    });

    expect(presentation.displayClaim).toBe("業者必須在七月三十一日前完成下架");
    expect(presentation.evidenceHint).toBe("優先比對直接相關的官方資料、當事人原始聲明或可信報導");
    expect(presentation.askAiPrompt).toContain("請查核以下原文陳述");
    expect(presentation.askAiPrompt).toContain("請先辨識其中的人物、機構、事件、數字、日期");
    expect(presentation.askAiPrompt).toContain("若找不到直接證據");
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
        name: "truly_general_page_investigation_span_adapter_v3",
        strict: true,
        schema: { properties: { selectedCandidateIds: { maxItems: 3 } } },
      },
    });
    expect(body.max_tokens).toBe(160);
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
      value: { schemaVersion: 3, selections: [{ exactClaim: candidates[1].exactText }] },
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
