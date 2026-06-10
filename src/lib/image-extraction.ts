// Extract high-resolution image URLs from an FB post element. Used by
// Tier B deep classification to feed media into a multimodal LLM.
//
// FB's DOM has many <img> tags per post — most are ICONS, AVATARS,
// or REACTION emoji. The signal we want: post media, which carries
// the `data-imgperflogname` attribute set to one of "media", "feed",
// "uniqueImageInPost", or has a non-trivial size hint in src.
//
// Avatars are excluded by:
//   - profile picture URLs contain `/p<digit>/` or `_o.jpg`
//   - dimensions ≤ 80px in src parameters
// Reaction emoji come from `static.xx.fbcdn.net/rsrc.php/...` —
// excluded by host check.

const PERF_LOGNAME_ALLOWLIST = new Set([
  "media",
  "feed",
  "feedImage",        // FB's default tag on ordinary in-feed post photos
                      // (camelCase). Without this in the allowlist, real
                      // 1000×1000+ post photos get dropped under the
                      // "set-but-not-allowlisted" filter rule.
  "uniqueImageInPost",
  "feedRecentMedia",
  "feedTagging",
]);

const STATIC_HOST_RE = /static\.[^.]+\.fbcdn\.net|rsrc\.php/;

// URLs we drop BEFORE prefetch because they're guaranteed to either
// be non-content (FB shimmer placeholders) or non-still-image bytes
// that even the browser's createImageBitmap can't decode. Anything
// the prefetch CAN decode is sent through unchanged — the canvas
// re-encode normalizes format/size for the Tier B backend.
//
// What we DON'T filter here, even though prior shipped versions did:
// `/t39.30808-N/` and `/t40.7532-N/` paths. Those were assumed to be
// video-thumbnail / animated-sticker prefixes, but empirically `t39.30808-N`
// is also FB's regular post-photo storage. With client-side prefetch,
// drawImage decodes still frames trivially and falls through to the
// drop path on actual videos — the URL-shape filter is no longer
// needed and was costing us most legitimate post images.
export function isTierBUnsafeImageUrl(url: string): boolean {
  // FB injects `data:image/svg+xml,...` placeholders into <img> tags
  // while content loads. SVG is semantically a shimmer skeleton, not
  // post content — never worth analyzing.
  if (url.startsWith("data:")) return true;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  // Animated GIFs carry frame-loop semantics that drawImage drops
  // silently to frame 0. The drop is fine but the kept frame is
  // usually a sticker / reaction, not analyzable post content.
  if (parsed.pathname.toLowerCase().endsWith(".gif")) return true;
  // `?_nc_video=1` URLs are video bytes (HLS / mp4 fragments) served
  // from an image-shaped path. drawImage cannot decode video.
  if (parsed.searchParams.get("_nc_video") === "1") return true;
  return false;
}

export interface ExtractedImages {
  urls: string[];
  /** Count of post-content images that were dropped by the Tier B
   *  pre-filter. Avatar / icon / dimension drops do NOT contribute —
   *  this counts only images we'd otherwise have sent. */
  filteredCount: number;
}

function styleBackgroundImageUrls(el: Element): string[] {
  if (typeof window === "undefined" || typeof window.getComputedStyle !== "function") {
    return [];
  }
  let backgroundImage = "";
  try {
    backgroundImage = window.getComputedStyle(el).backgroundImage || "";
  } catch {
    return [];
  }
  if (!backgroundImage || backgroundImage === "none") return [];

  const urls: string[] = [];
  for (const match of backgroundImage.matchAll(/url\((['"]?)(.*?)\1\)/g)) {
    const url = match[2]?.trim();
    if (url) urls.push(url);
  }
  return urls;
}

function parseCssPx(value: string): number {
  const parsed = Number.parseFloat(value || "0");
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalizedText(value: string | null | undefined): string {
  return (value || "").replace(/\s+/g, "");
}

function isVisibleTextBackgroundCard(el: HTMLElement): boolean {
  const frameRect = el.getBoundingClientRect();
  if (frameRect.width < 240 || frameRect.height < 160) return false;
  if (el.querySelector("img, video")) return false;
  const frameText = normalizedText(el.textContent);
  if (frameText.length < 3 || frameText.length > 300) return false;

  const textNodes = [el, ...Array.from(el.querySelectorAll<HTMLElement>("div, span"))];
  return textNodes.some((node) => {
    const text = normalizedText(node.textContent);
    if (text.length < 3 || text.length > 300) return false;
    const rect = node.getBoundingClientRect();
    if (rect.width < 40 || rect.height < 16) return false;
    if (rect.width >= frameRect.width * 0.95 && rect.height >= frameRect.height * 0.95 && node !== el) {
      return false;
    }

    let style: CSSStyleDeclaration;
    try {
      style = window.getComputedStyle(node);
    } catch {
      return false;
    }
    if (style.display === "none" || style.visibility === "hidden") return false;

    const fontSize = parseCssPx(style.fontSize);
    const hasOverlayPosition = style.position === "absolute" || style.position === "relative";
    const hasLargeDisplayText = fontSize >= 22;
    return hasOverlayPosition || hasLargeDisplayText;
  });
}

/**
 * Returns up to `max` deduplicated post-content image URLs. The order
 * is DOM order so the first image is the cover. The result also
 * carries `filteredCount` so callers can distinguish "post had no
 * images" from "post had images but they were unsafe to send".
 */
export function extractPostImages(el: HTMLElement, max = 4): ExtractedImages {
  const urls: string[] = [];
  const seen = new Set<string>();
  let filteredCount = 0;
  const skipReasons: string[] = [];
  let hadMediaCandidate = false;

  function considerCandidate(candidate: {
    src: string;
    reason: string;
    perfTag?: string;
    naturalW?: number;
    naturalH?: number;
    renderedW?: number;
    renderedH?: number;
  }): void {
    if (urls.length >= max) return;
    const { src, reason, perfTag = "" } = candidate;
    if (!src || seen.has(src)) return;
    hadMediaCandidate = true;

    const w = candidate.naturalW || candidate.renderedW || 0;
    const h = candidate.naturalH || candidate.renderedH || 0;

    // Reaction icons / static UI assets — drop.
    if (STATIC_HOST_RE.test(src)) {
      skipReasons.push(`static-host ${reason}:${src.slice(0, 60)}`);
      return;
    }

    const isAllowedPerfTag = PERF_LOGNAME_ALLOWLIST.has(perfTag);

    // If perf tag is set but NOT in allowlist (e.g. "profilePic"), skip.
    if (perfTag && !isAllowedPerfTag) {
      skipReasons.push(`perfTag=${perfTag} ${reason}:${src.slice(0, 60)}`);
      return;
    }

    // Heuristic dimension filter — both natural dimensions and rendered
    // size give a hint. Tiny images (< 100px on either axis) are
    // probably icons / spacers.
    if (w > 0 && h > 0 && (w < 100 || h < 100)) {
      skipReasons.push(`tiny ${w}x${h} ${reason}:${src.slice(0, 60)}`);
      return;
    }
    if (
      candidate.renderedW &&
      candidate.renderedH &&
      (candidate.renderedW < 100 || candidate.renderedH < 100)
    ) {
      skipReasons.push(`tiny-rendered ${candidate.renderedW}x${candidate.renderedH} ${reason}:${src.slice(0, 60)}`);
      return;
    }

    if (isTierBUnsafeImageUrl(src)) {
      filteredCount++;
      seen.add(src);
      skipReasons.push(`tier-b-unsafe ${reason} perfTag=${perfTag || "-"}:${src.slice(0, 80)}`);
      return;
    }

    urls.push(src);
    seen.add(src);
  }

  const mediaCandidates: Array<() => void> = [];
  const imgs = el.querySelectorAll<HTMLImageElement>("img");
  for (const img of imgs) {
    mediaCandidates.push(() => {
      const renderedRect = img.getBoundingClientRect();
      considerCandidate({
        src: img.currentSrc || img.src || "",
        reason: "img",
        perfTag: img.getAttribute("data-imgperflogname") || "",
        naturalW: img.naturalWidth,
        naturalH: img.naturalHeight,
        renderedW: renderedRect.width || img.width,
        renderedH: renderedRect.height || img.height,
      });
    });
  }

  const videos = el.querySelectorAll<HTMLVideoElement>("video");
  for (const video of videos) {
    mediaCandidates.push(() => {
      const renderedRect = video.getBoundingClientRect();
      considerCandidate({
        src: video.poster || "",
        reason: "video-poster",
        naturalW: video.videoWidth,
        naturalH: video.videoHeight,
        renderedW: renderedRect.width || video.width,
        renderedH: renderedRect.height || video.height,
      });
    });
  }

  for (const node of el.querySelectorAll<HTMLElement>("div, span, a")) {
    mediaCandidates.push(() => {
      const renderedRect = node.getBoundingClientRect();
      for (const src of styleBackgroundImageUrls(node)) {
        if (isVisibleTextBackgroundCard(node)) {
          skipReasons.push(`text-background ${src.slice(0, 60)}`);
          continue;
        }
        considerCandidate({
          src,
          reason: "background-image",
          renderedW: renderedRect.width,
          renderedH: renderedRect.height,
        });
      }
    });
  }

  for (const run of mediaCandidates) {
    if (urls.length >= max) break;
    run();
  }

  if (urls.length === 0 && (imgs.length > 0 || videos.length > 0 || hadMediaCandidate)) {
    // Help triage why a post with N <img> tags came out empty —
    // very common during dev-time tuning of the filter rules.
    try {
      console.warn(`[Truly] image-extract: ${imgs.length} <img>, ${videos.length} <video> in post, kept=0; reasons: ${skipReasons.slice(0, 6).join(" | ")}`);
    } catch { /* ignore */ }
  }

  return { urls, filteredCount };
}
