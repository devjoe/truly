import { describe, expect, it } from "vitest";

import {
  applyGeneralPageBriefPostGuards,
  generalPageBriefEligibility,
  normalizeGeneralPageBrief,
  parseGeneralPageBriefContent,
} from "@src/lib/general-page-analysis";
import { buildGeneralPageModelUserPrompt } from "@src/lib/general-page-model-context";
import type { GeneralPageModelContext } from "@src/lib/general-page-model-context";

function modelContext(overrides: Partial<GeneralPageModelContext> = {}): GeneralPageModelContext {
  return {
    surfaceKind: "web-page",
    surfaceSource: "general",
    targetKind: "page",
    title: "Synthetic Page",
    url: "https://example.test/article",
    domain: "example.test",
    mainText: "This synthetic page body is long enough to be eligible for a general page model brief. It contains invented civic planning details and no real source text.",
    links: [],
    imageAltText: [],
    extractionWarnings: [],
    modelEligible: true,
    modelReadiness: "ready",
    qualityIssues: [],
    ...overrides,
  };
}

describe("General Page analysis contract", () => {
  it("normalizes schema v1 JSON into a bounded page brief", () => {
    const brief = normalizeGeneralPageBrief({
      schemaVersion: 1,
      summary: "A neutral synthetic summary.",
      bg: [{ t: "Topic", why: "It frames the page.", q: "What is the topic?" }],
      claims: [{ c: "Synthetic claim", why: "It is checkable.", need: "Source", q: "Synthetic claim source?" }],
      qs: [{ q: "What should be checked next?", kind: "verify" }],
      note: "Use source links.",
    }, "mock-model", "en");

    expect(brief).toMatchObject({
      schemaVersion: 1,
      summary: "A neutral synthetic summary.",
      model: "mock-model",
      outputLang: "en",
      bg: [{ t: "Topic", why: "It frames the page.", q: "What is the topic?" }],
      claims: [{ c: "Synthetic claim", why: "It is checkable.", need: "Source", q: "Synthetic claim source?" }],
      qs: [{ q: "What should be checked next?", kind: "verify" }],
      note: "Use source links.",
    });
  });

  it("rejects wrong schema versions and prose-wrapped JSON", () => {
    expect(normalizeGeneralPageBrief({ schemaVersion: 2, summary: "No" }, "model")).toBeNull();
    expect(parseGeneralPageBriefContent("Here is {\"schemaVersion\":1,\"summary\":\"No\"}", "model")).toMatchObject({
      ok: false,
      error: "json_not_found",
    });
  });

  it("parses fenced JSON but fails closed on malformed JSON", () => {
    expect(parseGeneralPageBriefContent("```json\n{\"schemaVersion\":1,\"summary\":\"Ready\"}\n```", "model")).toMatchObject({
      ok: true,
      value: { summary: "Ready" },
    });
    expect(parseGeneralPageBriefContent("{", "model")).toMatchObject({
      ok: false,
      error: "invalid_json",
    });
  });

  it("strips claims for overview-only output and records a review finding", () => {
    const parsed = normalizeGeneralPageBrief({
      schemaVersion: 1,
      summary: "This is a list page with several linked topics.",
      claims: [{ c: "A specific article claim", why: "Should not render", need: "Evidence" }],
    }, "mock-model", "zh-TW");
    expect(parsed).not.toBeNull();

    const guarded = applyGeneralPageBriefPostGuards(parsed!, "page_overview_only");

    expect(guarded.claims).toBeUndefined();
    expect(guarded.outputReview?.scope).toBe("general_page_brief");
    expect(guarded.outputReview?.findings[0]?.ruleId).toBe("general-page-overview-no-claims");
  });

  it("gates eligibility over session, context, allowed use, and provider", () => {
    const base = {
      sessionReady: true,
      surfaceCurrent: true,
      context: { modelEligible: true },
      allowedUse: "article_or_selection_analysis" as const,
      provider: "openai-compatible" as const,
    };

    expect(generalPageBriefEligibility(base)).toEqual({ ok: true });
    expect(generalPageBriefEligibility({ ...base, sessionReady: false })).toMatchObject({ ok: false, reason: "session_not_ready" });
    expect(generalPageBriefEligibility({ ...base, surfaceCurrent: false })).toMatchObject({ ok: false, reason: "stale_surface" });
    expect(generalPageBriefEligibility({ ...base, context: { modelEligible: false } })).toMatchObject({ ok: false, reason: "model_ineligible" });
    expect(generalPageBriefEligibility({ ...base, allowedUse: "requires_user_target" })).toMatchObject({ ok: false, reason: "requires_user_target" });
    expect(generalPageBriefEligibility({ ...base, allowedUse: "blocked" })).toMatchObject({ ok: false, reason: "blocked" });
    expect(generalPageBriefEligibility({ ...base, provider: "none" })).toMatchObject({ ok: false, reason: "provider_not_ready" });
  });

  it("selection prompts include selection context without the full page body", () => {
    const prompt = buildGeneralPageModelUserPrompt(modelContext({
      targetKind: "selection",
      selectedText: "Selected synthetic passage for analysis.",
      mainText: "Selected synthetic passage for analysis.",
      surroundingText: "Nearby context that should not become the summary target.",
    }));

    expect(prompt).toContain("targetKind: selection");
    expect(prompt).toContain("Selected synthetic passage for analysis.");
    expect(prompt).toContain("Nearby context that should not become the summary target.");
    expect(prompt).not.toContain("This synthetic page body is long enough");
  });
});
