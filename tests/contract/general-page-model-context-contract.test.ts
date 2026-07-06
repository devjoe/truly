import fs from "node:fs";
import { JSDOM } from "jsdom";
import { describe, expect, it } from "vitest";

import { extractGeneralPageSurface } from "@src/lib/general-page-extraction";
import {
  buildGeneralPageModelContext,
  buildGeneralPageModelUserPrompt,
  GENERAL_PAGE_MODEL_MIN_MAIN_TEXT_LENGTH,
} from "@src/lib/general-page-model-context";
import type { ReadingTarget } from "@src/lib/reading-target-types";

const FIXTURE_DIR = "tests/fixtures/general-pages";

function fixtureDocument(name: string, url: string): Document {
  const html = fs.readFileSync(`${FIXTURE_DIR}/${name}`, "utf8");
  return new JSDOM(html, { url }).window.document;
}

describe("general page model context contract", () => {
  it("serializes a web page into bounded model context without social-feed assumptions", () => {
    const url = "https://example.test/articles/clean-article";
    const surface = extractGeneralPageSurface({
      document: fixtureDocument("clean-article.html", url),
      url,
    });

    const context = buildGeneralPageModelContext(surface);
    const prompt = buildGeneralPageModelUserPrompt(context);

    expect(context).toMatchObject({
      surfaceKind: "web-page",
      surfaceSource: "general",
      targetKind: "page",
      title: "Clean Article Fixture",
      domain: "example.test",
      modelEligible: true,
      modelReadiness: "ready",
      qualityIssues: [],
    });
    expect(context.mainText.length).toBeGreaterThanOrEqual(GENERAL_PAGE_MODEL_MIN_MAIN_TEXT_LENGTH);
    expect(context.links).toContainEqual({
      href: "https://example.test/sources/meeting-notes",
      text: "meeting notes",
    });
    expect(context.imageAltText).toContain("Illustration of a street plan");
    expect(prompt).toContain("Analyze this web page");
    expect(prompt).toContain("## Source Links");
    expect(prompt).toContain("meeting notes: https://example.test/sources/meeting-notes");
    expect(prompt).not.toMatch(/\bFacebook\b/i);
    expect(prompt).not.toMatch(/\bposts?\b/i);
    expect(prompt).not.toMatch(/\bshares?\b/i);
    expect(prompt).not.toMatch(/\breposts?\b/i);
  });

  it("keeps source-link context to normal web URLs", () => {
    const url = "https://example.test/articles/clean-article";
    const surface = extractGeneralPageSurface({
      document: fixtureDocument("clean-article.html", url),
      url,
    });

    const context = buildGeneralPageModelContext({
      ...surface,
      mainText: [
        "為達最佳瀏覽效果，建議使用 Chrome、Firefox 或 Microsoft Edge 的瀏覽器。",
        "請至 Edge 官網下載 請至 Firefox 官網下載 請至 Google 官網下載。",
        surface.mainText,
      ].join(" "),
      links: [
        { href: "javascript:alert(1)", text: "unsafe" },
        { href: "data:text/plain,hello", text: "data" },
        { href: "https://example.test/", text: "首頁" },
        { href: "https://example.test/", text: "Example News" },
        { href: "https://www.microsoft.com/edge/download", text: "請至 Edge 官網下載" },
        { href: "https://www.mozilla.org/firefox/new", text: "請至 Firefox 官網下載" },
        { href: "https://example.test/valid", text: "valid" },
      ],
    });

    expect(context.links).toEqual([
      { href: "https://example.test/valid", text: "valid" },
    ]);
    expect(context.mainText).not.toContain("Edge 官網下載");
    expect(context.mainText).not.toContain("Firefox 官網下載");
    expect(context.mainText).not.toContain("Google 官網下載");
  });

  it("filters article utility links out of model source context", () => {
    const url = "https://news.example.test/research/source-link-noise";
    const surface = extractGeneralPageSurface({
      document: fixtureDocument("article-source-link-noise.html", url),
      url,
    });

    const context = buildGeneralPageModelContext(surface);

    expect(context.modelEligible).toBe(true);
    expect(context.links).toEqual([
      {
        href: "https://news.example.test/research/source-link-noise/source",
        text: "Article source",
      },
    ]);
    expect(context.mainText).toContain("article source link noise fixture");
  });

  it("filters social, unlabeled, and navigation links before model context", () => {
    const surface = extractGeneralPageSurface({
      document: fixtureDocument("clean-article.html"),
      url: "https://example.test/articles/clean-article",
    });
    const context = buildGeneralPageModelContext({
      ...surface,
      links: [
        { href: "https://example.test/source/one", text: "Source one" },
        { href: "https://example.test/source/two", text: "Source two" },
        { href: "https://example.test/source/three", text: "Source three" },
        { href: "https://example.test/source/four", text: "Source four" },
        { href: "https://example.test/source/five", text: "Source five" },
        { href: "https://example.test/source/six", text: "Source six" },
        { href: "https://example.test/source/seven", text: "Source seven" },
        { href: "https://example.test/empty", text: "" },
        { href: "https://facebook.example.test/share", text: "Facebook" },
        { href: "https://example.test/share/article", text: "Share" },
        { href: "https://example.test/subscribe", text: "Subscribe" },
        { href: "https://example.test/articles/other", text: "Read article" },
        { href: "https://example.test/contact", text: "Contact" },
        { href: "https://example.test/copy", text: "CopyLink" },
        { href: "https://example.test/#comments", text: "#" },
      ],
    });

    expect(context.links).toEqual([
      { href: "https://example.test/source/one", text: "Source one" },
      { href: "https://example.test/source/two", text: "Source two" },
      { href: "https://example.test/source/three", text: "Source three" },
      { href: "https://example.test/source/four", text: "Source four" },
      { href: "https://example.test/source/five", text: "Source five" },
      { href: "https://example.test/source/six", text: "Source six" },
    ]);
  });

  it("allows strong short semantic articles through the model gate as caution", () => {
    const url = "https://briefs.example.test/news/short-semantic-brief";
    const surface = extractGeneralPageSurface({
      document: fixtureDocument("short-semantic-news-brief.html", url),
      url,
    });

    const context = buildGeneralPageModelContext(surface);

    expect(context).toMatchObject({
      modelEligible: true,
      modelReadiness: "caution",
      ineligibilityReason: undefined,
      qualityIssues: ["partial_extraction"],
    });
    expect(context.mainText.length).toBeLessThan(GENERAL_PAGE_MODEL_MIN_MAIN_TEXT_LENGTH);
    expect(context.mainText).toContain("Short article bodies can still be useful model context");
  });

  it("marks long fallback or partial extraction as caution instead of clean model-ready", () => {
    const url = "https://example.test/articles/clean-article";
    const surface = extractGeneralPageSurface({
      document: fixtureDocument("clean-article.html", url),
      url,
    });

    const context = buildGeneralPageModelContext({
      ...surface,
      extraction: {
        method: "fallback",
        status: "partial",
        warnings: ["large-navigation-noise", "no-main-content"],
      },
    });
    const prompt = buildGeneralPageModelUserPrompt(context);

    expect(context).toMatchObject({
      modelEligible: true,
      modelReadiness: "caution",
      qualityIssues: [
        "fallback_extraction",
        "partial_extraction",
        "large_navigation_noise",
        "no_main_content",
      ],
    });
    expect(prompt).toContain("modelReadiness: caution");
    expect(prompt).toContain("qualityIssues: fallback_extraction, partial_extraction, large_navigation_noise, no_main_content");
  });

  it("keeps utility-dense article roots eligible but not clean-ready", () => {
    const url = "https://wire.example.test/news/utility-dense-ready-trap";
    const surface = extractGeneralPageSurface({
      document: fixtureDocument("article-root-utility-dense-ready-trap.html", url),
      url,
    });

    const context = buildGeneralPageModelContext(surface);

    expect(context).toMatchObject({
      modelEligible: true,
      modelReadiness: "caution",
      qualityIssues: ["partial_extraction", "large_navigation_noise"],
    });
    expect(context.mainText).toContain("fictional transit committee reviewed station access plans");
    expect(context.mainText).not.toContain("Synthetic market update 08:10");
    expect(context.mainText).not.toContain("Search this site");
  });

  it("keeps selected text out of page context unless an explicit target is supplied", () => {
    const url = "https://example.test/articles/selected-text";
    const surface = extractGeneralPageSurface({
      document: fixtureDocument("selected-text.html", url),
      url,
    });
    const target: ReadingTarget = {
      id: "target:selection",
      surfaceId: surface.id,
      kind: "selection",
      text: "Explicitly selected synthetic paragraph for a future user-triggered analysis action.",
      surroundingText: "The surrounding synthetic article remains available as context.",
      extraction: {
        method: "selection",
        status: "complete",
        warnings: [],
      },
    };

    const pageContext = buildGeneralPageModelContext(surface, { targetKind: "page" });
    const targetContext = buildGeneralPageModelContext(surface, { target });

    expect(pageContext.targetKind).toBe("page");
    expect(pageContext.mainText).toContain("This synthetic article is available for whole-page extraction");
    expect(pageContext.mainText).not.toBe(target.text);
    expect(targetContext.targetKind).toBe("selection");
    expect(targetContext.mainText).toBe(target.text);
    expect(targetContext.surroundingText).toBe(target.surroundingText);
  });

  it("blocks model calls for short or blocked extraction results", () => {
    const shortSurface = extractGeneralPageSurface({
      document: fixtureDocument("js-shell-bad-page.html", "https://example.test/app/shell"),
      url: "https://example.test/app/shell",
    });
    const blockedSurface = extractGeneralPageSurface({
      document: fixtureDocument("blocked-like.html", "https://example.test/member-only"),
      url: "https://example.test/member-only",
    });

    expect(buildGeneralPageModelContext(shortSurface)).toMatchObject({
      modelEligible: false,
      modelReadiness: "blocked",
      ineligibilityReason: "main_text_too_short",
    });
    expect(buildGeneralPageModelContext({
      ...blockedSurface,
      extraction: {
        ...blockedSurface.extraction,
        status: "blocked",
      },
    })).toMatchObject({
      modelEligible: false,
      modelReadiness: "blocked",
      ineligibilityReason: "empty_or_blocked",
    });
  });
});
