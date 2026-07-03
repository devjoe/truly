#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const DEFAULT_MANIFEST = "tests/fixtures/general-pages/manifest.json";

const FORBIDDEN_KEYS = new Set([
  "url",
  "finalUrl",
  "title",
  "canonicalUrl",
  "sourceName",
  "authorName",
  "publishedAt",
  "excerpt",
  "preview",
  "mainText",
  "textContent",
  "html",
  "rawHtml",
  "sourceHtml",
  "screenshot",
  "dataUrl",
  "notes",
  "targetId",
  "seedId",
]);

const FORBIDDEN_STRING_PATTERNS = [
  /https?:\/\//i,
  /<!doctype/i,
  /<html/i,
];

const ISSUE_COVERAGE = {
  "many-source-links": {
    status: "covered_by_existing_fixture",
    fixtures: ["article-source-link-noise"],
    nextStep: "Keep source-link caps and utility-link filtering in contract coverage; monitor live smoke for regressions.",
    fixtureShape: "Article body with many adjacent utility, browser-download, social, and navigation links around one useful source link.",
  },
  "leading-ticker-noise": {
    status: "covered_by_existing_fixture",
    fixtures: ["ticker-lead-article"],
    nextStep: "Keep ticker/promo lead removal covered before changing semantic-main trust rules.",
    fixtureShape: "News article preceded by market/ticker/navigation text that should not dominate the extracted body.",
  },
  "index-like-ready": {
    status: "covered_by_existing_fixture",
    fixtures: ["semantic-main-card-index-dense", "dated-list-hub-ready-trap", "news-homepage-card-grid", "homepage-lead-card-trap"],
    nextStep: "Maintain index/feed density demotion for semantic main containers; use thresholded current-browser smoke for false-ready checks.",
    fixtureShape: "Semantic main region containing mostly cards, dates, short headlines, and outbound clusters rather than one article.",
  },
  "likely-index-or-feed": {
    status: "covered_by_existing_fixture",
    fixtures: ["category-list-page", "search-results-index", "semantic-main-card-index-dense", "dated-list-hub-ready-trap"],
    nextStep: "Treat as a demotion signal, not a hard blocker, because documentation right rails can look link-dense.",
    fixtureShape: "Index/feed-like page with repeated cards and high link density, plus a counterexample with real article or docs text.",
  },
  "member-gated-teaser": {
    status: "covered_by_existing_fixture",
    fixtures: ["member-teaser-short", "gated-continue-reading-preview", "paid-teaser-long", "newsletter-paywall-hybrid"],
    nextStep: "Keep gated preview pages caution/blocked unless the extracted context has enough visible body text.",
    fixtureShape: "Article-like page with member-only continuation, subscription prompt, or short teaser body.",
  },
  "paywall": {
    status: "covered_by_existing_fixture",
    fixtures: ["blocked-like", "paid-teaser-long", "newsletter-paywall-hybrid", "gated-continue-reading-preview"],
    nextStep: "Keep blocked/gated language as model-eligibility evidence and avoid hallucinating unavailable body text.",
    fixtureShape: "Login or subscription wall with a small preview and prominent access instructions.",
  },
  "login/paywall": {
    status: "covered_by_existing_fixture",
    fixtures: ["blocked-like", "newsletter-paywall-hybrid", "access-checking-preview"],
    nextStep: "Keep access-checking and login-wall surfaces fail-closed or caution-only.",
    fixtureShape: "Access-checking, login, or paywall page that should not be treated as a complete article.",
  },
  "warning:login-or-paywall-like": {
    status: "covered_by_existing_fixture",
    fixtures: ["blocked-like", "paid-teaser-long", "newsletter-paywall-hybrid", "gated-continue-reading-preview"],
    nextStep: "Keep warning propagation visible in diagnostics and model eligibility.",
    fixtureShape: "Visible teaser with login/subscription affordances and no complete article body.",
  },
  "large_navigation_noise": {
    status: "covered_by_existing_fixture",
    fixtures: ["nav-sidebar-noise", "news-related-sidebar", "docs-right-rail-long", "article-source-link-noise"],
    nextStep: "Keep navigation noise as caution evidence; add fixtures only when private labels reveal a new navigation shape.",
    fixtureShape: "Readable body surrounded by dense navigation, related stories, right rail, or source-link utility blocks.",
  },
  "quality:large_navigation_noise": {
    status: "covered_by_existing_fixture",
    fixtures: ["nav-sidebar-noise", "news-related-sidebar", "docs-right-rail-long", "article-source-link-noise"],
    nextStep: "Use existing navigation-noise fixtures as regression tests before tuning readiness.",
    fixtureShape: "Article or docs body with enough real text plus dense navigation clusters.",
  },
  "warning:large-navigation-noise": {
    status: "covered_by_existing_fixture",
    fixtures: ["nav-sidebar-noise", "news-related-sidebar", "docs-right-rail-long"],
    nextStep: "Do not convert warning count alone into a blocker; inspect paired labels for body loss.",
    fixtureShape: "Readable article with a large related/sidebar/nav block that should not overwhelm the body.",
  },
  "very-short-content": {
    status: "covered_by_existing_fixture",
    fixtures: ["short-semantic-news-brief", "member-teaser-short"],
    nextStep: "Keep short-body handling distinct from blocked pages; short but complete notices can still be useful.",
    fixtureShape: "Short complete article and short gated teaser as opposing examples.",
  },
  "warning:very-short-content": {
    status: "covered_by_existing_fixture",
    fixtures: ["short-semantic-news-brief", "member-teaser-short"],
    nextStep: "Use paired fixtures to avoid over-blocking concise public notices.",
    fixtureShape: "A concise but complete article contrasted with an incomplete teaser.",
  },
  "partial": {
    status: "needs_private_review",
    fixtures: ["news-related-sidebar", "zhtw-magazine-recirc-trap", "access-checking-preview", "gated-continue-reading-preview"],
    nextStep: "Cluster private labels by repeated DOM shape before adding a fixture; partial is a symptom, not a pattern.",
    fixtureShape: "Only create a new fixture after reviewer labels show the same missing-body or recirculation shape repeatedly.",
  },
  "quality:partial_extraction": {
    status: "needs_private_review",
    fixtures: ["zhtw-magazine-recirc-trap", "access-checking-preview", "gated-continue-reading-preview"],
    nextStep: "Split body-miss, recirculation leak, and expected gated preview into separate fixture work items.",
    fixtureShape: "Specific missing-body pattern from private review, rewritten as synthetic DOM and fake prose.",
  },
  "fallback": {
    status: "needs_private_review",
    fixtures: ["government-no-article", "missing-metadata-blog", "malformed-mixed-language-page"],
    nextStep: "Inspect whether fallback is acceptable recovery or a sign that semantic/candidate block selection failed.",
    fixtureShape: "Synthetic page with the same missing semantic markers or nested layout, without copying source HTML.",
  },
  "quality:fallback_extraction": {
    status: "needs_private_review",
    fixtures: ["government-no-article", "missing-metadata-blog", "malformed-mixed-language-page"],
    nextStep: "Do not add broad fallback heuristics until private examples separate article recovery from non-article pages.",
    fixtureShape: "One fixture for recoverable no-article markup and one for non-article fallback noise if both persist.",
  },
  "quality:no_main_content": {
    status: "needs_private_review",
    fixtures: ["js-shell-bad-page", "empty-social-shell", "javascript-disabled-instruction"],
    nextStep: "Check whether the live-DOM harness saw rendered content; static no-main results may be harness artifacts.",
    fixtureShape: "Rendered JS shell, disabled-JS instruction, or empty social shell depending on repeated private examples.",
  },
  "warning:no-main-content": {
    status: "needs_private_review",
    fixtures: ["js-shell-bad-page", "empty-social-shell", "javascript-disabled-instruction"],
    nextStep: "Separate true empty pages from JS-rendered pages before changing runtime behavior.",
    fixtureShape: "Public-safe shell fixture that models the missing-main reason without real page code.",
  },
  "harness-fetch-429": {
    status: "harness_condition",
    fixtures: [],
    nextStep: "Treat as review collection noise; retry privately or exclude from product-quality denominator.",
    fixtureShape: "No synthetic fixture needed unless the rendered blocked response has a stable user-facing pattern.",
  },
};

const CANDIDATE_RULES = {
  "manual:bad-regression": {
    status: "needs_private_review",
    fixtures: [],
    nextStep: "Prioritize these private examples; convert the repeated DOM failure into the next synthetic fixture before changing heuristics.",
    fixtureShape: "The smallest synthetic page that reproduces the manually confirmed bad extraction without copied HTML or text.",
  },
  "auto:overconfident-good": {
    status: "needs_private_review",
    fixtures: [],
    nextStep: "Identify which top issue tag explains the false-ready state; if existing fixtures cover it, tune readiness against those fixtures first.",
    fixtureShape: "A false-ready page where cards, utility links, ticker text, or gated preview make the model context look better than it is.",
  },
  "auto:underconfident-blocked": {
    status: "needs_private_review",
    fixtures: [],
    nextStep: "Look for recoverable body text that the extractor missed; add a body-recovery fixture before relaxing blockers.",
    fixtureShape: "A page where visible article text exists but the automatic status is blocked or empty.",
  },
  "manual:usable-with-caution": {
    status: "needs_private_review",
    fixtures: [],
    nextStep: "Cluster caution labels into concrete shapes; promote only repeated shapes to public synthetic fixtures.",
    fixtureShape: "A caution page with enough useful body text but explicit warnings such as recirculation, fallback, or partial extraction.",
  },
};

if (isDirectRun()) {
  try {
    main();
  } catch (error) {
    console.error(error?.stack || String(error));
    process.exit(1);
  }
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const summary = readJson(args.summary);
  const manifest = readJson(args.manifest);
  const plan = buildQualityFollowupPlan(summary, manifest, { top: args.top });

  const outputJson = args.output ?? path.join(path.dirname(args.summary), "quality-followups-plan.json");
  const outputMarkdown = args.markdown ?? path.join(path.dirname(args.summary), "quality-followups-plan.md");
  assertPrivateOutputPath(outputJson, "--output");
  assertPrivateOutputPath(outputMarkdown, "--markdown");
  assertPublicFollowupPlan(plan);

  fs.mkdirSync(path.dirname(outputJson), { recursive: true });
  fs.writeFileSync(outputJson, `${JSON.stringify(plan, null, 2)}\n`);
  fs.writeFileSync(outputMarkdown, renderQualityFollowupMarkdown(plan));

  console.log(`Wrote ${outputJson}`);
  console.log(`Wrote ${outputMarkdown}`);
  console.log(`planned ${plan.items.length} follow-up items; ${JSON.stringify(plan.counts.byStatus)}`);
}

function parseArgs(argv) {
  const summary = stringArg(argv, "--summary") ?? stringArg(argv, "--input");
  if (!summary) {
    console.error([
      "Usage:",
      "  node scripts/plan-general-page-quality-followups.mjs",
      "    --summary tmp/general-page-product-quality/review-.../quality-findings-summary.json",
      "    [--manifest tests/fixtures/general-pages/manifest.json]",
      "    [--output tmp/general-page-product-quality/review-.../quality-followups-plan.json]",
      "    [--markdown tmp/general-page-product-quality/review-.../quality-followups-plan.md]",
      "    [--top 20]",
    ].join("\n"));
    process.exit(2);
  }
  return {
    summary,
    manifest: stringArg(argv, "--manifest") ?? DEFAULT_MANIFEST,
    output: stringArg(argv, "--output"),
    markdown: stringArg(argv, "--markdown"),
    top: numericArg(argv, "--top", 20, { min: 1, max: 100 }),
  };
}

function stringArg(argv, name) {
  const index = argv.indexOf(name);
  if (index < 0) return undefined;
  if (argv[index + 1] === undefined || argv[index + 1].startsWith("--"))
    throw new Error(`${name} requires a value.`);
  return argv[index + 1];
}

function numericArg(argv, name, fallback, { min, max }) {
  const raw = stringArg(argv, name);
  if (raw === undefined)
    return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < min || value > max)
    throw new Error(`${name} must be an integer between ${min} and ${max}.`);
  return value;
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function buildQualityFollowupPlan(summary, manifest, options = {}) {
  const fixtureIds = new Set((manifest.fixtures ?? []).map((fixture) => fixture.id).filter(Boolean));
  const candidates = Array.isArray(summary.followUpCandidates) ? summary.followUpCandidates : [];
  if (candidates.length === 0)
    throw new Error("Quality findings summary must include followUpCandidates.");

  const coverageCatalog = buildCoverageCatalog(fixtureIds);
  const items = candidates
    .slice(0, options.top ?? 20)
    .map((candidate) => planCandidate(candidate, coverageCatalog, fixtureIds));

  const plan = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    privacyBoundary: "Public-safe plan derived from aggregate findings only. No URLs, titles, text previews, notes, screenshots, target ids, seed ids, or source content.",
    input: {
      sourceMode: safeString(summary.input?.sourceMode, "unknown"),
      totalCount: safeNumber(summary.counts?.totalCount),
      reviewedCount: safeNumber(summary.counts?.reviewedCount),
      candidateCount: candidates.length,
    },
    counts: {
      byStatus: countValues(items.map((item) => item.status)),
      byKind: countValues(items.map((item) => item.kind)),
    },
    items,
  };
  assertPublicFollowupPlan(plan);
  return plan;
}

function buildCoverageCatalog(fixtureIds) {
  const catalog = {};
  for (const [key, rule] of Object.entries(ISSUE_COVERAGE)) {
    verifyFixturesExist(key, rule.fixtures, fixtureIds);
    catalog[key] = {
      status: rule.status,
      fixtures: rule.fixtures,
      nextStep: rule.nextStep,
      fixtureShape: rule.fixtureShape,
    };
  }
  for (const [key, rule] of Object.entries(CANDIDATE_RULES)) {
    verifyFixturesExist(key, rule.fixtures, fixtureIds);
  }
  return catalog;
}

function planCandidate(candidate, coverageCatalog, fixtureIds) {
  const issueKey = candidate.key?.startsWith("issue:") ? candidate.key.slice("issue:".length) : "";
  const directRule = coverageCatalog[issueKey] ?? CANDIDATE_RULES[candidate.key];
  const topTags = Array.isArray(candidate.topIssueTags) ? candidate.topIssueTags : [];
  const inferredCoverage = inferCoverageFromTopTags(topTags, coverageCatalog);
  const fixtures = [...new Set([...(directRule?.fixtures ?? []), ...inferredCoverage.fixtures])];
  verifyFixturesExist(candidate.key, fixtures, fixtureIds);

  const status = directRule?.status
    ?? (inferredCoverage.fixtures.length > 0 ? "needs_private_review" : "needs_fixture");

  return {
    key: safeString(candidate.key, "unknown"),
    kind: safeString(candidate.kind, "unknown"),
    priority: safeNumber(candidate.priority),
    count: safeNumber(candidate.count),
    reviewedCount: safeNumber(candidate.reviewedCount),
    status,
    existingCoverage: fixtures,
    evidence: {
      categories: safeTopCounts(candidate.categories, 6),
      pageTypes: safeTopCounts(candidate.pageTypes, 6),
      issueTags: safeTopCounts(candidate.topIssueTags, 10),
      verdicts: safeCountObject(candidate.verdicts),
      readiness: safeCountObject(candidate.readiness),
      extractionStatus: safeCountObject(candidate.extractionStatus),
      extractionMethod: safeCountObject(candidate.extractionMethod),
    },
    recommendedNextStep: directRule?.nextStep
      ?? "Create a synthetic fixture only after private review confirms a repeated public-safe DOM pattern.",
    suggestedFixtureShape: directRule?.fixtureShape
      ?? inferredCoverage.fixtureShapes[0]
      ?? "Public-safe synthetic DOM that captures the repeated structure, using fake prose, fake names, and example.test links only.",
  };
}

function inferCoverageFromTopTags(topTags, coverageCatalog) {
  const fixtures = [];
  const fixtureShapes = [];
  for (const item of topTags) {
    const rule = coverageCatalog[item?.value];
    if (!rule)
      continue;
    fixtures.push(...rule.fixtures);
    fixtureShapes.push(rule.fixtureShape);
  }
  return {
    fixtures: [...new Set(fixtures)],
    fixtureShapes: [...new Set(fixtureShapes)],
  };
}

function verifyFixturesExist(label, fixtures, fixtureIds) {
  for (const fixture of fixtures) {
    if (!fixtureIds.has(fixture))
      throw new Error(`${label} references missing fixture id: ${fixture}`);
  }
}

function safeTopCounts(items, limit) {
  if (!Array.isArray(items)) return [];
  return items.slice(0, limit).map((item) => ({
    value: safeString(item?.value, "unknown"),
    count: safeNumber(item?.count),
  }));
}

function safeCountObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value))
    return {};
  return Object.fromEntries(Object.entries(value)
    .map(([key, count]) => [safeString(key, "unknown"), safeNumber(count)])
    .sort(([a], [b]) => a.localeCompare(b)));
}

function safeString(value, fallback) {
  if (typeof value !== "string" || !value.trim())
    return fallback;
  const clean = value.trim().replace(/\s+/g, "-").slice(0, 120);
  if (FORBIDDEN_STRING_PATTERNS.some((pattern) => pattern.test(clean)))
    return fallback;
  return clean;
}

function safeNumber(value) {
  return Number.isFinite(value) ? value : 0;
}

function countValues(values) {
  return values.reduce((counts, value) => {
    counts[value] = (counts[value] ?? 0) + 1;
    return counts;
  }, {});
}

function renderQualityFollowupMarkdown(plan) {
  const rows = plan.items.map((item) => [
    item.key,
    item.status,
    item.count,
    item.reviewedCount,
    item.existingCoverage.join(", ") || "(none)",
    topLabels(item.evidence.issueTags),
    item.recommendedNextStep,
  ].map(markdownCell));

  return `# General Page Quality Follow-Up Plan

Generated: ${plan.generatedAt}
Source mode: ${plan.input.sourceMode}
Reviewed: ${plan.input.reviewedCount}/${plan.input.totalCount}

${plan.privacyBoundary}

## Status Counts

\`\`\`json
${JSON.stringify(plan.counts.byStatus, null, 2)}
\`\`\`

## Items

| Key | Status | Count | Reviewed | Existing coverage | Issue tags | Next step |
| --- | --- | ---: | ---: | --- | --- | --- |
${rows.map((row) => `| ${row.join(" | ")} |`).join("\n")}
`;
}

function topLabels(items) {
  return items.map((item) => `${item.value} (${item.count})`).join(", ") || "(none)";
}

function markdownCell(value) {
  return String(value).replace(/\|/g, "\\|").replace(/\n/g, " ");
}

function assertPublicFollowupPlan(value, pathLabel = "plan") {
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertPublicFollowupPlan(item, `${pathLabel}[${index}]`));
    return;
  }
  if (value && typeof value === "object") {
    for (const [key, nested] of Object.entries(value)) {
      if (FORBIDDEN_KEYS.has(key))
        throw new Error(`Quality follow-up plan must not include private field ${pathLabel}.${key}`);
      assertPublicFollowupPlan(nested, `${pathLabel}.${key}`);
    }
    return;
  }
  if (typeof value !== "string") return;
  for (const pattern of FORBIDDEN_STRING_PATTERNS) {
    if (pattern.test(value))
      throw new Error(`Quality follow-up plan must not include private-looking string at ${pathLabel}`);
  }
}

function assertPrivateOutputPath(outputPath, label) {
  const normalized = path.resolve(outputPath);
  const allowedRoots = [
    path.resolve("tmp"),
    path.resolve(process.env.TMPDIR ?? "/tmp"),
    "/tmp",
    "/private/tmp",
  ];
  if (!allowedRoots.some((root) => normalized === root || normalized.startsWith(`${root}${path.sep}`))) {
    throw new Error(`${label} must stay under tmp/ or the system temp directory because quality follow-ups derive from private review artifacts.`);
  }
}

function isDirectRun() {
  return process.argv[1] && import.meta.url === new URL(process.argv[1], "file:").href;
}

export {
  assertPublicFollowupPlan,
  buildQualityFollowupPlan,
  parseArgs as parseQualityFollowupArgs,
  renderQualityFollowupMarkdown,
};
