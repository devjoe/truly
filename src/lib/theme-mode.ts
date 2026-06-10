import type { ThemeMode } from "./types";

export function normalizeThemeMode(mode: unknown): ThemeMode {
  return mode === "light" || mode === "dark" || mode === "auto" ? mode : "auto";
}

function prefersDark(windowRef: Window): boolean {
  return windowRef.matchMedia?.("(prefers-color-scheme: dark)").matches === true;
}

export function resolvedThemeMode(mode: ThemeMode, windowRef: Window = window): "light" | "dark" {
  if (mode === "dark") return "dark";
  if (mode === "light") return "light";
  return prefersDark(windowRef) ? "dark" : "light";
}

export interface ExtensionThemeController {
  setMode(mode: ThemeMode): void;
  dispose(): void;
}

export function createExtensionThemeController(
  documentRef: Document = document,
  windowRef: Window = window,
): ExtensionThemeController {
  let currentMode: ThemeMode = "auto";
  const media = windowRef.matchMedia?.("(prefers-color-scheme: dark)");

  const apply = () => {
    const mode = normalizeThemeMode(currentMode);
    const resolved = resolvedThemeMode(mode, windowRef);
    documentRef.documentElement.dataset.trulyThemeMode = mode;
    documentRef.documentElement.dataset.trulyTheme = resolved;
    documentRef.documentElement.style.colorScheme = resolved;
  };

  const handleChange = () => {
    if (currentMode === "auto") apply();
  };

  media?.addEventListener?.("change", handleChange);

  return {
    setMode(mode: ThemeMode) {
      currentMode = normalizeThemeMode(mode);
      apply();
    },
    dispose() {
      media?.removeEventListener?.("change", handleChange);
    },
  };
}
