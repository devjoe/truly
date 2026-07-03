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

const PUBLIC_SUMMARY_FORBIDDEN_KEYS = new Set([
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

const PUBLIC_SUMMARY_FORBIDDEN_STRING_PATTERNS = [
  /https?:\/\//i,
  /<!doctype/i,
  /<html/i,
];

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
  const report = readJson(args.review);
  const labels = args.labels ? readLabels(args.labels) : new Map();
  const summary = buildQualityFindingsSummary(report, labels, {
    top: args.top,
  });

  const outputJson = args.output ?? path.join(path.dirname(args.review), "quality-findings-summary.json");
  const outputMarkdown = args.markdown ?? path.join(path.dirname(args.review), "quality-findings-summary.md");
  assertPrivateOutputPath(outputJson, "--output");
  assertPrivateOutputPath(outputMarkdown, "--markdown");
  assertPublicQualityFindingsSummary(summary);

  fs.mkdirSync(path.dirname(outputJson), { recursive: true });
  fs.writeFileSync(outputJson, `${JSON.stringify(summary, null, 2)}\n`);
  fs.writeFileSync(outputMarkdown, renderQualityFindingsMarkdown(summary));

  console.log(`Wrote ${outputJson}`);
  console.log(`Wrote ${outputMarkdown}`);
  console.log(`reviewed ${summary.counts.reviewedCount}/${summary.counts.totalCount}; candidates ${summary.followUpCandidates.length}`);
}

function parseArgs(argv) {
  const review = stringArg(argv, "--review") ?? stringArg(argv, "--input");
  if (!review) {
    console.error([
      "Usage:",
      "  node scripts/summarize-general-page-quality-findings.mjs",
      "    --review tmp/general-page-product-quality/review-.../review.json",
      "    [--labels tmp/general-page-product-quality/review-.../manual-labels.jsonl]",
      "    [--output tmp/general-page-product-quality/review-.../quality-findings-summary.json]",
      "    [--markdown tmp/general-page-product-quality/review-.../quality-findings-summary.md]",
      "    [--top 12]",
    ].join("\n"));
    process.exit(2);
  }
  return {
    review,
    labels: stringArg(argv, "--labels"),
    output: stringArg(argv, "--output"),
    markdown: stringArg(argv, "--markdown"),
    top: numericArg(argv, "--top", 12, { min: 1, max: 50 }),
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
      verdict: parsed.verdict,
      issueTags: Array.isArray(parsed.issueTags)
        ? parsed.issueTags.filter((tag) => typeof tag === "string")
        : [],
    });
  }
  return labels;
}

function buildQualityFindingsSummary(report, labels = new Map(), options = {}) {
  const results = Array.isArray(report.results) ? report.results : [];
  if (results.length === 0)
    throw new Error("Review report must include a non-empty results array.");

  const rows = results.map((item) => normalizeReviewRow(item, labels.get(item.targetId)));
  const reviewedRows = rows.filter((row) => row.reviewed);
  const candidateMap = new Map();
  for (const row of rows) {
    for (const candidate of candidateKeysForRow(row)) {
      const entry = candidateMap.get(candidate.key) ?? {
        key: candidate.key,
        kind: candidate.kind,
        priority: candidate.priority,
        count: 0,
        reviewedCount: 0,
        recommendation: recommendationForKind(candidate.kind),
        rows: [],
      };
      entry.count += 1;
      if (row.reviewed)
        entry.reviewedCount += 1;
      entry.rows.push(row);
      candidateMap.set(candidate.key, entry);
    }
  }

  const followUpCandidates = [...candidateMap.values()]
    .sort((a, b) => b.priority - a.priority || b.count - a.count || a.key.localeCompare(b.key))
    .slice(0, options.top ?? 12)
    .map((candidate) => summarizeCandidate(candidate));

  const summary = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    privacyBoundary: "Public-safe aggregate only. No URLs, titles, text previews, notes, screenshots, target ids, seed ids, or source content.",
    input: {
      totalCount: rows.length,
      reviewedCount: reviewedRows.length,
      sourceMode: typeof report.input?.sourceMode === "string" ? report.input.sourceMode : "unknown",
      labelsProvided: labels.size > 0,
    },
    counts: {
      totalCount: rows.length,
      reviewedCount: reviewedRows.length,
      verdicts: countValues(rows.map((row) => row.verdict)),
      autoSuggested: countValues(rows.map((row) => row.autoSuggested)),
      readiness: countValues(rows.map((row) => row.readiness)),
      extractionStatus: countValues(rows.map((row) => row.extractionStatus)),
      extractionMethod: countValues(rows.map((row) => row.extractionMethod)),
    },
    topIssueTags: topCounts(rows.flatMap((row) => row.issueTags), 24),
    byCategory: groupedCounts(rows, "category"),
    byPageType: groupedCounts(rows, "pageType"),
    followUpCandidates,
  };
  assertPublicQualityFindingsSummary(summary);
  return summary;
}

function normalizeReviewRow(item, label) {
  const verdict = label?.verdict ?? item.manualReview?.verdict ?? "unreviewed";
  const autoIssueTags = Array.isArray(item.autoReview?.issueTags) ? item.autoReview.issueTags : [];
  const labelIssueTags = Array.isArray(label?.issueTags) ? label.issueTags : [];
  const issueTags = [...new Set([...labelIssueTags, ...autoIssueTags].filter((tag) => typeof tag === "string"))];
  return {
    category: safeGroupValue(item.category, "uncategorized"),
    pageType: safeGroupValue(item.pageType, "unknown"),
    verdict: VERDICTS.has(verdict) ? verdict : "unreviewed",
    reviewed: verdict !== "unreviewed",
    autoSuggested: safeGroupValue(item.autoReview?.suggestedVerdict, "unknown"),
    readiness: safeGroupValue(item.modelContext?.modelReadiness, "unknown"),
    extractionStatus: safeGroupValue(item.surface?.extraction?.status, item.errorKind ? "error" : "unknown"),
    extractionMethod: safeGroupValue(item.surface?.extraction?.method, item.errorKind ? "error" : "unknown"),
    issueTags,
  };
}

function safeGroupValue(value, fallback) {
  if (typeof value !== "string" || !value.trim())
    return fallback;
  const clean = value.trim().replace(/\s+/g, "-").slice(0, 120);
  if (/https?:\/\//i.test(clean))
    return fallback;
  return clean;
}

function candidateKeysForRow(row) {
  const candidates = [];
  if (row.verdict === "bad") {
    candidates.push({
      key: "manual:bad-regression",
      kind: "bad-regression",
      priority: 100,
    });
  }
  if (row.autoSuggested === "good" && ["usable_with_caution", "bad", "blocked_or_empty_ok"].includes(row.verdict)) {
    candidates.push({
      key: "auto:overconfident-good",
      kind: "auto-overconfident-good",
      priority: 90,
    });
  }
  if (row.autoSuggested === "blocked_or_empty_review" && ["good", "usable_with_caution"].includes(row.verdict)) {
    candidates.push({
      key: "auto:underconfident-blocked",
      kind: "auto-underconfident-blocked",
      priority: 85,
    });
  }
  if (row.verdict === "usable_with_caution") {
    candidates.push({
      key: "manual:usable-with-caution",
      kind: "manual-caution-pattern",
      priority: 70,
    });
  }
  for (const tag of row.issueTags) {
    candidates.push({
      key: `issue:${tag}`,
      kind: "issue-tag-cluster",
      priority: issuePriority(tag),
    });
  }
  return candidates;
}

function issuePriority(tag) {
  if (/quality:|warning:|likely-index|paywall|blocked|empty|fallback|partial/.test(tag))
    return 55;
  return 40;
}

function summarizeCandidate(candidate) {
  const rows = candidate.rows;
  return {
    key: candidate.key,
    kind: candidate.kind,
    priority: candidate.priority,
    count: candidate.count,
    reviewedCount: candidate.reviewedCount,
    recommendation: candidate.recommendation,
    categories: topCounts(rows.map((row) => row.category), 6),
    pageTypes: topCounts(rows.map((row) => row.pageType), 6),
    verdicts: countValues(rows.map((row) => row.verdict)),
    autoSuggested: countValues(rows.map((row) => row.autoSuggested)),
    readiness: countValues(rows.map((row) => row.readiness)),
    extractionStatus: countValues(rows.map((row) => row.extractionStatus)),
    extractionMethod: countValues(rows.map((row) => row.extractionMethod)),
    topIssueTags: topCounts(rows.flatMap((row) => row.issueTags), 10),
  };
}

function recommendationForKind(kind) {
  if (kind === "bad-regression")
    return "Create a synthetic fixture for the clustered DOM pattern, then fix extraction or readiness before model context.";
  if (kind === "auto-overconfident-good")
    return "Treat as a false-ready risk: add fixture coverage and demote readiness or advisor decision until the model path is honest.";
  if (kind === "auto-underconfident-blocked")
    return "Treat as a false-negative risk: add fixture coverage for body recovery or candidate-block selection before tightening blockers.";
  if (kind === "manual-caution-pattern")
    return "Cluster reviewer notes privately, then convert repeated structure into a synthetic caution fixture if it persists.";
  return "Inspect private examples for a repeated structure; convert only the pattern into public synthetic coverage.";
}

function groupedCounts(rows, key) {
  const groups = new Map();
  for (const row of rows) {
    const group = row[key] || "unknown";
    const entry = groups.get(group) ?? {
      totalCount: 0,
      reviewedCount: 0,
      verdicts: {},
      autoSuggested: {},
      readiness: {},
      extractionStatus: {},
      topIssueTags: [],
    };
    entry.totalCount += 1;
    if (row.reviewed)
      entry.reviewedCount += 1;
    entry.verdicts[row.verdict] = (entry.verdicts[row.verdict] ?? 0) + 1;
    entry.autoSuggested[row.autoSuggested] = (entry.autoSuggested[row.autoSuggested] ?? 0) + 1;
    entry.readiness[row.readiness] = (entry.readiness[row.readiness] ?? 0) + 1;
    entry.extractionStatus[row.extractionStatus] = (entry.extractionStatus[row.extractionStatus] ?? 0) + 1;
    entry._issueTags ??= [];
    entry._issueTags.push(...row.issueTags);
    groups.set(group, entry);
  }
  return Object.fromEntries([...groups.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([group, entry]) => {
    const { _issueTags, ...publicEntry } = entry;
    publicEntry.topIssueTags = topCounts(_issueTags ?? [], 8);
    return [group, publicEntry];
  }));
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

function renderQualityFindingsMarkdown(summary) {
  const candidateRows = summary.followUpCandidates.map((candidate) => [
    candidate.key,
    candidate.kind,
    candidate.count,
    candidate.reviewedCount,
    topLabels(candidate.categories),
    topLabels(candidate.topIssueTags),
    candidate.recommendation,
  ].map(markdownCell));

  return `# General Page Product-Quality Findings Summary

Generated: ${summary.generatedAt}
Source mode: ${summary.input.sourceMode}
Reviewed: ${summary.counts.reviewedCount}/${summary.counts.totalCount}

${summary.privacyBoundary}

## Counts

\`\`\`json
${JSON.stringify(summary.counts, null, 2)}
\`\`\`

## Top Issue Tags

${summary.topIssueTags.map((item) => `- ${markdownCell(item.value)}: ${item.count}`).join("\n") || "- (none)"}

## Follow-Up Candidates

| Key | Kind | Count | Reviewed | Categories | Issue tags | Recommendation |
| --- | --- | ---: | ---: | --- | --- | --- |
${candidateRows.map((row) => `| ${row.join(" | ")} |`).join("\n")}
`;
}

function topLabels(items) {
  return items.map((item) => `${item.value} (${item.count})`).join(", ") || "(none)";
}

function markdownCell(value) {
  return String(value).replace(/\|/g, "\\|").replace(/\n/g, " ");
}

function assertPublicQualityFindingsSummary(value, pathLabel = "summary") {
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertPublicQualityFindingsSummary(item, `${pathLabel}[${index}]`));
    return;
  }
  if (value && typeof value === "object") {
    for (const [key, nested] of Object.entries(value)) {
      if (PUBLIC_SUMMARY_FORBIDDEN_KEYS.has(key))
        throw new Error(`Quality findings summary must not include private field ${pathLabel}.${key}`);
      assertPublicQualityFindingsSummary(nested, `${pathLabel}.${key}`);
    }
    return;
  }
  if (typeof value !== "string") return;
  for (const pattern of PUBLIC_SUMMARY_FORBIDDEN_STRING_PATTERNS) {
    if (pattern.test(value))
      throw new Error(`Quality findings summary must not include private-looking string at ${pathLabel}`);
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
    throw new Error(`${label} must stay under tmp/ or the system temp directory because quality findings derive from private review artifacts.`);
  }
}

function isDirectRun() {
  return process.argv[1] && import.meta.url === new URL(process.argv[1], "file:").href;
}

export {
  assertPublicQualityFindingsSummary,
  buildQualityFindingsSummary,
  parseArgs as parseQualityFindingsArgs,
  renderQualityFindingsMarkdown,
};
