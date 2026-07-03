import { describe, expect, it } from "vitest";

import { sanitizeEngineResult } from "../../scripts/evaluate-general-page-real-world.mjs";
import {
  assertPublicSmokeSummary,
  evaluateSmokeThreshold,
  parseCurrentBrowserSmokeArgs,
  renderSmokeSummaryMarkdown,
  safeSmokeHost,
} from "../../scripts/smoke-general-page-current.mjs";
import {
  assertPublicQualityFindingsSummary,
  buildQualityFindingsSummary,
  parseQualityFindingsArgs,
  renderQualityFindingsMarkdown,
} from "../../scripts/summarize-general-page-quality-findings.mjs";

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

  it("redacts local and private hosts in smoke summaries", () => {
    const localHost = ["gx10", "local"].join(".");
    const internalHost = ["model", "internal"].join(".");
    const privateIpv4 = ["192", "168", "1", "20"].join(".");
    expect(safeSmokeHost("https://news.example.test/story")).toBe("news.example.test");
    expect(safeSmokeHost("http://127.0.0.1:5173/demo")).toBe("localhost");
    expect(safeSmokeHost(`http://${localHost}/dashboard`)).toBe("private-host");
    expect(safeSmokeHost(`https://${internalHost}/status`)).toBe("private-host");
    expect(safeSmokeHost(`http://${privateIpv4}/page`)).toBe("private-host");
    expect(safeSmokeHost("http://172.20.0.2/page")).toBe("private-host");
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

describe("General Page product-quality findings summary", () => {
  const privateReview = {
    input: {
      sourceMode: "cdp",
    },
    results: [
      {
        targetId: "target-001",
        url: "https://private-source.example.test/story-a",
        category: "international_news",
        pageType: "article",
        surface: {
          title: "Private Story A",
          preview: "Sensitive copied article preview.",
          extraction: {
            method: "semantic-html",
            status: "complete",
            warnings: [],
          },
        },
        modelContext: {
          modelReadiness: "ready",
        },
        autoReview: {
          suggestedVerdict: "good",
          issueTags: ["complete"],
        },
        manualReview: {
          verdict: "unreviewed",
          notes: "Private reviewer note",
        },
      },
      {
        targetId: "target-002",
        url: "https://private-source.example.test/story-b",
        category: "taiwan_news",
        pageType: "article",
        surface: {
          title: "Private Story B",
          preview: "Sensitive ticker plus article body.",
          extraction: {
            method: "semantic-html",
            status: "partial",
            warnings: ["large-navigation-noise"],
          },
        },
        modelContext: {
          modelReadiness: "ready",
        },
        autoReview: {
          suggestedVerdict: "good",
          issueTags: ["quality:large_navigation_noise", "warning:large-navigation-noise"],
        },
      },
      {
        targetId: "target-003",
        url: "https://private-source.example.test/story-c",
        category: "forum_social",
        pageType: "discussion",
        surface: {
          title: "Private Discussion",
          preview: "Sensitive discussion text.",
          extraction: {
            method: "fallback",
            status: "partial",
            warnings: ["no-main-content"],
          },
        },
        modelContext: {
          modelReadiness: "caution",
        },
        autoReview: {
          suggestedVerdict: "usable_with_caution",
          issueTags: ["fallback", "partial", "quality:fallback_extraction"],
        },
      },
      {
        targetId: "target-004",
        url: "https://private-source.example.test/story-d",
        category: "paywall_login_bad",
        pageType: "blocked",
        surface: {
          title: "Private Gated Page",
          preview: "Sensitive gated preview.",
          extraction: {
            method: "fallback",
            status: "empty",
            warnings: ["no-main-content"],
          },
        },
        modelContext: {
          modelReadiness: "blocked",
        },
        autoReview: {
          suggestedVerdict: "blocked_or_empty_review",
          issueTags: ["empty", "blocked"],
        },
      },
    ],
  };

  const labels = new Map([
    ["target-001", { verdict: "good", issueTags: [] }],
    ["target-002", { verdict: "bad", issueTags: ["recirc-leak"] }],
    ["target-003", { verdict: "usable_with_caution", issueTags: ["thread-like"] }],
    ["target-004", { verdict: "blocked_or_empty_ok", issueTags: ["expected-block"] }],
  ]);

  it("summarizes private review labels into public-safe follow-up candidates", () => {
    const summary = buildQualityFindingsSummary(privateReview, labels, { top: 20 });
    const markdown = renderQualityFindingsMarkdown(summary);
    const serialized = JSON.stringify(summary);

    expect(() => assertPublicQualityFindingsSummary(summary)).not.toThrow();
    expect(summary).toMatchObject({
      input: {
        totalCount: 4,
        reviewedCount: 4,
        sourceMode: "cdp",
        labelsProvided: true,
      },
      counts: {
        verdicts: {
          good: 1,
          bad: 1,
          usable_with_caution: 1,
          blocked_or_empty_ok: 1,
        },
      },
    });
    expect(summary.followUpCandidates).toEqual(expect.arrayContaining([
      expect.objectContaining({
        key: "manual:bad-regression",
        kind: "bad-regression",
        count: 1,
      }),
      expect.objectContaining({
        key: "auto:overconfident-good",
        kind: "auto-overconfident-good",
        count: 1,
      }),
      expect.objectContaining({
        key: "issue:quality:large_navigation_noise",
        kind: "issue-tag-cluster",
        count: 1,
      }),
    ]));
    expect(markdown).toContain("manual:bad-regression");
    expect(markdown).toContain("Create a synthetic fixture");
    expect(serialized).not.toContain("https://private-source.example.test");
    expect(serialized).not.toContain("Private Story");
    expect(serialized).not.toContain("Sensitive");
    expect(serialized).not.toContain("target-00");
    expect(serialized).not.toContain("Private reviewer note");
    expect(markdown).not.toContain("https://");
    expect(markdown).not.toContain("Sensitive");
  });

  it("rejects private-looking fields and strings in quality findings summaries", () => {
    expect(() => assertPublicQualityFindingsSummary({
      ...buildQualityFindingsSummary(privateReview, labels, { top: 1 }),
      url: "https://private-source.example.test/story",
    })).toThrow(/private field/);

    expect(() => assertPublicQualityFindingsSummary({
      ok: true,
      label: "https://private-source.example.test/story",
    })).toThrow(/private-looking string/);
  });

  it("keeps quality findings CLI arguments strict", () => {
    expect(parseQualityFindingsArgs([
      "--review", "tmp/general-page-product-quality/review-test/review.json",
      "--labels", "tmp/general-page-product-quality/review-test/manual-labels.jsonl",
      "--top", "6",
    ])).toMatchObject({
      review: "tmp/general-page-product-quality/review-test/review.json",
      labels: "tmp/general-page-product-quality/review-test/manual-labels.jsonl",
      top: 6,
    });
    expect(() => parseQualityFindingsArgs(["--review", "--labels"]))
      .toThrow(/requires a value/);
    expect(() => parseQualityFindingsArgs(["--review", "tmp/review.json", "--top", "0"]))
      .toThrow(/between 1 and 50/);
  });
});
