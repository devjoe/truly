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
const authorizedSourceContext = [
  "食藥署公布232項產品名單。",
  "衛生局命令遠帆公司在七月三十一日前完成下架。",
].join("\n");

const preparedWire = {
  schemaVersion: 7,
  candidateId: "span:2",
  presentationTier: "primary",
};

afterEach(() => vi.unstubAllGlobals());

describe("General Page exact-span proposal selector with schema v7", () => {
  it("lets the model select only ordered IDs while local code owns source text", () => {
    const result = parseAndMaterializeGeneralPageSpanAdapter(JSON.stringify(preparedWire), candidates);

    expect(result).toEqual({
      ok: true,
      value: {
        schemaVersion: 7,
        selections: [{
          candidateId: "span:2",
          presentationTier: "primary",
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

    expect(schema.properties.schemaVersion.const).toBe(7);
    expect(schema.properties.candidateId.enum).toEqual(["span:1", "span:2", null]);
    expect(schema.properties.presentationTier.enum).toEqual(["primary", "exploratory", null]);
    expect(JSON.stringify(schema)).not.toMatch(/exactClaim|sourceQuote|displayQ|"q"|"why"|"need"/u);
    expect(JSON.stringify(schema)).not.toMatch(/policy|consequence|evidenceFamily/u);
  });

  it("uses null for abstention and rejects unknown IDs or extra fields", () => {
    expect(parseAndMaterializeGeneralPageSpanAdapter(JSON.stringify({
      schemaVersion: 7,
      candidateId: null,
      presentationTier: null,
    }), candidates)).toMatchObject({ ok: true, value: { schemaVersion: 7, selections: [] } });

    expect(parseAndMaterializeGeneralPageSpanAdapter(JSON.stringify({
      schemaVersion: 7,
      candidateId: "span:9",
      presentationTier: "primary",
    }), candidates)).toMatchObject({ ok: false, issue: "unknown_candidate" });

    expect(parseAndMaterializeGeneralPageSpanAdapter(JSON.stringify({
      schemaVersion: 7,
      candidateId: 2,
      presentationTier: "primary",
    }), candidates)).toMatchObject({ ok: false, issue: "root_shape" });

    expect(parseAndMaterializeGeneralPageSpanAdapter(JSON.stringify({
      schemaVersion: 7,
      candidateId: null,
      presentationTier: null,
      secondaryCandidateIds: [],
    }), candidates)).toMatchObject({ ok: false, issue: "root_shape" });

    expect(parseAndMaterializeGeneralPageSpanAdapter(JSON.stringify({
      schemaVersion: 7,
      candidateId: null,
      presentationTier: "exploratory",
    }), candidates)).toMatchObject({ ok: false, issue: "tier_coupling" });

    expect(parseAndMaterializeGeneralPageSpanAdapter(JSON.stringify({
      schemaVersion: 7,
      candidateId: "span:1",
      presentationTier: null,
    }), candidates)).toMatchObject({ ok: false, issue: "tier_coupling" });
  });

  it("materializes only the selected recommendation without adding another ranker", () => {
    const result = parseAndMaterializeGeneralPageSpanAdapter(JSON.stringify({
      schemaVersion: 7,
      candidateId: "span:2",
      presentationTier: "exploratory",
    }), candidates);

    expect(result.value?.selections.map(({ candidateId }) => candidateId)).toEqual(["span:2"]);
    expect(result.value?.selections[0]?.presentationTier).toBe("exploratory");
  });

  it("makes domain-neutral ranking, abstention, and exact ownership explicit in the prompt", () => {
    const system = buildGeneralPageInvestigationSpanAdapterSystemPrompt();
    const user = buildGeneralPageInvestigationSpanAdapterPrompt({
      candidates,
      targetKind: "page",
      authorizedSourceContext,
      sourceLang: "zh-TW",
      outputLang: "en",
      source: { title: "Synthetic article", url: "https://example.com/article" },
    });

    expect(system).toContain("Local code owns the exact claim");
    expect(system).toContain("separate admission critic");
    expect(system).toContain("presentationTier to primary, exploratory, or null");
    expect(system).toContain("First discard structurally unusable spans, then rank the rest");
    expect(system).toContain("complete standalone proposition");
    expect(system).toContain("realistic independent public evidence");
    expect(system).not.toContain('Return exactly {"schemaVersion":6,"candidateId":"span:1"}');
    expect(system).toContain("subject or referent unresolved");
    expect(system).toContain("Context may reveal a defect but may not repair");
    expect(system).toContain("Prefer concrete externally decidable facts");
    expect(system).toContain("concrete public record, event, or attributed public statement");
    expect(system).toContain("biography, relationships, entertainment, or celebrity");
    expect(system).toContain("unnamed hearsay");
    expect(system).toContain("anonymous anecdote generalized to a wider group");
    expect(system).toContain("identifies no study, organization, dataset");
    expect(system).toContain("navigation or interface text");
    expect(system).toContain("flattens an article title, section heading, publisher label, or media credit");
    expect(system).toContain("incidental catalog metadata");
    expect(system).toContain("primary purpose is a public record, catalog entry");
    expect(system).toContain("where-to-watch, where-to-buy");
    expect(system).toContain("metaphor, nickname, analogy, or cultural allusion");
    expect(system).toContain("candidate list as source order");
    expect(system).toContain("immediate neighboring candidates");
    expect(system).toContain("categorical wording");
    expect(system).toContain("condition, exception, attribution, or scope limit");
    expect(system).toContain("named public system, scientific or health fact");
    expect(system).toContain("correct API behavior");
    expect(system).toContain("can be exploratory");
    expect(system).toContain("stable reference or operational proposition");
    expect(system).toContain("historical publication, filing, release, or record date remains exploratory");
    expect(system).toContain("Tiering is absolute, not relative");
    expect(system).toContain("newly available product or menu item");
    expect(system).toContain("no primary survivor exists");
    expect(system).toContain("not truth probability or model confidence");
    expect(system).toContain("attributed slogan, insult, or inflammatory metaphor");
    expect(system).toContain("so ... must have");
    expect(system).toContain("Do not decide whether a candidate is true");
    expect(system).toContain("Use schemaVersion 7");
    expect(system).toContain("Entertainment, sports, consumer");
    expect(system).toContain("public impact");
    expect(system).toContain("Return exactly one supplied candidateId with one tier");
    expect(system).toContain("judgment context");
    expect(system).toContain("sole claim-identity boundary");
    expect(system).toContain("schemaVersion 7");
    expect(user).toContain('"id":"span:1"');
    expect(user).toContain("Target: current Page content");
    expect(user).not.toContain("Target: main article");
    expect(user).toContain("## Authorized Page context — judgment context only");
    expect(user).toContain(JSON.stringify({ text: authorizedSourceContext }));
    expect(user).toContain("## Proposal");
    expect(user).toContain("externally checkable proposition");
    expect(user).toContain("stable reference, definition, API behavior, service workflow, capability, or catalog proposition as exploratory");
    expect(user).toContain("Do not label the best available candidate primary");
    expect(user).toContain("private, subjective, incidental-metadata, fragmentary, and instruction-like material");
    expect(user).toContain("Return null only when no complete externally checkable proposition exists");
    expect(user).toMatch(/Return one JSON object with schemaVersion 7, candidateId set to one supplied ID or null, and presentationTier strictly coupled to that ID\.$/u);
    expect(user).not.toMatch(/"start":|"end":/u);
  });

  it("requires one bounded authorized Page context", () => {
    expect(() => buildGeneralPageInvestigationSpanAdapterPrompt({
      candidates,
      targetKind: "page",
      authorizedSourceContext: "",
    })).toThrow("invalid authorized Page context");
    expect(() => buildGeneralPageInvestigationSpanAdapterPrompt({
      candidates,
      targetKind: "page",
      authorizedSourceContext: "x".repeat(8193),
    })).toThrow("invalid authorized Page context");
    expect(() => buildGeneralPageInvestigationSpanAdapterPrompt({
      candidates,
      targetKind: "selection",
      authorizedSourceContext,
    })).toThrow("Page-only investigation selector");
  });

  it("builds a deterministic localized generic evidence handoff from local data", () => {
    const parsed = parseAndMaterializeGeneralPageSpanAdapter(JSON.stringify(preparedWire), candidates);
    if (!parsed.value || parsed.value.selections.length === 0) throw new Error("fixture failed");
    const presentation = buildGeneralPageInvestigationActionPresentation(parsed.value.selections[0], {
      outputLang: "zh-TW",
      source: { title: "測試文章", url: "https://example.com/article" },
    });

    expect(presentation.displayClaim).toBe("業者必須在七月三十一日前完成下架");
    expect(presentation.presentationTier).toBe("primary");
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
      authorizedSourceContext,
      outputLang: "zh-TW",
      sourceLang: "zh-TW",
    });

    expect(body.response_format).toMatchObject({
      type: "json_schema",
      json_schema: {
        name: "truly_general_page_investigation_span_adapter_v7",
        strict: true,
        schema: {
          properties: {
            candidateId: { enum: ["span:1", "span:2", null] },
            presentationTier: { enum: ["primary", "exploratory", null] },
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
      authorizedSourceContext,
      outputLang: "zh-TW",
      sourceLang: "zh-TW",
    })).resolves.toMatchObject({
      ok: true,
      attempts: 1,
      usage: { promptTokens: 220, completionTokens: 50, totalTokens: 270 },
      value: {
        schemaVersion: 7,
        selections: [{
          exactClaim: candidates[1].exactText,
          presentationTier: "primary",
        }],
      },
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
      authorizedSourceContext,
      outputLang: "zh-TW",
      sourceLang: "zh-TW",
    })).resolves.toMatchObject({
      ok: true,
      attempts: 2,
      protocolRecovered: true,
      firstAttemptError: "investigation_span_adapter_invalid_json",
      value: { schemaVersion: 7, selections: [{ candidateId: "span:2", presentationTier: "primary" }] },
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
      authorizedSourceContext,
    })).resolves.toMatchObject({
      ok: true,
      attempts: 2,
      protocolRecovered: true,
      firstAttemptError: "investigation_span_adapter_invalid_schema",
      firstAttemptIssue: "root_shape",
    });
    expect(rootShapeFetch).toHaveBeenCalledTimes(2);

    const unknownFetch = vi.fn(async () => new Response(JSON.stringify({
      choices: [{
        finish_reason: "stop",
        message: {
          content: JSON.stringify({
            schemaVersion: 7,
            candidateId: "span:99",
            presentationTier: "primary",
          }),
        },
      }],
    }), { status: 200 }));
    vi.stubGlobal("fetch", unknownFetch);
    await expect(callTierBGeneralPageInvestigationSpanAdapter({
      endpoint: "http://127.0.0.1:8000/v1",
      model: "test-model",
      structuredOutputMode: "json_object",
      candidates,
      targetKind: "page",
      authorizedSourceContext,
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
      authorizedSourceContext,
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
      authorizedSourceContext,
      maxProtocolAttempts: 1,
    })).resolves.toMatchObject({ ok: false, attempts: 1 });
    expect(oneShotFetch).toHaveBeenCalledTimes(1);
  });
});
