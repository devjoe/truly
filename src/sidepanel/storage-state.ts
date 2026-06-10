import { normalizeUserSettings } from "../lib/settings";
import type { UserSettings } from "../lib/types";
import { DEFAULT_TIER_A_ENDPOINT, DEFAULT_TIER_A_MODEL } from "./state";

interface SidepanelStorageState {
  cachedSettings: UserSettings;
  cachedTierAEndpoint: string;
  cachedTierAModel: string;
  currentViewPostId: string | null;
}

export interface StorageAreaReader {
  get(keys: string[], callback: (result: Record<string, unknown>) => void): unknown;
}

interface StorageChange {
  newValue?: unknown;
}

export interface StorageChangeEvent {
  addListener?(listener: (changes: Record<string, StorageChange>, areaName: string) => void): void;
}

export interface RefreshTierAConfigOptions {
  storageLocal: StorageAreaReader;
  state: Pick<SidepanelStorageState, "cachedTierAEndpoint" | "cachedTierAModel">;
}

export interface InitializeSidepanelStorageStateOptions {
  storageSync: StorageAreaReader;
  storageLocal: StorageAreaReader;
  storageOnChanged?: StorageChangeEvent;
  state: SidepanelStorageState;
  applyDeveloperMode(enabled: boolean): void;
  applyTheme?(settings: UserSettings): void;
  renderAnalysisPane(): void;
}

export function refreshSidepanelTierAConfig({
  storageLocal,
  state,
}: RefreshTierAConfigOptions): void {
  storageLocal.get(["ollamaEndpoint", "ollamaModel"], (stored) => {
    state.cachedTierAEndpoint = (stored.ollamaEndpoint as string) || DEFAULT_TIER_A_ENDPOINT;
    state.cachedTierAModel = (stored.ollamaModel as string) || DEFAULT_TIER_A_MODEL;
  });
}

export function initializeSidepanelStorageState({
  storageSync,
  storageLocal,
  storageOnChanged,
  state,
  applyDeveloperMode,
  applyTheme,
  renderAnalysisPane,
}: InitializeSidepanelStorageStateOptions): void {
  refreshSidepanelTierAConfig({ storageLocal, state });

  storageSync.get(["settings"], (result) => {
    state.cachedSettings = normalizeUserSettings(result.settings as Partial<UserSettings> | undefined);
    applyDeveloperMode(state.cachedSettings.developerMode === true);
    applyTheme?.(state.cachedSettings);
    if (state.currentViewPostId) renderAnalysisPane();
  });

  storageOnChanged?.addListener?.((changes, areaName) => {
    if (areaName !== "local") return;
    if (typeof changes.ollamaEndpoint?.newValue === "string") {
      state.cachedTierAEndpoint = changes.ollamaEndpoint.newValue;
    }
    if (typeof changes.ollamaModel?.newValue === "string") {
      state.cachedTierAModel = changes.ollamaModel.newValue;
    }
  });
}
