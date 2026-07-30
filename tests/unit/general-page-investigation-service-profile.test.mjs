import { describe, expect, it } from "vitest";

import {
  aggregateInvestigationServiceProfiles,
  classifyInvestigationServiceProfile,
} from "../../scripts/lib/general-page-investigation-service-profile.mjs";

describe("General Page investigation service profile", () => {
  it("keeps the existing interactive p95 and absolute max boundaries", () => {
    expect(classifyInvestigationServiceProfile({
      compatibility: "compatible",
      p95Ms: 20_000,
      maxMs: 40_000,
    })).toBe("interactive");
    expect(classifyInvestigationServiceProfile({
      compatibility: "compatible",
      p95Ms: 20_001,
      maxMs: 40_000,
    })).toBe("background_deferred");
    expect(classifyInvestigationServiceProfile({
      compatibility: "compatible",
      p95Ms: 20_001,
      maxMs: 40_001,
    })).toBe("unqualified");
    expect(classifyInvestigationServiceProfile({
      compatibility: "incompatible",
      p95Ms: 1,
      maxMs: 1,
    })).toBe("unqualified");
  });

  it("requires all three receipts and carries the slowest qualified profile", () => {
    expect(aggregateInvestigationServiceProfiles([
      "interactive",
      "interactive",
      "interactive",
    ])).toBe("interactive");
    expect(aggregateInvestigationServiceProfiles([
      "interactive",
      "background_deferred",
      "interactive",
    ])).toBe("background_deferred");
    expect(aggregateInvestigationServiceProfiles([
      "interactive",
      "unqualified",
      "interactive",
    ])).toBe("unqualified");
    expect(aggregateInvestigationServiceProfiles([
      "interactive",
      "interactive",
    ])).toBe("unqualified");
  });
});
