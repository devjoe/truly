/**
 * Pure helpers for detecting sponsorship in raw GraphQL responses.
 *
 * Extracted from `src/content_scripts/graphql-interceptor.ts` so that the
 * unit test suite can exercise them in isolation. The interceptor file
 * has top-level side effects (monkey-patching window.fetch / XHR), which
 * makes importing it directly into a Vitest jsdom environment fragile.
 *
 * This module is side-effect free and safe to import from anywhere.
 */

import type { PostType } from "./types";

export interface ExtractedPost {
  postId: string;
  text: string;
  authorName: string;
  isSponsored: boolean;
  postType?: PostType;
  reshareOriginalText?: string;
  reshareOriginalAuthor?: string;
}

// --- SSR HTML scanner ---
//
// Facebook embeds first-screen sponsored data inline in the navigation
// HTML response (server-rendered). After the page hydrates, FB removes
// the relevant <script> elements from the live DOM, so we have to scan
// the raw HTML before hydration completes.
//
// `scanScriptForSponsored` finds every `"th_dat_spo":{...}` marker (FB's
// current sponsorship indicator) and extracts the matching post's
// identifying fields (actors[0].name, message.text, post_id) by absolute
// byte position. Earlier versions used `±80KB window.match()` which
// returned the first hit in the window — for the second/third sponsored
// post in a long SSR HTML, the first hit was always from a previous
// post, so every marker borrowed identifying fields from the first post
// in the file. The current implementation pre-collects ALL occurrences
// with positions and picks the spatially closest one per marker.
//
// Pure: no module state, safe to call from content script OR service
// worker.

interface PositionedMatch {
  pos: number;
  value: string;
}

function collectAllMatches(
  text: string,
  re: RegExp,
  unescape: boolean
): PositionedMatch[] {
  const out: PositionedMatch[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    out.push({
      pos: m.index,
      value: unescape ? unescapeJsonString(m[1]) : m[1],
    });
    // Guard against zero-width matches
    if (re.lastIndex === m.index) re.lastIndex++;
  }
  return out;
}

function nearest<T extends { pos: number }>(
  matches: T[],
  target: number
): T | null {
  let best: T | null = null;
  let bestDist = Infinity;
  for (const m of matches) {
    const d = Math.abs(m.pos - target);
    if (d < bestDist) {
      bestDist = d;
      best = m;
    }
  }
  return best;
}

export function unescapeJsonString(s: string): string {
  try {
    return JSON.parse(
      '"' + s.replace(/"/g, '\\"').replace(/\\\\"/g, '\\"') + '"'
    );
  } catch {
    return s;
  }
}

export function scanScriptForSponsored(scriptText: string): ExtractedPost[] {
  const out: ExtractedPost[] = [];

  // "th_dat_spo":{...} where ... is non-null content (organic posts have
  // "th_dat_spo":null which won't match the {...} brace).
  const markerRe = /"th_dat_spo":\{[^{}]{0,500}\}/g;
  // Upper bound on text is generous because SSR uses \uXXXX escapes
  // (6 chars per Chinese glyph).
  const messageRe = /"message":\{"text":"((?:[^"\\]|\\.){10,8000})"/g;
  const actorsRe = /"actors":\[\{[^\]]*?"name":"((?:[^"\\]|\\.){1,200})"/g;
  const postIdRe = /"post_id":"(\d+)"/g;

  // Pre-collect ALL occurrences of each field with absolute positions,
  // then for each th_dat_spo marker pick the spatially closest one.
  const allMessages = collectAllMatches(scriptText, messageRe, true);
  const allActors = collectAllMatches(scriptText, actorsRe, true);
  const allPostIds = collectAllMatches(scriptText, postIdRe, false);

  let fallbackId = 0;
  let m: RegExpExecArray | null;
  while ((m = markerRe.exec(scriptText)) !== null) {
    const pos = m.index;
    const text = nearest(allMessages, pos)?.value ?? "";
    const author = nearest(allActors, pos)?.value ?? "";
    const postId =
      nearest(allPostIds, pos)?.value ?? `ssr-${++fallbackId}`;

    if (text.length > 10 || author.length > 1) {
      out.push({
        postId,
        text,
        authorName: author,
        isSponsored: true,
      });
    }
  }
  return out;
}

// Facebook rotates between several field names to mark sponsored posts in
// GraphQL responses. Each entry below is a (key, predicate) pair: the
// predicate defines what value shape on that key counts as "this post is
// sponsored". Adding a newly-rotated field is a one-line change.
//
// Source: docs/ad-blocker-research.md §2 (FB anti-adblock arms race).
// Last verified: 2026-04-07
export const SPONSORSHIP_FIELD_PREDICATES: Record<
  string,
  (val: unknown) => boolean
> = {
  is_sponsored: (v) => v === true,
  sponsored_data: (v) => v != null && typeof v === "object",
  ad_id: (v) => typeof v === "string" && v.length > 0,
  boosted_post_data: (v) => v != null && typeof v === "object",
  is_pseudo_organic: (v) => v === true,
  ad_client_token: (v) => typeof v === "string" && v.length > 0,
  // tracking_data exists on most posts; only sponsored ones contain ad sub-keys
  tracking_data: (v) =>
    v != null &&
    typeof v === "object" &&
    ("ad_id" in (v as object) || "campaign_id" in (v as object)),
  // legacy field, kept for backwards compatibility
  sponsor_id: (v) => v != null,
  // FB's current (2026-04) top-level sponsorship marker on each post.
  // Confirmed via Playwright capture of /api/graphql/ feed responses:
  // sponsored posts have `th_dat_spo: { lbl_adv_iden, client_token, ad_id }`,
  // organic posts have `th_dat_spo: null`. Most reliable signal we have.
  th_dat_spo: (v) => v != null && typeof v === "object",
};

// Recursively scan a post subtree for any sponsorship signal field whose
// predicate returns true. Bounded by depth and cycle-safe via WeakSet.
export function containsSponsorshipSignal(
  subtree: unknown,
  depth = 0,
  seen: WeakSet<object> = new WeakSet()
): boolean {
  if (depth > 15) return false;
  if (!subtree || typeof subtree !== "object") return false;
  if (seen.has(subtree as object)) return false;
  seen.add(subtree as object);

  const node = subtree as Record<string, unknown>;

  // Check own keys against the predicate table
  try {
    for (const key of Object.keys(node)) {
      const predicate = SPONSORSHIP_FIELD_PREDICATES[key];
      if (predicate && predicate(node[key])) {
        return true;
      }
    }
  } catch {
    /* fail closed on enumeration error */
  }

  // Descend into nested objects/arrays
  try {
    if (Array.isArray(node)) {
      for (const item of node) {
        if (containsSponsorshipSignal(item, depth + 1, seen)) return true;
      }
    } else {
      for (const key of Object.keys(node)) {
        const val = node[key];
        if (val && typeof val === "object") {
          if (containsSponsorshipSignal(val, depth + 1, seen)) return true;
        }
      }
    }
  } catch {
    /* fail closed */
  }
  return false;
}

/**
 * Detect the structural type of a GraphQL post node based on the
 * presence of specific fields. Evaluated in priority order (a reshare
 * inside a group is tagged as `reshare`, not `group`).
 */
export function detectPostType(node: Record<string, unknown>): PostType {
  if (node.attached_story != null) return "reshare";
  if (typeof node.url === "string" && (node.url as string).includes("/reel/"))
    return "reel";
  if (node.target_group != null) return "group";
  if (node.is_text_only_story === true) return "text_only";
  if (!Array.isArray(node.actors) || (node.actors as unknown[]).length === 0)
    return "page";
  return "standard";
}

/**
 * Walk a parsed GraphQL response and return every post node that has a
 * `message.text` of useful length. Each returned post is tagged with
 * `isSponsored` based on `containsSponsorshipSignal` evaluated against
 * that post's own subtree (not the envelope), so signals don't leak.
 *
 * Pure: no module state. Caller is responsible for cross-call dedup
 * via post id (the interceptor maintains its own seenPostIds set).
 */
export function walkGraphQLForPosts(data: unknown): ExtractedPost[] {
  const posts: ExtractedPost[] = [];

  function walk(obj: unknown, depth = 0): void {
    if (!obj || typeof obj !== "object" || depth > 30) return;
    const node = obj as Record<string, unknown>;
    const message = node.message as
      | { text?: unknown }
      | null
      | undefined;
    if (
      message &&
      typeof message === "object" &&
      typeof message.text === "string" &&
      message.text.length > 3
    ) {
      const creationStory = node.creation_story as
        | { post_id?: unknown; id?: unknown }
        | null
        | undefined;
      const postIdRaw =
        node.post_id ??
        node.story_id ??
        node.id ??
        node.feedback_id ??
        creationStory?.post_id ??
        creationStory?.id ??
        "";
      const sponsored = containsSponsorshipSignal(node, 0, new WeakSet());
      const actors = node.actors as Array<{ name?: unknown }> | undefined;
      const owningProfile = node.owning_profile as
        | { name?: unknown }
        | undefined;
      const cometActors = (
        node.comet_sections as
          | { context_layout?: { story?: { actors?: Array<{ name?: unknown }> } } }
          | undefined
      )?.context_layout?.story?.actors;

      const authorName =
        (actors?.[0]?.name as string | undefined) ??
        (owningProfile?.name as string | undefined) ??
        (cometActors?.[0]?.name as string | undefined) ??
        "";

      // With depth=30 we now reach inner fragments like
      // feedback.story.story_ufi_container.story — they carry
      // post_id+message.text but no author metadata, so they'd duplicate
      // the outer post as a "page" type with empty author. Require
      // author presence; the outer top-level story node (which has
      // actors) still emits normally.
      const shouldEmit = !!authorName;
      // Detect post type from structural signals
      const postType = detectPostType(node);

      // For reshare posts, extract the original author + text
      let reshareOriginalText: string | undefined;
      let reshareOriginalAuthor: string | undefined;
      if (postType === "reshare") {
        const attached = node.attached_story as Record<string, unknown> | undefined;
        if (attached) {
          const attachedMsg = attached.message as { text?: string } | undefined;
          reshareOriginalText = attachedMsg?.text;
          const attachedActors = attached.actors as Array<{ name?: string }> | undefined;
          reshareOriginalAuthor = attachedActors?.[0]?.name;
        }
      }

      if (shouldEmit) {
        posts.push({
          postId: String(postIdRaw),
          text: message.text,
          authorName,
          isSponsored: sponsored,
          postType,
          reshareOriginalText,
          reshareOriginalAuthor,
        });
      }
    }
    if (Array.isArray(node)) {
      for (const item of node) walk(item, depth + 1);
    } else {
      for (const key of Object.keys(node)) {
        if (typeof node[key] === "object") walk(node[key], depth + 1);
      }
    }
  }

  walk(data);

  // Within-call dedup by text prefix (FB sometimes returns the same post
  // under multiple feed sections in a single response).
  const unique: ExtractedPost[] = [];
  const seen = new Set<string>();
  for (const p of posts) {
    const k = p.text.slice(0, 50);
    if (!seen.has(k)) {
      seen.add(k);
      unique.push(p);
    }
  }
  return unique;
}
