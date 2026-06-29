import { describe, expect, it } from "vitest";

import { dedupeModelDisplayNames, modelDisplayIdentity } from "@src/lib/model-display";

describe("model display names", () => {
  it("normalizes known browser-local and local model labels", () => {
    expect(modelDisplayIdentity("chrome-gemini-nano")).toEqual({
      key: "gemini-nano",
      label: "Gemini Nano",
    });
    expect(modelDisplayIdentity("gemma4:e4b:latest")).toEqual({
      key: "gemma4:e4b",
      label: "Gemma 4 E4B",
    });
  });

  it("deduplicates equivalent model names while preserving display order", () => {
    expect(dedupeModelDisplayNames([
      "chrome-gemini-nano",
      "Gemini Nano",
      "gemma4:e4b",
      "gemma4:e4b:latest",
    ])).toEqual(["Gemini Nano", "Gemma 4 E4B"]);
  });
});
