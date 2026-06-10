import { describe, expect, it } from "vitest";

import {
  providerCanTestTierB2,
  providerEndpointKind,
  providerFixedModel,
  providerNeedsApiKey,
  providerNeedsEndpoint,
  providerSupportsTierA,
  providerSupportsTierB,
  providerSupportsTierB2,
} from "@src/lib/provider-capabilities";

describe("provider capabilities", () => {
  it("keeps browser-local Gemini Nano endpoint-free but probe-gated for deep reading", () => {
    expect(providerNeedsEndpoint("chrome-gemini-nano")).toBe(false);
    expect(providerNeedsApiKey("chrome-gemini-nano")).toBe(false);
    expect(providerFixedModel("chrome-gemini-nano")).toBe("chrome-gemini-nano");

    expect(providerSupportsTierA("chrome-gemini-nano")).toBe(true);
    expect(providerSupportsTierB("chrome-gemini-nano")).toBe(true);
    expect(providerSupportsTierB2("chrome-gemini-nano")).toBe(false);
    expect(providerCanTestTierB2("chrome-gemini-nano")).toBe(true);
  });

  it("marks local endpoints as model-capable and endpoint-backed", () => {
    expect(providerEndpointKind("ollama")).toBe("ollama");
    expect(providerEndpointKind("openai-compatible")).toBe("openai-compatible");

    for (const provider of ["ollama", "openai-compatible"] as const) {
      expect(providerNeedsEndpoint(provider)).toBe(true);
      expect(providerNeedsApiKey(provider)).toBe(false);
      expect(providerSupportsTierA(provider)).toBe(true);
      expect(providerSupportsTierB(provider)).toBe(true);
      expect(providerSupportsTierB2(provider)).toBe(true);
    }
  });

  it("keeps disabled provider unavailable for every model tier", () => {
    expect(providerNeedsEndpoint("none")).toBe(false);
    expect(providerSupportsTierA("none")).toBe(false);
    expect(providerSupportsTierB("none")).toBe(false);
    expect(providerCanTestTierB2("none")).toBe(false);
  });
});
