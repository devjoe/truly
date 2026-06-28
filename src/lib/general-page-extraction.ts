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

const PAYWALL_OR_LOGIN_PATTERNS = [
  /\bsign in\b/i,
  /\blog in\b/i,
  /\bsubscribe\b/i,
  /\bsubscription\b/i,
  /登入/,
  /訂閱/,
  /會員/,
  /付費/,
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
  const canonicalUrl = firstAttribute(input.document, [
    "link[rel=\"canonical\"]",
    "link[rel=\"Canonical\"]",
  ], "href");
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
  const rootText = normalizeWhitespace(extractionRoot?.textContent ?? "") ?? "";
  const bodyText = normalizeWhitespace(input.document.body?.textContent ?? "") ?? "";

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

  if (looksBlockedOrPaywalled(`${title ?? ""} ${mainText}`)) {
    warnings.push("login-or-paywall-like");
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
      text: normalizeWhitespace(element.textContent ?? "") ?? "",
    }))
    .filter((candidate) => candidate.text.length > 0)
    .sort((a, b) => b.text.length - a.text.length);

  return ranked.find((candidate) => candidate.text.length >= minLength)?.element
    ?? ranked[0]?.element
    ?? null;
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

function looksBlockedOrPaywalled(text: string): boolean {
  return PAYWALL_OR_LOGIN_PATTERNS.some((pattern) => pattern.test(text));
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
