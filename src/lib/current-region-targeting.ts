import type { ReadingTarget, ReadingTargetRect } from "./reading-target-types";

/**
 * Current-region (point) targeting for the General Page Reader — Slice 6b.
 *
 * Pure resolution logic lives here so it can be contract-tested with jsdom.
 * The content script owns the live pieces that need real layout:
 * pointer tracking and `document.elementFromPoint`.
 */

export const POINT_TARGET_MIN_TEXT_LENGTH = 40;
export const POINT_TARGET_MAX_TEXT_LENGTH = 3600;
export const POINT_TARGET_SURROUNDING_TEXT_LIMIT = 600;
export const POINTER_FRESHNESS_MS = 30_000;

export interface TrackedPointerPoint {
  x: number;
  y: number;
  ts: number;
}

export function isPointerPointFresh(point: TrackedPointerPoint | undefined, now: number): boolean {
  return Boolean(point && now - point.ts <= POINTER_FRESHNESS_MS);
}

const PREFERRED_BLOCK_TAGS = new Set([
  "p",
  "li",
  "blockquote",
  "pre",
  "figcaption",
  "td",
  "th",
  "dd",
  "dt",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
]);

/**
 * Containers may stand in for a missing preferred block, but only mid-level
 * ones: accepting `article`/`main`/`body` here would turn a stray click on a
 * short node into a whole-page target.
 */
const CONTAINER_BLOCK_TAGS = new Set([
  "div",
  "section",
]);

const NON_TARGETABLE_CLOSEST_SELECTOR = [
  "input",
  "textarea",
  "select",
  "button",
  "[contenteditable]",
  "[contenteditable=\"true\"]",
  "nav",
  "[role=\"navigation\"]",
  "[data-truly-ui]",
  "[id^=\"truly-\"]",
  "truly-overlay",
].join(",");

export type PointTargetErrorReason =
  | "no_pointer_target"
  | "target_extraction_failed";

export type PointTargetResolution =
  | { ok: true; target: ReadingTarget }
  | { ok: false; error: PointTargetErrorReason };

export function isTargetableElement(element: Element | null | undefined): boolean {
  if (!element)
    return false;
  const tagName = element.tagName?.toLowerCase() ?? "";
  if (tagName === "html" || tagName === "body")
    return false;
  if (typeof element.closest === "function" && element.closest(NON_TARGETABLE_CLOSEST_SELECTOR))
    return false;
  if (isMarkedHidden(element))
    return false;
  return true;
}

function isMarkedHidden(element: Element): boolean {
  let current: Element | null = element;
  while (current) {
    if (current.getAttribute?.("hidden") !== null && current.getAttribute?.("hidden") !== undefined)
      return true;
    if (current.getAttribute?.("aria-hidden") === "true")
      return true;
    const style = current.getAttribute?.("style") ?? "";
    if (/display\s*:\s*none|visibility\s*:\s*hidden/i.test(style))
      return true;
    current = current.parentElement;
  }
  return false;
}

/**
 * Walk up from the element under the pointer to the nearest readable block:
 * a preferred text block first, then a bounded container. Returns null when
 * nothing in the ancestry carries enough standalone text.
 */
export function resolveReadingBlock(element: Element | null | undefined): Element | null {
  if (!element || !isTargetableElement(element))
    return null;

  let containerCandidate: Element | null = null;
  let current: Element | null = element;
  while (current) {
    const tagName = current.tagName?.toLowerCase() ?? "";
    if (tagName === "html" || tagName === "body")
      break;
    const text = normalizeText(current.textContent ?? "");
    if (PREFERRED_BLOCK_TAGS.has(tagName) && text.length >= POINT_TARGET_MIN_TEXT_LENGTH)
      return current;
    if (
      !containerCandidate &&
      CONTAINER_BLOCK_TAGS.has(tagName) &&
      text.length >= POINT_TARGET_MIN_TEXT_LENGTH &&
      text.length <= POINT_TARGET_MAX_TEXT_LENGTH
    ) {
      containerCandidate = current;
    }
    current = current.parentElement;
  }
  return containerCandidate;
}

export interface BuildPointReadingTargetInput {
  surfaceId: string;
  elementAtPoint: Element | null | undefined;
  sourceRect?: ReadingTargetRect;
}

export function buildPointReadingTarget(input: BuildPointReadingTargetInput): PointTargetResolution {
  const block = resolveReadingBlock(input.elementAtPoint);
  if (!block)
    return { ok: false, error: "no_pointer_target" };

  const text = clampText(normalizeText(block.textContent ?? ""), POINT_TARGET_MAX_TEXT_LENGTH);
  if (text.length < POINT_TARGET_MIN_TEXT_LENGTH)
    return { ok: false, error: "no_pointer_target" };

  const surroundingText = buildSurroundingText(block, text);
  const rect = input.sourceRect ?? rectForElement(block);

  return {
    ok: true,
    target: {
      id: `target:paragraph:${input.surfaceId}:${stableTextHash(text)}`,
      surfaceId: input.surfaceId,
      kind: "paragraph",
      text,
      surroundingText,
      sourceRect: rect,
      extraction: {
        method: "point-target",
        status: "complete",
        warnings: [],
      },
    },
  };
}

function buildSurroundingText(block: Element, blockText: string): string | undefined {
  const parent = block.parentElement;
  if (!parent)
    return undefined;
  const parentText = normalizeText(parent.textContent ?? "");
  if (!parentText || parentText === blockText)
    return undefined;
  return clampText(parentText, POINT_TARGET_SURROUNDING_TEXT_LIMIT);
}

function rectForElement(element: Element): ReadingTargetRect | undefined {
  try {
    const rect = (element as Element & { getBoundingClientRect?: () => DOMRect }).getBoundingClientRect?.();
    if (!rect || (rect.width === 0 && rect.height === 0))
      return undefined;
    return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
  } catch {
    return undefined;
  }
}

function normalizeText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function clampText(value: string, maxLength: number): string {
  return value.length > maxLength ? value.slice(0, maxLength).trim() : value;
}

export function stableTextHash(input: string): string {
  let hash = 5381;
  for (let index = 0; index < input.length; index += 1) {
    hash = ((hash << 5) + hash + input.charCodeAt(index)) >>> 0;
  }
  return hash.toString(36);
}
