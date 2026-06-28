import { describe, expect, it } from "vitest";

import {
  defaultEndpointForProvider,
  defaultModelForProvider,
  endpointSecurityWarnings,
  normalizeProviderModelConfigMap,
  normalizeEndpointInput,
  providerModelConfigOrDefault,
  resolveModelName,
  validateEndpointUrl,
  withProviderModelConfig,
} from "@src/lib/model-source-config";

describe("model source config", () => {
  it("uses deterministic defaults for local and OpenAI-compatible providers", () => {
    expect(defaultEndpointForProvider("ollama")).toBe("http://localhost:11434");
    expect(defaultEndpointForProvider("openai-compatible")).toBe("http://localhost:8000/v1");
    expect(defaultEndpointForProvider("chrome-gemini-nano")).toBe("");

    expect(defaultModelForProvider("ollama", "reading-prompt")).toBe("gemma4:e4b-it-qat");
    expect(defaultModelForProvider("openai-compatible", "reading-prompt")).toBe(
      "gemma-4-e4b-it-4bit",
    );
    expect(defaultModelForProvider("openai-compatible", "summary-reading")).toBe(
      "gemma-4-e4b-it-4bit",
    );
  });

  it("normalizes endpoint input without inventing a host", () => {
    expect(normalizeEndpointInput(" http://localhost:11434/// ")).toBe(
      "http://localhost:11434",
    );
    expect(normalizeEndpointInput("   ", "http://localhost:8000/v1/")).toBe(
      "http://localhost:8000/v1",
    );
  });

  it("keeps endpoint-backed provider drafts separate", () => {
    let configs = normalizeProviderModelConfigMap({
      ollama: {
        endpoint: " http://localhost:11434/ ",
        model: " gemma4:e4b-it-qat ",
      },
    });
    configs = withProviderModelConfig(configs, "openai-compatible", {
      endpoint: "https://models.example.test/v1",
      model: "gemma-4-e4b-it-4bit",
    });

    expect(providerModelConfigOrDefault(configs, "ollama", "reading-prompt")).toEqual({
      endpoint: "http://localhost:11434/",
      model: "gemma4:e4b-it-qat",
    });
    expect(providerModelConfigOrDefault(configs, "openai-compatible", "reading-prompt")).toEqual({
      endpoint: "https://models.example.test/v1",
      model: "gemma-4-e4b-it-4bit",
    });
  });

  it("rejects unsupported endpoint URL schemes", () => {
    expect(validateEndpointUrl("https://models.example.test/v1")).toBeNull();
    expect(validateEndpointUrl("ftp://models.example.test")).toBe(
      "unsupported-scheme",
    );
    expect(validateEndpointUrl("not a url")).toBe("invalid-url");
  });

  it("warns when endpoint URLs carry likely secrets", () => {
    expect(endpointSecurityWarnings("https://models.example.test/v1?api_key=sk-test")).toContain(
      "secret-in-url",
    );
    expect(endpointSecurityWarnings("https://token@example.test/v1")).toContain(
      "secret-in-url",
    );
    expect(endpointSecurityWarnings("https://models.example.test/v1?access_token=abc")).toContain(
      "secret-in-url",
    );
  });

  it("warns about cleartext non-local HTTP but allows loopback HTTP", () => {
    expect(endpointSecurityWarnings("http://api.example.test/v1")).toContain(
      "non-local-http",
    );
    expect(endpointSecurityWarnings("http://localhost:11434")).not.toContain(
      "non-local-http",
    );
    expect(endpointSecurityWarnings("http://127.0.0.1:11434")).not.toContain(
      "non-local-http",
    );
    expect(endpointSecurityWarnings("http://[::1]:11434")).not.toContain(
      "non-local-http",
    );
  });

  it("does not warn for clean HTTPS endpoints or invalid in-progress input", () => {
    expect(endpointSecurityWarnings("https://models.example.test/v1")).toEqual([]);
    expect(endpointSecurityWarnings("not a url")).toEqual([]);
    expect(endpointSecurityWarnings("   ")).toEqual([]);
  });

  it("resolves model names against server-provided tags", () => {
    expect(resolveModelName("gemma4:e4b", ["gemma4:e4b:latest"])).toBe(
      "gemma4:e4b:latest",
    );
    expect(resolveModelName("qwen3.6-35b", ["qwen3.6-35b", "qwen3.6-35b:latest"])).toBe(
      "qwen3.6-35b",
    );
    expect(resolveModelName("custom-model", [])).toBe("custom-model");
  });
});
