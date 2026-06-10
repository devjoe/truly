// Pure display formatters for the sidepanel. Everything here is
// side-effect-free (no DOM, no module state, no chrome APIs) so it can be
// unit-tested directly without a jsdom/chrome stub. Rendering that consumes
// these strings lives in the sidepanel render modules.
import type { DashboardPostEvent } from "../lib/types";
import type { Lang } from "../lib/types";
import { t } from "../lib/i18n";
import { resolveStructuredPostContext } from "../lib/post-context";
import { splitFacebookImageAltText, stripLeadingPostIdentity } from "../lib/post-text";

export function scoreBand(score: number): "low" | "mid" | "high" {
  if (score >= 0.6) return "high";
  if (score >= 0.3) return "mid";
  return "low";
}

export function chipClass(band: "low" | "mid" | "high"): string {
  return `chip chip-${band}`;
}

export function formatTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString("zh-TW", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

export function formatElapsed(ms: number): string {
  // Tier 1 heuristic is synchronous and usually sub-millisecond; display
  // something more informative than "0ms".
  if (ms <= 0) return "<1ms";
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

export interface ShareDisplayParts {
  isShare: boolean;
  sharerComment: string;
  originalAuthor?: string;
  sharedContent?: string;
  linkPreview?: string;
}

export function parseShareDisplayParts(event: DashboardPostEvent): ShareDisplayParts {
  const context = resolveStructuredPostContext(event);
  return {
    isShare: context.isShare,
    sharerComment: context.sharerComment,
    originalAuthor: context.originalAuthor,
    sharedContent: context.sharedContent,
    linkPreview: context.linkPreview,
  };
}

export function displayEventText(event: DashboardPostEvent, lang: Lang = "zh-TW"): string {
  const share = parseShareDisplayParts(event);
  if (share.isShare) {
    return splitFacebookImageAltText(share.sharerComment).bodyText ||
      t("sidepanel.dynamic.reference.noSharerComment", lang);
  }
  const text = stripLeadingPostIdentity(event.fullText || event.text || "", {
    authorName: event.authorName,
    sourceName: event.sourceName,
  });
  const bodyText = splitFacebookImageAltText(text).bodyText;
  if (!bodyText && event.contentKind === "share_without_comment") {
    return t("sidepanel.dynamic.reference.noSharerComment", lang);
  }
  return bodyText;
}

export function displayEventPreview(event: DashboardPostEvent, lang: Lang = "zh-TW"): string {
  const share = parseShareDisplayParts(event);
  if (share.isShare) {
    if (share.sharerComment) {
      return t("sidepanel.dynamic.reference.previewSharerComment", lang, { text: share.sharerComment });
    }
    if (share.sharedContent) {
      return t("sidepanel.dynamic.reference.previewSharedContent", lang, { text: share.sharedContent });
    }
    if (share.linkPreview) {
      return t("sidepanel.dynamic.reference.previewLink", lang, { text: share.linkPreview });
    }
    return t("sidepanel.dynamic.reference.previewNoSharerComment", lang);
  }
  const text = stripLeadingPostIdentity(event.text || event.fullText || "", {
    authorName: event.authorName,
    sourceName: event.sourceName,
  });
  if (!text && event.sharedAttachmentText) {
    return t("sidepanel.dynamic.reference.previewSharedAttachment", lang, { text: event.sharedAttachmentText });
  }
  return text;
}

export function normalizePreviewText(raw: string): string {
  return raw
    .replace(/……\s*(?:查看更多|顯示更多|See more)/gi, " ")
    .replace(/(?:查看更多|顯示更多|See more)$/gi, " ")
    .replace(/可能是[\s\S]{0,120}?顯示的文字是「[^」]{0,240}」(?:的圖像|的影像|的圖片)?/g, " ")
    .replace(/可能是[^。！？\n]{0,100}(?:圖像|影像|圖片|相片|照片)/g, " ")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) =>
      line.length > 0 &&
      !/^可能是(?:顯示的文字是|.*(?:圖像|影像|圖片|相片|照片))/.test(line)
    )
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

export function cleanPreviewText(raw: string, limit = 260): string {
  const cleaned = normalizePreviewText(raw);
  return cleaned.length > limit ? `${cleaned.slice(0, limit).trim()}……` : cleaned;
}

export function stripSearchContextWrapper(raw: string): string {
  return raw
    .replace(/^(?:此為|這是)[「『]([^」』]{2,80})[」』]的/g, "$1的")
    .replace(/^(?:這篇|這則|此|該|本)?(?:貼文|文章|內容)(?:主要)?(?:以|展示|分享|介紹|分析|指出|強調|描述|呈現|討論|整理|說明|提供|是|為)\s*/g, "")
    .replace(/^此為[「『]?([^，。！？!?；;]{2,80})[」』]?的/g, "$1的")
    .replace(/^這是[「『]?([^，。！？!?；;]{2,80})[」』]?的/g, "$1的")
    .replace(/^(?:此|這)為\s*/g, "")
    .replace(/^(?:此|這)(?:貼文|文章|內容)為\s*/g, "")
    .replace(/^(?:作者|分享者)(?:在)?(?:社群平台)?(?:分享|介紹|指出|表示)\s*/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function cleanSearchContextText(raw: string, limit = 140): string {
  const cleaned = stripSearchContextWrapper(normalizePreviewText(raw))
    .replace(/……+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const sliced = cleaned.length > limit ? cleaned.slice(0, limit).trim() : cleaned;
  return sliced.replace(/[。！？!?；;：:，,、\s]+$/g, "").trim();
}

export function analysisPreviewText(event: DashboardPostEvent, lang: Lang = "zh-TW"): string {
  const summary = event.summary || event.decision.deepClassification?.summary;
  if (summary?.trim()) return cleanPreviewText(summary, 220);
  return cleanPreviewText(displayEventPreview(event, lang));
}

export function isExternalUrl(raw: string): boolean {
  try {
    const host = new URL(raw).hostname.replace(/^www\./, "").toLowerCase();
    return Boolean(
      host &&
        !host.endsWith("facebook.com") &&
        !host.endsWith("fbcdn.net") &&
        !host.endsWith("messenger.com")
    );
  } catch {
    return false;
  }
}

export function externalLinkCount(event: DashboardPostEvent): number {
  const text = [
    event.fullText,
    event.text,
    event.reshareOriginalText,
    event.sharedAttachmentText,
  ].filter(Boolean).join("\n");
  const links = text.match(/https?:\/\/[^\s)）]+/g) ?? [];
  return new Set(links.filter(isExternalUrl)).size;
}

export function referenceRelationshipText(event: DashboardPostEvent, lang: Lang = "zh-TW"): string {
  const share = parseShareDisplayParts(event);
  const author = event.authorName || t("sidepanel.dynamic.reference.currentAuthor", lang);
  if (share.isShare) {
    if (share.originalAuthor) {
      return t("sidepanel.dynamic.reference.sharedPostBy", lang, {
        author,
        originalAuthor: share.originalAuthor,
      });
    }
    return t("sidepanel.dynamic.reference.sharedPost", lang, { author });
  }
  return t("sidepanel.dynamic.reference.authoredPost", lang, { author });
}

export function referenceMaterialLabels(event: DashboardPostEvent, lang: Lang = "zh-TW"): string[] {
  const share = parseShareDisplayParts(event);
  const labels: string[] = [];
  if (share.isShare) {
    labels.push(t(
      share.sharerComment
        ? "sidepanel.dynamic.reference.material.sharerComment"
        : "sidepanel.dynamic.reference.material.noSharerComment",
      lang,
    ));
    if (share.sharedContent || (share.originalAuthor && event.hasMedia && !share.linkPreview)) {
      labels.push(t("sidepanel.dynamic.reference.material.sharedPost", lang));
    }
  } else {
    labels.push(t("sidepanel.dynamic.reference.material.postText", lang));
  }
  if (event.hasMedia) {
    labels.push(t(
      event.postType === "reel"
        ? "sidepanel.dynamic.reference.material.video"
        : "sidepanel.dynamic.reference.material.media",
      lang,
    ));
  }
  const links = externalLinkCount(event);
  if (links > 0) {
    labels.push(t("sidepanel.dynamic.reference.material.externalLinks", lang, { count: links }));
  }
  return labels;
}
