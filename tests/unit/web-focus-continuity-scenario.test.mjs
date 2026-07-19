import { describe, expect, it } from "vitest";

import {
  WEB_FOCUS_CONTINUITY_ARTIFACTS,
  assertWebFocusContinuity,
  webFocusContinuitySummary,
} from "../../scripts/lib/general-page-audit-scenarios/web-focus-continuity.mjs";

function passingObservation() {
  const style = { color: "rgb(228, 230, 235)", fontSize: "14px", fontWeight: "700" };
  return {
    selection: { focusPanelCount: 1, hasPageCard: false },
    continuity: {
      webBeforeFocus: { summary: "Web summary", documentHasFocus: false },
      focusBeforeWeb: {
        summary: "Focus summary",
        updateButtonText: "套用選取內容",
        headingStyle: style,
        referenceStyle: style,
        documentHasFocus: false,
      },
      webAfterFocus: { summary: "Web summary", documentHasFocus: false },
      focusAfterWeb: { summary: "Focus summary", documentHasFocus: false },
    },
  };
}

describe("Web/Focus continuity audit scenario", () => {
  it("owns stable artifact names and accepts a preserved background flow", () => {
    expect(WEB_FOCUS_CONTINUITY_ARTIFACTS.webRestored).toBe("page-web-restored-after-focus.png");
    expect(assertWebFocusContinuity(passingObservation())).toEqual([]);
    expect(webFocusContinuitySummary(passingObservation().continuity)).toMatchObject({
      webPreserved: true,
      focusPreserved: true,
      typographyAligned: true,
      focusAction: "套用選取內容",
      documentFocusStates: ["false", "false", "false", "false"],
    });
  });

  it("reports scope loss, copy drift, hierarchy drift, and unintended focus independently", () => {
    const observation = passingObservation();
    observation.selection.focusPanelCount = 2;
    observation.continuity.webAfterFocus.summary = "Lost Web state";
    observation.continuity.focusAfterWeb.summary = "Lost Focus state";
    observation.continuity.focusBeforeWeb.referenceStyle = { ...observation.continuity.focusBeforeWeb.referenceStyle, fontSize: "12px" };
    observation.continuity.focusBeforeWeb.updateButtonText = "更新 Focus";
    observation.continuity.focusAfterWeb.documentHasFocus = true;
    expect(assertWebFocusContinuity(observation)).toEqual(expect.arrayContaining([
      "Focus did not preserve the single-card target-centric information architecture",
      "Web analysis was not preserved across the Focus switch",
      "Focus analysis was not preserved across the Web switch",
      "Focus overview typography does not match the subsection hierarchy",
      "unexpected Focus action copy: 更新 Focus",
      "background CDP UI check unexpectedly focused its Side Panel target",
    ]));
  });
});
