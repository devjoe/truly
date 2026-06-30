import type { TabId } from "./tabs";

export interface SidepanelTabActivationRuntimeController {
  setActivateTab(activateTab: (tab: TabId) => void): void;
  activateTab(tab: TabId): void;
  activateAnalysisTab(): void;
  activatePageTab(): void;
}

export function createSidepanelTabActivationRuntime(): SidepanelTabActivationRuntimeController {
  let activateTab: ((tab: TabId) => void) | null = null;

  return {
    setActivateTab(nextActivateTab) {
      activateTab = nextActivateTab;
    },
    activateTab(tab) {
      activateTab?.(tab);
    },
    activateAnalysisTab() {
      activateTab?.("analysis");
    },
    activatePageTab() {
      activateTab?.("page");
    },
  };
}
