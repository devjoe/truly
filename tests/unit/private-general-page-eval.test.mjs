import crypto from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  outputLanguageForPrivateEval,
  parsePrivateEvalJsonl,
  privateEvalInputErrors,
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
});
