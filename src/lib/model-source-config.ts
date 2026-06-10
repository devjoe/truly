import { DEFAULT_SETTINGS } from "./types";
import type { ModelProvider } from "./provider-capabilities";

export type ModelSetupRole = "reading-prompt" | "summary-reading";

export function defaultEndpointForProvider(provider: ModelProvider): string {
  if (provider === "ollama") return "http://localhost:11434";
  if (provider === "openai-compatible") return "http://localhost:8000/v1";
  return "";
}

export function defaultModelForProvider(provider: ModelProvider, role: ModelSetupRole): string {
  if (provider === "ollama") return "gemma4:e4b-it-qat";
  if (provider === "openai-compatible" && role === "reading-prompt") {
    return "mlx-community/gemma-4-e4b-it-4bit";
  }
  return DEFAULT_SETTINGS.tierBModel;
}

export function normalizeEndpointInput(input: string, fallback = ""): string {
  return (input.trim() || fallback).replace(/\/+$/, "");
}

export function validateEndpointUrl(url: string): string | null {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return "端點網址請使用 http:// 或 https://";
    }
    return null;
  } catch {
    return "端點網址格式無法辨識";
  }
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
