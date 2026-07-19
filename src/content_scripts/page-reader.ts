// General Page Reader content script entry.
//
// This bundle is intentionally not wired into broad manifest injection yet.
// The first runtime slice proves the typed extraction responder without moving
// third-party parsers into runtime or changing install-time permissions.

import { extractGeneralPageSurface, GENERAL_PAGE_MIN_SELECTED_TEXT_LENGTH } from "../lib/general-page-extraction";
import type {
  GeneralPageCandidateBlockTextErrorMsg,
  GeneralPageCandidateBlockTextResultMsg,
  PageReadingErrorMsg,
  PageReadingRequestMsg,
  PageReadingResultMsg,
  ReadingTargetErrorMsg,
  ReadingTargetRequestMsg,
  ReadingTargetResultMsg,
  TrulyMessage,
} from "../lib/messages";
import { isTrulyMessage } from "../lib/messages";
import type { GeneralPageParserAdvisorCandidateBlock } from "../lib/general-page-parser-advisor";
import type { ReadingActivation } from "../lib/reading-action-types";
import type { ReadingTarget, ReadingTargetRect } from "../lib/reading-target-types";
import {
  buildPointReadingTarget,
  isPointerPointFresh,
  type TrackedPointerPoint,
} from "../lib/current-region-targeting";

type PageReadingResponse = PageReadingResultMsg | PageReadingErrorMsg;
type ReadingTargetResponse = ReadingTargetResultMsg | ReadingTargetErrorMsg;
type CandidateBlockTextResponse = GeneralPageCandidateBlockTextResultMsg | GeneralPageCandidateBlockTextErrorMsg;

const CANDIDATE_SELECTOR = [
  "article",
  "main",
  "[role='main']",
  "[role=\"main\"]",
  "section",
  "div[class*=article i]",
  "div[class*=body i]",
  "div[class*=content i]",
  "div[class*=feature i]",
  "div[class*=story i]",
  "div[id*=article i]",
  "div[id*=body i]",
  "div[id*=content i]",
  "div[id*=story i]",
].join(",");

const CANDIDATE_TEXT_PREVIEW_LIMIT = 1200;
const MAX_CANDIDATE_BLOCKS = 8;

export function extractCurrentPageReadingSurface(
  documentRef: Document,
  url: string,
): PageReadingResultMsg {
  return {
    type: "PAGE_READING_RESULT",
    surface: extractGeneralPageSurface({
      document: documentRef,
      url,
    }),
    candidateBlocks: collectGeneralPageCandidateBlocks(documentRef),
  };
}

function cleanText(input: string): string {
  return input.replace(/\s+/g, " ").trim();
}

function candidateRole(element: Element): GeneralPageParserAdvisorCandidateBlock["role"] {
  const tag = element.tagName.toLowerCase();
  if (tag === "article" || tag === "main" || element.getAttribute("role") === "main")
    return "semantic-root";
  return "fallback-block";
}

function candidateLabel(element: Element): string {
  const tag = element.tagName.toLowerCase();
  const id = element.getAttribute("id");
  const className = element.getAttribute("class");
  return [tag, id ? `#${id}` : undefined, className ? `.${className.replace(/\s+/g, ".")}` : undefined]
    .filter(Boolean)
    .join("");
}

export function collectGeneralPageCandidateBlocks(
  documentRef: Document,
): GeneralPageParserAdvisorCandidateBlock[] {
  const candidates: GeneralPageParserAdvisorCandidateBlock[] = [];
  const seenText = new Set<string>();
  let index = 0;
  for (const element of Array.from(documentRef.body?.querySelectorAll(CANDIDATE_SELECTOR) ?? [])) {
    const text = cleanText(element.textContent ?? "");
    if (text.length < 120)
      continue;
    const textKey = text.slice(0, 160);
    if (seenText.has(textKey))
      continue;
    seenText.add(textKey);
    candidates.push({
      id: `block-${index + 1}`,
      label: candidateLabel(element),
      role: candidateRole(element),
      textPreview: text.slice(0, CANDIDATE_TEXT_PREVIEW_LIMIT),
      textLength: text.length,
      linkCount: element.querySelectorAll("a[href]").length,
      imageCount: element.querySelectorAll("img").length,
    });
    index += 1;
    if (candidates.length >= MAX_CANDIDATE_BLOCKS)
      break;
  }
  return candidates;
}

function candidateBlockText(documentRef: Document, blockId: string): string | undefined {
  const candidates = Array.from(documentRef.body?.querySelectorAll(CANDIDATE_SELECTOR) ?? []);
  const seenText = new Set<string>();
  let index = 0;
  for (const element of candidates) {
    const text = cleanText(element.textContent ?? "");
    if (text.length < 120)
      continue;
    const textKey = text.slice(0, 160);
    if (seenText.has(textKey))
      continue;
    seenText.add(textKey);
    index += 1;
    if (`block-${index}` === blockId)
      return text;
    if (index >= MAX_CANDIDATE_BLOCKS)
      break;
  }
  return undefined;
}

function normalizeSelectionText(input: string): string {
  return input.replace(/\s+/g, " ").trim();
}

function stableTextHash(input: string): string {
  let hash = 2166136261;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function selectionRect(selection: Selection): ReadingTargetRect | undefined {
  try {
    if (selection.rangeCount <= 0) return undefined;
    const rect = selection.getRangeAt(0).getBoundingClientRect();
    if (!Number.isFinite(rect.width) || !Number.isFinite(rect.height)) return undefined;
    return {
      x: Math.round(rect.x),
      y: Math.round(rect.y),
      width: Math.round(rect.width),
      height: Math.round(rect.height),
    };
  } catch {
    return undefined;
  }
}

function selectionSurroundingText(selection: Selection, selectedText: string, documentRef: Document): string | undefined {
  const rawScope = selection.rangeCount > 0
    ? selection.getRangeAt(0).commonAncestorContainer.textContent
    : undefined;
  const scopeText = normalizeSelectionText(rawScope || documentRef.body?.textContent || "");
  if (!scopeText || scopeText === selectedText) return undefined;
  const selectedIndex = scopeText.indexOf(selectedText);
  if (selectedIndex < 0) return scopeText.slice(0, 1200);
  const start = Math.max(0, selectedIndex - 360);
  const end = Math.min(scopeText.length, selectedIndex + selectedText.length + 360);
  return scopeText.slice(start, end);
}

export function extractCurrentSelectionTarget(
  documentRef: Document,
  url: string,
  expectedSurfaceId?: string,
): ReadingTargetResultMsg | ReadingTargetErrorMsg {
  const selection = documentRef.getSelection?.();
  const selectedText = normalizeSelectionText(selection?.toString() || "");
  if (selectedText.length < GENERAL_PAGE_MIN_SELECTED_TEXT_LENGTH) {
    return {
      type: "READING_TARGET_ERROR",
      error: "no_meaningful_selection",
    };
  }
  const surface = extractGeneralPageSurface({ document: documentRef, url });
  if (expectedSurfaceId && surface.id !== expectedSurfaceId) {
    return {
      type: "READING_TARGET_ERROR",
      error: "target_stale",
    };
  }
  const target: ReadingTarget = {
    id: `target:selection:${surface.id}:${stableTextHash(selectedText)}`,
    surfaceId: surface.id,
    kind: "selection",
    text: selectedText,
    surroundingText: selection ? selectionSurroundingText(selection, selectedText, documentRef) : undefined,
    sourceRect: selection ? selectionRect(selection) : undefined,
    extraction: {
      method: "selection",
      status: "complete",
      warnings: [],
    },
  };
  return {
    type: "READING_TARGET_RESULT",
    target,
  };
}

function isSupportedPageReadActivation(activation: ReadingActivation | undefined): boolean {
  if (!activation)
    return true;
  return activation.targetKind === "page" && activation.action === "read";
}

export function handlePageReadingMessage(
  message: TrulyMessage,
  documentRef: Document,
  url: string,
): PageReadingResponse | undefined {
  if (message.type === "GET_VERSION") {
    return undefined;
  }
  if (message.type !== "PAGE_READING_REQUEST") {
    return undefined;
  }
  if (!isSupportedPageReadActivation(message.activation)) {
    return {
      type: "PAGE_READING_ERROR",
      requestId: message.requestId,
      error: "page_reading_action_unsupported",
    };
  }
  try {
    return {
      ...extractCurrentPageReadingSurface(documentRef, url),
      requestId: message.requestId,
    };
  } catch (error) {
    return {
      type: "PAGE_READING_ERROR",
      requestId: message.requestId,
      error: error instanceof Error ? error.message.slice(0, 200) : "page_reading_failed",
    };
  }
}

/**
 * Slice 6b: the content script keeps the last meaningful pointer position in
 * memory only. It is never transmitted or stored; it is consumed solely when
 * the user explicitly triggers a current-region read.
 */
export interface PointerTracker {
  point: TrackedPointerPoint | undefined;
}

export function installPointerTracking(
  documentRef: Document,
  now: () => number = Date.now,
): PointerTracker {
  const tracker: PointerTracker = { point: undefined };
  documentRef.addEventListener?.("mousemove", (event) => {
    const mouseEvent = event as MouseEvent;
    tracker.point = { x: mouseEvent.clientX, y: mouseEvent.clientY, ts: now() };
  }, { passive: true });
  return tracker;
}

export function extractCurrentPointTarget(
  documentRef: Document,
  url: string,
  surfaceId: string | undefined,
  tracker: PointerTracker,
  now: () => number = Date.now,
): ReadingTargetResponse {
  if (!isPointerPointFresh(tracker.point, now())) {
    return {
      type: "READING_TARGET_ERROR",
      error: "no_pointer_target",
    };
  }
  const point = tracker.point as TrackedPointerPoint;
  const elementAtPoint = documentRef.elementFromPoint?.(point.x, point.y) ?? null;
  const surface = extractGeneralPageSurface({ document: documentRef, url });
  if (surfaceId && surface.id !== surfaceId) {
    return {
      type: "READING_TARGET_ERROR",
      error: "target_stale",
    };
  }
  const resolution = buildPointReadingTarget({
    surfaceId: surface.id,
    elementAtPoint,
  });
  if (!resolution.ok) {
    return {
      type: "READING_TARGET_ERROR",
      error: resolution.error,
    };
  }
  return {
    type: "READING_TARGET_RESULT",
    target: resolution.target,
  };
}

export function handleReadingTargetMessage(
  message: TrulyMessage,
  documentRef: Document,
  url: string,
  tracker?: PointerTracker,
): ReadingTargetResponse | undefined {
  if (message.type !== "READING_TARGET_REQUEST") {
    return undefined;
  }
  if (message.trigger === "selection" && message.activation?.targetKind === "selection") {
    try {
      return extractCurrentSelectionTarget(documentRef, url, message.surfaceId);
    } catch {
      return {
        type: "READING_TARGET_ERROR",
        error: "target_extraction_failed",
      };
    }
  }
  if (message.trigger === "hotkey" && message.activation?.targetKind === "current-region") {
    if (!tracker) {
      return {
        type: "READING_TARGET_ERROR",
        error: "no_pointer_target",
      };
    }
    try {
      return extractCurrentPointTarget(documentRef, url, message.surfaceId, tracker);
    } catch {
      return {
        type: "READING_TARGET_ERROR",
        error: "target_extraction_failed",
      };
    }
  }
  return {
    type: "READING_TARGET_ERROR",
    error: "reading_target_unsupported",
  };
}

export function handleCandidateBlockTextMessage(
  message: TrulyMessage,
  documentRef: Document,
  url: string,
): CandidateBlockTextResponse | undefined {
  if (message.type !== "GENERAL_PAGE_CANDIDATE_BLOCK_TEXT_REQUEST") {
    return undefined;
  }
  try {
    const surface = extractGeneralPageSurface({ document: documentRef, url });
    if (surface.id !== message.surfaceId) {
      return {
        type: "GENERAL_PAGE_CANDIDATE_BLOCK_TEXT_ERROR",
        surfaceId: message.surfaceId,
        blockId: message.blockId,
        error: "candidate_block_stale",
      };
    }
    const text = candidateBlockText(documentRef, message.blockId);
    if (!text) {
      return {
        type: "GENERAL_PAGE_CANDIDATE_BLOCK_TEXT_ERROR",
        surfaceId: message.surfaceId,
        blockId: message.blockId,
        error: "candidate_block_not_found",
      };
    }
    return {
      type: "GENERAL_PAGE_CANDIDATE_BLOCK_TEXT_RESULT",
      surfaceId: message.surfaceId,
      blockId: message.blockId,
      text,
    };
  } catch {
    return {
      type: "GENERAL_PAGE_CANDIDATE_BLOCK_TEXT_ERROR",
      surfaceId: message.surfaceId,
      blockId: message.blockId,
      error: "candidate_block_extraction_failed",
    };
  }
}

export function installPageReaderRuntime(
  runtime: Pick<typeof chrome.runtime, "onMessage">,
  documentRef: Document,
  urlProvider: () => string,
  buildId: string,
): void {
  const pointerTracker = installPointerTracking(documentRef);
  runtime.onMessage.addListener((message: unknown, _sender, sendResponse) => {
    if (!isTrulyMessage(message))
      return false;

    if (message.type === "GET_VERSION") {
      sendResponse({
        type: "GET_VERSION_RESULT",
        buildId,
        component: "page-reader-content-script",
      } satisfies TrulyMessage);
      return false;
    }

    const url = urlProvider();
    const response = handlePageReadingMessage(message, documentRef, url) ??
      handleReadingTargetMessage(message, documentRef, url, pointerTracker) ??
      handleCandidateBlockTextMessage(message, documentRef, url);
    if (!response)
      return false;

    sendResponse(response);
    return false;
  });
}

const pageReaderGlobal = globalThis as typeof globalThis & {
  __TRULY_PAGE_READER_INSTALLED__?: boolean;
};

if (
  typeof chrome !== "undefined" &&
  chrome.runtime?.onMessage &&
  typeof document !== "undefined" &&
  pageReaderGlobal.__TRULY_PAGE_READER_INSTALLED__ !== true
) {
  pageReaderGlobal.__TRULY_PAGE_READER_INSTALLED__ = true;
  installPageReaderRuntime(chrome.runtime, document, () => location.href, __TRULY_BUILD_ID__);
}
