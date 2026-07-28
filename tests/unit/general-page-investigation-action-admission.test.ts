import { afterEach, describe, expect, it, vi } from "vitest";

import {
  GENERAL_PAGE_INVESTIGATION_ACTION_ADMISSION_JSON_SCHEMA,
  buildGeneralPageInvestigationActionAdmissionPrompt,
  buildGeneralPageInvestigationActionAdmissionSystemPrompt,
  parseGeneralPageInvestigationActionAdmissionContent,
} from "@src/lib/general-page-investigation-action-admission";
import type { MaterializedGeneralPageInvestigationSpanSelection } from "@src/lib/general-page-investigation-span-adapter";
import {
  buildTierBGeneralPageInvestigationActionAdmissionChatBody,
  callTierBGeneralPageInvestigationActionAdmission,
} from "@src/lib/tier-b-client";

const authorizedSourceContext =
  "前言。衛生局命令遠帆公司在七月三十一日前完成下架。結尾。";
const selection: MaterializedGeneralPageInvestigationSpanSelection = {
  candidateId: "span:2",
  presentationTier: "primary",
  exactClaim: "衛生局命令遠帆公司在七月三十一日前完成下架",
  sourceQuote: "衛生局命令遠帆公司在七月三十一日前完成下架",
  start: 3,
  end: 24,
};

afterEach(() => vi.unstubAllGlobals());

describe("General Page investigation action admission critic", () => {
  it("uses a tiny model-neutral admit/reject contract", () => {
    expect(GENERAL_PAGE_INVESTIGATION_ACTION_ADMISSION_JSON_SCHEMA).toMatchObject({
      additionalProperties: false,
      required: ["schemaVersion", "decision"],
      properties: {
        schemaVersion: { const: 1 },
        decision: { enum: ["admit", "reject"] },
      },
    });
    expect(parseGeneralPageInvestigationActionAdmissionContent(
      '{"schemaVersion":1,"decision":"admit"}',
    )).toEqual({
      ok: true,
      value: { schemaVersion: 1, decision: "admit" },
    });
    expect(parseGeneralPageInvestigationActionAdmissionContent(
      '{"schemaVersion":1,"decision":"reject","reason":"no"}',
    )).toMatchObject({ ok: false, error: "invalid_schema" });
    expect(parseGeneralPageInvestigationActionAdmissionContent("not-json"))
      .toMatchObject({ ok: false, error: "invalid_json" });
  });

  it("judges the exact sentence as a whole without authoring replacement text", () => {
    const system = buildGeneralPageInvestigationActionAdmissionSystemPrompt();
    const user = buildGeneralPageInvestigationActionAdmissionPrompt({
      selection,
      authorizedSourceContext,
      source: {
        title: "測試文章",
        sourceName: "測試新聞",
        url: "https://example.com/article",
      },
    });

    expect(system).toContain("final binary admission critic");
    expect(system).toContain("Selector already owns its primary or exploratory tier");
    expect(system).toContain("Independent public evidence");
    expect(system).toContain("Do not judge importance, materiality, or tier");
    expect(system).toContain("entertainment, sport, consumer, product, celebrity");
    expect(system).toContain("private, anecdotal, subjective-only");
    expect(system).toContain("named person or organization publicly announced, filed, issued, alleged, or reported");
    expect(system).toContain("Do not assume the underlying claim is true");
    expect(system).toContain("ordinary definitions, API behavior");
    expect(system).toContain("Lower utility is represented by Selector's exploratory tier");
    expect(system).toContain("clean, complete, standalone proposition");
    expect(system).toContain("public record, specification, filing, catalog, or dataset Page");
    expect(system).toContain("literary or fiction Page");
    expect(system).toContain("caption, byline, media credit");
    expect(system).toContain("instruction, command, prompt, private-data request");
    expect(system).toContain("Do not reject merely because a fact is ordinary");
    expect(system).toContain("Judge the exact sentence as a whole");
    expect(system).toContain("Do not rewrite or replace it");
    expect(user).toContain(selection.exactClaim);
    expect(user).toContain("Nearby authorized Page context");
    expect(user).toContain(JSON.stringify({ text: authorizedSourceContext }));
    expect(user).toContain("Reject only for a clear structural");
  });

  it("requires the selected claim to remain exactly grounded", () => {
    expect(() => buildGeneralPageInvestigationActionAdmissionPrompt({
      selection: { ...selection, start: 0, end: 5 },
      authorizedSourceContext,
    })).toThrow("selected claim is not grounded");
  });

  it("lowers to one compact OpenAI-compatible request", () => {
    const body = buildTierBGeneralPageInvestigationActionAdmissionChatBody({
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
        name: "truly_general_page_investigation_action_admission_v6",
        strict: true,
      },
    });
  });

  it("returns admit telemetry and fails closed on malformed output", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        choices: [{
          finish_reason: "stop",
          message: { content: '{"schemaVersion":1,"decision":"admit"}' },
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
    await expect(callTierBGeneralPageInvestigationActionAdmission(request))
      .resolves.toMatchObject({
        ok: true,
        value: { schemaVersion: 1, decision: "admit" },
        usage: { promptTokens: 100, completionTokens: 10, totalTokens: 110 },
      });
    await expect(callTierBGeneralPageInvestigationActionAdmission(request))
      .resolves.toMatchObject({
        ok: false,
        value: null,
        error: "investigation_action_admission_invalid_json",
      });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
