import type { EngagementHints, PostData, PostType } from "../lib/types";
import { debugLog } from "../lib/logger";
import {
  isCandidateFacebookAuthorUrl,
  isFacebookGroupFeedPath,
  isFacebookGroupUserPath,
  isFacebookHost,
  looksLikeFacebookChromeLinkText,
  looksLikeUrlText,
} from "../lib/facebook-link-contract";
import {
  isFacebookCommentThreadBoundaryText,
  looksLikeFacebookBylineChromeOnlyText,
  looksLikeFacebookNonAuthorChromeLabel,
  looksLikeFacebookTimestampOnlyText,
} from "../lib/facebook-ui-contract";

const SCAN_INTERVAL = 2000;

let onNewPost: ((post: PostData) => void) | null = null;
let postCounter = 0;
let scanTimer: ReturnType<typeof setInterval> | null = null;
let processedElements = new WeakSet<HTMLElement>();

// When the extension is reloaded or its service worker dies during dev,
// chrome.runtime.id goes undefined and any chrome.* call throws
// "Extension context invalidated". Detect that and stop the scan loop +
// suppress further chrome API calls so the old content script fades out
// cleanly until the tab is reloaded.
export function isExtensionContextValid(): boolean {
  try {
    return typeof chrome !== "undefined" && chrome.runtime?.id !== undefined;
  } catch {
    return false;
  }
}

function generatePostId(): string {
  return `truly-post-${Date.now()}-${++postCounter}`;
}

function postDomSignature(el: HTMLElement): string | null {
  const identity = extractPostIdentity(el);
  const author = normalizeAuthor(identity.authorName || "");
  const text = stripIdentityFromTextCandidate(extractCleanPostText(el, identity), identity)
    .replace(/\s+/g, " ")
    .trim();
  const seed = text.slice(0, 80);
  if (!author && seed.length < 5) return null;
  return `${author}|${seed}`;
}

function signaturesMatch(previous: string, current: string): boolean {
  if (previous === current) return true;
  const [prevAuthor = "", prevText = ""] = previous.split("|", 2);
  const [currAuthor = "", currText = ""] = current.split("|", 2);
  if (prevAuthor !== currAuthor) return false;
  if (!prevText || !currText) return true;
  return prevText.startsWith(currText) || currText.startsWith(prevText);
}

function clearInjectedSurfaces(el: HTMLElement): void {
  for (const node of el.querySelectorAll(
    ".truly-headsup-host,.truly-headsup,.truly-headsup-placeholder,.truly-overlay,.truly-report-pill-group,.truly-report-pill,.truly-collapse-bar",
  )) {
    node.remove();
  }
  for (const child of Array.from(el.children)) {
    if (child instanceof HTMLElement && child.style.display === "none") {
      child.style.display = "";
    }
  }
}

function clearTrulyPostState(el: HTMLElement): void {
  clearInjectedSurfaces(el);
  delete el.dataset.trulyId;
  delete el.dataset.trulyStableId;
  delete el.dataset.trulySponsored;
  delete el.dataset.trulyRecommended;
  delete el.dataset.trulyContentKind;
  delete el.dataset.trulyClassifiedLen;
  delete el.dataset.trulyOriginalHeight;
  delete el.dataset.trulyAutoFoldExpanded;
  delete el.dataset.trulyDomSignature;
  delete el.dataset.trulySkipReason;
}

function resetRecycledPostContainer(el: HTMLElement): boolean {
  const previous = el.dataset.trulyDomSignature;
  if (!previous || !el.dataset.trulyId) return false;
  const current = postDomSignature(el);
  if (!current || signaturesMatch(previous, current)) return false;

  console.warn(
    `[Truly] Recycled FB post container detected; reprocessing id=${el.dataset.trulyId}`,
  );
  clearTrulyPostState(el);
  return true;
}

// --- GraphQL data store ---

interface GraphQLPost {
  postId: string;
  text: string;
  authorName: string;
  isSponsored: boolean;
  postType?: PostType;
  reshareOriginalText?: string;
  reshareOriginalAuthor?: string;
}

const gqlPostsByAuthor = new Map<string, GraphQLPost>();
const gqlPostsByText = new Map<string, GraphQLPost>();

// Session-level memory of "this text is sponsored" that survives DOM
// remounts. Facebook virtual-scrolls articles in/out of the DOM, so the
// `data-truly-sponsored` attribute on a node dies when the node is unmounted.
// When the same post comes back into view, scanForNewPosts treats it as a
// fresh post and would re-classify from scratch. Keep text seeds only:
// author-level memory is too broad on profile/feed pages and can turn one
// false positive into many collapsed organic posts from the same author.
const knownSponsoredTextSeeds = new Set<string>();

interface PostIdentity {
  authorName?: string;
  sourceName?: string;
}

// Normalize an author name from either GraphQL (`obj.actors[0].name`) or DOM
// (extractAuthor → h4/strong text). DOM authors often carry verbose suffixes
// like "已驗證帳號", "已验证账号", "Verified", "追蹤", "加入", "· Follow",
// or trailing separators. Strip them all so both sides hash to the same key.
export function normalizeAuthor(raw: string): string {
  let s = raw.trim();
  // Strip verification / follow / join markers anywhere in the string
  s = s.replace(
    /\s*(已驗證帳號|已验证账号|已驗證|Verified|追蹤|Follow|加入|Join|關注)\s*/g,
    " "
  );
  // Split on separators FB uses to chain badges
  s = s.split(/[·•──✓\u00b7]/)[0];
  return s.trim();
}

function isGenericFeedWrapperAuthor(author: string | undefined): boolean {
  const normalized = normalizeAuthor(author || "");
  return [
    "動態消息貼文",
    "News Feed post",
    "Feed post",
  ].includes(normalized);
}

function normalizedHref(anchor: HTMLAnchorElement): URL | null {
  try {
    return new URL(anchor.href || anchor.getAttribute("href") || "", window.location.href);
  } catch {
    return null;
  }
}

function normalizedHrefPath(anchor: HTMLAnchorElement): string {
  return normalizedHref(anchor)?.pathname || anchor.getAttribute("href") || "";
}

function isGroupFeedLink(anchor: HTMLAnchorElement): boolean {
  return isFacebookGroupFeedPath(normalizedHrefPath(anchor));
}

function isGroupUserLink(anchor: HTMLAnchorElement): boolean {
  return isFacebookGroupUserPath(normalizedHrefPath(anchor));
}

function readableLinkText(anchor: HTMLAnchorElement): string {
  return (visibleText(anchor) || anchor.getAttribute("aria-label") || anchor.textContent || "").trim();
}

export function extractPostIdentity(el: HTMLElement): PostIdentity {
  let sourceName: string | undefined;
  let groupAuthorName: string | undefined;

  for (const anchor of Array.from(el.querySelectorAll<HTMLAnchorElement>("a[href]"))) {
    const text = readableLinkText(anchor);
    if (!text) continue;
    if (!sourceName && isGroupFeedLink(anchor)) {
      sourceName = normalizeAuthor(text);
      continue;
    }
    if (!groupAuthorName && isGroupUserLink(anchor)) {
      groupAuthorName = normalizeAuthor(text);
    }
    if (sourceName && groupAuthorName) break;
  }

  return {
    authorName: groupAuthorName || extractAuthor(el),
    sourceName,
  };
}

function identityLineMatches(line: string, value: string): boolean {
  if (!value) return false;
  if (line === value) return true;
  if (normalizeAuthor(line) === value) return true;
  return line.startsWith(`${value} ·`) || line.startsWith(`${value} •`);
}

function stripLeadingIdentityPrefix(line: string, values: string[]): string {
  let out = line.trim();
  for (let pass = 0; pass < values.length + 2; pass += 1) {
    let changed = false;
    for (const value of values) {
      if (!value || !out.startsWith(value)) continue;
      const next = out.charAt(value.length);
      const remainder = out.slice(value.length).trim();
      if (
        next &&
        !/\s|[·•:：-]/.test(next) &&
        !looksLikeTimestampOnlyLine(remainder) &&
        !looksLikeBylineChromeOnlyLine(remainder)
      ) continue;
      out = remainder.replace(/^[\s·•:：-]+/, "").trim();
      changed = true;
    }
    if (!changed) break;
  }
  return out;
}

function stripLeadingBylineChrome(line: string): string {
  return line
    .replace(/^(?:管理員|社團專家|保持發言的成員|最常發言的成員|熱衷發言的成員|版主|Admin|Moderator|Group expert|Top contributor)\s*/i, "")
    .trim();
}

function looksLikeUnknownSourcePrefix(prefix: string): boolean {
  return /(社團|討論區|交流|中心|貼圖區|新聞|News|Taiwan|Club|Group|AI|技術|協會|譯站|論壇|社群)/i.test(prefix);
}

function stripUnknownSourceBeforeAuthor(line: string, authorName: string): string {
  if (!authorName) return line;
  const idx = line.indexOf(authorName);
  if (idx <= 0 || idx > 80) return line;
  const prefix = line.slice(0, idx).trim();
  const rest = line.slice(idx + authorName.length).replace(/^[\s·•:：-]+/, "").trim();
  if (prefix.length < 2 || rest.length < 2) return line;
  if (/[。！？!?，,；;]/.test(prefix)) return line;
  if (!looksLikeUnknownSourcePrefix(prefix)) return line;
  return rest;
}

export function stripLeadingIdentityLines(text: string, identity: PostIdentity): string {
  const sourceName = identity.sourceName ? normalizeAuthor(identity.sourceName) : "";
  const authorName = identity.authorName ? normalizeAuthor(identity.authorName) : "";
  const identityNames = [sourceName, authorName].filter(Boolean);
  const lines = text.split("\n");
  let idx = 0;

  while (idx < lines.length) {
    const line = lines[idx].trim();
    if (!line) {
      idx += 1;
      continue;
    }
    if (sourceName && identityLineMatches(line, sourceName)) {
      idx += 1;
      continue;
    }
    if (authorName && identityLineMatches(line, authorName)) {
      idx += 1;
      continue;
    }
    if (
      !sourceName &&
      authorName &&
      looksLikeUnknownSourcePrefix(line) &&
      idx + 1 < lines.length &&
      identityLineMatches(lines[idx + 1].trim(), authorName)
    ) {
      idx += 2;
      continue;
    }
    const stripped = stripLeadingIdentityPrefix(line, identityNames);
    if (stripped !== line) {
      if (!stripped) {
        idx += 1;
        continue;
      }
      lines[idx] = stripped;
    }
    if (!sourceName) {
      const unknownSourceStripped = stripUnknownSourceBeforeAuthor(lines[idx].trim(), authorName);
      if (unknownSourceStripped !== lines[idx].trim()) {
        lines[idx] = unknownSourceStripped;
      }
    }
    const bylineStripped = stripLeadingBylineChrome(lines[idx].trim());
    if (bylineStripped !== lines[idx].trim()) {
      if (!bylineStripped) {
        idx += 1;
        continue;
      }
      lines[idx] = bylineStripped;
    }
    break;
  }

  return lines.slice(idx).join("\n").trim();
}

function extractCleanPostText(el: HTMLElement, identity = extractPostIdentity(el)): string {
  const primary = extractPrimaryMessageText(el, identity);
  if (primary) return primary;
  return stripLeadingIdentityLines(cleanText(extractPostBody(el)), identity);
}

function stripIdentityFromTextCandidate(text: string, identity: PostIdentity): string {
  return stripLeadingIdentityLines(text.trim(), identity);
}

function isNestedArticleNode(el: Element, root: HTMLElement): boolean {
  const topArticle = root.matches('[role="article"],article')
    ? root
    : root.querySelector<HTMLElement>('[role="article"],article');
  const article = el.closest<HTMLElement>('[role="article"],article');
  return Boolean(article && topArticle && article !== topArticle);
}

function isPrimaryMessageCandidate(text: string, identity: PostIdentity): boolean {
  const clean = text.trim();
  if (clean.length < 8) return false;
  if (/^Facebook$/i.test(clean)) return false;
  if (/貼文的相片|個人檔案照片|封面相片/.test(clean)) return false;
  if (/^[A-Za-z0-9]{12,}(?:\.com)?$/i.test(clean)) return false;
  if (looksLikeStandaloneUrlText(clean)) return false;
  const sourceName = identity.sourceName ? normalizeAuthor(identity.sourceName) : "";
  const authorName = identity.authorName ? normalizeAuthor(identity.authorName) : "";
  if (sourceName && identityLineMatches(clean, sourceName)) return false;
  if (authorName && identityLineMatches(clean, authorName)) return false;
  return true;
}

export function extractPrimaryMessageText(root: HTMLElement, identity = extractPostIdentity(root)): string {
  const candidates: string[] = [];
  for (const el of Array.from(root.querySelectorAll<HTMLElement>('[dir="auto"]'))) {
    if (isTrulyUI(el) || isNestedArticleNode(el, root)) continue;
    if (isAfterCommentThreadBoundary(root, el)) continue;
    const label = el.getAttribute("aria-label");
    if (label && ACTION_BAR_ARIA_LABELS.has(label.trim())) continue;
    const text = stripLeadingIdentityLines(cleanText(visibleText(el)), identity);
    if (!isPrimaryMessageCandidate(text, identity)) continue;
    candidates.push(text);
  }
  return candidates[0] || "";
}

function compactComparableText(text: string): string {
  return text.replace(/\s+/g, "").trim();
}

function isShareWithoutOwnComment(text: string, sharedAttachmentText: string | undefined): boolean {
  if (!sharedAttachmentText) return false;
  const own = compactComparableText(text);
  const shared = compactComparableText(sharedAttachmentText);
  if (own.length <= 1) return true;
  return shared.length >= 2 && (shared.includes(own) || own.includes(shared));
}

function isUsefulAttachmentLine(line: string): boolean {
  const t = line.trim();
  if (t.length < 2) return false;
  if (/^(在 Reels 檢視畫面開啟 Reel|Open Reel in Reels|查看擁有者個人檔案|View owner profile)$/i.test(t)) return false;
  if (/^(追蹤|Follow|原始音訊|Original audio)$/i.test(t)) return false;
  if (/^[a-z0-9]{10,}(?:\.com)?$/i.test(t)) return false;
  if (looksLikeStandaloneUrlText(t)) return false;
  return true;
}

function documentHasLayout(doc: Document): boolean {
  return (doc.documentElement?.clientWidth || 0) > 0 ||
    (doc.body?.clientWidth || 0) > 0;
}

function hasUsableLayoutBox(el: HTMLElement): boolean {
  if (!documentHasLayout(el.ownerDocument)) return true;
  const rect = el.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
}

function hasReshareCardLayoutBox(el: HTMLElement): boolean {
  if (!documentHasLayout(el.ownerDocument)) return true;
  const rect = el.getBoundingClientRect();
  return rect.width >= 240 && rect.height >= 60;
}

function stripHiddenAttachmentPrefix(text: string): string {
  return text
    .replace(/^[A-Za-z0-9]{4,}\.com[\s\n]*/i, "")
    .replace(/^[^\n]{2,20}(?=【)/, "")
    .trim();
}

function isDuplicateOfOwnText(candidate: string, ownText?: string): boolean {
  if (!ownText) return false;
  const own = compactComparableText(ownText);
  if (own.length < 20) return false;
  const raw = compactComparableText(candidate);
  const stripped = compactComparableText(stripHiddenAttachmentPrefix(candidate));
  return (raw.length >= own.length && raw.includes(own)) ||
    (stripped.length >= own.length && stripped.includes(own)) ||
    (own.length >= stripped.length && stripped.length >= 20 && own.includes(stripped));
}

interface ReshareSplit {
  sharerText: string;
  originalAuthor: string;
  originalText: string;
}

function isCandidateReshareAuthorLink(anchor: HTMLAnchorElement): boolean {
  return isCandidateFacebookAuthorUrl(anchor.href || anchor.getAttribute("href") || "", window.location.href);
}

function rawElementText(el: Element): string {
  return ((el as HTMLElement).innerText || el.textContent || el.getAttribute("aria-label") || "")
    .replace(/\s+/g, " ")
    .trim();
}

const POST_ACTION_BOUNDARY_LABELS = new Set([
  "讚", "Like", "喜歡",
  "留言", "Comment",
  "分享", "Share",
  "傳送", "Send",
]);

function isPostActionBoundaryElement(el: HTMLElement): boolean {
  const label = (el.getAttribute("aria-label") || "").trim();
  if (POST_ACTION_BOUNDARY_LABELS.has(label)) return true;
  const role = (el.getAttribute("role") || "").trim();
  const tag = el.tagName.toLowerCase();
  return (role === "button" || tag === "button") &&
    POST_ACTION_BOUNDARY_LABELS.has(rawElementText(el));
}

function findCommentThreadBoundary(root: HTMLElement): HTMLElement | null {
  for (const el of Array.from(root.querySelectorAll<HTMLElement>('[role="button"], button, a'))) {
    if (isFacebookCommentThreadBoundaryText(rawElementText(el))) return el;
    if (isPostActionBoundaryElement(el)) return el;
  }
  return null;
}

function isAfterCommentThreadBoundary(root: HTMLElement, node: Node): boolean {
  const boundary = findCommentThreadBoundary(root);
  if (!boundary) return false;
  return (boundary.compareDocumentPosition(node) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
}

function looksLikeStandaloneUrlText(value: string): boolean {
  const clean = value.trim();
  if (!clean || /\s/.test(clean)) return false;
  return /^(?:https?:\/\/|www\.)?[a-z0-9][a-z0-9-]*(?:\.[a-z0-9][a-z0-9-]*)+(?:[/?#][^\s]*)?$/i.test(clean);
}

function candidateReshareAuthors(el: HTMLElement, sharerName: string): string[] {
  const out: string[] = [];
  const sharer = normalizeAuthor(sharerName);
  for (const anchor of Array.from(el.querySelectorAll<HTMLAnchorElement>("a[href]"))) {
    if (isAfterCommentThreadBoundary(el, anchor)) continue;
    const name = normalizeAuthor(readableLinkText(anchor));
    if (name.length < 2 || name.length > 80) continue;
    if (looksLikeFacebookNonAuthorChromeLabel(name)) continue;
    if (looksLikeFacebookChromeLinkText(name)) continue;
    if (looksLikeUrlText(name)) continue;
    if (identityLineMatches(name, sharer) || identityLineMatches(sharer, name)) continue;
    if (!isCandidateReshareAuthorLink(anchor)) continue;
    if (!out.includes(name)) out.push(name);
  }
  return out.slice(0, 8);
}

function looksLikeObfuscatedBylineLine(line: string): boolean {
  const clean = line.trim();
  if (clean.length < 20) return false;
  const tokens = clean.split(/\s+/).filter(Boolean);
  if (tokens.length < 8) return false;
  const singleCharTokens = tokens.filter((token) => token.length === 1).length;
  if (singleCharTokens < Math.floor(tokens.length * 0.55)) return false;
  return /\d/.test(clean) && /[年月日時小分秒]/.test(clean);
}

function looksLikeTimestampOnlyLine(line: string): boolean {
  return looksLikeFacebookTimestampOnlyText(line);
}

function looksLikeBylineChromeOnlyLine(line: string): boolean {
  return looksLikeFacebookBylineChromeOnlyText(line);
}

function stripLeadingObfuscatedBylinePrefix(line: string): string {
  if (!looksLikeObfuscatedBylineLine(line)) return line;
  const separatorPattern = /[·•]/g;
  let match: RegExpExecArray | null;
  let best = "";
  while ((match = separatorPattern.exec(line)) !== null) {
    const candidate = line.slice(match.index + match[0].length).trim();
    if (candidate.length < 4) continue;
    if (looksLikeBylineChromeOnlyLine(candidate)) continue;
    if (looksLikeObfuscatedBylineLine(candidate)) continue;
    best = candidate;
  }
  return best;
}

function cleanVisibleReshareCardText(text: string, originalAuthor: string): string {
  const stripped = stripLeadingIdentityLines(cleanText(text), { authorName: originalAuthor });
  const lines = stripped
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  while (lines.length > 0) {
    const first = lines[0];
    if (identityLineMatches(first, originalAuthor) || looksLikeBylineChromeOnlyLine(first)) {
      lines.shift();
      continue;
    }
    const withoutByline = stripLeadingObfuscatedBylinePrefix(first);
    if (withoutByline !== first) {
      if (withoutByline) lines[0] = withoutByline;
      else lines.shift();
      continue;
    }
    break;
  }
  return lines.join("\n").trim();
}

export function extractVisibleReshareCard(
  el: HTMLElement,
  sharerName: string,
): ReshareSplit | undefined {
  const sharer = normalizeAuthor(sharerName);
  for (const anchor of Array.from(el.querySelectorAll<HTMLAnchorElement>("a[href]"))) {
    if (isAfterCommentThreadBoundary(el, anchor)) continue;
    if (!hasUsableLayoutBox(anchor)) continue;
    const originalAuthor = normalizeAuthor(readableLinkText(anchor));
    if (originalAuthor.length < 2 || originalAuthor.length > 80) continue;
    if (looksLikeFacebookNonAuthorChromeLabel(originalAuthor)) continue;
    if (looksLikeFacebookChromeLinkText(originalAuthor)) continue;
    if (looksLikeUrlText(originalAuthor)) continue;
    if (identityLineMatches(originalAuthor, sharer) || identityLineMatches(sharer, originalAuthor)) continue;
    if (!isCandidateReshareAuthorLink(anchor)) continue;

    let node: HTMLElement | null = anchor.parentElement;
    for (let depth = 0; depth < 22 && node && node !== el; depth += 1, node = node.parentElement) {
      if (!hasReshareCardLayoutBox(node)) continue;
      const rawText = visibleText(node) || node.innerText || node.textContent || "";
      const normalized = cleanText(rawText);
      if (!normalized.includes(originalAuthor)) continue;
      if (sharer && normalized.includes(sharer)) continue;
      const originalText = cleanVisibleReshareCardText(normalized, originalAuthor);
      if (originalText.length < 4) continue;
      return {
        sharerText: "",
        originalAuthor,
        originalText,
      };
    }
  }
  return undefined;
}

export function splitReshareWithCommentFromText(
  text: string,
  candidateAuthors: string[],
): ReshareSplit | undefined {
  const lines = text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length < 3) return undefined;

  for (let i = 1; i < lines.length - 1; i++) {
    const author = candidateAuthors.find((name) => identityLineMatches(lines[i], name));
    if (!author) continue;
    const sharerText = lines.slice(0, i).join("\n").trim();
    const originalText = lines.slice(i + 1).join("\n").trim();
    if (sharerText.length < 2 || originalText.length < 4) continue;
    return { sharerText, originalAuthor: author, originalText };
  }
  return undefined;
}

export function extractReshareWithComment(
  el: HTMLElement,
  text: string,
  sharerName: string,
): ReshareSplit | undefined {
  return splitReshareWithCommentFromText(
    text,
    candidateReshareAuthors(el, sharerName),
  );
}

export function extractSharedAttachmentText(el: HTMLElement, ownText?: string): string | undefined {
  const selectors = [
    'a[href*="/reel/"]',
    'a[href*="/watch/"]',
    'a[href*="/videos/"]',
    'a[href*="/photo/?fbid="]',
    'a[href*="/photo.php?fbid="]',
    'a[href*="/posts/"]',
  ].join(",");
  const lines: string[] = [];
  const links = [
    ...Array.from(el.querySelectorAll<HTMLElement>(selectors))
      .filter((link) => !isAfterCommentThreadBoundary(el, link))
      .filter(hasUsableLayoutBox),
    ...Array.from(el.querySelectorAll<HTMLElement>("a[href]")).filter((link) => {
      if (link.matches(selectors)) return false;
      if (isAfterCommentThreadBoundary(el, link)) return false;
      if (!hasUsableLayoutBox(link)) return false;
      const raw = [
        link.innerText || "",
        link.getAttribute("aria-label") || "",
        link.textContent || "",
      ].join("\n");
      const usefulLines = cleanText(raw)
        .split("\n")
        .map((line) => line.trim())
        .filter(isUsefulAttachmentLine);
      if (isDuplicateOfOwnText(usefulLines.join("\n"), ownText)) return false;
      if (usefulLines.join("\n").length < 40) return false;
      if (!(link instanceof HTMLAnchorElement)) return true;
      const href = normalizedHref(link);
      if (!href) return false;
      if (isFacebookHost(href.hostname.toLowerCase()) && isCandidateReshareAuthorLink(link)) return false;
      return true;
    }),
  ];
  for (const link of links) {
    const raw = [
      link.innerText || "",
      link.getAttribute("aria-label") || "",
        link.textContent || "",
      ].join("\n");
    if (isDuplicateOfOwnText(cleanText(raw), ownText)) continue;
    for (const line of cleanText(raw).split("\n")) {
      const t = line.trim();
      if (!isUsefulAttachmentLine(t)) continue;
      if (!lines.includes(t)) lines.push(t);
      if (lines.length >= 3) break;
    }
    if (lines.length >= 3) break;
  }
  return lines.length > 0 ? lines.join("\n").slice(0, 500) : undefined;
}

export function handleGraphQLPosts(posts: GraphQLPost[]) {
  let addedSponsoredSeed = false;
  for (const post of posts) {
    if (post.authorName) {
      const key = normalizeAuthor(post.authorName);
      if (key.length > 1) {
        gqlPostsByAuthor.set(key, post);
      }
    }
    if (post.text.length > 20) {
      const seed = post.text.slice(0, 40);
      gqlPostsByText.set(seed, post);
      if (post.isSponsored) {
        knownSponsoredTextSeeds.add(seed);
        addedSponsoredSeed = true;
      }
    }

    // Retroactive sponsored detection: GraphQL responses often arrive AFTER
    // the DOM scan has already processed the visible posts (especially the
    // initial feed which is SSR'd then hydrated). If this GraphQL post is
    // sponsored, find any already-processed DOM post that matches and
    // re-classify it through the sponsored short-circuit.
    if (post.isSponsored) {
      retroMarkSponsored(post);
    }

    // Retroactive text upgrade: if this GraphQL payload carries a fuller
    // version of a post we've already classified with a truncated DOM
    // innerText (typical when the user clicks "查看更多" / "Show more",
    // or when the initial DOM scan beat the GraphQL response), re-emit
    // onNewPost with the full text. classifyPost's cache is keyed on
    // text content, so the LLM automatically re-runs on the longer
    // input and the dashboard card updates in place (same stableEventId
    // because it hashes only the first 60 chars).
    if (post.text.length > 30) {
      retroUpdateTruncatedText(post);
    }
  }
  // Sweep all currently-tagged-but-not-sponsored posts in case the new text
  // seeds we just added match a post that was tagged before this payload
  // arrived.
  if (addedSponsoredSeed) reEvaluateKnownSponsored();
}

function retroMarkSponsored(gqlPost: GraphQLPost): void {
  const textKey = gqlPost.text.length >= 30 ? gqlPost.text.slice(0, 30) : "";
  if (!textKey) return;

  const candidates = document.querySelectorAll<HTMLElement>("[data-truly-id]");
  for (const el of candidates) {
    if (el.dataset.trulySponsored === "true") continue; // already marked

    const domText = extractPostBody(el);
    if (!graphQLTextMatchesDom(domText, gqlPost.text)) continue;

    el.dataset.trulySponsored = "true";
    debugLog(
      `[Truly] Retro-marked sponsored from GraphQL (id=${el.dataset.trulyId}, gqlAuthor="${gqlPost.authorName}")`
    );
    if (onNewPost && el.dataset.trulyId) {
      const identity = extractPostIdentity(el);
      const authorName = gqlPost.authorName || identity.authorName;
      onNewPost({
        id: el.dataset.trulyId,
        element: el,
        text: stripIdentityFromTextCandidate(gqlPost.text || extractCleanPostText(el, identity), {
          ...identity,
          authorName,
        }),
        authorName,
        sourceName: identity.sourceName,
        hasMedia: el.querySelector("img, video") !== null,
      });
    }
    return; // one match is enough; this GraphQL post belongs to one DOM element
  }
}

// Minimum additional characters the GraphQL text must have over the
// last-classified version before we bother re-emitting. Below this we
// assume the difference is whitespace / entity normalization noise and
// skip the expensive re-classification.
const TEXT_UPGRADE_MIN_DELTA = 50;

function retroUpdateTruncatedText(gqlPost: GraphQLPost): void {
  const targetAuthor = gqlPost.authorName
    ? normalizeAuthor(gqlPost.authorName)
    : "";
  const textKey = gqlPost.text.slice(0, 30);
  if (!targetAuthor && !textKey) return;

  const candidates = document.querySelectorAll<HTMLElement>("[data-truly-id]");
  for (const el of candidates) {
    const domText = visibleText(el);
    if (!textKey || !graphQLTextMatchesDom(domText, gqlPost.text)) continue;

    // Compare against the length we most recently handed to classifyPost
    // for this element (stored in `data-truly-classified-len`). If we've
    // never classified it yet, scanForNewPosts will pick it up on its
    // own tick — don't double-process it.
    const lastLen = Number(el.dataset.trulyClassifiedLen || "0");
    if (lastLen === 0) return;
    if (gqlPost.text.length <= lastLen + TEXT_UPGRADE_MIN_DELTA) return;

    el.dataset.trulyClassifiedLen = String(gqlPost.text.length);
    debugLog(
      `[Truly] Text upgrade from GraphQL (id=${el.dataset.trulyId}, ${lastLen} → ${gqlPost.text.length} chars, author="${gqlPost.authorName}")`
    );
    if (onNewPost && el.dataset.trulyId) {
      const identity = extractPostIdentity(el);
      const authorName = gqlPost.authorName || identity.authorName;
      const text = stripIdentityFromTextCandidate(gqlPost.text, {
        ...identity,
        authorName,
      });
      onNewPost({
        id: el.dataset.trulyId,
        element: el,
        text,
        authorName,
        sourceName: identity.sourceName,
        hasMedia: el.querySelector("img, video") !== null,
        textCompleteness: "expanded_or_upgraded",
      });
    }
    return;
  }
}

function graphQLAuthorsCompatible(domAuthor: string, gqlAuthor: string): boolean {
  const domKey = normalizeAuthor(domAuthor);
  const gqlKey = normalizeAuthor(gqlAuthor);
  if (domKey.length < 2 || gqlKey.length < 2) return true;
  return domKey.includes(gqlKey) || gqlKey.includes(domKey);
}

function graphQLTextMatchesDom(domText: string, gqlText: string): boolean {
  const dom = compactComparableText(domText);
  const gql = compactComparableText(gqlText);
  if (dom.length < 8 || gql.length < 8) return false;
  const gqlSeed = gql.slice(0, Math.min(32, Math.max(12, Math.floor(gql.length * 0.35))));
  const domSeed = dom.slice(0, Math.min(32, Math.max(12, Math.floor(dom.length * 0.35))));
  return dom.includes(gqlSeed) || gql.includes(domSeed);
}

function findGqlMatch(text: string, author: string): GraphQLPost | undefined {
  // NOTE: Do NOT delete on match. Facebook virtual-scrolls articles in/out of
  // the DOM, so the same post can be processed multiple times during a
  // session. We need the GraphQL data to be reusable for re-mounts (otherwise
  // re-mounted sponsored posts lose their sponsored=true marking, and the
  // LLM falls back to the truncated DOM innerText instead of the full
  // server-side message text).
  const candidates = new Set<GraphQLPost>();
  for (const post of gqlPostsByText.values()) candidates.add(post);
  if (author) {
    const authorMatch = gqlPostsByAuthor.get(normalizeAuthor(author));
    if (authorMatch) candidates.add(authorMatch);
  }

  for (const post of candidates) {
    if (!graphQLTextMatchesDom(text, post.text)) continue;
    // Cross-check: if the DOM has a clear author, reject text matches whose
    // GraphQL author is completely unrelated. Author alone is no longer
    // sufficient: same-author feeds often carry multiple visible posts, and
    // using the latest GraphQL post by author can contaminate Side Panel text.
    if (author && post.authorName && !graphQLAuthorsCompatible(author, post.authorName)) continue;
    return post;
  }
  return undefined;
}

export function __findGqlMatchForTesting(text: string, author: string): GraphQLPost | undefined {
  return findGqlMatch(text, author);
}

export function isKnownSponsored(text: string, author: string): boolean {
  void author;
  for (const seed of knownSponsoredTextSeeds) {
    if (text.includes(seed.slice(0, 30))) return true;
  }
  return false;
}

// Walk currently-tagged posts that have NOT yet been marked sponsored and
// re-check them against the session-level knownSponsoredTextSeeds set. This
// is the recovery path for when GraphQL/SSR sponsored data arrives AFTER
// scanForNewPosts has already tagged the post (race between MAIN-world
// dispatch and isolated-world handleGraphQLPosts).
export function reEvaluateKnownSponsored(): void {
  if (knownSponsoredTextSeeds.size === 0) return;
  const candidates = document.querySelectorAll<HTMLElement>(
    "[data-truly-id]:not([data-truly-sponsored='true'])"
  );
  for (const el of candidates) {
    const identity = extractPostIdentity(el);
    const author = identity.authorName || "";
    const text = extractCleanPostText(el, identity).slice(0, 200);
    if (isKnownSponsored(text, author)) {
      el.dataset.trulySponsored = "true";
      debugLog(
        `[Truly] Re-evaluated to sponsored via knownSponsoredTextSeeds (id=${el.dataset.trulyId}, author="${author}")`
      );
      if (onNewPost && el.dataset.trulyId) {
        onNewPost({
          id: el.dataset.trulyId,
          element: el,
          text: extractCleanPostText(el, identity),
          authorName: author,
          hasMedia: el.querySelector("img, video") !== null,
        });
      }
    }
  }
}

// --- Core: Find visible post containers ---

export function findPostContainers(): HTMLElement[] {
  const main = document.querySelector('[role="main"]');
  if (!main) return [];

  // Find all "like" buttons as anchor points for posts
  const likeButtons = main.querySelectorAll(
    '[aria-label="讚"], [aria-label="Like"], [aria-label="喜歡"], [aria-label="哈"], [aria-label="大心"]'
  );

  const results: HTMLElement[] = [];
  const seen = new WeakSet<HTMLElement>();
  const addCandidate = (container: HTMLElement): void => {
    for (let i = 0; i < results.length; i += 1) {
      const existing = results[i];
      if (existing === container) return;
      if (existing.contains(container)) return;
      if (container.contains(existing)) {
        results.splice(i, 1);
        i -= 1;
      }
    }
    seen.add(container);
    results.push(container);
  };

  for (const btn of likeButtons) {
    const container = findPostBoundary(btn as HTMLElement, main as HTMLElement);
    if (!container) {
      // Log: no container found for this like button
      const rect = (btn as HTMLElement).getBoundingClientRect();
      if (rect.top > 0 && rect.top < window.innerHeight) {
        debugLog(`[Truly] Skip: no boundary for like btn at y=${Math.round(rect.top)}`);
      }
      continue;
    }
    const wasRecycled = resetRecycledPostContainer(container);
    if (seen.has(container) || (!wasRecycled && processedElements.has(container)) || container.dataset.trulyId) continue;

    if (isMixedFeedContainer(container)) {
      markSkippedContainer(container, "mixed-feed-container");
      for (const child of recoverPostChildrenFromMixedContainer(container)) {
        if (seen.has(child) || processedElements.has(child) || child.dataset.trulyId) continue;
        if (child.parentElement?.closest("[data-truly-id]")) continue;
        addCandidate(child);
      }
      continue;
    }

    if (container.parentElement?.closest("[data-truly-id]")) continue;
    if (container.querySelector("[data-truly-id]")) continue;

    const author = extractPostIdentity(container).authorName;
    if (!author || isGenericFeedWrapperAuthor(author)) {
      const rect = container.getBoundingClientRect();
      if (rect.top > -200 && rect.top < window.innerHeight + 200) {
        debugLog(
          `[Truly] Skip: ${author ? "generic feed wrapper author" : "no author extracted"} — w=${Math.round(rect.width)} h=${Math.round(rect.height)} text="${(container.innerText || "").slice(0, 40)}..."`
        );
      }
      continue;
    }

    const text = container.innerText || "";
    if (text.length < 5) continue;

    // Real feed posts have a reaction bar with "讚" plus another post
    // interaction signal. Most posts expose Comment or Share, but some
    // algorithm-recommended cards replace that area with "你對這則貼文有興趣嗎？"
    // + 有興趣/沒興趣 buttons. Accept that feedback module as a post signal
    // while still rejecting profile/friend cards that only have Like/Follow.
    if (!hasPostActionSignal(container)) continue;

    addCandidate(container);
  }

  for (const container of findPhotoGridPostContainers(main as HTMLElement)) {
    const wasRecycled = resetRecycledPostContainer(container);
    if (seen.has(container) || (!wasRecycled && processedElements.has(container)) || container.dataset.trulyId) continue;
    if (container.parentElement?.closest("[data-truly-id]")) continue;
    if (container.querySelector("[data-truly-id]")) continue;
    addCandidate(container);
  }

  return results;
}

function findPhotoGridPostContainers(main: HTMLElement): HTMLElement[] {
  const results: HTMLElement[] = [];
  const seen = new WeakSet<HTMLElement>();
  const actionButtons = Array.from(main.querySelectorAll<HTMLElement>("[aria-label]"))
    .filter((el) => isPostActionMenuLabel(el.getAttribute("aria-label") || ""));

  for (const action of actionButtons) {
    const container = findPhotoGridPostBoundary(action, main);
    if (!container || seen.has(container)) continue;
    seen.add(container);
    results.push(container);
  }
  return results;
}

function isPostActionMenuLabel(label: string): boolean {
  return /^Actions for this post by\s+.+/i.test(label) || /這則貼文.*(動作|操作)/.test(label);
}

function findPhotoGridPostBoundary(action: HTMLElement, root: HTMLElement): HTMLElement | null {
  const matches: HTMLElement[] = [];
  let el: HTMLElement | null = action;
  let depth = 0;

  while (el && el !== root && depth < 25) {
    const rect = el.getBoundingClientRect();
    const w = Math.round(rect.width);
    const h = Math.round(rect.height);
    if (w >= 350 && h >= 100 && h <= 3000 && !isPageSectionWrapper(el) && isPhotoGridPostContainer(el)) {
      matches.push(el);
    }
    el = el.parentElement;
    depth++;
  }
  return matches[0] || null;
}

function isPhotoGridPostContainer(el: HTMLElement): boolean {
  if (isMixedFeedContainer(el)) return false;
  if (processedElements.has(el) || el.dataset.trulyId) return false;
  if (!extractPostIdentity(el).authorName) return false;
  const photoLinks = el.querySelectorAll<HTMLAnchorElement>('a[href*="/photo/?fbid="], a[href*="/photo.php?fbid="]').length;
  const largeImages = Array.from(el.querySelectorAll<HTMLImageElement>("img")).filter((img) => {
    const r = img.getBoundingClientRect();
    return r.width >= 120 && r.height >= 120;
  }).length;
  if (photoLinks < 1 && largeImages < 1) return false;
  const text = el.innerText || visibleText(el);
  return text.trim().length >= 5;
}

function hasReelTray(el: HTMLElement): boolean {
  const reelLinks = el.querySelectorAll('a[href*="/reel/"], a[href*="/reels/"]').length;
  if (reelLinks < 3) return false;
  const label = visibleText(el).slice(0, 500);
  return /\bReels?\b|短片/.test(label);
}

function countDirectPostLikeChildren(el: HTMLElement): number {
  let count = 0;
  for (const child of Array.from(el.children)) {
    if (!(child instanceof HTMLElement)) continue;
    const rect = child.getBoundingClientRect();
    const hasPostWidth = rect.width === 0 || rect.width >= 350;
    const hasPostHeight = rect.height === 0 || rect.height >= 100;
    if (!hasPostWidth || !hasPostHeight) continue;
    const hasHeading = !!child.querySelector("h1, h2, h3, h4, h5, h6");
    const hasLike = !!child.querySelector(
      '[aria-label="讚"], [aria-label="Like"], [aria-label="喜歡"], [aria-label="哈"], [aria-label="大心"]'
    );
    if (hasHeading && hasLike && hasPostActionSignal(child)) count++;
  }
  return count;
}

function countPostActionBars(el: HTMLElement): number {
  const likeButtons = el.querySelectorAll(
    '[aria-label="讚"], [aria-label="Like"], [aria-label="喜歡"], [aria-label="哈"], [aria-label="大心"]'
  ).length;
  const commentOrShareButtons = el.querySelectorAll(
    '[aria-label="留言"],[aria-label="Comment"],[aria-label="分享"],[aria-label="Share"]'
  ).length;
  return Math.min(likeButtons, commentOrShareButtons);
}

function isRecoverablePostChild(el: HTMLElement): boolean {
  if (isMixedFeedContainer(el)) return false;
  if (processedElements.has(el) || el.dataset.trulyId) return false;

  const rect = el.getBoundingClientRect();
  if (rect.width > 0 && rect.width < 350) return false;
  if (rect.height > 0 && (rect.height < 100 || rect.height > 3000)) return false;

  const hasLike = !!el.querySelector(
    '[aria-label="讚"], [aria-label="Like"], [aria-label="喜歡"], [aria-label="哈"], [aria-label="大心"]'
  );
  if (!hasLike || !hasPostActionSignal(el)) return false;

  const author = extractPostIdentity(el).authorName;
  if (!author) return false;

  const text = el.innerText || visibleText(el);
  return text.trim().length >= 5;
}

function hasCommentOrShareAction(el: HTMLElement): boolean {
  for (const node of Array.from(el.querySelectorAll<HTMLElement>("[aria-label]"))) {
    const label = (node.getAttribute("aria-label") || "").trim();
    if (/^(留言|Comment|Leave a comment|分享|Share)$/i.test(label)) return true;
  }
  return false;
}

function hasInterestFeedbackAction(el: HTMLElement): boolean {
  const feedbackText = visibleText(el).includes("你對這則貼文有興趣嗎");
  const labels = Array.from(el.querySelectorAll<HTMLElement>("[aria-label]"))
    .map((node) => (node.getAttribute("aria-label") || "").trim());
  return feedbackText && labels.includes("有興趣") && labels.includes("沒興趣");
}

function hasPostActionSignal(el: HTMLElement): boolean {
  return hasCommentOrShareAction(el) || hasInterestFeedbackAction(el);
}

function containsNestedFeedSurface(el: HTMLElement): boolean {
  return el.getAttribute("role") !== "feed" && !!el.querySelector('[role="feed"]');
}

function containsComposerEntryPoint(el: HTMLElement): boolean {
  return /Write something|What's on your mind|Anonymous post|Feeling\/activity|Poll|撰寫|匿名貼文|心情\/活動|投票/.test(
    visibleText(el).slice(0, 500)
  );
}

function isPageSectionWrapper(el: HTMLElement): boolean {
  return containsNestedFeedSurface(el) || containsComposerEntryPoint(el);
}

export function shouldSuppressDomAttachmentFallbackForRecommendedPost(
  el: HTMLElement,
  gqlPostType?: PostType,
): boolean {
  if (gqlPostType === "reshare") return false;
  return detectRecommended(el) && hasInterestFeedbackAction(el);
}

function recoverPostChildrenFromMixedContainer(el: HTMLElement): HTMLElement[] {
  const recovered: HTMLElement[] = [];
  const seen = new WeakSet<HTMLElement>();
  for (const child of Array.from(el.children)) {
    if (!(child instanceof HTMLElement)) continue;
    if (!isRecoverablePostChild(child)) continue;
    if (seen.has(child)) continue;
    seen.add(child);
    recovered.push(child);
  }
  return recovered;
}

function markSkippedContainer(el: HTMLElement, reason: string) {
  processedElements.add(el);
  delete el.dataset.trulyId;
  delete el.dataset.trulyStableId;
  el.dataset.trulySkipReason = reason;
}

export function isMixedFeedContainer(el: HTMLElement): boolean {
  const rect = el.getBoundingClientRect();
  const height = Math.round(rect.height);
  const reelTray = hasReelTray(el);
  const childPostCount = countDirectPostLikeChildren(el);
  const actionBarCount = countPostActionBars(el);
  const author = extractPostIdentity(el).authorName;

  // CDP-observed failure mode: FB can expose a huge feed/story wrapper
  // as if it were one post. It may contain a normal post, an ad, a Reel
  // tray, and several more posts; analyzing that wrapper pollutes Tier B
  // with unrelated text and image insights.
  if (containsNestedFeedSurface(el) && (height > 900 || containsComposerEntryPoint(el))) return true;
  if (isGenericFeedWrapperAuthor(author) && actionBarCount >= 1) return true;
  if (height > 3000 && (reelTray || actionBarCount >= 2 || childPostCount >= 1)) return true;
  if (reelTray && actionBarCount >= 2) return true;
  if (reelTray && childPostCount >= 1) return true;
  if (actionBarCount >= 2 && childPostCount >= 1) return true;
  if (childPostCount >= 2) return true;
  return false;
}

export function skipMixedFeedContainer(el: HTMLElement): boolean {
  if (!isMixedFeedContainer(el)) return false;
  markSkippedContainer(el, "mixed-feed-container");
  return true;
}

export function findPostBoundary(button: HTMLElement, root: HTMLElement): HTMLElement | null {
  // Walk up from the like button collecting ALL ancestors with post-like
  // dimensions (width 400-1000, height 100-2000). Then return the SMALLEST
  // one that contains an HTML heading element of any level.
  //
  // Why not just return the innermost match: Facebook frequently nests the
  // post inside a small "content-only" wrapper (post body + interaction bar)
  // sitting INSIDE a larger "post item" wrapper (which adds the author
  // header above). Both wrappers match the dimension filter. If we return
  // the inner one, the "贊助" sponsored label that lives in the header is
  // outside our container — detectSponsored can't see it, and the post
  // is misclassified as not sponsored. Requiring a heading forces us up to
  // the wrapper that includes the author header (and therefore the
  // sponsored label).
  //
  // We accept any heading level (h1-h6) because the algorithmic feed uses
  // h4 while the chronological feed uses h3 — verified 2026-04-09 by
  // Historical chronological-feed diagnostics observed that Facebook can use
  // different heading levels for the author row.
  const matches: HTMLElement[] = [];
  let el: HTMLElement | null = button;
  let depth = 0;

  while (el && el !== root && depth < 25) {
    const rect = el.getBoundingClientRect();
    const w = Math.round(rect.width);
    const h = Math.round(rect.height);

    // Width lower bound rejects narrow sidebars; no upper bound because
    // FB's feed column width scales with viewport (680px at 1440, up to
    // 900+ on ultrawide). Height bounds reject button bars (< 100) and
    // the entire-feed container (> 3000).
    if (w >= 350 && h >= 100 && h <= 3000 && el.contains(button) && !isPageSectionWrapper(el)) {
      matches.push(el);
    }

    el = el.parentElement;
    depth++;
  }

  // Prefer the smallest match that contains any heading element.
  for (const m of matches) {
    if (m.querySelector("h1, h2, h3, h4, h5, h6")) return m;
  }
  // Fallback: smallest match overall (preserves prior behavior on posts
  // that genuinely have no heading, e.g. some image-only formats).
  return matches[0] || null;
}

// --- Scan and process ---

function scanForNewPosts() {
  const containers = findPostContainers();
  let emittedThisTick = 0;

  for (const el of containers) {
    if (processedElements.has(el) || el.dataset.trulyId) continue;
    processedElements.add(el);
    emittedThisTick++;

    const id = generatePostId();
    el.dataset.trulyId = id;

    // Pre-check: if this post's author or text is already known to be
    // sponsored (from a previous scan in this session), immediately
    // hide its content to prevent the "flash of uncollapsed content"
    // that happens when FB virtual-scroll remounts a previously-
    // collapsed sponsored post. The full applyOverlay → collapse flow
    // will run after processNewPost, but the user won't see the raw
    // post in between.
    const earlyIdentity = extractPostIdentity(el);
    const earlyText = extractCleanPostText(el, earlyIdentity).slice(0, 200);
    const earlyAuthor = earlyIdentity.authorName || "";
    if (isKnownSponsored(earlyText, earlyAuthor)) {
      el.dataset.trulySponsored = "true";
      for (const child of Array.from(el.children)) {
        (child as HTMLElement).style.display = "none";
      }
    }

    // Double-rAF ensures at least one paint cycle happens before heavy
    // processing starts.
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        processNewPost(el, id);
      });
    });
  }

  recordHealthTick(emittedThisTick);
}

export function rescanVisiblePosts(): void {
  processedElements = new WeakSet<HTMLElement>();
  for (const el of Array.from(document.querySelectorAll<HTMLElement>("[data-truly-id],[data-truly-skip-reason]"))) {
    clearTrulyPostState(el);
  }
  scanForNewPosts();
  markSponsoredInFeed();
  reEvaluateKnownSponsored();
}

function processNewPost(el: HTMLElement, id: string) {
  if (skipMixedFeedContainer(el)) return;

  // extractPostBody() = visibleText() + exclude nested comment articles
  // + exclude reaction/action button bars + insert newlines at element
  // boundaries so cleanText's line-based filter can do its job. Keeps
  // chronological-feed per-character CSS obfuscation bypass intact.
  const identity = extractPostIdentity(el);
  const domText = extractCleanPostText(el, identity);
  const author = identity.authorName;

  // Try to match with GraphQL data for better text
  const gql = findGqlMatch(domText, author || "");
  const rawAuthor = author || "";
  const authorName = gql?.authorName || normalizeAuthor(rawAuthor);
  const text = stripIdentityFromTextCandidate(gql?.text || domText, {
    ...identity,
    authorName,
  });

  const isSponsored =
    gql?.isSponsored ||
    detectSponsored(el) ||
    isKnownSponsored(text, author || "");
  const isRecommended = !isSponsored && detectRecommended(el);

  const suppressDomAttachmentFallback = isRecommended &&
    shouldSuppressDomAttachmentFallbackForRecommendedPost(el, gql?.postType);
  const extractedAttachmentText = suppressDomAttachmentFallback
    ? undefined
    : extractSharedAttachmentText(el, isRecommended ? text : undefined);
  const originalAttachmentText = gql?.reshareOriginalText || extractedAttachmentText;
  // Algorithm-recommended own posts often include public-page links, video
  // preview anchors, and a Follow button. Without GraphQL `reshare`, those
  // anchors are not enough evidence that this is a shared post; otherwise
  // recommended media cards get mislabeled as `轉貼`.
  const suppressDomReshareFallback = suppressDomAttachmentFallback;
  const domReshare = suppressDomReshareFallback ? undefined : extractReshareWithComment(el, text, authorName);
  const visibleReshare = extractVisibleReshareCard(el, authorName);
  const domReshareAuthor = candidateReshareAuthors(el, authorName)[0];
  const originalReshareText = gql?.reshareOriginalText ||
    visibleReshare?.originalText ||
    domReshare?.originalText;
  const originalReshareAuthor = visibleReshare?.originalAuthor ||
    gql?.reshareOriginalAuthor ||
    domReshare?.originalAuthor ||
    undefined;
  const visibleReshareWithoutComment = Boolean(visibleReshare) &&
    (!text.trim() || isDuplicateOfOwnText(text, visibleReshare?.originalText));
  const contentKind = (
    isShareWithoutOwnComment(text, extractedAttachmentText) ||
    visibleReshareWithoutComment ||
    (gql?.postType === "reshare" && text.trim().length <= 1 && !!gql?.reshareOriginalText)
  )
    ? "share_without_comment"
    : (gql?.postType === "reshare" && !!gql?.reshareOriginalText) || domReshare || visibleReshare
      ? "reshare_with_comment"
    : "standard";
  const ownText = contentKind === "share_without_comment"
    ? ""
    : contentKind === "reshare_with_comment"
      ? domReshare?.sharerText || text
      : text;
  const sharedAttachmentText = contentKind === "share_without_comment"
    ? originalReshareText || originalAttachmentText
    : extractedAttachmentText;
  const hasMedia = el.querySelector("img, video") !== null;

  if (!authorName && !ownText.trim() && !(sharedAttachmentText || "").trim() && !hasMedia) {
    markSkippedContainer(el, "empty-post-container");
    debugLog(`[Truly] Skip: empty post container (id=${id})`);
    return;
  }

  if (isSponsored) {
    el.dataset.trulySponsored = "true";
  }

  if (isRecommended) {
    el.dataset.trulyRecommended = "true";
    debugLog(
      `[Truly] Recommended post: author="${author || ""}" text="${text.slice(0, 60)}..."`
    );
  }

  const isVerified = /已驗證帳號|已验证账号|Verified/.test(rawAuthor);
  const textCompleteness = gql?.text && gql.text.length > domText.length + TEXT_UPGRADE_MIN_DELTA
    ? "expanded_or_upgraded" as const
    : undefined;

  const post: PostData = {
    id,
    element: el,
    text: ownText,
    authorName,
    sourceName: identity.sourceName,
    hasMedia,
    isVerified,
    contentKind,
    sharedAttachmentText,
    postType: gql?.postType,
    reshareOriginalText: originalReshareText,
    reshareOriginalAuthor: originalReshareAuthor || (
      contentKind === "share_without_comment" ? domReshareAuthor : undefined
    ),
    engagement: extractEngagement(el),
    gqlPostId: gql?.postId,
    isRecommended,
    textCompleteness,
  };

  // Record the length handed to classifyPost so retroUpdateTruncatedText
  // can later tell when a longer GraphQL version warrants re-classification.
  el.dataset.trulyClassifiedLen = String(text.length);
  el.dataset.trulyContentKind = contentKind;
  const signature = postDomSignature(el);
  if (signature) el.dataset.trulyDomSignature = signature;

  debugLog(
    `[Truly] Post: author="${post.authorName}" sponsored=${isSponsored} text="${text.slice(0, 60)}..."`
  );
  onNewPost?.(post);
}

// --- Selector health monitor ---
//
// Replaces the dead `checkSelectorHealth()` one-shot probe (which always
// returned `article: true`). Health tracks "did the scanner ever find a
// post on this URL pathname?" — a much more stable signal than a sliding
// tick window, because the natural state on a stationary feed is "0 new
// posts per tick" (user isn't scrolling, all visible posts already tagged).
//
// Healthy   = path-scoped foundPostOnCurrentPath flag is true
// Unhealthy = ≥ HEALTH_GRACE_MS elapsed since first scan tick on this path,
//             flag still false, page looks like a feed (allowlisted path +
//             [role="main"] present)
// Unknown   = anything else (initial state, non-feed page, page still
//             hydrating)
//
// SPA navigation (path change) resets the per-path state. See
// `2026-04-09-revive-selector-health-check` for the design rationale.

const HEALTH_GRACE_MS = 20_000;
// Disallow these URL pathname prefixes — they look like /<username> but are
// known FB sub-apps without a feed surface.
const HEALTH_PATH_DENYLIST_RE =
  /^\/(messages|settings|marketplace|watch|gaming|events|notifications|photo|stories|reel|help|privacy|policies|legal|about|business|ads|developers)/;
// Allowlist of URL pathnames where we expect to see posts.
//
// Note: `location.pathname` does NOT include the query string. The
// chronological feed (`https://www.facebook.com/?filter=all&sk=h_chr`)
// reports pathname `/`, so the home-feed entry covers it automatically —
// no separate entry for `?sk=...` is needed.
const HEALTH_PATH_ALLOWLIST: RegExp[] = [
  /^\/$/, // home feed (including chronological view via ?filter=all&sk=h_chr)
  /^\/groups\/[^/]+\/?$/, // group feed
  /^\/[^/]+\/?$/, // /username profile feed (if not denylisted)
];

let firstScanTsOnCurrentPath: number | null = null;
let foundPostOnCurrentPath = false;
let lastSeenPath: string | null = null;
let currentHealth: "unknown" | "healthy" | "unhealthy" = "unknown";
let onHealthChange: ((status: "healthy" | "unhealthy") => void) | null = null;

function getPath(): string {
  return typeof location !== "undefined" ? location.pathname : "/";
}

function isFeedLikePath(): boolean {
  const path = getPath();
  if (HEALTH_PATH_DENYLIST_RE.test(path)) return false;
  for (const re of HEALTH_PATH_ALLOWLIST) {
    if (re.test(path)) return true;
  }
  return false;
}

function computeHealth(): "unknown" | "healthy" | "unhealthy" {
  if (firstScanTsOnCurrentPath === null) return "unknown";
  if (foundPostOnCurrentPath) return "healthy";
  const elapsed = Date.now() - firstScanTsOnCurrentPath;
  if (elapsed < HEALTH_GRACE_MS) return "unknown";
  if (!isFeedLikePath()) return "unknown";
  if (typeof document !== "undefined" && !document.querySelector('[role="main"]')) {
    return "unknown";
  }
  return "unhealthy";
}

function recordHealthTick(emittedCount: number): void {
  // Detect SPA navigation: pathname changed since last tick → reset state.
  const path = getPath();
  if (path !== lastSeenPath) {
    lastSeenPath = path;
    firstScanTsOnCurrentPath = Date.now();
    foundPostOnCurrentPath = false;
    currentHealth = "unknown";
    // Note: do not emit on reset — the next tick will compute the real
    // status and emit if needed.
  }
  if (firstScanTsOnCurrentPath === null) {
    firstScanTsOnCurrentPath = Date.now();
  }
  if (emittedCount > 0) {
    foundPostOnCurrentPath = true;
  }

  const next = computeHealth();
  if (next === currentHealth) return;
  currentHealth = next;
  if (next !== "unknown" && onHealthChange) {
    onHealthChange(next);
  }
}

export function setHealthCallback(
  cb: ((status: "healthy" | "unhealthy") => void) | null
): void {
  onHealthChange = cb;
}

// Test-only exports
export function __getHealthForTesting(): {
  status: "unknown" | "healthy" | "unhealthy";
  firstScanTs: number | null;
  foundPost: boolean;
  path: string | null;
} {
  return {
    status: currentHealth,
    firstScanTs: firstScanTsOnCurrentPath,
    foundPost: foundPostOnCurrentPath,
    path: lastSeenPath,
  };
}

export function __recordHealthTickForTesting(emittedCount: number): void {
  recordHealthTick(emittedCount);
}

export function __setHealthFirstScanTsForTesting(ts: number): void {
  firstScanTsOnCurrentPath = ts;
}

export function __resetHealthForTesting(): void {
  firstScanTsOnCurrentPath = null;
  foundPostOnCurrentPath = false;
  lastSeenPath = null;
  currentHealth = "unknown";
  onHealthChange = null;
}

// --- Helpers ---

/**
 * Recursively extract text content from a node, returning ONLY what is
 * actually visible to the user. Excludes:
 *
 *   - `aria-hidden="true"` subtrees (Facebook's outer-layer "Facebook"
 *     decoy blocks repeated 20+ times)
 *   - `display: none` / `visibility: hidden` elements
 *   - **`position: absolute` descendants** (Facebook's per-character
 *     anti-scrape decoy spans, positioned `top: 39px` to stack
 *     offscreen — see `docs/sponsored-detection-debug-2026-04-08.md`
 *     and historical CSS-obfuscation diagnostics)
 *
 * Without this filter, `el.textContent` returns garbage like
 * `"sSdpernoto58u贊i73mc2gm8ci..."` (60+ chars containing 1 real char
 * and 59 decoys), and `el.innerText` returns the same garbage with
 * newlines (innerText respects display:none/visibility:hidden but
 * NOT aria-hidden or absolute positioning).
 *
 * Used by `extractAuthor`, `scanForNewPosts` (post body extraction),
 * `markSponsoredInFeed` (DOM walker), and `detectSponsored` so the
 * entire post-detection pipeline works on chronological feed
 * (`?filter=all&sk=h_chr`) where this anti-scrape is deployed.
 */
// Our own UI elements that must be excluded from visibleText — otherwise
// our loading spinner "分類中", score panel chips, overlay reason text,
// etc. leak back into the extracted post body and pollute downstream
// LLM prompts / dashboard previews.
const TRULY_UI_CLASS_RE =
  /\btruly-(score-loading|score-panel|overlay|collapse-bar|report-pill|headsup-host|headsup|headsup-summary|headsup-label|headsup-dot)\b/;

function isTrulyUI(el: Element): boolean {
  const cls = (el.className || "").toString();
  // Only skip actual UI components we inject. 
  // DO NOT skip elements just because they have data-truly-id, as that is the post container itself.
  return TRULY_UI_CLASS_RE.test(cls) || el.id.startsWith("truly-");
}

/**
 * Like `visibleText` but additionally skips subtrees that are structurally
 * NOT the post body:
 *   - Nested `[role="article"]` descendants (Facebook wraps each comment
 *     in its own article, so the top-level post article ends up
 *     containing zero-to-many nested articles under its comments
 *     section). Without this filter the reply text, reply author
 *     badges, and reply metadata all leak into `post.text` and pollute
 *     the LLM prompt.
 *   - The reaction / action button bar (讚 / 留言 / 分享). Facebook
 *     labels it with `role="group"` + aria-label variants. We also
 *     drop any child whose aria-label is one of the known action-bar
 *     labels so we don't need to fingerprint the container shape.
 *
 * Callers must pass the POST ARTICLE itself as `root`. Everything
 * strictly below `root` is subject to the nested-article filter.
 */
const ACTION_BAR_ARIA_LABELS = new Set([
  "讚", "Like",
  "留言", "Comment",
  "分享", "Share",
  "傳送", "Send",
  "儲存", "Save",
  "有興趣", "沒興趣",
  "傳送給朋友或在個人檔案上發佈。",
  "反應", "Reactions", "Reaction",
]);

// Image `alt` patterns to drop: profile-photo / avatar / icon / decorative.
// Anything else (especially FB's "可能是 X 個人..." auto-descriptions) is
// kept as body text since on photo-heavy posts the caption is often a
// hashtag or emoji and the alt is the only descriptive signal.
const IMAGE_ALT_NOISE_RE =
  /(個人檔案照片|個人封面相片|profile photo|cover photo|avatar|頭像|大頭貼|^Photo$|^Image$|^圖像$|表情符號)/i;

function isUsefulImageAlt(alt: string): boolean {
  const trimmed = alt.trim();
  if (trimmed.length < 5) return false;
  if (IMAGE_ALT_NOISE_RE.test(trimmed)) return false;
  return true;
}

export function extractPostBody(root: HTMLElement): string {
  function hasVisibleBox(el: Element): boolean {
    if (typeof window === "undefined" || typeof (el as HTMLElement).getBoundingClientRect !== "function") {
      return false;
    }
    const rect = (el as HTMLElement).getBoundingClientRect();
    if (rect.width <= 1 || rect.height <= 1) return false;

    const viewportWidth = window.innerWidth || document.documentElement.clientWidth || 0;
    const viewportHeight = window.innerHeight || document.documentElement.clientHeight || 0;
    const intersectsViewport =
      viewportWidth > 0 &&
      viewportHeight > 0 &&
      rect.right > 0 &&
      rect.bottom > 0 &&
      rect.left < viewportWidth &&
      rect.top < viewportHeight;
    if (intersectsViewport) return true;

    const rootRect = root.getBoundingClientRect();
    return (
      rootRect.width > 1 &&
      rootRect.height > 1 &&
      rect.right > rootRect.left &&
      rect.bottom > rootRect.top &&
      rect.left < rootRect.right &&
      rect.top < rootRect.bottom
    );
  }

  function walk(node: Node, depth: number): string {
    if (depth > 0 && isAfterCommentThreadBoundary(root, node)) return "";
    if (node.nodeType === Node.TEXT_NODE) return node.textContent || "";
    if (node.nodeType !== Node.ELEMENT_NODE) return "";
    const el = node as Element;
    if (el.getAttribute("aria-hidden") === "true") return "";
    if (isTrulyUI(el)) return "";
    // Nested article = comment reply. Skip entirely (but keep the root).
    if (depth > 0 && el.getAttribute("role") === "article") return "";
    // Action bar: aria-label matches like/comment/share label.
    const label = el.getAttribute("aria-label");
    if (label && ACTION_BAR_ARIA_LABELS.has(label.trim())) return "";
    if (typeof window !== "undefined" && typeof window.getComputedStyle === "function") {
      try {
        const cs = window.getComputedStyle(el);
        if (cs.display === "none" || cs.visibility === "hidden") return "";
        if (depth > 0 && cs.position === "absolute" && !hasVisibleBox(el)) return "";
      } catch {
        /* ignore */
      }
    }
    // Image alt text: void element, has no text children, but the alt
    // attribute carries meaningful description on photo posts (FB
    // auto-generates "可能是 4 個人..." style alts).
    if (el.tagName === "IMG") {
      const alt = el.getAttribute("alt");
      if (alt && isUsefulImageAlt(alt)) return alt;
      return "";
    }
    let out = "";
    for (const child of Array.from(el.childNodes)) {
      out += walk(child, depth + 1);
      // Insert a newline between direct element children so that
      // line-based cleanText can reason about token boundaries. Without
      // this, chronological-feed decoy stripping glues everything into
      // one line and UI chrome escapes the filter.
      if (child.nodeType === Node.ELEMENT_NODE) out += "\n";
    }
    return out;
  }
  return walk(root, 0);
}

export function visibleText(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) return node.textContent || "";
  if (node.nodeType !== Node.ELEMENT_NODE) return "";
  const el = node as Element;
  if (el.getAttribute("aria-hidden") === "true") return "";
  if (isTrulyUI(el)) return "";
  // getComputedStyle may not be available in some test environments;
  // guard so unit tests don't crash.
  if (typeof window !== "undefined" && typeof window.getComputedStyle === "function") {
    try {
      const cs = window.getComputedStyle(el);
      if (cs.display === "none" || cs.visibility === "hidden") return "";
    } catch {
      /* ignore */
    }
  }
  let out = "";
  for (const child of Array.from(el.childNodes)) {
    if (child.nodeType === Node.ELEMENT_NODE) {
      const childEl = child as Element;
      if (childEl.getAttribute("aria-hidden") === "true") continue;
      if (isTrulyUI(childEl)) continue;
      if (typeof window !== "undefined" && typeof window.getComputedStyle === "function") {
        try {
          const ccs = window.getComputedStyle(childEl);
          if (ccs.position === "absolute") continue;
          if (ccs.display === "none" || ccs.visibility === "hidden") continue;
        } catch {
          /* ignore */
        }
      }
    }
    out += visibleText(child);
  }
  return out;
}

// Best-effort engagement metrics from aria-labels near the action bar.
// FB renders things like `aria-label="476 個心情"`, `aria-label="25 則留言"`,
// `aria-label="8 次分享"`. Returns partial results — any missing field is
// simply omitted.
function extractEngagement(el: HTMLElement): EngagementHints | undefined {
  const hints: EngagementHints = {};
  const ariaEls = el.querySelectorAll<HTMLElement>("[aria-label]");
  for (const ae of ariaEls) {
    const label = ae.getAttribute("aria-label") || "";
    // Reactions: "476 個心情" / "1.2萬 Others" / "476 reactions"
    if (/\d.*(?:心情|個讚|reactions?|others)/i.test(label)) {
      hints.reactions = label;
    }
    // Comments: "25 則留言" / "25 comments"
    if (/\d.*(?:則留言|comments?)/i.test(label)) {
      hints.comments = label;
    }
    // Shares: "8 次分享" / "8 shares"
    if (/\d.*(?:次分享|shares?)/i.test(label)) {
      hints.shares = label;
    }
  }
  return Object.keys(hints).length > 0 ? hints : undefined;
}

function extractAuthor(el: HTMLElement): string | undefined {
  // Accept any heading level. Facebook's algorithmic feed (`/`) uses h4
  // for the author header, while the chronological feed
  // (`/?filter=all&sk=h_chr`) uses h3 — verified 2026-04-09 by
  // historical chronological-feed diagnostics. Allowing h1-h6 is strictly more
  // permissive and future-proof against further heading-level rotations.
  //
  // Use visibleText() instead of textContent because chronological feed
  // wraps each visible character in a position:relative span surrounded
  // by ~60 position:absolute decoy chars; textContent returns the
  // garbage but visibleText filters out the decoys.
  const heading = el.querySelector("h1, h2, h3, h4, h5, h6");
  if (heading) {
    const t = visibleText(heading).trim();
    if (t) return normalizeAuthor(t);
  }
  const strong = el.querySelector("strong");
  if (strong) {
    const t = visibleText(strong).trim();
    if (t) return normalizeAuthor(t);
  }
  for (const node of Array.from(el.querySelectorAll<HTMLElement>("[aria-label]"))) {
    const label = (node.getAttribute("aria-label") || "").trim();
    const actionMatch = label.match(/^Actions for this post by\s+(.+)$/i);
    if (actionMatch?.[1]) return normalizeAuthor(actionMatch[1]);
    const hideMatch = label.match(/^隱藏(.+)的貼文$/);
    if (hideMatch?.[1]) return normalizeAuthor(hideMatch[1]);
  }
  return undefined;
}

// Substring patterns stripped inline from raw text before line splitting.
// Used because chronological-feed per-character CSS obfuscation can glue
// adjacent UI chrome (badges, privacy labels, edit markers) onto body
// text with no whitespace separator, making them invisible to the
// line-based filter below.
const INLINE_NOISE_PATTERNS: RegExp[] = [
  /已驗證帳號/g,
  /已验证账号/g,
  /已編輯/g,
  /已编辑/g,
  /\(已編輯\)/g,
  /上線狀態指標/g,
  /在線上/g,
  /查看更多留言/g,
  /顯示更多留言/g,
  /分享對象：\S*/g,
  /分享对象：\S*/g,
  /Shared\s+with\s+Public/gi,
  /Shared\s+with\s+Friends/gi,
  /(?:Facebook\s*){3,}/g,
  /你對這則貼文有興趣嗎？?/g,
];

function truncateAtCommentThreadBoundary(raw: string): string {
  return raw.replace(
    /(?:^|\n)[^\n]*(?:查看更多留言|顯示更多留言|View more comments?|View previous comments?)[\s\S]*$/i,
    "",
  );
}

export function cleanText(raw: string): string {
  // Strip inline noise first so they don't bleed into body lines.
  let preprocessed = truncateAtCommentThreadBoundary(raw);
  for (const re of INLINE_NOISE_PATTERNS) {
    preprocessed = preprocessed.replace(re, " ");
  }

  const lines = preprocessed.split("\n").map((l) => l.trim()).filter(Boolean);
  const cleaned: string[] = [];
  for (const t of lines) {
    // FB injects literal "Facebook" repeated 20+ times via aria/accessibility.
    // Sometimes they end up glued on one line ("FacebookFacebookFacebook...").
    // Aggressive case-insensitive filter for any line containing "Facebook" repeated.
    if (/Facebook/i.test(t) && (t.length > 20 || /^(Facebook\s*){2,}$/i.test(t))) continue;
    if (t === "Facebook") continue;

    // FB anti-scrape: timestamps split into single-char lines, randomized.
    // Modified to preserve single chars if they are part of a sequence that looks like content,
    // but the existing tests expect single chars to be dropped to clean up anti-scrape.
    // Let's stick to the original strict "drop length 1" but add an exception for common 
    // Chinese characters or specific markers if needed.
    // For now, to pass tests and fix the regression, we revert to strict drop.
    if (t.length === 1) continue; 
    
    // Explicitly drop common decoy strings seen in chronological feed
    if (/^[a-z]{2}$/i.test(t) && !/^(hi|he|we|do|go|no|me|my|to|on|at|in|of|is|it|so|up|be|by|if|or|us|am|pm)$/i.test(t)) {
       // Two-letter strings that aren't common English words are likely decoys
       continue;
    }
    // Timestamp markers: "3小時", "5h", "1d", "2 分鐘", "昨天", "上午"
    if (/^\d+\s*[hmdwys]$/i.test(t)) continue;
    if (/^\d+\s*(小時|分鐘|秒|天|週|月|年)$/.test(t)) continue;
    if (/^(昨天|今天|剛剛|上午|下午|am|pm)$/i.test(t)) continue;
    // UI labels
    if (
      /^(Like|Comment|Share|Send|Save|讚|留言|分享|傳送|儲存|回覆|查看更多|顯示更多|追蹤|加入|關注|有興趣|沒興趣|已驗證帳號|上線狀態指標|在線上|發訊息)$/i.test(
        t
      )
    )
      continue;
    // Standalone separators
    if (t === "·" || t === "•") continue;
    // Pure digit lines of <= 4 digits that look like reaction counts
    // appearing mid-body (comment reaction counts, reply counts).
    if (/^\d{1,4}$/.test(t)) continue;
    cleaned.push(t);
  }
  // Drop trailing pure-number lines (likes / comments / shares engagement counts)
  while (cleaned.length > 0 && /^[\d,]+$/.test(cleaned[cleaned.length - 1])) {
    cleaned.pop();
  }
  // Collapse runs of internal whitespace caused by stripped inline noise.
  return cleaned.join("\n").replace(/[ \t]{2,}/g, " ").trim();
}

// NOTE: A React fiber-based sponsored detector was attempted in change
// `react-props-sponsored-detection` (archived 2026-04-07). It was abandoned
// when DevTools dumps confirmed Facebook's current builds no longer expose
// `__reactProps$*` or `__reactFiber$*` on DOM nodes — only empty
// `__reactHandles$*` and `__reactListeners$*` keys are visible. The
// imrehorvath uBO scriptlet from 2022 is no longer applicable. See
// `docs/development-challenges.md` and `docs/follow-up.md` for the
// post-mortem and alternative directions.

// Note: "助贊" is the CSS-reordered variant. Facebook's chronological
// feed renders the visible "贊助" label using DOM order `助贊` and
// applies CSS (likely `flex-direction: row-reverse` or similar) to
// flip it visually. Both orders must be matched.
const SPONSORED_LABELS = ["贊助", "助贊", "Sponsored", "广告", "廣告", "スポンサー"];

export function isShortEnglishAdLabelText(t: string): boolean {
  const normalized = t.replace(/\s+/g, " ").trim();
  return normalized === "Ad" || /^Ad\s*[·•]\s*(?:🌐)?$/.test(normalized);
}

export function isShortSponsoredLabelText(t: string): boolean {
  // Sponsored labels are short ("贊助", "贊助 · 🌐", "Sponsored", "Sponsored · ").
  // We require the character following the label to be a separator
  // (space / dot / bullet / end-of-string) so we don't false-positive on
  // body text like "贊助商提供" or "贊助廠商".
  if (t.length > 30) return false;
  if (isShortEnglishAdLabelText(t)) return true;
  for (const label of SPONSORED_LABELS) {
    if (t === label) return true;
    if (t.startsWith(label)) {
      const next = t.charAt(label.length);
      if (next === " " || next === "\u00a0" || next === "·" || next === "•") return true;
    }
  }
  return false;
}

// More permissive variant: matches a label appearing ANYWHERE in the text
// as long as it is bracketed by separators on both sides (or by start/end
// of string). Handles compound headers like "Hahow 好學校 · 贊助 · 🌐"
// where the entire header is collapsed into one text node and "贊助"
// is in the middle, not at the start. Still rejects body text like
// "我們的贊助商" because it requires a separator immediately after.
export function isLikelySponsoredLabelInText(t: string): boolean {
  if (t.length > 60) return false;
  const seps = new Set([" ", "\u00a0", "·", "•"]);
  for (const label of SPONSORED_LABELS) {
    const idx = t.indexOf(label);
    if (idx === -1) continue;
    const prevOk = idx === 0 || seps.has(t.charAt(idx - 1));
    const afterIdx = idx + label.length;
    const nextOk = afterIdx >= t.length || seps.has(t.charAt(afterIdx));
    if (prevOk && nextOk) return true;
  }
  return false;
}

// Facebook's English UI can render the visible "Ad" metadata label as a
// spaced anti-scrape sequence in the post header. Do not use the compact
// textContent form here: normal public metadata can contain similar decoys.
export function isSpacedEnglishAdHeaderText(t: string): boolean {
  const normalized = t.replace(/\s+/g, " ").trim();
  if (normalized.length === 0 || normalized.length > 180) return false;
  return /(^|[^A-Za-z])S\s+s\s+o\s+p\s+r\s+n\s+e\s+o\s+t\s+d\s+g(?=[^A-Za-z]|$)/i.test(
    normalized,
  );
}

// Labels that identify a standalone "Follow this author" button rendered
// inline with the post header when the viewer does not follow the author.
// Exact-equality match against visible text OR aria-label only —
// substring matching would false-positive on the per-post kebab-menu
// item "隱藏<author>的貼文" (which every post carries) and on reshared
// content mentioning 追蹤 (e.g. "記得追蹤我").
const FOLLOW_LABELS = ["追蹤", "追踪", "Follow", "關注", "关注"];

function hasFollowButtonInNode(node: HTMLElement): boolean {
  const interactive = node.querySelectorAll<HTMLElement>(
    'div[role="button"], button, a, span'
  );
  for (const el of interactive) {
    const txt = (el.textContent || "").trim();
    if (txt.length > 0 && txt.length <= 10) {
      for (const lab of FOLLOW_LABELS) {
        if (txt === lab) return true;
      }
    }
    const al = el.getAttribute("aria-label");
    if (al && al.length <= 20) {
      for (const lab of FOLLOW_LABELS) {
        if (al === lab) return true;
      }
    }
  }
  return false;
}

export function detectRecommended(el: HTMLElement): boolean {
  // A system-recommended post has a standalone Follow button inline with
  // the author heading (inside or adjacent to the h1-h6 element). Scope
  // to the first 5 ancestors of the heading to keep the search local to
  // the header region and avoid matching Follow-like text in reshared
  // content or comment threads.
  const heading = el.querySelector<HTMLElement>("h1, h2, h3, h4, h5, h6");
  if (!heading) return false;

  let node: HTMLElement | null = heading.parentElement;
  for (let i = 0; i < 5 && node && node !== el.parentElement; i++) {
    if (hasFollowButtonInNode(node)) return true;
    node = node.parentElement;
  }
  return false;
}

export function detectSponsored(el: HTMLElement): boolean {
  // Strategy 1: Check all spans/links for short sponsored labels.
  // We use visibleText (not textContent) to bypass per-character CSS
  // obfuscation in chronological feed (`?filter=all&sk=h_chr`) where
  // each visible char is wrapped in position:relative spans surrounded
  // by ~60 position:absolute decoy chars.
  const spans = el.querySelectorAll<HTMLElement>("span, a");
  for (const span of spans) {
    const t = visibleText(span).trim();
    if (isShortSponsoredLabelText(t)) return true;
  }

  // Strategy 2: Check links
  if (el.querySelector('a[href*="/ads/about"], a[href*="ad_preferences"]')) {
    return true;
  }

  // Strategy 3: Check the post header area for "贊助" followed by a
  // separator. visibleText again (not textContent) for chronological
  // anti-scrape compatibility.
  const head = visibleText(el).slice(0, 120);
  for (const label of SPONSORED_LABELS) {
    const idx = head.indexOf(label);
    if (idx === -1) continue;
    const next = head.charAt(idx + label.length);
    if (next === "" || next === " " || next === "\u00a0" || next === "·" || next === "•") {
      return true;
    }
  }
  return false;
}

// --- Sponsored detection via DOM scan ---

export function markSponsoredInFeed() {
  const main = document.querySelector('[role="main"]') as HTMLElement | null;
  if (!main) return;

  // Walk elements that commonly hold labels and check element.textContent.
  // The previous TreeWalker SHOW_TEXT pass missed Facebook's anti-scrape
  // trick of splitting "贊助" across multiple sibling text nodes
  // (e.g. <span>贊</span><span>助</span>). textContent on the parent
  // element concatenates them, so we'll see the label there.
  //
  // CRITICAL: include `div` in the candidate set. User-reported case
  // 2026-04-08: a sponsored post header was rendered as nested divs
  // (no span anywhere in the path) — restricting to span/a/strong/h4
  // missed it entirely. The textContent.length>60 early-exit keeps
  // performance acceptable on the much larger candidate set.
  const labels = SPONSORED_LABELS;
  const candidates = main.querySelectorAll<HTMLElement>(
    "div, span, a, strong, h1, h2, h3, h4, h5, h6"
  );
  const targets: HTMLElement[] = [];
  for (const el of candidates) {
    const rawText = (el.textContent || "").replace(/\s+/g, " ").trim();
    if (isSpacedEnglishAdHeaderText(rawText)) {
      targets.push(el);
      continue;
    }

    // Use visibleText (not textContent) so per-char CSS obfuscation
    // in chronological feed doesn't inflate the length past the
    // 60-char cutoff.
    const tc = visibleText(el).trim();
    if (tc.length === 0 || tc.length > 60) continue;
    if (isShortSponsoredLabelText(tc)) {
      targets.push(el);
      continue;
    }
    let hasLabel = false;
    for (const lab of labels) {
      if (tc.indexOf(lab) >= 0) {
        hasLabel = true;
        break;
      }
    }
    if (!hasLabel) continue;
    if (!isLikelySponsoredLabelInText(tc)) continue;
    targets.push(el);
  }

  for (const span of targets) {

    // Walk up to find the nearest tagged post container
    let el: HTMLElement | null = span as HTMLElement;
    let found = false;
    for (let i = 0; i < 25; i++) {
      el = el?.parentElement || null;
      if (!el || el === main) break;

      if (el.dataset.trulyId && !el.dataset.trulySponsored) {
        if (skipMixedFeedContainer(el)) {
          found = true;
          break;
        }

        // This tagged post contains a "贊助" label — mark it
        el.dataset.trulySponsored = "true";
        debugLog(`[Truly] Marked sponsored: ${el.dataset.trulyId}`);

        // Re-emit the post for re-classification
        const identity = extractPostIdentity(el);
        const post: PostData = {
          id: el.dataset.trulyId,
          element: el,
          text: extractCleanPostText(el, identity).slice(0, 500),
          authorName: identity.authorName,
          hasMedia: el.querySelector("img, video") !== null,
        };
        onNewPost?.(post);
        found = true;
        break;
      }
    }

    // If no tagged container found, create one
    if (!found) {
      // Find a reasonable container around this span
      let container: HTMLElement | null = span as HTMLElement;
      for (let i = 0; i < 20; i++) {
        container = container?.parentElement || null;
        if (!container || container === main) break;
        const r = container.getBoundingClientRect();
        // Tight constraints: post-column width, single-post height
        if (r.width >= 450 && r.width <= 720 && r.height >= 100 && r.height <= 1500) {
          if (
            !container.dataset.trulyId &&
            !processedElements.has(container) &&
            !container.parentElement?.closest("[data-truly-id]")
          ) {
            // Real feed posts carry a reaction bar with both "讚" and
            // "留言" buttons. Profile pages embed sidebar cards (e.g.
            // "聯絡資料" contact info, footer "廣告/Ad Choices" link)
            // that match the size window but have NO Like/Comment
            // buttons — reject those.
            const hasLike = !!container.querySelector(
              '[aria-label="讚"],[aria-label="Like"],[aria-label="喜歡"]'
            );
            const hasComment = !!container.querySelector(
              '[aria-label="留言"],[aria-label="Comment"]'
            );
            if (!hasLike || !hasComment) break;

            processedElements.add(container);
            const id = generatePostId();
            container.dataset.trulyId = id;
            container.dataset.trulySponsored = "true";

            const identity = extractPostIdentity(container);
            const post: PostData = {
              id,
              element: container,
              text: extractCleanPostText(container, identity).slice(0, 500),
              authorName: identity.authorName,
              hasMedia: container.querySelector("img, video") !== null,
            };
            debugLog(`[Truly] New sponsored post: ${id} author="${post.authorName}"`);
            onNewPost?.(post);
          }
          break;
        }
      }
    }
  }
}

// --- GraphQL interceptor message bridge ---
//
// The actual interceptor is now loaded directly via manifest.json as a
// MAIN-world content script at run_at: document_start. This guarantees
// window.fetch / XHR are patched BEFORE FB's own scripts run, so we
// catch the very first feed XHR (previously the first sponsored post
// was missed because the manual script-tag injection was too slow).
// Here we just listen for postMessage from the MAIN world.

// --- SSR cache (chrome.storage.local, isolated-world only) ---
//
// MAIN-world graphql-interceptor cannot reach chrome.storage, so it proxies
// all reads/writes through this isolated-world handler via postMessage.
//
// We use storage.local (not session) because:
//   - storage.session requires SW to call setAccessLevel before content
//     scripts can read/write, which is a race against SW startup
//   - storage.local is content-script-accessible by default, no race
//   - TTL-gating on read makes the persistence-vs-session difference moot
//   - 10KB per entry × 5min TTL = negligible quota usage
//
// See proposal `cache-ssr-fetch-in-session-storage` for the original rationale.
const SSR_CACHE_TTL_MS = 5 * 60 * 1000;
const SSR_CACHE_KEY_PREFIX = "truly-ssr:";
const SSR_CACHE_MAX_POSTS = 30;
const SSR_CACHE_MAX_SERIALIZED_BYTES = 120_000;
const SSR_CACHE_MAX_URL_LENGTH = 2048;
const SSR_CACHE_MAX_REQ_ID_LENGTH = 80;
const SSR_CACHE_MAX_TEXT_LENGTH = 5000;
const SSR_CACHE_MAX_FIELD_LENGTH = 240;
const SSR_CACHE_REQ_ID_RE = /^[A-Za-z0-9:_-]{1,80}$/;
const SSR_CACHE_ALLOWED_POST_TYPES: ReadonlySet<PostType> = new Set([
  "reshare",
  "group",
  "reel",
  "text_only",
  "page",
  "standard",
]);
const PAGE_ORIGIN = window.location.origin;

function isSamePageMessage(event: MessageEvent): boolean {
  return event.source === window && event.origin === PAGE_ORIGIN;
}

interface SsrCacheEntry {
  ts: number;
  posts: GraphQLPost[];
}

function isValidSsrCacheUrl(value: unknown): value is string {
  if (typeof value !== "string" || value.length === 0 || value.length > SSR_CACHE_MAX_URL_LENGTH) {
    return false;
  }
  try {
    const parsed = new URL(value);
    if (parsed.origin !== PAGE_ORIGIN) return false;
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return false;
    return isFacebookHost(parsed.hostname);
  } catch {
    return false;
  }
}

function isValidSsrCacheReqId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= SSR_CACHE_MAX_REQ_ID_LENGTH &&
    SSR_CACHE_REQ_ID_RE.test(value)
  );
}

function boundedString(value: unknown, maxLength: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > maxLength) return null;
  return trimmed;
}

function optionalBoundedString(value: unknown, maxLength: number): string | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  return boundedString(value, maxLength) ?? undefined;
}

function normalizeSsrCachePost(value: unknown): GraphQLPost | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  const postId = boundedString(raw.postId, SSR_CACHE_MAX_FIELD_LENGTH);
  const text = boundedString(raw.text, SSR_CACHE_MAX_TEXT_LENGTH);
  const authorName = boundedString(raw.authorName, SSR_CACHE_MAX_FIELD_LENGTH);
  if (!postId || !text || !authorName || typeof raw.isSponsored !== "boolean") return null;

  const postType = optionalBoundedString(raw.postType, SSR_CACHE_MAX_FIELD_LENGTH);
  const normalized: GraphQLPost = {
    postId,
    text,
    authorName,
    isSponsored: raw.isSponsored,
  };
  if (postType && SSR_CACHE_ALLOWED_POST_TYPES.has(postType as PostType)) {
    normalized.postType = postType as PostType;
  }
  const reshareOriginalText = optionalBoundedString(raw.reshareOriginalText, SSR_CACHE_MAX_TEXT_LENGTH);
  if (reshareOriginalText) normalized.reshareOriginalText = reshareOriginalText;
  const reshareOriginalAuthor = optionalBoundedString(raw.reshareOriginalAuthor, SSR_CACHE_MAX_FIELD_LENGTH);
  if (reshareOriginalAuthor) normalized.reshareOriginalAuthor = reshareOriginalAuthor;
  return normalized;
}

function normalizeSsrCachePosts(value: unknown): GraphQLPost[] | null {
  if (!Array.isArray(value) || value.length > SSR_CACHE_MAX_POSTS) return null;
  const posts = value.map(normalizeSsrCachePost);
  if (posts.some((post) => post === null)) return null;
  const normalized = posts as GraphQLPost[];
  if (JSON.stringify(normalized).length > SSR_CACHE_MAX_SERIALIZED_BYTES) return null;
  return normalized;
}

async function handleSsrCacheQuery(url: string, reqId: string): Promise<void> {
  if (!isValidSsrCacheUrl(url) || !isValidSsrCacheReqId(reqId)) return;
  let posts: GraphQLPost[] | null = null;
  if (typeof chrome !== "undefined" && chrome.storage?.local) {
    try {
      const key = SSR_CACHE_KEY_PREFIX + url;
      const result = await chrome.storage.local.get(key);
      const entry = result[key] as SsrCacheEntry | undefined;
      if (entry && Date.now() - entry.ts < SSR_CACHE_TTL_MS) {
        posts = normalizeSsrCachePosts(entry.posts);
      }
    } catch {
      posts = null;
    }
  }
  window.postMessage({ type: "TRULY_SSR_CACHE_REPLY", reqId, posts }, PAGE_ORIGIN);
}

function handleSsrCacheStore(url: string, posts: unknown): void {
  if (!isValidSsrCacheUrl(url)) return;
  const normalizedPosts = normalizeSsrCachePosts(posts);
  if (!normalizedPosts) return;
  if (typeof chrome === "undefined" || !chrome.storage?.local) return;
  const key = SSR_CACHE_KEY_PREFIX + url;
  const entry: SsrCacheEntry = { ts: Date.now(), posts: normalizedPosts };
  chrome.storage.local.set({ [key]: entry }).catch(() => {});
}

export function injectGraphQLInterceptor(): void {
  window.addEventListener("message", (event) => {
    if (!isSamePageMessage(event)) return;
    const data = event.data;
    if (!data || typeof data !== "object") return;
    if (data.type === "TRULY_GRAPHQL_POSTS") {
      const posts = normalizeSsrCachePosts(data.posts);
      if (posts) handleGraphQLPosts(posts);
      return;
    }
    if (data.type === "TRULY_SSR_CACHE_QUERY") {
      handleSsrCacheQuery(data.url, data.reqId);
      return;
    }
    if (data.type === "TRULY_SSR_CACHE_STORE") {
      handleSsrCacheStore(data.url, data.posts);
      return;
    }
  });
  // Handshake: tell the MAIN-world interceptor we're ready, so it replays
  // any GraphQL posts it dispatched before this listener was attached.
  // The interceptor runs at document_start (much earlier than this content
  // script's document_idle), so the first feed XHR can fire before we're
  // listening. The handshake closes this race window.
  window.postMessage({ type: "TRULY_CONTENT_READY" }, PAGE_ORIGIN);
}

// Test-only exports for ssr-cache.test.ts
export const __ssrCacheInternals = {
  TTL_MS: SSR_CACHE_TTL_MS,
  KEY_PREFIX: SSR_CACHE_KEY_PREFIX,
  handleSsrCacheQuery,
  handleSsrCacheStore,
  normalizeSsrCachePosts,
};

// --- Public API ---

export function startFeedInterception(
  callback: (post: PostData) => void
): void {
  onNewPost = callback;
  injectGraphQLInterceptor();

  // Periodic scan: pair every scanForNewPosts with an immediate
  // markSponsoredInFeed AND a reEvaluateKnownSponsored in the same tick.
  scanTimer = setInterval(() => {
    if (!isExtensionContextValid()) {
      if (scanTimer) {
        clearInterval(scanTimer);
        scanTimer = null;
      }
      return;
    }
    scanForNewPosts();
    markSponsoredInFeed();
    reEvaluateKnownSponsored();
  }, SCAN_INTERVAL);

  // Aggressive initial sweeps to catch the first sponsored post fast.
  for (const delay of [1000, 2500, 5000, 8000]) {
    setTimeout(() => {
      scanForNewPosts();
      markSponsoredInFeed();
      reEvaluateKnownSponsored();
    }, delay);
  }
}

// Test-only: reset all module-level state so unit tests don't leak across cases.
export function __resetForTesting(): void {
  gqlPostsByAuthor.clear();
  gqlPostsByText.clear();
  knownSponsoredTextSeeds.clear();
  processedElements = new WeakSet<HTMLElement>();
  postCounter = 0;
  onNewPost = null;
  __resetHealthForTesting();
}

// Test-only: install a post callback without starting the periodic timer.
export function __setOnNewPostForTesting(
  cb: ((post: PostData) => void) | null
): void {
  onNewPost = cb;
}

export function __processPostForTesting(el: HTMLElement, id = "test-post"): void {
  processNewPost(el, id);
}

export function stopFeedInterception(): void {
  if (scanTimer) {
    clearInterval(scanTimer);
    scanTimer = null;
  }
  onNewPost = null;
}
