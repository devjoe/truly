import { describe, expect, it, vi } from "vitest";

import { handleSidepanelRuntimeMessage } from "@src/sidepanel/runtime-message-router";

describe("sidepanel runtime message router", () => {
  it("routes background investigation preparation separately from page reading results", () => {
    const generalPageInvestigationResult = vi.fn();
    const pageReadingResult = vi.fn();

    handleSidepanelRuntimeMessage({
      type: "GENERAL_PAGE_INVESTIGATION_RESULT",
      tabId: 42,
      analysisKey: "page:key",
      scope: "page",
      claimIndex: 0,
      status: "ineligible",
    }, {
      settingsUpdated: vi.fn(),
      postClassified: vi.fn(),
      dashboardReplay: vi.fn(),
      openDashboardForPost: vi.fn(),
      currentViewPost: vi.fn(),
      manualViewPost: vi.fn(),
      pageReadingResult,
      generalPageInvestigationResult,
    });

    expect(generalPageInvestigationResult).toHaveBeenCalledWith(expect.objectContaining({
      analysisKey: "page:key",
      status: "ineligible",
    }));
    expect(pageReadingResult).not.toHaveBeenCalled();
  });
});
