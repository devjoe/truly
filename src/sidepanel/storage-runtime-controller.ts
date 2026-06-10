import { initializeSidepanelStorageState, type StorageAreaReader, type StorageChangeEvent } from "./storage-state";
import type { UserSettings } from "../lib/types";

export interface SidepanelStorageRuntimeState {
  cachedSettings: UserSettings;
  cachedTierAEndpoint: string;
  cachedTierAModel: string;
  currentViewPostId: string | null;
}

export interface SidepanelStorageRuntime {
  sync: StorageAreaReader;
  local: StorageAreaReader;
  onChanged?: StorageChangeEvent;
}

export interface CreateSidepanelStorageRuntimeControllerOptions {
  storage: SidepanelStorageRuntime;
  state: SidepanelStorageRuntimeState;
  applyDeveloperMode(enabled: boolean): void;
  applyTheme(settings: UserSettings): void;
  renderAnalysisPane(): void;
}

export interface SidepanelStorageRuntimeController {
  initializeStorageState(): void;
}

export function createSidepanelStorageRuntimeController({
  storage,
  state,
  applyDeveloperMode,
  applyTheme,
  renderAnalysisPane,
}: CreateSidepanelStorageRuntimeControllerOptions): SidepanelStorageRuntimeController {
  return {
    initializeStorageState() {
      initializeSidepanelStorageState({
        storageSync: storage.sync,
        storageLocal: storage.local,
        storageOnChanged: storage.onChanged,
        state,
        applyDeveloperMode,
        applyTheme,
        renderAnalysisPane,
      });
    },
  };
}
