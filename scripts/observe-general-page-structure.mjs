#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { JSDOM } from "jsdom";

const OUTPUT_DIR = "tmp/general-page-observations";
const REPORT_DATE = process.env.TRULY_OBSERVATION_DATE ?? new Date().toISOString().slice(0, 10);
const REPORT_PATH = path.join(OUTPUT_DIR, `structure-observations-${REPORT_DATE}.json`);
const FETCH_TIMEOUT_MS = 15_000;
const USER_AGENT = "TrulyGeneralPageReaderObservation/0.1 (+https://example.test/truly)";

const targets = readTargets(process.argv.slice(2));
if (targets.length === 0) {
  console.error("Usage: npm run observe:general-page-structure -- <url> [url...]");
  console.error("   or: npm run observe:general-page-structure -- --input tmp/targets.json");
  process.exit(2);
}

const results = [];
for (const target of targets) {
  try {
    results.push(await observeTarget(target));
  } catch (error) {
    results.push({
      url: target.url,
      label: target.label,
      category: target.category,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

const report = {
  generatedAt: new Date().toISOString(),
  privacyBoundary: "Private tmp report. Do not commit. Contains structure-only summaries; no HTML, text excerpts, screenshots, or DOM snapshots.",
  targetCount: targets.length,
  results,
  aggregate: aggregate(results),
};

fs.mkdirSync(OUTPUT_DIR, { recursive: true });
fs.writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`);
printSummary(report);

function readTargets(args) {
  const inputIndex = args.indexOf("--input");
  if (inputIndex >= 0) {
    const file = args[inputIndex + 1];
    if (!file)
      throw new Error("--input requires a JSON file path.");
    const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
    if (!Array.isArray(parsed))
      throw new Error("Observation input file must be an array.");
    return parsed.map(normalizeTarget);
  }
  return args
    .filter((arg) => !arg.startsWith("--"))
    .map((url) => normalizeTarget({ url }));
}

function normalizeTarget(target) {
  if (!target || typeof target.url !== "string")
    throw new Error(`Invalid observation target: ${JSON.stringify(target)}`);
  return {
    url: target.url,
    label: target.label,
    category: target.category,
    focusPatterns: Array.isArray(target.focusPatterns) ? target.focusPatterns : [],
  };
}

async function observeTarget(target) {
  const response = await fetch(target.url, {
    redirect: "follow",
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    headers: {
      "user-agent": USER_AGENT,
      "accept": "text/html,application/xhtml+xml",
    },
  });
  const contentType = response.headers.get("content-type") ?? "";
  const html = await response.text();
  const dom = new JSDOM(html, { url: response.url });
  const document = dom.window.document;
  const signals = collectSignals(document, html.length, target);
  return {
    url: target.url,
    finalUrl: response.url,
    label: target.label,
    category: target.category,
    focusPatterns: target.focusPatterns,
    ok: response.ok,
    status: response.status,
    contentType: contentType.split(";")[0],
    structure: signals.structure,
    metadata: signals.metadata,
    noise: signals.noise,
    risks: signals.risks,
    patternHints: signals.patternHints,
  };
}

function collectSignals(document, htmlLength, target) {
  const structure = {
    htmlLength,
    lang: document.documentElement.getAttribute("lang") || undefined,
    titlePresent: Boolean(document.querySelector("title")?.textContent?.trim()),
    bodyTextLength: normalizedLength(document.body?.textContent ?? ""),
    articleCount: count(document, "article"),
    mainCount: count(document, "main"),
    roleMainCount: count(document, "[role='main'], [role=\"main\"]"),
    sectionCount: count(document, "section"),
    navCount: count(document, "nav"),
    asideCount: count(document, "aside"),
    headerCount: count(document, "header"),
    footerCount: count(document, "footer"),
    formCount: count(document, "form"),
    dialogCount: count(document, "[role='dialog'], [role=\"dialog\"], dialog"),
    h1Count: count(document, "h1"),
    paragraphCount: count(document, "p"),
    linkCount: count(document, "a[href]"),
    imageCount: count(document, "img"),
    timeCount: count(document, "time[datetime]"),
    scriptCount: count(document, "script"),
    noscriptCount: count(document, "noscript"),
  };

  const metadata = {
    canonical: Boolean(document.querySelector("link[rel='canonical'], link[rel='Canonical']")),
    amphtml: Boolean(document.querySelector("link[rel='amphtml']")),
    openGraphCount: count(document, "meta[property^='og:']"),
    twitterCardCount: count(document, "meta[name^='twitter:']"),
    articleMetaCount: count(document, "meta[property^='article:']"),
    jsonLdCount: count(document, "script[type='application/ld+json']"),
    authorMeta: Boolean(document.querySelector("meta[name='author'], meta[property='article:author']")),
    dateMeta: Boolean(document.querySelector("meta[name='date'], meta[property='article:published_time'], time[datetime]")),
  };

  const bodyTextLength = structure.bodyTextLength;
  const chromeTextLength = textLengthFor(document, "header, nav, aside, footer");
  const dialogTextLength = textLengthFor(document, "[role='dialog'], dialog");
  const mainTextLength = textLengthFor(document, "article, main, [role='main'], [role=\"main\"]");
  const fullText = document.body?.textContent ?? "";
  const noise = {
    chromeTextRatio: ratio(chromeTextLength, bodyTextLength),
    dialogTextRatio: ratio(dialogTextLength, bodyTextLength),
    mainTextRatio: ratio(mainTextLength, bodyTextLength),
    linkDensity: ratio(structure.linkCount, Math.max(1, structure.paragraphCount)),
  };

  const risks = [
    structure.articleCount === 0 ? "no-article-element" : undefined,
    structure.mainCount === 0 && structure.roleMainCount === 0 ? "no-main-container" : undefined,
    structure.articleCount > 1 ? "multi-article-page" : undefined,
    noise.chromeTextRatio > 0.35 ? "high-navigation-or-sidebar-text" : undefined,
    noise.dialogTextRatio > 0.05 ? "dialog-or-consent-overlay" : undefined,
    looksLoginOrPaywall(fullText) ? "login-or-paywall-like" : undefined,
    noise.linkDensity > 4 && structure.articleCount === 0 ? "list-or-index-like" : undefined,
    isDocsCategory(target.category) ? "documentation-like-category" : undefined,
    isForumCategory(target.category) ? "discussion-like-category" : undefined,
    isSocialCategory(target.category) ? "social-public-like-category" : undefined,
    structure.scriptCount > 20 && bodyTextLength < 500 ? "script-heavy-low-text-shell" : undefined,
    metadata.canonical && metadata.amphtml ? "canonical-amp-variant" : undefined,
    metadata.openGraphCount === 0 && metadata.jsonLdCount === 0 ? "sparse-metadata" : undefined,
  ].filter(Boolean);

  return {
    structure,
    metadata,
    noise,
    risks,
    patternHints: patternHints(structure, metadata, noise, risks, target),
  };
}

function patternHints(structure, metadata, noise, risks, target) {
  const hints = new Set();
  if (structure.articleCount === 1)
    hints.add("P01-semantic-article");
  if (structure.articleCount === 0 && (structure.mainCount > 0 || structure.roleMainCount > 0))
    hints.add("P02-main-role-without-article");
  if (risks.includes("high-navigation-or-sidebar-text"))
    hints.add("P03-navigation-sidebar-noise");
  if (structure.asideCount > 0 && structure.linkCount > structure.paragraphCount)
    hints.add("P04-related-content-recirc");
  if (risks.includes("list-or-index-like"))
    hints.add("P05-list-or-index-page");
  if (isDocsCategory(target.category))
    hints.add("P06-nested-documentation-layout");
  if (isDocsCategory(target.category) && structure.linkCount > 20)
    hints.add("P07-api-reference-multipanel");
  if (structure.articleCount > 1 || risks.includes("multi-article-page"))
    hints.add("P08-forum-thread");
  if (isForumCategory(target.category) && structure.formCount > 0)
    hints.add("P09-q-and-a-page");
  if (isSocialCategory(target.category))
    hints.add("P10-feed-like-social-page");
  if (risks.includes("login-or-paywall-like"))
    hints.add("P11-paywall-or-membership");
  if (risks.includes("dialog-or-consent-overlay"))
    hints.add("P13-consent-and-overlay");
  if (risks.includes("script-heavy-low-text-shell"))
    hints.add("P14-client-rendered-empty-shell");
  if (metadata.openGraphCount > 0 || metadata.jsonLdCount > 0)
    hints.add("P15-rich-metadata");
  if (risks.includes("sparse-metadata"))
    hints.add("P16-missing-or-conflicting-metadata");
  if ((structure.lang ?? "").toLowerCase().includes("zh"))
    hints.add("P17-traditional-chinese-layout");
  if (structure.imageCount > 0)
    hints.add("P18-media-and-caption");
  if (isForumCategory(target.category))
    hints.add("P19-comments-heavy-page");
  if (metadata.canonical && metadata.amphtml)
    hints.add("P20-canonical-amp-syndication");
  return [...hints].sort();
}

function isDocsCategory(category) {
  return category === "Technical docs/knowledge base";
}

function isForumCategory(category) {
  return category === "Forum/social discussion";
}

function isSocialCategory(category) {
  return category === "Feed-like/social public pages";
}

function aggregate(items) {
  const okItems = items.filter((item) => item.ok);
  const risks = countValues(okItems.flatMap((item) => item.risks ?? []));
  const patternHints = countValues(okItems.flatMap((item) => item.patternHints ?? []));
  const focusPatterns = countValues(items.flatMap((item) => item.focusPatterns ?? []));
  const observedFocusPatterns = countValues(okItems.flatMap((item) => item.focusPatterns ?? []));
  return {
    okCount: okItems.length,
    errorCount: items.length - okItems.length,
    risks,
    patternHints,
    focusPatterns,
    observedFocusPatterns,
  };
}

function count(root, selector) {
  return root.querySelectorAll(selector).length;
}

function textLengthFor(root, selector) {
  return normalizedLength(
    [...root.querySelectorAll(selector)]
      .map((element) => element.textContent ?? "")
      .join(" "),
  );
}

function normalizedLength(value) {
  return value.replace(/\s+/g, " ").trim().length;
}

function ratio(numerator, denominator) {
  if (!denominator)
    return 0;
  return Number((numerator / denominator).toFixed(3));
}

function looksLoginOrPaywall(text) {
  return /\b(log in|sign in|subscribe|subscription|member only|members only|paywall)\b|登入|訂閱|會員|付費/i.test(text);
}

function countValues(values) {
  return values.reduce((counts, value) => {
    counts[value] = (counts[value] ?? 0) + 1;
    return counts;
  }, {});
}

function printSummary(report) {
  console.log(`Wrote ${REPORT_PATH}`);
  console.log(`observed ${report.aggregate.okCount}/${report.targetCount}; errors ${report.aggregate.errorCount}`);
  console.log(`risks ${JSON.stringify(report.aggregate.risks)}`);
  console.log(`patternHints ${JSON.stringify(report.aggregate.patternHints)}`);
}
