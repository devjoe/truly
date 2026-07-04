import { describe, expect, it } from "vitest";

import { extractGeneralPageSurface } from "@src/lib/general-page-extraction";
import { buildGeneralPageModelContext } from "@src/lib/general-page-model-context";
import {
  GENERAL_PAGE_ADVISOR_UI_CONTEXT_LABEL,
  GENERAL_PAGE_EFFECTIVE_MODEL_CONTEXT_CODE_NAME,
  buildGeneralPageEffectiveModelContext,
  buildGeneralPageParserAdvisorRequest,
  buildGeneralPageParserAdvisorSystemPrompt,
  buildGeneralPageParserAdvisorUserPrompt,
  buildRuleBasedGeneralPageParserAdvice,
  parseGeneralPageParserAdvisorAdvice,
  resolveGeneralPageParserAdvisorRuntimePolicy,
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

  it("codifies the user-initiated automatic advisor lane", () => {
    const policy = resolveGeneralPageParserAdvisorRuntimePolicy();
    const autoScreenshotPolicy = resolveGeneralPageParserAdvisorRuntimePolicy({ autoScreenshotEnabled: true });

    expect(policy).toMatchObject({
      lane: "general-page-advisor",
      trigger: "user_read_action",
      canAutoRunAfterReadIntent: true,
      canRunInBackground: false,
      providerConfigSource: "tier-b-provider",
      resultPersistence: "session-only",
      effectiveContextCodeName: GENERAL_PAGE_EFFECTIVE_MODEL_CONTEXT_CODE_NAME,
      userFacingContextLabel: GENERAL_PAGE_ADVISOR_UI_CONTEXT_LABEL,
      screenshot: {
        defaultRequiresConfirmation: true,
        autoScreenshotAllowed: false,
      },
    });
    expect(autoScreenshotPolicy.screenshot).toEqual({
      defaultRequiresConfirmation: true,
      autoScreenshotAllowed: true,
    });
  });

  it("measures payload budget and permits full text only below threshold", () => {
    const shortRequest = requestFixture();
    const longText = `${"Long article sentence. ".repeat(700)}`;
    const longDom = new JSDOM(`<!doctype html><title>Long</title><article><p>${longText}</p></article>`, {
      url: "https://example.test/long",
    });
    const longSurface = extractGeneralPageSurface({
      document: longDom.window.document,
      url: "https://example.test/long",
    });
    const longRequest = buildGeneralPageParserAdvisorRequest(buildGeneralPageModelContext(longSurface));

    expect(shortRequest.payloadBudget.currentTextMode).toBe("full");
    expect(shortRequest.currentTextPreview.length).toBe(shortRequest.currentTextLength);
    expect(longRequest.payloadBudget.currentTextMode).toBe("preview");
    expect(longRequest.currentTextPreview.length).toBeLessThan(longRequest.currentTextLength);
    expect(longRequest.payloadBudget.estimatedPayloadChars).toBeGreaterThan(0);
  });
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

  it("does not let dynamic app-shell pages recover through candidate blocks", () => {
    const dom = new JSDOM(`<!doctype html>
      <title>Enable JavaScript to Continue</title>
      <main>
        <h1>Enable JavaScript to continue</h1>
        <p>This synthetic app shell says JavaScript is required before the readable article can render. It is long enough to trip candidate-block recovery if dynamic content is not fail-closed first.</p>
        <p>Loading page content should not be treated as an article body just because it sits inside a semantic main landmark.</p>
      </main>`, {
      url: "https://app.example.test/search",
    });
    const surface = extractGeneralPageSurface({
      document: dom.window.document,
      url: "https://app.example.test/search",
    });
    const context = buildGeneralPageModelContext(surface);
    const request = buildGeneralPageParserAdvisorRequest(context, {
      candidateBlocks: [{
        id: "block-main",
        label: "main",
        role: "semantic-root",
        textPreview: surface.mainText,
        textLength: surface.mainText.length,
        linkCount: 0,
        imageCount: 0,
      }],
    });
    const advice = buildRuleBasedGeneralPageParserAdvice(request);

    expect(request.escalation.reasons).toContain("dynamic_content");
    expect(request.escalation.allowedDecisions).not.toContain("prefer_candidate_block");
    expect(advice.pageType).toBe("app_shell");
    expect(advice.decision).toBe("request_user_selection");
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

  it("builds an effective model context without overwriting the deterministic surface", () => {
    const request = requestFixture();
    const parsed = parseGeneralPageParserAdvisorAdvice(JSON.stringify({
      schemaVersion: 1,
      pageType: "article",
      decision: "prefer_candidate_block",
      confidence: "high",
      selectedBlockId: "block-article",
      needsUserSelection: false,
      needsScreenshot: false,
      riskTags: ["candidate_block_ambiguous"],
      rationale: "Use the article-like block.",
    }), request);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok)
      return;

    const context = buildGeneralPageModelContext(extractGeneralPageSurface({
      document: new JSDOM("<!doctype html><title>Fallback</title><body><p>Fallback body text is intentionally less specific than the selected candidate block but remains preserved.</p></body>", { url: "https://example.test/fallback" }).window.document,
      url: "https://example.test/fallback",
    }));
    const effective = buildGeneralPageEffectiveModelContext(context, request, parsed.value);

    expect(effective).toMatchObject({
      codeName: "effectiveModelContext",
      uiLabel: "Reading context",
      allowedUse: "article_or_selection_analysis",
      appliedDecision: "prefer_candidate_block",
      selectedBlockId: "block-article",
      source: "candidate-block",
      trace: {
        deterministicSurfacePreserved: true,
        readingSurfaceOverwritten: false,
        advisorApplied: true,
      },
    });
    expect(effective.mainText).toContain("Useful article text");
  });

  it("uses re-extracted full candidate text when applying prefer-candidate advice", () => {
    const request = requestFixture();
    const context = buildGeneralPageModelContext(extractGeneralPageSurface({
      document: new JSDOM("<!doctype html><title>Fallback</title><body><p>Fallback body text is intentionally less specific than the selected candidate block but remains preserved.</p></body>", { url: "https://example.test/fallback" }).window.document,
      url: "https://example.test/fallback",
    }));
    const fullCandidateText = [
      "Useful article text from the re-extracted candidate block.",
      "This second sentence is intentionally absent from the advisor preview and should still reach effective model context.",
    ].join(" ");
    const effective = buildGeneralPageEffectiveModelContext(context, request, {
      schemaVersion: 1,
      pageType: "article",
      decision: "prefer_candidate_block",
      confidence: "high",
      selectedBlockId: "block-article",
      needsUserSelection: false,
      needsScreenshot: false,
      riskTags: ["candidate_block_ambiguous"],
      rationale: "Use the article-like block.",
    }, {
      selectedBlockText: fullCandidateText,
    });

    expect(effective.source).toBe("candidate-block");
    expect(effective.mainText).toBe(fullCandidateText);
    expect(effective.mainText).toContain("absent from the advisor preview");
  });

  it("turns index/list advice into page overview only effective context", () => {
    const request = requestFixture();
    const context = buildGeneralPageModelContext(extractGeneralPageSurface({
      document: new JSDOM("<!doctype html><title>Index</title><body><main><h1>Top Stories</h1><p>Directory page lists several synthetic entries, not one article.</p></main></body>", { url: "https://example.test/" }).window.document,
      url: "https://example.test/",
    }));
    const effective = buildGeneralPageEffectiveModelContext(context, request, {
      schemaVersion: 1,
      pageType: "index_or_feed",
      decision: "downgrade_to_index_or_feed",
      confidence: "high",
      needsUserSelection: false,
      needsScreenshot: false,
      riskTags: ["index_or_feed"],
      rationale: "This is a list page.",
    });

    expect(effective).toMatchObject({
      modelEligible: true,
      modelReadiness: "caution",
      allowedUse: "page_overview_only",
      pageType: "index_or_feed",
      source: "advisor-downgrade",
    });
  });

  it("requires an explicit target for user-selection or screenshot recovery", () => {
    const context = buildGeneralPageModelContext(extractGeneralPageSurface({
      document: new JSDOM("<!doctype html><body>short</body>", { url: "https://example.test/short" }).window.document,
      url: "https://example.test/short",
    }));
    const request = buildGeneralPageParserAdvisorRequest(context, { allowScreenshot: true });
    const effective = buildGeneralPageEffectiveModelContext(context, request, {
      schemaVersion: 1,
      pageType: "unknown",
      decision: "request_screenshot_region",
      confidence: "medium",
      needsUserSelection: false,
      needsScreenshot: true,
      riskTags: ["needs_visual_grounding"],
      rationale: "DOM text is insufficient.",
    });

    expect(effective).toMatchObject({
      modelEligible: false,
      modelReadiness: "blocked",
      allowedUse: "requires_user_target",
      appliedDecision: "request_screenshot_region",
      source: "user-target-required",
    });
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

  it("keeps utility-dense articles as article/caution instead of page overview", () => {
    const dom = new JSDOM(`<!doctype html>
      <head>
        <title>Utility Dense Article</title>
        <meta property="article:published_time" content="2026-07-03T09:20:00Z">
      </head>
      <body>
        <article>
          <h1>Utility Dense Article</h1>
          <form><input name="q"><button>Search</button></form>
          <p>The useful article body remains the intended reading target even though the semantic root contains many utility controls and links.</p>
          <p>A second synthetic paragraph keeps the article body useful enough for model context while still requiring a caution state.</p>
          <ul>${Array.from({ length: 18 }, (_, index) => `<li><a href="/topic-${index}">Topic ${index}</a></li>`).join("")}</ul>
        </article>
      </body>`, {
      url: "https://wire.example.test/news/utility-dense",
    });
    const surface = extractGeneralPageSurface({
      document: dom.window.document,
      url: "https://wire.example.test/news/utility-dense",
    });
    const context = buildGeneralPageModelContext(surface);
    const request = buildGeneralPageParserAdvisorRequest(context, {
      document: {
        articleCount: 1,
        mainCount: 0,
        roleMainCount: 0,
        paragraphCount: 2,
        linkCount: 18,
        imageCount: 0,
        formCount: 1,
        hasArticleMeta: true,
        hasOpenGraph: false,
      },
    });
    const advice = buildRuleBasedGeneralPageParserAdvice(request);

    expect(request.escalation.reasons).toContain("large_navigation_noise");
    expect(request.escalation.reasons).not.toContain("index_or_feed");
    expect(advice).toMatchObject({
      pageType: "article",
      decision: "accept_current",
      confidence: "medium",
    });
  });

  it("downgrades multi-article teaser hubs to page overview", () => {
    const dom = new JSDOM(`<!doctype html>
      <head><title>Teaser Hub</title></head>
      <body>
        <article><h2>First teaser</h2><p>The first synthetic teaser card is short and does not represent a complete article body.</p><a href="/one">Read one</a></article>
        <article><h2>Second teaser</h2><p>The second synthetic teaser card repeats the same preview pattern for a fictional public notice.</p><a href="/two">Read two</a></article>
        <article><h2>Third teaser</h2><p>The third synthetic teaser card confirms this is a hub of previews rather than one readable story.</p><a href="/three">Read three</a></article>
      </body>`, {
      url: "https://daily.example.test/briefs/teaser-hub",
    });
    const surface = extractGeneralPageSurface({
      document: dom.window.document,
      url: "https://daily.example.test/briefs/teaser-hub",
    });
    const context = buildGeneralPageModelContext(surface);
    const request = buildGeneralPageParserAdvisorRequest(context, {
      document: {
        articleCount: 3,
        mainCount: 0,
        roleMainCount: 0,
        paragraphCount: 3,
        linkCount: 3,
        imageCount: 0,
        formCount: 0,
        hasArticleMeta: false,
        hasOpenGraph: false,
      },
    });
    const advice = buildRuleBasedGeneralPageParserAdvice(request);

    expect(request.escalation.reasons).toEqual(expect.arrayContaining([
      "large_navigation_noise",
      "index_or_feed",
    ]));
    expect(advice).toMatchObject({
      pageType: "index_or_feed",
      decision: "downgrade_to_index_or_feed",
      confidence: "high",
    });
  });

  it("keeps noisy fallback shells downgraded to page overview", () => {
    const context = buildGeneralPageModelContext({
      id: "general:https://example.test/noisy",
      kind: "web-page",
      source: "general",
      url: "https://example.test/noisy",
      mainText: "Noisy fallback shell contains browser download text, navigation labels, and a short synthetic report body that is useful only as a cautious page overview.",
      extraction: {
        method: "fallback",
        status: "partial",
        warnings: ["no-main-content", "large-navigation-noise"],
      },
    });
    const request = buildGeneralPageParserAdvisorRequest(context, {
      candidateBlocks: [{
        id: "block-shell",
        label: "layout shell",
        role: "fallback-block",
        textPreview: context.mainText,
        textLength: context.mainText.length,
        linkCount: 4,
        imageCount: 0,
      }],
    });
    const advice = buildRuleBasedGeneralPageParserAdvice(request);

    expect(request.escalation.reasons).toEqual(expect.arrayContaining([
      "fallback_extraction",
      "large_navigation_noise",
      "no_main_content",
    ]));
    expect(advice).toMatchObject({
      pageType: "index_or_feed",
      decision: "downgrade_to_index_or_feed",
      confidence: "medium",
    });
  });

  it("downgrades multi-article teaser hubs even without large navigation noise", () => {
    const context = buildGeneralPageModelContext({
      id: "general:https://daily.example.test/briefs/teaser-hub",
      kind: "web-page",
      source: "general",
      url: "https://daily.example.test/briefs/teaser-hub",
      title: "Multi Article Teaser Hub Fixture",
      mainText: "First synthetic teaser The multi article teaser hub fixture contains short cards that describe fictional civic notices. This first card is a preview, not a complete article body.",
      extraction: {
        method: "semantic-html",
        status: "partial",
        warnings: [],
      },
    });
    const request = buildGeneralPageParserAdvisorRequest(context, {
      document: {
        articleCount: 3,
        mainCount: 0,
        roleMainCount: 0,
        paragraphCount: 3,
        linkCount: 3,
        imageCount: 0,
        formCount: 0,
        hasArticleMeta: false,
        hasOpenGraph: false,
      },
    });
    const advice = buildRuleBasedGeneralPageParserAdvice(request);

    expect(request.escalation.reasons).toEqual(expect.arrayContaining([
      "index_or_feed",
      "short_text",
    ]));
    expect(advice).toMatchObject({
      pageType: "index_or_feed",
      decision: "downgrade_to_index_or_feed",
      confidence: "high",
    });
  });
});
