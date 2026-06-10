import type { TabId } from "./tabs";

export interface InitializeSidepanelBootstrapOptions {
  installTooltips(): void;
  installOptionsPageShortcut(): void;
  initTabs(onActivate: (tab: TabId) => void): (tab: TabId) => void;
  initializeStorageState(): void;
}

export function initializeSidepanelBootstrap({
  installTooltips,
  installOptionsPageShortcut,
  initTabs,
  initializeStorageState,
}: InitializeSidepanelBootstrapOptions): (tab: TabId) => void {
  installTooltips();
  installOptionsPageShortcut();
  const activateTab = initTabs(() => {});
  initializeStorageState();
  return activateTab;
}
