import { describe, expect, it, vi } from "vitest";

import type { GeneralPageBrief } from "@src/lib/general-page-analysis";
import {
  assertPrivateSemanticAuditFetchTarget,
  assertPrivateSemanticAuditCandidateSnapshot,
  installPrivateSemanticAuditNetworkGuard,
  privateSemanticAuditAdapterManifestMetadata,
  privateSemanticAuditAdapterModelMetadata,
  privateSemanticAuditAdapterResponseFormat,
  privateSemanticAuditReadingManifestMetadata,
  privateSemanticAuditReadingResponseFormat,
  privateSemanticAuditReadingWireProfile,
  privateSemanticAuditRepairMode,
  semanticAuditCompletionsUrl,
} from "../../scripts/lib/private-general-page-semantic-audit.mjs";
import {
  buildPrivateSemanticAuditQuestionActions,
  projectPrivateSemanticAuditAdapterBatch,
} from "../../scripts/private-general-page-semantic-audit-projection";

describe("private General Page semantic audit boundary", () => {
  it("allows only runtime-parity no-repair mode", () => {
    expect(privateSemanticAuditRepairMode([])).toBe("none");
    expect(() => privateSemanticAuditRepairMode(["--repair-mode", "semantic_once"]))
      .toThrow(/must be none for runtime-parity batch audit/);
    expect(() => privateSemanticAuditRepairMode(["--repair-mode", "automatic"]))
      .toThrow(/must be none for runtime-parity batch audit/);
  });

  it("records batch Adapter budgets and requires an explicit schema candidate", () => {
    expect(privateSemanticAuditAdapterResponseFormat([])).toBe("json_object");
    expect(privateSemanticAuditAdapterModelMetadata("json_object")).toEqual({
      adapterMaxTokens: 1_200,
    });
    expect(privateSemanticAuditAdapterResponseFormat([
      "--adapter-response-format",
      "json_schema",
    ])).toBe("json_schema");
    expect(privateSemanticAuditAdapterModelMetadata("json_schema")).toEqual({
      responseFormat: "json_schema",
      adapterMaxTokens: 3_200,
    });
    expect(privateSemanticAuditAdapterManifestMetadata("json_object", { type: "json_object" }))
      .toEqual({});
    expect(privateSemanticAuditAdapterManifestMetadata("json_schema", {
      type: "json_schema",
      json_schema: { strict: true, schema: { type: "object", properties: {} } },
    })).toEqual({
      schemaSha256: "8243f0af367f188a376f2c17b5eabe872a2f7a979813e0d4e2be6d594c2aa259",
    });
    expect(() => privateSemanticAuditAdapterManifestMetadata("json_schema", { type: "json_object" }))
      .toThrow(/format\/body mismatch/);
    expect(() => privateSemanticAuditAdapterResponseFormat([
      "--adapter-response-format",
      "none",
    ])).toThrow(/must be json_object or json_schema/);
  });

  it("records the Reading Brief wire mode separately from its provider-neutral schema", () => {
    expect(privateSemanticAuditReadingResponseFormat([])).toBe("json_object");
    expect(privateSemanticAuditReadingResponseFormat([
      "--reading-response-format",
      "json_schema",
    ])).toBe("json_schema");
    expect(privateSemanticAuditReadingWireProfile([])).toBe("structural_v1");
    expect(privateSemanticAuditReadingWireProfile([
      "--reading-wire-profile",
      "compact_cardinality_v1",
    ])).toBe("compact_cardinality_v1");
    expect(privateSemanticAuditReadingManifestMetadata("json_object", { type: "json_object" }))
      .toEqual({ responseFormat: "json_object", wireProfile: "json_object" });
    expect(privateSemanticAuditReadingManifestMetadata("json_schema", {
      type: "json_schema",
      json_schema: { strict: true, schema: { type: "object", properties: {} } },
    })).toEqual({
      responseFormat: "json_schema",
      wireProfile: "structural_v1",
      schemaSha256: "8243f0af367f188a376f2c17b5eabe872a2f7a979813e0d4e2be6d594c2aa259",
    });
    expect(privateSemanticAuditReadingManifestMetadata("json_schema", {
      type: "json_schema",
      json_schema: { strict: true, schema: { type: "object", properties: {} } },
    }, {
      receiptId: "receipt-v1",
      receiptSha256: "a".repeat(64),
      evidenceSha256: "b".repeat(64),
    })).toEqual({
      responseFormat: "json_schema",
      wireProfile: "compact_cardinality_v1",
      schemaSha256: "8243f0af367f188a376f2c17b5eabe872a2f7a979813e0d4e2be6d594c2aa259",
      capabilityReceipt: {
        receiptId: "receipt-v1",
        receiptSha256: "a".repeat(64),
        evidenceSha256: "b".repeat(64),
      },
    });
    expect(() => privateSemanticAuditReadingResponseFormat([
      "--reading-response-format",
      "none",
    ])).toThrow(/must be json_object or json_schema/);
    expect(() => privateSemanticAuditReadingWireProfile([
      "--reading-wire-profile",
      "universal",
    ])).toThrow(/must be structural_v1 or compact_cardinality_v1/);
  });

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

  it("fails closed when the raw candidate snapshot differs from preregistration", () => {
    const commit = "d0cac04bec9d3794126885ec4782d437533db104";
    const diff = "diff --git a/a.ts b/a.ts\n+const value = 1;\n";
    const diffSha256 = "d2d751cf5e7f13134f9d967a97ddc4104cc392ac078580ffcd66d76a928a2ef4";
    expect(assertPrivateSemanticAuditCandidateSnapshot({
      actualCommit: commit,
      actualTrackedDiff: diff,
      expectedCommit: commit,
      expectedTrackedDiffSha256: diffSha256,
    })).toEqual({ commit, trackedDiffSha256: diffSha256 });
    expect(() => assertPrivateSemanticAuditCandidateSnapshot({
      actualCommit: commit,
      actualTrackedDiff: `${diff}changed`,
      expectedCommit: commit,
      expectedTrackedDiffSha256: diffSha256,
    })).toThrow(/tracked diff does not match preregistration/);
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
    expect(action.copyText).toContain("摘要：美國國防部推出軍人荷爾蒙篩檢與治療計畫");
    expect(action.copyText).not.toContain("來源：US troops to get testosterone treatment");
    expect(action.copyText).not.toContain("https://");
    expect(action.googleQuery).not.toContain("https://");
    expect(action.googleQuery).not.toBe(action.copyText);
    expect(action.aiModePrompt).toContain("https://www.ft.com/content/example");
    expect(action.aiModePrompt).not.toBe(action.googleQuery);
  });

  it("projects every Adapter batch item independently and keeps all prepared tasks", () => {
    const groundingText = "食藥署表示，中聯油品下架29項產品。國防部宣布新增30億元預算。";
    const preparedClaim = (c: string, s: string, p: string, o: string) => ({
      schemaVersion: 1 as const,
      decision: "prepared" as const,
      reason: "actionable" as const,
      claim: {
        c,
        why: "涉及公共利益。",
        need: "主管機關正式公告。",
        q: `${s}是否${p}${o}？`,
        displayQ: `${s}是否${p}${o}？`,
        atom: { s, p, o },
        policy: { claimKind: "fact" as const, consequence: "public_interest" as const },
        sourceQuote: c,
      },
    });
    const projected = projectPrivateSemanticAuditAdapterBatch({
      batch: {
        schemaVersion: 1,
        results: [
          { claimIndex: 0, value: preparedClaim("食藥署表示，中聯油品下架29項產品。", "中聯油品", "下架", "29項產品") },
          { claimIndex: 1, value: { schemaVersion: 1, decision: "abstain", reason: "unsupported_claim" } },
          { claimIndex: 2, value: preparedClaim("國防部宣布新增30億元預算。", "國防部", "宣布新增", "30億元預算") },
        ],
      },
      analysisKey: "audit-row",
      groundingText,
    });

    expect(projected.pipelineStatus).toBe("action_ready");
    expect(projected.preparations.map((item) => item.claimIndex)).toEqual([0, 1, 2]);
    expect(projected.investigationTasks.map((task) => task.claimIndex)).toEqual([0, 2]);
  });
});
