import type {
  ReadingExtractionStatus,
  ReadingExtractionWarning,
  ReadingSurface,
  ReadingSurfaceExtractionMethod,
  ReadingSurfaceImage,
  ReadingSurfaceLink,
} from "./reading-surface-types";

export interface GeneralPageExtractionInput {
  document: Document;
  url: string;
  selectedText?: string;
}

export interface GeneralPageExtractionOptions {
  minMainTextLength?: number;
  minSelectedTextLength?: number;
  maxLinks?: number;
  maxImages?: number;
}

const DEFAULT_MIN_MAIN_TEXT_LENGTH = 240;
const DEFAULT_MIN_SELECTED_TEXT_LENGTH = 80;
const DEFAULT_MAX_LINKS = 24;
const DEFAULT_MAX_IMAGES = 12;
const EXCERPT_LENGTH = 240;

const MAIN_ROOT_SELECTORS = [
  "article",
  "main",
  "[role=\"main\"]",
] as const;

const WEAK_PAYWALL_OR_LOGIN_PATTERNS = [
  /\bsign in\b/i,
  /\blog in\b/i,
  /\bsubscribe\b/i,
  /\bsubscription\b/i,
  /登入/,
  /訂閱/,
  /會員/,
  /付費/,
] as const;

const STRONG_PAYWALL_OR_LOGIN_PATTERNS = [
  /\bsign in required\b/i,
  /\blog in or subscribe\b/i,
  /\bsubscribe to continue reading\b/i,
  /\bsubscription required\b/i,
  /\bmembers? only\b/i,
  /\bunlock (?:the )?(?:rest|full|complete)\b/i,
  /\b(?:sign in|log in).{0,48}\b(?:continue|view|read)\b/i,
  /登入.{0,24}(繼續|閱讀|查看|會員|訂閱)/,
  /訂閱.{0,24}(繼續閱讀|解鎖|全文|完整)/,
  /會員.{0,24}(全文|完整|繼續閱讀)/,
  /付費.{0,24}(全文|完整|閱讀)/,
] as const;

const NON_READING_TEXT_SELECTORS = [
  "script",
  "style",
  "noscript",
  "template",
  "svg",
] as const;

export function extractGeneralPageSurface(
  input: GeneralPageExtractionInput,
  options: GeneralPageExtractionOptions = {},
): ReadingSurface {
  const minMainTextLength = options.minMainTextLength ?? DEFAULT_MIN_MAIN_TEXT_LENGTH;
  const minSelectedTextLength = options.minSelectedTextLength ?? DEFAULT_MIN_SELECTED_TEXT_LENGTH;
  const maxLinks = options.maxLinks ?? DEFAULT_MAX_LINKS;
  const maxImages = options.maxImages ?? DEFAULT_MAX_IMAGES;

  const currentUrl = normalizeUrl(input.url) ?? input.url;
  const rawCanonicalUrl = firstAttribute(input.document, [
    "link[rel=\"canonical\"]",
    "link[rel=\"Canonical\"]",
  ], "href");
  const canonicalUrl = rawCanonicalUrl
    ? normalizeHref(rawCanonicalUrl, currentUrl) ?? rawCanonicalUrl
    : undefined;
  const sourceUrl = canonicalUrl ?? currentUrl;
  const sourceName = firstMetaContent(input.document, [
    "meta[property=\"og:site_name\"]",
    "meta[name=\"application-name\"]",
  ]) ?? hostnameLabel(sourceUrl);
  const title = firstMetaContent(input.document, [
    "meta[property=\"og:title\"]",
    "meta[name=\"twitter:title\"]",
  ]) ?? normalizeWhitespace(input.document.title ?? "") ?? firstHeading(input.document);
  const authorName = firstMetaContent(input.document, [
    "meta[name=\"author\"]",
    "meta[property=\"article:author\"]",
  ]);
  const publishedAt = firstMetaContent(input.document, [
    "meta[property=\"article:published_time\"]",
    "meta[name=\"date\"]",
  ]) ?? firstAttribute(input.document, ["time[datetime]"], "datetime");

  const selectedText = normalizeWhitespace(input.selectedText ?? "") ?? "";
  const selectedTextIsUseful = Boolean(selectedText && selectedText.length >= minSelectedTextLength);
  const extractionRoot = findBestMainRoot(input.document, minMainTextLength);
  const rootText = extractionRoot ? readableText(extractionRoot) ?? "" : "";
  const bodyText = input.document.body ? readableText(input.document.body) ?? "" : "";

  let method: ReadingSurfaceExtractionMethod = "fallback";
  let mainText = "";
  const warnings: ReadingExtractionWarning[] = [];

  if (selectedTextIsUseful) {
    method = "selection";
    mainText = selectedText;
    warnings.push("selection-only");
  } else if (rootText && rootText.length >= minMainTextLength) {
    method = "semantic-html";
    mainText = rootText;
  } else if (rootText) {
    method = "semantic-html";
    mainText = rootText;
    warnings.push("very-short-content");
  } else if (bodyText && bodyText.length >= minMainTextLength) {
    method = "fallback";
    mainText = bodyText;
    warnings.push("no-main-content", "large-navigation-noise");
  } else if (bodyText) {
    method = "fallback";
    mainText = bodyText;
    warnings.push("no-main-content", "very-short-content");
  } else {
    method = "fallback";
    warnings.push("no-main-content");
  }

  if (looksBlockedOrPaywalled(input.document, extractionRoot, title, mainText, minMainTextLength)) {
    warnings.push("login-or-paywall-like");
  }

  if (!selectedTextIsUseful && mainText) {
    warnings.push(...nonArticlePageWarnings(input.document, extractionRoot, mainText, currentUrl, title));
  }

  const status = resolveExtractionStatus(mainText, warnings, minMainTextLength);
  const linkRoot = extractionRoot ?? input.document.body ?? input.document.documentElement;
  const links = collectLinks(linkRoot, sourceUrl, maxLinks);
  const images = collectImages(linkRoot, sourceUrl, maxImages);

  return {
    id: stableSurfaceId(sourceUrl),
    kind: "web-page",
    source: "general",
    url: currentUrl,
    canonicalUrl,
    title,
    authorName,
    sourceName,
    publishedAt,
    mainText,
    selectedText: selectedText || undefined,
    excerpt: buildExcerpt(mainText),
    links: links.length > 0 ? links : undefined,
    images: images.length > 0 ? images : undefined,
    extraction: {
      method,
      status,
      warnings: uniqueWarnings(warnings),
    },
  };
}

function findBestMainRoot(documentRef: Document, minLength: number): Element | null {
  const candidates: Element[] = [];
  for (const selector of MAIN_ROOT_SELECTORS) {
    candidates.push(...Array.from(documentRef.querySelectorAll(selector)));
  }
  if (candidates.length === 0)
    return null;

  const ranked = candidates
    .map((element) => ({
      element,
      text: readableText(element) ?? "",
    }))
    .filter((candidate) => candidate.text.length > 0)
    .sort((a, b) => b.text.length - a.text.length);

  return ranked.find((candidate) => candidate.text.length >= minLength)?.element
    ?? ranked[0]?.element
    ?? null;
}

function readableText(root: Element): string | undefined {
  const clone = root.cloneNode(true) as Element;
  for (const selector of NON_READING_TEXT_SELECTORS) {
    for (const element of Array.from(clone.querySelectorAll(selector))) {
      element.remove();
    }
  }
  return normalizeWhitespace(clone.textContent ?? "");
}

function nonArticlePageWarnings(
  documentRef: Document,
  extractionRoot: Element | null,
  text: string,
  url: string,
  title?: string,
): ReadingExtractionWarning[] {
  const root = extractionRoot ?? documentRef.body ?? documentRef.documentElement;
  const rootIsArticle = root.tagName.toLowerCase() === "article";
  const articleCount = root.querySelectorAll("article").length;
  const listItemCount = root.querySelectorAll("li").length;
  const linkCount = root.querySelectorAll("a[href]").length;
  const imageCount = root.querySelectorAll("img").length;
  const documentArticleCount = documentRef.querySelectorAll("article").length;
  const documentParagraphCount = documentRef.querySelectorAll("p").length;
  const documentLinkCount = documentRef.querySelectorAll("a[href]").length;
  const documentImageCount = documentRef.querySelectorAll("img").length;
  const hasArticleMeta = Boolean(firstMetaContent(documentRef, [
    "meta[property=\"article:published_time\"]",
    "meta[property=\"article:author\"]",
  ]));
  const lowerSignals = `${url} ${title ?? ""} ${text}`.toLowerCase();

  if (
    articleCount >= 3 &&
    /\b(thread|discussion|reply|replies|forum|community|comment|comments)\b/.test(lowerSignals)
  ) {
    return ["large-navigation-noise"];
  }

  if (
    articleCount >= 2 &&
    /\b(social|post|reply|repost|share|timeline|feed|suggested accounts|install app|trending)\b/.test(lowerSignals)
  ) {
    return ["large-navigation-noise"];
  }

  if (
    /\b(search results?|results for|filter by|query=|[?&]q=)\b/.test(lowerSignals) &&
    (listItemCount >= 3 || linkCount >= 3)
  ) {
    return ["large-navigation-noise"];
  }

  if (
    articleCount >= 3 &&
    /\b(index|directory|latest entries|latest news|top stories|home ?page|front page|archive|topics|list page|cards?)\b/.test(lowerSignals)
  ) {
    return ["large-navigation-noise"];
  }

  if (
    articleCount >= 3 &&
    /(最新消息|公告列表|公告卡片|索引頁|不要把.+完整文章)/.test(lowerSignals)
  ) {
    return ["large-navigation-noise"];
  }

  if (
    !rootIsArticle &&
    !hasArticleMeta &&
    documentLinkCount >= 100 &&
    documentImageCount >= 24 &&
    (linkCount >= 12 || imageCount >= 8)
  ) {
    return ["large-navigation-noise"];
  }

  if (
    !rootIsArticle &&
    documentArticleCount >= 3 &&
    documentLinkCount >= 80 &&
    (documentParagraphCount <= 12 || linkCount >= 12 || documentImageCount >= 20)
  ) {
    return ["large-navigation-noise"];
  }

  if (
    rootIsArticle &&
    !hasArticleMeta &&
    documentLinkCount >= 100 &&
    documentImageCount >= 24 &&
    documentParagraphCount >= 20 &&
    (linkCount >= 12 || imageCount >= 8)
  ) {
    return ["large-navigation-noise"];
  }

  if (
    rootIsArticle &&
    text.length < 1500 &&
    documentArticleCount >= 6 &&
    documentLinkCount >= 80 &&
    documentParagraphCount <= 12
  ) {
    return ["large-navigation-noise"];
  }

  return [];
}

function firstHeading(root: ParentNode): string | undefined {
  return normalizeWhitespace(root.querySelector("h1")?.textContent ?? "") ?? undefined;
}

function firstAttribute(
  root: ParentNode,
  selectors: readonly string[],
  attribute: string,
): string | undefined {
  for (const selector of selectors) {
    const value = normalizeWhitespace(root.querySelector(selector)?.getAttribute(attribute) ?? "");
    if (value)
      return value;
  }
  return undefined;
}

function firstMetaContent(
  root: ParentNode,
  selectors: readonly string[],
  attribute = "content",
): string | undefined {
  return firstAttribute(root, selectors, attribute);
}

function collectLinks(root: ParentNode, baseUrl: string, limit: number): ReadingSurfaceLink[] {
  const links: ReadingSurfaceLink[] = [];
  for (const element of Array.from(root.querySelectorAll("a[href]"))) {
    const href = normalizeHref(element.getAttribute("href") ?? "", baseUrl);
    if (!href)
      continue;
    links.push({
      href,
      text: normalizeWhitespace(element.textContent ?? "") ?? undefined,
    });
    if (links.length >= limit)
      break;
  }
  return links;
}

function collectImages(root: ParentNode, baseUrl: string, limit: number): ReadingSurfaceImage[] {
  const images: ReadingSurfaceImage[] = [];
  for (const element of Array.from(root.querySelectorAll("img"))) {
    const src = normalizeHref(element.getAttribute("src") ?? "", baseUrl);
    if (!src)
      continue;
    images.push({
      src,
      alt: normalizeWhitespace(element.getAttribute("alt") ?? "") ?? undefined,
      title: normalizeWhitespace(element.getAttribute("title") ?? "") ?? undefined,
    });
    if (images.length >= limit)
      break;
  }
  return images;
}

function resolveExtractionStatus(
  text: string,
  warnings: ReadingExtractionWarning[],
  minMainTextLength: number,
): ReadingExtractionStatus {
  if (!text)
    return warnings.includes("login-or-paywall-like") ? "blocked" : "empty";
  if (warnings.includes("login-or-paywall-like") && text.length < minMainTextLength)
    return "blocked";
  if (warnings.length > 0)
    return "partial";
  return "complete";
}

function looksBlockedOrPaywalled(
  documentRef: Document,
  extractionRoot: Element | null,
  title: string | undefined,
  text: string,
  minMainTextLength: number,
): boolean {
  const root = extractionRoot ?? documentRef.body ?? documentRef.documentElement;
  const signals = `${title ?? ""} ${text}`;
  const weakMatch = WEAK_PAYWALL_OR_LOGIN_PATTERNS.some((pattern) => pattern.test(signals));
  if (!weakMatch)
    return false;
  if (STRONG_PAYWALL_OR_LOGIN_PATTERNS.some((pattern) => pattern.test(signals)))
    return true;
  if (text.length < minMainTextLength)
    return true;
  if (root.querySelector("input[type=\"password\"], input[type=\"email\"], form"))
    return true;
  return false;
}

function buildExcerpt(text: string): string | undefined {
  const normalized = normalizeWhitespace(text);
  if (!normalized)
    return undefined;
  if (normalized.length <= EXCERPT_LENGTH)
    return normalized;
  return `${normalized.slice(0, EXCERPT_LENGTH).trim()}...`;
}

function normalizeWhitespace(value: string): string | undefined {
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length > 0 ? normalized : undefined;
}

function normalizeUrl(url: string): string | undefined {
  try {
    return new URL(url).href;
  } catch {
    return undefined;
  }
}

function normalizeHref(value: string, baseUrl: string): string | undefined {
  if (!value.trim() || value.startsWith("#"))
    return undefined;
  try {
    return new URL(value, baseUrl).href;
  } catch {
    return undefined;
  }
}

function hostnameLabel(url: string): string | undefined {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return undefined;
  }
}

function stableSurfaceId(url: string): string {
  return `general:${url}`;
}

function uniqueWarnings(warnings: ReadingExtractionWarning[]): ReadingExtractionWarning[] {
  return [...new Set(warnings)];
}
