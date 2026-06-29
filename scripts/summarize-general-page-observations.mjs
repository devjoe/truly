#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const OUTPUT_DIR = "tmp/general-page-observations";
const DEFAULT_OUTPUT = path.join(OUTPUT_DIR, "latest-aggregate.json");
const OBSERVED_CATEGORY_MIN_CATEGORIES = 2;
const OBSERVED_CATEGORY_MIN_TOTAL = 2;

const inputPath = process.argv[2];
if (!inputPath) {
  console.error("Usage: npm run summarize:general-page-observations -- <tmp-observation-report.json> [output.json]");
  process.exit(2);
}

const outputPath = process.argv[3] ?? DEFAULT_OUTPUT;
const report = JSON.parse(fs.readFileSync(inputPath, "utf8"));
const summary = summarize(report);

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, `${JSON.stringify(summary, null, 2)}\n`);
printSummary(summary, outputPath);

function summarize(report) {
  const results = Array.isArray(report.results) ? report.results : [];
  const okResults = results.filter((item) => item.ok);
  const categoryStats = new Map();
  const patternStats = new Map();
  const focusPatternStats = new Map();
  const riskStats = new Map();

  for (const item of results) {
    const category = item.category ?? "Uncategorized";
    const categoryEntry = getStat(categoryStats, category);
    categoryEntry.total += 1;
    if (item.ok)
      categoryEntry.ok += 1;
    else
      categoryEntry.errors += 1;

    for (const risk of item.risks ?? []) {
      categoryEntry.risks[risk] = (categoryEntry.risks[risk] ?? 0) + 1;
      riskStats.set(risk, (riskStats.get(risk) ?? 0) + 1);
    }
    for (const pattern of item.patternHints ?? []) {
      categoryEntry.patternHints[pattern] = (categoryEntry.patternHints[pattern] ?? 0) + 1;
      const patternEntry = getPatternStat(patternStats, pattern);
      patternEntry.total += 1;
      patternEntry.categories[category] = (patternEntry.categories[category] ?? 0) + 1;
    }
    for (const pattern of item.focusPatterns ?? []) {
      const focusEntry = getPatternStat(focusPatternStats, pattern);
      focusEntry.total += 1;
      focusEntry.categories[category] = (focusEntry.categories[category] ?? 0) + 1;
      if (item.ok)
        focusEntry.ok = (focusEntry.ok ?? 0) + 1;
      else
        focusEntry.errors = (focusEntry.errors ?? 0) + 1;
    }
  }

  return {
    generatedAt: new Date().toISOString(),
    sourceReportKind: "private-structure-only",
    publicSafety: {
      containsUrls: false,
      containsLabels: false,
      containsHtml: false,
      containsTextExcerpts: false,
      note: "This aggregate intentionally omits per-target URLs, labels, HTML, text, screenshots, and DOM snapshots.",
    },
    targetCount: results.length,
    okCount: okResults.length,
    errorCount: results.length - okResults.length,
    categories: Object.fromEntries([...categoryStats.entries()].sort()),
    risks: Object.fromEntries([...riskStats.entries()].sort()),
    patterns: Object.fromEntries(
      [...patternStats.entries()]
        .sort()
        .map(([pattern, value]) => [pattern, {
          total: value.total,
          categories: Object.fromEntries(Object.entries(value.categories).sort()),
          evidenceStatus: resolveEvidenceStatus(value),
        }]),
    ),
    focusPatterns: Object.fromEntries(
      [...focusPatternStats.entries()]
        .sort()
        .map(([pattern, value]) => [pattern, {
          total: value.total,
          ok: value.ok ?? 0,
          errors: value.errors ?? 0,
          categories: Object.fromEntries(Object.entries(value.categories).sort()),
          evidenceStatus: resolveFocusEvidenceStatus(value),
        }]),
    ),
  };
}

function getStat(map, key) {
  if (!map.has(key)) {
    map.set(key, {
      total: 0,
      ok: 0,
      errors: 0,
      risks: {},
      patternHints: {},
    });
  }
  return map.get(key);
}

function getPatternStat(map, key) {
  if (!map.has(key)) {
    map.set(key, {
      total: 0,
      categories: {},
    });
  }
  return map.get(key);
}

function resolveEvidenceStatus(value) {
  const categoryCount = Object.keys(value.categories).length;
  if (value.total >= OBSERVED_CATEGORY_MIN_TOTAL && categoryCount >= OBSERVED_CATEGORY_MIN_CATEGORIES)
    return "observed-category";
  return "needs-more-observation";
}

function resolveFocusEvidenceStatus(value) {
  const ok = value.ok ?? 0;
  if (ok >= OBSERVED_CATEGORY_MIN_TOTAL)
    return "observed-category";
  return "needs-more-observation";
}

function printSummary(summary, outputPath) {
  console.log(`Wrote ${outputPath}`);
  console.log(`observed ${summary.okCount}/${summary.targetCount}; errors ${summary.errorCount}`);
  console.log(`patterns ${Object.keys(summary.patterns).length}`);
}
