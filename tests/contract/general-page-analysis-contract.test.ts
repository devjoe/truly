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
        policy: { claimKind: "fact", consequence: "public_interest" },
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
        policy: { claimKind: "fact", consequence: "public_interest" },
      }],
      qs: [{ q: "What background would help the reader?", kind: "context" }],
      note: "Use source links.",
    });
  });

  it("normalizes typed attribution and action policy without inventing missing fields", () => {
    const attributed = normalizeGeneralPageBrief({
      schemaVersion: 1,
      summary: "An attributed estimate.",
      claims: [{
        c: "Expert analysis estimated that the policy would cost households $200.",
        why: "The estimate could affect household finances.",
        need: "The analysis and its calculation.",
        q: "Did expert analysis estimate that the policy would cost households $200?",
        atom: { s: "the policy", p: "would cost", o: "households $200" },
        attribution: { source: "Expert analysis", relation: "estimated", modality: "estimate" },
        policy: { claimKind: "estimate", consequence: "money" },
      }],
    }, "mock-model", "en");

    expect(attributed?.claims?.[0]).toMatchObject({
      attribution: { source: "Expert analysis", relation: "estimated", modality: "estimate" },
      policy: { claimKind: "estimate", consequence: "money" },
    });

    const missing = normalizeGeneralPageBrief({
      schemaVersion: 1,
      summary: "A legacy-shaped claim remains readable.",
      claims: [{
        c: "A claim without v3 action metadata.",
        why: "It may still be useful reading context.",
        need: "Primary evidence.",
      }],
    }, "mock-model", "en");
    expect(missing?.claims?.[0]).toEqual({
      c: "A claim without v3 action metadata.",
      why: "It may still be useful reading context.",
      need: "Primary evidence.",
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
        { c: "Claim 2", why: "Important.", need: "Evidence.", q: "What primary evidence supports Claim 2?" },
        { c: "Claim 3", why: "Important.", need: "Evidence.", q: "What primary evidence supports Claim 3?" },
        { c: "Claim 4", why: "Should be dropped.", need: "Evidence.", q: "What primary evidence supports Claim 4?" },
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
    expect(brief?.claims).toHaveLength(3);
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

  it("applies the semantic follow-up boundary even when the model mislabels source intent", () => {
    const brief = normalizeGeneralPageBrief({
      schemaVersion: 1,
      summary: "頁面說明一項合成政策。",
      claims: [{
        c: "合成機關公布一項政策。",
        why: "可能影響公共判斷。",
        need: "合成機關公告。",
        q: "合成機關是否公布一項政策？",
      }],
      qs: [
        { q: "此貼文所引用之時間線數據來源為何？", kind: "counter" },
        { q: "這項政策有哪些不同觀點？", kind: "counter" },
      ],
    }, "mock-model", "zh-TW");

    expect(brief?.qs).toEqual([{ q: "這項政策有哪些不同觀點？", kind: "counter" }]);
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
    expect(withoutShot.max_tokens).toBe(1_100);
    const englishPrompt = String(withoutShot.messages[0]?.content);
    expect(englishPrompt).toContain("schemaVersion and summary are always required");
    expect(englishPrompt).toContain("never arrays of strings");
    expect(englishPrompt).toContain("materially change judgment");
    expect(englishPrompt).toContain("keyword lists");
    expect(englishPrompt).toContain("exactly one atomic assertion");
    expect(englishPrompt).toContain("atom.s, atom.p, and atom.o");
    expect(englishPrompt).toContain("three short, non-overlapping substrings verbatim");
    expect(englishPrompt).toContain("at most 6 English words");
    expect(englishPrompt).toContain("select only one and rewrite claim.c");
    expect(englishPrompt).toContain("Keep attribution and modality exact");
    expect(englishPrompt).not.toContain("Every claim MUST include policy");
    expect(englishPrompt).toContain("complete sentence with terminal punctuation");
    expect(englishPrompt).toContain("broad marketing problem statements");
    expect(englishPrompt).toContain("arrested, charged, denied bail, convicted, and sentenced");
    expect(englishPrompt).toContain("routine product features");
    expect(englishPrompt).toContain("indexes, feeds, or mixed headlines");
    expect(englishPrompt).toContain("current page itself already answers whether its author expressed that view");
    expect(englishPrompt).toContain("Each bg item must contain exactly one background concept");
    expect(englishPrompt).toContain("Include author identity only when it materially changes how the page should be interpreted");
    expect(englishPrompt).toContain("claims <=3 items");
    expect(englishPrompt).toContain("omit weak or duplicate candidates");
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
    expect(zhPrompt).toContain("schemaVersion 與 summary 永遠必填");
    expect(zhPrompt).toContain("絕對不可使用字串陣列");
    expect(zhPrompt).toContain("可能實質改變健康、安全、金錢、權利、法律或公共事件判斷");
    expect(zhPrompt).toContain("每個 claim 只能有一個原子主張");
    expect(zhPrompt).toContain("atom.s、atom.p、atom.o");
    expect(zhPrompt).toContain("三段簡短、不重疊文字");
    expect(zhPrompt).toContain("最多 12 個中文字");
    expect(zhPrompt).toContain("只選一個並把 claims.c 改寫成該單一完整陳述");
    expect(zhPrompt).toContain("來源歸因與語氣必須保持原意");
    expect(zhPrompt).not.toContain("每個 claim 都必須包含 policy");
    expect(zhPrompt).toContain("有句末標點的完整句");
    expect(zhPrompt).toContain("廣泛行銷問題陳述");
    expect(zhPrompt).toContain("被捕、被控、不得交保、被判有罪與被判刑");
    expect(zhPrompt).toContain("一般折扣／折扣碼／課程數量");
    expect(zhPrompt).toContain("索引、feed 或混合標題");
    expect(zhPrompt).toContain("目前頁面本身已直接回答作者是否表達該觀點");
    expect(zhPrompt).toContain("每個 bg 項目只能包含一個背景概念");
    expect(zhPrompt).toContain("只有作者身分會實質影響文章解讀時才可納入");
    expect(zhPrompt).toContain("claims 最多 3 項");
    expect(zhPrompt).toContain("不要為了湊數");
    expect(zhPrompt).toContain("不得使用 verify/source");
    expect(zhPrompt).not.toContain("快速模式");
    expect(zhPrompt).not.toContain("完整模式");

    const v3English = buildTierBGeneralPageBriefChatBody({
      endpoint: "http://127.0.0.1:4999/v1/chat/completions",
      model: "candidate-model",
      context,
      allowedUse: "article_or_selection_analysis",
      outputLang: "en",
      contract: "investigation_v3",
    });
    const v3EnglishPrompt = String(v3English.messages[0]?.content);
    expect(v3EnglishPrompt).toContain("Every claim MUST include policy");
    expect(v3EnglishPrompt).toContain("before or after the atom");
    expect(v3EnglishPrompt).toContain("Product availability, personal opinion, and generic controversy");
    expect(v3EnglishPrompt).toContain("Good attributed atomic example");
    expect(v3EnglishPrompt).toContain("Before emitting claims, silently verify");

    const v3Zh = buildTierBGeneralPageBriefChatBody({
      endpoint: "http://127.0.0.1:4999/v1/chat/completions",
      model: "candidate-model",
      context,
      allowedUse: "article_or_selection_analysis",
      outputLang: "zh-TW",
      contract: "investigation_v3",
    });
    const v3ZhPrompt = String(v3Zh.messages[0]?.content);
    expect(v3ZhPrompt).toContain("每個 claim 都必須包含 policy");
    expect(v3ZhPrompt).toContain("claims.c 在 atom 前後另有");
    expect(v3ZhPrompt).toContain("產品是否供應、個人意見與泛稱引發爭議");
    expect(v3ZhPrompt).toContain("正確的歸因原子範例");
    expect(v3ZhPrompt).toContain("輸出 claims 前，必須在內部逐項確認");

    const withShot = buildTierBGeneralPageBriefChatBody({
      endpoint: "http://127.0.0.1:4999/v1/chat/completions",
      model: "vision-model",
      context,
      allowedUse: "article_or_selection_analysis",
      outputLang: "en",
      screenshotDataUrl: "data:image/jpeg;base64,c3ludGhldGljLXNjcmVlbnNob3Q=",
    });
    const content = withShot.messages[1]?.content;
    expect(withShot.max_tokens).toBe(1_100);
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
