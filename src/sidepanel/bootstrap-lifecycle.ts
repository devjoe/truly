import type { TabId } from "./tabs";

export interface InitializeSidepanelBootstrapOptions {
  installTooltips(): void;
  installOptionsPageShortcut(): void;
  initTabs(onActivate: (tab: TabId) => void): (tab: TabId) => void;
  initializeStorageState(): void | Promise<void>;
  onStorageReady?(): void;
}

export function initializeSidepanelBootstrap({
  installTooltips,
  installOptionsPageShortcut,
  initTabs,
  initializeStorageState,
  onStorageReady,
}: InitializeSidepanelBootstrapOptions): (tab: TabId) => void {
  installTooltips();
  installOptionsPageShortcut();
  const activateTab = initTabs(() => {});
  void Promise.resolve(initializeStorageState()).then(() => onStorageReady?.());
  return activateTab;
}
