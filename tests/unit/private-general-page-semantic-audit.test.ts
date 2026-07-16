import { describe, expect, it, vi } from "vitest";

import type { GeneralPageBrief } from "@src/lib/general-page-analysis";
import {
  assertPrivateSemanticAuditFetchTarget,
  installPrivateSemanticAuditNetworkGuard,
  semanticAuditCompletionsUrl,
} from "../../scripts/lib/private-general-page-semantic-audit.mjs";
import { buildPrivateSemanticAuditQuestionActions } from "../../scripts/private-general-page-semantic-audit-projection";

describe("private General Page semantic audit boundary", () => {
  it("allows only the declared model completions endpoint and never follows redirects", async () => {
    const endpoint = "https://model-runtime.example/v1";
    const expected = "https://model-runtime.example/v1/chat/completions";
    expect(semanticAuditCompletionsUrl(endpoint)).toBe(expected);
    expect(assertPrivateSemanticAuditFetchTarget(expected, endpoint)).toBe(expected);
    expect(() => assertPrivateSemanticAuditFetchTarget("https://www.google.com/search?q=private", endpoint))
      .toThrow(/blocked undeclared network target/);

    const response = new Response("{}", { status: 200 });
    const fetchImpl = vi.fn(async () => response);
    const guarded = installPrivateSemanticAuditNetworkGuard(endpoint, fetchImpl);
    await expect(guarded(expected, { method: "POST" })).resolves.toBe(response);
    expect(fetchImpl).toHaveBeenCalledWith(expected, expect.objectContaining({
      method: "POST",
      redirect: "error",
    }));
    await expect(guarded("https://gemini.google.com/app", {})).rejects.toThrow(/blocked undeclared network target/);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("records separate display, copy, Google, AI Mode, and agent projections without opening them", () => {
    const brief: GeneralPageBrief = {
      schemaVersion: 1,
      summary: "美國國防部推出軍人荷爾蒙篩檢與治療計畫。",
      qs: [{ q: "此貼文的軍事文化脈絡如何影響政策？", kind: "context" }],
      model: "qwen3.6-35b",
    };
    const [action] = buildPrivateSemanticAuditQuestionActions({
      brief,
      lang: "zh-TW",
      source: {
        title: "US troops to get testosterone treatment",
        url: "https://www.ft.com/content/example?utm_source=audit",
      },
    });

    expect(action).toMatchObject({
      version: 1,
      modelText: "此貼文的軍事文化脈絡如何影響政策？",
      displayText: "軍事文化脈絡如何影響政策？",
      agentTask: {
        version: 1,
        type: "reading_follow_up",
        kind: "context",
        question: "軍事文化脈絡如何影響政策？",
        sourceUrl: "https://www.ft.com/content/example",
      },
    });
    expect(action.copyText).toContain("來源：US troops to get testosterone treatment");
    expect(action.copyText).not.toContain("https://");
    expect(action.googleQuery).not.toContain("https://");
    expect(action.googleQuery).not.toBe(action.copyText);
    expect(action.aiModePrompt).toContain("https://www.ft.com/content/example");
    expect(action.aiModePrompt).not.toBe(action.googleQuery);
  });
});
