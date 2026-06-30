// General Page Reader content script entry.
//
// This bundle is intentionally not wired into broad manifest injection yet.
// The first runtime slice proves the typed extraction responder without moving
// third-party parsers into runtime or changing install-time permissions.

import { extractGeneralPageSurface } from "../lib/general-page-extraction";
import type {
  PageReadingErrorMsg,
  PageReadingRequestMsg,
  PageReadingResultMsg,
  TrulyMessage,
} from "../lib/messages";
import { isTrulyMessage } from "../lib/messages";

type PageReadingResponse = PageReadingResultMsg | PageReadingErrorMsg;

export function extractCurrentPageReadingSurface(
  documentRef: Document,
  url: string,
): PageReadingResultMsg {
  return {
    type: "PAGE_READING_RESULT",
    surface: extractGeneralPageSurface({
      document: documentRef,
      url,
      selectedText: documentRef.getSelection?.()?.toString(),
    }),
  };
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
  try {
    return extractCurrentPageReadingSurface(documentRef, url);
  } catch (error) {
    return {
      type: "PAGE_READING_ERROR",
      error: error instanceof Error ? error.message.slice(0, 200) : "page_reading_failed",
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

    const response = handlePageReadingMessage(message, documentRef, urlProvider());
    if (!response)
      return false;

    sendResponse(response);
    return false;
  });
}

if (typeof chrome !== "undefined" && chrome.runtime?.onMessage && typeof document !== "undefined") {
  installPageReaderRuntime(chrome.runtime, document, () => location.href, __TRULY_BUILD_ID__);
}
