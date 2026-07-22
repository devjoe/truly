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
export const GENERAL_PAGE_DEFAULT_MAX_IMAGES = 12;
const EXCERPT_LENGTH = 240;

const MAIN_ROOT_SELECTORS = [
  "article",
  "main",
  "[role=\"main\"]",
  "[class*=\"entityBody\" i]",
  "[itemprop=\"articleBody\"]",
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

const TRUNCATED_CONTENT_PREVIEW_PATTERNS = [
  /[（(]?全文未完[）)]?(?:[，,、；;:]|\s|$)/,
  /全文及圖表請見.{0,32}(?:完整|當期|內容)/,
] as const;

const ACCESS_CHECKING_OR_PREVIEW_PATTERNS = [
  /\bchecking (?:your )?(?:access|subscription|membership)\b/i,
  /\bpreview (?:view|mode).{0,80}\b(?:checking|confirming|verifying).{0,80}\b(?:access|subscription|membership)\b/i,
  /\bfull article content will load\b/i,
  /\bcontinue reading after (?:access|subscription|membership) (?:is )?(?:confirmed|verified)\b/i,
  /檢查.{0,24}(存取|訂閱|會員)/,
  /(全文|完整文章).{0,24}(載入|顯示).{0,24}(確認|驗證)/,
] as const;

const GATED_CONTINUE_READING_PATTERNS = [
  /\bcontinue reading\b/i,
  /\bread (?:the )?full article\b/i,
  /\bfull article\b/i,
  /繼續閱讀/,
  /(閱讀|查看).{0,12}(全文|完整文章)/,
] as const;

const DYNAMIC_CONTENT_PARTIAL_PATTERNS = [
  /\b(?:enable|turn on)\s+javascript\b/i,
  /\bjavascript (?:is )?(?:disabled|required)\b/i,
  /\bthis (?:site|page|application).{0,80}\bjavascript\b/i,
  /\bloading (?:article|page|story|workspace)\b/i,
  /\bunable to render the provided source\b/i,
  /請.{0,12}(?:啟用|開啟).{0,12}JavaScript/i,
  /JavaScript.{0,12}(?:停用|關閉|未啟用|未開啟)/i,
] as const;

const UNAVAILABLE_PAGE_PATTERNS = [
  /\b(?:page|article|story) (?:was |is |does )?(?:not found|no longer exists|unavailable|removed)\b/i,
  /\b(?:404|410)\b.{0,48}\b(?:not found|gone|error)\b/i,
  /\b(?:not found|gone|error)\b.{0,48}\b(?:404|410)\b/i,
  /(?:頁面|網頁|文章).{0,20}(?:已不存在|不存在|找不到|已移除|無法使用)/,
  /您要找的頁面已不存在/,
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
  "button",
  "label",
  "dialog",
  "[hidden]",
  "[inert]",
  "[aria-hidden=\"true\"]",
  "[style*=\"display: none\" i]",
  "[style*=\"display:none\" i]",
  "[style*=\"visibility: hidden\" i]",
  "[style*=\"visibility:hidden\" i]",
  "[itemprop=\"author\"]",
  "[role=\"button\"]",
  "[role=\"navigation\"]",
  "[role=\"complementary\"]",
  "[role=\"contentinfo\"]",
  "[aria-modal=\"true\"]",
  "[class^=\"ad-\" i]",
  "[class*=\" ad-\" i]",
  "[class*=\"-ad\" i]",
  "[class*=\"_ad\" i]",
  "[class*=\"backdropAd\" i]",
  "[class*=\"defaultAd\" i]",
  "[class*=\"advert\" i]",
  "[class*=\"banner\" i]",
  "[class*=\"breadcrumb\" i]",
  "[class*=\"carousel\" i]",
  "[class*=\"cookie\" i]",
  "[class*=\"consent\" i]",
  "[class*=\"drawer\" i]",
  "[class*=\"modal\" i]",
  "[class*=\"more-stor\" i]",
  "[class*=\"newsletter\" i]",
  "[class*=\"organic\" i]",
  "[class*=\"partner\" i]",
  "[class*=\"playlist\" i]",
  "[class*=\"popup\" i]",
  "[class*=\"promo\" i]",
  "[class*=\"rbox\" i]",
  "[class*=\"recommend\" i]",
  "[class*=\"recirc\" i]",
  "[class*=\"reel\" i]",
  "[class*=\"related\" i]",
  "[class*=\"share\" i]",
  "[class*=\"sidebar\" i]",
  "[class*=\"sponsor\" i]",
  "[class*=\"trc_\" i]",
  "[class*=\"toolbar\" i]",
  "[class*=\"hatnote\" i]",
  "[class*=\"ambox\" i]",
  "[class*=\"appDownload\" i]",
  "[class*=\"articlekeyword\" i]",
  "[class*=\"btnGroup\" i]",
  "[class*=\"gmailNews\" i]",
  "[class*=\"moreArticle\" i]",
  "[class*=\"mw-editsection\" i]",
  "[class*=\"navbox\" i]",
  "[class*=\"printfooter\" i]",
  "[class*=\"TemasBlock\" i]",
  "[class*=\"wp-block-nasa-blocks-news-automated\" i]",
  "[id*=\"also-ask\" i]",
  "[id*=\"breadcrumb\" i]",
  "[id*=\"catlinks\" i]",
  "[id*=\"cookie\" i]",
  "[id*=\"consent\" i]",
  "[id*=\"google_ads_iframe\" i]",
  "[id*=\"more-stor\" i]",
  "[id*=\"newsletter\" i]",
  "[id*=\"recommend\" i]",
  "[id*=\"recirc\" i]",
  "[id*=\"related\" i]",
  "[id*=\"sidebar\" i]",
] as const;

const NOISY_BLOCK_TEXT_PATTERNS = [
  /為達最佳瀏覽效果，?\s*建議使用\s*Chrome、?\s*Firefox\s*或\s*Microsoft\s*Edge\s*的瀏覽器/i,
  /請至\s*(?:Edge|Fire\s*Fox|Firefox|Google|Chrome|Microsoft\s*Edge)[^。.!?]*(?:下載|download)/i,
  /For best viewing[^.!?]*(?:Chrome|Firefox|Edge)[^.!?]*(?:browser|download)/i,
  /^Advertising$/i,
  /^Advertisement$/i,
  /^廣告$/,
  /^廣告（請繼續閱讀本文）$/,
  /^(?:(?:\S+)\s*〉\s*)?(?:即時\s+)?(?:熱門\s+)?(?:政治|財富自由|軍武|社會|生活|健康|國際|地方|蒐奇|影音|財經|娛樂|汽車|時尚|體育|3\s*C|3C|評論|藝文|玩咖|食譜|地產|搜尋|會員|專區|服務|求職|自由電子報|自由影音|TAIPEI TIMES)(?:\s+(?:即時|熱門|政治|財富自由|軍武|社會|生活|健康|國際|地方|蒐奇|影音|財經|娛樂|汽車|時尚|體育|3\s*C|3C|評論|藝文|玩咖|食譜|地產|搜尋|會員|專區|服務|求職|自由電子報|自由影音|TAIPEI TIMES)){3,}\s*[。.]?$/i,
  // P21-breaking-ticker-lead: ticker strips are short blocks that start with a
  // breaking-news marker and carry two or more clock stamps.
  /^(?:快訊|即時新聞|突發|BREAKING(?:\s+NEWS)?)[\s:：][\s\S]{0,360}?\b\d{1,2}:\d{2}\b[\s\S]{0,360}?\b\d{1,2}:\d{2}\b/i,
  // P21: inline audio-player shells around news bodies.
  /Your browser does not support (?:the )?HTML5 Audio/i,
  /聽新聞\s*0:00\s*\/\s*0:00/,
  /^(?:Yahoo|媒體|網站)?提醒您[：:]?\s*(?:飲酒過量|未滿十八歲|禁止酒駕)[\s\S]{0,120}$/i,
  /^(?:飲酒過量，?害人害己。?\s*)?(?:未滿十八歲禁止飲酒。?|禁止酒駕。?)$/i,
  /^請繼續往下閱讀\s*(?:\.{3}|…)?$/,
  /^(?:[【\[]\s*廣告\s*[】\]]\s*)?請繼續往下閱讀\s*(?:\.{3}|…)?$/,
  /^（?相關報導[：:][\s\S]{0,320}(?:更多文章|更多報導)\s*）?$/,
  /^(?:\S{0,24}快訊\s+)?分享給朋友[：:][\s\S]{0,240}(?:版權所有|著作權聲明)[\s\S]*$/,
  /^(?:投資|閱讀|新聞|資訊)[\s\S]{0,32}(?:LINE|社群|訂閱|追蹤)[\s\S]{0,80}$/i,
  /^(?:一手|立即)?掌握.{0,24}(?:脈動|資訊|新聞)$/,
  /^(?:#\s*){3,}$/,
  /^不用抽\s*不用搶\s*現在用APP看新聞\s*保證天天中獎/i,
  /^更多新聞請搜尋.{0,24}$/,
  /^End of content$/i,
  /^(?:暫無|尚無|沒有)留言$/,
  /^No comments(?: yet)?$/i,
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

const RECIRCULATION_TAIL_HEADING_SELECTOR = [
  "div",
  "p",
  "section",
  "span",
  "strong",
  "b",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
].join(",");

const RECIRCULATION_TAIL_HEADING_PATTERNS = [
  /^延伸閱讀$/,
  /^相關(?:文章|報導|閱讀)$/,
  /^重點文章$/,
  /^火熱文章$/,
  /^最新(?:影音|文章|報導|新聞)$/,
  /^更多.{0,24}(?:報導|文章|新聞)$/,
  /^更多.{0,24}相關(?:文章|報導|新聞)$/,
  /^其他人也在看$/,
  /^你可能也(?:喜歡|想看)$/,
  /^more from\b/i,
  /^related (?:articles|coverage|stories|reading)$/i,
  /^read more$/i,
  /^keep exploring$/i,
  /^discover more topics from\b/i,
  /^請繼續(?:往下|下滑)閱讀(?:\.{3}|…)?$/,
  /^(?:【|\[)?(?:(?:全球)?熱門(?:話題|新聞|文章)?|全球熱話題)(?:】|\])?$/,
  /^更多.{0,24}(?:內幕|內容)[：:]?$/,
  /^(?:references?|external links?|further reading|see also|footnotes?)(?:\s*\[?\s*edit\s*\]?)?$/i,
  /^文章來源[：:]?(?:\s*#)*$/,
  /^文章標籤$/,
] as const;

const FALLBACK_CONTENT_CANDIDATE_SELECTOR = [
  "article",
  "main",
  "[role=\"main\"]",
  "section[class*=\"article\" i]",
  "section[class*=\"body\" i]",
  "section[class*=\"content\" i]",
  "section[class*=\"entry\" i]",
  "section[class*=\"feature\" i]",
  "section[class*=\"markdown\" i]",
  "section[class*=\"post\" i]",
  "section[class*=\"prose\" i]",
  "section[class*=\"story\" i]",
  "section[class*=\"text\" i]",
  "div[class*=\"article\" i]",
  "div[class*=\"body\" i]",
  "div[class*=\"content\" i]",
  "div[class*=\"detail\" i]",
  "div[class*=\"entry\" i]",
  "div[class*=\"feature\" i]",
  "div[class*=\"markdown\" i]",
  "div[class*=\"post\" i]",
  "div[class*=\"prose\" i]",
  "div[class*=\"story\" i]",
  "div[class*=\"text\" i]",
  "section[id*=\"article\" i]",
  "section[id*=\"body\" i]",
  "section[id*=\"content\" i]",
  "section[id*=\"detail\" i]",
  "section[id*=\"entry\" i]",
  "section[id*=\"markdown\" i]",
  "section[id*=\"post\" i]",
  "section[id*=\"prose\" i]",
  "section[id*=\"story\" i]",
  "section[id*=\"text\" i]",
  "div[id*=\"article\" i]",
  "div[id*=\"body\" i]",
  "div[id*=\"content\" i]",
  "div[id*=\"detail\" i]",
  "div[id*=\"entry\" i]",
  "div[id*=\"markdown\" i]",
  "div[id*=\"post\" i]",
  "div[id*=\"prose\" i]",
  "div[id*=\"story\" i]",
  "div[id*=\"text\" i]",
  "table",
  "td",
].join(",");

const FALLBACK_CONTENT_POSITIVE_TOKEN_PATTERN = /(?:^|[\s_-])(?:article|body|content|copy|detail|entry|feature|main|markdown|newsarticle|post|prose|story|text|本文|正文|文章)(?:$|[\s_-])/i;
const FALLBACK_CONTENT_NEGATIVE_TOKEN_PATTERN = /(?:^|[\s_-])(?:ad|advert|archive|author|bibliography|card|carousel|category|citation|comments?|discuss|featured|footer|footnote|grid|latest|menu|most|nav|organic|partner|popular|promo|rank|rbox|reference|reflist|reel|recommend|recommended|recirc|related|search|share|sidebar|sponsor|story-list|tag|teaser|trend|trc|widget|排行|推薦|熱門|相關|輪播|側欄|廣告|分類|搜尋|分享)(?:$|[\s_-])/i;

const NON_READING_LINK_TEXT_PATTERNS = [
  /^home$/i,
  /^首頁$/,
  /^主頁$/,
  /^網站首頁$/,
  /^read more$/i,
  /^source link$/i,
  /^article source$/i,
  /^share$/i,
  /^comments?$/i,
  /^latest$/i,
  /^most read$/i,
  /^newsletter$/i,
  /^popular$/i,
  /^recommended$/i,
  /facebook\.com/i,
  /instagram\.com/i,
  /t\.me\//i,
  /(?:按讚|訂閱|追蹤).{0,20}(?:FB|Facebook|IG|Instagram|TG|Telegram|LINE)?/i,
  /^login$/i,
  /^sign in$/i,
  /^edit(?: links?)?$/i,
  /^相關(?:文章|報導|閱讀)?$/i,
  /^延伸閱讀$/i,
  /^登入後即可張貼留言。?$/i,
  /(?:登入|登錄).{0,16}留言/,
  /(?:賽程|直播|轉播).{0,24}總整理/,
  /特約記者$/,
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
  const maxImages = options.maxImages ?? GENERAL_PAGE_DEFAULT_MAX_IMAGES;

  const currentUrl = normalizeUrl(input.url) ?? input.url;
  const rawCanonicalUrl = firstAttribute(input.document, [
    "link[rel=\"canonical\"]",
    "link[rel=\"Canonical\"]",
  ], "href");
  const canonicalUrl = rawCanonicalUrl
    ? normalizeHref(rawCanonicalUrl, currentUrl) ?? undefined
    : undefined;
  const sourceUrl = canonicalUrl ?? currentUrl;
  const sourceName = firstMetaContent(input.document, [
    "meta[property=\"og:site_name\"]",
    "meta[name=\"application-name\"]",
  ]) ?? hostnameLabel(sourceUrl);
  const headingTitle = firstHeading(input.document);
  const title = firstMetaContent(input.document, [
    "meta[property=\"og:title\"]",
    "meta[name=\"twitter:title\"]",
  ]) ?? normalizeWhitespace(input.document.title ?? "") ?? headingTitle;
  const titleAnchors = uniqueTitleAnchors(title, headingTitle);
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
  const extractionRoot = findBestMainRoot(input.document, minMainTextLength, titleAnchors);
  const rootText = extractionRoot ? readableText(extractionRoot) ?? "" : "";
  const fallbackRoot = !selectedTextIsUseful
    ? findBestFallbackContentRoot(input.document, currentUrl, titleAnchors, minMainTextLength)
    : null;
  const fallbackRootText = fallbackRoot ? readableText(fallbackRoot) ?? "" : "";
  const bodyText = input.document.body ? readableText(input.document.body) ?? "" : "";

  let method: ReadingSurfaceExtractionMethod = "fallback";
  let mainText = "";
  let readingRoot: Element | null = null;
  const warnings: ReadingExtractionWarning[] = [];

  if (selectedTextIsUseful) {
    method = "selection";
    mainText = selectedText;
    readingRoot = null;
    warnings.push("selection-only");
  } else if (
    rootText &&
    rootText.length >= minMainTextLength &&
    fallbackRootText &&
    fallbackRootText.length >= minMainTextLength &&
    shouldPreferFallbackRootOverSemanticRoot(extractionRoot, fallbackRoot, rootText, fallbackRootText, titleAnchors)
  ) {
    method = "fallback";
    mainText = fallbackRootText;
    readingRoot = fallbackRoot;
    if (!isConfidentFallbackReadingRoot(fallbackRoot, fallbackRootText, titleAnchors))
      warnings.push("no-main-content");
  } else if (rootText && rootText.length >= minMainTextLength) {
    method = "semantic-html";
    mainText = rootText;
    readingRoot = extractionRoot;
  } else if (rootText && isUsefulShortSemanticReadingRoot(extractionRoot, rootText, minMainTextLength)) {
    method = "semantic-html";
    mainText = rootText;
    readingRoot = extractionRoot;
    warnings.push("very-short-content");
  } else if (fallbackRootText && fallbackRootText.length >= minMainTextLength) {
    method = "fallback";
    mainText = fallbackRootText;
    readingRoot = fallbackRoot;
    if (!isConfidentFallbackReadingRoot(fallbackRoot, fallbackRootText, titleAnchors))
      warnings.push("no-main-content");
  } else if (rootText && bodyText && bodyText.length >= minMainTextLength && isShortSemanticRootFalseNegative(rootText, bodyText, minMainTextLength)) {
    method = "fallback";
    mainText = bodyText;
    readingRoot = input.document.body;
    warnings.push("large-navigation-noise");
  } else if (rootText) {
    method = "semantic-html";
    mainText = rootText;
    readingRoot = extractionRoot;
    warnings.push("very-short-content");
  } else if (bodyText && bodyText.length >= minMainTextLength) {
    method = "fallback";
    mainText = bodyText;
    readingRoot = input.document.body;
    warnings.push("no-main-content", "large-navigation-noise");
  } else if (bodyText) {
    method = "fallback";
    mainText = bodyText;
    readingRoot = input.document.body;
    warnings.push("no-main-content", "very-short-content");
  } else {
    method = "fallback";
    warnings.push("no-main-content");
  }

  if (!selectedTextIsUseful && titleAnchors.length > 0 && mainText)
    mainText = trimLeadingTextBeforeTitles(mainText, titleAnchors);

  const truncatedContentPreview = looksTruncatedContentPreview(title, mainText);
  mainText = finalizeGeneralPageReadingText(mainText);

  const extractionSignalRoot = readingRoot ?? extractionRoot ?? fallbackRoot;

  if (looksBlockedOrPaywalled(input.document, extractionSignalRoot, title, mainText, minMainTextLength)) {
    warnings.push("login-or-paywall-like");
  }

  if (looksDynamicContentPartial(title, mainText)) {
    warnings.push("dynamic-content-partial");
  }

  if (looksUnavailablePage(currentUrl, title, mainText)) {
    warnings.push("unavailable-page");
  }

  if (truncatedContentPreview) {
    warnings.push("truncated-content-preview");
  }

  if (!selectedTextIsUseful && mainText) {
    warnings.push(...nonArticlePageWarnings(input.document, extractionSignalRoot, mainText, currentUrl, title));
  }

  const linkRoot = readingRoot ?? extractionRoot ?? fallbackRoot ?? input.document.body ?? input.document.documentElement;
  const metadataRoot = clonePrunedReadingRoot(linkRoot);
  const links = collectLinks(metadataRoot, sourceUrl, maxLinks);
  const images = collectImages(metadataRoot, sourceUrl, maxImages);
  if (shouldSuppressFallbackArticleNoise({
    method,
    mainText,
    title,
    titleAnchors,
    currentUrl,
    linkCount: links.length,
    warnings,
  })) {
    removeWarning(warnings, "no-main-content");
    removeWarning(warnings, "large-navigation-noise");
  }
  if (shouldSuppressSemanticArticleNavigationNoise({
    method,
    document: input.document,
    readingRoot,
    mainText,
    linkCount: links.length,
    warnings,
  })) {
    removeWarning(warnings, "large-navigation-noise");
  }

  const status = resolveExtractionStatus(mainText, warnings, minMainTextLength);

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

function shouldSuppressFallbackArticleNoise(input: {
  method: ReadingSurfaceExtractionMethod;
  mainText: string;
  title?: string;
  titleAnchors: readonly string[];
  currentUrl: string;
  linkCount: number;
  warnings: readonly ReadingExtractionWarning[];
}): boolean {
  if (input.method !== "fallback")
    return false;
  if (!input.warnings.includes("no-main-content") && !input.warnings.includes("large-navigation-noise"))
    return false;
  if (input.warnings.includes("login-or-paywall-like") || input.warnings.includes("dynamic-content-partial"))
    return false;
  if (input.mainText.length < 900 || input.linkCount > 24)
    return false;
  if (hasIndexOrSearchSurfaceSignal(input.currentUrl, input.title, input.mainText))
    return false;
  const hasNoMainWarning = input.warnings.includes("no-main-content");
  if (hasNoMainWarning && !textContainsComparableAnyTitle(input.mainText, input.titleAnchors))
    return false;
  const sentenceCount = (input.mainText.match(/[。！？.!?]/g) ?? []).length;
  return sentenceCount >= 6;
}

function shouldSuppressSemanticArticleNavigationNoise(input: {
  method: ReadingSurfaceExtractionMethod;
  document: Document;
  readingRoot: Element | null;
  mainText: string;
  linkCount: number;
  warnings: readonly ReadingExtractionWarning[];
}): boolean {
  if (input.method !== "semantic-html" || !input.readingRoot)
    return false;
  if (!input.warnings.includes("large-navigation-noise"))
    return false;
  if (input.warnings.some((warning) =>
    warning === "no-main-content" ||
    warning === "login-or-paywall-like" ||
    warning === "dynamic-content-partial" ||
    warning === "unavailable-page"
  )) {
    return false;
  }
  if (input.mainText.length < 150 || input.linkCount > 12)
    return false;
  if (input.document.querySelectorAll("article").length !== 1)
    return false;
  const root = input.readingRoot;
  const semanticArticle = root.matches("article, [itemprop=\"articleBody\"]") || Boolean(root.closest("article"));
  if (!semanticArticle)
    return false;
  const sentenceCount = (input.mainText.match(/[。！？.!?]/g) ?? []).length;
  return sentenceCount >= 2;
}

function removeWarning(warnings: ReadingExtractionWarning[], warning: ReadingExtractionWarning): void {
  let index = warnings.indexOf(warning);
  while (index >= 0) {
    warnings.splice(index, 1);
    index = warnings.indexOf(warning);
  }
}

function findBestMainRoot(documentRef: Document, minLength: number, titleAnchors: readonly string[]): Element | null {
  const candidates: Element[] = [];
  for (const selector of MAIN_ROOT_SELECTORS) {
    candidates.push(...Array.from(documentRef.querySelectorAll(selector)));
  }
  if (candidates.length === 0)
    return null;

  const ranked = Array.from(new Set(candidates))
    .map((element) => ({
      element,
      text: readableText(element) ?? "",
      score: 0,
    }))
    .filter((candidate) => candidate.text.length > 0)
    .map((candidate) => ({
      ...candidate,
      score: scoreMainRootCandidate(candidate.element, candidate.text, titleAnchors),
    }))
    .sort((a, b) => b.score - a.score || b.text.length - a.text.length);

  const preferred = ranked.filter((candidate) =>
    !isWeakTitlelessSemanticArticleCard(candidate.element, candidate.text, titleAnchors)
  );
  const bodyLike = preferred.find((candidate) =>
    candidate.text.length >= minLength && isArticleBodyLikeElement(candidate.element, candidate.text, titleAnchors)
  );
  if (bodyLike)
    return bodyLike.element;

  return preferred.find((candidate) => candidate.text.length >= minLength)?.element
    ?? preferred[0]?.element
    ?? null;
}

function scoreMainRootCandidate(element: Element, text: string, titleAnchors: readonly string[]): number {
  const tagName = element.tagName.toLowerCase();
  const identity = elementIdentity(element);
  const linkCount = element.querySelectorAll("a[href]").length;
  const paragraphCount = element.querySelectorAll("p").length;
  const headingCount = element.querySelectorAll("h1, h2").length;
  const imageCount = element.querySelectorAll("img").length;
  const linkDensity = linkedTextLength(element) / Math.max(text.length, 1);
  const hasTitleSignal = hasHeadingSimilarToAnyTitle(element, titleAnchors) ||
    textContainsComparableAnyTitle(text, titleAnchors);
  const hasContextTitleSignal = hasTitleSignal ||
    hasAncestorHeadingSimilarToAnyTitle(element, titleAnchors);

  let score = Math.min(text.length, 5000) / 48;
  score += Math.min(paragraphCount, 16) * 18;
  score += Math.min(headingCount, 4) * 8;
  score += Math.min(imageCount, 4) * 3;
  score -= linkCount * 4;
  score -= linkDensity * 260;

  if (tagName === "article")
    score += 140;
  if (tagName === "main")
    score += 16;
  if (isArticleBodyLikeElement(element, text, titleAnchors))
    score += 180;
  if (/(?:^|[\s_-])(?:article|body|content|entry|post|story|本文|正文)(?:$|[\s_-])/i.test(identity))
    score += 70;
  if (/(?:^|[\s_-])(?:ad|advert|breadcrumb|comment|footer|header|latest|menu|nav|popular|rank|recommend|related|share|sidebar|ticker|trend|widget|排行|推薦|熱門|相關|側欄|廣告|選單|導覽)(?:$|[\s_-])/i.test(identity))
    score -= 120;
  if (isWeakTitlelessSemanticArticleCard(element, text, titleAnchors))
    score -= paragraphCount <= 2 || text.length < 900 ? 520 : 180;
  if (hasHeadingSimilarToAnyTitle(element, titleAnchors))
    score += 140;
  if (textContainsComparableAnyTitle(text, titleAnchors))
    score += 70;
  if (hasContextTitleSignal && !hasTitleSignal)
    score += 80;
  if (text.length < 420 && linkCount >= 3)
    score -= 80;
  return score;
}

function isWeakTitlelessSemanticArticleCard(
  element: Element,
  text: string,
  titleAnchors: readonly string[],
): boolean {
  if (element.tagName.toLowerCase() !== "article" || titleAnchors.length === 0)
    return false;
  if (isArticleBodyLikeElement(element, text, titleAnchors))
    return false;
  const paragraphCount = element.querySelectorAll("p").length;
  if (
    text.length >= 160 &&
    paragraphCount >= 2 &&
    hasStrongArticleContainerIdentity(elementIdentity(element))
  ) {
    return false;
  }
  const hasTitleSignal = hasHeadingSimilarToAnyTitle(element, titleAnchors) ||
    textContainsComparableAnyTitle(text, titleAnchors);
  return !hasTitleSignal && (paragraphCount <= 2 || text.length < 900);
}

function isArticleBodyLikeElement(
  element: Element,
  text: string,
  titleAnchors: readonly string[],
): boolean {
  const paragraphCount = element.querySelectorAll("p").length;
  if (paragraphCount < 3 || text.length < DEFAULT_MIN_MAIN_TEXT_LENGTH)
    return false;
  const identity = elementIdentity(element);
  const linkCount = element.querySelectorAll("a[href]").length;
  const linkDensity = linkedTextLength(element) / Math.max(text.length, 1);
  const hasExplicitBodyIdentity = hasExplicitArticleBodyIdentity(identity);
  const hasBodyIdentity = hasExplicitBodyIdentity || FALLBACK_CONTENT_POSITIVE_TOKEN_PATTERN.test(identity);
  const hasTitleContext = hasHeadingSimilarToAnyTitle(element, titleAnchors) ||
    textContainsComparableAnyTitle(text, titleAnchors) ||
    hasAncestorHeadingSimilarToAnyTitle(element, titleAnchors);
  if (FALLBACK_CONTENT_NEGATIVE_TOKEN_PATTERN.test(identity) && (!hasExplicitBodyIdentity || linkCount >= 8))
    return false;
  return hasBodyIdentity && (hasTitleContext || hasExplicitBodyIdentity) && linkDensity < 0.72;
}

function findBestFallbackContentRoot(
  documentRef: Document,
  url: string,
  titleAnchors: readonly string[],
  minLength: number,
): Element | null {
  if (!documentRef.body)
    return null;

  const candidates = Array.from(new Set(
    [
      ...Array.from(documentRef.body.querySelectorAll(FALLBACK_CONTENT_CANDIDATE_SELECTOR)),
      ...findHeadingAnchoredCandidateRoots(documentRef, titleAnchors),
    ],
  ));

  const ranked = candidates
    .map((element) => scoreFallbackContentCandidate(element, titleAnchors, minLength))
    .filter((candidate): candidate is FallbackContentCandidateScore => candidate !== null)
    .sort((a, b) => b.score - a.score);

  return ranked[0]?.element ?? null;
}

function shouldPreferFallbackRootOverSemanticRoot(
  semanticRoot: Element | null,
  fallbackRoot: Element | null,
  semanticText: string,
  fallbackText: string,
  titleAnchors: readonly string[],
): boolean {
  if (!semanticRoot || !fallbackRoot || semanticRoot === fallbackRoot)
    return false;
  const tagName = semanticRoot.tagName.toLowerCase();
  const isBroadMain = tagName === "main" || semanticRoot.getAttribute("role") === "main";
  const fallbackIdentity = elementIdentity(fallbackRoot);
  const semanticLinkCount = semanticRoot.querySelectorAll("a[href]").length;
  const semanticLinkDensity = linkedTextLength(semanticRoot) / Math.max(semanticText.length, 1);
  const fallbackIsCleanBody = isConfidentFallbackReadingRoot(fallbackRoot, fallbackText, titleAnchors) ||
    isArticleBodyLikeElement(fallbackRoot, fallbackText, titleAnchors);
  const fallbackHasContextTitle = hasHeadingSimilarToAnyTitle(fallbackRoot, titleAnchors) ||
    hasAncestorHeadingSimilarToAnyTitle(fallbackRoot, titleAnchors);
  if (
    tagName === "article" &&
    semanticText.length >= 160 &&
    !containsElement(semanticRoot, fallbackRoot) &&
    !fallbackHasContextTitle
  ) {
    return false;
  }
  if (
    tagName === "article" &&
    !isArticleBodyLikeElement(fallbackRoot, fallbackText, titleAnchors) &&
    !hasStrongArticleContainerIdentity(fallbackIdentity)
  ) {
    return false;
  }
  if (
    fallbackIsCleanBody &&
    containsElement(semanticRoot, fallbackRoot) &&
    (hasReadingLayoutNoise(semanticRoot) || semanticLinkCount >= 12 || semanticLinkDensity >= 0.18) &&
    fallbackText.length >= Math.max(240, semanticText.length * 0.2)
  ) {
    return true;
  }
  if (isBroadMain && containsElement(semanticRoot, fallbackRoot)) {
    const hasLayoutNoise = hasReadingLayoutNoise(semanticRoot);
    return hasLayoutNoise && fallbackText.length >= semanticText.length * (fallbackHasContextTitle ? 0.35 : 0.55);
  }

  const semanticHasTitle = textContainsComparableAnyTitle(semanticText, titleAnchors);
  const fallbackParagraphCount = fallbackRoot.querySelectorAll("p").length;
  const fallbackLinkDensity = linkedTextLength(fallbackRoot) / Math.max(fallbackText.length, 1);
  return !semanticHasTitle &&
    fallbackParagraphCount >= 3 &&
    fallbackLinkDensity < (fallbackHasContextTitle ? 0.75 : 0.5) &&
    fallbackText.length >= Math.max(semanticText.length * (fallbackHasContextTitle ? 1.1 : 1.5), semanticText.length + 240);
}

function isConfidentFallbackReadingRoot(
  root: Element | null,
  text: string,
  titleAnchors: readonly string[],
): boolean {
  if (!root || text.length < 300)
    return false;
  const tagName = root.tagName.toLowerCase();
  if (tagName === "body" || tagName === "html")
    return false;

  const metrics = prunedElementMetrics(root, text);
  const { paragraphCount, linkCount, articleCount, linkDensity } = metrics;
  const identity = elementIdentity(root);
  const hasTitleContext = hasHeadingSimilarToAnyTitle(root, titleAnchors) ||
    textContainsComparableAnyTitle(text, titleAnchors) ||
    hasAncestorHeadingSimilarToAnyTitle(root, titleAnchors);
  const hasStrongArticleContainer = hasStrongArticleContainerIdentity(identity);

  if (FALLBACK_CONTENT_NEGATIVE_TOKEN_PATTERN.test(identity) && !isArticleBodyLikeElement(root, text, titleAnchors))
    return false;
  if (tagName === "main" && hasReadingLayoutNoise(root))
    return false;
  if (articleCount >= 2 || linkCount >= 64 || linkDensity >= 0.72)
    return false;
  if (paragraphCount < 3 && text.length < 520)
    return false;
  if ((tagName === "table" || tagName === "td") && paragraphCount >= 3 && text.length >= 600 && linkDensity < 0.12)
    return true;
  if (paragraphCount >= 5 && text.length >= 900 && linkCount <= 24 && linkDensity < 0.22)
    return true;
  return hasTitleContext ||
    (hasStrongArticleContainer && paragraphCount >= 4 && text.length >= 500 && linkDensity < 0.35) ||
    hasSubstantialArticleProse({ text, linkCount, linkDensity });
}

function isConfidentArticleLikeReadingRoot(
  root: Element | null,
  text: string,
  titleAnchors: readonly string[],
  hasArticleMeta: boolean,
): boolean {
  if (!root || text.length < 280)
    return false;
  const tagName = root.tagName.toLowerCase();
  if (tagName === "body" || tagName === "html")
    return false;
  const metrics = prunedElementMetrics(root, text);
  const { paragraphCount, linkCount, articleCount, controlCount, linkDensity } = metrics;
  const identity = elementIdentity(root);
  const hasTitleContext = hasHeadingSimilarToAnyTitle(root, titleAnchors) ||
    textContainsComparableAnyTitle(text, titleAnchors) ||
    hasAncestorHeadingSimilarToAnyTitle(root, titleAnchors);

  if (!hasTitleContext && !hasArticleMeta)
    return hasSubstantialArticleProse({ text, linkCount, linkDensity });
  if (hasTitleContext && controlCount < 2 && !FALLBACK_CONTENT_NEGATIVE_TOKEN_PATTERN.test(identity) && hasSubstantialArticleProse({ text, linkCount, linkDensity }))
    return true;
  if (hasTitleContext && hasArticleMeta && paragraphCount <= 2 && text.length >= 280 && text.length < 760 && linkCount <= 12 && linkDensity < 0.35)
    return true;
  if (paragraphCount < 3 && text.length < 900)
    return false;
  if (articleCount >= 3 || linkCount >= 96 || linkDensity >= 0.68)
    return false;
  if ((controlCount >= 2 || FALLBACK_CONTENT_NEGATIVE_TOKEN_PATTERN.test(identity)) && linkCount >= 12)
    return false;
  if (hasReadingLayoutNoise(root) && paragraphCount < 8 && text.length < 1400)
    return false;
  return true;
}

function hasSubstantialArticleProse(metrics: {
  text: string;
  linkCount: number;
  linkDensity: number;
}): boolean {
  if (metrics.text.length < 900 || metrics.linkCount > 36 || metrics.linkDensity >= 0.25)
    return false;
  const sentenceCount = (metrics.text.match(/[。！？.!?]/g) ?? []).length;
  return sentenceCount >= 6;
}

function prunedElementMetrics(root: Element, text: string): {
  paragraphCount: number;
  linkCount: number;
  articleCount: number;
  controlCount: number;
  linkDensity: number;
} {
  const prunedRoot = clonePrunedReadingRoot(root);
  const paragraphCount = prunedRoot.querySelectorAll("p").length;
  const linkCount = prunedRoot.querySelectorAll("a[href]").length;
  const articleCount = prunedRoot.querySelectorAll("article").length;
  const controlCount = prunedRoot.querySelectorAll("button, input, select, [role=\"button\"], [role=\"tab\"], form").length;
  return {
    paragraphCount,
    linkCount,
    articleCount,
    controlCount,
    linkDensity: linkedTextLength(prunedRoot) / Math.max(text.length, 1),
  };
}

function hasStrongArticleContainerIdentity(identity: string): boolean {
  return /(?:^|[\s_-])(?:article|articlebody|article-body|articlecontent|article-content|entrycontent|entry-content|newsarticle|news-detail|news_detail|postcontent|post-content|storybody|story-body|contentbody|content-body|本文|正文)(?:$|[\s_-])/i.test(identity);
}

function hasExplicitArticleBodyIdentity(identity: string): boolean {
  return /(?:articlebody|entitybody|storybody|contentbody|newsbody|article-body|entity-body|story-body|content-body|news-body|本文|正文)/i.test(identity);
}

function hasIndexOrSearchSurfaceSignal(url: string, title: string | undefined, text: string): boolean {
  const urlTitleSignals = `${url} ${title ?? ""}`.toLowerCase();
  if (/(?:search results?|results for|filter by|query=|[?&]q=|index page|directory|latest entries|latest news|top stories|home ?page|front page|topics|list page|category hub|搜尋|索引頁|列表頁|最新消息|公告列表)/i.test(urlTitleSignals))
    return true;
  const prefix = text.slice(0, 700).toLowerCase();
  return /(?:front page|home ?page|top stories|latest news|category hub|search results?|list page|not a single complete article|索引頁|列表頁|不要把.+完整文章)/i.test(prefix);
}

function containsElement(root: Element, candidate: Element): boolean {
  if (typeof root.contains === "function")
    return root.contains(candidate);
  return Array.from(root.querySelectorAll("*")).includes(candidate);
}

function elementIdentity(element: Element): string {
  return `${element.tagName} ${element.getAttribute("class") ?? ""} ${element.getAttribute("id") ?? ""}`;
}

function hasReadingLayoutNoise(element: Element): boolean {
  return Boolean(element.querySelector([
    "nav",
    "aside",
    "[class*=\"ad\" i]",
    "[class*=\"banner\" i]",
    "[class*=\"carousel\" i]",
    "[class*=\"latest\" i]",
    "[class*=\"playlist\" i]",
    "[class*=\"promo\" i]",
    "[class*=\"recommend\" i]",
    "[class*=\"related\" i]",
    "[class*=\"sidebar\" i]",
    "[class*=\"ticker\" i]",
  ].join(",")));
}

function findHeadingAnchoredCandidateRoots(documentRef: Document, titleAnchors: readonly string[]): Element[] {
  if (titleAnchors.length === 0)
    return [];
  const roots: Element[] = [];
  for (const heading of Array.from(documentRef.querySelectorAll("h1,h2"))) {
    const headingText = normalizeWhitespace(heading.textContent ?? "") ?? "";
    if (!isComparableToAnyTitle(headingText, titleAnchors))
      continue;
    let current: Element | null = heading;
    let depth = 0;
    while (current && current !== documentRef.body && depth < 7) {
      roots.push(current);
      current = current.parentElement;
      depth += 1;
    }
  }
  return roots;
}

interface FallbackContentCandidateScore {
  element: Element;
  score: number;
}

function scoreFallbackContentCandidate(
  element: Element,
  titleAnchors: readonly string[],
  minLength: number,
): FallbackContentCandidateScore | null {
  const text = readableText(element) ?? "";
  if (text.length < minLength)
    return null;

  const metrics = prunedElementMetrics(element, text);
  const { paragraphCount, linkCount, controlCount, linkDensity } = metrics;
  if (paragraphCount < 2 && text.length < minLength * 2)
    return null;

  const imageCount = element.querySelectorAll("img").length;

  const tagName = element.tagName.toLowerCase();
  const identity = elementIdentity(element);
  const hasTitleSignal = hasHeadingSimilarToAnyTitle(element, titleAnchors) ||
    textContainsComparableAnyTitle(text, titleAnchors);
  const hasContextTitleSignal = hasTitleSignal || hasAncestorHeadingSimilarToAnyTitle(element, titleAnchors);
  const hasStrongArticleContainer = hasStrongArticleContainerIdentity(identity);
  if (linkDensity > (hasContextTitleSignal ? 0.75 : 0.45))
    return null;
  const hasNegativeIdentity = FALLBACK_CONTENT_NEGATIVE_TOKEN_PATTERN.test(identity);
  if (!isGeneralPageCandidateElementStructurallyEligible(element))
    return null;

  let score = Math.min(text.length, 3600) / 36;
  score += Math.min(paragraphCount, 12) * 16;
  score -= linkCount * 7;
  score -= imageCount * 2;
  score -= linkDensity * 120;

  if (FALLBACK_CONTENT_POSITIVE_TOKEN_PATTERN.test(identity))
    score += 75;
  if (tagName === "table" || tagName === "td")
    score += 150;
  if (hasStrongArticleContainer && text.length >= 360 && controlCount < 2 && linkDensity < 0.45)
    score += 80;
  if (hasStrongArticleContainer && paragraphCount >= 4 && text.length >= 500 && controlCount < 2 && linkDensity < 0.45)
    score += 120;
  if (isArticleBodyLikeElement(element, text, titleAnchors))
    score += 160;
  if (hasNegativeIdentity)
    score -= 80;
  if (tagName === "main" && hasReadingLayoutNoise(element))
    score -= 90;
  if (tagName === "article" && hasReadingLayoutNoise(element))
    score -= 90;
  if (element.querySelector("h1"))
    score += 24;
  if (hasHeadingSimilarToAnyTitle(element, titleAnchors))
    score += 45;
  if (textContainsComparableAnyTitle(text, titleAnchors))
    score += 28;
  if (hasContextTitleSignal && !hasTitleSignal)
    score += 120;

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
  const paragraphCount = documentRef.querySelectorAll("p").length;
  const path = urlPath(url);
  const bodyText = normalizeWhitespace(documentRef.body?.textContent ?? "") ?? "";
  const urlTitleSignals = `${url} ${title ?? ""}`.toLowerCase();
  const bodySignals = bodyText.slice(0, 1200).toLowerCase();
  const signals = `${urlTitleSignals} ${bodySignals}`;

  const hasTitleHeading = title
    ? Array.from(documentRef.querySelectorAll("h1")).some((heading) => isComparableToAnyTitle(heading.textContent ?? "", [title]))
    : false;

  if (
    path === "/" &&
    (articleCount >= 2 || linkCount >= 6 || imageCount >= 3)
  ) {
    return true;
  }

  if (
    /\b(?:front page|home ?page|top stories|latest news|category hub|search results?|archive|topics|index|list page)\b/.test(urlTitleSignals) &&
    (articleCount >= 2 || linkCount >= 6 || imageCount >= 3 || listItemCount >= 6)
  ) {
    return true;
  }

  if (
    /\b(?:front page|home ?page|top stories|latest news|category hub|search results?|list page)\b/.test(bodySignals) &&
    (articleCount >= 2 || linkCount >= 8 || imageCount >= 3 || listItemCount >= 6)
  ) {
    return true;
  }

  if (
    /(?:首頁|索引頁|列表頁|即時新聞|熱門新聞|最新消息|公告列表)/.test(signals) &&
    (linkCount >= 3 || imageCount >= 3 || listItemCount >= 3)
  ) {
    return !(hasTitleHeading && paragraphCount >= 3);
  }

  return false;
}

function linkedTextLength(element: Element): number {
  return Array.from(element.querySelectorAll("a[href]")).reduce((length, link) => {
    return length + (normalizeWhitespace(link.textContent ?? "")?.length ?? 0);
  }, 0);
}

function uniqueTitleAnchors(title?: string, headingTitle?: string): string[] {
  const anchors = [
    title,
    headingTitle,
    ...(title ? title.split(/\s[-|｜]\s|\s*\|\s*|\s*-\s*/u).filter((part) => part.trim().length >= 12) : []),
  ]
    .map((value) => normalizeWhitespace(value ?? "") ?? "")
    .filter((value) => value.length >= 6);
  const seen = new Set<string>();
  return anchors.filter((value) => {
    const comparable = normalizeComparableText(value);
    if (!comparable || seen.has(comparable))
      return false;
    seen.add(comparable);
    return true;
  });
}

function hasHeadingSimilarToAnyTitle(element: Element, titleAnchors: readonly string[]): boolean {
  if (titleAnchors.length === 0)
    return false;
  for (const heading of Array.from(element.querySelectorAll("h1,h2"))) {
    if (isComparableToAnyTitle(heading.textContent ?? "", titleAnchors))
      return true;
  }
  return false;
}

function hasAncestorHeadingSimilarToAnyTitle(element: Element, titleAnchors: readonly string[]): boolean {
  if (titleAnchors.length === 0)
    return false;
  let current = element.parentElement;
  let depth = 0;
  while (current && depth < 8) {
    if (hasHeadingSimilarToAnyTitle(current, titleAnchors))
      return true;
    current = current.parentElement;
    depth += 1;
  }
  return false;
}

function isComparableToAnyTitle(value: string, titleAnchors: readonly string[]): boolean {
  const normalizedValue = normalizeComparableText(value);
  if (!normalizedValue)
    return false;
  return titleAnchors.some((title) => {
    const normalizedTitle = normalizeComparableText(title);
    return normalizedTitle.length >= 6 &&
      (normalizedTitle.includes(normalizedValue) || normalizedValue.includes(normalizedTitle));
  });
}

function textContainsComparableAnyTitle(text: string, titleAnchors: readonly string[]): boolean {
  const normalizedText = normalizeComparableText(text.slice(0, 1800));
  return titleAnchors.some((title) => {
    const normalizedTitle = normalizeComparableText(title);
    return normalizedTitle.length >= 12 && normalizedText.includes(normalizedTitle);
  });
}

function trimLeadingTextBeforeTitles(text: string, titleAnchors: readonly string[]): string {
  for (const title of titleAnchors) {
    const trimmed = trimLeadingTextBeforeTitle(text, title);
    if (trimmed !== text)
      return trimmed;
  }
  return text;
}

function trimLeadingTextBeforeTitle(text: string, title: string): string {
  const cleanTitle = normalizeWhitespace(title) ?? "";
  if (cleanTitle.length < 10)
    return text;

  const directIndex = text.indexOf(cleanTitle);
  if (directIndex > 0 && directIndex < 1400 && shouldDropLeadingPageChrome(text.slice(0, directIndex)))
    return text.slice(directIndex).trim();

  const normalizedTitle = normalizeComparableText(cleanTitle);
  if (normalizedTitle.length < 12)
    return text;
  const prefixWindow = text.slice(0, 1400);
  const normalizedWindow = normalizeComparableText(prefixWindow);
  const comparableIndex = normalizedWindow.indexOf(normalizedTitle);
  if (comparableIndex <= 0)
    return text;

  const titleWords = normalizedTitle.split(/\s+/).filter(Boolean);
  const anchor = titleWords.length >= 3 ? titleWords.slice(0, 3).join(" ") : titleWords[0];
  if (!anchor)
    return text;
  const roughAnchor = escapeRegExp(anchor).replace(/\s+/g, ".{0,12}");
  const match = prefixWindow.match(new RegExp(roughAnchor, "iu"));
  if (!match || match.index === undefined || match.index <= 0)
    return text;
  if (!shouldDropLeadingPageChrome(prefixWindow.slice(0, match.index)))
    return text;
  return text.slice(match.index).trim();
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function shouldDropLeadingPageChrome(prefix: string): boolean {
  const text = normalizeWhitespace(prefix) ?? "";
  if (text.length < 12)
    return false;
  const timestampCount = (text.match(/\b\d{1,2}:\d{2}\b/g) ?? []).length;
  const navTokenCount = (text.match(/首頁|即時|熱門|影音|直播|社會|政治|生活|國際|財經|娛樂|體育|科技|健康|更多|搜尋|登入|分享|facebook|line/gi) ?? []).length;
  const punctuationCount = (text.match(/[｜|>〉、]/g) ?? []).length;
  return timestampCount >= 2 ||
    navTokenCount >= 4 ||
    punctuationCount >= 5;
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
  pruneStandaloneLinkedTextUtilities(clone);
  addBlockBoundaries(clone);
  return normalizeWhitespace(cleanCommonPageNoise(clone.textContent ?? ""));
}

// Parser-advisor candidates must pass through the same structural cleanup as
// the default Page extraction. Otherwise a model-selected candidate can
// reintroduce author cards, recirculation modules, and controls that the first
// extraction already removed.
export function extractGeneralPageCandidateElementText(root: Element): string {
  return finalizeGeneralPageReadingText(readableText(root) ?? "");
}

export function isGeneralPageCandidateElementStructurallyEligible(root: Element): boolean {
  const identity = elementIdentity(root);
  if (FALLBACK_CONTENT_NEGATIVE_TOKEN_PATTERN.test(identity) && !hasExplicitArticleBodyIdentity(identity))
    return false;
  const tagName = root.tagName.toLowerCase();
  if (tagName === "article" || tagName === "main" || hasExplicitArticleBodyIdentity(identity))
    return true;
  const nestedArticleBody = Array.from(root.querySelectorAll(FALLBACK_CONTENT_CANDIDATE_SELECTOR)).find((candidate) => {
    const candidateIdentity = elementIdentity(candidate);
    const candidateTagName = candidate.tagName.toLowerCase();
    if (candidateTagName !== "article" && !hasStrongArticleContainerIdentity(candidateIdentity))
      return false;
    return extractGeneralPageCandidateElementText(candidate).length >= 120;
  });
  return !nestedArticleBody;
}

function clonePrunedReadingRoot(root: Element): Element {
  const clone = root.cloneNode(true) as Element;
  for (const selector of NON_READING_TEXT_SELECTORS) {
    for (const element of Array.from(clone.querySelectorAll(selector))) {
      element.remove();
    }
  }
  pruneNonReadingBlocks(clone);
  return clone;
}

function pruneNonReadingBlocks(root: Element): void {
  // Inspect utility clusters before individual controls are removed so the
  // decision can use their original structure instead of inferred wording.
  pruneLowProseUtilityBlocks(root);

  for (const selector of NON_READING_BLOCK_SELECTORS) {
    for (const element of Array.from(root.querySelectorAll(selector))) {
      if (shouldKeepReadingLayoutBlock(element))
        continue;
      element.remove();
    }
  }

  pruneRecirculationTailBlocks(root);

  for (const element of Array.from(root.querySelectorAll(NOISY_BLOCK_CANDIDATE_SELECTOR))) {
    const text = normalizeWhitespace(element.textContent ?? "") ?? "";
    if (!text)
      continue;
    if (text.length <= 420 && NOISY_BLOCK_TEXT_PATTERNS.some((pattern) => pattern.test(text)))
      element.remove();
  }
}

function pruneLowProseUtilityBlocks(root: Element): void {
  const elements = Array.from(root.querySelectorAll("section, div, ul, ol")).reverse();
  for (const element of elements) {
    if (element.matches("[role=\"doc-bibliography\"], [role=\"doc-endnotes\"], [role=\"doc-footnotes\"]"))
      continue;

    const text = normalizeWhitespace(element.textContent ?? "") ?? "";
    if (!text)
      continue;

    const paragraphCount = element.querySelectorAll("p, blockquote, pre, table, dl").length;
    const linkCount = element.querySelectorAll("a[href]").length;
    const controlCount = element.querySelectorAll("button, input, select, textarea, [role=\"button\"]").length;
    const linkDensity = linkedTextLength(element) / Math.max(text.length, 1);
    const articleCount = element.querySelectorAll("article").length;
    const headingCount = element.querySelectorAll("h2, h3, h4").length;
    const listItemCount = element.querySelectorAll("li").length;
    const sentenceCount = (text.match(/[。！？.!?]/g) ?? []).length;
    const hasSubstantialUnlinkedProse = text.length >= 900 &&
      paragraphCount >= 3 &&
      sentenceCount >= 5 &&
      linkDensity < 0.42;
    const repeatedLinkedCards = articleCount >= 4 &&
      linkCount >= 4 &&
      linkDensity >= 0.18;
    const denseLinkedDirectory = Math.max(headingCount, listItemCount) >= 4 &&
      linkCount >= 4 &&
      linkDensity >= 0.18 &&
      !hasSubstantialUnlinkedProse;
    const compactLinkedCardSection = text.length <= 760 &&
      paragraphCount === 0 &&
      headingCount >= 1 &&
      linkCount >= 3 &&
      linkDensity >= 0.18;
    const compactInteractiveCluster = text.length <= 760 &&
      paragraphCount === 0 &&
      linkCount >= 2 &&
      controlCount >= 1 &&
      linkDensity >= 0.45;
    const compactControlCluster = text.length <= 160 &&
      paragraphCount === 0 &&
      controlCount >= 1;
    if (repeatedLinkedCards || denseLinkedDirectory || compactLinkedCardSection || compactInteractiveCluster || compactControlCluster)
      element.remove();
  }
}

function pruneStandaloneLinkedTextUtilities(root: Element): void {
  for (const link of Array.from(root.querySelectorAll("a[href]"))) {
    if (typeof link.closest === "function" && !link.closest("p, blockquote, li, td, figcaption"))
      link.remove();
  }
  const elements = Array.from(root.querySelectorAll("section, div, ul, ol")).reverse();
  for (const element of elements) {
    const text = normalizeWhitespace(element.textContent ?? "") ?? "";
    if (!text || text.length > 280)
      continue;
    const paragraphCount = element.querySelectorAll("p, blockquote, pre, table, dl").length;
    const linkCount = element.querySelectorAll("a[href]").length;
    const linkDensity = linkedTextLength(element) / Math.max(text.length, 1);
    if (paragraphCount === 0 && linkCount >= 1 && linkDensity >= 0.72)
      element.remove();
  }
}

function pruneRecirculationTailBlocks(root: Element): void {
  for (const element of Array.from(root.querySelectorAll(RECIRCULATION_TAIL_HEADING_SELECTOR))) {
    if (!root.contains(element))
      continue;
    const text = directElementText(element) || normalizeWhitespace(element.textContent ?? "") || "";
    if (!text || text.length > 80)
      continue;
    if (!RECIRCULATION_TAIL_HEADING_PATTERNS.some((pattern) => pattern.test(text)))
      continue;

    const boundary = compactRecirculationBoundaryElement(element, root);
    if (hasSubstantialReadingSiblingAfter(boundary)) {
      removeInlineRecirculationCluster(boundary);
      continue;
    }

    let sibling = boundary.nextElementSibling;
    while (sibling) {
      const next = sibling.nextElementSibling;
      sibling.remove();
      sibling = next;
    }
    boundary.remove();
  }
}

function directElementText(element: Element): string {
  return normalizeWhitespace(Array.from(element.childNodes)
    .filter((node) => node.nodeType === 3)
    .map((node) => node.textContent ?? "")
    .join(" ")) ?? "";
}

function compactRecirculationBoundaryElement(element: Element, root: Element): Element {
  let boundary = element;
  let parent = element.parentElement;
  while (parent && parent !== root) {
    const tagName = parent.tagName.toLowerCase();
    if (tagName === "article" || tagName === "main" || parent.getAttribute("role") === "main")
      break;
    const text = normalizeWhitespace(parent.textContent ?? "") ?? "";
    if (!text || text.length > 420)
      break;
    if (hasSubstantialReadingSiblingBefore(boundary))
      break;
    boundary = parent;
    parent = parent.parentElement;
  }
  return boundary;
}

function hasSubstantialReadingSiblingBefore(element: Element): boolean {
  let sibling = element.previousElementSibling;
  let inspected = 0;
  while (sibling && inspected < 8) {
    inspected += 1;
    const text = normalizeWhitespace(sibling.textContent ?? "") ?? "";
    if (!text || FALLBACK_CONTENT_NEGATIVE_TOKEN_PATTERN.test(elementIdentity(sibling))) {
      sibling = sibling.previousElementSibling;
      continue;
    }
    const tagName = sibling.tagName.toLowerCase();
    const paragraphCount = sibling.querySelectorAll("p").length + (tagName === "p" ? 1 : 0);
    const headingCount = sibling.querySelectorAll("h2, h3, h4").length + (/^h[2-4]$/.test(tagName) ? 1 : 0);
    const linkDensity = linkedTextLength(sibling) / Math.max(text.length, 1);
    if (
      text.length >= 40 &&
      linkDensity < 0.22 &&
      (paragraphCount >= 1 || headingCount >= 1 || /[。.!?][\s\S]{40,}[。.!?]/.test(text))
    ) {
      return true;
    }
    sibling = sibling.previousElementSibling;
  }
  return false;
}

function hasSubstantialReadingSiblingAfter(element: Element): boolean {
  let sibling = element.nextElementSibling;
  let inspected = 0;
  while (sibling && inspected < 8) {
    inspected += 1;
    const text = normalizeWhitespace(sibling.textContent ?? "") ?? "";
    if (!text) {
      sibling = sibling.nextElementSibling;
      continue;
    }
    const tagName = sibling.tagName.toLowerCase();
    const paragraphCount = sibling.querySelectorAll("p").length + (tagName === "p" ? 1 : 0);
    const headingCount = sibling.querySelectorAll("h2, h3, h4").length + (/^h[2-4]$/.test(tagName) ? 1 : 0);
    const linkDensity = linkedTextLength(sibling) / Math.max(text.length, 1);
    if (RECIRCULATION_TAIL_HEADING_PATTERNS.some((pattern) => pattern.test(text)))
      return false;
    if (FALLBACK_CONTENT_NEGATIVE_TOKEN_PATTERN.test(elementIdentity(sibling))) {
      sibling = sibling.nextElementSibling;
      continue;
    }
    if (
      text.length >= 40 &&
      linkDensity < 0.22 &&
      (paragraphCount >= 1 || headingCount >= 1 || /[。.!?][\s\S]{40,}[。.!?]/.test(text))
    ) {
      return true;
    }
    sibling = sibling.nextElementSibling;
  }
  return false;
}

function removeInlineRecirculationCluster(heading: Element): void {
  let sibling = heading.nextElementSibling;
  while (sibling) {
    const next = sibling.nextElementSibling;
    const text = normalizeWhitespace(sibling.textContent ?? "") ?? "";
    const linkCount = sibling.querySelectorAll("a[href]").length;
    const paragraphCount = sibling.querySelectorAll("p").length;
    const linkDensity = linkedTextLength(sibling) / Math.max(text.length, 1);
    const looksLikeRecircBlock = text.length <= 760 &&
      linkCount >= 1 &&
      paragraphCount <= 3 &&
      (linkDensity >= 0.18 || RECIRCULATION_TAIL_HEADING_PATTERNS.some((pattern) => pattern.test(text)));
    if (!looksLikeRecircBlock)
      break;
    sibling.remove();
    sibling = next;
  }
  heading.remove();
}

function isShortSemanticRootFalseNegative(rootText: string, bodyText: string, minMainTextLength: number): boolean {
  if (rootText.length >= Math.min(120, minMainTextLength / 2))
    return false;
  if (/^(?:Advertising|Advertisement)$/i.test(rootText))
    return true;
  return bodyText.length >= Math.max(minMainTextLength, rootText.length * 8);
}

function isUsefulShortSemanticReadingRoot(
  root: Element | null,
  text: string,
  minMainTextLength: number,
): boolean {
  if (!root || text.length < Math.max(160, Math.floor(minMainTextLength * 0.6)))
    return false;
  const identity = elementIdentity(root);
  const semanticIdentity = root.tagName.toLowerCase() === "article" ||
    root.getAttribute("itemprop") === "articleBody" ||
    hasExplicitArticleBodyIdentity(identity);
  if (!semanticIdentity)
    return false;
  return (text.match(/[。！？.!?]/g) ?? []).length >= 2;
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
  const paragraphCount = root.querySelectorAll("p").length;
  const listItemCount = root.querySelectorAll("li").length;
  const linkCount = root.querySelectorAll("a[href]").length;
  const imageCount = root.querySelectorAll("img").length;
  const sectionCount = root.querySelectorAll("section").length;
  const tableRowCount = root.querySelectorAll("tr, [role=\"row\"]").length;
  const controlCount = root.querySelectorAll("button, input, select, [role=\"button\"], [role=\"tab\"]").length;
  const dashboardPanelCount = root.querySelectorAll("[class*=\"dashboard\" i], [class*=\"leaderboard\" i], [class*=\"metric\" i], [class*=\"panel\" i], [class*=\"score\" i], [data-testid*=\"panel\" i]").length;
  const linkDensity = linkedTextLength(root) / Math.max(text.length, 1);
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
    hasIndexOrSearchSurfaceSignal(url, title, text) &&
    (linkCount >= 1 || imageCount >= 1 || listItemCount >= 1 || articleCount >= 1)
  ) {
    return ["large-navigation-noise"];
  }

  if (
    !hasIndexOrSearchSurfaceSignal(url, title, text) &&
    ((
      hasExplicitArticleBodyIdentity(elementIdentity(root)) &&
      isArticleBodyLikeElement(root, text, uniqueTitleAnchors(title, undefined))
    ) ||
      (!rootIsArticle && isConfidentFallbackReadingRoot(root, text, uniqueTitleAnchors(title, undefined))) ||
      isConfidentArticleLikeReadingRoot(root, text, uniqueTitleAnchors(title, undefined), hasArticleMeta))
  ) {
    return [];
  }

  if (isLikelyStructuredIndexOrFeedRoot({
    rootIsArticle,
    hasArticleMeta,
    textLength: text.length,
    paragraphCount,
    articleCount,
    listItemCount,
    linkCount,
    imageCount,
    sectionCount,
    linkDensity,
  })) {
    return ["large-navigation-noise"];
  }

  if (isLikelyDataDashboardRoot({
    rootIsArticle,
    hasArticleMeta,
    textLength: text.length,
    paragraphCount,
    listItemCount,
    linkCount,
    tableRowCount,
    controlCount,
    dashboardPanelCount,
    lowerSignals,
  })) {
    return ["large-navigation-noise"];
  }

  if (
    (articleCount >= 3 || documentArticleCount >= 3) &&
    /\b(thread|discussion|reply|replies|forum|community|comment|comments)\b/.test(lowerSignals)
  ) {
    return ["large-navigation-noise"];
  }

  if (
    (articleCount >= 2 || documentArticleCount >= 2) &&
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

  // P22-dated-report-list: report/list hubs render many dated, linked list
  // items inside a content-like layout and can pass as a ready article.
  if (
    !rootIsArticle &&
    !hasArticleMeta &&
    countDateStamps(text.slice(0, 2400)) >= 5 &&
    listItemCount >= 6 &&
    linkCount >= 6 &&
    paragraphCount <= 12
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

  // P26-teaser-hub-page: some news/category hubs use repeated short `article`
  // cards without a semantic main container. If the selected root is just one
  // short card from a repeated card list, keep it caution/overview-only.
  if (
    rootIsArticle &&
    !hasArticleMeta &&
    text.length < 900 &&
    documentArticleCount >= 3 &&
    documentParagraphCount <= Math.max(8, documentArticleCount * 2) &&
    documentLinkCount >= documentArticleCount
  ) {
    return ["large-navigation-noise"];
  }

  // P25-article-root-utility-dense: some pages put ticker/search/share/topic
  // controls inside the same semantic article root. Article metadata alone is
  // not enough to call these clean-ready when the root is control/link-heavy.
  if (
    rootIsArticle &&
    hasArticleMeta &&
    text.length < 2200 &&
    linkCount >= 16 &&
    controlCount >= 2 &&
    (linkDensity >= 0.18 || listItemCount >= 12)
  ) {
    return ["large-navigation-noise"];
  }

  if (
    !rootIsArticle &&
    hasArticleMeta &&
    text.length < 2400 &&
    linkCount >= 16 &&
    controlCount >= 2 &&
    (linkDensity >= 0.12 || listItemCount >= 12)
  ) {
    return ["large-navigation-noise"];
  }

  return [];
}

function isLikelyStructuredIndexOrFeedRoot(metrics: {
  rootIsArticle: boolean;
  hasArticleMeta: boolean;
  textLength: number;
  paragraphCount: number;
  articleCount: number;
  listItemCount: number;
  linkCount: number;
  imageCount: number;
  sectionCount: number;
  linkDensity: number;
}): boolean {
  if (metrics.rootIsArticle)
    return false;

  const averageArticleTextLength = metrics.articleCount > 0
    ? metrics.textLength / metrics.articleCount
    : metrics.textLength;
  const shortRepeatedArticles = metrics.articleCount >= 3 &&
    averageArticleTextLength < 420 &&
    metrics.paragraphCount <= Math.max(10, metrics.articleCount * 2);
  const listOrMediaDense = metrics.listItemCount >= 8 ||
    metrics.linkCount >= 8 ||
    metrics.imageCount >= 4;
  const cardLikeSections = metrics.sectionCount >= 4 &&
    metrics.linkCount >= metrics.sectionCount &&
    metrics.paragraphCount <= Math.max(10, metrics.sectionCount + 2);

  if (shortRepeatedArticles && (listOrMediaDense || !metrics.hasArticleMeta))
    return true;

  if (
    !metrics.hasArticleMeta &&
    cardLikeSections &&
    (metrics.imageCount >= 4 || metrics.linkDensity >= 0.18)
  ) {
    return true;
  }

  if (
    !metrics.hasArticleMeta &&
    metrics.textLength < 2600 &&
    metrics.linkCount >= 10 &&
    metrics.paragraphCount <= 10 &&
    (metrics.imageCount >= 4 || metrics.linkDensity >= 0.22 || metrics.listItemCount >= 8)
  ) {
    return true;
  }

  if (
    !metrics.hasArticleMeta &&
    metrics.articleCount >= 2 &&
    metrics.linkCount >= 6 &&
    metrics.paragraphCount <= 8 &&
    averageArticleTextLength < 520
  ) {
    return true;
  }

  return false;
}

function isLikelyDataDashboardRoot(metrics: {
  rootIsArticle: boolean;
  hasArticleMeta: boolean;
  textLength: number;
  paragraphCount: number;
  listItemCount: number;
  linkCount: number;
  tableRowCount: number;
  controlCount: number;
  dashboardPanelCount: number;
  lowerSignals: string;
}): boolean {
  if (metrics.rootIsArticle || metrics.hasArticleMeta)
    return false;
  if (metrics.paragraphCount > 14)
    return false;
  const hasDashboardSignal = /\b(?:dashboard|leaderboard|ranking|rankings|metrics?|overview|scoreboard|time range|filter|filters|query|chart|panel|table)\b/.test(metrics.lowerSignals);
  if (!hasDashboardSignal)
    return false;

  const explicitLeaderboard = /\b(?:leaderboard|ranking|rankings|scoreboard)\b/.test(metrics.lowerSignals);
  const shortLeaderboardShell = metrics.textLength >= 180 &&
    metrics.textLength < 600 &&
    explicitLeaderboard &&
    metrics.paragraphCount <= 6 &&
    (metrics.linkCount >= 3 || metrics.controlCount >= 2 || metrics.listItemCount >= 4 || metrics.tableRowCount >= 3) &&
    /\b(?:loading leaderboard|compare models|users|organizations|how to benchmark|powered by|rankings for)\b/.test(metrics.lowerSignals);

  if (shortLeaderboardShell)
    return true;
  if (metrics.textLength < 600)
    return false;

  const tableLike = metrics.tableRowCount >= 6;
  const panelLike = metrics.dashboardPanelCount >= 4;
  const controlHeavy = metrics.controlCount >= 6 && (metrics.tableRowCount >= 3 || metrics.dashboardPanelCount >= 2);
  const listLikeLeaderboard = metrics.listItemCount >= 8 && /\b(?:leaderboard|ranking|rankings|scoreboard)\b/.test(metrics.lowerSignals);
  const sparseProse = metrics.paragraphCount <= 8 && metrics.linkCount >= 4 && /\b(?:dashboard|metrics?|overview)\b/.test(metrics.lowerSignals);

  return tableLike || panelLike || controlHeavy || listLikeLeaderboard || sparseProse;
}

function isLikelyDocumentationArticle(lowerSignals: string, text: string, paragraphCount: number): boolean {
  return text.length >= 1200 &&
    paragraphCount >= 8 &&
    /\b(?:docs?|documentation|handbook|guide|reference|learn|developer)\b/.test(lowerSignals);
}

const DATE_STAMP_PATTERNS = [
  /\b\d{1,2}\s+(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+\d{4}\b/gi,
  /\b(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+\d{1,2},?\s+\d{4}\b/gi,
  /\b\d{4}-\d{2}-\d{2}\b/g,
  /\b\d{4}\/\d{1,2}\/\d{1,2}\b/g,
  /\d{4}\s*年\s*\d{1,2}\s*月\s*\d{1,2}\s*日/g,
] as const;

function countDateStamps(text: string): number {
  let count = 0;
  for (const pattern of DATE_STAMP_PATTERNS) {
    count += text.match(pattern)?.length ?? 0;
  }
  return count;
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
    const text = normalizeWhitespace(
      element.textContent ||
      element.getAttribute("aria-label") ||
      element.getAttribute("title") ||
      "",
    ) ?? undefined;
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
  if (warnings.includes("unavailable-page"))
    return "blocked";
  if (warnings.includes("login-or-paywall-like") && text.length < minMainTextLength)
    return "blocked";
  if (warnings.length > 0)
    return "partial";
  return "complete";
}

function looksUnavailablePage(url: string, title: string | undefined, text: string): boolean {
  if (text.length > 600)
    return false;
  try {
    const parsed = new URL(url);
    if (parsed.searchParams.get("err") === "404" || parsed.searchParams.get("error") === "404")
      return true;
    if (/\/(?:404|not-found)(?:\/|$)/i.test(parsed.pathname))
      return true;
  } catch {
    // Fall back to the visible signals below for malformed URLs.
  }
  const signals = `${title ?? ""} ${text}`;
  return UNAVAILABLE_PAGE_PATTERNS.some((pattern) => pattern.test(signals));
}

const MEMBER_TEASER_MAX_TEXT_LENGTH = 620;

const MEMBER_ZONE_MARKER_PATTERNS = [
  /會員專區/,
  /付費會員/,
  /訂閱會員/,
  /\bmembers?[ -]only\b/i,
  /\bmember (?:zone|area|exclusive)\b/i,
] as const;

function looksBlockedOrPaywalled(
  documentRef: Document,
  extractionRoot: Element | null,
  title: string | undefined,
  text: string,
  minMainTextLength: number,
): boolean {
  const root = extractionRoot ?? documentRef.body ?? documentRef.documentElement;
  const signals = `${title ?? ""} ${text}`;
  if (ACCESS_CHECKING_OR_PREVIEW_PATTERNS.some((pattern) => pattern.test(signals)))
    return true;
  if (looksGatedContinueReadingPage(documentRef, signals, text.length))
    return true;
  if (STRONG_PAYWALL_OR_LOGIN_PATTERNS.some((pattern) => pattern.test(signals)))
    return true;
  const weakMatch = WEAK_PAYWALL_OR_LOGIN_PATTERNS.some((pattern) => pattern.test(signals));
  if (!weakMatch)
    return false;
  if (text.length < minMainTextLength)
    return true;
  // P23-member-zone-teaser: a short body carrying explicit member-zone
  // markers is a truncated teaser, not a complete article.
  if (
    text.length < MEMBER_TEASER_MAX_TEXT_LENGTH &&
    MEMBER_ZONE_MARKER_PATTERNS.some((pattern) => pattern.test(signals))
  ) {
    return true;
  }
  if (root.querySelector("input[type=\"password\"], input[type=\"email\"], form"))
    return true;
  return false;
}

function looksGatedContinueReadingPage(
  documentRef: Document,
  signals: string,
  textLength: number,
): boolean {
  if (textLength >= 5000)
    return false;
  if (!GATED_CONTINUE_READING_PATTERNS.some((pattern) => pattern.test(signals)))
    return false;

  const formLikeCount = documentRef.querySelectorAll("form, input[type=\"email\"], input[type=\"password\"]").length;
  const linkCount = documentRef.querySelectorAll("a[href]").length;
  return formLikeCount > 0 && linkCount >= 24;
}

function looksDynamicContentPartial(title: string | undefined, text: string): boolean {
  const signals = `${title ?? ""} ${text}`;
  return DYNAMIC_CONTENT_PARTIAL_PATTERNS.some((pattern) => pattern.test(signals));
}

function looksTruncatedContentPreview(title: string | undefined, text: string): boolean {
  const signals = `${title ?? ""} ${text}`;
  return TRUNCATED_CONTENT_PREVIEW_PATTERNS.some((pattern) => pattern.test(signals));
}

function finalizeGeneralPageReadingText(text: string): string {
  return trimTrailingPublisherUtilityText(trimTrailingRetrievalMetadata(trimTruncatedContentPreview(text)));
}

function trimTrailingPublisherUtilityText(text: string): string {
  return text
    .replace(/\s+相關新聞(?:請見[：:]?)?\s*[\s\S]{1,320}$/i, "")
    .replace(/\s+(?:\S{0,24}快訊\s+)?分享給朋友[：:][\s\S]{0,320}(?:版權所有|著作權聲明)[\s\S]*$/i, "")
    .replace(/\s+(?:投資|閱讀|新聞|資訊)[\s\S]{0,40}(?:LINE|社群|訂閱|追蹤)[\s\S]{0,100}$/i, "")
    .replace(/\s+(?:一手|立即)?掌握.{0,24}(?:脈動|資訊|新聞)$/i, "")
    .replace(/\s+(?:#\s*){3,}$/, "")
    .trim();
}

function trimTruncatedContentPreview(text: string): string {
  let boundary = text.length;
  for (const pattern of TRUNCATED_CONTENT_PREVIEW_PATTERNS) {
    const match = pattern.exec(text);
    if (match?.index !== undefined)
      boundary = Math.min(boundary, match.index);
  }
  return text.slice(0, boundary).trim();
}

function trimTrailingRetrievalMetadata(text: string): string {
  return text
    .replace(/\s*Retrieved from(?:\s*(?:""|“”|''))?\s*(?::\s*)?(?:Hidden categories:?\s*)?$/i, "")
    .trim();
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
    .replace(/(?:[【\[]\s*廣告\s*[】\]]\s*)?請繼續往下閱讀\s*(?:\.{3}|…)?/gi, " ")
    .replace(/透過集合功能整理內容\s*你可以依據偏好儲存及分類內容[。．]?/gi, " ")
    .replace(/（\s*相關報導[：:][^（）]{0,360}(?:更多文章|更多報導)\s*）/gi, " ")
    .replace(/■\s*(?:按讚|訂閱|追蹤|點擊)[\s\S]*$/g, " ")
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
    const url = new URL(value, baseUrl);
    if (url.protocol !== "http:" && url.protocol !== "https:")
      return undefined;
    return url.href;
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
  if (/^(comments?|share|related|more|recommended|popular|latest|most read|newsletter)\b/i.test(cleanText) || /相關文章|相關報導|延伸閱讀|分享至/i.test(cleanText))
    return true;
  if (/(登入|登錄).{0,16}留言|(?:賽程|直播|轉播).{0,24}總整理|特約記者$/i.test(cleanText))
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
