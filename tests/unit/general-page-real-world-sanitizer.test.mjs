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
import {
  assertPublicFollowupPlan,
  buildQualityFollowupPlan,
  parseQualityFollowupArgs,
  renderQualityFollowupMarkdown,
} from "../../scripts/plan-general-page-quality-followups.mjs";
import {
  assertPublicClusterReport,
  buildQualityFollowupClusters,
  parseQualityFollowupClusterArgs,
  renderQualityFollowupClustersMarkdown,
} from "../../scripts/cluster-general-page-quality-followups.mjs";
import {
  createProductQualityProgressTracker,
  renderProductQualityProgressLine,
} from "../../scripts/lib/product-quality-progress.mjs";

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

describe("General Page product-quality review progress", () => {
  it("prints only public-safe aggregate progress for long live-DOM reviews", () => {
    const privateUrl = "https://private-source.example.test/hidden/story";
    const privateTitle = "Private Source Title";
    const privatePreview = "Sensitive extracted preview that must not appear.";
    const lines = [];
    const tracker = createProductQualityProgressTracker({
      total: 2,
      every: 1,
      log: (line) => lines.push(line),
      now: () => 10_000,
    });

    tracker.record({
      ok: true,
      url: privateUrl,
      surface: {
        title: privateTitle,
        preview: privatePreview,
      },
      modelContext: {
        modelReadiness: "ready",
      },
    });
    tracker.record({
      ok: false,
      errorKind: "timeout",
      url: privateUrl,
      errorMessage: privatePreview,
    });

    expect(lines).toEqual([
      expect.stringContaining("progress 1/2"),
      expect.stringContaining("progress 2/2"),
    ]);
    const serialized = lines.join("\n");
    expect(serialized).toContain("extracted 1");
    expect(serialized).toContain("fetchErrors 1");
    expect(serialized).not.toContain(privateUrl);
    expect(serialized).not.toContain(privateTitle);
    expect(serialized).not.toContain(privatePreview);
  });

  it("renders deterministic aggregate progress lines", () => {
    expect(renderProductQualityProgressLine({
      completed: 10,
      total: 200,
      extracted: 9,
      emptyOrBlocked: 0,
      fetchErrors: 1,
      elapsedMs: 12_345,
      readiness: {
        ready: 5,
        caution: 4,
        error: 1,
      },
    })).toBe("[general-page-review] progress 10/200 extracted 9 emptyOrBlocked 0 fetchErrors 1 elapsed 12s readiness {\"ready\":5,\"caution\":4,\"error\":1}");
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

describe("General Page quality follow-up planner", () => {
  const fixtureManifest = {
    fixtures: [
      "blocked-like",
      "category-list-page",
      "search-results-index",
      "nav-sidebar-noise",
      "news-related-sidebar",
      "government-no-article",
      "missing-metadata-blog",
      "paid-teaser-long",
      "newsletter-paywall-hybrid",
      "js-shell-bad-page",
      "empty-social-shell",
      "malformed-mixed-language-page",
      "zhtw-magazine-recirc-trap",
      "homepage-lead-card-trap",
      "docs-right-rail-long",
      "short-semantic-news-brief",
      "semantic-main-card-index-dense",
      "article-source-link-noise",
      "ticker-lead-article",
      "dated-list-hub-ready-trap",
      "member-teaser-short",
      "javascript-disabled-instruction",
      "access-checking-preview",
      "gated-continue-reading-preview",
      "news-homepage-card-grid",
    ].map((id) => ({ id })),
  };

  const summary = {
    input: {
      sourceMode: "cdp",
    },
    counts: {
      totalCount: 200,
      reviewedCount: 193,
    },
    followUpCandidates: [
      {
        key: "issue:many-source-links",
        kind: "issue-tag-cluster",
        priority: 55,
        count: 47,
        reviewedCount: 47,
        categories: [{ value: "taiwan_news", count: 30 }],
        pageTypes: [{ value: "article", count: 47 }],
        topIssueTags: [
          { value: "many-source-links", count: 47 },
          { value: "partial", count: 12 },
        ],
        verdicts: { usable_with_caution: 40, good: 7 },
        readiness: { caution: 47 },
        extractionStatus: { partial: 47 },
        extractionMethod: { "semantic-html": 47 },
      },
      {
        key: "issue:partial",
        kind: "issue-tag-cluster",
        priority: 55,
        count: 40,
        reviewedCount: 40,
        categories: [{ value: "government_official_ngo_company", count: 14 }],
        pageTypes: [{ value: "article", count: 33 }],
        topIssueTags: [
          { value: "partial", count: 40 },
          { value: "quality:partial_extraction", count: 32 },
        ],
        verdicts: { usable_with_caution: 36, bad: 4 },
        readiness: { caution: 40 },
        extractionStatus: { partial: 40 },
        extractionMethod: { fallback: 20, "semantic-html": 20 },
      },
      {
        key: "auto:overconfident-good",
        kind: "auto-overconfident-good",
        priority: 90,
        count: 15,
        reviewedCount: 15,
        categories: [{ value: "taiwan_news", count: 11 }],
        pageTypes: [{ value: "article", count: 15 }],
        topIssueTags: [
          { value: "many-source-links", count: 12 },
          { value: "leading-ticker-noise", count: 8 },
          { value: "index-like-ready", count: 3 },
        ],
        verdicts: { usable_with_caution: 12, bad: 3 },
        readiness: { ready: 15 },
        extractionStatus: { complete: 15 },
        extractionMethod: { "semantic-html": 15 },
      },
    ],
  };

  it("maps aggregate issue clusters to existing public synthetic fixtures", () => {
    const plan = buildQualityFollowupPlan(summary, fixtureManifest, { top: 20 });
    const sourceLinkItem = plan.items.find((item) => item.key === "issue:many-source-links");
    const partialItem = plan.items.find((item) => item.key === "issue:partial");
    const overconfidentItem = plan.items.find((item) => item.key === "auto:overconfident-good");
    const markdown = renderQualityFollowupMarkdown(plan);
    const serialized = JSON.stringify(plan);

    expect(() => assertPublicFollowupPlan(plan)).not.toThrow();
    expect(sourceLinkItem).toMatchObject({
      status: "covered_by_existing_fixture",
      existingCoverage: expect.arrayContaining(["article-source-link-noise"]),
    });
    expect(partialItem).toMatchObject({
      status: "needs_private_review",
      existingCoverage: expect.arrayContaining(["zhtw-magazine-recirc-trap"]),
    });
    expect(overconfidentItem).toMatchObject({
      status: "needs_private_review",
      existingCoverage: expect.arrayContaining([
        "article-source-link-noise",
        "ticker-lead-article",
        "semantic-main-card-index-dense",
      ]),
    });
    expect(markdown).toContain("General Page Quality Follow-Up Plan");
    expect(markdown).toContain("article-source-link-noise");
    expect(serialized).not.toContain("https://");
    expect(serialized).not.toContain("target-");
    expect(serialized).not.toContain("Sensitive");
  });

  it("fails fast when coverage references stale fixture ids", () => {
    expect(() => buildQualityFollowupPlan(summary, {
      fixtures: fixtureManifest.fixtures.filter((fixture) => fixture.id !== "article-source-link-noise"),
    })).toThrow(/missing fixture id: article-source-link-noise/);
  });

  it("keeps follow-up planner CLI arguments strict", () => {
    expect(parseQualityFollowupArgs([
      "--summary", "tmp/general-page-product-quality/review-test/quality-findings-summary.json",
      "--manifest", "tests/fixtures/general-pages/manifest.json",
      "--top", "6",
    ])).toMatchObject({
      summary: "tmp/general-page-product-quality/review-test/quality-findings-summary.json",
      manifest: "tests/fixtures/general-pages/manifest.json",
      top: 6,
    });
    expect(() => parseQualityFollowupArgs(["--summary", "--manifest"]))
      .toThrow(/requires a value/);
    expect(() => parseQualityFollowupArgs(["--summary", "tmp/summary.json", "--top", "0"]))
      .toThrow(/between 1 and 100/);
  });

  it("rejects private-looking follow-up plan fields and strings", () => {
    expect(() => assertPublicFollowupPlan({
      ok: true,
      url: "https://private-source.example.test/story",
    })).toThrow(/private field/);
    expect(() => assertPublicFollowupPlan({
      ok: true,
      label: "https://private-source.example.test/story",
    })).toThrow(/private-looking string/);
  });
});

describe("General Page quality follow-up clusters", () => {
  const review = {
    input: {
      sourceMode: "cdp",
    },
    results: [
      {
        targetId: "target-101",
        url: "https://private-source.example.test/story-a",
        category: "taiwan_news",
        pageType: "news",
        document: {
          linkCount: 210,
          paragraphCount: 12,
          articleCount: 0,
          mainCount: 1,
          roleMainCount: 0,
          formCount: 0,
          dialogCount: 0,
          imageCount: 8,
          htmlLength: 100000,
          bodyTextLength: 24000,
          titlePresent: true,
          hasCanonical: true,
          hasArticleMeta: true,
          hasOpenGraph: true,
        },
        surface: {
          title: "Private Story A",
          textLength: 1400,
          preview: "Sensitive copied preview A",
          extraction: {
            method: "semantic-html",
            status: "complete",
            warnings: [],
          },
          linkCount: 24,
          imageCount: 8,
        },
        modelContext: {
          modelReadiness: "ready",
          textLength: 1400,
          qualityIssues: [],
        },
        autoReview: {
          suggestedVerdict: "good",
          issueTags: ["many-source-links", "leading-ticker-noise"],
        },
      },
      {
        targetId: "target-102",
        url: "https://private-source.example.test/story-b",
        category: "taiwan_news",
        pageType: "news",
        document: {
          linkCount: 240,
          paragraphCount: 11,
          articleCount: 0,
          mainCount: 1,
          roleMainCount: 0,
          formCount: 0,
          dialogCount: 0,
          imageCount: 10,
          htmlLength: 110000,
          bodyTextLength: 20000,
          titlePresent: true,
          hasCanonical: true,
          hasArticleMeta: true,
          hasOpenGraph: true,
        },
        surface: {
          title: "Private Story B",
          textLength: 1200,
          preview: "Sensitive copied preview B",
          extraction: {
            method: "semantic-html",
            status: "complete",
            warnings: [],
          },
          linkCount: 28,
          imageCount: 10,
        },
        modelContext: {
          modelReadiness: "ready",
          textLength: 1200,
          qualityIssues: [],
        },
        autoReview: {
          suggestedVerdict: "good",
          issueTags: ["many-source-links", "leading-ticker-noise"],
        },
      },
      {
        targetId: "target-103",
        url: "https://private-source.example.test/story-c",
        category: "blog_medium_personal",
        pageType: "blog",
        document: {
          linkCount: 36,
          paragraphCount: 3,
          articleCount: 0,
          mainCount: 0,
          roleMainCount: 0,
          formCount: 1,
          dialogCount: 0,
          imageCount: 2,
          htmlLength: 50000,
          bodyTextLength: 18000,
          titlePresent: true,
          hasCanonical: false,
          hasArticleMeta: false,
          hasOpenGraph: false,
        },
        surface: {
          title: "Private Story C",
          textLength: 180,
          preview: "Sensitive copied preview C",
          extraction: {
            method: "fallback",
            status: "partial",
            warnings: ["no-main-content"],
          },
          linkCount: 4,
          imageCount: 2,
        },
        modelContext: {
          modelReadiness: "caution",
          textLength: 180,
          qualityIssues: ["fallback_extraction", "partial_extraction", "no_main_content"],
        },
        autoReview: {
          suggestedVerdict: "usable_with_caution",
          issueTags: ["fallback", "partial", "quality:fallback_extraction", "quality:partial_extraction", "quality:no_main_content"],
        },
      },
    ],
  };

  const labels = new Map([
    ["target-101", { verdict: "usable_with_caution", issueTags: ["truncated-body"] }],
    ["target-102", { verdict: "usable_with_caution", issueTags: ["truncated-body"] }],
    ["target-103", { verdict: "usable_with_caution", issueTags: ["js-rendered-site"] }],
  ]);

  const followupPlan = {
    items: [
      {
        key: "auto:overconfident-good",
        kind: "auto-overconfident-good",
        status: "needs_private_review",
        count: 2,
        reviewedCount: 2,
      },
      {
        key: "manual:usable-with-caution",
        kind: "manual-caution-pattern",
        status: "needs_private_review",
        count: 3,
        reviewedCount: 3,
      },
      {
        key: "issue:many-source-links",
        kind: "issue-tag-cluster",
        status: "covered_by_existing_fixture",
        count: 2,
        reviewedCount: 2,
      },
    ],
  };

  it("clusters needs-private-review items by structural signatures without private fields", () => {
    const clusterReport = buildQualityFollowupClusters(review, labels, followupPlan, {
      topClusters: 4,
      minClusterCount: 2,
    });
    const markdown = renderQualityFollowupClustersMarkdown(clusterReport);
    const serialized = JSON.stringify(clusterReport);
    const overconfident = clusterReport.items.find((item) => item.key === "auto:overconfident-good");

    expect(() => assertPublicClusterReport(clusterReport)).not.toThrow();
    expect(clusterReport.counts.byAction).toMatchObject({
      fixture_candidate: expect.any(Number),
    });
    expect(overconfident.clusters[0]).toMatchObject({
      count: 2,
      recommendedAction: "fixture_candidate",
      signature: expect.objectContaining({
        extraction: "semantic-html/complete",
        readiness: "ready",
      }),
    });
    expect(markdown).toContain("General Page Quality Follow-Up Clusters");
    expect(markdown).toContain("fixture_candidate");
    expect(serialized).not.toContain("https://private-source.example.test");
    expect(serialized).not.toContain("Private Story");
    expect(serialized).not.toContain("Sensitive copied preview");
    expect(serialized).not.toContain("target-10");
  });

  it("keeps cluster CLI arguments strict", () => {
    expect(parseQualityFollowupClusterArgs([
      "--review", "tmp/general-page-product-quality/review-test/review.json",
      "--labels", "tmp/general-page-product-quality/review-test/manual-labels.jsonl",
      "--plan", "tmp/general-page-product-quality/review-test/quality-followups-plan.json",
      "--top-clusters", "4",
      "--min-cluster-count", "2",
    ])).toMatchObject({
      review: "tmp/general-page-product-quality/review-test/review.json",
      labels: "tmp/general-page-product-quality/review-test/manual-labels.jsonl",
      plan: "tmp/general-page-product-quality/review-test/quality-followups-plan.json",
      topClusters: 4,
      minClusterCount: 2,
    });
    expect(() => parseQualityFollowupClusterArgs([
      "--review", "tmp/review.json",
      "--labels", "tmp/labels.jsonl",
      "--plan", "tmp/plan.json",
      "--top-clusters", "0",
    ])).toThrow(/between 1 and 24/);
  });

  it("rejects private-looking cluster report fields and strings", () => {
    expect(() => assertPublicClusterReport({
      ok: true,
      targetId: "target-001",
    })).toThrow(/private field/);
    expect(() => assertPublicClusterReport({
      ok: true,
      label: "https://private-source.example.test/story",
    })).toThrow(/private-looking string/);
  });
});
