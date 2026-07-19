import { describe, expect, it } from "vitest";

import { classifyPageReadability, classifyPageReadabilityForTab, isGeneralPageReadableUrl } from "@src/lib/page-readability";

describe("page readability classifier", () => {
  it("allows ordinary web pages and routes Facebook separately", () => {
    expect(classifyPageReadability("https://example.test/article")).toEqual({ platform: "general" });
    expect(classifyPageReadability("https://www.facebook.com/")).toEqual({ platform: "facebook" });
    expect(isGeneralPageReadableUrl("https://example.test/article")).toBe(true);
    expect(isGeneralPageReadableUrl("https://www.facebook.com/")).toBe(false);
  });

  it("identifies extension and browser-internal pages as unsupported", () => {
    expect(classifyPageReadability(undefined)).toEqual({
      platform: "unsupported",
      unsupportedKind: "url_unavailable",
    });
    expect(classifyPageReadability("chrome-extension://truly-id/options/options.html", "truly-id")).toEqual({
      platform: "unsupported",
      unsupportedKind: "truly_extension",
    });
    expect(classifyPageReadability("chrome-extension://other-id/options.html", "truly-id")).toEqual({
      platform: "unsupported",
      unsupportedKind: "other_extension",
    });
    expect(classifyPageReadability("chrome://extensions/")).toEqual({
      platform: "unsupported",
      unsupportedKind: "browser_internal",
    });
  });

  it("uses tab title as a conservative fallback when Chrome hides special-page URLs", () => {
    expect(classifyPageReadabilityForTab(undefined, "Truly 設定", "truly-id")).toEqual({
      platform: "unsupported",
      unsupportedKind: "truly_extension",
    });
    expect(classifyPageReadabilityForTab(undefined, "Settings", "truly-id")).toEqual({
      platform: "unsupported",
      unsupportedKind: "browser_internal",
    });
    expect(classifyPageReadabilityForTab(undefined, "Untitled", "truly-id")).toEqual({
      platform: "unsupported",
      unsupportedKind: "url_unavailable",
    });
  });

  it("blocks restricted or special URLs even when they look web-adjacent", () => {
    expect(classifyPageReadability("https://chromewebstore.google.com/detail/truly/abc")).toEqual({
      platform: "unsupported",
      unsupportedKind: "chrome_web_store",
    });
    expect(classifyPageReadability("https://chrome.google.com/webstore/detail/truly/abc")).toEqual({
      platform: "unsupported",
      unsupportedKind: "chrome_web_store",
    });
    expect(classifyPageReadability("file:///tmp/synthetic-report.html")).toEqual({
      platform: "unsupported",
      unsupportedKind: "file",
    });
    expect(classifyPageReadability("data:text/html;base64,PGgxPkhlbGxvPC9oMT4=")).toEqual({
      platform: "unsupported",
      unsupportedKind: "special_scheme",
    });
  });
});
