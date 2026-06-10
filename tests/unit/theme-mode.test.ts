import { describe, expect, it } from "vitest";

import {
  createExtensionThemeController,
  normalizeThemeMode,
  resolvedThemeMode,
} from "@src/lib/theme-mode";

function fakeWindow(prefersDark: boolean): Window {
  return {
    matchMedia: () => ({
      matches: prefersDark,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    }),
  } as unknown as Window;
}

function fakeDocument(): Document {
  return {
    documentElement: {
      dataset: {},
      style: {},
    },
  } as unknown as Document;
}

describe("theme mode", () => {
  it("normalizes unknown stored values to auto", () => {
    expect(normalizeThemeMode("light")).toBe("light");
    expect(normalizeThemeMode("dark")).toBe("dark");
    expect(normalizeThemeMode("unexpected")).toBe("auto");
  });

  it("resolves auto from system preference while respecting explicit modes", () => {
    expect(resolvedThemeMode("auto", fakeWindow(true))).toBe("dark");
    expect(resolvedThemeMode("auto", fakeWindow(false))).toBe("light");
    expect(resolvedThemeMode("light", fakeWindow(true))).toBe("light");
    expect(resolvedThemeMode("dark", fakeWindow(false))).toBe("dark");
  });

  it("applies both stored mode and resolved theme to the document root", () => {
    const documentRef = fakeDocument();
    const controller = createExtensionThemeController(documentRef, fakeWindow(true));

    controller.setMode("auto");

    expect(documentRef.documentElement.dataset.trulyThemeMode).toBe("auto");
    expect(documentRef.documentElement.dataset.trulyTheme).toBe("dark");
    expect(documentRef.documentElement.style.colorScheme).toBe("dark");
    controller.dispose();
  });
});
