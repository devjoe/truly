import { describe, expect, it } from "vitest";

import {
  investigationAdapterStructuredOutputMode,
  resolveTrustedTierARuntime,
  resolveTrustedTierBProviderRuntime,
} from "@src/background/trusted-model-runtime";

describe("trusted model runtime resolution", () => {
  it("resolves Tier A runtime from stored settings instead of caller-supplied message endpoints", () => {
    const runtime = resolveTrustedTierARuntime({
      settings: {
        tierAProvider: "openai-compatible",
        openAICompatibleFlavor: "vllm",
        openAIResponseFormat: "none",
        tierAOutputMode: "compact_digits",
      },
      ollamaEndpoint: "https://trusted-tier-a.example.test/v1",
      ollamaModel: "trusted-tier-a-model",
    });

    expect(runtime).toEqual({
      provider: "openai-compatible",
      endpoint: "https://trusted-tier-a.example.test/v1",
      model: "trusted-tier-a-model",
      endpointKind: "openai-compatible",
      openAICompatibleFlavor: "vllm",
      responseFormat: "none",
      outputMode: "compact_digits",
    });
  });

  it("resolves Tier B runtime from stored settings and ignores untrusted request runtime values", () => {
    const runtime = resolveTrustedTierBProviderRuntime("ai_analysis", {
      settings: {
        deepClassifyEnabled: true,
        tierBProvider: "openai-compatible",
        tierBEndpoint: "https://trusted-tier-b.example.test/v1",
        tierBModel: "trusted-tier-b-model",
        openAIResponseFormat: "json_schema",
      },
      ollamaEndpoint: "https://tier-a.example.test/v1",
      ollamaModel: "tier-a-model",
    });

    expect(runtime).toMatchObject({
      provider: "openai-compatible",
      effectiveProvider: "openai-compatible",
      endpoint: "https://trusted-tier-b.example.test/v1",
      model: "trusted-tier-b-model",
      responseFormat: "json_schema",
      canUseModel: true,
    });
  });

  it("resolves shared Tier B runtime through the stored Tier A lane", () => {
    const runtime = resolveTrustedTierBProviderRuntime("ai_analysis", {
      settings: {
        deepClassifyEnabled: true,
        tierAProvider: "ollama",
        tierBProvider: "tier-a",
      },
      ollamaEndpoint: "http://127.0.0.1:11434",
      ollamaModel: "trusted-shared-model",
    });

    expect(runtime).toMatchObject({
      provider: "tier-a",
      effectiveProvider: "ollama",
      endpoint: "http://127.0.0.1:11434",
      model: "trusted-shared-model",
      responseFormat: "json_object",
      canUseModel: true,
    });
  });

  it("maps the trusted stored response format without endpoint inference", () => {
    expect(investigationAdapterStructuredOutputMode("json_schema")).toBe("json_schema");
    expect(investigationAdapterStructuredOutputMode("json_object")).toBe("json_object");
    expect(investigationAdapterStructuredOutputMode("none")).toBe("json_object");
  });
});
