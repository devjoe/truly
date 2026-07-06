#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const VERDICTS = new Set([
  "unreviewed",
  "good",
  "usable_with_caution",
  "partial",
  "bad",
  "blocked_or_empty_ok",
]);

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
  const labels = readLabels(args.labels);
  const followupPlan = readJson(args.plan);
  const clusterReport = buildQualityFollowupClusters(report, labels, followupPlan, {
    topClusters: args.topClusters,
    minClusterCount: args.minClusterCount,
  });

  const outputJson = args.output ?? path.join(path.dirname(args.plan), "quality-followups-clusters.json");
  const outputMarkdown = args.markdown ?? path.join(path.dirname(args.plan), "quality-followups-clusters.md");
  assertPrivateOutputPath(outputJson, "--output");
  assertPrivateOutputPath(outputMarkdown, "--markdown");
  assertPublicClusterReport(clusterReport);

  fs.mkdirSync(path.dirname(outputJson), { recursive: true });
  fs.writeFileSync(outputJson, `${JSON.stringify(clusterReport, null, 2)}\n`);
  fs.writeFileSync(outputMarkdown, renderQualityFollowupClustersMarkdown(clusterReport));

  console.log(`Wrote ${outputJson}`);
  console.log(`Wrote ${outputMarkdown}`);
  console.log(
    `clustered ${clusterReport.input.clusteredKeyRows} key-row matches ` +
    `(${clusterReport.input.uniqueClusteredRows} unique rows) across ${clusterReport.items.length} follow-up keys; ` +
    JSON.stringify(clusterReport.counts.byAction),
  );
}

function parseArgs(argv) {
  const review = stringArg(argv, "--review");
  const labels = stringArg(argv, "--labels");
  const plan = stringArg(argv, "--plan");
  if (!review || !labels || !plan) {
    console.error([
      "Usage:",
      "  node scripts/cluster-general-page-quality-followups.mjs",
      "    --review tmp/general-page-product-quality/review-.../review.json",
      "    --labels tmp/general-page-product-quality/review-.../manual-labels.jsonl",
      "    --plan tmp/general-page-product-quality/review-.../quality-followups-plan.json",
      "    [--output tmp/general-page-product-quality/review-.../quality-followups-clusters.json]",
      "    [--markdown tmp/general-page-product-quality/review-.../quality-followups-clusters.md]",
      "    [--top-clusters 6]",
      "    [--min-cluster-count 2]",
    ].join("\n"));
    process.exit(2);
  }
  return {
    review,
    labels,
    plan,
    output: stringArg(argv, "--output"),
    markdown: stringArg(argv, "--markdown"),
    topClusters: numericArg(argv, "--top-clusters", 6, { min: 1, max: 24 }),
    minClusterCount: numericArg(argv, "--min-cluster-count", 2, { min: 1, max: 50 }),
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

function buildQualityFollowupClusters(report, labels, followupPlan, options = {}) {
  const results = Array.isArray(report.results) ? report.results : [];
  if (results.length === 0)
    throw new Error("Review report must include a non-empty results array.");
  const planItems = Array.isArray(followupPlan.items) ? followupPlan.items : [];
  const reviewKeys = new Set(planItems
    .filter((item) => item.status === "needs_private_review" || item.status === "needs_fixture")
    .map((item) => item.key)
    .filter(Boolean));
  if (reviewKeys.size === 0)
    throw new Error("Follow-up plan must include needs_private_review or needs_fixture items.");

  const rows = results.map((item, index) => normalizeRow(item, labels.get(item.targetId), index));
  const itemReports = [];
  let clusteredKeyRows = 0;
  const uniqueClusteredSourceIndexes = new Set();

  for (const planItem of planItems) {
    if (!reviewKeys.has(planItem.key))
      continue;
    const matchingRows = rows.filter((row) => row.followUpKeys.includes(planItem.key));
    if (matchingRows.length === 0)
      continue;
    clusteredKeyRows += matchingRows.length;
    for (const row of matchingRows)
      uniqueClusteredSourceIndexes.add(row.sourceIndex);
    itemReports.push(clusterPlanItem(planItem, matchingRows, options));
  }

  const clusterReports = itemReports.flatMap((item) => item.clusters);
  const reportOut = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    privacyBoundary: "Public-safe structural clusters derived from private review artifacts. No URLs, titles, text previews, notes, screenshots, target ids, seed ids, or source content.",
    input: {
      totalRows: results.length,
      reviewedRows: rows.filter((row) => row.reviewed).length,
      clusteredKeyRows,
      uniqueClusteredRows: uniqueClusteredSourceIndexes.size,
      followupKeys: itemReports.length,
      sourceMode: safeString(report.input?.sourceMode, "unknown"),
    },
    thresholds: {
      minClusterCount: options.minClusterCount ?? 2,
      topClusters: options.topClusters ?? 6,
    },
    counts: {
      byAction: countValues(clusterReports.map((cluster) => cluster.recommendedAction)),
      byStatus: countValues(itemReports.map((item) => item.status)),
    },
    items: itemReports,
  };
  assertPublicClusterReport(reportOut);
  return reportOut;
}

function clusterPlanItem(planItem, rows, options) {
  const groups = new Map();
  for (const row of rows) {
    const signature = clusterSignature(row);
    const entry = groups.get(signature.key) ?? {
      signature,
      rows: [],
    };
    entry.rows.push(row);
    groups.set(signature.key, entry);
  }

  const minClusterCount = options.minClusterCount ?? 2;
  const clusters = [...groups.values()]
    .map((entry) => summarizeCluster(entry.signature, entry.rows, minClusterCount))
    .sort((a, b) => actionRank(a.recommendedAction) - actionRank(b.recommendedAction) || b.count - a.count || a.signature.label.localeCompare(b.signature.label))
    .slice(0, options.topClusters ?? 6);

  return {
    key: safeString(planItem.key, "unknown"),
    kind: safeString(planItem.kind, "unknown"),
    status: safeString(planItem.status, "unknown"),
    count: safeNumber(planItem.count),
    reviewedCount: safeNumber(planItem.reviewedCount),
    clusteredCount: rows.length,
    clusters,
  };
}

function normalizeRow(item, label, sourceIndex) {
  const verdict = VERDICTS.has(label?.verdict) ? label.verdict : "unreviewed";
  const autoTags = Array.isArray(item.autoReview?.issueTags) ? item.autoReview.issueTags : [];
  const labelTags = Array.isArray(label?.issueTags) ? label.issueTags : [];
  const issueTags = [...new Set([...labelTags, ...autoTags].filter((tag) => typeof tag === "string"))];
  const extraction = item.surface?.extraction ?? {};
  const document = item.document ?? {};
  return {
    sourceIndex,
    category: safeString(item.category, "uncategorized"),
    pageType: safeString(item.pageType, "unknown"),
    verdict,
    reviewed: verdict !== "unreviewed",
    autoSuggested: safeString(item.autoReview?.suggestedVerdict, "unknown"),
    readiness: safeString(item.modelContext?.modelReadiness, "unknown"),
    extractionMethod: safeString(extraction.method, item.errorKind ? "error" : "unknown"),
    extractionStatus: safeString(extraction.status, item.errorKind ? "error" : "unknown"),
    warnings: Array.isArray(extraction.warnings) ? extraction.warnings.map((warning) => safeString(warning, "unknown")) : [],
    issueTags,
    qualityIssues: Array.isArray(item.modelContext?.qualityIssues)
      ? item.modelContext.qualityIssues.map((issue) => safeString(issue, "unknown"))
      : [],
    document: {
      linkCount: safeNumber(document.linkCount),
      paragraphCount: safeNumber(document.paragraphCount),
      articleCount: safeNumber(document.articleCount),
      mainCount: safeNumber(document.mainCount),
      roleMainCount: safeNumber(document.roleMainCount),
      formCount: safeNumber(document.formCount),
      dialogCount: safeNumber(document.dialogCount),
      imageCount: safeNumber(document.imageCount),
      htmlLength: safeNumber(document.htmlLength),
      bodyTextLength: safeNumber(document.bodyTextLength),
      titlePresent: Boolean(document.titlePresent),
      hasCanonical: Boolean(document.hasCanonical),
      hasArticleMeta: Boolean(document.hasArticleMeta),
      hasOpenGraph: Boolean(document.hasOpenGraph),
    },
    surfaceTextLength: safeNumber(item.surface?.textLength),
    modelTextLength: safeNumber(item.modelContext?.textLength),
    linkCount: safeNumber(item.surface?.linkCount),
    imageCount: safeNumber(item.surface?.imageCount),
    followUpKeys: candidateKeysForRow({
      verdict,
      autoSuggested: safeString(item.autoReview?.suggestedVerdict, "unknown"),
      issueTags,
    }),
  };
}

function candidateKeysForRow(row) {
  const candidates = [];
  if (row.verdict === "bad")
    candidates.push("manual:bad-regression");
  if (row.autoSuggested === "good" && ["usable_with_caution", "partial", "bad", "blocked_or_empty_ok"].includes(row.verdict))
    candidates.push("auto:overconfident-good");
  if (row.autoSuggested === "blocked_or_empty_review" && ["good", "usable_with_caution", "partial"].includes(row.verdict))
    candidates.push("auto:underconfident-blocked");
  if (row.verdict === "usable_with_caution")
    candidates.push("manual:usable-with-caution");
  if (row.verdict === "partial")
    candidates.push("manual:partial-extraction");
  for (const tag of row.issueTags)
    candidates.push(`issue:${tag}`);
  return [...new Set(candidates)];
}

function clusterSignature(row) {
  const dominantTags = dominantIssueTags(row.issueTags);
  const docShape = documentShape(row);
  const textShape = textShapeFor(row);
  const labelParts = [
    row.extractionMethod,
    row.extractionStatus,
    row.readiness,
    docShape,
    textShape,
    dominantTags.join("+") || "no-issue-tag",
  ];
  return {
    key: labelParts.join("|"),
    label: labelParts.join(" / "),
    extraction: `${row.extractionMethod}/${row.extractionStatus}`,
    readiness: row.readiness,
    documentShape: docShape,
    textShape,
    dominantIssueTags: dominantTags,
  };
}

function dominantIssueTags(issueTags) {
  const preferred = [
    "recirc-leak",
    "body-miss",
    "truncated-body",
    "index-like-ready",
    "thin-hub-page",
    "teaser-hub-page",
    "empty-listing",
    "js-rendered-site",
    "member-gated-teaser",
    "leading-ticker-noise",
    "many-source-links",
    "warning:login-or-paywall-like",
    "warning:very-short-content",
    "quality:no_main_content",
    "warning:no-main-content",
    "quality:large_navigation_noise",
    "warning:large-navigation-noise",
    "quality:partial_extraction",
    "partial",
    "quality:fallback_extraction",
    "fallback",
  ];
  const set = new Set(issueTags);
  return preferred.filter((tag) => set.has(tag)).slice(0, 4);
}

function documentShape(row) {
  const doc = row.document;
  const parts = [];
  parts.push(doc.articleCount > 1 ? "multi-article" : doc.articleCount === 1 ? "single-article" : "no-article");
  parts.push((doc.mainCount + doc.roleMainCount) > 0 ? "has-main" : "no-main");
  if (doc.linkCount >= 500)
    parts.push("extreme-links");
  else if (doc.linkCount >= 120)
    parts.push("dense-links");
  else if (doc.linkCount >= 40)
    parts.push("many-links");
  else
    parts.push("few-links");
  if (doc.paragraphCount >= 20)
    parts.push("many-paragraphs");
  else if (doc.paragraphCount >= 5)
    parts.push("some-paragraphs");
  else
    parts.push("few-paragraphs");
  if (doc.formCount > 0 || doc.dialogCount > 0)
    parts.push("forms-or-dialogs");
  if (!doc.hasCanonical && !doc.hasOpenGraph && !doc.hasArticleMeta)
    parts.push("thin-metadata");
  return parts.join("+");
}

function textShapeFor(row) {
  const extracted = row.modelTextLength || row.surfaceTextLength;
  const body = row.document.bodyTextLength;
  const ratio = body > 0 ? extracted / body : 0;
  const lengthBucket = extracted >= 2400 ? "long-context" : extracted >= 800 ? "medium-context" : extracted > 0 ? "short-context" : "empty-context";
  const ratioBucket = ratio >= 0.25 ? "body-covered" : ratio >= 0.05 ? "body-thin" : "body-missed";
  return `${lengthBucket}+${ratioBucket}`;
}

function summarizeCluster(signature, rows, minClusterCount) {
  const action = recommendedActionFor(signature, rows, minClusterCount);
  return {
    signature,
    count: rows.length,
    reviewedCount: rows.filter((row) => row.reviewed).length,
    recommendedAction: action,
    evidence: {
      categories: topCounts(rows.map((row) => row.category), 6),
      pageTypes: topCounts(rows.map((row) => row.pageType), 6),
      verdicts: countValues(rows.map((row) => row.verdict)),
      autoSuggested: countValues(rows.map((row) => row.autoSuggested)),
      readiness: countValues(rows.map((row) => row.readiness)),
      extraction: countValues(rows.map((row) => `${row.extractionMethod}/${row.extractionStatus}`)),
      issueTags: topCounts(rows.flatMap((row) => row.issueTags), 10),
      documentShapes: countValues(rows.map((row) => documentShape(row))),
      textShapes: countValues(rows.map((row) => textShapeFor(row))),
      medians: {
        documentLinks: median(rows.map((row) => row.document.linkCount)),
        documentParagraphs: median(rows.map((row) => row.document.paragraphCount)),
        bodyTextLength: median(rows.map((row) => row.document.bodyTextLength)),
        modelTextLength: median(rows.map((row) => row.modelTextLength)),
      },
    },
    suggestedFixtureShape: suggestedFixtureShapeFor(signature, action),
  };
}

function recommendedActionFor(signature, rows, minClusterCount) {
  const tags = new Set(rows.flatMap((row) => row.issueTags));
  const hasBad = rows.some((row) => row.verdict === "bad");
  const hasFalseReady = rows.some((row) => row.autoSuggested === "good" && row.verdict !== "good");
  if (rows.length >= minClusterCount && (hasBad || hasFalseReady))
    return "fixture_candidate";
  if (rows.length >= minClusterCount && (
    tags.has("body-miss") ||
    tags.has("recirc-leak") ||
    tags.has("truncated-body") ||
    tags.has("js-rendered-site") ||
    tags.has("teaser-hub-page") ||
    tags.has("empty-listing") ||
    signature.textShape.includes("body-missed")
  )) {
    return "fixture_candidate";
  }
  if (rows.length >= minClusterCount && (
    tags.has("partial") ||
    tags.has("fallback") ||
    tags.has("quality:partial_extraction") ||
    tags.has("quality:fallback_extraction") ||
    tags.has("quality:no_main_content")
  )) {
    return "heuristic_review";
  }
  return "private_review_only";
}

function suggestedFixtureShapeFor(signature, action) {
  if (action === "fixture_candidate") {
    if (signature.dominantIssueTags.includes("js-rendered-site"))
      return "Synthetic JS-rendered shell with rendered body below a nested app root; no copied framework markup.";
    if (signature.dominantIssueTags.includes("recirc-leak"))
      return "Synthetic magazine/news page where related-story teasers appear before or around the real article body.";
    if (signature.dominantIssueTags.includes("body-miss") || signature.textShape.includes("body-missed"))
      return "Synthetic article where visible body exists but naive container choice captures navigation, teaser, or empty shell instead.";
    if (signature.dominantIssueTags.includes("index-like-ready") || signature.dominantIssueTags.includes("thin-hub-page"))
      return "Synthetic semantic main hub with dense cards that must be demoted despite clean metadata.";
    return "Synthetic page matching the structural signature with fake prose, fake names, and example.test links only.";
  }
  if (action === "heuristic_review")
    return "Use existing fixtures first; add a new synthetic fixture only if private examples share one DOM shape.";
  return "Keep as private observation until more reviewed examples repeat the same structure.";
}

function actionRank(action) {
  if (action === "fixture_candidate") return 0;
  if (action === "heuristic_review") return 1;
  return 2;
}

function median(values) {
  const clean = values.filter((value) => Number.isFinite(value)).sort((a, b) => a - b);
  if (clean.length === 0) return 0;
  const mid = Math.floor(clean.length / 2);
  return clean.length % 2 ? clean[mid] : Number(((clean[mid - 1] + clean[mid]) / 2).toFixed(1));
}

function topCounts(values, limit) {
  return Object.entries(countValues(values))
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([value, count]) => ({ value, count }));
}

function countValues(values) {
  return values.reduce((counts, value) => {
    counts[safeString(value, "unknown")] = (counts[safeString(value, "unknown")] ?? 0) + 1;
    return counts;
  }, {});
}

function safeString(value, fallback) {
  if (typeof value !== "string" || !value.trim())
    return fallback;
  const clean = value.trim().replace(/\s+/g, "-").slice(0, 140);
  if (FORBIDDEN_STRING_PATTERNS.some((pattern) => pattern.test(clean)))
    return fallback;
  return clean;
}

function safeNumber(value) {
  return Number.isFinite(value) ? value : 0;
}

function renderQualityFollowupClustersMarkdown(report) {
  const sections = report.items.map((item) => {
    const rows = item.clusters.map((cluster) => [
      cluster.recommendedAction,
      cluster.count,
      cluster.reviewedCount,
      cluster.signature.label,
      topLabels(cluster.evidence.categories),
      topLabels(cluster.evidence.issueTags),
      cluster.suggestedFixtureShape,
    ].map(markdownCell));
    return `## ${markdownCell(item.key)}

Status: ${markdownCell(item.status)}
Rows: ${item.clusteredCount}

| Action | Count | Reviewed | Signature | Categories | Issue tags | Fixture shape |
| --- | ---: | ---: | --- | --- | --- | --- |
${rows.map((row) => `| ${row.join(" | ")} |`).join("\n")}`;
  }).join("\n\n");

  return `# General Page Quality Follow-Up Clusters

Generated: ${report.generatedAt}
Source mode: ${report.input.sourceMode}
Reviewed: ${report.input.reviewedRows}/${report.input.totalRows}
Clustered key-row matches: ${report.input.clusteredKeyRows}
Unique clustered rows: ${report.input.uniqueClusteredRows}

${report.privacyBoundary}

## Action Counts

\`\`\`json
${JSON.stringify(report.counts.byAction, null, 2)}
\`\`\`

${sections}
`;
}

function topLabels(items) {
  return items.map((item) => `${item.value} (${item.count})`).join(", ") || "(none)";
}

function markdownCell(value) {
  return String(value).replace(/\|/g, "\\|").replace(/\n/g, " ");
}

function assertPublicClusterReport(value, pathLabel = "clusterReport") {
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertPublicClusterReport(item, `${pathLabel}[${index}]`));
    return;
  }
  if (value && typeof value === "object") {
    for (const [key, nested] of Object.entries(value)) {
      if (FORBIDDEN_KEYS.has(key))
        throw new Error(`Quality follow-up clusters must not include private field ${pathLabel}.${key}`);
      assertPublicClusterReport(nested, `${pathLabel}.${key}`);
    }
    return;
  }
  if (typeof value !== "string") return;
  for (const pattern of FORBIDDEN_STRING_PATTERNS) {
    if (pattern.test(value))
      throw new Error(`Quality follow-up clusters must not include private-looking string at ${pathLabel}`);
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
    throw new Error(`${label} must stay under tmp/ or the system temp directory because quality follow-up clusters derive from private review artifacts.`);
  }
}

function isDirectRun() {
  return process.argv[1] && import.meta.url === new URL(process.argv[1], "file:").href;
}

export {
  assertPublicClusterReport,
  buildQualityFollowupClusters,
  parseArgs as parseQualityFollowupClusterArgs,
  renderQualityFollowupClustersMarkdown,
};
