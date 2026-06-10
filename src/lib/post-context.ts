import type { PostData } from "./types";
import { cleanAuthoredPostText, splitFacebookImageAltText, stripLeadingPostIdentity } from "./post-text";
import {
  STRUCTURED_POST_SEGMENT_LABEL,
  type StructuredPostContext,
} from "./source-context-types";
import {
  buildSourceSegments,
  normalizeContextText,
  normalizeStructuredPostContext,
} from "./source-context-normalizer";

export {
  STRUCTURED_POST_SEGMENT_LABEL,
  type StructuredPostContext,
  type StructuredPostSegment,
  type StructuredPostSegmentKind,
} from "./source-context-types";
export {
  normalizeContextText,
  normalizeStructuredPostContext,
} from "./source-context-normalizer";

function trimText(text: string | undefined, limit: number): string {
  return (text || "").trim().slice(0, limit);
}

export interface StructuredPostContextInput {
  text?: string;
  fullText?: string;
  authorName?: string;
  sourceName?: string;
  postType?: PostData["postType"];
  contentKind?: PostData["contentKind"];
  sharedAttachmentText?: string;
  reshareOriginalText?: string;
  reshareOriginalAuthor?: string;
}

export interface StructuredPostContextSource extends StructuredPostContextInput {
  sourceContext?: unknown;
}

export function stripKnownReferenceText(body: string, references: Array<string | undefined>): string {
  let out = body;
  const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  for (const reference of references) {
    const cleanReference = reference?.trim();
    if (!cleanReference || cleanReference.length < 4) continue;
    if (normalizeContextText(out) === normalizeContextText(cleanReference)) continue;
    out = out.replace(new RegExp(escapeRegExp(cleanReference), "g"), " ");
    if (normalizeContextText(out).includes(normalizeContextText(cleanReference))) {
      const compactReference = cleanReference.split(/\s+/).map(escapeRegExp).join("\\s+");
      out = out.replace(new RegExp(compactReference, "g"), " ");
    }
  }
  return out.replace(/\n{3,}/g, "\n\n").trim();
}

export function stripInlineAuthorPrefix(text: string, authorName: string | undefined): string {
  const author = authorName?.trim();
  const clean = text.trim();
  if (!author || !clean.startsWith(author)) return clean;
  const next = clean.charAt(author.length);
  if (next && !/\s|[·•:：]/.test(next)) return clean;
  return clean.slice(author.length).replace(/^[\s·•:：-]+/, "").trim();
}

export function isUsefulReferenceBody(text: string | undefined): boolean {
  const clean = normalizeContextText(text ?? "");
  if (clean.length < 6 && (clean.match(/\p{Script=Han}/gu) ?? []).length < 3) return false;
  if (/^(?:\d+\s*)?(?:秒|分鐘|小時|天|週|月|年|昨天|今天|剛剛|上午|下午|am|pm)$/i.test(clean)) return false;
  if (/^\d{1,2}月\d{1,2}日(?:\s*(?:上午|下午)?\s*\d{1,2}:\d{2})?$/i.test(clean)) return false;
  if (looksLikeReferenceBylineChrome(clean)) return false;
  if (/^(?:的\s*)?(?:圖像|影像|圖片|相片|照片)?\s*未提供相片說明[。.]?$/i.test(clean)) return false;
  return true;
}

function looksLikeReferenceBylineChrome(text: string): boolean {
  const clean = normalizeContextText(text).replace(/[·•]/g, " ");
  if (/^(?:追蹤|已追蹤|Follow|Following)?\s*[0-9年月日時小分秒上午下午:：/\-.\s]{2,32}$/i.test(clean)) {
    return true;
  }
  if (/^(?:追蹤|已追蹤|Follow|Following)\s*[0-9年月日時小分秒上午下午:：/\-.\s]{0,32}$/i.test(clean)) {
    return true;
  }
  const compact = clean.replace(/\s+/g, "");
  if (/^[0-9年月日時小分秒上午下午:：/\-.]{2,32}$/i.test(compact)) return true;
  if (/^(?:小時|分鐘|秒|天|週|月|年)\d{1,2}(?:\d{1,2})?$/i.test(compact)) return true;
  if (/^\d{1,2}(?:小時|分鐘|秒|天|週|月|年)(?:\d{1,2})?$/i.test(compact)) return true;
  if (/\bbody\b/i.test(clean) && (clean.match(/\p{Script=Han}/gu) ?? []).length <= 2) return true;
  if (/\bbody\b/i.test(clean) && clean.length <= 16 && !/[。！？!?，,；;]/.test(clean.replace(/[」』）)]/g, ""))) {
    return true;
  }
  return false;
}

function looksLikeBylineTimeOnlyChrome(text: string): boolean {
  const clean = normalizeContextText(text)
    .replace(/查看更多|顯示較少|See more|See less/gi, " ")
    .replace(/[·•]/g, " ")
    .trim();
  if (!clean) return false;
  if (/[。！？!?，,；;]/.test(clean)) return false;
  const compact = clean.replace(/\s+/g, "");
  if (compact.length > 80) return false;
  if (!/\d/.test(compact)) return false;
  return /[年月日時小分秒上午下午:：]/.test(compact);
}

function stripLeadingAuthorBadgeChrome(text: string): string {
  let out = text.trim();
  const leadingBadge =
    /^(?:管理員|社團專家|保持發言的成員|最常發言的成員|熱衷發言的成員|版主|Admin|Moderator|Group expert|Top contributor)\s*/i;
  for (let i = 0; i < 4; i += 1) {
    const next = out.replace(leadingBadge, "").trim();
    if (next === out) break;
    out = next;
  }
  return out;
}

function startsWithAuthorBadgeChrome(text: string): boolean {
  return /^(?:管理員|社團專家|保持發言的成員|最常發言的成員|熱衷發言的成員|版主|Admin|Moderator|Group expert|Top contributor)/i.test(text.trim());
}

function stripTrailingEngagementChrome(text: string): string {
  let out = text.trim();
  const engagementSuffix =
    /(?:\s*(?:\d+\s*(?:秒|分鐘|小時|天|週|月|年)|昨天|今天|剛剛)(?:\s*(?:上午|下午)?\s*\d{1,2}:\d{2})?)?\s*(?:讚|回覆|留言|分享|Like|Reply|Comment|Share)(?:\s*(?:讚|回覆|留言|分享|Like|Reply|Comment|Share|\d+))*\s*$/i;
  for (let i = 0; i < 3; i += 1) {
    const next = out.replace(engagementSuffix, "").trim();
    if (next === out) break;
    out = next;
  }
  return out;
}

function isUsefulSharerComment(text: string): boolean {
  const clean = normalizeContextText(text);
  if (!clean) return false;
  if (looksLikeReferenceBylineChrome(clean)) return false;
  if (looksLikeObfuscatedAttachmentToken(clean)) return false;
  return true;
}

function isUsefulLinkPreview(text: string | undefined): boolean {
  const clean = normalizeContextText(text ?? "");
  if (clean.length < 2) return false;
  if (/^(?:\d+\s*)?(?:秒|分鐘|小時|天|週|月|年|昨天|今天|剛剛|上午|下午|am|pm)$/i.test(clean)) return false;
  if (/^(?:的\s*)?(?:圖像|影像|圖片|相片|照片)?\s*未提供相片說明[。.]?$/i.test(clean)) return false;
  if (/^(?:.{2,80})貼文的(?:相片|照片|圖片)$/u.test(clean)) return false;
  if (/^(?:的\s*)?(?:圖像|影像|圖片|相片|照片)?\s*(?:\d{1,2}:)?\d{1,2}:\d{2}\s*\/\s*(?:\d{1,2}:)?\d{1,2}:\d{2}(?:\s+(?:\d{1,2}:)?\d{1,2}:\d{2}\s*\/\s*(?:\d{1,2}:)?\d{1,2}:\d{2})*$/i.test(clean)) return false;
  return true;
}

function isIdentityOnlyPreview(text: string, source: StructuredPostContextInput): boolean {
  const clean = normalizeContextText(text);
  if (looksLikeSourceNameOnlyPreview(clean)) return true;
  const names = [source.sourceName, source.authorName, source.reshareOriginalAuthor]
    .map((name) => normalizeContextText(name || ""))
    .filter((name) => name.length >= 2);
  return names.some((name) => {
    if (clean === name) return true;
    if (!clean.startsWith(name)) return false;
    const rest = clean.slice(name.length).replace(/^[\s·•:：-]+/, "").trim();
    return looksLikeObfuscatedAttachmentToken(rest) || looksLikeShortObfuscatedAttachmentToken(rest);
  });
}

function looksLikeSourceNameOnlyPreview(text: string): boolean {
  const clean = normalizeContextText(text);
  if (clean.length < 2 || clean.length > 60) return false;
  if (/[。！？!?，,；;:：]/.test(clean)) return false;
  if (/\s/.test(clean) && clean.split(/\s+/).length > 5) return false;
  return /(社團|討論區|交流|中心|貼圖區|Club|Group|協會|論壇|社群|讀書會)/i.test(clean);
}

function isDuplicatePreview(body: string, preview: string): boolean {
  const cleanBody = normalizeContextText(body).toLowerCase();
  const cleanPreview = normalizeContextText(preview).toLowerCase();
  if (cleanPreview.length < 20) return false;
  return cleanBody.startsWith(cleanPreview);
}

function looksLikeObfuscatedAttachmentToken(token: string): boolean {
  const compact = token.replace(/[^\p{Letter}\p{Number}:年月日時小分秒上午下午]/gu, "");
  if (compact.length < 8) return false;
  if (!/\d/.test(compact)) return false;
  const latinCount = (compact.match(/[a-z]/gi) ?? []).length;
  const digitCount = (compact.match(/\d/g) ?? []).length;
  const hanCount = (compact.match(/[\u4e00-\u9fff]/g) ?? []).length;
  if (compact.length >= 12 && latinCount >= 4 && digitCount >= 4 && hanCount <= 2) return true;
  return /(?:\d+[年月日時小分秒]|[年月日時小分秒]\d)/.test(compact) || /[a-z]{5,}/i.test(compact);
}

function looksLikeShortObfuscatedAttachmentToken(token: string): boolean {
  const compact = token.replace(/[^\p{Letter}\p{Number}:年月日時小分秒上午下午]/gu, "");
  if (compact.length < 4 || compact.length > 24) return false;
  if (!/\d/.test(compact)) return false;
  return /[a-z]/i.test(compact) && /[年月日時小分秒上午下午]/.test(compact);
}

function stripLeadingObfuscatedAttachmentTokens(text: string): string {
  const parts = text.trim().split(/\s+/);
  let idx = 0;
  while (idx < Math.min(parts.length, 4) && looksLikeObfuscatedAttachmentToken(parts[idx])) {
    idx += 1;
  }
  return parts.slice(idx).join(" ").trim();
}

function stripLeadingStandaloneDomain(text: string): { text: string; stripped: boolean } {
  const next = text.replace(
    /^(?:https?:\/\/|www\.)?[a-z0-9][a-z0-9-]*(?:\.[a-z0-9][a-z0-9-]*)+(?:[/?#][^\s\u4e00-\u9fffA-Z]*)?/i,
    "",
  ).trim();
  return { text: next, stripped: next !== text.trim() };
}

function looksLikeRepeatedMachineTokenLine(text: string): boolean {
  const tokens = text.trim().split(/\s+/).filter(Boolean);
  if (tokens.length === 0 || tokens.length > 3) return false;
  if (!tokens.every((token) => /^[a-z0-9]{6,}$/i.test(token) && /\d/.test(token))) return false;
  return new Set(tokens.map((token) => token.toLowerCase())).size === 1;
}

function looksLikeSourceNamePlusObfuscatedToken(text: string): boolean {
  const tokens = text.trim().split(/\s+/).filter(Boolean);
  if (tokens.length < 2) return false;
  const last = tokens.at(-1) || "";
  if (!looksLikeObfuscatedAttachmentToken(last) && !looksLikeShortObfuscatedAttachmentToken(last)) return false;
  const prefix = tokens.slice(0, -1).join(" ").trim();
  if (prefix.length < 2 || prefix.length > 48) return false;
  if (/[。！？!?，,；;：:「」『』()（）]/.test(prefix)) return false;
  return /[\p{Script=Han}A-Za-z]/u.test(prefix);
}

function looksLikeAuthorChromeBeforeBody(line: string, nextLine: string | undefined): boolean {
  if (!nextLine) return false;
  if (!/^[\u4e00-\u9fff]{2,4}$/u.test(line.trim())) return false;
  return /^[A-Z「『我你妳他她它這那]/u.test(nextLine.trim());
}

function sanitizeLinkPreviewChrome(text: string | undefined): string {
  const rawLines = (text || "")
    .split(/\r?\n/)
    .map((line) => {
      let clean = normalizeContextText(line);
      clean = stripLeadingObfuscatedAttachmentTokens(clean);
      const domainStripped = stripLeadingStandaloneDomain(clean);
      clean = domainStripped.text;
      if (domainStripped.stripped) {
        clean = clean.replace(/^[\u4e00-\u9fff]{2,4}(?=[A-Z「『我你妳他她它這那])/u, "").trim();
      }
      if (looksLikeRepeatedMachineTokenLine(clean)) return "";
      if (looksLikeSourceNamePlusObfuscatedToken(clean)) return "";
      if (looksLikeObfuscatedAttachmentToken(clean)) return "";
      return clean;
    })
    .filter((line) => line.length >= 2);
  const lines = rawLines.filter((line, index) =>
    !looksLikeAuthorChromeBeforeBody(line, rawLines[index + 1])
  );
  return lines.join("\n").trim();
}

function splitImageContext(raw: string | undefined): {
  bodyText: string;
  imageTexts: string[];
  imageAltTexts: string[];
} {
  return splitFacebookImageAltText(raw ?? "");
}

function addUnique(out: string[], seen: Set<string>, text: string): void {
  const clean = text.trim();
  if (!clean || seen.has(clean)) return;
  seen.add(clean);
  out.push(clean);
}

function stripSharedContentIdentityChrome(
  text: string,
  identity: { sourceName?: string; authorName?: string },
): string {
  let out = text.trim();
  out = stripLeadingAuthorBadgeChrome(out);

  const names = [identity.sourceName, identity.authorName]
    .map((name) => name?.trim())
    .filter((name): name is string => Boolean(name && name.length >= 2));

  const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const stripLeadingByline = (value: string) => {
    let next = value.trim();
    next = next.replace(/^(?:追蹤|已追蹤|Follow|Following)\s*/i, "").trim();
    next = next.replace(/^(?:\d{1,2}月\d{1,2}日|\d+\s*(?:秒|分鐘|小時|天|週|月|年)|昨天|今天|剛剛)(?:\s*(?:上午|下午)?\s*\d{1,2}:\d{2})?[\s·•-]*/i, "").trim();
    next = next.replace(/^(?=[0-9年月日時小分秒上午下午:：/\-.\s]{2,32}(?=[#＃\u4e00-\u9fffA-Z]))(?=.*[年月日時小分秒上午下午])[0-9年月日時小分秒上午下午:：/\-.\s]+/i, "").trim();
    return next;
  };
  const stripLeadingNames = (value: string) => {
    let next = value.trim();
    for (let pass = 0; pass < names.length + 2; pass += 1) {
      let changed = false;
      for (const name of names) {
        if (!next.startsWith(name)) continue;
        const rest = next.slice(name.length).trimStart();
        const gluedToChrome =
          !rest ||
          names.some((candidate) => rest.startsWith(candidate)) ||
          startsWithAuthorBadgeChrome(rest) ||
          /^\bbody\b/i.test(rest) ||
          /^(?:追蹤|已追蹤|Follow|Following|[0-9年月日時小分秒上午下午:：/\-.]|\s|[·•-])/.test(rest);
        const gluedToBody = /\s/.test(name) && /^[A-Z0-9#「『\u4e00-\u9fff]/u.test(rest);
        const separated = !next.charAt(name.length) || /[\s·•:：-]/.test(next.charAt(name.length));
        if (!gluedToChrome && !separated && !gluedToBody) continue;
        next = rest.replace(/^[\s·•:：-]+/, "").trim();
        changed = true;
      }
      if (!changed) break;
    }
    return next;
  };
  const stripLeadingObfuscatedByline = (value: string) => {
    const segments = value.split(/\s*[·•]\s*/).map((part) => part.trim()).filter(Boolean);
    if (segments.length < 2) return value;
    const prefix = segments.slice(0, -1).join(" ");
    const suffix = segments.at(-1) || "";
    if (!suffix || suffix.length < 4) return value;
    const hasIdentity = names.some((name) => prefix.includes(name));
    const hasTimestamp = /[0-9].*[年月日時小分秒]|[年月日時小分秒].*[0-9]|(?:昨天|今天|剛剛)/.test(prefix);
    if (hasIdentity || hasTimestamp) return suffix.trim();
    return value;
  };
  const dateSuffix = /(?:\s+(?:\d{1,2}月\d{1,2}日|\d+\s*(?:秒|分鐘|小時|天|週|月|年)|昨天|今天|剛剛)(?:\s*(?:上午|下午)?\s*\d{1,2}:\d{2})?)$/i;
  const suffixes = [
    names.join("\\s+"),
    [...names].reverse().join("\\s+"),
    ...names,
  ].map((value) => value.split("\\s+").map(escapeRegExp).join("\\s+"));

  for (let i = 0; i < 4; i += 1) {
    const before = out;
    out = stripLeadingObfuscatedByline(out);
    out = stripLeadingNames(out);
    out = stripLeadingByline(out);
    out = stripLeadingAuthorBadgeChrome(out);
    out = out.replace(dateSuffix, "").trim();
    for (const suffix of suffixes) {
      out = out.replace(new RegExp(`\\s+${suffix}$`, "i"), "").trim();
    }
    out = stripTrailingEngagementChrome(out);
    if (out === before) break;
  }
  return out;
}

export function buildStructuredPostContext(source: StructuredPostContextInput): StructuredPostContext {
  const isShare =
    source.postType === "reshare" ||
    source.contentKind === "share_without_comment" ||
    source.contentKind === "reshare_with_comment" ||
    Boolean(source.reshareOriginalText);
  const raw = source.fullText || source.text || "";
  const originalAuthor =
    source.reshareOriginalAuthor ||
    raw.match(/### 原始作者：(.+?)(?:\n|$)/)?.[1]?.trim();
  const parsedSharedContent = raw.match(/### 被分享內容\n([\s\S]*)$/)?.[1]?.trim();
  let rawSharedContent =
    source.reshareOriginalText ||
    (source.contentKind === "share_without_comment" ? source.text : "") ||
    parsedSharedContent ||
    "";
  const matchComment = raw.match(/### 分享者評論\n([\s\S]*?)(?=\n### 原始作者：|\n### 被分享內容|$)/);
  const parsedComment = matchComment?.[1]?.trim();
  const cleanSharedCandidate = (text: string): string => stripSharedContentIdentityChrome(stripLeadingPostIdentity(text, {
    sourceName: source.sourceName,
    authorName: originalAuthor || source.authorName,
  }), {
    sourceName: source.sourceName,
    authorName: originalAuthor || source.authorName,
  });
  let sharedContent = cleanSharedCandidate(rawSharedContent);
  let sharedContentBody = splitImageContext(sharedContent).bodyText;
  let sharedFromVisibleTextFallback = false;
  const sourceTextFallback = source.fullText || source.text || "";
  const canTreatVisibleTextAsSharedContent =
    isShare &&
    !!sourceTextFallback &&
    !parsedComment &&
    (source.contentKind === "share_without_comment" || !!originalAuthor) &&
    (
      source.contentKind === "share_without_comment" ||
      looksLikeBylineTimeOnlyChrome(rawSharedContent)
    ) &&
    sourceTextFallback.trim().length > rawSharedContent.trim().length + 30;
  if (
    canTreatVisibleTextAsSharedContent &&
    (!isUsefulReferenceBody(sharedContent) || !isUsefulReferenceBody(sharedContentBody))
  ) {
    const fallbackSharedContent = cleanSharedCandidate(sourceTextFallback);
    const fallbackSharedBody = splitImageContext(fallbackSharedContent).bodyText;
    if (isUsefulReferenceBody(fallbackSharedContent) && isUsefulReferenceBody(fallbackSharedBody)) {
      rawSharedContent = sourceTextFallback;
      sharedContent = fallbackSharedContent;
      sharedContentBody = fallbackSharedBody;
      sharedFromVisibleTextFallback = true;
    }
  }
  const noComment =
    source.contentKind === "share_without_comment" ||
    parsedComment === "（分享者沒有加上文字）" ||
    sharedFromVisibleTextFallback;
  const fallbackComment = stripLeadingPostIdentity(source.text || "", {
    authorName: source.authorName,
    sourceName: source.sourceName,
  });
  const rawOwnText = isShare ? parsedComment || (sharedFromVisibleTextFallback ? "" : fallbackComment) : stripLeadingPostIdentity(raw, {
    authorName: source.authorName,
    sourceName: source.sourceName,
  });
  const rawLinkPreview = source.sharedAttachmentText && source.sharedAttachmentText !== sharedContent
    ? sanitizeLinkPreviewChrome(source.sharedAttachmentText)
    : "";
  const inlineStrippedOwnText = stripInlineAuthorPrefix(rawOwnText, source.authorName);
  const ownText = cleanAuthoredPostText(stripKnownReferenceText(
    inlineStrippedOwnText,
    [sharedContent, rawLinkPreview],
  ), {
    sourceName: source.sourceName,
    authorName: source.authorName,
  });
  const linkPreviewBody = splitImageContext(rawLinkPreview).bodyText;
  const sourceTextBody = stripLeadingPostIdentity(source.text || "", {
    authorName: source.authorName,
    sourceName: source.sourceName,
  });
  const sourceTextAlreadyContainsPreview =
    !isShare &&
    linkPreviewBody.length >= 20 &&
    normalizeContextText(sourceTextBody).toLowerCase().includes(normalizeContextText(linkPreviewBody).toLowerCase());
  const linkPreview = isUsefulLinkPreview(linkPreviewBody) &&
      !isIdentityOnlyPreview(linkPreviewBody, source) &&
      !sourceTextAlreadyContainsPreview &&
      !isDuplicatePreview(inlineStrippedOwnText, linkPreviewBody) &&
      !isDuplicatePreview(ownText, linkPreviewBody) &&
      !isDuplicatePreview(sharedContent, linkPreviewBody)
    ? rawLinkPreview
    : "";

  const imageTexts: string[] = [];
  const imageAltTexts: string[] = [];
  const seenImageText = new Set<string>();
  const seenAltText = new Set<string>();
  const splitAll = (...texts: string[]) => {
    for (const text of texts) {
      const split = splitImageContext(text);
      for (const item of split.imageTexts) addUnique(imageTexts, seenImageText, item);
      for (const item of split.imageAltTexts) addUnique(imageAltTexts, seenAltText, item);
    }
  };
  splitAll(ownText, sharedContent, rawLinkPreview, linkPreview);
  const sharerCommentBody = splitImageContext(ownText).bodyText;
  const standardOwnTextBody = splitImageContext(ownText).bodyText;
  const shareComment = noComment || !isUsefulSharerComment(sharerCommentBody) ? "" : sharerCommentBody;

  const context = {
    isShare,
    authorName: source.authorName,
    originalAuthor,
    ownText: isShare ? shareComment : standardOwnTextBody,
    sharerComment: shareComment,
    sharedContent: isUsefulReferenceBody(sharedContent) && isUsefulReferenceBody(sharedContentBody) ? sharedContentBody : "",
    linkPreview: splitImageContext(linkPreview).bodyText,
    imageTexts,
    imageAltTexts,
  };

  return {
    ...context,
    sourceSegments: buildSourceSegments(context),
  };
}

export function resolveStructuredPostContext(source: StructuredPostContextSource): StructuredPostContext {
  return normalizeStructuredPostContext(source.sourceContext) ?? buildStructuredPostContext(source);
}

function richerSharedText(snapshotText: string, extractedSharedText: string): string {
  if (!snapshotText) return extractedSharedText;
  if (!extractedSharedText) return snapshotText;
  const attachmentLooksLikeChrome = /原始音訊|Original audio|追蹤|Follow/i.test(extractedSharedText);
  if (attachmentLooksLikeChrome && snapshotText.length > extractedSharedText.length + 8) return snapshotText;
  if (snapshotText.length > extractedSharedText.length + 20) return snapshotText;
  return extractedSharedText;
}

export function buildTierBPostText(post: PostData, visibleText: string): string {
  const ownText = trimText(stripLeadingPostIdentity(post.text || visibleText, {
    sourceName: post.sourceName,
    authorName: post.authorName,
  }), 2000);
  const context = buildStructuredPostContext({
    ...post,
    fullText: post.text,
  });
  const extractedSharedText = trimText(context.sharedContent || context.linkPreview, 2000);
  const visibleSharedFallback = stripSharedContentIdentityChrome(ownText, {
    sourceName: post.sourceName,
    authorName: post.reshareOriginalAuthor || post.authorName,
  });
  const originalText = post.contentKind === "share_without_comment"
    ? richerSharedText(
      isUsefulReferenceBody(visibleSharedFallback) ? visibleSharedFallback : "",
      extractedSharedText,
    )
    : extractedSharedText;

  if (
    post.postType === "reshare" ||
    post.contentKind === "share_without_comment" ||
    post.contentKind === "reshare_with_comment"
  ) {
    const lines: string[] = ["## 分享文結構"];
    lines.push(`分享者：${post.authorName || "unknown"}`);
    lines.push("### 分享者評論");
    lines.push(post.contentKind === "share_without_comment" || !context.sharerComment ? "（分享者沒有加上文字）" : context.sharerComment);
    if (post.reshareOriginalAuthor) lines.push(`### 原始作者：${post.reshareOriginalAuthor}`);
    if (originalText) {
      const label = context.sharedContent || originalText !== extractedSharedText
        ? "### 被分享內容"
        : "### 連結/影片預覽";
      lines.push(label);
      lines.push(originalText);
    }
    return lines.join("\n");
  }

  const standardText = cleanAuthoredPostText(stripLeadingPostIdentity(visibleText || post.text, {
    sourceName: post.sourceName,
    authorName: post.authorName,
  }), {
    sourceName: post.sourceName,
    authorName: post.authorName,
  });
  return trimText(splitImageContext(standardText).bodyText, 2000);
}
