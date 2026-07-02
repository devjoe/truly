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
export const GENERAL_PAGE_MIN_SELECTED_TEXT_LENGTH = 80;
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

const NON_READING_BLOCK_SELECTORS = [
  "nav",
  "aside",
  "footer",
  "form",
  "dialog",
  "[role=\"navigation\"]",
  "[role=\"complementary\"]",
  "[role=\"contentinfo\"]",
  "[aria-modal=\"true\"]",
  "[class*=\"breadcrumb\" i]",
  "[class*=\"cookie\" i]",
  "[class*=\"consent\" i]",
  "[class*=\"drawer\" i]",
  "[class*=\"modal\" i]",
  "[class*=\"newsletter\" i]",
  "[class*=\"popup\" i]",
  "[class*=\"promo\" i]",
  "[class*=\"related\" i]",
  "[class*=\"share\" i]",
  "[class*=\"sidebar\" i]",
  "[class*=\"sponsor\" i]",
  "[class*=\"toolbar\" i]",
  "[id*=\"breadcrumb\" i]",
  "[id*=\"cookie\" i]",
  "[id*=\"consent\" i]",
  "[id*=\"newsletter\" i]",
  "[id*=\"related\" i]",
  "[id*=\"sidebar\" i]",
] as const;

const NOISY_BLOCK_TEXT_PATTERNS = [
  /為達最佳瀏覽效果，?\s*建議使用\s*Chrome、?\s*Firefox\s*或\s*Microsoft\s*Edge\s*的瀏覽器/i,
  /請至\s*(?:Edge|Fire\s*Fox|Firefox|Google|Chrome|Microsoft\s*Edge)[^。.!?]*(?:下載|download)/i,
  /For best viewing[^.!?]*(?:Chrome|Firefox|Edge)[^.!?]*(?:browser|download)/i,
  /^Advertising$/i,
  /^Advertisement$/i,
  /^(?:(?:\S+)\s*〉\s*)?(?:即時\s+)?(?:熱門\s+)?(?:政治|財富自由|軍武|社會|生活|健康|國際|地方|蒐奇|影音|財經|娛樂|汽車|時尚|體育|3\s*C|3C|評論|藝文|玩咖|食譜|地產|搜尋|會員|專區|服務|求職|自由電子報|自由影音|TAIPEI TIMES)(?:\s+(?:即時|熱門|政治|財富自由|軍武|社會|生活|健康|國際|地方|蒐奇|影音|財經|娛樂|汽車|時尚|體育|3\s*C|3C|評論|藝文|玩咖|食譜|地產|搜尋|會員|專區|服務|求職|自由電子報|自由影音|TAIPEI TIMES)){3,}\s*[。.]?$/i,
] as const;

const NOISY_BLOCK_CANDIDATE_SELECTOR = [
  "div",
  "p",
  "section",
  "main",
  "li",
  "header",
  "figure",
  "figcaption",
].join(",");

const FALLBACK_CONTENT_CANDIDATE_SELECTOR = [
  "article",
  "main",
  "[role=\"main\"]",
  "section[class*=\"article\" i]",
  "section[class*=\"body\" i]",
  "section[class*=\"content\" i]",
  "section[class*=\"entry\" i]",
  "section[class*=\"feature\" i]",
  "section[class*=\"post\" i]",
  "section[class*=\"story\" i]",
  "div[class*=\"article\" i]",
  "div[class*=\"body\" i]",
  "div[class*=\"content\" i]",
  "div[class*=\"entry\" i]",
  "div[class*=\"feature\" i]",
  "div[class*=\"post\" i]",
  "div[class*=\"story\" i]",
  "section[id*=\"article\" i]",
  "section[id*=\"body\" i]",
  "section[id*=\"content\" i]",
  "section[id*=\"entry\" i]",
  "section[id*=\"post\" i]",
  "section[id*=\"story\" i]",
  "div[id*=\"article\" i]",
  "div[id*=\"body\" i]",
  "div[id*=\"content\" i]",
  "div[id*=\"entry\" i]",
  "div[id*=\"post\" i]",
  "div[id*=\"story\" i]",
].join(",");

const FALLBACK_CONTENT_POSITIVE_TOKEN_PATTERN = /(?:^|[\s_-])(?:article|body|content|entry|feature|post|story|text|本文|正文|文章)(?:$|[\s_-])/i;
const FALLBACK_CONTENT_NEGATIVE_TOKEN_PATTERN = /(?:^|[\s_-])(?:ad|advert|archive|card|carousel|category|comment|footer|grid|latest|menu|most|nav|popular|promo|rank|recommend|recirc|related|search|share|sidebar|sponsor|tag|teaser|trend|widget|排行|推薦|熱門|相關|輪播|側欄|廣告|分類|搜尋|分享)(?:$|[\s_-])/i;

const NON_READING_LINK_TEXT_PATTERNS = [
  /^home$/i,
  /^首頁$/,
  /^主頁$/,
  /^網站首頁$/,
  /^read more$/i,
  /^source link$/i,
  /^article source$/i,
  /^share$/i,
  /^login$/i,
  /^sign in$/i,
  /下載/i,
  /\bdownload\b/i,
] as const;

export function extractGeneralPageSurface(
  input: GeneralPageExtractionInput,
  options: GeneralPageExtractionOptions = {},
): ReadingSurface {
  const minMainTextLength = options.minMainTextLength ?? DEFAULT_MIN_MAIN_TEXT_LENGTH;
  const minSelectedTextLength = options.minSelectedTextLength ?? GENERAL_PAGE_MIN_SELECTED_TEXT_LENGTH;
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
  const fallbackRoot = !selectedTextIsUseful
    ? findBestFallbackContentRoot(input.document, currentUrl, title, minMainTextLength)
    : null;
  const fallbackRootText = fallbackRoot ? readableText(fallbackRoot) ?? "" : "";
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
  } else if (fallbackRootText && fallbackRootText.length >= minMainTextLength) {
    method = "fallback";
    mainText = fallbackRootText;
    warnings.push("no-main-content");
  } else if (rootText && bodyText && bodyText.length >= minMainTextLength && isShortSemanticRootFalseNegative(rootText, bodyText, minMainTextLength)) {
    method = "fallback";
    mainText = bodyText;
    warnings.push("large-navigation-noise");
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
  const linkRoot = extractionRoot ?? fallbackRoot ?? input.document.body ?? input.document.documentElement;
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

function findBestFallbackContentRoot(
  documentRef: Document,
  url: string,
  title: string | undefined,
  minLength: number,
): Element | null {
  if (!documentRef.body || isLikelyIndexFallbackDocument(documentRef, url, title))
    return null;

  const candidates = Array.from(new Set(
    Array.from(documentRef.body.querySelectorAll(FALLBACK_CONTENT_CANDIDATE_SELECTOR)),
  ));

  const ranked = candidates
    .map((element) => scoreFallbackContentCandidate(element, title, minLength))
    .filter((candidate): candidate is FallbackContentCandidateScore => candidate !== null)
    .sort((a, b) => b.score - a.score);

  return ranked[0]?.element ?? null;
}

interface FallbackContentCandidateScore {
  element: Element;
  score: number;
}

function scoreFallbackContentCandidate(
  element: Element,
  title: string | undefined,
  minLength: number,
): FallbackContentCandidateScore | null {
  const text = readableText(element) ?? "";
  if (text.length < minLength)
    return null;

  const paragraphCount = element.querySelectorAll("p").length;
  if (paragraphCount < 2 && text.length < minLength * 2)
    return null;

  const linkCount = element.querySelectorAll("a[href]").length;
  const imageCount = element.querySelectorAll("img").length;
  const linkDensity = linkedTextLength(element) / Math.max(text.length, 1);
  if (linkDensity > 0.45)
    return null;

  const identity = `${element.tagName} ${element.getAttribute("class") ?? ""} ${element.getAttribute("id") ?? ""}`;
  let score = Math.min(text.length, 3600) / 36;
  score += Math.min(paragraphCount, 12) * 16;
  score -= linkCount * 7;
  score -= imageCount * 2;
  score -= linkDensity * 120;

  if (FALLBACK_CONTENT_POSITIVE_TOKEN_PATTERN.test(identity))
    score += 45;
  if (FALLBACK_CONTENT_NEGATIVE_TOKEN_PATTERN.test(identity))
    score -= 80;
  if (element.querySelector("h1"))
    score += 24;
  if (title && hasHeadingSimilarToTitle(element, title))
    score += 45;

  return score >= 65 ? { element, score } : null;
}

function isLikelyIndexFallbackDocument(
  documentRef: Document,
  url: string,
  title: string | undefined,
): boolean {
  const articleCount = documentRef.querySelectorAll("article").length;
  const linkCount = documentRef.querySelectorAll("a[href]").length;
  const imageCount = documentRef.querySelectorAll("img").length;
  const listItemCount = documentRef.querySelectorAll("li").length;
  const path = urlPath(url);
  const bodyText = normalizeWhitespace(documentRef.body?.textContent ?? "") ?? "";
  const signals = `${url} ${title ?? ""} ${bodyText.slice(0, 1200)}`.toLowerCase();

  if (
    path === "/" &&
    (articleCount >= 2 || linkCount >= 6 || imageCount >= 3)
  ) {
    return true;
  }

  if (
    /\b(?:front page|home ?page|top stories|latest news|category hub|search results?|archive|topics|index|list page)\b/.test(signals) &&
    (articleCount >= 2 || linkCount >= 6 || imageCount >= 3 || listItemCount >= 6)
  ) {
    return true;
  }

  if (
    /(?:首頁|索引頁|列表頁|即時新聞|熱門新聞|最新消息|公告列表)/.test(signals) &&
    (linkCount >= 3 || imageCount >= 3 || listItemCount >= 3)
  ) {
    return true;
  }

  return false;
}

function linkedTextLength(element: Element): number {
  return Array.from(element.querySelectorAll("a[href]")).reduce((length, link) => {
    return length + (normalizeWhitespace(link.textContent ?? "")?.length ?? 0);
  }, 0);
}

function hasHeadingSimilarToTitle(element: Element, title: string): boolean {
  const normalizedTitle = normalizeComparableText(title);
  if (!normalizedTitle)
    return false;
  for (const heading of Array.from(element.querySelectorAll("h1,h2"))) {
    const normalizedHeading = normalizeComparableText(heading.textContent ?? "");
    if (!normalizedHeading)
      continue;
    if (normalizedTitle.includes(normalizedHeading) || normalizedHeading.includes(normalizedTitle))
      return true;
  }
  return false;
}

function readableText(root: Element): string | undefined {
  const clone = root.cloneNode(true) as Element;
  for (const selector of NON_READING_TEXT_SELECTORS) {
    for (const element of Array.from(clone.querySelectorAll(selector))) {
      element.remove();
    }
  }
  pruneNonReadingBlocks(clone);
  pruneNonReadingLinks(clone);
  addBlockBoundaries(clone);
  return normalizeWhitespace(cleanCommonPageNoise(clone.textContent ?? ""));
}

function pruneNonReadingBlocks(root: Element): void {
  for (const selector of NON_READING_BLOCK_SELECTORS) {
    for (const element of Array.from(root.querySelectorAll(selector))) {
      if (shouldKeepReadingLayoutBlock(element))
        continue;
      element.remove();
    }
  }

  for (const element of Array.from(root.querySelectorAll(NOISY_BLOCK_CANDIDATE_SELECTOR))) {
    const text = normalizeWhitespace(element.textContent ?? "") ?? "";
    if (!text)
      continue;
    if (text.length <= 420 && NOISY_BLOCK_TEXT_PATTERNS.some((pattern) => pattern.test(text)))
      element.remove();
  }
}

function isShortSemanticRootFalseNegative(rootText: string, bodyText: string, minMainTextLength: number): boolean {
  if (rootText.length >= Math.min(120, minMainTextLength / 2))
    return false;
  if (/^(?:Advertising|Advertisement)$/i.test(rootText))
    return true;
  return bodyText.length >= Math.max(minMainTextLength, rootText.length * 8);
}

function shouldKeepReadingLayoutBlock(element: Element): boolean {
  const className = element.getAttribute("class") ?? "";
  return /(?:^|[\s_-])(?:with|beside)-sidebar(?:$|[\s_-])/i.test(className);
}

function pruneNonReadingLinks(root: Element): void {
  for (const element of Array.from(root.querySelectorAll("a[href]"))) {
    const text = normalizeWhitespace(element.textContent ?? "") ?? "";
    const href = element.getAttribute("href") ?? "";
    if (isNonReadingTextLink(text, href))
      element.remove();
  }
}

function addBlockBoundaries(root: Element): void {
  const blockSelectors = [
    "article",
    "section",
    "main",
    "header",
    "footer",
    "aside",
    "nav",
    "div",
    "p",
    "li",
    "blockquote",
    "figcaption",
    "pre",
    "td",
    "th",
    "h1",
    "h2",
    "h3",
    "h4",
    "h5",
    "h6",
  ].join(",");
  for (const element of Array.from(root.querySelectorAll(blockSelectors))) {
    if (typeof element.insertAdjacentText !== "function")
      continue;
    element.insertAdjacentText("beforebegin", " ");
    element.insertAdjacentText("afterend", " ");
  }
  for (const element of Array.from(root.querySelectorAll("br"))) {
    if (typeof element.replaceWith === "function")
      element.replaceWith(" ");
  }
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

  if (isLikelyDocumentationArticle(lowerSignals, text, documentParagraphCount))
    return [];

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
    /(首頁|索引頁|列表頁|不要把.+完整文章|front page|home ?page|list page|not a single complete article)/i.test(lowerSignals) &&
    (linkCount >= 3 || imageCount >= 3 || listItemCount >= 3)
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

function isLikelyDocumentationArticle(lowerSignals: string, text: string, paragraphCount: number): boolean {
  return text.length >= 1200 &&
    paragraphCount >= 8 &&
    /\b(?:docs?|documentation|handbook|guide|reference|learn|developer)\b/.test(lowerSignals);
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
    const text = normalizeWhitespace(element.textContent ?? "") ?? undefined;
    if (isNonReadingSourceLink(text ?? "", element.getAttribute("href") ?? ""))
      continue;
    const href = normalizeHref(element.getAttribute("href") ?? "", baseUrl);
    if (!href)
      continue;
    links.push({
      href,
      text,
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

function cleanCommonPageNoise(value: string): string {
  return value
    .replace(/^\s*(?:Advertising|Advertisement)\s*$/gi, " ")
    .replace(/為達最佳瀏覽效果，?\s*建議使用\s*Chrome、?\s*Firefox\s*或\s*Microsoft\s*Edge\s*的瀏覽器。?/gi, " ")
    .replace(/請至\s*(?:Edge|Fire\s*Fox|Firefox|Google|Chrome|Microsoft\s*Edge)[^。.!?]*(?:下載|download)[^。.!?]*(?:[。.!?]|$)/gi, " ")
    .replace(/For best viewing[^.!?]*(?:Chrome|Firefox|Edge)[^.!?]*(?:browser|download)[^.!?]*(?:[.!?]|$)/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeUrl(url: string): string | undefined {
  try {
    return new URL(url).href;
  } catch {
    return undefined;
  }
}

function urlPath(url: string): string {
  try {
    return new URL(url).pathname || "/";
  } catch {
    return "";
  }
}

function normalizeComparableText(value: string): string {
  return value.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
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

function isNonReadingTextLink(text: string, href: string): boolean {
  const cleanText = normalizeWhitespace(text) ?? "";
  const lowerHref = href.trim().toLowerCase();
  if (NON_READING_LINK_TEXT_PATTERNS.some((pattern) => pattern.test(cleanText)))
    return true;
  if (/(chrome|firefox|edge|google|microsoft|mozilla)/i.test(lowerHref))
    return true;
  return false;
}

function isNonReadingSourceLink(text: string, href: string): boolean {
  const cleanText = normalizeWhitespace(text) ?? "";
  const lowerHref = href.trim().toLowerCase();
  if (/^(home|首頁|主頁|網站首頁)$/i.test(cleanText))
    return true;
  if (/^(即時|熱門|政治|軍武|社會|生活|健康|國際|地方|財經|娛樂|體育|3C|評論|藝文|玩咖|食譜|地產|專區|搜尋|會員)$/i.test(cleanText))
    return true;
  if (/^(related|more|recommended|popular|latest)\b/i.test(cleanText) || /相關文章/.test(cleanText))
    return true;
  if (/(下載|\bdownload\b)/i.test(cleanText))
    return true;
  if (/(chrome|firefox|edge|google|microsoft|mozilla)/i.test(lowerHref))
    return true;
  return false;
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
