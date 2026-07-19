import type {
  GeneralPageCandidateBlockTextErrorMsg,
  GeneralPageCandidateBlockTextRequestMsg,
  GeneralPageCandidateBlockTextResultMsg,
  PageReadingErrorMsg,
  PageReadingRequestMsg,
  PageReadingResultMsg,
  ReadingTargetErrorMsg,
  ReadingTargetRequestMsg,
  ReadingTargetResultMsg,
  TrulyMessage,
} from "../lib/messages";

type PageReply = PageReadingResultMsg | PageReadingErrorMsg;
type TargetReply = ReadingTargetResultMsg | ReadingTargetErrorMsg;
type CandidateReply = GeneralPageCandidateBlockTextResultMsg | GeneralPageCandidateBlockTextErrorMsg;

interface ScriptingLike {
  executeScript(details: { target: { tabId: number }; files: string[] }): Promise<unknown>;
}

interface TabsLike {
  sendMessage(tabId: number, message: TrulyMessage): Promise<unknown>;
}

export interface PageReaderTabTransport {
  requestPage(message: PageReadingRequestMsg): Promise<PageReply>;
  requestTarget(message: ReadingTargetRequestMsg): Promise<TargetReply>;
  requestCandidateBlock(message: GeneralPageCandidateBlockTextRequestMsg): Promise<CandidateReply>;
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isGrantMissing(error: unknown): boolean {
  return errorText(error).includes("Cannot access contents of the page");
}

function isPageReply(value: unknown): value is PageReply {
  return !!value && typeof value === "object" &&
    ((value as { type?: unknown }).type === "PAGE_READING_RESULT" ||
      (value as { type?: unknown }).type === "PAGE_READING_ERROR");
}

function isTargetReply(value: unknown): value is TargetReply {
  return !!value && typeof value === "object" &&
    ((value as { type?: unknown }).type === "READING_TARGET_RESULT" ||
      (value as { type?: unknown }).type === "READING_TARGET_ERROR");
}

function isCandidateReply(value: unknown): value is CandidateReply {
  return !!value && typeof value === "object" &&
    ((value as { type?: unknown }).type === "GENERAL_PAGE_CANDIDATE_BLOCK_TEXT_RESULT" ||
      (value as { type?: unknown }).type === "GENERAL_PAGE_CANDIDATE_BLOCK_TEXT_ERROR");
}

export function createPageReaderTabTransport({
  scripting,
  tabs,
  expectedBuildId,
  now = Date.now,
}: {
  scripting: ScriptingLike;
  tabs: TabsLike;
  expectedBuildId: string;
  now?(): number;
}): PageReaderTabTransport {
  async function ensurePageReader(tabId: number): Promise<void> {
    const current = await tabs.sendMessage(tabId, { type: "GET_VERSION" }).catch(() => undefined);
    const ready = !!current && typeof current === "object" &&
      (current as { type?: unknown }).type === "GET_VERSION_RESULT" &&
      (current as { component?: unknown }).component === "page-reader-content-script" &&
      (current as { buildId?: unknown }).buildId === expectedBuildId;
    if (ready) return;
    await scripting.executeScript({
      target: { tabId },
      files: ["content_scripts/page-reader.js"],
    });
  }

  return {
    async requestPage(message) {
      const startedAt = now();
      const tabId = message.tabId;
      if (typeof tabId !== "number") {
        return {
          type: "PAGE_READING_ERROR",
          requestId: message.requestId,
          error: "page_reading_missing_tab_id",
        };
      }
      try {
        if (message.inject === true) await ensurePageReader(tabId);
        const reply = await tabs.sendMessage(tabId, {
          type: "PAGE_READING_REQUEST",
          requestId: message.requestId,
          activation: message.activation,
        });
        if (!isPageReply(reply)) {
          return {
            type: "PAGE_READING_ERROR",
            requestId: message.requestId,
            tabId,
            elapsedMs: now() - startedAt,
            error: "page_reader_invalid_response",
          };
        }
        return {
          ...reply,
          requestId: message.requestId ?? reply.requestId,
          tabId,
          elapsedMs: now() - startedAt,
        };
      } catch (error) {
        return {
          type: "PAGE_READING_ERROR",
          requestId: message.requestId,
          tabId,
          elapsedMs: now() - startedAt,
          error: isGrantMissing(error)
            ? "page_grant_missing"
            : errorText(error).slice(0, 200) || "page_reader_unavailable",
        };
      }
    },

    async requestTarget(message) {
      const { tabId } = message;
      try {
        await ensurePageReader(tabId);
        const reply = await tabs.sendMessage(tabId, message);
        return isTargetReply(reply)
          ? { ...reply, tabId }
          : { type: "READING_TARGET_ERROR", tabId, error: "target_extraction_failed" };
      } catch (error) {
        return {
          type: "READING_TARGET_ERROR",
          tabId,
          error: isGrantMissing(error) ? "page_grant_missing" : "target_extraction_failed",
        };
      }
    },

    async requestCandidateBlock(message) {
      const { tabId } = message;
      try {
        await ensurePageReader(tabId);
        const reply = await tabs.sendMessage(tabId, message);
        return isCandidateReply(reply)
          ? { ...reply, tabId }
          : {
              type: "GENERAL_PAGE_CANDIDATE_BLOCK_TEXT_ERROR",
              tabId,
              surfaceId: message.surfaceId,
              blockId: message.blockId,
              error: "candidate_block_extraction_failed",
            };
      } catch (error) {
        return {
          type: "GENERAL_PAGE_CANDIDATE_BLOCK_TEXT_ERROR",
          tabId,
          surfaceId: message.surfaceId,
          blockId: message.blockId,
          error: isGrantMissing(error) ? "page_grant_missing" : "candidate_block_extraction_failed",
        };
      }
    },
  };
}
