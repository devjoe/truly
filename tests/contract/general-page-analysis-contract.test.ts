import { describe, expect, it } from "vitest";

import {
  applyGeneralPageBriefPostGuards,
  canOfferGeneralPageScreenshot,
  generalPageBriefEligibility,
  normalizeGeneralPageBrief,
  parseGeneralPageBriefContent,
} from "@src/lib/general-page-analysis";
import { buildTierBGeneralPageBriefChatBody } from "@src/lib/tier-b-client";
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
      claims: [{
        c: "Synthetic Agency published one claim",
        why: "It is checkable.",
        need: "Source",
        q: "Did Synthetic Agency publish one claim?",
        atom: { s: "Synthetic Agency", p: "published", o: "one claim" },
      }],
      qs: [{ q: "What background would help the reader?", kind: "context" }],
      note: "Use source links.",
    }, "mock-model", "en");

    expect(brief).toMatchObject({
      schemaVersion: 1,
      summary: "A neutral synthetic summary.",
      model: "mock-model",
      outputLang: "en",
      bg: [{ t: "Topic", why: "It frames the page.", q: "What is the topic?" }],
      claims: [{
        c: "Synthetic Agency published one claim",
        why: "It is checkable.",
        need: "Source",
        q: "Did Synthetic Agency publish one claim?",
        atom: { s: "Synthetic Agency", p: "published", o: "one claim" },
      }],
      qs: [{ q: "What background would help the reader?", kind: "context" }],
      note: "Use source links.",
    });
  });

  it("bounds the compact standard brief for every General Page analysis", () => {
    const brief = normalizeGeneralPageBrief({
      schemaVersion: 1,
      summary: "A ".repeat(400),
      bg: [
        { t: "Topic 1", why: "First point." },
        { t: "Topic 2", why: "Second point." },
        { t: "Topic 3", why: "Should be dropped." },
      ],
      claims: [
        { c: "Claim 1", why: "Important.", need: "Evidence.", q: "What primary evidence supports Claim 1?" },
        { c: "Claim 2", why: "Should be dropped.", need: "Evidence.", q: "What primary evidence supports Claim 2?" },
      ],
      qs: [
        { q: "What background would help?", kind: "context" },
        { q: "What alternative perspective matters?", kind: "counter" },
      ],
      note: "N".repeat(300),
    }, "mock-model", "en");

    expect(brief).toMatchObject({
      model: "mock-model",
    });
    expect(brief?.summary.split(/\s+/)).toHaveLength(32);
    expect(brief?.bg).toHaveLength(2);
    expect(brief?.claims).toHaveLength(1);
    expect(brief?.qs).toHaveLength(1);
    expect(brief?.note?.length).toBeLessThanOrEqual(200);
  });

  it("enforces the zh-TW 80-character summary boundary", () => {
    const brief = normalizeGeneralPageBrief({
      schemaVersion: 1,
      summary: "字".repeat(120),
    }, "mock-model", "zh-TW");

    expect(Array.from(brief?.summary ?? "")).toHaveLength(80);
  });

  it("tolerates a missing claim query but drops verify/source follow-up questions", () => {
    const brief = normalizeGeneralPageBrief({
      schemaVersion: 1,
      summary: "A compact result.",
      claims: [{ c: "A supported claim", why: "It matters.", need: "Primary evidence" }],
      qs: [
        { q: "Is the same claim true?", kind: "verify" },
        { q: "Where is the source?", kind: "source" },
        { q: "What background matters?", kind: "context" },
      ],
    }, "mock-model", "en");

    expect(brief?.claims).toEqual([{ c: "A supported claim", why: "It matters.", need: "Primary evidence" }]);
    expect(brief?.qs).toEqual([{ q: "What background matters?", kind: "context" }]);
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

  it("allows requires_user_target only after an explicit screenshot confirmation", () => {
    const base = {
      sessionReady: true,
      surfaceCurrent: true,
      context: { modelEligible: false },
      allowedUse: "requires_user_target" as const,
      provider: "openai-compatible" as const,
    };

    expect(generalPageBriefEligibility(base)).toMatchObject({ ok: false });
    expect(generalPageBriefEligibility({ ...base, screenshotConfirmed: true })).toEqual({ ok: true });
    // blocked stays blocked even with a confirmed screenshot
    expect(generalPageBriefEligibility({ ...base, allowedUse: "blocked", screenshotConfirmed: true }))
      .toMatchObject({ ok: false, reason: "blocked" });
  });

  it("offers the screenshot flow only for vision-capable providers and explicit advisor requests", () => {
    expect(canOfferGeneralPageScreenshot({ visionSupported: true, decision: "request_screenshot_region" })).toBe(true);
    expect(canOfferGeneralPageScreenshot({ visionSupported: true, needsScreenshot: true })).toBe(true);
    expect(canOfferGeneralPageScreenshot({ visionSupported: false, decision: "request_screenshot_region" })).toBe(false);
    expect(canOfferGeneralPageScreenshot({ visionSupported: true, decision: "accept_current" })).toBe(false);
    expect(canOfferGeneralPageScreenshot({ visionSupported: true })).toBe(false);
  });

  it("attaches a confirmed screenshot as an image part without replacing the text prompt", () => {
    const context = modelContext();
    const withoutShot = buildTierBGeneralPageBriefChatBody({
      endpoint: "http://127.0.0.1:4999/v1/chat/completions",
      model: "vision-model",
      context,
      allowedUse: "article_or_selection_analysis",
      outputLang: "en",
    });
    expect(typeof withoutShot.messages[1]?.content).toBe("string");
    expect(withoutShot.max_tokens).toBe(720);
    const englishPrompt = String(withoutShot.messages[0]?.content);
    expect(englishPrompt).toContain("search-ready verification question");
    expect(englishPrompt).toContain("could materially change the reader's judgment");
    expect(englishPrompt).toContain("not a keyword list, domain, or path");
    expect(englishPrompt).toContain("exactly one atomic assertion");
    expect(englishPrompt).toContain("atom.s, atom.p, and atom.o");
    expect(englishPrompt).toContain("arrested, charged, denied bail, convicted, and sentenced");
    expect(englishPrompt).toContain("whether text or images appear AI-generated");
    expect(englishPrompt).toContain("ordinary purchase decision");
    expect(englishPrompt).toContain("single success or failure");
    expect(englishPrompt).toContain("index, feed, or mixed list");
    expect(englishPrompt).toContain("Claims MUST be empty for ordinary engagement");
    expect(englishPrompt).toContain("purchase decision, consumer rights");
    expect(englishPrompt).toContain("same assertion as claim.c");
    expect(englishPrompt).toContain("claims MUST contain no more than 1 item");
    expect(englishPrompt).toContain("understand|context|counter|image");
    expect(englishPrompt).not.toContain("Quick mode");
    expect(englishPrompt).not.toContain("Full mode");

    const zhStandard = buildTierBGeneralPageBriefChatBody({
      endpoint: "http://127.0.0.1:4999/v1/chat/completions",
      model: "standard-model",
      context,
      allowedUse: "article_or_selection_analysis",
      outputLang: "zh-TW",
    });
    const zhPrompt = String(zhStandard.messages[0]?.content);
    expect(zhPrompt).toContain("可直接搜尋的核心查核問題");
    expect(zhPrompt).toContain("可能實質改變讀者");
    expect(zhPrompt).toContain("不得只是關鍵字、網域或路徑");
    expect(zhPrompt).toContain("只能處理一個原子主張");
    expect(zhPrompt).toContain("atom.s、atom.p、atom.o");
    expect(zhPrompt).toContain("被捕、被控、不得交保、被判有罪與被判刑");
    expect(zhPrompt).toContain("內容是否像 AI 生成");
    expect(zhPrompt).toContain("一般購買決策本身不等於");
    expect(zhPrompt).toContain("單一使用者操作工具成功或失敗");
    expect(zhPrompt).toContain("索引、feed 或互不相關");
    expect(zhPrompt).toContain("claims 必須回空陣列");
    expect(zhPrompt).toContain("影響購買決策");
    expect(zhPrompt).toContain("claims.c 的同一個主張");
    expect(zhPrompt).toContain("claims 絕對不得超過 1 項");
    expect(zhPrompt).toContain("不得使用 verify/source 類型");
    expect(zhPrompt).not.toContain("快速模式");
    expect(zhPrompt).not.toContain("完整模式");

    const withShot = buildTierBGeneralPageBriefChatBody({
      endpoint: "http://127.0.0.1:4999/v1/chat/completions",
      model: "vision-model",
      context,
      allowedUse: "article_or_selection_analysis",
      outputLang: "en",
      screenshotDataUrl: "data:image/jpeg;base64,c3ludGhldGljLXNjcmVlbnNob3Q=",
    });
    const content = withShot.messages[1]?.content;
    expect(withShot.max_tokens).toBe(720);
    expect(withShot.messages[0]?.content).toBe(withoutShot.messages[0]?.content);
    expect(Array.isArray(content)).toBe(true);
    if (Array.isArray(content)) {
      expect(content[0]).toMatchObject({ type: "text" });
      expect(content[1]).toMatchObject({
        type: "image_url",
        image_url: { url: expect.stringContaining("data:image/jpeg;base64") },
      });
      expect(String(content[0]?.text)).toContain(context.mainText.slice(0, 24));
    }
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
