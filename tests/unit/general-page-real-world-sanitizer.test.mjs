import { describe, expect, it } from "vitest";

import { sanitizeEngineResult } from "../../scripts/evaluate-general-page-real-world.mjs";

describe("General Page real-world eval sanitizer", () => {
  it("does not serialize private URLs, raw text, previews, excerpts, or expected snippets", () => {
    const privateUrl = "https://private-source.example.test/hidden/story";
    const privateText = "Sensitive article paragraph that must never appear in the private eval report.";
    const privateExcerpt = "Sensitive excerpt copied from a source page.";
    const privatePreview = "Sensitive preview copied from a source page.";
    const expectedContains = "paragraph that must never appear";
    const expectedExclude = "private forbidden snippet";

    const sanitized = sanitizeEngineResult("truly-heuristic", {
      ok: true,
      durationMs: 12.345,
      title: "Private Source Title",
      author: "Private Author",
      siteName: "Private Site",
      publishedAt: "2026-06-30T00:00:00Z",
      text: `${privateText} ${expectedContains}`,
      excerpt: privateExcerpt,
      textPreview: privatePreview,
      diagnostics: {
        url: privateUrl,
        textPreview: privatePreview,
        extraction: {
          method: "semantic-html",
          status: "complete",
          warnings: [],
        },
      },
      extractionStatus: "complete",
      extractionWarnings: [],
    }, {
      pageType: "article",
      expectedContains: [expectedContains],
      expectedExcludes: [expectedExclude],
    });

    const serialized = JSON.stringify(sanitized);

    expect(sanitized).toMatchObject({
      engine: "truly-heuristic",
      ok: true,
      textLength: expect.any(Number),
      expectedContainsHitCount: 1,
      expectedContainsTotal: 1,
      expectedExcludeLeakCount: 0,
    });
    expect(serialized).not.toContain(privateUrl);
    expect(serialized).not.toContain(privateText);
    expect(serialized).not.toContain(privateExcerpt);
    expect(serialized).not.toContain(privatePreview);
    expect(serialized).not.toContain(expectedContains);
    expect(serialized).not.toContain(expectedExclude);
    expect(serialized).not.toContain("Private Source Title");
    expect(serialized).not.toContain("Private Author");
    expect(serialized).not.toContain("Private Site");
  });
});
