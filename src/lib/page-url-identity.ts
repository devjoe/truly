const TRACKING_QUERY_PREFIXES = ["utm_"] as const;
const TRACKING_QUERY_KEYS = new Set([
  "fbclid",
  "gclid",
  "yclid",
  "mc_cid",
  "mc_eid",
  "ref",
  "ref_src",
  "spm",
]);

export interface PageUrlIdentity {
  rawUrl: string;
  normalizedUrl: string;
  canonicalUrl?: string;
  identityUrl: string;
}

export function pageUrlIdentity(rawUrl: string, canonicalUrl?: string): PageUrlIdentity {
  const normalizedUrl = normalizePageUrl(rawUrl) ?? rawUrl;
  const normalizedCanonical = canonicalUrl ? normalizePageUrl(canonicalUrl) : undefined;
  return {
    rawUrl,
    normalizedUrl,
    canonicalUrl: normalizedCanonical,
    identityUrl: normalizedCanonical ?? normalizedUrl,
  };
}

export function normalizePageUrl(rawUrl: string): string | undefined {
  try {
    const url = new URL(rawUrl);
    url.hash = "";
    if ((url.protocol === "http:" && url.port === "80") || (url.protocol === "https:" && url.port === "443")) {
      url.port = "";
    }
    for (const key of Array.from(url.searchParams.keys())) {
      const lower = key.toLowerCase();
      if (TRACKING_QUERY_KEYS.has(lower) || TRACKING_QUERY_PREFIXES.some((prefix) => lower.startsWith(prefix))) {
        url.searchParams.delete(key);
      }
    }
    if (url.pathname.length > 1 && url.pathname.endsWith("/")) {
      url.pathname = url.pathname.replace(/\/+$/, "");
    }
    url.searchParams.sort();
    return url.toString();
  } catch {
    return undefined;
  }
}

export function isMeaningfullySamePage(a: PageUrlIdentity, currentRawUrl: string): boolean {
  const current = pageUrlIdentity(currentRawUrl);
  return a.normalizedUrl === current.normalizedUrl || a.identityUrl === current.identityUrl;
}
