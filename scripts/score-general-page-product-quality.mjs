#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const VERDICTS = new Set([
  "unreviewed",
  "good",
  "usable_with_caution",
  "bad",
  "blocked_or_empty_ok",
]);

const ACCEPTABLE_VERDICTS = new Set([
  "good",
  "usable_with_caution",
  "blocked_or_empty_ok",
]);

function main() {
  const args = parseArgs(process.argv.slice(2));
  const report = readJson(args.review);
  const labels = readLabels(args.labels);
  const results = Array.isArray(report.results) ? report.results : [];
  if (results.length === 0)
    throw new Error("Review report must include a non-empty results array.");

  const rows = results.map((item) => scoreRow(item, labels.get(item.targetId)));
  const summary = summarize(rows, args);

  if (args.output) {
    assertPrivateOutputPath(args.output);
    fs.mkdirSync(path.dirname(args.output), { recursive: true });
    fs.writeFileSync(args.output, `${JSON.stringify(summary, null, 2)}\n`);
  }

  printSummary(summary);
  if (!summary.pass)
    process.exitCode = 1;
}

function parseArgs(argv) {
  const review = stringArg(argv, "--review") ?? stringArg(argv, "--input");
  const labels = stringArg(argv, "--labels");
  if (!review || !labels) {
    console.error([
      "Usage:",
      "  node scripts/score-general-page-product-quality.mjs",
      "    --review tmp/general-page-product-quality/review-.../review.json",
      "    --labels tmp/general-page-product-quality/review-.../manual-labels.jsonl",
      "    [--output tmp/general-page-product-quality/review-.../quality-gate.json]",
      "    [--min-reviewed-rate 0.95]",
      "    [--min-acceptable-rate 0.90]",
      "    [--max-bad-rate 0.05]",
    ].join("\n"));
    process.exit(2);
  }
  return {
    review,
    labels,
    output: stringArg(argv, "--output"),
    minReviewedRate: numericArg(argv, "--min-reviewed-rate", 0.95, { min: 0, max: 1 }),
    minAcceptableRate: numericArg(argv, "--min-acceptable-rate", 0.90, { min: 0, max: 1 }),
    maxBadRate: numericArg(argv, "--max-bad-rate", 0.05, { min: 0, max: 1 }),
  };
}

function stringArg(argv, name) {
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] : undefined;
}

function numericArg(argv, name, fallback, { min, max }) {
  const raw = stringArg(argv, name);
  if (raw === undefined)
    return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < min || value > max)
    throw new Error(`${name} must be a number between ${min} and ${max}.`);
  return value;
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function readLabels(filePath) {
  const labels = new Map();
  const raw = fs.readFileSync(filePath, "utf8");
  for (const [index, line] of raw.split(/\n/).entries()) {
    if (!line.trim())
      continue;
    const parsed = JSON.parse(line);
    if (typeof parsed.targetId !== "string")
      throw new Error(`Label line ${index + 1} is missing targetId.`);
    if (!VERDICTS.has(parsed.verdict))
      throw new Error(`Label line ${index + 1} has unsupported verdict: ${parsed.verdict}`);
    labels.set(parsed.targetId, {
      targetId: parsed.targetId,
      verdict: parsed.verdict,
      issueTags: Array.isArray(parsed.issueTags)
        ? parsed.issueTags.filter((tag) => typeof tag === "string")
        : [],
    });
  }
  return labels;
}

function scoreRow(item, label) {
  const verdict = label?.verdict ?? "unreviewed";
  return {
    category: typeof item.category === "string" ? item.category : "uncategorized",
    pageType: typeof item.pageType === "string" ? item.pageType : "unknown",
    verdict,
    reviewed: verdict !== "unreviewed",
    acceptable: ACCEPTABLE_VERDICTS.has(verdict),
    bad: verdict === "bad",
    autoSuggested: item.autoReview?.suggestedVerdict ?? "unknown",
    issueTags: [
      ...(Array.isArray(label?.issueTags) ? label.issueTags : []),
      ...(Array.isArray(item.autoReview?.issueTags) ? item.autoReview.issueTags : []),
    ],
  };
}

function summarize(rows, args) {
  const reviewedRows = rows.filter((row) => row.reviewed);
  const totalCount = rows.length;
  const reviewedCount = reviewedRows.length;
  const acceptedCount = reviewedRows.filter((row) => row.acceptable).length;
  const badCount = reviewedRows.filter((row) => row.bad).length;
  const reviewedRate = ratio(reviewedCount, totalCount);
  const acceptableRate = ratio(acceptedCount, reviewedCount);
  const badRate = ratio(badCount, reviewedCount);
  const failures = [];

  if (reviewedRate < args.minReviewedRate)
    failures.push(`reviewed-rate ${formatRate(reviewedRate)} < ${formatRate(args.minReviewedRate)}`);
  if (acceptableRate < args.minAcceptableRate)
    failures.push(`acceptable-rate ${formatRate(acceptableRate)} < ${formatRate(args.minAcceptableRate)}`);
  if (badRate > args.maxBadRate)
    failures.push(`bad-rate ${formatRate(badRate)} > ${formatRate(args.maxBadRate)}`);

  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    privacyBoundary: "Sanitized aggregate only. No URLs, text previews, notes, screenshots, or source content.",
    pass: failures.length === 0,
    failures,
    thresholds: {
      minReviewedRate: args.minReviewedRate,
      minAcceptableRate: args.minAcceptableRate,
      maxBadRate: args.maxBadRate,
    },
    counts: {
      totalCount,
      reviewedCount,
      acceptedCount,
      badCount,
      verdicts: countValues(rows.map((row) => row.verdict)),
      autoSuggested: countValues(rows.map((row) => row.autoSuggested)),
    },
    rates: {
      reviewedRate,
      acceptableRate,
      badRate,
    },
    byCategory: groupedVerdicts(rows, "category"),
    byPageType: groupedVerdicts(rows, "pageType"),
    topIssueTags: topCounts(rows.flatMap((row) => row.issueTags), 24),
  };
}

function groupedVerdicts(rows, key) {
  const groups = new Map();
  for (const row of rows) {
    const group = row[key] || "unknown";
    const current = groups.get(group) ?? {
      totalCount: 0,
      reviewedCount: 0,
      verdicts: {},
    };
    current.totalCount += 1;
    if (row.reviewed)
      current.reviewedCount += 1;
    current.verdicts[row.verdict] = (current.verdicts[row.verdict] ?? 0) + 1;
    groups.set(group, current);
  }
  return Object.fromEntries([...groups.entries()].sort(([a], [b]) => a.localeCompare(b)));
}

function countValues(values) {
  return values.reduce((counts, value) => {
    counts[value] = (counts[value] ?? 0) + 1;
    return counts;
  }, {});
}

function topCounts(values, limit) {
  return Object.entries(countValues(values))
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([value, count]) => ({ value, count }));
}

function ratio(numerator, denominator) {
  return denominator > 0 ? Number((numerator / denominator).toFixed(4)) : 0;
}

function formatRate(value) {
  return `${(value * 100).toFixed(1)}%`;
}

function assertPrivateOutputPath(outputPath) {
  const normalized = path.resolve(outputPath);
  const allowedRoots = [
    path.resolve("tmp"),
    path.resolve(process.env.TMPDIR ?? "/tmp"),
    "/tmp",
    "/private/tmp",
  ];
  if (!allowedRoots.some((root) => normalized === root || normalized.startsWith(`${root}${path.sep}`))) {
    throw new Error("--output must stay under tmp/ or the system temp directory because product-quality scores derive from private review artifacts.");
  }
}

function printSummary(summary) {
  const status = summary.pass ? "pass" : "fail";
  console.log(`general-page product-quality gate: ${status}`);
  console.log(
    `reviewed ${summary.counts.reviewedCount}/${summary.counts.totalCount} ` +
    `(${formatRate(summary.rates.reviewedRate)}); ` +
    `acceptable ${formatRate(summary.rates.acceptableRate)}; ` +
    `bad ${formatRate(summary.rates.badRate)}`,
  );
  if (summary.failures.length > 0) {
    for (const failure of summary.failures)
      console.error(`- ${failure}`);
  }
}

main();
