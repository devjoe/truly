import type { ReadingActivationTargetKind } from "./reading-action-types";
import type { ReadingSurface, ReadingSurfaceLink } from "./reading-surface-types";
import type { ReadingTarget } from "./reading-target-types";

export const GENERAL_PAGE_MODEL_MIN_MAIN_TEXT_LENGTH = 240;
export const GENERAL_PAGE_MODEL_MAIN_TEXT_LIMIT = 8192;
export const GENERAL_PAGE_MODEL_MAX_LINKS = 12;
export const GENERAL_PAGE_MODEL_MAX_IMAGE_ALT_TEXTS = 8;

export type GeneralPageModelIneligibilityReason =
  | "not_web_page"
  | "empty_or_blocked"
  | "main_text_too_short";

export type GeneralPageModelReadiness = "ready" | "caution" | "blocked";

export type GeneralPageModelQualityIssue =
  | "fallback_extraction"
  | "partial_extraction"
  | "large_navigation_noise"
  | "no_main_content"
  | "dynamic_content_partial";

export interface GeneralPageModelSourceLink {
  href: string;
  text?: string;
}

export interface GeneralPageModelContext {
  surfaceKind: ReadingSurface["kind"];
  surfaceSource: ReadingSurface["source"];
  targetKind: ReadingActivationTargetKind;
  title?: string;
  url: string;
  canonicalUrl?: string;
  domain: string;
  authorName?: string;
  sourceName?: string;
  publishedAt?: string;
  selectedText?: string;
  mainText: string;
  surroundingText?: string;
  links: GeneralPageModelSourceLink[];
  imageAltText: string[];
  extractionWarnings: string[];
  modelEligible: boolean;
  modelReadiness: GeneralPageModelReadiness;
  qualityIssues: GeneralPageModelQualityIssue[];
  ineligibilityReason?: GeneralPageModelIneligibilityReason;
}

export interface BuildGeneralPageModelContextOptions {
  target?: ReadingTarget;
  targetKind?: ReadingActivationTargetKind;
  minMainTextLength?: number;
  maxMainTextLength?: number;
  maxLinks?: number;
  maxImageAltTexts?: number;
}

export function buildGeneralPageModelContext(
  surface: ReadingSurface,
  options: BuildGeneralPageModelContextOptions = {},
): GeneralPageModelContext {
  const minMainTextLength = options.minMainTextLength ?? GENERAL_PAGE_MODEL_MIN_MAIN_TEXT_LENGTH;
  const maxMainTextLength = options.maxMainTextLength ?? GENERAL_PAGE_MODEL_MAIN_TEXT_LIMIT;
  const targetKind = options.target
    ? targetKindForReadingTarget(options.target)
    : options.targetKind ?? (surface.selectedText ? "selection" : "page");
  const mainTextSource = options.target?.text || surface.selectedText || surface.mainText;
  const cleanedMainTextSource = cleanCommonPageNoise(mainTextSource);
  const mainText = clampText(cleanedMainTextSource, maxMainTextLength);
  const ineligibilityReason = resolveIneligibilityReason(surface, mainText, minMainTextLength);
  const qualityIssues = resolveQualityIssues(surface);
  const modelReadiness = ineligibilityReason
    ? "blocked"
    : qualityIssues.length > 0
    ? "caution"
    : "ready";

  return {
    surfaceKind: "web-page",
    surfaceSource: "general",
    targetKind,
    title: cleanOptional(surface.title),
    url: surface.url,
    canonicalUrl: cleanOptional(surface.canonicalUrl),
    domain: hostnameForUrl(surface.canonicalUrl || surface.url),
    authorName: cleanOptional(surface.authorName),
    sourceName: cleanOptional(surface.sourceName),
    publishedAt: cleanOptional(surface.publishedAt),
    selectedText: cleanOptional(surface.selectedText),
    mainText,
    surroundingText: cleanOptional(options.target?.surroundingText),
    links: cleanLinks(surface.links, options.maxLinks ?? GENERAL_PAGE_MODEL_MAX_LINKS, surface.url),
    imageAltText: cleanImageAltText(surface, options.maxImageAltTexts ?? GENERAL_PAGE_MODEL_MAX_IMAGE_ALT_TEXTS),
    extractionWarnings: [...surface.extraction.warnings],
    modelEligible: !ineligibilityReason,
    modelReadiness,
    qualityIssues,
    ineligibilityReason,
  };
}

export function buildGeneralPageModelUserPrompt(context: GeneralPageModelContext): string {
  const lines = [
    "Analyze this web page for a reader. Use only the supplied page context.",
    "Do not assume social-feed behavior unless the surface kind explicitly says so.",
    "",
    "## Surface",
    `kind: ${context.surfaceKind}`,
    `source: ${context.surfaceSource}`,
    `targetKind: ${context.targetKind}`,
    context.title ? `title: ${context.title}` : undefined,
    `url: ${context.canonicalUrl || context.url}`,
    context.domain ? `domain: ${context.domain}` : undefined,
    context.sourceName ? `sourceName: ${context.sourceName}` : undefined,
    context.authorName ? `authorName: ${context.authorName}` : undefined,
    context.publishedAt ? `publishedAt: ${context.publishedAt}` : undefined,
    "",
    "## Extraction",
    `modelEligible: ${context.modelEligible ? "true" : "false"}`,
    `modelReadiness: ${context.modelReadiness}`,
    context.ineligibilityReason ? `ineligibilityReason: ${context.ineligibilityReason}` : undefined,
    `qualityIssues: ${context.qualityIssues.length > 0 ? context.qualityIssues.join(", ") : "none"}`,
    `warnings: ${context.extractionWarnings.length > 0 ? context.extractionWarnings.join(", ") : "none"}`,
    "",
    "## Page Text",
    context.mainText,
  ];

  if (context.links.length > 0) {
    lines.push("", "## Source Links");
    for (const link of context.links) {
      lines.push(`- ${link.text ? `${link.text}: ` : ""}${link.href}`);
    }
  }

  if (context.imageAltText.length > 0) {
    lines.push("", "## Image Alt Text");
    for (const text of context.imageAltText) {
      lines.push(`- ${text}`);
    }
  }

  if (context.surroundingText) {
    lines.push("", "## Surrounding Text", context.surroundingText);
  }

  return lines.filter((line): line is string => typeof line === "string").join("\n");
}

function resolveIneligibilityReason(
  surface: ReadingSurface,
  mainText: string,
  minMainTextLength: number,
): GeneralPageModelIneligibilityReason | undefined {
  if (surface.kind !== "web-page" || surface.source !== "general")
    return "not_web_page";
  if (surface.extraction.status === "empty" || surface.extraction.status === "blocked")
    return "empty_or_blocked";
  if (mainText.length < minMainTextLength)
    return "main_text_too_short";
  return undefined;
}

function resolveQualityIssues(surface: ReadingSurface): GeneralPageModelQualityIssue[] {
  const issues: GeneralPageModelQualityIssue[] = [];
  if (surface.extraction.method === "fallback")
    issues.push("fallback_extraction");
  if (surface.extraction.status === "partial")
    issues.push("partial_extraction");
  if (surface.extraction.warnings.includes("large-navigation-noise"))
    issues.push("large_navigation_noise");
  if (surface.extraction.warnings.includes("no-main-content"))
    issues.push("no_main_content");
  if (surface.extraction.warnings.includes("dynamic-content-partial"))
    issues.push("dynamic_content_partial");
  return [...new Set(issues)];
}

function targetKindForReadingTarget(target: ReadingTarget): ReadingActivationTargetKind {
  return target.kind === "selection" ? "selection" : "current-region";
}

function cleanOptional(value: string | undefined): string | undefined {
  const clean = value?.trim().replace(/\s+/g, " ");
  return clean || undefined;
}

function clampText(value: string | undefined, maxLength: number): string {
  const clean = cleanOptional(value) ?? "";
  return clean.length > maxLength ? clean.slice(0, maxLength).trim() : clean;
}

function cleanCommonPageNoise(value: string | undefined): string {
  return (value ?? "")
    .replace(/為達最佳瀏覽效果，?\s*建議使用\s*Chrome、?\s*Firefox\s*或\s*Microsoft\s*Edge\s*的瀏覽器。?/gi, " ")
    .replace(/請至\s*(?:Edge|Fire\s*Fox|Firefox|Google|Chrome|Microsoft\s*Edge)[^。.!?]*(?:下載|download)[^。.!?]*(?:[。.!?]|$)/gi, " ")
    .replace(/For best viewing[^.!?]*(?:Chrome|Firefox|Edge)[^.!?]*(?:browser|download)[^.!?]*(?:[.!?]|$)/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function hostnameForUrl(rawUrl: string): string {
  try {
    return new URL(rawUrl).hostname;
  } catch {
    return "";
  }
}

function cleanLinks(
  links: ReadingSurfaceLink[] | undefined,
  maxLinks: number,
  pageUrl: string,
): GeneralPageModelSourceLink[] {
  const seen = new Set<string>();
  const clean: GeneralPageModelSourceLink[] = [];
  for (const link of links ?? []) {
    const href = link.href.trim();
    if (!isHttpLikeUrl(href) || seen.has(href)) continue;
    if (isLikelyNavigationOrDownloadLink(link, pageUrl)) continue;
    seen.add(href);
    clean.push({
      href,
      text: cleanOptional(link.text),
    });
    if (clean.length >= maxLinks) break;
  }
  return clean;
}

function isLikelyNavigationOrDownloadLink(link: ReadingSurfaceLink, pageUrl: string): boolean {
  const text = cleanOptional(link.text) ?? "";
  const lowerText = text.toLowerCase();
  const href = link.href.trim();
  const lowerHref = href.toLowerCase();
  if (/(下載|download)/i.test(text) && /(chrome|firefox|edge|google|microsoft|mozilla)/i.test(text))
    return true;
  if (/(chrome|firefox|edge)/i.test(lowerHref) && /(download|下載|browser|瀏覽器)/i.test(lowerText))
    return true;
  try {
    const url = new URL(href);
    const page = new URL(pageUrl);
    const path = url.pathname.replace(/\/+$/, "");
    const isSameOriginRoot = url.origin === page.origin && path === "";
    const isHomeLabel = !text || /^home|首頁|主頁|網站首頁$/i.test(text);
    return isSameOriginRoot && isHomeLabel;
  } catch {
    return false;
  }
}

function isHttpLikeUrl(rawUrl: string): boolean {
  try {
    const url = new URL(rawUrl);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function cleanImageAltText(surface: ReadingSurface, maxImageAltTexts: number): string[] {
  const altText: string[] = [];
  const seen = new Set<string>();
  for (const image of surface.images ?? []) {
    const text = cleanOptional(image.alt || image.title);
    if (!text || seen.has(text)) continue;
    seen.add(text);
    altText.push(text);
    if (altText.length >= maxImageAltTexts) break;
  }
  return altText;
}
