import fs from "node:fs";
import { JSDOM } from "jsdom";
import { describe, expect, it } from "vitest";

import {
  collectGeneralPageCandidateBlocks,
  extractCurrentPageReadingSurface,
  extractCurrentSelectionTarget,
  handleCandidateBlockTextMessage,
  handlePageReadingMessage,
  handleReadingTargetMessage,
} from "@src/content_scripts/page-reader";
import type { TrulyMessage } from "@src/lib/messages";

const FIXTURE_DIR = "tests/fixtures/general-pages";

function fixtureDocument(name: string, url: string): Document {
  const html = fs.readFileSync(`${FIXTURE_DIR}/${name}`, "utf8");
  return new JSDOM(html, { url }).window.document;
}

describe("page-reader content script", () => {
  it("extracts the current document into a page reading result", () => {
    const url = "https://example.test/articles/clean-article";
    const documentRef = fixtureDocument("clean-article.html", url);

    const result = extractCurrentPageReadingSurface(documentRef, url);

    expect(result).toMatchObject({
      type: "PAGE_READING_RESULT",
      surface: {
        kind: "web-page",
        source: "general",
        url,
        title: "Clean Article Fixture",
        extraction: {
          method: "semantic-html",
          status: "complete",
          warnings: [],
        },
      },
    });
    expect(result.surface.mainText).toContain("public planning meeting");
  });

  it("collects candidate block previews and resolves a selected block to full text", () => {
    const url = "https://example.test/articles/candidate-block";
    const longParagraphs = Array.from({ length: 18 }, (_, index) => (
      `Synthetic candidate paragraph ${index + 1} contains enough local-only text to exceed the preview limit while remaining safe for a public fixture.`
    )).join(" ");
    const dom = new JSDOM(`
      <!doctype html>
      <main>
        <nav><a href="/one">One</a><a href="/two">Two</a></nav>
        <article id="story-body">${longParagraphs}</article>
      </main>
    `, { url });
    const documentRef = dom.window.document;

    const blocks = collectGeneralPageCandidateBlocks(documentRef);
    const articleBlock = blocks.find((block) => block.label.includes("#story-body"));

    expect(articleBlock).toMatchObject({
      id: expect.stringMatching(/^block-/),
      role: "semantic-root",
      textLength: longParagraphs.length,
    });
    expect(articleBlock?.textPreview.length).toBeLessThan(longParagraphs.length);

    const surface = extractCurrentPageReadingSurface(documentRef, url).surface;
    const handled = articleBlock ? handleCandidateBlockTextMessage(
      {
        type: "GENERAL_PAGE_CANDIDATE_BLOCK_TEXT_REQUEST",
        tabId: 1,
        surfaceId: surface.id,
        blockId: articleBlock.id,
      } satisfies TrulyMessage,
      documentRef,
      url,
    ) : undefined;

    expect(handled).toMatchObject({
      type: "GENERAL_PAGE_CANDIDATE_BLOCK_TEXT_RESULT",
      surfaceId: surface.id,
      blockId: articleBlock?.id,
      text: longParagraphs,
    });
  });

  it("responds only to page reading requests", () => {
    const url = "https://example.test/articles/clean-article";
    const documentRef = fixtureDocument("clean-article.html", url);

    const ignored = handlePageReadingMessage(
      { type: "GET_STATS" } satisfies TrulyMessage,
      documentRef,
      url,
    );
    const handled = handlePageReadingMessage(
      { type: "PAGE_READING_REQUEST" } satisfies TrulyMessage,
      documentRef,
      url,
    );

    expect(ignored).toBeUndefined();
    expect(handled?.type).toBe("PAGE_READING_RESULT");
  });

  it("does not treat current selection as page input for a normal page read", () => {
    const url = "https://example.test/articles/clean-article";
    const documentRef = fixtureDocument("clean-article.html", url);
    documentRef.getSelection = () => ({
      toString: () => "Selected text should require an explicit future selection action.",
    } as Selection);

    const handled = handlePageReadingMessage(
      {
        type: "PAGE_READING_REQUEST",
        activation: {
          source: "popup",
          targetKind: "page",
          action: "read",
        },
      } satisfies TrulyMessage,
      documentRef,
      url,
    );

    expect(handled?.type).toBe("PAGE_READING_RESULT");
    if (handled?.type !== "PAGE_READING_RESULT") return;
    expect(handled.surface.mainText).toContain("public planning meeting");
    expect(handled.surface.mainText).not.toContain("Selected text should require");
    expect(handled.surface.selectedText).toBeUndefined();
  });

  it("fails closed for reserved selection and current-region actions", () => {
    const url = "https://example.test/articles/clean-article";
    const documentRef = fixtureDocument("clean-article.html", url);

    const selection = handlePageReadingMessage(
      {
        type: "PAGE_READING_REQUEST",
        activation: {
          source: "hotkey",
          targetKind: "selection",
          action: "summarize",
        },
      } satisfies TrulyMessage,
      documentRef,
      url,
    );
    const currentRegion = handlePageReadingMessage(
      {
        type: "PAGE_READING_REQUEST",
        activation: {
          source: "hotkey",
          targetKind: "current-region",
          action: "fact_check",
        },
      } satisfies TrulyMessage,
      documentRef,
      url,
    );

    expect(selection).toEqual({
      type: "PAGE_READING_ERROR",
      error: "page_reading_action_unsupported",
    });
    expect(currentRegion).toEqual({
      type: "PAGE_READING_ERROR",
      error: "page_reading_action_unsupported",
    });
  });

  it("extracts a user-triggered selection target snapshot", () => {
    const url = "https://example.test/articles/clean-article";
    const documentRef = fixtureDocument("clean-article.html", url);
    const surface = extractCurrentPageReadingSurface(documentRef, url).surface;
    const selected = [
      "This selected synthetic passage is intentionally long enough for the selection target flow.",
      "It represents explicit reader intent and should become the model context target.",
    ].join(" ");
    documentRef.getSelection = () => ({
      toString: () => selected,
      rangeCount: 0,
    } as Selection);

    const handled = handleReadingTargetMessage(
      {
        type: "READING_TARGET_REQUEST",
        tabId: 1,
        trigger: "selection",
        surfaceId: surface.id,
        activation: {
          source: "sidepanel",
          targetKind: "selection",
          action: "read",
        },
      } satisfies TrulyMessage,
      documentRef,
      url,
    );

    expect(handled).toMatchObject({
      type: "READING_TARGET_RESULT",
      target: {
        surfaceId: surface.id,
        kind: "selection",
        text: selected,
        extraction: {
          method: "selection",
          status: "complete",
          warnings: [],
        },
      },
    });
  });

  it("returns typed selection target errors for empty or stale selections", () => {
    const url = "https://example.test/articles/clean-article";
    const documentRef = fixtureDocument("clean-article.html", url);
    documentRef.getSelection = () => ({
      toString: () => "too short",
      rangeCount: 0,
    } as Selection);

    expect(extractCurrentSelectionTarget(documentRef, url)).toEqual({
      type: "READING_TARGET_ERROR",
      error: "no_meaningful_selection",
    });

    const longSelection = "This selected synthetic passage is long enough to be meaningful, but the expected surface id is stale.";
    documentRef.getSelection = () => ({
      toString: () => longSelection,
      rangeCount: 0,
    } as Selection);

    expect(extractCurrentSelectionTarget(documentRef, url, "surface:stale")).toEqual({
      type: "READING_TARGET_ERROR",
      error: "target_stale",
    });
  });
});
