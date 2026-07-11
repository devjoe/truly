import { describe, expect, it } from "vitest";

import {
  assertMeaningfulNavigationScenario,
  meaningfulNavigationSummary,
} from "../../scripts/lib/general-page-audit-scenarios/meaningful-navigation.mjs";

function autoReadObservation() {
  return {
    initial: { requestId: "read:old" },
    afterHash: { stale: false },
    afterTracking: { stale: false },
    afterMeaningful: { oldExcerptVisible: false, sourceLinkVisible: false },
    timeline: [
      { requestId: "read:old", sessionStatus: "ready", hasSurface: true, oldExcerptVisible: true, oldSourceLinkVisible: true },
      { requestId: null, sessionStatus: "loading", hasSurface: false, oldExcerptVisible: false, oldSourceLinkVisible: false },
      { requestId: "read:new", sessionStatus: "ready", hasSurface: true, oldExcerptVisible: false, oldSourceLinkVisible: false },
    ],
  };
}

describe("meaningful navigation audit scenario", () => {
  it("accepts a canonical scrub-before-auto-read transition", () => {
    const result = autoReadObservation();
    expect(assertMeaningfulNavigationScenario(result, { autoRead: true })).toEqual([]);
    expect(meaningfulNavigationSummary(result)).toEqual({
      hashStale: false,
      trackingStale: false,
      loadingObserved: true,
      staleObserved: false,
      scrubObserved: true,
      requestInvalidated: true,
      oldContentVisibleAtEnd: false,
    });
  });

  it("rejects tracking churn and a meaningful transition that keeps old content", () => {
    const result = autoReadObservation();
    result.afterTracking.stale = true;
    result.afterMeaningful.oldExcerptVisible = true;
    result.timeline = result.timeline.slice(0, 1);
    expect(assertMeaningfulNavigationScenario(result, { autoRead: true })).toEqual(expect.arrayContaining([
      "tracking-only query change incorrectly marked stale",
      "meaningful URL change did not scrub stale Web surface content",
      "meaningful URL change did not enter a scrubbed canonical auto-read transition",
    ]));
  });

  it("requires a scrubbed stale state when all-sites auto-read is off", () => {
    const result = autoReadObservation();
    result.timeline = [
      { requestId: null, sessionStatus: "stale", hasSurface: false, staleVisible: true, oldExcerptVisible: false, oldSourceLinkVisible: false },
    ];
    expect(assertMeaningfulNavigationScenario(result, { autoRead: false })).toEqual([]);
  });
});
