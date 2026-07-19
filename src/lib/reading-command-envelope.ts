import {
  isReadingActivation,
  type ReadingActivation,
} from "./reading-action-types";

export const PENDING_PAGE_READING_COMMAND_KEY = "pendingPageReadingCommandV1";
export const PAGE_READING_COMMAND_MAX_AGE_MS = 30_000;
const PAGE_READING_COMMAND_FUTURE_TOLERANCE_MS = 5_000;

export interface ReadingCommandEnvelope {
  version: 1;
  requestId: string;
  tabId: number;
  url: string;
  activation: ReadingActivation;
  createdAt: number;
}

export function createReadingRequestId(
  randomUuid: () => string = () => globalThis.crypto.randomUUID(),
): string {
  return `page-read:${randomUuid()}`;
}

export function createReadingCommandEnvelope(input: Omit<ReadingCommandEnvelope, "version">): ReadingCommandEnvelope {
  const envelope = parseReadingCommandEnvelope({ version: 1, ...input }, input.createdAt);
  if (!envelope) throw new Error("invalid_reading_command_envelope");
  return envelope;
}

export function parseReadingCommandEnvelope(
  value: unknown,
  nowMs: number,
): ReadingCommandEnvelope | undefined {
  if (!value || typeof value !== "object") return undefined;
  const candidate = value as Partial<ReadingCommandEnvelope>;
  if (candidate.version !== 1) return undefined;
  if (typeof candidate.requestId !== "string" || !/^page-read:[A-Za-z0-9._:-]{8,200}$/.test(candidate.requestId)) return undefined;
  const tabId = candidate.tabId;
  if (typeof tabId !== "number" || !Number.isInteger(tabId) || tabId < 0) return undefined;
  if (typeof candidate.url !== "string" || candidate.url.length === 0 || candidate.url.length > 4096) return undefined;
  if (!isReadingActivation(candidate.activation)) return undefined;
  if (candidate.activation.targetKind !== "page" || candidate.activation.action !== "read") return undefined;
  if (typeof candidate.createdAt !== "number" || !Number.isFinite(candidate.createdAt)) return undefined;
  const age = nowMs - candidate.createdAt;
  if (age > PAGE_READING_COMMAND_MAX_AGE_MS || age < -PAGE_READING_COMMAND_FUTURE_TOLERANCE_MS) return undefined;
  return {
    version: 1,
    requestId: candidate.requestId,
    tabId,
    url: candidate.url,
    activation: candidate.activation,
    createdAt: candidate.createdAt,
  };
}
