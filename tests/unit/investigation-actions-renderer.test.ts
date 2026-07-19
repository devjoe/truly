import { JSDOM } from "jsdom";
import { describe, expect, it } from "vitest";

import type { DashboardPostEvent } from "@src/lib/types";
import { renderInvestigationActionSection } from "@src/sidepanel/investigation-actions-renderer";

describe("investigation action footer", () => {
  it("does not reserve status space before an action reports progress", () => {
    const dom = new JSDOM("<!doctype html><body></body>");
    globalThis.document = dom.window.document;

    const section = renderInvestigationActionSection({
      id: "synthetic-post",
      text: "Synthetic post text.",
      hasMedia: false,
      isSponsored: false,
      timestamp: "",
      elapsedMs: 0,
      decision: {
        filtered: false,
        scores: {},
      },
    } as DashboardPostEvent, { runtimeState: {} });

    const footer = section.querySelector<HTMLElement>(".investigation-action-footer");
    expect(footer?.hidden).toBe(true);
    expect(footer?.querySelector(".investigation-action-status")?.textContent).toBe("");
  });
});
