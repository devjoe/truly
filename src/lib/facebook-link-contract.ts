export const FACEBOOK_EXTERNAL_REDIRECT_HOSTS = [
  "l.facebook.com",
  "lm.facebook.com",
] as const;

export const FACEBOOK_NON_PROFILE_PATH_SEGMENTS = [
  "l.php",
  "groups",
  "reel",
  "watch",
  "videos",
  "photo",
  "photos",
  "posts",
  "share",
  "story.php",
  "permalink.php",
  "events",
  "marketplace",
  "hashtag",
  "search",
] as const;

export const FACEBOOK_CHROME_LINK_TEXT_PATTERNS = [
  "上線狀態指標",
  "在線上",
  "online status indicator",
] as const;

export function isFacebookHost(hostname: string): boolean {
  const normalized = hostname.toLowerCase();
  return normalized === "facebook.com" || normalized.endsWith(".facebook.com");
}

export function isFacebookExternalRedirectHost(hostname: string): boolean {
  return FACEBOOK_EXTERNAL_REDIRECT_HOSTS.includes(
    hostname.toLowerCase() as (typeof FACEBOOK_EXTERNAL_REDIRECT_HOSTS)[number],
  );
}

export function isFacebookGroupFeedPath(pathname: string): boolean {
  return /^\/groups\/[^/]+\/?$/.test(pathname);
}

export function isFacebookGroupUserPath(pathname: string): boolean {
  return /^\/groups\/[^/]+\/user\/[^/]+\/?$/.test(pathname);
}

export function isLikelyFacebookProfilePath(pathname: string): boolean {
  if (/^\/profile\.php$/i.test(pathname)) return true;
  const slug = pathname.replace(/^\/+|\/+$/g, "");
  if (!slug || slug.includes("/")) return false;
  if (FACEBOOK_NON_PROFILE_PATH_SEGMENTS.includes(slug.toLowerCase() as (typeof FACEBOOK_NON_PROFILE_PATH_SEGMENTS)[number])) {
    return false;
  }
  return /^[A-Za-z0-9._%-]+$/.test(slug);
}

export function looksLikeUrlText(value: string): boolean {
  return /^https?:\/\//i.test(value) ||
    /^(?:www\.)?[a-z0-9][a-z0-9-]*(?:\.[a-z0-9][a-z0-9-]*)+\b/i.test(value);
}

export function looksLikeFacebookChromeLinkText(value: string): boolean {
  const clean = value.replace(/\s+/g, " ").trim();
  return FACEBOOK_CHROME_LINK_TEXT_PATTERNS.some((pattern) =>
    clean.toLowerCase().includes(pattern.toLowerCase()),
  );
}

export function isCandidateFacebookAuthorUrl(
  href: string,
  baseHref = "https://www.facebook.com/",
): boolean {
  let url: URL;
  try {
    url = new URL(href, baseHref);
  } catch {
    return false;
  }
  const hostname = url.hostname.toLowerCase();
  if (!isFacebookHost(hostname) || isFacebookExternalRedirectHost(hostname)) return false;
  return isFacebookGroupUserPath(url.pathname) || isLikelyFacebookProfilePath(url.pathname);
}
