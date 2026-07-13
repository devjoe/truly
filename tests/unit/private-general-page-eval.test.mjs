import { describe, expect, it } from "vitest";
import {
  outputLanguageForPrivateEval,
  parsePrivateEvalJsonl,
  privateEvalInputErrors,
} from "../../scripts/lib/private-general-page-eval.mjs";

const record = {
  sampleId: "fb_0123456789abcdef0123456789abcdef",
  surface: "facebook",
  language: "zh-TW",
  sourceSha256: "a".repeat(64),
  text: "原始內容".repeat(30),
};

describe("private general page eval boundary", () => {
  it("accepts opaque JSONL with an exact count and declared category", () => {
    const rows = parsePrivateEvalJsonl(`${JSON.stringify(record)}\n`);
    expect(privateEvalInputErrors(rows, 1, "facebook-original")).toEqual([]);
  });

  it("fails closed on count, category, duplicate, or raw-id drift", () => {
    const rows = [record, record];
    const errors = privateEvalInputErrors(rows, 1, "news-original");
    expect(errors.join(" ")).toMatch(/count mismatch/);
    expect(errors.join(" ")).toMatch(/duplicate sampleId/);
    expect(errors.join(" ")).toMatch(/categories mismatch/);
  });

  it("maps only the supported answer languages", () => {
    expect(outputLanguageForPrivateEval("en")).toBe("en");
    expect(outputLanguageForPrivateEval("zh-TW")).toBe("zh-TW");
  });
});
