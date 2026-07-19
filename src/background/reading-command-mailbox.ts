import type {
  QueuePageReadingCommandMsg,
  QueuePageReadingCommandResultMsg,
  ReadingCommandAvailableMsg,
} from "../lib/messages";
import {
  PENDING_PAGE_READING_COMMAND_KEY,
  parseReadingCommandEnvelope,
} from "../lib/reading-command-envelope";

interface MessageSenderLike {
  id?: string;
  url?: string;
  documentUrl?: string;
}

interface SessionStorageLike {
  set(items: Record<string, unknown>): Promise<unknown>;
}

export interface QueueReadingCommandOptions {
  message: QueuePageReadingCommandMsg;
  sender: MessageSenderLike;
  extensionId: string;
  storage: SessionStorageLike;
  notify(message: ReadingCommandAvailableMsg): Promise<unknown>;
  now(): number;
}

export function isTrustedExtensionSender(sender: MessageSenderLike, extensionId: string): boolean {
  if (!extensionId || sender.id !== extensionId) return false;
  const senderUrl = sender.url || sender.documentUrl;
  return !senderUrl || senderUrl.startsWith(`chrome-extension://${extensionId}/`);
}

export async function queueReadingCommand({
  message,
  sender,
  extensionId,
  storage,
  notify,
  now,
}: QueueReadingCommandOptions): Promise<QueuePageReadingCommandResultMsg> {
  if (!isTrustedExtensionSender(sender, extensionId)) {
    return {
      type: "QUEUE_PAGE_READING_COMMAND_RESULT",
      requestId: message.envelope?.requestId || "",
      ok: false,
      error: "untrusted_reading_command_sender",
    };
  }
  const envelope = parseReadingCommandEnvelope(message.envelope, now());
  if (!envelope) {
    return {
      type: "QUEUE_PAGE_READING_COMMAND_RESULT",
      requestId: message.envelope?.requestId || "",
      ok: false,
      error: "invalid_reading_command_envelope",
    };
  }
  await storage.set({ [PENDING_PAGE_READING_COMMAND_KEY]: envelope });
  await notify({
    type: "READING_COMMAND_AVAILABLE",
    requestId: envelope.requestId,
    tabId: envelope.tabId,
  }).catch(() => {});
  return {
    type: "QUEUE_PAGE_READING_COMMAND_RESULT",
    requestId: envelope.requestId,
    ok: true,
  };
}
