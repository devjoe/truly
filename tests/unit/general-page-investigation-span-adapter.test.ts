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
  schemaVersion: 13,
  selections: [
    { candidateId: "span:2", presentationTier: "primary" },
    { candidateId: "span:1", presentationTier: "exploratory" },
  ],
};

afterEach(() => vi.unstubAllGlobals());

describe("General Page single-pass exact-span selector with schema v13", () => {
  it("materializes model-selected IDs and tiers while local code owns exact text", () => {
    expect(parseAndMaterializeGeneralPageSpanAdapter(
      JSON.stringify(preparedWire),
      candidates,
    )).toEqual({
      ok: true,
      value: {
        schemaVersion: 13,
        selections: [{
          candidateId: "span:2",
          presentationTier: "primary",
          exactClaim: candidates[1].exactText,
          sourceQuote: candidates[1].exactText,
          start: 20,
          end: 38,
        }, {
          candidateId: "span:1",
          presentationTier: "exploratory",
          exactClaim: candidates[0].exactText,
          sourceQuote: candidates[0].exactText,
          start: 0,
          end: 14,
        }],
      },
    });
  });

  it("allows abstention and bounds the provider-neutral ID-plus-tier wire", () => {
    const schema = generalPageInvestigationSpanAdapterJsonSchema(
      candidates.map(({ id }) => id),
    );

    expect(schema.properties.schemaVersion.const).toBe(13);
    expect(schema.properties.selections.minItems).toBe(0);
    expect(schema.properties.selections.maxItems).toBe(3);
    expect(schema.properties.selections.items.required).toEqual([
      "candidateId",
      "presentationTier",
    ]);
    expect(schema.properties.selections.items.properties.presentationTier.enum)
      .toEqual(["primary", "exploratory"]);
    expect(parseAndMaterializeGeneralPageSpanAdapter(JSON.stringify({
      schemaVersion: 13,
      selections: [],
    }), candidates)).toEqual({
      ok: true,
      value: { schemaVersion: 13, selections: [] },
    });
    expect(JSON.stringify(schema)).not.toMatch(
      /exactClaim|sourceQuote|displayQ|"q"|"why"|"need"/u,
    );
    expect(JSON.stringify(schema)).not.toContain("uniqueItems");
  });

  it("rejects unknown, duplicate, malformed, over-limit, and extra-field selections", () => {
    const invalidSelections = [
      [{ candidateId: "span:9", presentationTier: "primary" }],
      [
        { candidateId: "span:1", presentationTier: "primary" },
        { candidateId: "span:1", presentationTier: "exploratory" },
      ],
      [{ candidateId: "span:1", presentationTier: "secondary" }],
      [{ candidateId: "span:1" }],
      [{ candidateId: "span:1", presentationTier: "primary", claim: "rewrite" }],
      ...[[
        { candidateId: "span:1", presentationTier: "primary" },
        { candidateId: "span:2", presentationTier: "primary" },
        { candidateId: "span:3", presentationTier: "exploratory" },
        { candidateId: "span:1", presentationTier: "exploratory" },
      ]],
    ];

    for (const selections of invalidSelections) {
      expect(parseAndMaterializeGeneralPageSpanAdapter(JSON.stringify({
        schemaVersion: 13,
        selections,
      }), candidates).ok).toBe(false);
    }
    expect(parseAndMaterializeGeneralPageSpanAdapter(JSON.stringify({
      schemaVersion: 12,
      selections: [],
    }), candidates)).toMatchObject({ ok: false, issue: "root_shape" });
  });

  it("states one semantic responsibility without quota filling or rewriting", () => {
    const system = buildGeneralPageInvestigationSpanAdapterSystemPrompt();
    const user = buildGeneralPageInvestigationSpanAdapterPrompt({
      candidates,
      targetKind: "page",
      authorizedSourceContext,
      sourceLang: "zh-TW",
      outputLang: "en",
      source: { title: "Synthetic article", url: "https://example.com/article" },
    });

    expect(system).toContain("Choose zero to three reader-worthy verification actions");
    expect(system).toContain("classify each as primary or exploratory");
    expect(system).toContain("Local code owns the exact claim");
    expect(system).toContain("Never fill a slot with an ineligible span");
    expect(system).toContain("return an empty selections array");
    expect(system).toContain("Public interest is not required");
    expect(system).toContain("Stable instructions, policies, reference documentation");
    expect(system).toContain("does not by itself make the action primary");
    expect(system).toContain("Rank all eligible survivors strongest to weakest regardless of tier");
    expect(system).not.toContain("Rank eligible primary survivors first");
    expect(system).not.toMatch(/Admission critic|Tier critic/u);
    expect(user).toContain('"schemaVersion":13');
    expect(user).toContain("Return zero to three eligible supplied IDs");
    expect(user).toContain("Do not group or reorder candidates by tier");
    expect(user).toContain("Omit fictional narration and publisher or license boilerplate");
    expect(user).not.toMatch(/exactly 3 distinct|Admission to reject/u);
    expect(user).not.toMatch(/"start":|"end":/u);
  });

  it("keeps the semantic contract compact enough for constrained Edge models", () => {
    const system = buildGeneralPageInvestigationSpanAdapterSystemPrompt();
    const user = buildGeneralPageInvestigationSpanAdapterPrompt({
      candidates,
      targetKind: "page",
      authorizedSourceContext,
      source: { title: "Synthetic article", url: "https://example.com/article" },
    });

    expect(system.split("\n").length).toBeLessThanOrEqual(14);
    expect([...system].length).toBeLessThanOrEqual(6_000);
    expect([...user].length).toBeLessThanOrEqual(4_000);
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

  it("builds deterministic localized presentation from local data", () => {
    const parsed = parseAndMaterializeGeneralPageSpanAdapter(
      JSON.stringify(preparedWire),
      candidates,
    );
    if (!parsed.value?.selections[0]) throw new Error("fixture failed");
    const presentation = buildGeneralPageInvestigationActionPresentation(
      parsed.value.selections[0],
      {
        outputLang: "zh-TW",
        source: { title: "測試文章", url: "https://example.com/article" },
      },
    );

    expect(presentation.displayClaim).toBe(candidates[1].exactText);
    expect(presentation.presentationTier).toBe("primary");
    expect(presentation.askAiPrompt).toContain("請查核以下原文陳述");
    expect(presentation.askAiPrompt).toContain("來源中繼資料（不等於證據）");
  });

  it("lowers to one compact bounded OpenAI-compatible request", () => {
    const body = buildTierBGeneralPageInvestigationSpanAdapterChatBody({
      endpoint: "http://127.0.0.1:8000/v1",
      model: "test-model",
      structuredOutputMode: "json_schema",
      candidates,
      targetKind: "page",
      authorizedSourceContext,
    });

    expect(body.response_format).toMatchObject({
      type: "json_schema",
      json_schema: {
        name: "truly_general_page_investigation_span_adapter_v13",
        strict: true,
        schema: {
          properties: {
            schemaVersion: { const: 13 },
            selections: { minItems: 0, maxItems: 3 },
          },
        },
      },
    });
    expect(body.max_tokens).toBe(128);
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
      maxProtocolAttempts: 1,
    })).resolves.toMatchObject({
      ok: true,
      attempts: 1,
      usage: { promptTokens: 220, completionTokens: 50, totalTokens: 270 },
      value: {
        schemaVersion: 13,
        selections: [
          { exactClaim: candidates[1].exactText, presentationTier: "primary" },
          { exactClaim: candidates[0].exactText, presentationTier: "exploratory" },
        ],
      },
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("keeps retry diagnostics optional while one-shot callers fail closed", async () => {
    const invalidResponse = () => new Response(JSON.stringify({
      choices: [{ finish_reason: "stop", message: { content: "not-json" } }],
    }), { status: 200 });
    const fetchMock = vi.fn(async () => invalidResponse());
    vi.stubGlobal("fetch", fetchMock);

    await expect(callTierBGeneralPageInvestigationSpanAdapter({
      endpoint: "http://127.0.0.1:8000/v1",
      model: "test-model",
      structuredOutputMode: "json_object",
      candidates,
      targetKind: "page",
      authorizedSourceContext,
      maxProtocolAttempts: 1,
    })).resolves.toMatchObject({ ok: false, attempts: 1 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
