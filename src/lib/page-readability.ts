export type PageReadabilityPlatform = "facebook" | "general" | "unsupported";

export type UnsupportedPageKind =
  | "truly_extension"
  | "browser_internal"
  | "other_extension"
  | "chrome_web_store"
  | "file"
  | "special_scheme"
  | "url_unavailable"
  | "unknown";

export interface PageReadability {
  platform: PageReadabilityPlatform;
  unsupportedKind?: UnsupportedPageKind;
}

const CHROME_WEB_STORE_HOSTS = new Set([
  "chrome.google.com",
  "chromewebstore.google.com",
]);

export function classifyPageReadability(rawUrl: string | undefined, extensionId?: string): PageReadability {
  if (!rawUrl) return { platform: "unsupported", unsupportedKind: "url_unavailable" };
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return { platform: "unsupported", unsupportedKind: "unknown" };
  }

  const protocol = url.protocol;
  const host = url.hostname.toLowerCase();

  if (protocol === "http:" || protocol === "https:") {
    if (host === "facebook.com" || host.endsWith(".facebook.com")) {
      return { platform: "facebook" };
    }
    if (isChromeWebStoreUrl(url)) {
      return { platform: "unsupported", unsupportedKind: "chrome_web_store" };
    }
    return { platform: "general" };
  }

  if (protocol === "chrome-extension:" || protocol === "moz-extension:" || protocol === "safari-web-extension:") {
    return {
      platform: "unsupported",
      unsupportedKind: extensionId && host === extensionId ? "truly_extension" : "other_extension",
    };
  }

  if (protocol === "chrome:" || protocol === "edge:" || protocol === "about:" || protocol === "devtools:") {
    return { platform: "unsupported", unsupportedKind: "browser_internal" };
  }

  if (protocol === "file:") return { platform: "unsupported", unsupportedKind: "file" };
  if (protocol === "data:" || protocol === "blob:" || protocol === "view-source:") {
    return { platform: "unsupported", unsupportedKind: "special_scheme" };
  }

  return { platform: "unsupported", unsupportedKind: "unknown" };
}

export function isGeneralPageReadableUrl(rawUrl: string | undefined, extensionId?: string): boolean {
  return classifyPageReadability(rawUrl, extensionId).platform === "general";
}

export function classifyPageReadabilityForTab(
  rawUrl: string | undefined,
  title: string | undefined,
  extensionId?: string,
): PageReadability {
  const byUrl = classifyPageReadability(rawUrl, extensionId);
  if (byUrl.platform !== "unsupported" || byUrl.unsupportedKind !== "url_unavailable") return byUrl;

  const cleanTitle = (title || "").replace(/\s+/g, " ").trim();
  if (isTrulyExtensionTitle(cleanTitle)) {
    return { platform: "unsupported", unsupportedKind: "truly_extension" };
  }
  if (isLikelyBrowserInternalTitle(cleanTitle)) {
    return { platform: "unsupported", unsupportedKind: "browser_internal" };
  }
  return byUrl;
}

function isChromeWebStoreUrl(url: URL): boolean {
  const host = url.hostname.toLowerCase();
  if (!CHROME_WEB_STORE_HOSTS.has(host)) return false;
  if (host === "chromewebstore.google.com") return true;
  return url.pathname.startsWith("/webstore");
}

function isTrulyExtensionTitle(title: string): boolean {
  return /^Truly(?:\b|\s|$)/i.test(title) || /Truly\s*(設定|Settings)/i.test(title);
}

function isLikelyBrowserInternalTitle(title: string): boolean {
  if (!title) return false;
  return /^(設定|Settings|擴充功能|Extensions|下載|Downloads|歷史記錄|History|書籤|Bookmarks|Chrome|Chromium|About|Flags|實驗|Experiments)$/i.test(title);
}
