// Client-side image prefetch + JPEG re-encode for Tier B.
//
// A server-side Tier B backend cannot fetch FB CDN URLs whose signed
// `oh=&oe=` tokens are bound to the original requesting client's IP —
// it receives HTML 403, PIL crashes on `image.size`. By moving the
// fetch to the user's browser, we inherit the right network identity
// AND normalize every frame to a JPEG that common backend image decoders handle
// trivially.
//
// `credentials: "omit"` is required, NOT "include": the signed CDN
// tokens are URL-embedded; sending credentials would force a CORS
// preflight that FB CDN doesn't honor for our extension origin, even
// with `host_permissions` set. Verified empirically on 2026-04-29 —
// `credentials: "include"` fails with "Failed to fetch" while
// `credentials: "omit"` succeeds for the same signed URL.
//
// This is the active rationale after the old OpenSpec archive was removed.

// 640 px is enough for "content-farm detection" (watermarks, stock photos,
// AI-generated images) while keeping base64 payloads ~40–60 KB and image token
// counts manageable. 2026-05-06: reduced from 1024 to cut Tier B latency.
const MAX_EDGE_PX = 640;
const JPEG_QUALITY = 0.72;
const PREFETCH_TIMEOUT_MS = 5000;

export interface PrefetchResult {
  /** JPEG data URIs in input order, with failures filtered out. */
  dataUrls: string[];
  /** Count of input URLs that failed fetch / decode / re-encode. */
  droppedCount: number;
}

/** Fetch each URL via the browser context (so signed FB CDN tokens
 *  bound to the user's IP + cookies are honored), then re-encode as
 *  `image/jpeg` quality 0.85 with longest edge ≤ 1024 px. Failures
 *  drop silently and increment `droppedCount`. */
export async function prefetchImagesForTierB(
  urls: string[],
): Promise<PrefetchResult> {
  if (urls.length === 0) return { dataUrls: [], droppedCount: 0 };

  const settled = await Promise.allSettled(
    urls.map((url) => prefetchOne(url)),
  );

  const dataUrls: string[] = [];
  let droppedCount = 0;
  for (let i = 0; i < settled.length; i++) {
    const r = settled[i];
    if (r.status === "fulfilled") {
      dataUrls.push(r.value);
    } else {
      droppedCount++;
      // Drop reason is logged for triage; the URL is truncated to keep
      // long signed tokens from spamming the console.
      const reason = r.reason instanceof Error ? r.reason.message : String(r.reason);
      console.warn(`[Truly] prefetch drop: ${reason} (${urls[i].slice(0, 100)})`);
    }
  }
  return { dataUrls, droppedCount };
}

async function prefetchOne(url: string): Promise<string> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), PREFETCH_TIMEOUT_MS);
  let blob: Blob;
  try {
    let res: Response;
    try {
      res = await fetch(url, { credentials: "omit", signal: ctrl.signal });
    } catch (e) {
      // "Failed to fetch" from chromium is opaque. Tag with the URL
      // and re-throw so the diagnostic surfaces the underlying cause.
      const msg = e instanceof Error ? e.message : String(e);
      throw new Error(`fetch threw: ${msg}`);
    }
    if (!res.ok) throw new Error(`http ${res.status}`);
    const ct = res.headers.get("content-type") || "";
    if (!ct.toLowerCase().startsWith("image/")) {
      // FB returns `text/html` for token-bound 403s; reject those so
      // we don't try to decode HTML as an image.
      throw new Error(`non-image content-type: ${ct}`);
    }
    blob = await res.blob();
  } finally {
    clearTimeout(timer);
  }

  const bitmap = await createImageBitmap(blob);
  try {
    return encodeJpeg(bitmap);
  } finally {
    bitmap.close?.();
  }
}

function encodeJpeg(bitmap: ImageBitmap): string {
  const { width: srcW, height: srcH } = bitmap;
  const longEdge = Math.max(srcW, srcH);
  const scale = longEdge > MAX_EDGE_PX ? MAX_EDGE_PX / longEdge : 1;
  const dstW = Math.max(1, Math.round(srcW * scale));
  const dstH = Math.max(1, Math.round(srcH * scale));

  const canvas = document.createElement("canvas");
  canvas.width = dstW;
  canvas.height = dstH;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("canvas 2d context unavailable");
  ctx.drawImage(bitmap, 0, 0, dstW, dstH);

  return canvas.toDataURL("image/jpeg", JPEG_QUALITY);
}
