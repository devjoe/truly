import { JSDOM } from "jsdom";
import { describe, expect, it } from "vitest";

import type { FilterDecision } from "@src/lib/types";
import { buildTierBBadge } from "@src/content_scripts/heads-up-panel";

function setupDom(): void {
  const dom = new JSDOM("<!doctype html><body></body>");
  globalThis.document = dom.window.document;
  globalThis.HTMLElement = dom.window.HTMLElement;
}

function decision(overrides: Partial<FilterDecision>): FilterDecision {
  return {
    filtered: false,
    scores: {},
    ...overrides,
  };
}

describe("Heads-up analysis status", () => {
  it("replaces completion copy with a neutral check while retaining an accessible label", () => {
    setupDom();
    const badge = buildTierBBadge(decision({
      tier: 3,
      deepClassification: { model: "test-model" },
    }), "zh-TW");

    expect(badge?.classList.contains("truly-badge-complete")).toBe(true);
    expect(badge?.textContent).toBe("✓");
    expect(badge?.getAttribute("aria-label")).toContain("分析完成");
    expect(badge?.title).toContain("分析完成");
  });

  it("keeps the in-progress state explicit before completion", () => {
    setupDom();
    const badge = buildTierBBadge(decision({ tierBPending: true }), "zh-TW");

    expect(badge?.classList.contains("truly-headsup-progress-label")).toBe(true);
    expect(badge?.textContent).toBe("分析中…");
    expect(badge?.getAttribute("role")).toBe("status");
  });
});
