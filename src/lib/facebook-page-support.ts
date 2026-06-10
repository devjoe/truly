export type FacebookPageSupportKind =
  | "feed"
  | "group"
  | "profileOrPage"
  | "post"
  | "unsupportedFacebook"
  | "nonFacebook";

export interface FacebookPageSupport {
  isFacebook: boolean;
  supported: boolean;
  kind: FacebookPageSupportKind;
}

const RESERVED_UNSUPPORTED_PATHS = new Set([
  "ads",
  "bookmarks",
  "business",
  "events",
  "friends",
  "gaming",
  "help",
  "login",
  "marketplace",
  "memories",
  "messages",
  "notifications",
  "pages",
  "privacy",
  "reel",
  "reels",
  "saved",
  "settings",
  "watch",
]);

const UNSUPPORTED_GROUP_PATHS = new Set([
  "create",
  "discover",
  "joins",
  "notifications",
]);

function isFacebookHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return host === "facebook.com" || host.endsWith(".facebook.com");
}

function pathSegments(pathname: string): string[] {
  return pathname
    .split("/")
    .map((part) => decodeURIComponent(part).trim())
    .filter(Boolean);
}

export function getFacebookPageSupport(rawUrl: string): FacebookPageSupport {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return { isFacebook: false, supported: false, kind: "nonFacebook" };
  }

  if (!/^https?:$/.test(url.protocol) || !isFacebookHost(url.hostname)) {
    return { isFacebook: false, supported: false, kind: "nonFacebook" };
  }

  const segments = pathSegments(url.pathname);
  const [first, second] = segments.map((part) => part.toLowerCase());

  if (segments.length === 0 || first === "home.php") {
    return { isFacebook: true, supported: true, kind: "feed" };
  }

  if (first === "groups") {
    if (!second || UNSUPPORTED_GROUP_PATHS.has(second)) {
      return { isFacebook: true, supported: false, kind: "unsupportedFacebook" };
    }
    return { isFacebook: true, supported: true, kind: "group" };
  }

  if (first === "profile.php" || first === "people") {
    return { isFacebook: true, supported: true, kind: "profileOrPage" };
  }

  if (first === "permalink.php" || first === "story.php" || first === "photo.php") {
    return { isFacebook: true, supported: true, kind: "post" };
  }

  if (RESERVED_UNSUPPORTED_PATHS.has(first)) {
    return { isFacebook: true, supported: false, kind: "unsupportedFacebook" };
  }

  // Most public profile/page URLs use a single slug, for example
  // facebook.com/zuck. Keep these supported while reserved product areas above
  // are explicitly excluded.
  if (segments.length === 1) {
    return { isFacebook: true, supported: true, kind: "profileOrPage" };
  }

  const secondSegmentSupported = new Set(["posts", "photos", "videos"]);
  if (secondSegmentSupported.has(second)) {
    return { isFacebook: true, supported: true, kind: "profileOrPage" };
  }

  return { isFacebook: true, supported: false, kind: "unsupportedFacebook" };
}
