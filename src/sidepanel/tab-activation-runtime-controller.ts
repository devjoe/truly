import type { TabId } from "./tabs";

export interface SidepanelTabActivationRuntimeController {
  setActivateTab(activateTab: (tab: TabId) => void): void;
  activateAnalysisTab(): void;
}

export function createSidepanelTabActivationRuntime(): SidepanelTabActivationRuntimeController {
  let activateTab: ((tab: TabId) => void) | null = null;

  return {
    setActivateTab(nextActivateTab) {
      activateTab = nextActivateTab;
    },
    activateAnalysisTab() {
      activateTab?.("analysis");
    },
  };
}
