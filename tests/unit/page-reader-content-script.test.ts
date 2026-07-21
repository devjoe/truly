import fs from "node:fs";
import { JSDOM } from "jsdom";
import { describe, expect, it } from "vitest";

import {
  collectGeneralPageCandidateBlocks,
  extractCurrentPageReadingSurface,
  extractCurrentPointTarget,
  extractCurrentSelectionTarget,
  handleCandidateBlockTextMessage,
  handlePageReadingMessage,
  handleReadingTargetMessage,
  installPointerTracking,
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
      documentSignals: {
        articleCount: 1,
        mainCount: 0,
        roleMainCount: 0,
      },
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

  it("uses the same structural sanitizer for Page text and advisor candidate text", () => {
    const url = "https://example.test/articles/neutral-utility-cluster";
    const dom = new JSDOM(`
      <!doctype html>
      <title>Neutral utility cluster fixture</title>
      <article id="story-body">
        <h1>Neutral utility cluster fixture</h1>
        <p>The first synthetic paragraph explains a fictional public planning process with enough complete prose for a useful reading context.</p>
        <p>The second synthetic paragraph records a fictional review outcome and keeps the body distinct from surrounding utility cards.</p>
        <section class="module-42">
          <a href="/other-one">Another synthetic story headline</a>
          <a href="/other-two">Second unrelated synthetic story headline</a>
          <button type="button">Open module</button>
        </section>
        <div itemprop="author">Synthetic author biography and profile navigation</div>
      </article>
    `, { url });
    const documentRef = dom.window.document;

    const result = extractCurrentPageReadingSurface(documentRef, url);
    const articleBlock = result.candidateBlocks.find((block) => block.label.includes("#story-body"));
    const handled = articleBlock ? handleCandidateBlockTextMessage({
      type: "GENERAL_PAGE_CANDIDATE_BLOCK_TEXT_REQUEST",
      tabId: 1,
      surfaceId: result.surface.id,
      blockId: articleBlock.id,
    } satisfies TrulyMessage, documentRef, url) : undefined;

    expect(result.surface.mainText).toContain("first synthetic paragraph");
    expect(result.surface.mainText).not.toContain("Another synthetic story headline");
    expect(result.surface.mainText).not.toContain("Synthetic author biography");
    expect(articleBlock?.textPreview).not.toContain("Another synthetic story headline");
    expect(handled).toMatchObject({
      type: "GENERAL_PAGE_CANDIDATE_BLOCK_TEXT_RESULT",
      text: expect.not.stringContaining("Another synthetic story headline"),
    });
  });

  it("keeps recommendation streams out of parser-advisor candidates and block lookup", () => {
    const url = "https://example.test/articles/recommendation-stream-candidate";
    const dom = new JSDOM(`
      <!doctype html>
      <title>Recommendation stream candidate fixture</title>
      <div id="recommended-article-stream">
        <p>Unrelated synthetic story one contains enough prose to become a candidate without structural filtering.</p>
        <p>Unrelated synthetic story two belongs to a separate page and must never become the reading target.</p>
      </div>
      <article id="story-body">
        <h1>Recommendation stream candidate fixture</h1>
        <p>The first primary paragraph describes a fictional archive review and its public release schedule.</p>
        <p>The second primary paragraph records a made-up decision and a traceable synthetic source.</p>
        <p>The third primary paragraph closes the same report without unrelated navigation.</p>
      </article>
    `, { url });
    const documentRef = dom.window.document;

    const result = extractCurrentPageReadingSurface(documentRef, url);
    expect(result.candidateBlocks.some((block) => block.label.includes("recommended-article-stream"))).toBe(false);
    const articleBlock = result.candidateBlocks.find((block) => block.label.includes("#story-body"));
    expect(articleBlock?.id).toBe("block-1");

    const handled = articleBlock ? handleCandidateBlockTextMessage({
      type: "GENERAL_PAGE_CANDIDATE_BLOCK_TEXT_REQUEST",
      tabId: 1,
      surfaceId: result.surface.id,
      blockId: articleBlock.id,
    } satisfies TrulyMessage, documentRef, url) : undefined;
    expect(handled).toMatchObject({
      type: "GENERAL_PAGE_CANDIDATE_BLOCK_TEXT_RESULT",
      blockId: "block-1",
      text: expect.stringContaining("first primary paragraph"),
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

  it("resolves a hotkey current-region request from the tracked pointer", () => {
    const url = "https://example.test/articles/clean-article";
    const documentRef = fixtureDocument("clean-article.html", url);
    const paragraph = documentRef.querySelector("article p");
    expect(paragraph).toBeTruthy();
    (documentRef as unknown as { elementFromPoint?: (x: number, y: number) => Element | null }).elementFromPoint =
      () => paragraph;

    const tracker = installPointerTracking(documentRef);
    documentRef.dispatchEvent(new (documentRef.defaultView as typeof globalThis & Window).MouseEvent("mousemove", {
      clientX: 40,
      clientY: 60,
    }));
    expect(tracker.point?.x).toBe(40);
    expect(tracker.point?.y).toBe(60);

    const surfaceId = extractCurrentPageReadingSurface(documentRef, url).surface.id;
    const response = handleReadingTargetMessage(
      {
        type: "READING_TARGET_REQUEST",
        tabId: 1,
        trigger: "hotkey",
        surfaceId,
        activation: { source: "hotkey", targetKind: "current-region", action: "read" },
      } satisfies TrulyMessage,
      documentRef,
      url,
      tracker,
    );

    expect(response?.type).toBe("READING_TARGET_RESULT");
    if (response?.type === "READING_TARGET_RESULT") {
      expect(response.target.kind).toBe("paragraph");
      expect(response.target.extraction.method).toBe("point-target");
      expect(response.target.surfaceId).toBe(surfaceId);
    }
  });

  it("returns typed point-target errors for stale pointers and stale surfaces", () => {
    const url = "https://example.test/articles/clean-article";
    const documentRef = fixtureDocument("clean-article.html", url);
    const paragraph = documentRef.querySelector("article p");
    (documentRef as unknown as { elementFromPoint?: (x: number, y: number) => Element | null }).elementFromPoint =
      () => paragraph;

    // No pointer movement at all → no_pointer_target.
    const neverMoved = extractCurrentPointTarget(documentRef, url, undefined, { point: undefined });
    expect(neverMoved).toEqual({
      type: "READING_TARGET_ERROR",
      error: "no_pointer_target",
    });

    // Stale pointer → no_pointer_target.
    const staleTracker = { point: { x: 5, y: 5, ts: 0 } };
    const stalePointer = extractCurrentPointTarget(documentRef, url, undefined, staleTracker, () => 10_000_000);
    expect(stalePointer).toEqual({
      type: "READING_TARGET_ERROR",
      error: "no_pointer_target",
    });

    // Fresh pointer but stale surface binding → target_stale.
    const freshTracker = { point: { x: 5, y: 5, ts: 9_999_999 } };
    const staleSurface = extractCurrentPointTarget(documentRef, url, "surface:stale", freshTracker, () => 10_000_000);
    expect(staleSurface).toEqual({
      type: "READING_TARGET_ERROR",
      error: "target_stale",
    });
  });
});
