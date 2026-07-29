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
  { id: "span:3", exactText: "衛生局公布完整下架紀錄", start: 40, end: 52 },
];
const authorizedSourceContext = [
  "食藥署公布232項產品名單。",
  "衛生局命令遠帆公司在七月三十一日前完成下架。",
].join("\n");

const preparedWire = {
  schemaVersion: 12,
  selections: [
    { candidateId: "span:2" },
    { candidateId: "span:1" },
    { candidateId: "span:3" },
  ],
};

afterEach(() => vi.unstubAllGlobals());

describe("General Page exact-span proposal selector with schema v12", () => {
  it("lets the model rank only IDs while local code owns source text", () => {
    const result = parseAndMaterializeGeneralPageSpanAdapter(JSON.stringify(preparedWire), candidates);

    expect(result).toEqual({
      ok: true,
      value: {
        schemaVersion: 12,
        selections: [{
          candidateId: "span:2",
          exactClaim: "業者必須在七月三十一日前完成下架",
          sourceQuote: "業者必須在七月三十一日前完成下架",
          start: 20,
          end: 38,
        }, {
          candidateId: "span:1",
          exactClaim: "食藥署公布232項產品名單",
          sourceQuote: "食藥署公布232項產品名單",
          start: 0,
          end: 14,
        }, {
          candidateId: "span:3",
          exactClaim: "衛生局公布完整下架紀錄",
          sourceQuote: "衛生局公布完整下架紀錄",
          start: 40,
          end: 52,
        }],
      },
    });
  });

  it("constrains the wire to three distinct local IDs and contains no model-authored claim metadata", () => {
    const schema = generalPageInvestigationSpanAdapterJsonSchema(candidates.map(({ id }) => id));

    expect(schema.properties.schemaVersion.const).toBe(12);
    expect(schema.properties.selections).toEqual({
      type: "array",
      minItems: 3,
      maxItems: 3,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["candidateId"],
        properties: {
          candidateId: {
            type: "string",
            enum: ["span:1", "span:2", "span:3"],
          },
        },
      },
    });
    expect(JSON.stringify(schema)).not.toMatch(/exactClaim|sourceQuote|displayQ|"q"|"why"|"need"/u);
    expect(JSON.stringify(schema)).not.toMatch(/policy|consequence|evidenceFamily/u);
    expect(JSON.stringify(schema)).not.toContain("uniqueItems");
  });

  it("rejects abstention, unknown IDs, and extra fields", () => {
    expect(parseAndMaterializeGeneralPageSpanAdapter(JSON.stringify({
      schemaVersion: 12,
      selections: null,
    }), candidates)).toMatchObject({ ok: false, issue: "root_shape" });

    expect(parseAndMaterializeGeneralPageSpanAdapter(JSON.stringify({
      schemaVersion: 12,
      selections: [
        { candidateId: "span:9" },
        { candidateId: "span:1" },
        { candidateId: "span:2" },
      ],
    }), candidates)).toMatchObject({ ok: false, issue: "unknown_candidate" });

    expect(parseAndMaterializeGeneralPageSpanAdapter(JSON.stringify({
      schemaVersion: 12,
      selections: 2,
    }), candidates)).toMatchObject({ ok: false, issue: "root_shape" });

    expect(parseAndMaterializeGeneralPageSpanAdapter(JSON.stringify({
      schemaVersion: 12,
      selections: [],
      secondaryCandidateIds: [],
    }), candidates)).toMatchObject({ ok: false, issue: "root_shape" });

    expect(parseAndMaterializeGeneralPageSpanAdapter(JSON.stringify({
      schemaVersion: 12,
      selections: [
        { candidateId: "" },
        { candidateId: "span:1" },
        { candidateId: "span:2" },
      ],
    }), candidates)).toMatchObject({ ok: false, issue: "unknown_candidate" });

    expect(parseAndMaterializeGeneralPageSpanAdapter(JSON.stringify({
      schemaVersion: 12,
      selections: [
        { candidateId: "span:1", presentationTier: "secondary" },
        { candidateId: "span:2" },
        { candidateId: "span:3" },
      ],
    }), candidates)).toMatchObject({ ok: false, issue: "selection_shape" });

    expect(parseAndMaterializeGeneralPageSpanAdapter(JSON.stringify({
      schemaVersion: 12,
      selections: [
        { candidateId: "span:1" },
        { candidateId: "span:1" },
        { candidateId: "span:2" },
      ],
    }), candidates)).toMatchObject({ ok: false, issue: "unknown_candidate" });
  });

  it("materializes only the selected recommendation without adding another ranker", () => {
    const result = parseAndMaterializeGeneralPageSpanAdapter(JSON.stringify({
      schemaVersion: 12,
      selections: [
        { candidateId: "span:2" },
        { candidateId: "span:1" },
        { candidateId: "span:3" },
      ],
    }), candidates);

    expect(result.value?.selections.map(({ candidateId }) => candidateId)).toEqual([
      "span:2",
      "span:1",
      "span:3",
    ]);
  });

  it("materializes three distinct ranked backups without owning their text", () => {
    const result = parseAndMaterializeGeneralPageSpanAdapter(JSON.stringify({
      schemaVersion: 12,
      selections: [
        { candidateId: "span:2" },
        { candidateId: "span:1" },
        { candidateId: "span:3" },
      ],
    }), candidates);

    expect(result.value?.selections.map(({ candidateId, exactClaim }) => ({
      candidateId,
      exactClaim,
    }))).toEqual([
      { candidateId: "span:2", exactClaim: candidates[1].exactText },
      { candidateId: "span:1", exactClaim: candidates[0].exactText },
      { candidateId: "span:3", exactClaim: candidates[2].exactText },
    ]);
  });

  it("makes domain-neutral ranking, sole Admission authority, and exact ownership explicit in the prompt", () => {
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
    expect(system).toContain("Rank up to three internal fact-check candidates");
    expect(system).toContain("still publishes at most one reader-facing action");
    expect(system).toContain("Admission critic alone decides");
    expect(system).toContain("best, easiest, or most user-friendly");
    expect(system).toContain("tutorial-like advice");
    expect(system).toContain("'many' or 'some' unnamed companies or people");
    expect(system).toContain("Apply these three steps in order");
    expect(system).toContain("Cleanliness is a non-negotiable prerequisite");
    expect(system).toContain("cannot rescue a dirty span");
    expect(system).toContain("article, newsletter, or editor meta-description");
    expect(system).toContain("adjacent Page-role labels");
    expect(system).toContain("forward pointer to a following example");
    expect(system).toContain("clean substantive judgment or action");
    expect(system).toContain("complete, standalone proposition");
    expect(system).toContain("realistic independent public evidence");
    expect(system).not.toContain('Return exactly {"schemaVersion":6,"candidateId":"span:1"}');
    expect(system).toContain("unresolved referents");
    expect(system).toContain("Context may reveal a defect but may not repair");
    expect(system).toContain("independent public evidence could directly support or contradict");
    expect(system).toContain("named public attribution");
    expect(system).toContain("Entertainment, sport, consumer, product, celebrity");
    expect(system).toContain("unnamed hearsay");
    expect(system).toContain("private anecdotes");
    expect(system).toContain("unspecified research or experts");
    expect(system).toContain("navigation, interface text");
    expect(system).toContain("flattens one of those roles into a body sentence");
    expect(system).toContain("names only the enclosing API object");
    expect(system).toContain("code declaration or interface label");
    expect(system).toContain("change-history snippets");
    expect(system).toContain("role-prefixed spans such as 'Price ...'");
    expect(system).toContain("'the technology'");
    expect(system).toContain("license or download boilerplate");
    expect(system).toContain("central public record, catalog, specification, filing, or dataset fact");
    expect(system).toContain("On a literary or fiction Page");
    expect(system).toContain("real-world aside, analogy, or historical comparison");
    expect(system).toContain(
      "satirical premise, setup, punchline, tutorial-like advice",
    );
    expect(system).toContain("incidental real-world aside used only to support the joke");
    expect(system).toContain("Project Gutenberg license and bibliographic header");
    expect(system).toContain("compare survivors by investigation utility");
    expect(system).toContain("stable definition, API behavior, workflow, capability");
    expect(system).toContain("select the strongest complete and publicly checkable stable definition");
    expect(system).toContain("Treat this as a valid lower utility class");
    expect(system).toContain("stable definition, API behavior, workflow, capability");
    expect(system).toContain("retrospective history or career biography");
    expect(system).toContain("Being the only survivor does not raise its utility");
    expect(system).toContain("newly available product or service");
    expect(system).toContain("menu or catalog addition remains high-utility");
    expect(system).toContain("multi-item or newsletter Page");
    expect(system).toContain("Sponsorship or commercial context alone");
    expect(system).toContain("Do not decide whether a candidate is true");
    expect(system).toContain('"selections":[{"candidateId":"span:N"}]');
    expect(system).toContain("distinct supplied candidateIds");
    expect(system).toContain("Entertainment, sport, consumer");
    expect(system).toContain("distinct supplied candidateIds inside selections");
    expect(system).toContain("judgment context");
    expect(system).toContain("sole claim-identity boundary");
    expect(system).toContain('"schemaVersion":12');
    expect(system).toContain("least-defective remaining candidates");
    expect(system).toContain("Admission can reject them");
    expect(user).toContain('"id":"span:1"');
    expect(user).toContain("Target: current Page content");
    expect(user).not.toContain("Target: main article");
    expect(user).toContain("## Authorized Page context — judgment context only");
    expect(user).toContain(JSON.stringify({ text: authorizedSourceContext }));
    expect(user).toContain("## Proposal");
    expect(user).toContain("rank exactly 3 distinct candidates strongest to weakest");
    expect(user).toContain("stable reference, definition, API behavior, service workflow, capability, catalog fact");
    expect(user).toContain("select the strongest complete and publicly checkable stable reference");
    expect(user).toContain("Being the only survivor does not raise its utility");
    expect(user).toContain("Fictional narration and publisher or license boilerplate remain lowest-ranked inputs");
    expect(user).toContain("exactly 3 distinct supplied candidate IDs");
    expect(user).toContain("Context cannot repair an unresolved or metadata-prefixed exact span");
    expect(user).toContain("centrality never overrides structural cleanliness");
    expect(user).toMatch(/strongest first\.$/u);
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
    const presentation = buildGeneralPageInvestigationActionPresentation({
      ...parsed.value.selections[0],
      presentationTier: "primary",
    }, {
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
        name: "truly_general_page_investigation_span_adapter_v12",
        strict: true,
        schema: {
          properties: {
            schemaVersion: { const: 12 },
            selections: {
              type: "array",
              minItems: 3,
              maxItems: 3,
              items: {
                type: "object",
                additionalProperties: false,
                required: ["candidateId"],
                properties: {
                  candidateId: {
                    type: "string",
                    enum: ["span:1", "span:2", "span:3"],
                  },
                },
              },
            },
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
        schemaVersion: 12,
        selections: [
          { exactClaim: candidates[1].exactText },
          { exactClaim: candidates[0].exactText },
          { exactClaim: candidates[2].exactText },
        ],
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
      value: {
        schemaVersion: 12,
        selections: [
          { candidateId: "span:2" },
          { candidateId: "span:1" },
          { candidateId: "span:3" },
        ],
      },
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
            schemaVersion: 12,
            selections: [
              { candidateId: "span:99" },
              { candidateId: "span:1" },
              { candidateId: "span:2" },
            ],
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
