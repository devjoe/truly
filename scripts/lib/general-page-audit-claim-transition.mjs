function normalizeState(state = {}) {
  return {
    observed: state.observed === true,
    text: typeof state.text === "string" ? state.text : "",
    compactRowVisible: state.compactRowVisible === true,
    actionReadyVisible: state.actionReadyVisible === true,
  };
}

function isSafePreparingState(state) {
  return state.observed && state.compactRowVisible && state.actionReadyVisible;
}

export function resolveClaimPreparationEvidence(liveState, timelineEntries = []) {
  const live = normalizeState(liveState);
  if (isSafePreparingState(live)) return { ...live, source: "live" };

  const timelineEntry = timelineEntries.find((entry) =>
    entry?.claimPreparingPresent === true &&
    entry?.claimCompactRowVisible === true &&
    entry?.claimActionReadyVisible === true);
  if (timelineEntry) {
    return {
      observed: true,
      text: typeof timelineEntry.claimPreparingText === "string" ? timelineEntry.claimPreparingText : "",
      compactRowVisible: true,
      actionReadyVisible: true,
      source: "timeline",
    };
  }

  return { ...live, observed: false, source: "none" };
}
