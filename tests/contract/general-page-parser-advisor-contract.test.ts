import { describe, expect, it } from "vitest";

import { extractGeneralPageSurface } from "@src/lib/general-page-extraction";
import { buildGeneralPageModelContext } from "@src/lib/general-page-model-context";
import {
  buildGeneralPageParserAdvisorRequest,
  buildGeneralPageParserAdvisorSystemPrompt,
  buildGeneralPageParserAdvisorUserPrompt,
  buildRuleBasedGeneralPageParserAdvice,
  parseGeneralPageParserAdvisorAdvice,
  resolveGeneralPageParserEscalation,
  type GeneralPageParserAdvisorRequest,
} from "@src/lib/general-page-parser-advisor";
import { JSDOM } from "jsdom";

function requestFixture(): GeneralPageParserAdvisorRequest {
  const dom = new JSDOM(`<!doctype html><title>Fixture</title><article><h1>Fixture</h1><p>Useful article text for a synthetic parser advisor fixture. This paragraph is long enough to be considered a candidate body for recovery testing.</p><p>Second paragraph keeps the article-like block distinct from surrounding navigation.</p></article>`, {
    url: "https://example.test/story",
  });
  const surface = extractGeneralPageSurface({
    document: dom.window.document,
    url: "https://example.test/story",
  });
  const context = buildGeneralPageModelContext(surface);
  return buildGeneralPageParserAdvisorRequest(context, {
    candidateBlocks: [{
      id: "block-article",
      label: "article body",
      role: "fallback-block",
      textPreview: "Useful article text for a synthetic parser advisor fixture.",
      textLength: 320,
      linkCount: 0,
      imageCount: 0,
    }],
  });
}

describe("General Page Parser Advisor contract", () => {
  it("builds a fail-closed advisor request from existing model context diagnostics", () => {
    const request = requestFixture();

    expect(request.schemaVersion).toBe(1);
    expect(request.escalation.allowedDecisions).toContain("accept_current");
    expect(request.escalation.allowedDecisions).toContain("prefer_candidate_block");
    expect(request.escalation.allowedDecisions).not.toContain("request_screenshot_region");
    expect(request.currentTextPreview).not.toContain("<article>");
  });

  it("allows screenshot recovery only when explicitly enabled", () => {
    const request = requestFixture();
    const withScreenshot = resolveGeneralPageParserEscalation({
      ...buildGeneralPageModelContext(extractGeneralPageSurface({
        document: new JSDOM("<!doctype html><body>short</body>", { url: "https://example.test/app" }).window.document,
        url: "https://example.test/app",
      })),
    }, { allowScreenshot: true });

    expect(request.escalation.allowedDecisions).not.toContain("request_screenshot_region");
    expect(withScreenshot.allowedDecisions).toContain("request_screenshot_region");
  });

  it("parses compact JSON advice and rejects prose or forbidden decisions", () => {
    const request = requestFixture();
    const good = parseGeneralPageParserAdvisorAdvice(JSON.stringify({
      schemaVersion: 1,
      pageType: "article",
      decision: "prefer_candidate_block",
      confidence: "medium",
      selectedBlockId: "block-article",
      needsUserSelection: false,
      needsScreenshot: false,
      riskTags: ["fallback_extraction"],
      rationale: "Candidate block has denser article text.",
    }), request);

    expect(good).toMatchObject({ ok: true });
    expect(parseGeneralPageParserAdvisorAdvice("Here is JSON: {}", request)).toEqual({ ok: false, error: "not_json_only" });
    expect(parseGeneralPageParserAdvisorAdvice(JSON.stringify({
      schemaVersion: 1,
      pageType: "article",
      decision: "request_screenshot_region",
      confidence: "medium",
      needsUserSelection: false,
      needsScreenshot: true,
      riskTags: ["needs_visual_grounding"],
      rationale: "Need visual context.",
    }), request)).toEqual({ ok: false, error: "decision_not_allowed" });
  });

  it("keeps prompt output narrow and machine-checkable", () => {
    const request = requestFixture();
    const system = buildGeneralPageParserAdvisorSystemPrompt();
    const user = buildGeneralPageParserAdvisorUserPrompt(request);

    expect(system).toContain("Return JSON only");
    expect(system).toContain("downgrade_to_index_or_feed");
    expect(user).toContain("allowedDecisions");
    expect(user).toContain("Candidate Blocks");
  });

  it("rule baseline downgrades dense index pages before model runtime exists", () => {
    const dom = new JSDOM(`<!doctype html><title>Top Stories</title><body><main><h1>Top Stories</h1>${Array.from({ length: 8 }, (_, index) => `<article><h2>Card ${index}</h2><p>Short synthetic card ${index} belongs to a front page, not one complete article.</p><a href="/card-${index}">Read</a></article>`).join("")}</main></body>`, {
      url: "https://news.example.test/",
    });
    const surface = extractGeneralPageSurface({ document: dom.window.document, url: "https://news.example.test/" });
    const request = buildGeneralPageParserAdvisorRequest(buildGeneralPageModelContext(surface), {
      document: {
        articleCount: 8,
        mainCount: 1,
        roleMainCount: 0,
        paragraphCount: 8,
        linkCount: 8,
        imageCount: 0,
        formCount: 0,
        hasArticleMeta: false,
        hasOpenGraph: false,
      },
    });

    const advice = buildRuleBasedGeneralPageParserAdvice(request);
    expect(advice).toMatchObject({
      pageType: "index_or_feed",
      decision: "downgrade_to_index_or_feed",
    });
  });
});
