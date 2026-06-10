import type { ReadinessFeature, ReadinessRecord, ReadinessSnapshot } from "./readiness";
import { mergeReadinessRecord } from "./readiness";

export const READINESS_STORAGE_KEY = "readinessChecksV1";

export interface ReadinessStorageArea {
  get(keys?: string | string[] | Record<string, unknown> | null): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
  remove(keys: string | string[]): Promise<void>;
}

function defaultStorageArea(): ReadinessStorageArea {
  return chrome.storage.local;
}

function normalizeSnapshot(value: unknown): ReadinessSnapshot {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as ReadinessSnapshot;
}

export async function loadReadinessSnapshot(
  storage: ReadinessStorageArea = defaultStorageArea(),
): Promise<ReadinessSnapshot> {
  const stored = await storage.get(READINESS_STORAGE_KEY);
  return normalizeSnapshot(stored[READINESS_STORAGE_KEY]);
}

export async function saveReadinessSnapshot(
  snapshot: ReadinessSnapshot,
  storage: ReadinessStorageArea = defaultStorageArea(),
): Promise<void> {
  await storage.set({ [READINESS_STORAGE_KEY]: snapshot });
}

export async function saveReadinessRecord(
  record: ReadinessRecord,
  storage: ReadinessStorageArea = defaultStorageArea(),
): Promise<ReadinessSnapshot> {
  const current = await loadReadinessSnapshot(storage);
  const next = mergeReadinessRecord(current, record);
  await saveReadinessSnapshot(next, storage);
  return next;
}

export async function clearReadinessRecords(
  features?: ReadinessFeature[],
  storage: ReadinessStorageArea = defaultStorageArea(),
): Promise<void> {
  if (!features || features.length === 0) {
    await storage.remove(READINESS_STORAGE_KEY);
    return;
  }
  const current = await loadReadinessSnapshot(storage);
  const next = { ...current };
  for (const feature of features) delete next[feature];
  await saveReadinessSnapshot(next, storage);
}
