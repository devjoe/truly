import { afterEach, describe, expect, it, vi } from "vitest";

import {
  GENERAL_PAGE_INVESTIGATION_ACTION_TIER_JSON_SCHEMA,
  buildGeneralPageInvestigationActionTierPrompt,
  buildGeneralPageInvestigationActionTierSystemPrompt,
  parseGeneralPageInvestigationActionTierContent,
} from "@src/lib/general-page-investigation-action-tier";
import type { MaterializedGeneralPageInvestigationSpanSelection } from "@src/lib/general-page-investigation-span-adapter";
import {
  buildTierBGeneralPageInvestigationActionTierChatBody,
  callTierBGeneralPageInvestigationActionTier,
} from "@src/lib/tier-b-client";

const authorizedSourceContext =
  "前言。衛生局命令遠帆公司在七月三十一日前完成下架。結尾。";
const selection: MaterializedGeneralPageInvestigationSpanSelection = {
  candidateId: "span:2",
  exactClaim: "衛生局命令遠帆公司在七月三十一日前完成下架",
  sourceQuote: "衛生局命令遠帆公司在七月三十一日前完成下架",
  start: 3,
  end: 24,
};

afterEach(() => vi.unstubAllGlobals());

describe("General Page investigation action tier classifier", () => {
  it("uses one compact two-tier contract", () => {
    expect(GENERAL_PAGE_INVESTIGATION_ACTION_TIER_JSON_SCHEMA).toMatchObject({
      additionalProperties: false,
      required: ["schemaVersion", "tier"],
      properties: {
        schemaVersion: { const: 1 },
        tier: { enum: ["primary", "exploratory"] },
      },
    });
    expect(parseGeneralPageInvestigationActionTierContent(
      '{"schemaVersion":1,"tier":"exploratory"}',
    )).toEqual({
      ok: true,
      value: { schemaVersion: 1, tier: "exploratory" },
    });
    expect(parseGeneralPageInvestigationActionTierContent(
      '{"schemaVersion":1,"tier":"reject"}',
    )).toMatchObject({ ok: false, error: "invalid_schema" });
  });

  it("owns only presentation utility and keeps the exact span grounded", () => {
    const system = buildGeneralPageInvestigationActionTierSystemPrompt();
    const user = buildGeneralPageInvestigationActionTierPrompt({
      selection,
      authorizedSourceContext,
      source: { title: "測試文章", url: "https://example.com/article" },
    });
    expect(system).toContain("already passed a separate");
    expect(system).toContain("Judge utility only");
    expect(system).toContain("Public interest is not required");
    expect(system).toContain("entertainment, sport, consumer, product, celebrity");
    expect(system).toContain("browser support, compatibility, permissions, and availability");
    expect(system).toContain("retrospective, review, anniversary, catalog, or history Page");
    expect(system).toContain("review, buying guide, gift guide, or product roundup");
    expect(system).toContain("central filing, proposal, funding round, election result");
    expect(system).toContain("secondary context, a counterpoint, or background");
    expect(system).toContain("informational event Page");
    expect(system).toContain("ordinary event date, venue, visibility area");
    expect(system).toContain("upcoming eclipse, conference, exhibition");
    expect(user).toContain(selection.exactClaim);
    expect(user).toContain("utility judgment only");
    expect(() => buildGeneralPageInvestigationActionTierPrompt({
      selection: { ...selection, start: 0, end: 5 },
      authorizedSourceContext,
    })).toThrow("selected claim is not grounded");
  });

  it("lowers to a bounded provider-generic request", () => {
    const body = buildTierBGeneralPageInvestigationActionTierChatBody({
      endpoint: "http://127.0.0.1:8000/v1",
      model: "test-model",
      structuredOutputMode: "json_schema",
      selection,
      authorizedSourceContext,
    });
    expect(body.max_tokens).toBe(32);
    expect(body.temperature).toBe(0);
    expect(body.response_format).toMatchObject({
      type: "json_schema",
      json_schema: {
        name: "truly_general_page_investigation_action_tier_v1",
        strict: true,
      },
    });
  });

  it("returns telemetry and fails closed on malformed output", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        choices: [{
          finish_reason: "stop",
          message: { content: '{"schemaVersion":1,"tier":"primary"}' },
        }],
        usage: { prompt_tokens: 100, completion_tokens: 10, total_tokens: 110 },
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        choices: [{ finish_reason: "stop", message: { content: "{broken" } }],
      }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const request = {
      endpoint: "http://127.0.0.1:8000/v1",
      model: "test-model",
      structuredOutputMode: "json_object" as const,
      selection,
      authorizedSourceContext,
    };
    await expect(callTierBGeneralPageInvestigationActionTier(request))
      .resolves.toMatchObject({
        ok: true,
        value: { schemaVersion: 1, tier: "primary" },
        usage: { promptTokens: 100, completionTokens: 10, totalTokens: 110 },
      });
    await expect(callTierBGeneralPageInvestigationActionTier(request))
      .resolves.toMatchObject({
        ok: false,
        value: null,
        error: "investigation_action_tier_invalid_json",
      });
  });
});
