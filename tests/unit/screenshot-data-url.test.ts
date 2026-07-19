import { describe, expect, it } from "vitest";

import { isSupportedScreenshotDataUrl } from "@src/lib/screenshot-data-url";

describe("screenshot data URL allowlist", () => {
  it("allows only raster image data URLs used by Page/Web screenshot recovery", () => {
    expect(isSupportedScreenshotDataUrl("data:image/jpeg;base64,c2NyZWVuc2hvdA==")).toBe(true);
    expect(isSupportedScreenshotDataUrl("data:image/jpg;base64,c2NyZWVuc2hvdA==")).toBe(true);
    expect(isSupportedScreenshotDataUrl("data:image/png;base64,c2NyZWVuc2hvdA==")).toBe(true);
    expect(isSupportedScreenshotDataUrl("data:image/webp;base64,c2NyZWVuc2hvdA==")).toBe(true);

    expect(isSupportedScreenshotDataUrl("data:image/svg+xml;base64,PHN2Zy8+")).toBe(false);
    expect(isSupportedScreenshotDataUrl("data:text/html;base64,PGh0bWw+")).toBe(false);
    expect(isSupportedScreenshotDataUrl("https://example.test/screenshot.jpg")).toBe(false);
    expect(isSupportedScreenshotDataUrl(undefined)).toBe(false);
  });
});
