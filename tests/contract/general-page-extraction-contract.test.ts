import fs from "node:fs";
import { JSDOM } from "jsdom";
import { describe, expect, it } from "vitest";

import { extractGeneralPageSurface } from "@src/lib/general-page-extraction";
import type { TrulyMessage } from "@src/lib/messages";
import type { ReadingSurface } from "@src/lib/reading-surface-types";
import type { ReadingTarget } from "@src/lib/reading-target-types";

const FIXTURE_DIR = "tests/fixtures/general-pages";

class FixtureElement {
  constructor(
    private readonly tagName: string,
    private readonly html: string,
    private readonly attributes: Record<string, string> = {},
  ) {}

  get textContent(): string {
    return htmlToText(this.html);
  }

  cloneNode(): FixtureElement {
    return new FixtureElement(this.tagName, this.html, this.attributes);
  }

  remove(): void {}

  getAttribute(name: string): string | null {
    return this.attributes[name.toLowerCase()] ?? null;
  }

  querySelector(selector: string): FixtureElement | null {
    return this.querySelectorAll(selector)[0] ?? null;
  }

  querySelectorAll(selector: string): FixtureElement[] {
    return querySelectorAll(this.html, selector);
  }
}

class FixtureDocument extends FixtureElement {
  readonly body: FixtureElement | null;
  readonly documentElement: FixtureElement;
  readonly title: string;

  constructor(html: string) {
    super("document", html);
    this.title = htmlToText(firstBlock(html, "title")?.html ?? "");
    this.body = firstBlock(html, "body") ?? new FixtureElement("body", html);
    this.documentElement = new FixtureElement("html", html);
  }
}

function fixtureDocument(name: string): Document {
  const html = fs.readFileSync(`${FIXTURE_DIR}/${name}`, "utf8");
  return new FixtureDocument(html) as unknown as Document;
}

function jsdomFixtureDocument(name: string, url: string): Document {
  const html = fs.readFileSync(`${FIXTURE_DIR}/${name}`, "utf8");
  return new JSDOM(html, { url }).window.document;
}

function firstBlock(html: string, tagName: string): FixtureElement | null {
  return querySelectorAll(html, tagName)[0] ?? null;
}

function querySelectorAll(html: string, selector: string): FixtureElement[] {
  if (selector.includes(",")) {
    return selector.flatMap((part) => querySelectorAll(html, part.trim()));
  }

  if (
    selector === "article" ||
    selector === "main" ||
    selector === "body" ||
    selector === "h1" ||
    selector === "title"
  ) {
    return findBlocks(html, selector);
  }
  if (selector === "[role=\"main\"]") {
    return findRoleMainBlocks(html);
  }
  if (selector === "a[href]") {
    return findAnchorElements(html);
  }
  if (selector === "img") {
    return findImageElements(html);
  }
  if (selector === "link[rel=\"canonical\"]" || selector === "link[rel=\"Canonical\"]") {
    return findVoidElements(html, "link")
      .filter((element) => element.getAttribute("rel")?.toLowerCase() === "canonical");
  }
  if (selector === "time[datetime]") {
    return findBlocks(html, "time")
      .filter((element) => Boolean(element.getAttribute("datetime")));
  }

  const metaName = selector.match(/^meta\[name="([^"]+)"\]$/)?.[1];
  if (metaName) {
    return findVoidElements(html, "meta")
      .filter((element) => element.getAttribute("name") === metaName);
  }

  const metaProperty = selector.match(/^meta\[property="([^"]+)"\]$/)?.[1];
  if (metaProperty) {
    return findVoidElements(html, "meta")
      .filter((element) => element.getAttribute("property") === metaProperty);
  }

  return [];
}

function findBlocks(html: string, tagName: string): FixtureElement[] {
  const pattern = new RegExp(`<${tagName}\\b([^>]*)>([\\s\\S]*?)<\\/${tagName}>`, "gi");
  return [...html.matchAll(pattern)]
    .map((match) => new FixtureElement(tagName, match[2] ?? "", parseAttributes(match[1] ?? "")));
}

function findRoleMainBlocks(html: string): FixtureElement[] {
  const pattern = /<([a-z0-9-]+)\b([^>]*\brole=["']main["'][^>]*)>([\s\S]*?)<\/\1>/gi;
  return [...html.matchAll(pattern)]
    .map((match) => new FixtureElement(match[1] ?? "element", match[3] ?? "", parseAttributes(match[2] ?? "")));
}

function findVoidElements(html: string, tagName: string): FixtureElement[] {
  const pattern = new RegExp(`<${tagName}\\b([^>]*)>`, "gi");
  return [...html.matchAll(pattern)]
    .map((match) => new FixtureElement(tagName, "", parseAttributes(match[1] ?? "")));
}

function findAnchorElements(html: string): FixtureElement[] {
  const pattern = /<a\b([^>]*\bhref=["'][^"']+["'][^>]*)>([\s\S]*?)<\/a>/gi;
  return [...html.matchAll(pattern)]
    .map((match) => new FixtureElement("a", match[2] ?? "", parseAttributes(match[1] ?? "")));
}

function findImageElements(html: string): FixtureElement[] {
  return findVoidElements(html, "img");
}

function parseAttributes(raw: string): Record<string, string> {
  const attributes: Record<string, string> = {};
  const pattern = /([a-zA-Z_:.-]+)=["']([^"']*)["']/g;
  for (const match of raw.matchAll(pattern)) {
    const key = match[1]?.toLowerCase();
    const value = match[2];
    if (key && value !== undefined)
      attributes[key] = decodeHtml(value);
  }
  return attributes;
}

function htmlToText(html: string): string {
  return decodeHtml(
    html
      .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
      .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
      .replace(/<noscript\b[\s\S]*?<\/noscript>/gi, " ")
      .replace(/<template\b[\s\S]*?<\/template>/gi, " ")
      .replace(/<svg\b[\s\S]*?<\/svg>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim(),
  );
}

function decodeHtml(value: string): string {
  return value
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'");
}

describe("General Page Reader extraction contract", () => {
  it("extracts a complete article surface with metadata, links, and images", () => {
    const surface = extractGeneralPageSurface({
      document: fixtureDocument("clean-article.html"),
      url: "https://example.test/articles/clean-article?utm_source=fixture",
    });

    expect(surface).toMatchObject({
      id: "general:https://example.test/articles/clean-article",
      kind: "web-page",
      source: "general",
      canonicalUrl: "https://example.test/articles/clean-article",
      title: "Clean Article Fixture",
      authorName: "Example Reporter",
      sourceName: "Example Journal",
      publishedAt: "2026-06-01T09:00:00Z",
      mainText: expect.stringContaining("public planning meeting"),
      extraction: {
        method: "semantic-html",
        status: "complete",
        warnings: [],
      },
    });
    expect(surface.links).toEqual([
      {
        href: "https://example.test/sources/meeting-notes",
        text: "meeting notes",
      },
    ]);
    expect(surface.images).toEqual([
      {
        src: "https://example.test/images/street-plan.png",
        alt: "Illustration of a street plan",
        title: "Street plan",
      },
    ]);
  });

  it("prefers semantic main content over navigation and sidebar noise", () => {
    const surface = extractGeneralPageSurface({
      document: fixtureDocument("nav-sidebar-noise.html"),
      url: "https://example.test/blog/noise-fixture",
    });

    expect(surface.extraction.status).toBe("complete");
    expect(surface.mainText).toContain("small research team keeps notes useful");
    expect(surface.mainText).not.toContain("Home Products Pricing");
    expect(surface.mainText).not.toContain("Promotional sidebar");
    expect(surface.mainText).not.toContain("Privacy Terms Contact");
  });

  it("supports documentation-style pages with lists and application metadata", () => {
    const surface = extractGeneralPageSurface({
      document: fixtureDocument("documentation-page.html"),
      url: "https://docs.example.test/client/setup",
    });

    expect(surface).toMatchObject({
      title: "Documentation Fixture",
      sourceName: "Example Docs",
      extraction: {
        method: "semantic-html",
        status: "complete",
      },
    });
    expect(surface.mainText).toContain("Create a local configuration file");
    expect(surface.mainText).toContain("model endpoint that the user controls");
  });

  it("uses meaningful selected text as the primary surface and marks it partial", () => {
    const selectedText = "This selected paragraph asks Truly to analyze only one focused region from a longer synthetic page. It is intentionally long enough to pass the selection threshold and different enough from the article body to prove priority.";
    const surface = extractGeneralPageSurface({
      document: fixtureDocument("selected-text.html"),
      url: "https://example.test/articles/selection",
      selectedText,
    });

    expect(surface.mainText).toBe(selectedText);
    expect(surface.selectedText).toBe(selectedText);
    expect(surface.extraction).toEqual({
      method: "selection",
      status: "partial",
      warnings: ["selection-only"],
    });
  });

  it("does not pretend login or paywall-like content is a complete article", () => {
    const surface = extractGeneralPageSurface({
      document: fixtureDocument("blocked-like.html"),
      url: "https://example.test/private/story",
    });

    expect(surface.extraction.status).toBe("blocked");
    expect(surface.extraction.warnings).toContain("login-or-paywall-like");
    expect(surface.extraction.warnings).toContain("very-short-content");
  });

  it("marks discussion, social, and index pages as partial even when text is readable", () => {
    const cases = [
      {
        file: "forum-thread.html",
        url: "https://community.example.test/t/release-checklist",
      },
      {
        file: "public-social-feed.html",
        url: "https://social.example.test/@fixture/post/123",
      },
      {
        file: "category-list-page.html",
        url: "https://example.test/topics/research-index",
      },
      {
        file: "search-results-index.html",
        url: "https://example.test/search?q=synthetic-policy-notes",
      },
    ];

    for (const item of cases) {
      const surface = extractGeneralPageSurface({
        document: jsdomFixtureDocument(item.file, item.url),
        url: item.url,
      });

      expect(surface.mainText.length, item.file).toBeGreaterThan(0);
      expect(surface.extraction.status, item.file).toBe("partial");
      expect(surface.extraction.warnings, item.file).toContain("large-navigation-noise");
    }
  });

  it("marks dense homepage-like roots as partial without article metadata", () => {
    const links = Array.from({ length: 120 }, (_, index) =>
      `<a href="/story-${index}">Synthetic story ${index}</a>`,
    ).join("");
    const images = Array.from({ length: 30 }, (_, index) =>
      `<img src="/image-${index}.png" alt="Synthetic card ${index}">`,
    ).join("");
    const paragraphs = Array.from({ length: 18 }, (_, index) =>
      `<p>Dense homepage structural fixture paragraph ${index} describes a fake public update card with enough readable text to tempt complete extraction.</p>`,
    ).join("");
    const dom = new JSDOM(`
      <!doctype html>
      <html>
        <head><title>Dense Homepage Fixture</title></head>
        <body>
          <main>
            <h1>Top stories</h1>
            ${paragraphs}
            ${links}
            ${images}
          </main>
        </body>
      </html>
    `, { url: "https://news.example.test/" });

    const surface = extractGeneralPageSurface({
      document: dom.window.document,
      url: "https://news.example.test/",
    });

    expect(surface.extraction.status).toBe("partial");
    expect(surface.extraction.warnings).toContain("large-navigation-noise");
  });

  it("marks multi-card list pages as partial even with misleading article metadata", () => {
    const cards = Array.from({ length: 8 }, (_, index) => `
      <article>
        <h2>Fixture card ${index}</h2>
        <a href="/notice-${index}">Read synthetic notice ${index}</a>
        <img src="/notice-${index}.png" alt="Synthetic notice ${index}">
      </article>
    `).join("");
    const navLinks = Array.from({ length: 90 }, (_, index) =>
      `<a href="/archive-${index}">Archive link ${index}</a>`,
    ).join("");
    const dom = new JSDOM(`
      <!doctype html>
      <html>
        <head>
          <title>Official List Fixture</title>
          <meta property="article:published_time" content="2026-06-30T00:00:00Z">
        </head>
        <body>
          <main>
            <h1>Latest notices</h1>
            <p>This synthetic official list fixture should remain partial because it is a card index, not one complete article.</p>
            ${cards}
            ${navLinks}
          </main>
        </body>
      </html>
    `, { url: "https://official.example.test/news" });

    const surface = extractGeneralPageSurface({
      document: dom.window.document,
      url: "https://official.example.test/news",
    });

    expect(surface.extraction.status).toBe("partial");
    expect(surface.extraction.warnings).toContain("large-navigation-noise");
  });

  it("excludes non-reading node text from fallback extraction", () => {
    const html = fs.readFileSync(`${FIXTURE_DIR}/js-shell-bad-page.html`, "utf8");
    const dom = new JSDOM(html, { url: "https://example.test/app/shell" });
    const surface = extractGeneralPageSurface({
      document: dom.window.document,
      url: "https://example.test/app/shell",
    });

    expect(surface.mainText).toContain("application shell has not rendered readable article content");
    expect(surface.mainText).not.toContain("fictional article body should never appear");
    expect(surface.extraction).toMatchObject({
      method: "fallback",
      status: "partial",
    });
  });

  it("keeps Traditional Chinese page text intact", () => {
    const surface = extractGeneralPageSurface({
      document: fixtureDocument("zh-tw-article.html"),
      url: "https://example.test/zh-tw/article",
    });

    expect(surface).toMatchObject({
      title: "繁體中文文章範例",
      sourceName: "範例新聞",
      canonicalUrl: "https://example.test/zh-tw/article",
      extraction: {
        method: "semantic-html",
        status: "complete",
        warnings: [],
      },
    });
    expect(surface.mainText).toContain("這是一篇合成的繁體中文文章");
    expect(surface.mainText).toContain("不包含真實人物、真實帳號或私人網址");
  });

  it("keeps page reader message seams typed without runtime behavior", () => {
    const surface: ReadingSurface = extractGeneralPageSurface({
      document: fixtureDocument("clean-article.html"),
      url: "https://example.test/articles/clean-article",
    });
    const target: ReadingTarget = {
      id: "target:fixture",
      surfaceId: surface.id,
      kind: "paragraph",
      text: "Focused paragraph text.",
      extraction: {
        method: "observed-node",
        status: "complete",
        warnings: [],
      },
    };

    const messages: TrulyMessage[] = [
      { type: "PAGE_READING_REQUEST", tabId: 1 },
      { type: "PAGE_READING_RESULT", surface },
      { type: "READING_TARGET_REQUEST", tabId: 1, trigger: "hotkey" },
      { type: "READING_TARGET_RESULT", target },
    ];

    expect(messages.map((message) => message.type)).toEqual([
      "PAGE_READING_REQUEST",
      "PAGE_READING_RESULT",
      "READING_TARGET_REQUEST",
      "READING_TARGET_RESULT",
    ]);
  });
});
