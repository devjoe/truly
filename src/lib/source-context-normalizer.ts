import {
  STRUCTURED_POST_SEGMENT_LABEL,
  type StructuredPostContext,
  type StructuredPostSegment,
  type StructuredPostSegmentKind,
} from "./source-context-types";

export const SOURCE_CONTEXT_TEXT_LIMIT = 2000;
export const SOURCE_CONTEXT_ARRAY_LIMIT = 8;
export const SOURCE_CONTEXT_SEGMENT_LIMIT = 12;

export function normalizeContextText(text: string): string {
  return text.replace(/[\u200e\u200f\u202a-\u202e]/g, "").replace(/\s+/g, " ").trim();
}

function capContextText(text: string): string {
  return text.length > SOURCE_CONTEXT_TEXT_LIMIT
    ? text.slice(0, SOURCE_CONTEXT_TEXT_LIMIT).trim()
    : text;
}

function addSourceSegment(
  out: StructuredPostSegment[],
  seen: Set<string>,
  kind: StructuredPostSegmentKind,
  text: string | undefined,
): void {
  if (out.length >= SOURCE_CONTEXT_SEGMENT_LIMIT) return;
  const clean = text ? capContextText(text.trim()) : "";
  if (!clean) return;
  const key = `${kind}\u0000${normalizeContextText(clean)}`;
  if (seen.has(key)) return;
  seen.add(key);
  out.push({
    kind,
    label: STRUCTURED_POST_SEGMENT_LABEL[kind],
    text: clean,
    scanForZhtw: kind !== "image_alt",
  });
}

export function buildSourceSegments(context: Omit<StructuredPostContext, "sourceSegments">): StructuredPostSegment[] {
  const out: StructuredPostSegment[] = [];
  const seen = new Set<string>();
  if (context.isShare) {
    addSourceSegment(out, seen, "sharer_comment", context.sharerComment);
    addSourceSegment(out, seen, "shared_content", context.sharedContent);
  } else {
    addSourceSegment(out, seen, "post_text", context.ownText);
  }
  addSourceSegment(out, seen, "link_preview", context.linkPreview);
  for (const text of context.imageTexts) addSourceSegment(out, seen, "image_text", text);
  for (const text of context.imageAltTexts) addSourceSegment(out, seen, "image_alt", text);
  return out;
}

function isStructuredPostSegmentKind(value: unknown): value is StructuredPostSegmentKind {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(STRUCTURED_POST_SEGMENT_LABEL, value);
}

function normalizeOptionalText(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const clean = capContextText(value.trim());
  return clean || undefined;
}

function normalizeText(value: unknown): string {
  return normalizeOptionalText(value) ?? "";
}

function normalizeTextArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    if (out.length >= SOURCE_CONTEXT_ARRAY_LIMIT) break;
    const clean = normalizeOptionalText(item);
    if (!clean) continue;
    const key = normalizeContextText(clean);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(clean);
  }
  return out;
}

function normalizeSourceSegment(value: unknown): StructuredPostSegment | undefined {
  if (!value || typeof value !== "object") return undefined;
  const candidate = value as Partial<StructuredPostSegment>;
  if (!isStructuredPostSegmentKind(candidate.kind)) return undefined;
  const text = normalizeOptionalText(candidate.text);
  if (!text) return undefined;
  return {
    kind: candidate.kind,
    label: STRUCTURED_POST_SEGMENT_LABEL[candidate.kind],
    text,
    scanForZhtw: candidate.kind !== "image_alt",
  };
}

function normalizeSourceSegments(value: unknown): StructuredPostSegment[] {
  if (!Array.isArray(value)) return [];
  const out: StructuredPostSegment[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    if (out.length >= SOURCE_CONTEXT_SEGMENT_LIMIT) break;
    const segment = normalizeSourceSegment(item);
    if (!segment) continue;
    const key = `${segment.kind}\u0000${normalizeContextText(segment.text)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(segment);
  }
  return out;
}

export function normalizeStructuredPostContext(value: unknown): StructuredPostContext | undefined {
  if (!value || typeof value !== "object") return undefined;
  const candidate = value as Partial<StructuredPostContext>;
  const contextWithoutSegments: Omit<StructuredPostContext, "sourceSegments"> = {
    isShare: candidate.isShare === true,
    authorName: normalizeOptionalText(candidate.authorName),
    originalAuthor: normalizeOptionalText(candidate.originalAuthor),
    ownText: normalizeText(candidate.ownText),
    sharerComment: normalizeText(candidate.sharerComment),
    sharedContent: normalizeText(candidate.sharedContent),
    linkPreview: normalizeText(candidate.linkPreview),
    imageTexts: normalizeTextArray(candidate.imageTexts),
    imageAltTexts: normalizeTextArray(candidate.imageAltTexts),
  };
  const sourceSegments = normalizeSourceSegments(candidate.sourceSegments);
  const normalized: StructuredPostContext = {
    ...contextWithoutSegments,
    sourceSegments: sourceSegments.length > 0 ? sourceSegments : buildSourceSegments(contextWithoutSegments),
  };

  const hasText =
    Boolean(normalized.ownText) ||
    Boolean(normalized.sharerComment) ||
    Boolean(normalized.sharedContent) ||
    Boolean(normalized.linkPreview) ||
    normalized.imageTexts.length > 0 ||
    normalized.imageAltTexts.length > 0 ||
    normalized.sourceSegments.length > 0;
  return hasText ? normalized : undefined;
}
