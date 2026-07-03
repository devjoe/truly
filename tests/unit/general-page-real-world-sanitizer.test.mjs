import { describe, expect, it } from "vitest";

import { sanitizeEngineResult } from "../../scripts/evaluate-general-page-real-world.mjs";
import {
  assertPublicSmokeSummary,
  evaluateSmokeThreshold,
  parseCurrentBrowserSmokeArgs,
  renderSmokeSummaryMarkdown,
} from "../../scripts/smoke-general-page-current.mjs";

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

describe("General Page current-browser smoke summary", () => {
  const safeSummary = {
    selectedPages: [
      {
        titleLength: 42,
        host: "example.test",
      },
    ],
    artifact: {
      targetPath: "tmp/general-page-product-quality/current-browser-target-test.json",
      outputDir: "tmp/general-page-product-quality/current-browser-review-test",
      summaryJsonPath: "tmp/general-page-product-quality/current-browser-review-test/current-browser-smoke-summary.json",
      summaryMarkdownPath: "tmp/general-page-product-quality/current-browser-review-test/current-browser-smoke-summary.md",
    },
    sourceMode: "cdp",
    aggregate: {
      byReadiness: {
        caution: 1,
      },
    },
    results: [
      {
        host: "example.test",
        ok: true,
        category: "unit-smoke",
        pageType: "open-tab",
        textLength: 512,
        extraction: {
          method: "semantic-html",
          status: "partial",
          warnings: ["large-navigation-noise"],
        },
        linkCount: 3,
        imageCount: 0,
        modelReadiness: "caution",
        modelEligible: true,
        qualityIssues: ["partial_extraction"],
        modelTextLength: 512,
        modelLinkCount: 2,
        imageAltCount: 0,
        suggestedVerdict: "usable_with_caution",
        issueTags: ["partial", "warning:large-navigation-noise"],
      },
    ],
  };

  it("accepts only public-safe smoke summary metadata", () => {
    expect(() => assertPublicSmokeSummary(safeSummary)).not.toThrow();
  });

  it("rejects private summary fields and URL-like strings", () => {
    expect(() => assertPublicSmokeSummary({
      ...safeSummary,
      results: [
        {
          ...safeSummary.results[0],
          url: "https://private-source.example.test/story",
        },
      ],
    })).toThrow(/private field/);

    expect(() => assertPublicSmokeSummary({
      ...safeSummary,
      results: [
        {
          ...safeSummary.results[0],
          sourceLabel: "https://private-source.example.test/story",
        },
      ],
    })).toThrow(/private-looking string/);

    expect(() => assertPublicSmokeSummary({
      ...safeSummary,
      results: [
        {
          ...safeSummary.results[0],
          sourceLabel: "<!doctype html><html><body>private</body></html>",
        },
      ],
    })).toThrow(/private-looking string/);
  });

  it("keeps smoke label arguments public-safe before CDP access", () => {
    expect(parseCurrentBrowserSmokeArgs(["--category", "open-tabs:summary_01"]).category)
      .toBe("open-tabs:summary_01");
    expect(() => parseCurrentBrowserSmokeArgs(["--category", "https://example.test"]))
      .toThrow(/public-safe label/);
    expect(parseCurrentBrowserSmokeArgs([
      "--min-page-count", "4",
      "--max-error-count", "0",
      "--max-empty-or-blocked-count", "1",
      "--fail-on-issue-tag", "quality:large_navigation_noise,warning:no-main-content",
    ])).toMatchObject({
      minPageCount: 4,
      maxErrorCount: 0,
      maxEmptyOrBlockedCount: 1,
      failOnIssueTags: ["quality:large_navigation_noise", "warning:no-main-content"],
    });
    expect(() => parseCurrentBrowserSmokeArgs(["--fail-on-issue-tag", "https://example.test"]))
      .toThrow(/public-safe issue tags/);
    expect(() => parseCurrentBrowserSmokeArgs(["--category", "--all-open"]))
      .toThrow(/requires a value/);
    expect(() => parseCurrentBrowserSmokeArgs(["--fail-on-issue-tag", "--all-open"]))
      .toThrow(/requires a value/);
  });

  it("evaluates current-browser smoke thresholds without private page data", () => {
    const report = {
      aggregate: {
        errorCount: 1,
        emptyOrBlockedCount: 1,
      },
      results: [
        {
          ok: true,
          modelContext: { modelReadiness: "ready" },
          autoReview: { issueTags: ["complete"] },
        },
        {
          ok: true,
          modelContext: { modelReadiness: "caution" },
          autoReview: { issueTags: ["quality:large_navigation_noise"] },
        },
        {
          ok: false,
          surface: { extraction: { status: "empty" } },
          autoReview: { issueTags: ["empty"] },
        },
      ],
    };

    expect(evaluateSmokeThreshold(report, {
      minPageCount: 3,
      maxReadyCount: 1,
      maxErrorCount: 1,
      maxEmptyOrBlockedCount: 1,
      failOnIssueTags: [],
    })).toMatchObject({
      pass: true,
      failures: [],
      counts: {
        pageCount: 3,
        readyCount: 1,
        errorCount: 1,
        emptyOrBlockedCount: 1,
      },
    });

    expect(evaluateSmokeThreshold(report, {
      minPageCount: 4,
      maxReadyCount: 0,
      maxErrorCount: 0,
      maxEmptyOrBlockedCount: 0,
      failOnIssueTags: ["quality:large_navigation_noise"],
    })).toMatchObject({
      pass: false,
      failures: [
        "pageCount=3 < minPageCount=4",
        "readyCount=1 > maxReadyCount=0",
        "errorCount=1 > maxErrorCount=0",
        "emptyOrBlockedCount=1 > maxEmptyOrBlockedCount=0",
        "issueTag=quality:large_navigation_noise hit 1",
      ],
    });
  });

  it("renders extraction metadata readably in markdown", () => {
    const threshold = evaluateSmokeThreshold({
      aggregate: { errorCount: 0, emptyOrBlockedCount: 0 },
      results: [
        {
          ok: true,
          modelContext: { modelReadiness: "caution" },
          autoReview: { issueTags: ["partial"] },
        },
      ],
    }, {
      minPageCount: 1,
      maxErrorCount: 0,
      failOnIssueTags: [],
    });
    const markdown = renderSmokeSummaryMarkdown(safeSummary, {
      allOpen: true,
      category: "unit-smoke",
      pageType: "open-tab",
      limit: 1,
      concurrency: 1,
      timeoutMs: 1000,
      minPageCount: 1,
      maxReadyCount: undefined,
      maxErrorCount: 0,
      maxEmptyOrBlockedCount: undefined,
      failOnIssueTags: [],
    });

    const markdownWithThreshold = renderSmokeSummaryMarkdown({
      ...safeSummary,
      threshold,
    }, {
      allOpen: true,
      category: "unit-smoke",
      pageType: "open-tab",
      limit: 1,
      concurrency: 1,
      timeoutMs: 1000,
      minPageCount: 1,
      maxReadyCount: undefined,
      maxErrorCount: 0,
      maxEmptyOrBlockedCount: undefined,
      failOnIssueTags: [],
    });

    expect(markdown).toContain("semantic-html/partial (large-navigation-noise)");
    expect(markdownWithThreshold).toContain("Threshold: pass");
    expect(markdownWithThreshold).toContain("\"minPageCount\": 1");
    expect(markdown).not.toContain("[object Object]");
    expect(markdown).not.toContain("https://");
  });
});
