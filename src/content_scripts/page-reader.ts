// General Page Reader content script entry.
//
// This bundle is intentionally not wired into broad manifest injection yet.
// The first runtime slice proves the typed extraction responder without moving
// third-party parsers into runtime or changing install-time permissions.

import { extractGeneralPageSurface, GENERAL_PAGE_MIN_SELECTED_TEXT_LENGTH } from "../lib/general-page-extraction";
import type {
  PageReadingErrorMsg,
  PageReadingRequestMsg,
  PageReadingResultMsg,
  ReadingTargetErrorMsg,
  ReadingTargetRequestMsg,
  ReadingTargetResultMsg,
  TrulyMessage,
} from "../lib/messages";
import { isTrulyMessage } from "../lib/messages";
import type { ReadingActivation } from "../lib/reading-action-types";
import type { ReadingTarget, ReadingTargetRect } from "../lib/reading-target-types";

type PageReadingResponse = PageReadingResultMsg | PageReadingErrorMsg;
type ReadingTargetResponse = ReadingTargetResultMsg | ReadingTargetErrorMsg;

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
  };
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
      error: "page_reading_action_unsupported",
    };
  }
  try {
    return extractCurrentPageReadingSurface(documentRef, url);
  } catch (error) {
    return {
      type: "PAGE_READING_ERROR",
      error: error instanceof Error ? error.message.slice(0, 200) : "page_reading_failed",
    };
  }
}

export function handleReadingTargetMessage(
  message: TrulyMessage,
  documentRef: Document,
  url: string,
): ReadingTargetResponse | undefined {
  if (message.type !== "READING_TARGET_REQUEST") {
    return undefined;
  }
  if (message.trigger !== "selection" || message.activation?.targetKind !== "selection") {
    return {
      type: "READING_TARGET_ERROR",
      error: "reading_target_unsupported",
    };
  }
  try {
    return extractCurrentSelectionTarget(documentRef, url, message.surfaceId);
  } catch {
    return {
      type: "READING_TARGET_ERROR",
      error: "target_extraction_failed",
    };
  }
}

export function installPageReaderRuntime(
  runtime: Pick<typeof chrome.runtime, "onMessage">,
  documentRef: Document,
  urlProvider: () => string,
  buildId: string,
): void {
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

    const response = handlePageReadingMessage(message, documentRef, urlProvider()) ??
      handleReadingTargetMessage(message, documentRef, urlProvider());
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
