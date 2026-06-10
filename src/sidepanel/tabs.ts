export type TabId = "analysis" | "settings";

const STORAGE_KEY = "truly-active-tab";
const VALID: readonly TabId[] = ["analysis"] as const;

function isTabId(x: unknown): x is TabId {
  return typeof x === "string" && (VALID as readonly string[]).includes(x);
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
    const panel = panels.find((p) => p.dataset.tab === tab);
    if (!panel) continue;
    if (!btn.id) btn.id = `tab-${tab}`;
    if (!panel.id) panel.id = `${tab}-panel`;
    btn.setAttribute("aria-controls", panel.id);
    panel.setAttribute("aria-labelledby", btn.id);
  }

  function visibleButtons(): HTMLButtonElement[] {
    return buttons.filter((btn) => {
      if (btn.hidden || btn.getAttribute("aria-hidden") === "true") return false;
      return getComputedStyle(btn).display !== "none";
    });
  }

  function activate(tab: TabId): void {
    if (!isTabId(tab)) tab = "analysis";
    const targetButton = buttons.find((btn) => btn.dataset.tab === tab);
    if (!targetButton || targetButton.hidden || targetButton.getAttribute("aria-hidden") === "true") {
      tab = "analysis";
    }
    for (const btn of buttons) {
      const match = btn.dataset.tab === tab;
      btn.setAttribute("aria-selected", match ? "true" : "false");
      if (match) btn.tabIndex = 0;
      else btn.tabIndex = -1;
    }
    for (const panel of panels) {
      const match = panel.dataset.tab === tab;
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
      const tab = btn.dataset.tab;
      if (isTabId(tab)) activate(tab);
    });
    btn.addEventListener("keydown", (e) => {
      if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
      e.preventDefault();
      const available = visibleButtons();
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
