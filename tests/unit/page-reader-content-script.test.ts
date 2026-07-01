import fs from "node:fs";
import { JSDOM } from "jsdom";
import { describe, expect, it } from "vitest";

import {
  extractCurrentPageReadingSurface,
  handlePageReadingMessage,
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
});
