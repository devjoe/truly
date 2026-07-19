function normalizeState(state = {}) {
  return {
    observed: state.observed === true,
    text: typeof state.text === "string" ? state.text : "",
    headingLoadingVisible: state.headingLoadingCount === 1 || state.headingLoadingVisible === true,
    compactRowVisible: state.compactRowVisible === true,
    actionReadyVisible: state.actionReadyVisible === true,
  };
}

function isSafePreparingState(state) {
  return state.observed && state.headingLoadingVisible &&
    !state.compactRowVisible && !state.actionReadyVisible;
}

export function resolveClaimPreparationEvidence(liveState, timelineEntries = []) {
  const live = normalizeState(liveState);
  if (isSafePreparingState(live)) return { ...live, source: "live" };

  const timelineEntry = timelineEntries.find((entry) =>
    entry?.claimPreparingPresent === true &&
    entry?.claimHeadingLoadingVisible === true &&
    entry?.claimCompactRowVisible !== true &&
    entry?.claimActionReadyVisible !== true);
  if (timelineEntry) {
    return {
      observed: true,
      text: typeof timelineEntry.claimPreparingText === "string" ? timelineEntry.claimPreparingText : "",
      headingLoadingVisible: true,
      compactRowVisible: false,
      actionReadyVisible: false,
      source: "timeline",
    };
  }

  return { ...live, observed: false, source: "none" };
}
