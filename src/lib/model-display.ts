export interface ModelDisplayIdentity {
  key: string;
  label: string;
}

function trimLatest(raw: string): string {
  return raw.trim().replace(/:latest$/i, "");
}

export function modelDisplayIdentity(raw: string): ModelDisplayIdentity {
  const label = trimLatest(raw);
  const normalized = label.toLowerCase();

  if (normalized === "chrome-gemini-nano" || normalized === "gemini nano") {
    return { key: "gemini-nano", label: "Gemini Nano" };
  }

  if (normalized === "gemma4:e4b") {
    return { key: "gemma4:e4b", label: "Gemma 4 E4B" };
  }

  if (normalized === "gemma4:e4b-it-qat") {
    return { key: "gemma4:e4b-it-qat", label: "Gemma 4 E4B (QAT)" };
  }

  return { key: normalized, label };
}

export function dedupeModelDisplayNames(rawNames: Array<string | undefined>): string[] {
  const names: string[] = [];
  const seen = new Set<string>();
  for (const raw of rawNames) {
    if (!raw) continue;
    const identity = modelDisplayIdentity(raw);
    if (!identity.key || seen.has(identity.key)) continue;
    seen.add(identity.key);
    names.push(identity.label);
  }
  return names;
}
