import crypto from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  outputLanguageForPrivateEval,
  parsePrivateEvalJsonl,
  privateEvalInputErrors,
  privateRuntimeEnvelopeInputErrors,
  privateSpanAuditNoCandidateResult,
} from "../../scripts/lib/private-general-page-eval.mjs";

const recordText = "原始內容".repeat(30);
const record = {
  sampleId: "fb_0123456789abcdef0123456789abcdef",
  surface: "facebook",
  language: "zh-TW",
  sourceSha256: crypto.createHash("sha256").update(recordText, "utf8").digest("hex"),
  text: recordText,
};

describe("private general page eval boundary", () => {
  it("accepts opaque JSONL with an exact count and declared category", () => {
    const rows = parsePrivateEvalJsonl(`${JSON.stringify(record)}\n`);
    expect(privateEvalInputErrors(rows, 1, "facebook-original")).toEqual([]);
  });

  it("accepts bounded source context used by the real claim actions", () => {
    const rows = [{
      ...record,
      sourceContext: {
        title: "Example public notice",
        sourceName: "Example News",
        publishedAt: "2026-07-16",
        url: "https://example.test/notice?id=29",
      },
    }];
    expect(privateEvalInputErrors(rows, 1, "facebook-original")).toEqual([]);
  });

  it("rejects unsafe source URL metadata", () => {
    const rows = [{
      ...record,
      sourceContext: { url: "https://user:secret@example.test/private" },
    }];
    expect(privateEvalInputErrors(rows, 1, "facebook-original").join(" ")).toMatch(/sourceContext\.url/);
  });

  it("rejects unsafe or unbounded source context", () => {
    const rows = [{
      ...record,
      sourceContext: {
        title: "https://example.invalid/private-source",
        sourceName: "N".repeat(61),
      },
    }];
    const errors = privateEvalInputErrors(rows, 1, "facebook-original").join(" ");
    expect(errors).toMatch(/sourceContext\.title/);
    expect(errors).toMatch(/sourceContext\.sourceName/);
  });

  it("fails closed on count, category, duplicate, or raw-id drift", () => {
    const rows = [record, record];
    const errors = privateEvalInputErrors(rows, 1, "news-original");
    expect(errors.join(" ")).toMatch(/count mismatch/);
    expect(errors.join(" ")).toMatch(/duplicate sampleId/);
    expect(errors.join(" ")).toMatch(/categories mismatch/);
  });

  it("rejects a source hash that is not derived from the supplied text", () => {
    const errors = privateEvalInputErrors([{ ...record, sourceSha256: "a".repeat(64) }], 1, "facebook-original");
    expect(errors.join(" ")).toMatch(/does not match text/);
  });

  it("maps only the supported answer languages", () => {
    expect(outputLanguageForPrivateEval("en")).toBe("en");
    expect(outputLanguageForPrivateEval("zh-TW")).toBe("zh-TW");
  });

  it("treats an empty deterministic span set as an abstention, not a protocol failure", () => {
    expect(privateSpanAuditNoCandidateResult({ sampleId: record.sampleId, candidateCount: 0 })).toEqual({
      sampleId: record.sampleId,
      candidateCount: 0,
      ok: true,
      status: "abstain",
      reason: "no_candidates",
      actions: [],
    });
  });

  it("accepts an exact runtime Page adapter envelope", () => {
    const row = runtimeRow("page", "news_article", "page");
    expect(privateRuntimeEnvelopeInputErrors([row], 1, "page-news_article")).toEqual([]);
  });

  it("rejects a Focus envelope whose target is not the exact selection", () => {
    const row = runtimeRow("focus", "facebook", "page");
    expect(privateRuntimeEnvelopeInputErrors([row], 1, "focus-facebook").join(" ")).toMatch(/targetKind=selection/);
  });
});

function runtimeRow(scope, sourceClass, targetKind) {
  const text = "This complete source sentence contains enough concrete detail for an exact runtime-envelope validation fixture.";
  const capture = {
    schemaVersion: 1,
    capturedAt: 1,
    analysis: {
      tabId: 1,
      analysisKey: "fixture",
      scope,
      priority: "derived",
      context: { mainText: text, targetKind },
      allowedUse: "article_or_selection_analysis",
      outputLang: "en",
      hasScreenshot: false,
    },
    adapter: {
      endpoint: "https://model-runtime.example.test/v1",
      model: "qwen3.6-35b",
      structuredOutputMode: "json_object",
      candidates: [{ id: "span:1", exactText: text, start: 0, end: text.length }],
      targetKind,
      sourceLang: "en",
      outputLang: "en",
    },
  };
  return {
    schemaVersion: 2,
    sampleId: `rt_${"a".repeat(32)}`,
    sourceClass,
    captureSha256: crypto.createHash("sha256").update(JSON.stringify(capture)).digest("hex"),
    capture,
  };
}
