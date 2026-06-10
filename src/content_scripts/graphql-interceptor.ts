/**
 * Injected into MAIN world. Intercepts Facebook GraphQL XHR + handles Ollama calls.
 */

import {
  walkGraphQLForPosts,
  scanScriptForSponsored,
  type ExtractedPost,
} from "../lib/sponsorship-signals";

// --- SSR HTML sponsored detection (lightweight fetch path + cache) ---
//
// Page-context fetch path verified 2026-04-09 during SSR fetch diagnostics.
// that fetch() with `Accept: text/html...` + `credentials: "include"` returns
// the full SSR HTML (~4MB). Caching layer (2026-04-09 follow-up) avoids
// repeating the fetch + scan on same-tab reloads:
//   1. Wait for isolated-world TRULY_CONTENT_READY (so cache messaging works)
//   2. postMessage TRULY_SSR_CACHE_QUERY → isolated reads chrome.storage.session
//   3. On hit (fresh entry within 5min TTL): dispatch cached posts, skip fetch
//   4. On miss: live fetch + scan, then postMessage TRULY_SSR_CACHE_STORE
//
// chrome.storage.session is per-tab and auto-cleared on tab close, so the
// cache TTL aligns with the user's browsing session naturally.

let _resolveIsolatedReady: () => void = () => {};
const _isolatedReadyPromise = new Promise<void>((resolve) => {
  _resolveIsolatedReady = resolve;
});

let _ssrCacheReqSeq = 0;
function requestCacheLookup(url: string): Promise<ExtractedPost[] | null> {
  return new Promise((resolve) => {
    const reqId = `ssrq-${++_ssrCacheReqSeq}-${Date.now()}`;
    const timer = setTimeout(() => {
      window.removeEventListener("message", onMsg);
      resolve(null);
    }, 500);
    function onMsg(event: MessageEvent) {
      const d = event.data;
      if (!d || d.type !== "TRULY_SSR_CACHE_REPLY" || d.reqId !== reqId) return;
      clearTimeout(timer);
      window.removeEventListener("message", onMsg);
      resolve(d.posts ?? null);
    }
    window.addEventListener("message", onMsg);
    window.postMessage({ type: "TRULY_SSR_CACHE_QUERY", url, reqId }, "*");
  });
}

function storeCacheEntry(url: string, posts: ExtractedPost[]): void {
  window.postMessage({ type: "TRULY_SSR_CACHE_STORE", url, posts }, "*");
}

async function fetchAndScanSSR(): Promise<void> {
  // Block until isolated world has attached its message listeners. Without
  // this, TRULY_SSR_CACHE_QUERY would be posted into the void on cold start
  // (MAIN runs at document_start, isolated at document_idle).
  await _isolatedReadyPromise;

  const url = window.location.href;

  // Step 1: try cache
  const cached = await requestCacheLookup(url);
  if (cached && cached.length > 0) {
    console.log(
      `[Truly] SSR cache HIT: ${cached.length} posts (skipped fetch). Authors: [${cached
        .map((p) => `"${p.authorName}"`)
        .join(", ")}]`
    );
    _dispatchPosts(cached);
    return;
  }

  // Step 2: cache miss → live fetch
  console.log(`[Truly] SSR fetch: starting for ${url} (cache miss)`);
  const start = Date.now();
  try {
    const resp = await fetch(url, {
      method: "GET",
      credentials: "include",
      cache: "force-cache",
      headers: {
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9",
        "Accept-Language": "zh-TW,zh;q=0.9,en;q=0.8",
      },
    });
    const html = await resp.text();
    console.log(
      `[Truly] SSR fetch: ${html.length}B in ${Date.now() - start}ms`
    );
    if (html.length === 0) return;
    const posts = scanScriptForSponsored(html);
    if (posts.length === 0) {
      console.log("[Truly] SSR scan: 0 sponsored posts found");
      return;
    }
    console.log(
      `[Truly] SSR scan: ${posts.length} sponsored posts found. Authors: [${posts
        .map((p) => `"${p.authorName}"`)
        .join(", ")}]`
    );
    _dispatchPosts(posts);
    // Step 3: write back to cache (fire-and-forget)
    storeCacheEntry(url, posts);
  } catch (e) {
    console.warn("[Truly] SSR fetch failed:", e);
  }
}

// Wait until DOMContentLoaded so window.location.href is stable post
// any navigation/redirect, then call fetchAndScanSSR (which itself
// awaits the isolated-ready handshake before doing any work).
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", fetchAndScanSSR, { once: true });
} else {
  fetchAndScanSSR();
}

const seenPostIds = new Set<string>();
let postSeqId = 0;

// Buffer dispatched posts so the isolated-world content script can replay
// any messages that arrived before its listener was attached.
// MAIN world (this file) runs at document_start; isolated-world feed-filter
// runs at document_idle, which is much later. Without buffering, the FIRST
// feed XHR's posts are dispatched into the void.
const _postsBuffer: ExtractedPost[] = [];
const POSTS_BUFFER_MAX = 200;

let _gqlXhrCount = 0;
let _gqlPostsExtracted = 0;

function _dispatchPosts(posts: ExtractedPost[]) {
  if (posts.length === 0) return;
  _gqlPostsExtracted += posts.length;
  // Append to buffer (capped)
  for (const p of posts) {
    _postsBuffer.push(p);
    if (_postsBuffer.length > POSTS_BUFFER_MAX) _postsBuffer.shift();
  }
  if (_postsBuffer.length <= 5) {
    console.log(
      `[Truly] interceptor dispatch: +${posts.length} (total buffered=${_postsBuffer.length}) first author="${posts[0]?.authorName}" sponsored=${posts[0]?.isSponsored}`
    );
  }
  // Dispatch live (caught if listener is already attached)
  window.postMessage({ type: "TRULY_GRAPHQL_POSTS", posts }, "*");
}

// Isolated-world handshake: when content script finishes init, it posts
// TRULY_CONTENT_READY. We replay the entire buffer so it gets all posts that
// were dispatched before its listener was attached.
window.addEventListener("message", (event) => {
  if (event.data?.type !== "TRULY_CONTENT_READY") return;
  console.log(
    `[Truly] handshake: buffer=${_postsBuffer.length} gqlXhrSeen=${_gqlXhrCount} extracted=${_gqlPostsExtracted}`
  );
  _resolveIsolatedReady();
  if (_postsBuffer.length === 0) return;
  window.postMessage(
    { type: "TRULY_GRAPHQL_POSTS", posts: _postsBuffer.slice() },
    "*"
  );
});

// --- Sponsorship signal detection ---
//
// The actual walker + predicate table live in `src/lib/sponsorship-signals.ts`
// so they can be unit-tested without pulling in this file's top-level
// fetch/XHR monkey-patches. Here we add the session-level dedup that the
// pure helper deliberately doesn't do.

function extractPostsFromGraphQL(data: any): ExtractedPost[] {
  const all = walkGraphQLForPosts(data);
  const fresh: ExtractedPost[] = [];
  for (const p of all) {
    const id = p.postId || `gql-${++postSeqId}`;
    if (seenPostIds.has(id)) continue;
    seenPostIds.add(id);
    if (p.isSponsored) {
      console.log(
        `[Truly] Sponsored detected via GraphQL scan (postId=${id})`
      );
    }
    fresh.push({ ...p, postId: id });
  }
  return fresh;
}

// --- Monkey-patch fetch ---
const originalFetch = window.fetch;
window.fetch = async function (...args: Parameters<typeof fetch>) {
  const response = await originalFetch.apply(this, args);
  try {
    const input = args[0];
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : input?.url || "";
    if (url.includes("/api/graphql/")) {
      _gqlXhrCount++;
      if (_gqlXhrCount <= 5) console.log(`[Truly] interceptor saw fetch /api/graphql/ #${_gqlXhrCount}`);
      const clone = response.clone();
      clone.text().then((text) => {
        _trulyMaybeDump(text);
        for (const line of text.split("\n")) {
          if (!line.trim()) continue;
          try {
            const data = JSON.parse(line);
            const posts = extractPostsFromGraphQL(data);
            _dispatchPosts(posts);
          } catch {}
        }
      });
    }
  } catch {}
  return response;
};

// --- Monkey-patch XHR ---
const OrigXHR = XMLHttpRequest;
const origOpen = OrigXHR.prototype.open;
const origSend = OrigXHR.prototype.send;

OrigXHR.prototype.open = function (method: string, url: string, ...rest: any[]) {
  (this as any).__trulyUrl = url;
  return origOpen.apply(this, [method, url, ...rest] as any);
};

OrigXHR.prototype.send = function (...args: Parameters<XMLHttpRequest["send"]>) {
  const url = (this as any).__trulyUrl || "";
  if (url.includes("/api/graphql/")) {
    _gqlXhrCount++;
    if (_gqlXhrCount <= 5) console.log(`[Truly] interceptor saw XHR /api/graphql/ #${_gqlXhrCount}`);
    this.addEventListener("load", function () {
      try {
        const text = this.responseText || "";
        _trulyMaybeDump(text);
        for (const line of text.split("\n")) {
          if (!line.trim()) continue;
          try {
            const data = JSON.parse(line);
            const posts = extractPostsFromGraphQL(data);
            _dispatchPosts(posts);
          } catch {}
        }
      } catch {}
    });
  }
  return origSend.apply(this, args);
};

// (Removed: dead TRULY_OLLAMA_REQUEST handler. Ollama classification now
// happens in the isolated content script via direct fetch to localhost,
// which the manifest grants via host_permissions.)

// --- Debug helper: capture next GraphQL response containing a substring ---
//
// Usage in DevTools console:
//   __trulyDumpGraphQL('眠豆腐')
// Then scroll the feed until the matching post loads. The full GraphQL
// response containing that substring will be dumped to the console so you
// can find the actual sponsorship field name FB is using.
let _trulyDumpNeedle: string | null = null;
(window as any).__trulyDumpGraphQL = (needle: string) => {
  _trulyDumpNeedle = needle;
  console.log(`[Truly Debug] Will dump next GraphQL response containing "${needle}". Scroll the feed.`);
};
function _trulyMaybeDump(text: string) {
  if (_trulyDumpNeedle && text.includes(_trulyDumpNeedle)) {
    console.log(`[Truly Debug] === GraphQL response containing "${_trulyDumpNeedle}" ===`);
    // Try to parse and pretty-print each NDJSON line
    for (const line of text.split("\n")) {
      if (!line.trim()) continue;
      try {
        const data = JSON.parse(line);
        console.log("[Truly Debug] line:", data);
      } catch {
        console.log("[Truly Debug] (unparseable line):", line.slice(0, 200));
      }
    }
    console.log(`[Truly Debug] === end dump ===`);
    _trulyDumpNeedle = null; // one-shot
  }
}

// --- Debug helper: search page HTML for SSR'd sponsored signals ---
//
// Usage in DevTools console:
//   __trulyDumpSSR('Terry Chen')
//   __trulyDumpSSR('hahow')
// Searches all <script type="application/json"> tags + the full document
// HTML for the substring, and reports any sponsorship-related fields found
// nearby. Use this when a sponsored post is visible but the GraphQL
// interceptor never saw it (i.e. FB pre-rendered it via SSR).
(window as any).__trulyDumpSSR = (needle: string) => {
  console.log(`[Truly Debug] Searching SSR for "${needle}"...`);

  // 1. JSON script tags
  const jsonScripts = document.querySelectorAll('script[type="application/json"]');
  console.log(`[Truly Debug] Found ${jsonScripts.length} JSON script tags`);
  let jsonHits = 0;
  for (const s of jsonScripts) {
    const txt = s.textContent || "";
    if (!txt.includes(needle)) continue;
    jsonHits++;
    console.log(
      `[Truly Debug] JSON tag match #${jsonHits}: ${txt.length} bytes`
    );
    // Check for sponsorship markers near the needle
    const idx = txt.indexOf(needle);
    const slice = txt.slice(Math.max(0, idx - 1000), idx + 2000);
    const markers: string[] = [];
    if (slice.includes("th_dat_spo")) markers.push("th_dat_spo");
    if (slice.includes('"is_sponsored"')) markers.push("is_sponsored");
    if (slice.includes('"sponsored_data"')) markers.push("sponsored_data");
    if (slice.includes('"ad_id"')) markers.push("ad_id");
    if (slice.includes('"ad_client_token"')) markers.push("ad_client_token");
    if (slice.includes('"sponsored_auction_distance"'))
      markers.push("sponsored_auction_distance");
    if (slice.includes('"cat_sensitive"')) markers.push("cat_sensitive");
    if (slice.includes("ghl_mocked")) markers.push("ghl_mocked");
    if (slice.includes("Sponsored")) markers.push("Sponsored (literal)");
    console.log(
      `  ↳ markers found in ±1KB window:`,
      markers.length ? markers : "(none)"
    );
    if (jsonHits === 1) {
      console.log(`  ↳ context (200 chars after needle):`, slice.slice(1000, 1200));
    }
  }

  // 2. All other inline scripts (might contain JS-encoded data)
  const allScripts = document.querySelectorAll("script:not([type])");
  let inlineHits = 0;
  for (const s of allScripts) {
    const txt = s.textContent || "";
    if (!txt.includes(needle)) continue;
    inlineHits++;
    if (inlineHits === 1) {
      console.log(`[Truly Debug] inline <script> match: ${txt.length} bytes`);
      const idx = txt.indexOf(needle);
      console.log(`  ↳ context: ${txt.slice(Math.max(0, idx - 200), idx + 400)}`);
    }
  }
  console.log(`[Truly Debug] inline-script matches: ${inlineHits}`);

  // 3. Stats summary
  console.log(
    `[Truly Debug] SSR search done. JSON-tag hits: ${jsonHits}, inline-script hits: ${inlineHits}`
  );
};

// (Removed: __trulyDebugReactProps. The React-fiber sponsorship-detection
// approach was abandoned in 2026-04 — Facebook stripped `__reactProps$*`
// from DOM nodes since 2022. The element walker over div/span/a/strong/h4
// covers the same use case via plain DOM. See archived change
// `2026-04-07-react-props-sponsored-detection`.)

console.log("[Truly] GraphQL interceptor installed (fetch + XHR). Debug: __trulyDumpGraphQL(needle), __trulyDumpSSR(needle)");
