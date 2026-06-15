export type OllamaCloudVisionSupport = "supported" | "unsupported" | "unknown";

export interface OllamaCloudCapabilityEntry {
  id: string;
  displayName: string;
  input: ReadonlyArray<"text" | "image" | "audio">;
  tags: ReadonlyArray<string>;
  sourceUrl: string;
  notes?: string;
}

export const OLLAMA_CLOUD_CAPABILITY_REGISTRY = {
  schemaVersion: 1,
  updatedAt: "2026-06-16",
  source: "https://ollama.com/search?c=cloud&o=newest",
  entries: [
    {
      id: "deepseek-v4-flash:cloud",
      displayName: "DeepSeek-V4-Flash",
      input: ["text"],
      tags: ["tools", "thinking", "cloud"],
      sourceUrl: "https://ollama.com/library/deepseek-v4-flash",
      notes: "Ollama page lists Text input only.",
    },
    {
      id: "gemma4:cloud",
      displayName: "Gemma 4",
      input: ["text", "image", "audio"],
      tags: ["vision", "tools", "thinking", "audio", "cloud"],
      sourceUrl: "https://ollama.com/library/gemma4",
      notes: "Ollama page lists Text, Image input.",
    },
  ] satisfies OllamaCloudCapabilityEntry[],
} as const;

export function normalizeOllamaModelId(model: string): string {
  return model.trim().toLowerCase();
}

export function modelLooksLikeOllamaCloud(model: string): boolean {
  return normalizeOllamaModelId(model).endsWith(":cloud");
}

export function endpointLooksLikeOllamaCloud(endpoint: string): boolean {
  try {
    const url = new URL(endpoint);
    return url.hostname === "ollama.com" || url.hostname.endsWith(".ollama.com");
  } catch {
    return false;
  }
}

export function lookupOllamaCloudCapability(model: string): OllamaCloudCapabilityEntry | undefined {
  const normalized = normalizeOllamaModelId(model);
  return OLLAMA_CLOUD_CAPABILITY_REGISTRY.entries.find((entry) => {
    const id = normalizeOllamaModelId(entry.id);
    return normalized === id || normalized === id.replace(/:cloud$/, "");
  });
}

export function ollamaCloudVisionSupport(model: string): OllamaCloudVisionSupport {
  const entry = lookupOllamaCloudCapability(model);
  if (!entry) return "unknown";
  return entry.input.includes("image") ? "supported" : "unsupported";
}
