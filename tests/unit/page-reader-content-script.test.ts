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
});
