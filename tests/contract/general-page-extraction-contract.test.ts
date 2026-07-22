import fs from "node:fs";
import { JSDOM } from "jsdom";
import { describe, expect, it } from "vitest";

import {
  extractGeneralPageCandidateElementText,
  extractGeneralPageSurface,
  isGeneralPageCandidateElementStructurallyEligible,
} from "@src/lib/general-page-extraction";
import { buildGeneralPageModelContext } from "@src/lib/general-page-model-context";
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
    return selector.split(",").flatMap((part) => querySelectorAll(html, part.trim()));
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

  it("keeps JSON-LD and related-link noise out of a synthetic news article preview", () => {
    const surface = extractGeneralPageSurface({
      document: jsdomFixtureDocument(
        "jsonld-leading-news-noise.html",
        "https://news.example.test/sports/synthetic-match-report",
      ),
      url: "https://news.example.test/sports/synthetic-match-report",
    });
    const modelContext = buildGeneralPageModelContext(surface);

    expect(surface.mainText).toContain("這則合成賽事新聞描述一場虛構的淘汰賽");
    expect(surface.mainText).toContain("傷停補時未能再創造明確機會");
    expect(surface.mainText).not.toContain("@context");
    expect(surface.mainText).not.toContain("登入後即可張貼留言");
    expect(surface.excerpt).not.toContain("@context");
    expect(modelContext.links).toEqual([
      {
        href: "https://news.example.test/sports/synthetic-match-report/source",
        text: "Article source",
      },
    ]);
  });

  it("prefers the article body over a larger ticker-heavy main root", () => {
    const surface = extractGeneralPageSurface({
      document: jsdomFixtureDocument(
        "ticker-prefix-news.html",
        "https://news.example.test/politics/public-data-source-update",
      ),
      url: "https://news.example.test/politics/public-data-source-update",
    });

    expect(surface.mainText).toContain("公共資料來源說明更新");
    expect(surface.mainText).toContain("避開新聞站台前方的即時 ticker");
    expect(surface.mainText).not.toContain("合成快訊一不屬於本文");
    expect(surface.mainText).not.toContain("即時 熱門 影音 直播");
    expect(surface.extraction.method).toBe("semantic-html");
  });

  it("keeps article paragraphs after an inline related-reading block", () => {
    const surface = extractGeneralPageSurface({
      document: jsdomFixtureDocument(
        "inline-recirc-mid-article.html",
        "https://news.example.test/weather/path-update",
      ),
      url: "https://news.example.test/weather/path-update",
    });

    expect(surface.mainText).toContain("第一段說明合成颱風資料");
    expect(surface.mainText).toContain("第二段在延伸閱讀之後繼續正文");
    expect(surface.mainText).toContain("第三段提醒讀者應以官方最新公告為準");
    expect(surface.mainText).not.toContain("合成相關報導一不應進入正文");
    expect(surface.extraction.method).toBe("semantic-html");
  });

  it("uses content-body class roots instead of a broad layout wrapper", () => {
    const surface = extractGeneralPageSurface({
      document: jsdomFixtureDocument(
        "broad-wrapper-news-body.html",
        "https://news.example.test/local/community-meeting",
      ),
      url: "https://news.example.test/local/community-meeting",
    });

    expect(surface.mainText).toContain("合成地方新聞的第一段描述社區會議");
    expect(surface.mainText).toContain("保留公開紀錄供居民查閱");
    expect(surface.mainText).not.toContain("首頁 即時 熱門");
    expect(surface.mainText).not.toContain("合成廣告區塊不應進入正文");
    expect(surface.extraction.method).toBe("fallback");
    expect(surface.extraction.warnings).toContain("no-main-content");
  });

  it("uses heading-anchored ancestors when article containers have generic classes", () => {
    const surface = extractGeneralPageSurface({
      document: jsdomFixtureDocument(
        "heading-anchored-news-body.html",
        "https://radio.example.test/news/public-intercept-briefing",
      ),
      url: "https://radio.example.test/news/public-intercept-briefing",
    });

    expect(surface.mainText).toContain("合成新聞事件的主要狀況");
    expect(surface.mainText).toContain("標題附近祖先節點取得正文");
    expect(surface.mainText).not.toContain("網站導覽");
    expect(surface.mainText).not.toContain("訂閱電子報");
    expect(surface.extraction.method).toBe("fallback");
  });

  it("does not select an unrelated semantic article card over the titled body", () => {
    const surface = extractGeneralPageSurface({
      document: jsdomFixtureDocument(
        "semantic-wrong-card-before-body.html",
        "https://news.example.test/local/vehicle-parking-review",
      ),
      url: "https://news.example.test/local/vehicle-parking-review",
    });

    expect(surface.mainText).toContain("公共車輛臨停爭議說明");
    expect(surface.mainText).toContain("警方檢視影像後確認違規態樣");
    expect(surface.mainText).not.toContain("合成推薦卡片不應被選為本文");
    expect(surface.mainText).not.toContain("合成遊戲廣告與促銷內容");
    expect(surface.mainText).not.toContain("另一則合成相關新聞描述完全不同");
  });

  it("extracts entry-content articles inside semantic main layouts", () => {
    const surface = extractGeneralPageSurface({
      document: jsdomFixtureDocument(
        "entry-content-main-article.html",
        "https://apps.example.test/free/countdown-tool",
      ),
      url: "https://apps.example.test/free/countdown-tool",
    });

    expect(surface.mainText).toContain("合成倒數工具可以追蹤假期");
    expect(surface.mainText).toContain("核心功能特色");
    expect(surface.mainText).toContain("限時免費領取終生版");
    expect(surface.mainText).not.toContain("合成熱門文章不應進入正文");
  });

  it("drops non-web URLs at the extraction normalization boundary", () => {
    const document = new JSDOM(
      `<!doctype html>
      <html>
        <head><title>Scheme Fixture</title></head>
        <body>
          <article>
            <h1>Scheme Fixture</h1>
            <p>This synthetic article contains enough body text to exercise link extraction without relying on a real website. The parser should keep normal web links and reject active or private schemes before downstream model-context filtering runs.</p>
            <p>A second paragraph makes the article root stable and keeps this fixture above the minimum content threshold used by extraction heuristics.</p>
            <a href="javascript:alert(1)">Unsafe script link</a>
            <a href="data:text/plain,hello">Unsafe data link</a>
            <a href="mailto:reporter@example.test">Email link</a>
            <a href="tel:+15550101">Phone link</a>
            <a href="/sources/public-report">Public report</a>
            <img src="data:image/svg+xml;base64,PHN2Zy8+" alt="Inline image">
            <img src="/images/public-chart.png" alt="Public chart">
          </article>
        </body>
      </html>`,
      { url: "https://example.test/articles/scheme-fixture" },
    ).window.document;

    const surface = extractGeneralPageSurface({
      document,
      url: "https://example.test/articles/scheme-fixture",
    });

    expect(surface.links).toEqual([
      {
        href: "https://example.test/sources/public-report",
        text: "Public report",
      },
    ]);
    expect(surface.images).toEqual([
      {
        src: "https://example.test/images/public-chart.png",
        alt: "Public chart",
        title: undefined,
      },
    ]);
  });

  it("uses accessible link labels when anchor text is empty", () => {
    const document = new JSDOM(
      `<!doctype html>
      <html>
        <head><title>Accessible Link Fixture</title></head>
        <body>
          <article>
            <h1>Accessible Link Fixture</h1>
            <p>This synthetic article body is intentionally long enough for extraction and includes an icon-only source link. The parser should preserve the accessible label so downstream source context does not show a bare URL.</p>
            <p>A second paragraph keeps the body stable while remaining public-safe and unrelated to any real website.</p>
            <a href="/source/accessibility" aria-label="Accessible source note"><svg></svg></a>
          </article>
        </body>
      </html>`,
      { url: "https://example.test/articles/accessible-link-fixture" },
    ).window.document;

    const surface = extractGeneralPageSurface({
      document,
      url: "https://example.test/articles/accessible-link-fixture",
    });

    expect(surface.links).toContainEqual({
      href: "https://example.test/source/accessibility",
      text: "Accessible source note",
    });
  });

  it("resolves relative canonical URLs against the current page URL", () => {
    const document = new JSDOM(`
      <!doctype html>
      <html>
        <head>
          <title>Relative Canonical Fixture</title>
          <link rel="canonical" href="/articles/relative-canonical">
        </head>
        <body>
          <article>
            <h1>Relative Canonical Fixture</h1>
            <p>This synthetic article has enough text to exercise URL normalization while avoiding any real source content or private data.</p>
            <p>It confirms that copied metadata and stale page identity use an absolute canonical URL instead of a relative path.</p>
          </article>
        </body>
      </html>
    `, { url: "https://example.test/articles/relative-canonical?utm_source=fixture" }).window.document;

    const surface = extractGeneralPageSurface({
      document,
      url: "https://example.test/articles/relative-canonical?utm_source=fixture",
      selectedText: "This selected paragraph is intentionally long enough to force a stable surface while the assertion focuses on canonical URL resolution and copied metadata identity.",
    });

    expect(surface.canonicalUrl).toBe("https://example.test/articles/relative-canonical");
    expect(surface.id).toBe("general:https://example.test/articles/relative-canonical");
  });

  it("preserves readable spacing between adjacent block elements", () => {
    const document = new JSDOM(`
      <!doctype html>
      <html>
        <head><title>Spacing Fixture</title></head>
        <body>
          <article><h1>Spacing Fixture</h1><p>By Synthetic Author</p><p>This synthetic paragraph should not be glued to the byline when textContent is normalized.</p><p>The second paragraph keeps the article long enough for semantic extraction.</p></article>
        </body>
      </html>
    `, { url: "https://example.test/articles/spacing" }).window.document;

    const surface = extractGeneralPageSurface({
      document,
      url: "https://example.test/articles/spacing",
    });

    expect(surface.mainText).toContain("Spacing Fixture By Synthetic Author This synthetic paragraph");
    expect(surface.mainText).not.toContain("FixtureBy");
    expect(surface.mainText).not.toContain("AuthorThis");
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

  it("blocks unavailable error pages instead of summarizing their shell", () => {
    const url = "https://tw.yahoo.test/?err=404&err_url=https%3A%2F%2Ftw.news.yahoo.test%2Fmissing";
    const documentRef = new JSDOM(`<!doctype html>
      <html><head><title>Yahoo</title></head><body><main>
        <p>嗯....驚！您要找的頁面已不存在，請嘗試搜尋看看。</p>
        <h2>焦點新聞</h2>
      </main></body></html>`, { url }).window.document;

    const surface = extractGeneralPageSurface({ document: documentRef, url });

    expect(surface.extraction.status).toBe("blocked");
    expect(surface.extraction.warnings).toContain("unavailable-page");
    expect(buildGeneralPageModelContext(surface)).toMatchObject({
      modelEligible: false,
      modelReadiness: "blocked",
      ineligibilityReason: "empty_or_blocked",
    });
  });

  it("removes article control labels without trimming prose that follows them", () => {
    const url = "https://reference.example.test/articles/control-labels";
    const documentRef = new JSDOM(`<!doctype html>
      <html><head><title>Reference article</title></head><body><main><article>
        <h1>Reference article</h1>
        <div class="switcher-container"><label>Show map of the current territory</label></div>
        <p>This synthetic article paragraph contains enough grounded prose to remain part of the reading body after interface labels are removed. It describes one source, one event, and one outcome in complete sentences.</p>
        <p>End of content</p>
        <p>暫無留言</p>
        <p>A second substantive paragraph follows the visual marker and must remain available to the reader because the marker is not a true article boundary.</p>
      </article></main></body></html>`, { url }).window.document;

    const surface = extractGeneralPageSurface({ document: documentRef, url });

    expect(surface.mainText).not.toContain("Show map");
    expect(surface.mainText).not.toContain("End of content");
    expect(surface.mainText).not.toContain("暫無留言");
    expect(surface.mainText).toContain("A second substantive paragraph follows");
  });

  it("does not treat a normal newsletter CTA as a paywall", () => {
    const surface = extractGeneralPageSurface({
      document: jsdomFixtureDocument(
        "newsletter-capture-blog.html",
        "https://personal.example.test/posts/newsletter-capture",
      ),
      url: "https://personal.example.test/posts/newsletter-capture",
    });

    expect(surface.extraction.status).toBe("complete");
    expect(surface.extraction.warnings).not.toContain("login-or-paywall-like");
    expect(surface.mainText).toContain("newsletter capture blog fixture contains a synthetic essay");
  });

  it("keeps rich media articles complete despite dense links and images", () => {
    const surface = extractGeneralPageSurface({
      document: jsdomFixtureDocument(
        "media-first-card.html",
        "https://example.test/media/synthetic-card",
      ),
      url: "https://example.test/media/synthetic-card",
    });

    expect(surface.extraction.status).toBe("complete");
    expect(surface.extraction.warnings).not.toContain("large-navigation-noise");
    expect(surface.mainText).toContain("synthetic gallery belongs to the article body");
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

  it("strips breaking-ticker and audio-player boilerplate before the article body", () => {
    const surface = extractGeneralPageSurface({
      document: jsdomFixtureDocument(
        "ticker-lead-article.html",
        "https://portal.example.test/news/story/ticker-lead-article",
      ),
      url: "https://portal.example.test/news/story/ticker-lead-article",
    });

    expect(surface.extraction.status).toBe("complete");
    expect(surface.mainText).toContain("虛構水利計畫已完成前期規劃");
    expect(surface.mainText).toContain("滯洪池整建與排水幹線更新");
    expect(surface.mainText).not.toContain("候選人甲自行宣布當選");
    expect(surface.mainText).not.toContain("Your browser does not support HTML5 Audio");
    expect(surface.mainText).not.toContain("聽新聞 0:00 / 0:00");
  });

  it("removes high-confidence utility modules embedded in a semantic news article", () => {
    const dom = new JSDOM(`
      <!doctype html>
      <title>虛構公共建設計畫完成審查</title>
      <article class="article">
        <div class="jsBlueBlock TemasBlock">新聞專題 1/33</div>
        <h1>虛構公共建設計畫完成審查</h1>
        <div class="timeBox">2026/7/22 08:00</div>
        <div class="btnGroup"><div class="hiddenCont">請同意我們的隱私權規範，才能啟用聽新聞的功能。</div></div>
        <figure><figcaption>虛構工程示意圖，由測試單位提供。</figcaption></figure>
        <div class="paragraph">
          <p>虛構審查委員會完成公共建設計畫的初步審查，並要求主辦單位公開預算與施工期程。</p>
          <p>主辦單位表示，第一階段將整理交通影響資料，第二階段則會公布環境監測方法與更新頻率。</p>
          <p>這些合成正文提供足夠的連續文章內容，用來確認 utility 模組不會進入最終閱讀脈絡。</p>
        </div>
        <div class="gmailNews"><a href="/follow">透過 Google News 追蹤測試新聞</a></div>
        <div class="articlekeywordGroup">#虛構計畫 #公共建設</div>
        <div class="paragraph moreArticle"><a href="/other">另一篇不相關的合成報導</a></div>
        <div class="paragraph appDownload">支持測試媒體 下載測試 APP 本網站內容未經授權不得轉載</div>
        <div class="jsNextLine nextline"><div>請繼續下滑閱讀</div><a href="/next">下一篇不相關報導</a></div>
      </article>
    `, { url: "https://news.example.test/story/utility-modules" });

    const surface = extractGeneralPageSurface({
      document: dom.window.document,
      url: dom.window.location.href,
    });

    expect(surface.mainText).toContain("虛構審查委員會完成公共建設計畫");
    expect(surface.mainText).toContain("虛構工程示意圖");
    expect(surface.mainText).not.toContain("新聞專題 1/33");
    expect(surface.mainText).not.toContain("請同意我們的隱私權規範");
    expect(surface.mainText).not.toContain("Google News");
    expect(surface.mainText).not.toContain("#虛構計畫");
    expect(surface.mainText).not.toContain("另一篇不相關");
    expect(surface.mainText).not.toContain("下載測試 APP");
    expect(surface.mainText).not.toContain("請繼續下滑閱讀");
  });

  it("keeps prose that merely discusses utility-like terms", () => {
    const dom = new JSDOM(`
      <!doctype html>
      <title>Utility wording in genuine prose</title>
      <article>
        <h1>Utility wording in genuine prose</h1>
        <p>The report explains why a publisher chose Google News as one distribution channel for its public-interest journalism.</p>
        <p>It also discusses app downloads, copyright notices, consent design, and related articles as subjects of the research.</p>
        <p>The conclusion asks readers to keep exploring how these interface choices affect access to reliable information.</p>
        <p>This final paragraph keeps the synthetic article comfortably above the minimum complete-reading threshold.</p>
      </article>
    `, { url: "https://research.example.test/utility-language" });

    const surface = extractGeneralPageSurface({
      document: dom.window.document,
      url: dom.window.location.href,
    });

    expect(surface.mainText).toContain("Google News");
    expect(surface.mainText).toContain("app downloads, copyright notices, consent design");
    expect(surface.mainText).toContain("keep exploring how these interface choices");
  });

  it("removes a compact three-card cross-topic resource cluster from a reading body", () => {
    const dom = new JSDOM(`
      <!doctype html>
      <title>Synthetic healthy growth guidance</title>
      <main>
        <h1>Synthetic healthy growth guidance</h1>
        <div class="reading-body-neutral">
          <section>
            <h2>Why it matters</h2>
            <p>The guidance explains how regular meals, physical activity, and sleep can support healthy growth.</p>
            <p>A second paragraph gives public-safe advice about maintaining routines over time.</p>
            <p>A final paragraph closes the effective guidance before a separate resource-card cluster begins.</p>
          </section>
          <section class="section-neutral">
            <h2>Adopt healthy habits</h2>
            <div class="links-neutral">
              <div><a href="/immunity">Synthetic immunity guide</a><div>Separate vaccination advice belongs to another topic.</div></div>
              <div><a href="/travel">Synthetic holiday travel guide</a><div>Separate travel advice belongs to another topic.</div></div>
              <div><a href="/celebrations">Synthetic celebration guide</a><div>Separate holiday advice belongs to another topic.</div></div>
            </div>
          </section>
        </div>
      </main>
    `, { url: "https://health.example.test/healthy-growth" });

    const surface = extractGeneralPageSurface({
      document: dom.window.document,
      url: dom.window.location.href,
    });

    expect(surface.mainText).toContain("regular meals, physical activity, and sleep");
    expect(surface.mainText).not.toContain("Adopt healthy habits");
    expect(surface.mainText).not.toContain("Separate vaccination advice");
    expect(surface.mainText).not.toContain("Separate travel advice");
    expect(surface.mainText).not.toContain("Separate holiday advice");
  });

  it("removes maintenance and retrieval wrappers without deleting article prose", () => {
    const dom = new JSDOM(`
      <!doctype html>
      <title>Synthetic reference article</title>
      <article>
        <h1>Synthetic reference article</h1>
        <table class="ambox"><tbody><tr><td>This article needs additional citations.</td></tr></tbody></table>
        <p>The first synthetic paragraph defines a fictional archival method and identifies its intended research use.</p>
        <p>The second paragraph records a made-up publication date and describes how readers can compare source provenance.</p>
        <p>The third paragraph provides enough continuous prose to represent the effective article context.</p>
        <div class="printfooter">Retrieved from ""</div>
        <div id="catlinks">Hidden categories:</div>
      </article>
    `, { url: "https://reference.example.test/synthetic-method" });

    const surface = extractGeneralPageSurface({
      document: dom.window.document,
      url: dom.window.location.href,
    });

    expect(surface.mainText).toContain("fictional archival method");
    expect(surface.mainText).not.toContain("needs additional citations");
    expect(surface.mainText).not.toContain("Retrieved from");
    expect(surface.mainText).not.toContain("Hidden categories");
  });

  it("uses existing structural safeguards when pruning an exploration tail", () => {
    const dom = new JSDOM(`
      <!doctype html>
      <title>Synthetic science feature</title>
      <article>
        <h1>Synthetic science feature</h1>
        <p>The feature introduces a fictional observatory and explains the instruments used during its first survey.</p>
        <p>A second paragraph describes the made-up measurements and the limits reported by the research team.</p>
        <p>A third paragraph closes the main finding before an unrelated discovery module begins.</p>
        <div>Keep Exploring</div>
        <div class="discovery-card"><a href="/other-topic">An unrelated synthetic topic card</a></div>
        <h2>Discover More Topics From Example Science</h2>
      </article>
    `, { url: "https://science.example.test/features/synthetic-observatory" });

    const surface = extractGeneralPageSurface({
      document: dom.window.document,
      url: dom.window.location.href,
    });

    expect(surface.mainText).toContain("third paragraph closes the main finding");
    expect(surface.mainText).not.toContain("Keep Exploring");
    expect(surface.mainText).not.toContain("unrelated synthetic topic card");
    expect(surface.mainText).not.toContain("Discover More Topics");
  });

  it("removes an embedded automated news module without treating news prose as utility text", () => {
    const dom = new JSDOM(`
      <!doctype html>
      <title>Synthetic black-hole feature</title>
      <article>
        <h1>Synthetic black-hole feature</h1>
        <p>The first paragraph explains a fictional observation and notes that science news may provide useful context.</p>
        <p>The second paragraph describes the made-up measurements and the limitations reported by the research team.</p>
        <p>The final paragraph closes the feature before the publisher's automated discovery module.</p>
        <div class="nasa-gb-align-full wp-block-nasa-blocks-news-automated">
          <h2>Black Hole News</h2>
          <a href="/unrelated-story">Explore All Black Hole News</a>
        </div>
      </article>
    `, { url: "https://science.example.test/features/synthetic-black-holes" });

    const surface = extractGeneralPageSurface({
      document: dom.window.document,
      url: dom.window.location.href,
    });

    expect(surface.mainText).toContain("science news may provide useful context");
    expect(surface.mainText).toContain("final paragraph closes the feature");
    expect(surface.mainText).not.toContain("Black Hole News");
    expect(surface.mainText).not.toContain("Explore All");
  });

  it("downgrades article roots dominated by utility links and controls", () => {
    const surface = extractGeneralPageSurface({
      document: jsdomFixtureDocument(
        "article-root-utility-dense-ready-trap.html",
        "https://wire.example.test/news/utility-dense-ready-trap",
      ),
      url: "https://wire.example.test/news/utility-dense-ready-trap",
    });

    expect(surface.extraction.method).toBe("semantic-html");
    expect(surface.extraction.status).toBe("partial");
    expect(surface.extraction.warnings).toContain("large-navigation-noise");
    expect(surface.mainText).toContain("article root utility dense ready trap fixture");
    expect(surface.mainText).toContain("fictional transit committee reviewed station access plans");
    expect(surface.mainText).not.toContain("Synthetic market update 08:10");
    expect(surface.mainText).not.toContain("Search this site");
  });

  it("removes hidden language and interface wrappers inside a semantic article root", () => {
    const dom = new JSDOM(`
      <!doctype html>
      <title>Hidden language wrapper fixture</title>
      <article>
        <div aria-hidden="true" class="language-switcher-neutral">
          <a href="/en">English hidden option</a>
          <a href="/fr">Français hidden option</a>
          <a href="/ja">日本語 hidden option</a>
        </div>
        <div style="display: none">
          Hidden interface text must not enter the authorized reading context.
        </div>
        <h1>Hidden language wrapper fixture</h1>
        <p>The first synthetic paragraph describes a fictional civic archive and its publication schedule.</p>
        <p>The second synthetic paragraph records a made-up review date and a public-safe document label.</p>
        <p>The third synthetic paragraph keeps the article body long enough for a complete reading context.</p>
      </article>
    `, { url: "https://docs.example.test/hidden-language-wrapper" });

    const surface = extractGeneralPageSurface({
      document: dom.window.document,
      url: dom.window.location.href,
    });

    expect(surface.mainText).toContain("fictional civic archive");
    expect(surface.mainText).not.toContain("English hidden option");
    expect(surface.mainText).not.toContain("Hidden interface text");
  });

  it("removes a long structurally repeated recirculation tail without a site-specific label", () => {
    const relatedCards = Array.from({ length: 8 }, (_, index) => `
      <article>
        <a href="/network/${index + 1}">
          <h2>Unrelated synthetic network headline ${index + 1}</h2>
          <p>This long fictional teaser belongs to a different story and exists only to make the neutral tail exceed the old utility length ceiling.</p>
        </a>
      </article>
    `).join("");
    const dom = new JSDOM(`
      <!doctype html>
      <title>Primary synthetic report</title>
      <article>
        <h1>Primary synthetic report</h1>
        <div class="copy-neutral">
          <p>The primary report explains a fictional bridge inspection performed by a made-up municipal team.</p>
          <p>Inspectors recorded an invented completion date and published a public-safe summary for local readers.</p>
          <p>A final paragraph closes the same report before a structurally separate network module begins.</p>
        </div>
        <section class="module-neutral">${relatedCards}</section>
      </article>
    `, { url: "https://news.example.test/primary-report" });

    const surface = extractGeneralPageSurface({
      document: dom.window.document,
      url: dom.window.location.href,
    });

    expect(surface.mainText).toContain("fictional bridge inspection");
    expect(surface.mainText).not.toContain("Unrelated synthetic network headline");
    expect(surface.mainText).not.toContain("different story");
  });

  it("does not promote a recommendation stream over a short semantic article", () => {
    const recommendationCards = Array.from({ length: 6 }, (_, index) => `
      <section>
        <a href="/recommended/${index + 1}">
          <h2>Unrelated synthetic story ${index + 1}</h2>
          <p>This separate fictional story has enough prose to look article-like when the whole stream is scored.</p>
        </a>
      </section>
    `).join("");
    const dom = new JSDOM(`
      <!doctype html>
      <title>Unrelated synthetic story 1</title>
      <article id="article-primary">
        <h1>Short primary bulletin</h1>
        <p>The primary bulletin is intentionally short but remains the only semantic article on this page.</p>
      </article>
      <div id="recommended-article-stream">${recommendationCards}</div>
    `, { url: "https://news.example.test/short-primary" });

    const surface = extractGeneralPageSurface({
      document: dom.window.document,
      url: dom.window.location.href,
    });

    expect(surface.extraction.method).toBe("semantic-html");
    expect(surface.mainText).toContain("only semantic article");
    expect(surface.mainText).not.toContain("Unrelated synthetic story");
  });

  it("removes compact standalone action links without stripping inline source links", () => {
    const dom = new JSDOM(`
      <!doctype html>
      <title>Standalone utility link fixture</title>
      <article>
        <h1>Standalone utility link fixture</h1>
        <p>The first paragraph describes a fictional safety review and links to <a href="/source">the public source record</a>.</p>
        <div class="neutral-action"><a href="/join">Join the publisher community for daily updates</a></div>
        <div class="neutral-player"><button type="button">Play</button><span>Current Time Duration</span></div>
        <p>The second paragraph records a made-up inspection date and keeps the same report moving forward.</p>
        <p>The third paragraph closes the fictional report with a clear and complete outcome.</p>
        <div class="neutral-next"><a href="/next-story">Unrelated synthetic celebrity headline</a></div>
        <a href="/direct-next-story">Another unrelated standalone headline</a>
      </article>
    `, { url: "https://news.example.test/standalone-utility-link" });

    const surface = extractGeneralPageSurface({
      document: dom.window.document,
      url: dom.window.location.href,
    });

    expect(surface.mainText).toContain("the public source record");
    expect(surface.mainText).not.toContain("Join the publisher community");
    expect(surface.mainText).not.toContain("Current Time Duration");
    expect(surface.mainText).not.toContain("Unrelated synthetic celebrity headline");
    expect(surface.mainText).not.toContain("Another unrelated standalone headline");
  });

  it("marks generic source-rendering failures as dynamic partial content", () => {
    const dom = new JSDOM(`
      <!doctype html>
      <title>Research portal</title>
      <main>
        <p>Unable to render the provided source</p>
        <p>This landing page lists several unrelated fictional research products and recent updates.</p>
        <p>Another directory description keeps the shell long enough to pass the minimum text threshold.</p>
        <p>A final navigation description confirms that no single complete article was rendered.</p>
      </main>
    `, { url: "https://science.example.test/research-portal" });

    const surface = extractGeneralPageSurface({
      document: dom.window.document,
      url: dom.window.location.href,
    });

    expect(surface.extraction.status).toBe("partial");
    expect(surface.extraction.warnings).toContain("dynamic-content-partial");
  });

  it("stops article text before a generic hot-topic or reference directory", () => {
    const dom = new JSDOM(`
      <!doctype html>
      <title>Tail directory boundary fixture</title>
      <article>
        <h1>Tail directory boundary fixture</h1>
        <p>The first paragraph describes a fictional public hearing and its published agenda.</p>
        <p>The second paragraph records a made-up decision and keeps the same report coherent.</p>
        <p>The third paragraph closes the report before a separate directory begins.</p>
        <h5>熱門話題</h5>
        <ul>
          <li><a href="/other-one">Unrelated synthetic market headline</a></li>
          <li><a href="/other-two">Unrelated synthetic celebrity headline</a></li>
        </ul>
        <h2>References <a href="#edit">edit</a></h2>
        <div class="reflist">
          <p>Reference publication one contains a long synthetic citation description without article prose.</p>
          <p>Reference publication two contains another long synthetic citation description for the directory.</p>
        </div>
      </article>
    `, { url: "https://news.example.test/tail-directory-boundary" });

    const surface = extractGeneralPageSurface({
      document: dom.window.document,
      url: dom.window.location.href,
    });

    expect(surface.mainText).toContain("third paragraph closes the report");
    expect(surface.mainText).not.toContain("熱門話題");
    expect(surface.mainText).not.toContain("Unrelated synthetic market headline");
    expect(surface.mainText).not.toContain("References");
    expect(surface.mainText).not.toContain("Reference publication one");
  });

  it("lifts nested recirculation labels to their compact tail container", () => {
    const dom = new JSDOM(`
      <!doctype html>
      <title>Nested tail boundary fixture</title>
      <article>
        <h1>Nested tail boundary fixture</h1>
        <p>The first paragraph describes a fictional agency announcement and its public date.</p>
        <p>The second paragraph records the stated reason and preserves enough coherent article prose.</p>
        <p>The third paragraph closes the report before publisher navigation begins.</p>
        <div class="hot-topic-module">
          <div>【全球熱話題】</div>
          <a href="/unrelated-one">Unrelated synthetic market headline</a>
          <a href="/unrelated-two">Unrelated synthetic celebrity headline</a>
        </div>
        <section class="author-card"><p>Synthetic author biography outside the report.</p></section>
      </article>
    `, { url: "https://news.example.test/nested-tail-boundary" });

    const surface = extractGeneralPageSurface({
      document: dom.window.document,
      url: dom.window.location.href,
    });

    expect(surface.mainText).toContain("third paragraph closes the report");
    expect(surface.mainText).not.toContain("全球熱話題");
    expect(surface.mainText).not.toContain("Unrelated synthetic market headline");
    expect(surface.mainText).not.toContain("Synthetic author biography");
  });

  it("prefers a useful short semantic article over a larger discussion wrapper", () => {
    const dom = new JSDOM(`
      <!doctype html>
      <title>Short report inside noisy wrapper</title>
      <section class="article-content__wrapper">
        <article class="article-content">
          <p>A fictional agency published a short notice with a date and named location.</p>
          <p>It explains the temporary change and gives one coherent reason.</p>
          <p>The final sentence closes the report before the discussion board.</p>
        </article>
        <section class="discuss-board">
          <p>Discussion rules require every participant to follow the community terms and avoid unrelated claims.</p>
          <p>Moderators may remove posts, suspend accounts, and reject labels that do not follow the rules.</p>
          <p>Additional repeated policy text makes this wrapper longer than the actual short report.</p>
          <p>Another repeated moderation paragraph must never replace the semantic article body.</p>
        </section>
      </section>
    `, { url: "https://news.example.test/short-report" });

    const surface = extractGeneralPageSurface({
      document: dom.window.document,
      url: dom.window.location.href,
    });

    expect(surface.mainText).toContain("fictional agency published a short notice");
    expect(surface.mainText).not.toContain("Discussion rules require");
    expect(surface.extraction.method).toBe("semantic-html");
    expect(surface.extraction.warnings).toContain("very-short-content");
    const wrapper = dom.window.document.querySelector(".article-content__wrapper");
    const article = dom.window.document.querySelector("article");
    expect(wrapper).not.toBeNull();
    expect(article).not.toBeNull();
    expect(isGeneralPageCandidateElementStructurallyEligible(wrapper!)).toBe(false);
    expect(isGeneralPageCandidateElementStructurallyEligible(article!)).toBe(true);
  });

  it("stops before a source or tag footer instead of retaining its siblings", () => {
    const dom = new JSDOM(`
      <!doctype html>
      <title>Source footer boundary fixture</title>
      <article>
        <h1>Source footer boundary fixture</h1>
        <p>The first paragraph describes a fictional cultural event and its announced schedule.</p>
        <p>The second paragraph quotes a made-up organizer and closes the coherent report.</p>
        <p>The third paragraph provides enough prose for a stable article extraction result.</p>
        <div class="article-source">文章來源：</div>
        <div class="article-tags"><a href="/tag-one"># synthetic tag</a></div>
        <section class="next-story"><a href="/next">Unrelated next article</a></section>
      </article>
    `, { url: "https://news.example.test/source-footer-boundary" });

    const surface = extractGeneralPageSurface({
      document: dom.window.document,
      url: dom.window.location.href,
    });

    expect(surface.mainText).toContain("third paragraph provides enough prose");
    expect(surface.mainText).not.toContain("文章來源");
    expect(surface.mainText).not.toContain("synthetic tag");
    expect(surface.mainText).not.toContain("Unrelated next article");
  });

  it("does not mistake prose-like bibliography entries for article paragraphs", () => {
    const dom = new JSDOM(`
      <!doctype html>
      <title>Bibliography boundary fixture</title>
      <article>
        <h1>Bibliography boundary fixture</h1>
        <p>The first paragraph describes a fictional technical standard and its publication date.</p>
        <p>The second paragraph explains the stated compatibility change in coherent article prose.</p>
        <p>The final paragraph closes the article before its reference directory.</p>
        <h2>References <a href="#edit">edit</a></h2>
        <div class="reflist">
          <p>Reference publication one contains a long synthetic citation description without article prose.</p>
          <p>Reference publication two contains another long synthetic citation description for the directory.</p>
        </div>
        <h2>External links</h2>
        <p>A synthetic extension documentation link and a project archive listing.</p>
      </article>
    `, { url: "https://docs.example.test/bibliography-boundary" });

    const surface = extractGeneralPageSurface({
      document: dom.window.document,
      url: dom.window.location.href,
    });

    expect(surface.mainText).toContain("final paragraph closes the article");
    expect(surface.mainText).not.toContain("Reference publication one");
    expect(surface.mainText).not.toContain("External links");
    expect(surface.mainText).not.toContain("extension documentation link");
  });

  it("removes inline continue-reading and app-prize controls from article prose", () => {
    const dom = new JSDOM(`
      <!doctype html>
      <title>Inline controls fixture</title>
      <article>
        <h1>Inline controls fixture</h1>
        <p>The first paragraph describes a fictional public meeting and its announced agenda.</p>
        <p class="before_ir">請繼續往下閱讀...</p>
        <p>The second paragraph records the made-up decision after the inline control.</p>
        <p>The final paragraph closes the coherent report before publisher promotions.</p>
        <p class="appE1121">不用抽 不用搶 現在用APP看新聞 保證天天中獎 按我看活動辦法</p>
      </article>
    `, { url: "https://news.example.test/inline-controls" });

    const surface = extractGeneralPageSurface({
      document: dom.window.document,
      url: dom.window.location.href,
    });

    expect(surface.mainText).toContain("second paragraph records the made-up decision");
    expect(surface.mainText).not.toContain("請繼續往下閱讀");
    expect(surface.mainText).not.toContain("不用抽");
    expect(surface.mainText).not.toContain("天天中獎");
  });

  it("marks an explicitly incomplete full-text preview as gated", () => {
    const dom = new JSDOM(`
      <!doctype html>
      <title>Incomplete preview fixture</title>
      <article>
        <h1>Incomplete preview fixture</h1>
        <p>The first paragraph contains a fictional report preview and a public-safe date.</p>
        <p>The second paragraph ends before the report reaches its stated conclusion.</p>
        <p>The preview still contains enough article prose to summarize cautiously while preserving the explicit incomplete-content warning.</p>
        <p>It names the fictional institution, describes the announced change, and explains why readers may want to inspect the complete issue.</p>
        <p>全文未完，全文及圖表請見當期完整內容。</p>
      </article>
    `, { url: "https://magazine.example.test/incomplete-preview" });

    const surface = extractGeneralPageSurface({
      document: dom.window.document,
      url: dom.window.location.href,
    });

    expect(surface.extraction.status).toBe("partial");
    expect(surface.extraction.warnings).toContain("truncated-content-preview");
    expect(surface.extraction.warnings).not.toContain("login-or-paywall-like");
    expect(surface.mainText).not.toContain("全文未完");
    expect(surface.mainText).not.toContain("全文及圖表請見");
  });

  it("applies final tail cleanup to parser-advisor candidate text", () => {
    const dom = new JSDOM(`
      <!doctype html>
      <article>
        <p>A synthetic candidate contains enough coherent prose before a publication preview boundary.</p>
        <p>The second paragraph is part of the visible report and should remain available.</p>
        <p>The third paragraph closes the visible excerpt.（全文未完） 全文及圖表請見完整內容。</p>
        <div>Retrieved from ""</div>
      </article>
    `, { url: "https://news.example.test/candidate-tail-cleanup" });

    const article = dom.window.document.querySelector("article");
    expect(article).not.toBeNull();
    const text = extractGeneralPageCandidateElementText(article!);

    expect(text).toContain("third paragraph closes the visible excerpt");
    expect(text).not.toContain("全文未完");
    expect(text).not.toContain("全文及圖表請見");
    expect(text).not.toContain("Retrieved from");
  });

  it("selects app-shell entity body modules over visual lead cards", () => {
    const surface = extractGeneralPageSurface({
      document: jsdomFixtureDocument(
        "app-shell-entity-body-article.html",
        "https://social-news.example.test/tw/v3/article/synthetic",
      ),
      url: "https://social-news.example.test/tw/v3/article/synthetic",
    });

    expect(surface.extraction.method).toBe("semantic-html");
    expect(surface.extraction.status).toBe("complete");
    expect(surface.extraction.warnings).toEqual([]);
    expect(surface.mainText).toContain("工作室針對網路傳聞發布簡短回應");
    expect(surface.mainText).not.toContain("廣告（請繼續閱讀本文）");
    expect(surface.mainText).not.toContain("更多娛樂相關文章");
  });

  it("selects legacy detail containers inside heavy navigation layouts", () => {
    const surface = extractGeneralPageSurface({
      document: jsdomFixtureDocument(
        "legacy-news-detail-with-heavy-nav.html",
        "https://finance.example.test/r/news/detail_synthetic.djhtm",
      ),
      url: "https://finance.example.test/r/news/detail_synthetic.djhtm",
    });

    expect(surface.extraction.method).toBe("fallback");
    expect(surface.extraction.status).toBe("complete");
    expect(surface.extraction.warnings).toEqual([]);
    expect(surface.mainText).toContain("期貨因假期休市");
    expect(surface.mainText).toContain("舊式新聞詳情容器中的正文");
    expect(surface.mainText).not.toContain("國內匯市首頁");
    expect(surface.mainText).not.toContain("財經知識庫");
  });

  it("downgrades multi-article teaser hubs instead of accepting one teaser as an article", () => {
    const surface = extractGeneralPageSurface({
      document: jsdomFixtureDocument(
        "multi-article-teaser-hub.html",
        "https://daily.example.test/briefs/teaser-hub",
      ),
      url: "https://daily.example.test/briefs/teaser-hub",
    });

    expect(surface.extraction.method).toBe("semantic-html");
    expect(surface.extraction.status).toBe("partial");
    expect(surface.extraction.warnings).toContain("large-navigation-noise");
    expect(surface.mainText).toContain("multi article teaser hub fixture");
    expect(surface.mainText).toContain("short cards that describe fictional civic notices");
    expect(surface.mainText).not.toContain("Member Area");
    expect(surface.mainText).not.toContain("Newsletter");
  });

  it("marks dated report-list hubs as partial instead of ready articles", () => {
    const surface = extractGeneralPageSurface({
      document: jsdomFixtureDocument(
        "dated-list-hub-ready-trap.html",
        "https://agency.example.test/field-reports",
      ),
      url: "https://agency.example.test/field-reports",
    });

    expect(surface.extraction.status).toBe("partial");
    expect(surface.extraction.warnings).toContain("large-navigation-noise");
    expect(surface.mainText).toContain("latest synthetic field reports provide fictional updates");
  });

  it("marks short member-zone teasers as partial with a paywall warning", () => {
    const surface = extractGeneralPageSurface({
      document: jsdomFixtureDocument(
        "member-teaser-short.html",
        "https://technews.example.test/analysis/member-teaser-short",
      ),
      url: "https://technews.example.test/analysis/member-teaser-short",
    });

    expect(surface.extraction.status).toBe("partial");
    expect(surface.extraction.warnings).toContain("login-or-paywall-like");
    expect(surface.mainText).toContain("虛構的電池材料量產計畫");
  });

  it("marks JavaScript instruction pages as dynamic partial content", () => {
    const surface = extractGeneralPageSurface({
      document: jsdomFixtureDocument(
        "javascript-disabled-instruction.html",
        "https://app.example.test/search",
      ),
      url: "https://app.example.test/search",
    });

    expect(surface.extraction.status).toBe("partial");
    expect(surface.extraction.warnings).toContain("dynamic-content-partial");
    expect(surface.mainText).toContain("Enable JavaScript to continue");
  });

  it("marks access-checking preview pages as paywall-like partial content", () => {
    const surface = extractGeneralPageSurface({
      document: jsdomFixtureDocument(
        "access-checking-preview.html",
        "https://news.example.test/member/access-preview",
      ),
      url: "https://news.example.test/member/access-preview",
    });

    expect(surface.extraction.status).toBe("partial");
    expect(surface.extraction.warnings).toContain("login-or-paywall-like");
    expect(surface.mainText).toContain("preview view while checking access");
  });

  it("marks gated continue-reading previews as paywall-like partial content", () => {
    const surface = extractGeneralPageSurface({
      document: jsdomFixtureDocument(
        "gated-continue-reading-preview.html",
        "https://review.example.test/member/continue-preview",
      ),
      url: "https://review.example.test/member/continue-preview",
    });

    expect(surface.extraction.status).toBe("partial");
    expect(surface.extraction.warnings).toContain("login-or-paywall-like");
    expect(surface.mainText).toContain("Continue reading the full article");
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

  it("applies index/feed density heuristics to semantic main roots", () => {
    const cards = Array.from({ length: 4 }, (_, index) => `
      <article>
        <h2>Synthetic card ${index + 1}</h2>
        <p>Short synthetic card ${index + 1} describes a fictional public update and links to a separate detail page.</p>
        <a href="/updates/${index + 1}">Open update ${index + 1}</a>
      </article>
    `).join("");
    const dom = new JSDOM(`
      <!doctype html>
      <html>
        <head>
          <title>Municipal Updates Fixture</title>
          <meta property="og:site_name" content="Example Office">
        </head>
        <body>
          <main>
            <h1>Municipal Updates Fixture</h1>
            ${cards}
          </main>
        </body>
      </html>
    `, { url: "https://official.example.test/updates" });

    const surface = extractGeneralPageSurface({
      document: dom.window.document,
      url: "https://official.example.test/updates",
    });

    expect(surface.extraction.method).toBe("semantic-html");
    expect(surface.extraction.status).toBe("partial");
    expect(surface.extraction.warnings).toContain("large-navigation-noise");
    expect(surface.mainText).toContain("Municipal Updates Fixture");
  });

  it("prunes browser prompts and structural chrome from fallback text", () => {
    const dom = new JSDOM(`
      <!doctype html>
      <html>
        <head>
          <title>Fallback Noise Fixture</title>
          <meta property="og:site_name" content="Synthetic Daily">
        </head>
        <body>
          <header>
            <nav>
              <a href="/">首頁</a>
              <a href="/politics">政治</a>
              <a href="/sports">體育</a>
            </nav>
            <p>為達最佳瀏覽效果，建議使用 Chrome、Firefox 或 Microsoft Edge 的瀏覽器。</p>
            <p>請至Edge官網下載 請至FireFox官網下載 請至Google官網下載</p>
            <p>即時 熱門 政治 軍武 社會 生活 健康 國際 地方 搜尋 會員 專區。</p>
          </header>
          <div class="layout">
            <div class="story-body">
              <h1>Fallback Noise Fixture</h1>
              <p>這個合成頁面沒有 article 或 main 標籤，但真正正文描述一項公開服務測試。</p>
              <p>第二段提供足夠內容，讓 fallback 抽取能夠保留可讀段落，同時不要把瀏覽器下載提示送進模型脈絡。</p>
              <p>第三段補足長度，說明測試資料全部是假文字、假網址與假作者，適合公開提交到 repo。</p>
              <a href="/source">Article source</a>
            </div>
            <aside class="related-sidebar">
              <h2>熱門新聞</h2>
              <a href="/related-1">相關文章一</a>
              <a href="/related-2">相關文章二</a>
            </aside>
          </div>
          <footer>關於我們 隱私權 服務條款</footer>
        </body>
      </html>
    `, { url: "https://news.example.test/articles/fallback-noise" });

    const surface = extractGeneralPageSurface({
      document: dom.window.document,
      url: "https://news.example.test/articles/fallback-noise",
    });

    expect(surface.extraction).toMatchObject({
      method: "fallback",
      status: "partial",
    });
    expect(surface.extraction.warnings).toContain("no-main-content");
    expect(surface.mainText).toContain("真正正文描述一項公開服務測試");
    expect(surface.mainText).toContain("不要把瀏覽器下載提示送進模型脈絡");
    expect(surface.mainText).not.toContain("首頁");
    expect(surface.mainText).not.toContain("即時 熱門 政治");
    expect(surface.mainText).not.toContain("建議使用 Chrome");
    expect(surface.mainText).not.toContain("Edge官網下載");
    expect(surface.mainText).not.toContain("Article source");
    expect(surface.mainText).not.toContain("熱門新聞");
    expect(surface.mainText).not.toContain("隱私權 服務條款");
    expect(surface.links).toEqual([
      {
        href: "https://news.example.test/source",
        text: "Article source",
      },
    ]);
  });

  it("falls back to body text when a semantic root is only an advertising label", () => {
    const surface = extractGeneralPageSurface({
      document: jsdomFixtureDocument(
        "semantic-ad-root-body-article.html",
        "https://news.example.test/world/semantic-ad-root",
      ),
      url: "https://news.example.test/world/semantic-ad-root",
    });

    expect(surface.extraction.method).toBe("fallback");
    expect(surface.extraction.status).toBe("complete");
    expect(surface.extraction.warnings).not.toContain("no-main-content");
    expect(surface.extraction.warnings).not.toContain("large-navigation-noise");
    expect(surface.mainText).toContain("actual body explains a fictional public monitoring project");
    expect(surface.mainText).not.toBe("Advertising");
    expect(surface.mainText).not.toContain("Related source one");
  });

  it("keeps zh-TW homepage navigation from dominating fallback text", () => {
    const surface = extractGeneralPageSurface({
      document: jsdomFixtureDocument(
        "zhtw-homepage-nav-only.html",
        "https://news.example.test/zh-tw/",
      ),
      url: "https://news.example.test/zh-tw/",
    });

    expect(surface.extraction.status).toBe("partial");
    expect(surface.extraction.warnings).toContain("large-navigation-noise");
    expect(surface.mainText).toContain("繁中首頁導覽假頁是索引頁");
    expect(surface.mainText).not.toContain("2026世界盃 〉 即時 熱門 政治");
    expect(surface.mainText).not.toContain("自由電子報 自由影音 即時 熱門");
  });

  it("keeps long documentation bodies usable despite dense right-rail links", () => {
    const surface = extractGeneralPageSurface({
      document: jsdomFixtureDocument(
        "docs-right-rail-long.html",
        "https://docs.example.test/handbook/conditional-helper",
      ),
      url: "https://docs.example.test/handbook/conditional-helper",
    });

    expect(surface.extraction.status).toBe("complete");
    expect(surface.extraction.warnings).not.toContain("large-navigation-noise");
    expect(surface.mainText).toContain("long, coherent technical body");
    expect(surface.mainText).toContain("should not automatically make a clean documentation body look like a feed or index");
    expect(surface.mainText).not.toContain("On this page");
    expect(surface.mainText).not.toContain("Compiler options");
  });

  it("selects blog prose containers when no semantic article landmark exists", () => {
    const surface = extractGeneralPageSurface({
      document: jsdomFixtureDocument(
        "blog-prose-with-nav-shell.html",
        "https://personal.example.test/notes/prose-shell",
      ),
      url: "https://personal.example.test/notes/prose-shell",
    });

    expect(surface.extraction.method).toBe("fallback");
    expect(surface.extraction.status).toBe("complete");
    expect(surface.extraction.warnings).not.toContain("no-main-content");
    expect(surface.mainText).toContain("blog prose with nav shell fixture");
    expect(surface.mainText).toContain("paragraph density and heading similarity should beat archive widgets");
    expect(surface.mainText).not.toContain("Previous posts");
    expect(surface.mainText).not.toContain("Popular essay one");
    expect(surface.mainText).not.toContain("Privacy Terms Contact");
  });

  it("keeps short semantic articles extractable while marking them partial", () => {
    const surface = extractGeneralPageSurface({
      document: jsdomFixtureDocument(
        "short-semantic-news-brief.html",
        "https://briefs.example.test/news/short-semantic-brief",
      ),
      url: "https://briefs.example.test/news/short-semantic-brief",
    });

    expect(surface.extraction.method).toBe("semantic-html");
    expect(surface.extraction.status).toBe("partial");
    expect(surface.extraction.warnings).toEqual(["very-short-content"]);
    expect(surface.mainText).toContain("short semantic news brief fixture");
    expect(surface.mainText).toContain("Short article bodies can still be useful model context");
  });

  it("does not let a dense outer navigation shell taint a compact semantic article", () => {
    const url = "https://wire.example.test/news/compact-report";
    const navigation = Array.from({ length: 140 }, (_, index) => `<a href="/topic-${index}">Topic ${index}</a>`).join("");
    const documentRef = new JSDOM(`<!doctype html><html><head>
      <title>Compact report</title>
      <meta property="article:published_time" content="2026-07-21T12:00:00Z">
    </head><body><nav>${navigation}</nav><main><article>
      <h1>Compact report</h1>
      <p>The agency published a compact report with a concrete action and a stated reason. The prose remains the only intended reading target.</p>
      <p>A second complete sentence confirms that the article body is distinct from the site's dense navigation shell.</p>
    </article></main></body></html>`, { url }).window.document;

    const surface = extractGeneralPageSurface({ document: documentRef, url });

    expect(surface.extraction.method).toBe("semantic-html");
    expect(surface.extraction.warnings).not.toContain("large-navigation-noise");
    expect(surface.mainText).not.toContain("Topic 139");
    expect(buildGeneralPageModelContext(surface).modelEligible).toBe(true);
  });

  it("downgrades dense semantic main card collections as index-like pages", () => {
    const surface = extractGeneralPageSurface({
      document: jsdomFixtureDocument(
        "semantic-main-card-index-dense.html",
        "https://civic.example.test/desk",
      ),
      url: "https://civic.example.test/desk",
    });

    expect(surface.extraction.method).toBe("semantic-html");
    expect(surface.extraction.status).toBe("partial");
    expect(surface.extraction.warnings).toContain("large-navigation-noise");
    expect(surface.mainText).toContain("semantic main card index dense fixture");
    expect(surface.mainText).toContain("collection page rather than one complete article");
  });

  it("downgrades semantic dashboard tables as data surfaces instead of articles", () => {
    const surface = extractGeneralPageSurface({
      document: jsdomFixtureDocument(
        "semantic-main-dashboard-table.html",
        "https://metrics.example.test/d/overview",
      ),
      url: "https://metrics.example.test/d/overview",
    });

    expect(surface.extraction.method).toBe("semantic-html");
    expect(surface.extraction.status).toBe("partial");
    expect(surface.extraction.warnings).toContain("large-navigation-noise");
    expect(surface.mainText).toContain("Inference Overview Dashboard Fixture");
    expect(surface.mainText).toContain("data surface rather than a single complete article");
  });

  it("downgrades short leaderboard app shells as data surfaces instead of articles", () => {
    const surface = extractGeneralPageSurface({
      document: jsdomFixtureDocument(
        "semantic-main-short-leaderboard.html",
        "https://arena.example.test/leaderboard",
      ),
      url: "https://arena.example.test/leaderboard",
    });

    expect(surface.extraction.method).toBe("semantic-html");
    expect(surface.extraction.status).toBe("partial");
    expect(surface.extraction.warnings).toContain("large-navigation-noise");
    expect(surface.mainText).toContain("LLM Leaderboard");
    expect(surface.mainText).toContain("Loading leaderboard snapshot");
  });

  it("selects an article-like fallback block over magazine recirculation rails", () => {
    const surface = extractGeneralPageSurface({
      document: jsdomFixtureDocument(
        "zhtw-magazine-recirc-trap.html",
        "https://magazine.example.test/culture/slow-lens-fixture",
      ),
      url: "https://magazine.example.test/culture/slow-lens-fixture",
    });

    expect(surface.extraction.method).toBe("fallback");
    expect(surface.extraction.status).toBe("partial");
    expect(surface.extraction.warnings).toContain("no-main-content");
    expect(surface.mainText).toContain("這個合成雜誌頁面描述一場虛構影像工作坊");
    expect(surface.mainText).toContain("根據段落密度、標題相似度與連結密度挑選正文");
    expect(surface.mainText).not.toContain("編輯選讀卡片摘要");
    expect(surface.mainText).not.toContain("快門慢想延伸專題");
    expect(surface.links).toEqual([
      {
        href: "https://magazine.example.test/culture/source-note",
        text: "Article source",
      },
    ]);
  });

  it("removes nested JSON-LD and in-article recirculation from zh-TW news pages", () => {
    const surface = extractGeneralPageSurface({
      document: jsdomFixtureDocument(
        "zhtw-news-jsonld-recirc.html",
        "https://news.example.test/articles/jsonld-recirc",
      ),
      url: "https://news.example.test/articles/jsonld-recirc",
    });

    expect(surface.extraction.method).toBe("semantic-html");
    expect(surface.extraction.status).toBe("complete");
    expect(surface.mainText).toContain("合成新聞頁面描述一場虛構的公共服務演練");
    expect(surface.mainText).toContain("模型脈絡應聚焦在正文");
    expect(surface.mainText).not.toContain("@context");
    expect(surface.mainText).not.toContain("script metadata should not appear");
    expect(surface.mainText).not.toContain("Yahoo提醒您");
    expect(surface.mainText).not.toContain("飲酒過量");
    expect(surface.mainText).not.toContain("延伸閱讀");
    expect(surface.mainText).not.toContain("相關文章一不應進入正文");
    expect(surface.mainText).not.toContain("更多範例新聞網報導");
    expect(surface.mainText).not.toContain("尾端站內推薦標題不應進入正文");
    expect(surface.mainText).not.toContain("檢視留言");
    expect(surface.mainText).not.toContain("廣告");
    expect(surface.links ?? []).not.toContainEqual(expect.objectContaining({
      text: expect.stringContaining("相關文章一不應進入正文"),
    }));
  });

  it("removes a more-stories tail nested inside an otherwise valid article", () => {
    const document = new JSDOM(`
      <html>
        <head><title>合成公共服務公告</title></head>
        <body>
          <article>
            <h1>合成公共服務公告</h1>
            <p>這篇合成新聞說明一項虛構的公共服務演練，內容只用來驗證正文抽取。</p>
            <p>演練包含通知、現場協調與後續紀錄，正文應完整保留並提供模型閱讀。</p>
            <p>所有名稱與事件均為測試資料，不代表任何真實機關或活動。</p>
            <div class="more-stories">
              <a href="/other-a">另一則新聞標題不應進入本文</a>
              <a href="/other-b">第二則相關故事也不應進入本文</a>
            </div>
          </article>
        </body>
      </html>
    `, { url: "https://news.example.test/articles/public-service" }).window.document;

    const surface = extractGeneralPageSurface({
      document,
      url: "https://news.example.test/articles/public-service",
    });

    expect(surface.mainText).toContain("這篇合成新聞說明一項虛構的公共服務演練");
    expect(surface.mainText).not.toContain("另一則新聞標題不應進入本文");
    expect(surface.mainText).not.toContain("第二則相關故事也不應進入本文");
  });

  it("keeps image-rich long article bodies complete when prose is substantial", () => {
    const surface = extractGeneralPageSurface({
      document: jsdomFixtureDocument(
        "image-rich-long-news-article.html",
        "https://example.test/news/image-rich-long-article",
      ),
      url: "https://example.test/news/image-rich-long-article",
    });

    expect(surface.extraction.status).toBe("complete");
    expect(surface.extraction.warnings).not.toContain("large-navigation-noise");
    expect(surface.mainText).toContain("這篇合成新聞描述一場虛構的城市閱讀活動");
    expect(surface.mainText).toContain("確認圖片很多時仍可辨識完整正文");
  });

  it("prefers nested post content over noisy semantic main containers", () => {
    const surface = extractGeneralPageSurface({
      document: jsdomFixtureDocument(
        "post-content-inside-noisy-main.html",
        "https://news.example.test/stories/noisy-main-post-content",
      ),
      url: "https://news.example.test/stories/noisy-main-post-content",
    });

    expect(surface.extraction.method).toBe("fallback");
    expect(surface.extraction.status).toBe("complete");
    expect(surface.extraction.warnings).not.toContain("large-navigation-noise");
    expect(surface.mainText).toContain("真正正文仍集中在 post-content 容器內");
    expect(surface.mainText).toContain("保留足夠模型脈絡");
    expect(surface.mainText).not.toContain("首頁推薦卡片一不應進入正文");
    expect(surface.mainText).not.toContain("合成延伸閱讀一不應進入正文");
    expect(surface.mainText).not.toContain("最新文章一不應進入正文");
  });

  it("extracts legacy table news bodies without semantic landmarks", () => {
    const surface = extractGeneralPageSurface({
      document: jsdomFixtureDocument(
        "legacy-table-news-body.html",
        "https://radio.example.test/news/legacy-table-body",
      ),
      url: "https://radio.example.test/news/legacy-table-body",
    });

    expect(surface.extraction.method).toBe("fallback");
    expect(surface.extraction.status).toBe("complete");
    expect(surface.extraction.warnings).not.toContain("no-main-content");
    expect(surface.mainText).toContain("舊式表格新聞合成頁");
    expect(surface.mainText).toContain("legacy table body 應該被視為可用正文候選");
    expect(surface.mainText).not.toContain("排行榜");
    expect(surface.mainText).not.toContain("隱私權");
  });

  it("prefers video article descriptions over playlist carousels", () => {
    const surface = extractGeneralPageSurface({
      document: jsdomFixtureDocument(
        "video-article-description.html",
        "https://video.example.test/news/synthetic-video-description",
      ),
      url: "https://video.example.test/news/synthetic-video-description",
    });

    expect(surface.extraction.status).toBe("complete");
    expect(surface.extraction.warnings).not.toContain("large-navigation-noise");
    expect(surface.mainText).toContain("這段合成影音描述說明一場虛構災害演練");
    expect(surface.mainText).toContain("應優先於下方輪播與推薦影片");
    expect(surface.mainText).not.toContain("facebook.example.test/example-news");
    expect(surface.mainText).not.toContain("instagram.example.test/example-news");
    expect(surface.mainText).not.toContain("telegram.example.test/example_news");
    expect(surface.mainText).not.toContain("最新影音一不應進入正文");
  });

  it("does not promote homepage lead cards through fallback block scoring", () => {
    const surface = extractGeneralPageSurface({
      document: jsdomFixtureDocument(
        "homepage-lead-card-trap.html",
        "https://daily.example.test/",
      ),
      url: "https://daily.example.test/",
    });

    expect(surface.extraction.method).toBe("fallback");
    expect(surface.extraction.status).toBe("partial");
    expect(surface.extraction.warnings).toContain("large-navigation-noise");
    expect(surface.mainText).toContain("homepage lead card trap fixture");
    expect(surface.mainText).toContain("front page, not a single complete article");
    expect(surface.mainText).not.toContain("Most read");
    expect(surface.mainText).not.toContain("Sponsored shelf");
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
      {
        type: "PAGE_READING_REQUEST",
        tabId: 1,
        inject: true,
        activation: {
          source: "popup",
          targetKind: "page",
          action: "read",
        },
      },
      { type: "PAGE_READING_REQUEST" },
      { type: "PAGE_READING_RESULT", surface, tabId: 1 },
      { type: "PAGE_READING_ERROR", error: "page_reader_unavailable", tabId: 1 },
      {
        type: "READING_TARGET_REQUEST",
        tabId: 1,
        trigger: "hotkey",
        activation: {
          source: "hotkey",
          targetKind: "current-region",
          action: "summarize",
        },
      },
      { type: "READING_TARGET_RESULT", target, tabId: 1 },
      { type: "READING_TARGET_ERROR", error: "reading_target_unsupported", tabId: 1 },
    ];

    expect(messages.map((message) => message.type)).toEqual([
      "PAGE_READING_REQUEST",
      "PAGE_READING_REQUEST",
      "PAGE_READING_REQUEST",
      "PAGE_READING_RESULT",
      "PAGE_READING_ERROR",
      "READING_TARGET_REQUEST",
      "READING_TARGET_RESULT",
      "READING_TARGET_ERROR",
    ]);
  });
});
