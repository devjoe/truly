import type { Lang } from "../lib/types";
import { t } from "../lib/i18n";

type SurfaceCollapseType = "right-rail-ad" | "reel-section";

interface SurfaceCollapseSettings {
  collapseRightRailAdsEnabled: boolean;
  collapseReelsEnabled: boolean;
}

const COLLAPSED_ATTR = "trulySurfaceCollapsed";
const COLLAPSED_SELECTOR = "[data-truly-surface-collapsed]";
const EXPANDED_ATTR = "trulySurfaceExpanded";
const EXPANDED_SELECTOR = "[data-truly-surface-expanded]";
const COLLAPSE_BAR_CLASS = "truly-surface-collapse-bar";
const collapsedSurfaces = new WeakSet<HTMLElement>();

let settings: SurfaceCollapseSettings = {
  collapseRightRailAdsEnabled: false,
  collapseReelsEnabled: false,
};
let currentLang: Lang = "zh-TW";
let observer: MutationObserver | null = null;
let scanTimer: ReturnType<typeof setTimeout> | null = null;

function visibleText(el: HTMLElement): string {
  return ((el as any).innerText || el.textContent || "")
    .replace(/\s+/g, " ")
    .trim();
}

function hasVisibleRect(el: HTMLElement): boolean {
  const rect = el.getBoundingClientRect();
  return rect.width === 0 && rect.height === 0 ? true : rect.width >= 80 && rect.height >= 40;
}

function nearestArticle(el: HTMLElement): HTMLElement | null {
  return el.closest<HTMLElement>('[data-truly-id], [role="article"], article');
}

function isInsideMainFeed(el: HTMLElement): boolean {
  return Boolean(el.closest('[role="main"]'));
}

function isInsideRightRail(el: HTMLElement): boolean {
  return Boolean(el.closest('[role="complementary"]')) && !isInsideMainFeed(el);
}

function hasSponsoredText(el: HTMLElement): boolean {
  const text = visibleText(el).slice(0, 700);
  return /贊助|赞助|Sponsored/i.test(text);
}

function hasRightRailAdContent(el: HTMLElement): boolean {
  return Boolean(el.querySelector("a[href], img, [role='button']"));
}

function hasReelLabel(el: HTMLElement): boolean {
  const text = visibleText(el).slice(0, 700);
  return /Reels?|短片/i.test(text);
}

function normalizeRightRailAdName(text: string): string {
  return text
    .replace(/\s+/g, " ")
    .replace(/^(贊助|赞助|Sponsored)\s*[·•:：-]?\s*/i, "")
    .replace(/\s*(?:https?:\/\/)?(?:www\.)?[a-z0-9-]+(?:\.[a-z0-9-]+)+(?:\/\S*)?$/i, "")
    .trim();
}

function isDomainLikeText(text: string): boolean {
  const clean = text
    .replace(/^https?:\/\//i, "")
    .replace(/^www\./i, "")
    .replace(/[/?#].*$/, "")
    .trim();
  return /^[a-z0-9-]+(?:\.[a-z0-9-]+)+$/i.test(clean);
}

function isUsefulRightRailAdName(text: string): boolean {
  const clean = normalizeRightRailAdName(text);
  if (clean.length < 2 || clean.length > 80) return false;
  if (/^(贊助|赞助|Sponsored|廣告|广告|Ad Choices|右欄廣告|了解更多|Learn More|展開)$/i.test(clean)) return false;
  if (/^(隱私政策|服務條款|Cookie|More|更多)$/i.test(clean)) return false;
  if (isDomainLikeText(clean)) return false;
  return true;
}

function extractRightRailAdName(el: HTMLElement): string | null {
  const selectors = [
    "h1",
    "h2",
    "h3",
    "h4",
    "strong",
    "b",
    "a[href]",
    "[role='link']",
  ].join(",");

  for (const node of Array.from(el.querySelectorAll<HTMLElement>(selectors))) {
    const text = normalizeRightRailAdName(visibleText(node));
    if (isUsefulRightRailAdName(text)) return text;
  }

  const lines = visibleText(el)
    .split(/[·•\n]/)
    .map((line) => normalizeRightRailAdName(line))
    .filter(isUsefulRightRailAdName);
  return lines[0] || null;
}

function hasBirthdayRailModule(el: HTMLElement): boolean {
  const text = visibleText(el).slice(0, 700);
  return /壽星|生日|Birthdays?/i.test(text);
}

export function isRightRailAdCandidate(el: HTMLElement): boolean {
  if (!settings.collapseRightRailAdsEnabled) return false;
  if (el.dataset[COLLAPSED_ATTR]) return false;
  if (el.closest(EXPANDED_SELECTOR)) return false;
  if (nearestArticle(el)) return false;
  if (!isInsideRightRail(el)) return false;
  if (hasBirthdayRailModule(el)) return false;
  if (!hasVisibleRect(el)) return false;
  if (!hasSponsoredText(el)) return false;
  if (!hasRightRailAdContent(el)) return false;
  const rect = el.getBoundingClientRect();
  if (rect.width > 0 && (rect.width < 160 || rect.width > 520)) return false;
  if (rect.height > 0 && (rect.height < 60 || rect.height > 800)) return false;
  return true;
}

export function isReelSectionCandidate(el: HTMLElement): boolean {
  if (!settings.collapseReelsEnabled) return false;
  if (el.dataset[COLLAPSED_ATTR]) return false;
  if (el.closest(EXPANDED_SELECTOR)) return false;
  if (nearestArticle(el)) return false;
  if (!isInsideMainFeed(el)) return false;
  if (!hasVisibleRect(el)) return false;
  const reelLinks = el.querySelectorAll('a[href*="/reel/"], a[href*="/reels/"]').length;
  if (reelLinks < 3) return false;
  if (!hasReelLabel(el)) return false;
  const rect = el.getBoundingClientRect();
  if (rect.width > 0 && rect.width < 320) return false;
  if (rect.height > 0 && (rect.height < 120 || rect.height > 1200)) return false;
  return true;
}

function findSurfaceRoot(seed: HTMLElement, type: SurfaceCollapseType): HTMLElement | null {
  if (seed.closest(EXPANDED_SELECTOR)) return null;
  let current: HTMLElement | null = seed;
  for (let depth = 0; current && depth < 8; depth++) {
    if (current.dataset[COLLAPSED_ATTR]) return null;
    if (current.dataset[EXPANDED_ATTR]) return null;
    if (type === "right-rail-ad" && isRightRailAdCandidate(current)) return current;
    if (type === "reel-section" && isReelSectionCandidate(current)) return current;
    current = current.parentElement;
  }
  return null;
}

function restoreSurface(el: HTMLElement): void {
  const bar = el.querySelector(`:scope > .${COLLAPSE_BAR_CLASS}`);
  if (bar) bar.remove();
  for (const child of Array.from(el.children)) {
    (child as HTMLElement).style.display = "";
  }
  delete el.dataset[COLLAPSED_ATTR];
  el.dataset[EXPANDED_ATTR] = "true";
}

function collapseSurface(el: HTMLElement, type: SurfaceCollapseType): void {
  if (collapsedSurfaces.has(el)) return;
  if (el.closest(EXPANDED_SELECTOR)) return;
  const collapsedAncestor = el.closest(COLLAPSED_SELECTOR);
  if (collapsedAncestor && collapsedAncestor !== el) return;

  collapsedSurfaces.add(el);
  el.dataset[COLLAPSED_ATTR] = type;

  for (const child of Array.from(el.children)) {
    if (child.classList.contains(COLLAPSE_BAR_CLASS)) continue;
    (child as HTMLElement).style.display = "none";
  }

  const bar = document.createElement("div");
  bar.className = `${COLLAPSE_BAR_CLASS} truly-surface-collapse-bar-${type}`;

  const label = document.createElement("span");
  label.className = "truly-surface-collapse-label";
  const rightRailAdName = type === "right-rail-ad" ? extractRightRailAdName(el) : null;
  label.textContent = type === "right-rail-ad"
    ? rightRailAdName ? t("content.surface.sponsored", currentLang, { source: rightRailAdName }) : t("content.surface.rightRailAd", currentLang)
    : t("content.surface.reelSection", currentLang);
  bar.appendChild(label);

  const button = document.createElement("button");
  button.className = "truly-btn truly-btn-primary";
  button.type = "button";
  button.textContent = t("content.surface.expand", currentLang);
  button.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    restoreSurface(el);
  });
  bar.appendChild(button);
  el.appendChild(bar);
}

function scanRightRailAds(): void {
  if (!settings.collapseRightRailAdsEnabled) return;
  for (const label of Array.from(document.querySelectorAll<HTMLElement>('[role="complementary"] *'))) {
    const text = visibleText(label);
    if (text.length > 80 || !hasSponsoredText(label)) continue;
    const surface = findSurfaceRoot(label, "right-rail-ad");
    if (surface) collapseSurface(surface, "right-rail-ad");
  }
}

function scanReelSections(): void {
  if (!settings.collapseReelsEnabled) return;
  for (const link of Array.from(document.querySelectorAll<HTMLElement>('a[href*="/reel/"], a[href*="/reels/"]'))) {
    const surface = findSurfaceRoot(link, "reel-section");
    if (surface) collapseSurface(surface, "reel-section");
  }
}

function scheduleScan(): void {
  if (scanTimer) return;
  scanTimer = setTimeout(() => {
    scanTimer = null;
    scanCollapsibleSurfaces();
  }, 250);
}

export function updateSurfaceCollapseSettings(next: SurfaceCollapseSettings, lang: Lang = currentLang): void {
  currentLang = lang;
  settings = {
    collapseRightRailAdsEnabled: next.collapseRightRailAdsEnabled === true,
    collapseReelsEnabled: next.collapseReelsEnabled === true,
  };
  scanCollapsibleSurfaces();
}

export function updateSurfaceCollapseLanguage(lang: Lang): void {
  currentLang = lang;
  scanCollapsibleSurfaces();
}

export function scanCollapsibleSurfaces(): void {
  scanRightRailAds();
  scanReelSections();
}

export function startSurfaceCollapseObserver(): void {
  if (observer) return;
  observer = new MutationObserver(scheduleScan);
  observer.observe(document.documentElement, { childList: true, subtree: true });
  scanCollapsibleSurfaces();
}

export function __resetSurfaceCollapseForTesting(): void {
  settings = {
    collapseRightRailAdsEnabled: false,
    collapseReelsEnabled: false,
  };
  currentLang = "zh-TW";
  if (scanTimer) {
    clearTimeout(scanTimer);
    scanTimer = null;
  }
  observer?.disconnect();
  observer = null;
}
