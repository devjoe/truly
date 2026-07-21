import { describe, expect, it } from "vitest";

import { newExternalPageTargets } from "../../scripts/lib/general-page-audit-targets.mjs";

describe("General Page audit external-target detection", () => {
  it("ignores service-worker lifecycle and extension helper targets", () => {
    const before = [{ id: "article", type: "page", url: "https://example.test/article" }];
    const after = [
      ...before,
      { id: "worker", type: "service_worker", url: "chrome-extension://truly/background.js" },
      { id: "helper", type: "page", url: "chrome-extension://truly/sidepanel.html" },
    ];
    expect(newExternalPageTargets(before, after)).toEqual([]);
  });

  it("detects a newly opened external action page", () => {
    const opened = { id: "gemini", type: "page", url: "https://www.google.com/search?udm=50&q=claim" };
    expect(newExternalPageTargets([], [opened])).toEqual([opened]);
  });
});
