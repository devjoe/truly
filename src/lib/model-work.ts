export type ModelWorkPriority = "user_blocking" | "foreground" | "derived" | "prefetch";
export type DeepModelWorkSource = "expand" | "manual" | "auto" | "prefetch";
export type ReadingBriefModelWorkSource = "user" | "prefetch";

export function modelWorkPriorityForDeepSource(source: DeepModelWorkSource | undefined): ModelWorkPriority {
  if (source === "expand" || source === "manual") return "user_blocking";
  if (source === "prefetch") return "prefetch";
  return "foreground";
}

export function modelWorkPriorityForReadingBriefSource(
  source: ReadingBriefModelWorkSource | undefined,
): ModelWorkPriority {
  return source === "prefetch" ? "derived" : "user_blocking";
}

export function modelWorkResourceKey(input: {
  provider?: string;
  effectiveProvider?: string;
  endpoint?: string;
  model?: string;
}): string {
  return [input.effectiveProvider || input.provider || "unknown", input.endpoint || "local", input.model || "default"].join("|");
}
