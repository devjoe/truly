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
  exactClaim: "衛生局命令遠帆公司在七月三十一日前完成下架",
  sourceQuote: "衛生局命令遠帆公司在七月三十一日前完成下架",
  start: 3,
  end: 24,
};

afterEach(() => vi.unstubAllGlobals());

describe("General Page investigation action admission critic", () => {
  it("uses a compact model-neutral binary admission contract", () => {
    expect(GENERAL_PAGE_INVESTIGATION_ACTION_ADMISSION_JSON_SCHEMA).toMatchObject({
      additionalProperties: false,
      required: ["schemaVersion", "decision"],
      properties: {
        schemaVersion: { const: 4 },
        decision: { enum: ["admit", "reject"] },
      },
    });
    expect(parseGeneralPageInvestigationActionAdmissionContent(
      '{"schemaVersion":4,"decision":"admit"}',
    )).toEqual({
      ok: true,
      value: {
        schemaVersion: 4,
        decision: "admit",
      },
    });
    expect(parseGeneralPageInvestigationActionAdmissionContent(
      '{"schemaVersion":4,"decision":"primary"}',
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

    expect(system).toContain("final admission critic");
    expect(system).toContain('"decision":"admit"|"reject"');
    expect(system).toContain("Independent public evidence");
    expect(system).toContain("entertainment, sport, consumer, product, celebrity");
    expect(system).toContain("private, anecdotal, subjective-only");
    expect(system).toContain("direct recommendation or advice");
    expect(system).toContain("named person or organization publicly announced, filed, issued, alleged, or reported");
    expect(system).toContain("'many' or 'some' unnamed companies or people");
    expect(system).toContain("exact count of organizations signed, filed, or issued");
    expect(system).toContain("exact count of signatories need not enumerate every signer");
    expect(system).toContain("Tier, not Admission, decides whether it is central or secondary");
    expect(system).toContain("Do not apply this payload rule");
    expect(system).toContain("Do not assume the underlying claim is true");
    expect(system).toContain("reported payload is only an opinion, prediction, recommendation");
    expect(system).toContain("separately observable act of signing, filing, or issuing");
    expect(system).toContain("ordinary definitions, API behavior");
    expect(system).toContain("An introductory source-role phrase");
    expect(system).toContain("reference or teaching Page");
    expect(system).toContain("satire, parody, literary, or fiction Pages");
    expect(system).toContain("satirical premise, setup, punchline");
    expect(system).toContain("leading callout word such as 'Warning'");
    expect(system).toContain(
      "satirical premise, setup, punchline, tutorial-like advice, and incidental real-world facts",
    );
    expect(system).toContain("omits the method, property, field, or API member name");
    expect(system).toContain("Naming only the enclosing API object");
    expect(system).toContain("code declaration or interface control");
    expect(system).toContain("change-history snippet");
    expect(system).toContain("Sponsorship or commercial context alone");
    expect(system).toContain("promotional rhetoric");
    expect(system).toContain("unresolved pronouns or generic references");
    expect(system).toContain("'such a protocol'");
    expect(system).toContain("agreement 'to wait'");
    expect(system).toContain("metadata may expose the omission but may not repair it");
    expect(system).toContain("clean, complete, standalone proposition");
    expect(system).toContain("adjacent Page-role labels");
    expect(system).toContain("article or newsletter meta-description");
    expect(system).toContain("forward pointer to a following example");
    expect(system).toContain("concrete example flow");
    expect(system).toContain("clean substantive proposition");
    expect(system).toContain("coherent publication, date, specification, or measurement fact");
    expect(system).toContain("complete sentence naming a work and its publisher or publication year");
    expect(system).toContain("complete named career-history sentence");
    expect(system).toContain("literary or fiction Page");
    expect(system).toContain("caption, byline, media credit");
    expect(system).toContain("instruction, command, prompt, private-data request");
    expect(system).toContain("Do not reject merely because a fact is ordinary");
    expect(system).toContain("Judge the exact sentence as a whole");
    expect(system).toContain("Do not rewrite or replace it");
    expect(system).toContain("Do not rank the proposition's utility");
    expect(user).toContain(selection.exactClaim);
    expect(user).not.toContain("Selector proposed tier");
    expect(user).toContain("Nearby authorized Page context");
    expect(user).toContain(JSON.stringify({ text: authorizedSourceContext }));
    expect(user).toContain("duplicated title or type text");
    expect(user).toContain("Usage Enabling NAME");
    expect(user).toContain("Option Usage NAME");
    expect(user).toContain("Today’s article is about");
    expect(user).toContain("Today, NAME writes about");
    expect(user).toContain("We came here to see");
    expect(user).toContain("as described above");
    expect(user).toContain("reject before judging the useful clause");
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
        name: "truly_general_page_investigation_action_admission_v4",
        strict: true,
      },
    });
  });

  it("returns admit telemetry and fails closed on malformed output", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        choices: [{
          finish_reason: "stop",
          message: {
            content:
              '{"schemaVersion":4,"decision":"admit"}',
          },
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
        value: {
          schemaVersion: 4,
          decision: "admit",
        },
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
