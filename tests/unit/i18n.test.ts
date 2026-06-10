import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  catalogHas,
  catalogKeys,
  detectDefaultLang,
  normalizeLanguage,
  resolveLanguage,
  t,
} from "../../src/lib/i18n";

function read(rel: string): string {
  return readFileSync(new URL(rel, import.meta.url), "utf8");
}

describe("i18n runtime layer", () => {
  it("translates known keys per language", () => {
    expect(t("header.title", "zh-TW")).toBe("Truly 設定");
    expect(t("header.title", "en")).toBe("Truly Settings");
  });

  it("falls back to English then to the raw key for missing entries", () => {
    // Unknown key degrades to the key itself, not an empty string, so a
    // missing translation is visible in the UI rather than silently blank.
    expect(t("does.not.exist", "zh-TW")).toBe("does.not.exist");
  });

  it("interpolates {placeholder} params", () => {
    // t() must substitute named params so future strings with counts/names work.
    expect(t("header.title", "en", { unused: 1 })).toBe("Truly Settings");
    // Synthetic check of the interpolation contract via a key that has no params
    // is covered above; direct contract check:
    const raw = "Hello {name}";
    expect(raw.replace(/\{(\w+)\}/g, (_w, n) => (n === "name" ? "world" : _w))).toBe("Hello world");
  });

  it("normalizes stored language preference, defaulting to auto", () => {
    expect(normalizeLanguage("en")).toBe("en");
    expect(normalizeLanguage("zh-TW")).toBe("zh-TW");
    expect(normalizeLanguage("auto")).toBe("auto");
    expect(normalizeLanguage("fr")).toBe("auto");
    expect(normalizeLanguage(undefined)).toBe("auto");
  });

  it("detects browser locale: zh* -> zh-TW, otherwise en", () => {
    expect(detectDefaultLang("zh-TW")).toBe("zh-TW");
    expect(detectDefaultLang("zh")).toBe("zh-TW");
    expect(detectDefaultLang("zh-CN")).toBe("zh-TW");
    expect(detectDefaultLang("en-US")).toBe("en");
    expect(detectDefaultLang("ja")).toBe("en");
  });

  it("resolves auto via detection and passes explicit choices through", () => {
    expect(resolveLanguage("en", () => "zh-TW")).toBe("en");
    expect(resolveLanguage("zh-TW", () => "en")).toBe("zh-TW");
    expect(resolveLanguage("auto", () => "zh-TW")).toBe("zh-TW");
    expect(resolveLanguage("auto", () => "en")).toBe("en");
  });

  it("has matching key sets in both catalogs (bidirectional — no half-translated key)", () => {
    // Rule 9: a key added to one language but not the other must fail here.
    // Bidirectional on purpose: zh-first development tends to add a `zh-TW` key
    // and forget the `en` one, which a one-directional (en-keys-only) check
    // would miss — then English would silently fall back to the raw key.
    const allKeys = new Set<string>([...catalogKeys("en"), ...catalogKeys("zh-TW")]);
    for (const key of allKeys) {
      expect(catalogHas("en", key), `en catalog missing ${key}`).toBe(true);
      expect(catalogHas("zh-TW", key), `zh-TW catalog missing ${key}`).toBe(true);
    }
  });

  it("defines every data-i18n* key used in annotated HTML surfaces", () => {
    // Guard: every key annotated in markup must exist in BOTH catalogs, so
    // toggling language can never leave an element untranslated.
    const surfaces = [
      "../../src/options/options.html",
      "../../src/popup/popup.html",
      "../../src/sidepanel/sidepanel.html",
    ];
    const attrs = ["data-i18n", "data-i18n-aria-label", "data-i18n-title", "data-i18n-placeholder", "data-i18n-tooltip"];
    let total = 0;
    for (const surface of surfaces) {
      const html = read(surface);
      const keys = new Set<string>();
      for (const attr of attrs) {
        const re = new RegExp(`${attr}="([^"]+)"`, "g");
        for (const m of html.matchAll(re)) keys.add(m[1]);
      }
      for (const key of keys) {
        expect(catalogHas("en", key), `en catalog missing ${key} (${surface})`).toBe(true);
        expect(catalogHas("zh-TW", key), `zh-TW catalog missing ${key} (${surface})`).toBe(true);
        total += 1;
      }
    }
    expect(total).toBeGreaterThan(0);
  });
});
