import { describe, expect, it } from "vitest";

import { dedupeModelDisplayNames, modelDisplayIdentity } from "@src/lib/model-display";

describe("model display names", () => {
  it("normalizes known browser-local and local model labels", () => {
    expect(modelDisplayIdentity("chrome-gemini-nano")).toEqual({
      key: "gemini-nano",
      label: "Gemini Nano",
    });
    expect(modelDisplayIdentity("gemma4:e4b-it-qat:latest")).toEqual({
      key: "gemma4:e4b-it-qat",
      label: "Gemma 4 E4B (QAT)",
    });
  });

  it("deduplicates equivalent model names while preserving display order", () => {
    expect(dedupeModelDisplayNames([
      "chrome-gemini-nano",
      "Gemini Nano",
      "gemma4:e4b-it-qat",
      "gemma4:e4b-it-qat:latest",
    ])).toEqual(["Gemini Nano", "Gemma 4 E4B (QAT)"]);
  });
});
