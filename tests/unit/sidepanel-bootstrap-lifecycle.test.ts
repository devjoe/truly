import { describe, expect, it, vi } from "vitest";

import { initializeSidepanelBootstrap } from "@src/sidepanel/bootstrap-lifecycle";
import { initializeSidepanelStorageState } from "@src/sidepanel/storage-state";
import { DEFAULT_SETTINGS } from "@src/lib/types";

describe("sidepanel bootstrap lifecycle", () => {
  it("starts the Page runtime only after stored language settings are applied", async () => {
    let resolveStorage: (() => void) | undefined;
    const storageReady = new Promise<void>((resolve) => {
      resolveStorage = resolve;
    });
    const onStorageReady = vi.fn();
    const activateTab = vi.fn();

    const result = initializeSidepanelBootstrap({
      installTooltips: vi.fn(),
      installOptionsPageShortcut: vi.fn(),
      initTabs: vi.fn(() => activateTab),
      initializeStorageState: vi.fn(() => storageReady),
      onStorageReady,
    });

    expect(result).toBe(activateTab);
    expect(onStorageReady).not.toHaveBeenCalled();

    resolveStorage?.();
    await storageReady;
    await Promise.resolve();

    expect(onStorageReady).toHaveBeenCalledTimes(1);
  });

  it("resolves storage readiness from the sync settings callback", async () => {
    let settingsCallback: ((result: Record<string, unknown>) => void) | undefined;
    const state = {
      cachedSettings: DEFAULT_SETTINGS,
      cachedTierAEndpoint: "",
      cachedTierAModel: "",
      currentViewPostId: null,
    };
    const applyDeveloperMode = vi.fn();
    const applyTheme = vi.fn();

    const ready = initializeSidepanelStorageState({
      storageSync: {
        get: vi.fn((_keys, callback) => {
          settingsCallback = callback;
        }),
      },
      storageLocal: {
        get: vi.fn((_keys, callback) => callback({})),
      },
      state,
      applyDeveloperMode,
      applyTheme,
      renderAnalysisPane: vi.fn(),
    });

    let settled = false;
    void ready.then(() => {
      settled = true;
    });
    await Promise.resolve();
    expect(settled).toBe(false);

    settingsCallback?.({ settings: { ...DEFAULT_SETTINGS, language: "zh-TW" } });
    await ready;

    expect(settled).toBe(true);
    expect(applyDeveloperMode).toHaveBeenCalledTimes(1);
    expect(applyTheme).toHaveBeenCalledWith(expect.objectContaining({ language: "zh-TW" }));
  });
});
