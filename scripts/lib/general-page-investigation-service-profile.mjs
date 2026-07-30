export const INTERACTIVE_P95_MS = 20_000;
export const ABSOLUTE_MAX_MS = 40_000;

export function classifyInvestigationServiceProfile({
  compatibility,
  p95Ms,
  maxMs,
}) {
  if (compatibility !== "compatible" ||
      !Number.isFinite(p95Ms) ||
      !Number.isFinite(maxMs) ||
      maxMs > ABSOLUTE_MAX_MS) {
    return "unqualified";
  }
  return p95Ms <= INTERACTIVE_P95_MS
    ? "interactive"
    : "background_deferred";
}

export function aggregateInvestigationServiceProfiles(profiles) {
  if (profiles.length !== 3 ||
      profiles.some((profile) => profile === "unqualified")) {
    return "unqualified";
  }
  return profiles.every((profile) => profile === "interactive")
    ? "interactive"
    : "background_deferred";
}
