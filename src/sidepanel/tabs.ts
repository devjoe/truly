export type TabId = "analysis" | "page" | "focus" | "settings";

const STORAGE_KEY = "truly-active-tab";
const VALID: readonly TabId[] = ["analysis", "page", "focus"] as const;

function isTabId(x: unknown): x is TabId {
  return typeof x === "string" && (VALID as readonly string[]).includes(x);
}

/** Update a tab's contextual availability. Returns whether the tab was selected
 * when it became unavailable so the caller can move users to the appropriate
 * surface without disturbing a still-valid selection such as Focus. */
export function setTabAvailability(tab: TabId, available: boolean, reason = ""): boolean {
  const button = document.querySelector<HTMLButtonElement>(`.tab[data-tab='${tab}']`);
  if (!button) return false;
  if (available) {
    button.removeAttribute("aria-disabled");
    button.removeAttribute("aria-label");
    button.removeAttribute("data-tooltip");
    return false;
  }
  const wasSelected = button.getAttribute("aria-selected") === "true";
  const label = button.textContent?.trim() || tab;
  button.setAttribute("aria-disabled", "true");
  button.setAttribute("aria-label", reason ? `${label} — ${reason}` : label);
  if (reason) button.dataset.tooltip = reason;
  else button.removeAttribute("data-tooltip");
  return wasSelected;
}

/** Read the stored tab id, migrating the legacy `"feed"` value (used
 *  before the 2026-04-29 sidepanel-analysis-tab redesign) to
 *  `"analysis"` so users with a stored selection don't lose context. */
function readStoredTab(): TabId | null {
  try {
    const v = sessionStorage.getItem(STORAGE_KEY);
    if (v === "feed" || v === "debug" || v === "settings") return "analysis";
    if (isTabId(v)) return v;
  } catch {
    /* ignore */
  }
  return null;
}

/** Initialize the sidepanel view switcher. Reads `sessionStorage` for the last
 *  active tab (default `feed`), wires click + ArrowLeft/ArrowRight handlers, and
 *  calls `onActivate` synchronously with the initial tab plus on every
 *  subsequent switch. Returns the activation function so the caller can
 *  trigger tab changes programmatically (e.g., from an external message). */
export function initTabs(
  onActivate: (tab: TabId) => void
): (tab: TabId) => void {
  const bar = document.querySelector<HTMLElement>(".tab-bar");
  if (!bar) {
    const panel = document.querySelector<HTMLElement>("[data-tab='analysis'][role='tabpanel']");
    panel?.removeAttribute("hidden");
    try {
      sessionStorage.setItem(STORAGE_KEY, "analysis");
    } catch {
      /* sessionStorage may be unavailable in tests */
    }
    onActivate("analysis");
    return () => {
      panel?.removeAttribute("hidden");
      try {
        sessionStorage.setItem(STORAGE_KEY, "analysis");
      } catch {
        /* sessionStorage may be unavailable in tests */
      }
      onActivate("analysis");
    };
  }
  const buttons = Array.from(bar.querySelectorAll<HTMLButtonElement>(".tab"));
  const panels = Array.from(
    document.querySelectorAll<HTMLElement>("[role='tabpanel']")
  );

  for (const btn of buttons) {
    const tab = btn.dataset.tab;
    if (!isTabId(tab)) continue;
    const panelTab = btn.dataset.panelTab || tab;
    const panel = panels.find((p) => p.dataset.tab === panelTab);
    if (!panel) continue;
    if (!btn.id) btn.id = `tab-${tab}`;
    if (!panel.id) panel.id = `${tab}-panel`;
    btn.setAttribute("aria-controls", panel.id);
    panel.setAttribute("aria-labelledby", btn.id);
  }

  function availableButtons(): HTMLButtonElement[] {
    return buttons.filter((btn) => {
      if (btn.hidden || btn.getAttribute("aria-hidden") === "true") return false;
      if (btn.getAttribute("aria-disabled") === "true") return false;
      return getComputedStyle(btn).display !== "none";
    });
  }

  function activate(tab: TabId): void {
    if (!isTabId(tab)) tab = "analysis";
    const targetButton = buttons.find((btn) => btn.dataset.tab === tab);
    if (
      !targetButton ||
      targetButton.hidden ||
      targetButton.getAttribute("aria-hidden") === "true" ||
      targetButton.getAttribute("aria-disabled") === "true"
    ) {
      const firstAvailableTab = availableButtons()[0]?.dataset.tab;
      tab = isTabId(firstAvailableTab) ? firstAvailableTab : "analysis";
    }
    for (const btn of buttons) {
      const match = btn.dataset.tab === tab;
      btn.setAttribute("aria-selected", match ? "true" : "false");
      if (match) btn.tabIndex = 0;
      else btn.tabIndex = -1;
    }
    const activePanelTab = buttons.find((btn) => btn.dataset.tab === tab)?.dataset.panelTab || tab;
    for (const panel of panels) {
      const match = panel.dataset.tab === activePanelTab;
      if (match) panel.removeAttribute("hidden");
      else panel.setAttribute("hidden", "");
    }
    try {
      sessionStorage.setItem(STORAGE_KEY, tab);
    } catch {
      /* sessionStorage may be unavailable in tests */
    }
    onActivate(tab);
  }

  for (const btn of buttons) {
    btn.addEventListener("click", () => {
      if (btn.getAttribute("aria-disabled") === "true") return;
      const tab = btn.dataset.tab;
      if (isTabId(tab)) activate(tab);
    });
    btn.addEventListener("keydown", (e) => {
      if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
      e.preventDefault();
      const available = availableButtons();
      const idx = available.indexOf(btn);
      if (idx < 0) return;
      const next =
        e.key === "ArrowRight"
          ? available[(idx + 1) % available.length]
          : available[(idx - 1 + available.length) % available.length];
      next.focus();
      const tab = next.dataset.tab;
      if (isTabId(tab)) activate(tab);
    });
  }

  // Restore — default to `analysis` on first open.
  const initial: TabId = readStoredTab() ?? "analysis";
  activate(initial);
  return activate;
}

export function getStoredTab(): TabId {
  return readStoredTab() ?? "analysis";
}

export function shouldShowPageReadCurrentAction(tab: TabId): boolean {
  return tab === "page";
}
