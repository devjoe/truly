export const READING_ACTIVATION_SOURCES = [
  "toolbar",
  "popup",
  "sidepanel",
  "hotkey",
] as const;

export const READING_ACTIVATION_TARGET_KINDS = [
  "page",
  "selection",
  "current-region",
] as const;

export const READING_ACTIONS = [
  "read",
  "summarize",
  "explain",
  "extract_claims",
  "fact_check",
] as const;

export type ReadingActivationSource = typeof READING_ACTIVATION_SOURCES[number];
export type ReadingActivationTargetKind = typeof READING_ACTIVATION_TARGET_KINDS[number];
export type ReadingAction = typeof READING_ACTIONS[number];

export interface ReadingActivation {
  source: ReadingActivationSource;
  targetKind: ReadingActivationTargetKind;
  action: ReadingAction;
}

export function isReadingActivationSource(value: unknown): value is ReadingActivationSource {
  return typeof value === "string" && (READING_ACTIVATION_SOURCES as readonly string[]).includes(value);
}

export function isReadingActivationTargetKind(value: unknown): value is ReadingActivationTargetKind {
  return typeof value === "string" && (READING_ACTIVATION_TARGET_KINDS as readonly string[]).includes(value);
}

export function isReadingAction(value: unknown): value is ReadingAction {
  return typeof value === "string" && (READING_ACTIONS as readonly string[]).includes(value);
}

export function isReadingActivation(value: unknown): value is ReadingActivation {
  if (!value || typeof value !== "object")
    return false;
  const candidate = value as Partial<ReadingActivation>;
  return isReadingActivationSource(candidate.source) &&
    isReadingActivationTargetKind(candidate.targetKind) &&
    isReadingAction(candidate.action);
}
