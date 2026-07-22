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
  schemaVersion: 5,
  candidateId: "span:2",
};

afterEach(() => vi.unstubAllGlobals());

describe("General Page recommended exact-span selector with schema v5", () => {
  it("lets the model select only ordered IDs while local code owns source text", () => {
    const result = parseAndMaterializeGeneralPageSpanAdapter(JSON.stringify(preparedWire), candidates);

    expect(result).toEqual({
      ok: true,
      value: {
        schemaVersion: 5,
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

  it("constrains the wire to one local ID or abstention and contains no model-authored claim metadata", () => {
    const schema = generalPageInvestigationSpanAdapterJsonSchema(candidates.map(({ id }) => id));

    expect(schema.properties.schemaVersion.const).toBe(5);
    expect(schema.properties.candidateId.enum).toEqual(["span:1", "span:2", null]);
    expect(JSON.stringify(schema)).not.toMatch(/exactClaim|sourceQuote|displayQ|"q"|"why"|"need"/u);
    expect(JSON.stringify(schema)).not.toMatch(/policy|consequence|evidenceFamily/u);
  });

  it("uses null for abstention and rejects unknown IDs or extra fields", () => {
    expect(parseAndMaterializeGeneralPageSpanAdapter(JSON.stringify({
      schemaVersion: 5,
      candidateId: null,
    }), candidates)).toMatchObject({ ok: true, value: { schemaVersion: 5, selections: [] } });

    expect(parseAndMaterializeGeneralPageSpanAdapter(JSON.stringify({
      schemaVersion: 5,
      candidateId: "span:9",
    }), candidates)).toMatchObject({ ok: false, issue: "unknown_candidate" });

    expect(parseAndMaterializeGeneralPageSpanAdapter(JSON.stringify({
      schemaVersion: 5,
      candidateId: 2,
    }), candidates)).toMatchObject({ ok: false, issue: "root_shape" });

    expect(parseAndMaterializeGeneralPageSpanAdapter(JSON.stringify({
      schemaVersion: 5,
      candidateId: null,
      secondaryCandidateIds: [],
    }), candidates)).toMatchObject({ ok: false, issue: "root_shape" });
  });

  it("materializes only the selected recommendation without adding another ranker", () => {
    const result = parseAndMaterializeGeneralPageSpanAdapter(JSON.stringify({
      schemaVersion: 5,
      candidateId: "span:2",
    }), candidates);

    expect(result.value?.selections.map(({ candidateId }) => candidateId)).toEqual(["span:2"]);
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
    expect(system).toContain("Default to null");
    expect(system).toContain("two internal passes");
    expect(system).toContain("all three tests pass");
    expect(system).toContain("complete standalone statement");
    expect(system).toContain("source's subject or a key factual support");
    expect(system).toContain("navigation or interface text");
    expect(system).toContain("citations or authoring metadata");
    expect(system).toContain("locate its exactText in the ordered source");
    expect(system).toContain("nearest section or line label");
    expect(system).toContain("reject the whole span");
    expect(system).toContain("describes the source, not the external world");
    expect(system).toContain("Attribution rule");
    expect(system).toContain("judge the embedded proposition");
    expect(system).toContain("unnamed analysts");
    expect(system).toContain("broad definition");
    expect(system).toContain("secondary context");
    expect(system).toContain("best alternative");
    expect(system).toContain("clearly the most useful statement");
    expect(system).toContain("may not supply a missing actor");
    expect(system).toContain('"schemaVersion":5');
    expect(system).toContain("Entertainment, sports, consumer");
    expect(system).toContain("public impact");
    expect(system).toContain("Return exactly one supplied candidateId or null");
    expect(system).toContain("A named recall");
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
        name: "truly_general_page_investigation_span_adapter_v5",
        strict: true,
        schema: {
          properties: {
            candidateId: { enum: ["span:1", "span:2", null] },
          },
        },
      },
    });
    expect(body.max_tokens).toBe(96);
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
      value: { schemaVersion: 5, selections: [{ exactClaim: candidates[1].exactText }] },
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("retries one malformed protocol response with the identical request and reports recovery", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        choices: [{ finish_reason: "stop", message: { content: "{broken" } }],
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        choices: [{ finish_reason: "stop", message: { content: JSON.stringify(preparedWire) } }],
      }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(callTierBGeneralPageInvestigationSpanAdapter({
      endpoint: "http://127.0.0.1:8000/v1",
      model: "test-model",
      structuredOutputMode: "json_object",
      candidates,
      targetKind: "page",
      outputLang: "zh-TW",
      sourceLang: "zh-TW",
    })).resolves.toMatchObject({
      ok: true,
      attempts: 2,
      protocolRecovered: true,
      firstAttemptError: "investigation_span_adapter_invalid_json",
      value: { schemaVersion: 5, selections: [{ candidateId: "span:2" }] },
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0]?.[1]?.body).toBe(fetchMock.mock.calls[1]?.[1]?.body);
  });

  it("retries only a top-level root-shape failure, not an unknown candidate", async () => {
    const rootShapeFetch = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        choices: [{ finish_reason: "stop", message: { content: JSON.stringify({ schemaVersion: ": 5, " }) } }],
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        choices: [{ finish_reason: "stop", message: { content: JSON.stringify(preparedWire) } }],
      }), { status: 200 }));
    vi.stubGlobal("fetch", rootShapeFetch);

    await expect(callTierBGeneralPageInvestigationSpanAdapter({
      endpoint: "http://127.0.0.1:8000/v1",
      model: "test-model",
      structuredOutputMode: "json_object",
      candidates,
      targetKind: "page",
    })).resolves.toMatchObject({
      ok: true,
      attempts: 2,
      protocolRecovered: true,
      firstAttemptError: "investigation_span_adapter_invalid_schema",
      firstAttemptIssue: "root_shape",
    });
    expect(rootShapeFetch).toHaveBeenCalledTimes(2);

    const unknownFetch = vi.fn(async () => new Response(JSON.stringify({
      choices: [{ finish_reason: "stop", message: { content: JSON.stringify({ schemaVersion: 5, candidateId: "span:99" }) } }],
    }), { status: 200 }));
    vi.stubGlobal("fetch", unknownFetch);
    await expect(callTierBGeneralPageInvestigationSpanAdapter({
      endpoint: "http://127.0.0.1:8000/v1",
      model: "test-model",
      structuredOutputMode: "json_object",
      candidates,
      targetKind: "page",
    })).resolves.toMatchObject({
      ok: false,
      attempts: 1,
      issue: "unknown_candidate",
    });
    expect(unknownFetch).toHaveBeenCalledTimes(1);
  });

  it("stops after one protocol retry and lets the one-shot release gate disable recovery", async () => {
    const invalidResponse = () => new Response(JSON.stringify({
      choices: [{ finish_reason: "stop", message: { content: "not-json" } }],
    }), { status: 200 });
    const retryFetch = vi.fn(async () => invalidResponse());
    vi.stubGlobal("fetch", retryFetch);
    await expect(callTierBGeneralPageInvestigationSpanAdapter({
      endpoint: "http://127.0.0.1:8000/v1",
      model: "test-model",
      structuredOutputMode: "json_object",
      candidates,
      targetKind: "page",
    })).resolves.toMatchObject({
      ok: false,
      attempts: 2,
      firstAttemptError: "investigation_span_adapter_invalid_json",
      protocolRecovered: false,
    });
    expect(retryFetch).toHaveBeenCalledTimes(2);

    const oneShotFetch = vi.fn(async () => invalidResponse());
    vi.stubGlobal("fetch", oneShotFetch);
    await expect(callTierBGeneralPageInvestigationSpanAdapter({
      endpoint: "http://127.0.0.1:8000/v1",
      model: "test-model",
      structuredOutputMode: "json_object",
      candidates,
      targetKind: "page",
      maxProtocolAttempts: 1,
    })).resolves.toMatchObject({ ok: false, attempts: 1 });
    expect(oneShotFetch).toHaveBeenCalledTimes(1);
  });
});
