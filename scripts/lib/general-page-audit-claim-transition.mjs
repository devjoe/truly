function normalizeState(state = {}) {
  return {
    observed: state.observed === true,
    text: typeof state.text === "string" ? state.text : "",
    originalClaimVisible: state.originalClaimVisible === true,
    readyCardVisible: state.readyCardVisible === true,
  };
}

function isSafePreparingState(state) {
  return state.observed && state.originalClaimVisible && !state.readyCardVisible;
}

export function resolveClaimPreparationEvidence(liveState, timelineEntries = []) {
  const live = normalizeState(liveState);
  if (isSafePreparingState(live)) return { ...live, source: "live" };

  const timelineEntry = timelineEntries.find((entry) =>
    entry?.claimPreparingPresent === true &&
    entry?.claimOriginalVisible === true &&
    entry?.claimReadyCardVisible === false);
  if (timelineEntry) {
    return {
      observed: true,
      text: typeof timelineEntry.claimPreparingText === "string" ? timelineEntry.claimPreparingText : "",
      originalClaimVisible: true,
      readyCardVisible: false,
      source: "timeline",
    };
  }

  return { ...live, observed: false, source: "none" };
}
