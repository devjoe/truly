import { DEFAULT_SETTINGS } from "./types";
import type { ModelProvider } from "./provider-capabilities";

export type ModelSetupRole = "reading-prompt" | "summary-reading";
export type EndpointBackedModelProvider = Extract<ModelProvider, "ollama" | "openai-compatible">;
export type ProviderModelConfig = {
  endpoint: string;
  model: string;
};
export type ProviderModelConfigMap = Partial<Record<EndpointBackedModelProvider, ProviderModelConfig>>;

const ENDPOINT_BACKED_PROVIDERS: EndpointBackedModelProvider[] = ["ollama", "openai-compatible"];

export function defaultEndpointForProvider(provider: ModelProvider): string {
  if (provider === "ollama") return "http://localhost:11434";
  if (provider === "openai-compatible") return "http://localhost:8000/v1";
  return "";
}

export function defaultModelForProvider(provider: ModelProvider, role: ModelSetupRole): string {
  void role;
  if (provider === "ollama") return "gemma4:e4b";
  if (provider === "openai-compatible") return "gemma4:e4b";
  return DEFAULT_SETTINGS.tierBModel;
}

export function isEndpointBackedModelProvider(
  provider: ModelProvider,
): provider is EndpointBackedModelProvider {
  return ENDPOINT_BACKED_PROVIDERS.includes(provider as EndpointBackedModelProvider);
}

export function normalizeProviderModelConfigMap(raw: unknown): ProviderModelConfigMap {
  if (!raw || typeof raw !== "object") return {};
  const record = raw as Record<string, unknown>;
  const normalized: ProviderModelConfigMap = {};
  for (const provider of ENDPOINT_BACKED_PROVIDERS) {
    const entry = record[provider];
    if (!entry || typeof entry !== "object") continue;
    const values = entry as Record<string, unknown>;
    normalized[provider] = {
      endpoint: typeof values.endpoint === "string" ? values.endpoint.trim() : "",
      model: typeof values.model === "string" ? values.model.trim() : "",
    };
  }
  return normalized;
}

export function providerModelConfigOrDefault(
  configs: ProviderModelConfigMap,
  provider: EndpointBackedModelProvider,
  role: ModelSetupRole,
): ProviderModelConfig {
  return {
    endpoint: configs[provider]?.endpoint || defaultEndpointForProvider(provider),
    model: configs[provider]?.model || defaultModelForProvider(provider, role),
  };
}

export function withProviderModelConfig(
  configs: ProviderModelConfigMap,
  provider: EndpointBackedModelProvider,
  config: ProviderModelConfig,
): ProviderModelConfigMap {
  return {
    ...configs,
    [provider]: {
      endpoint: config.endpoint.trim(),
      model: config.model.trim(),
    },
  };
}

export function normalizeEndpointInput(input: string, fallback = ""): string {
  return (input.trim() || fallback).replace(/\/+$/, "");
}

export type EndpointValidationError = "unsupported-scheme" | "invalid-url";

export function validateEndpointUrl(url: string): EndpointValidationError | null {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return "unsupported-scheme";
    }
    return null;
  } catch {
    return "invalid-url";
  }
}

export type EndpointSecurityWarning = "secret-in-url" | "non-local-http";

export function endpointSecurityWarnings(rawEndpoint: string): EndpointSecurityWarning[] {
  const endpoint = rawEndpoint.trim();
  if (!endpoint) return [];
  let parsed: URL;
  try {
    parsed = new URL(endpoint);
  } catch {
    return [];
  }

  const warnings: EndpointSecurityWarning[] = [];
  const sensitiveQuery = Array.from(parsed.searchParams.keys()).some((key) =>
    /(^|[_-])(api[_-]?key|access[_-]?token|auth|authorization|bearer|secret|token)([_-]|$)/i.test(key),
  );
  if (parsed.username || parsed.password || sensitiveQuery) {
    warnings.push("secret-in-url");
  }

  const host = parsed.hostname.toLowerCase();
  const isLoopback = host === "localhost" || host === "127.0.0.1" || host === "::1" || host === "[::1]";
  if (parsed.protocol === "http:" && !isLoopback) {
    warnings.push("non-local-http");
  }

  return warnings;
}

/**
 * Resolve a user-supplied model name against the server's model list.
 * Exact match wins; otherwise prefix-match on the base name before a tag, so
 * "qwen3.5" resolves to "qwen3.5:latest" when that is the only matching tag.
 */
export function resolveModelName(input: string, available: string[]): string {
  const trimmed = input.trim();
  if (!trimmed || available.length === 0) return trimmed;
  if (available.includes(trimmed)) return trimmed;
  const base = trimmed.split(":")[0];
  const prefixMatches = available.filter(
    (model) => model === base || model.startsWith(`${base}:`),
  );
  if (prefixMatches.length === 1) return prefixMatches[0];
  const latest = prefixMatches.find((model) => model.endsWith(":latest"));
  if (latest) return latest;
  if (prefixMatches.length > 0) return prefixMatches[0];
  return trimmed;
}
