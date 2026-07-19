#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { JSDOM } from "jsdom";

const OUTPUT_DIR = "tmp/general-page-product-quality";
const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_LIMIT = 200;
const USER_AGENT = "TrulyGeneralPageReaderProductQuality/0.1 (+https://example.test/truly)";

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const seeds = readJson(args.input);
  const seedEntries = Array.isArray(seeds) ? seeds : seeds.seeds;
  if (!Array.isArray(seedEntries) || seedEntries.length === 0)
    throw new Error("Seed input must be an array or { seeds: [...] }.");
  if (!args.allowNetwork)
    throw new Error("Live target discovery requires --allow-network.");

  const discoveredTargets = [];
  const diagnostics = [];
  for (const [index, seed] of seedEntries.entries()) {
    const normalizedSeed = normalizeSeed(seed, index);
    try {
      const discovered = await discoverFromSeed(normalizedSeed, args);
      diagnostics.push({
        seedId: normalizedSeed.id,
        category: normalizedSeed.category,
        pageType: normalizedSeed.pageType,
        discoveredCount: discovered.length,
      });
      discoveredTargets.push(...discovered);
    } catch (error) {
      diagnostics.push({
        seedId: normalizedSeed.id,
        category: normalizedSeed.category,
        pageType: normalizedSeed.pageType,
        errorKind: errorKind(error),
      });
    }
  }

  const targets = selectBalancedTargets(discoveredTargets, args.limit);

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  const outputPath = args.output ?? path.join(OUTPUT_DIR, `targets-${stamp}.json`);
  const reportPath = outputPath.replace(/\.json$/i, "-discovery.json");
  fs.writeFileSync(outputPath, `${JSON.stringify(targets, null, 2)}\n`);
  fs.writeFileSync(reportPath, `${JSON.stringify({
    generatedAt: new Date().toISOString(),
    privacyBoundary: "Private tmp artifact. Do not commit. Contains real target URLs.",
    input: {
      seedCount: seedEntries.length,
      limit: args.limit,
      timeoutMs: args.timeoutMs,
    },
    output: {
      targetCount: targets.length,
      targetPath: outputPath,
    },
    diagnostics,
  }, null, 2)}\n`);

  console.log(`Wrote ${outputPath}`);
  console.log(`discovered ${targets.length}/${args.limit} targets from ${seedEntries.length} seeds`);
  console.log(`diagnostics ${reportPath}`);
  if (targets.length < args.limit)
    process.exitCode = 1;
}

function parseArgs(argv) {
  const input = stringArg(argv, "--input");
  if (!input) {
    console.error("Usage: node scripts/collect-general-page-review-targets.mjs --input tmp/seeds.json --allow-network [--limit 200] [--timeout-ms 10000] [--output tmp/targets.json]");
    process.exit(2);
  }
  return {
    input,
    output: stringArg(argv, "--output"),
    allowNetwork: argv.includes("--allow-network"),
    limit: numericArg(argv, "--limit", DEFAULT_LIMIT, { min: 1, max: 1000 }),
    timeoutMs: numericArg(argv, "--timeout-ms", DEFAULT_TIMEOUT_MS, { min: 1000, max: 60000 }),
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
  if (!Number.isInteger(value) || value < min || value > max)
    throw new Error(`${name} must be an integer between ${min} and ${max}.`);
  return value;
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function normalizeSeed(seed, index) {
  if (!seed || typeof seed !== "object")
    throw new Error("Seed must be an object.");
  if (typeof seed.url !== "string")
    throw new Error("Seed must include url.");
  return {
    id: typeof seed.id === "string" ? seed.id : `seed-${String(index + 1).padStart(3, "0")}`,
    url: seed.url,
    category: typeof seed.category === "string" ? seed.category : "uncategorized",
    pageType: typeof seed.pageType === "string" ? seed.pageType : undefined,
    quota: Number.isInteger(seed.quota) ? seed.quota : 8,
    sameOrigin: seed.sameOrigin !== false,
    includeSeed: seed.includeSeed === true,
  };
}

async function discoverFromSeed(seed, args) {
  const html = await fetchText(seed.url, args.timeoutMs);
  const dom = new JSDOM(html, { url: seed.url });
  const document = dom.window.document;
  const candidates = [];
  if (seed.includeSeed) {
    candidates.push({
      url: normalizeUrl(seed.url),
      anchorText: document.title.trim() || undefined,
      score: 100,
    });
  }

  for (const anchor of Array.from(document.querySelectorAll("a[href]"))) {
    const href = anchor.getAttribute("href") ?? "";
    const url = normalizeHref(href, seed.url);
    if (!url || !isReviewableUrl(url, seed))
      continue;
    candidates.push({
      url,
      anchorText: cleanText(anchor.textContent ?? ""),
      score: scoreCandidate(url, anchor.textContent ?? ""),
    });
  }

  return dedupeCandidates(candidates)
    .sort((a, b) => b.score - a.score || a.url.localeCompare(b.url))
    .slice(0, seed.quota)
    .map((candidate, index) => ({
      url: candidate.url,
      category: seed.category,
      pageType: seed.pageType,
      seedId: seed.id,
      rank: index + 1,
    }));
}

async function fetchText(url, timeoutMs) {
  const response = await fetch(url, {
    redirect: "follow",
    signal: AbortSignal.timeout(timeoutMs),
    headers: {
      "user-agent": USER_AGENT,
      "accept": "text/html,application/xhtml+xml",
    },
  });
  if (!response.ok)
    throw new Error(`fetch failed with ${response.status}`);
  const contentType = response.headers.get("content-type") ?? "";
  if (contentType && !/html|xml|text/i.test(contentType))
    throw new Error(`unsupported content-type: ${contentType}`);
  return response.text();
}

function normalizeHref(href, baseUrl) {
  if (!href.trim() || href.startsWith("#"))
    return undefined;
  try {
    return normalizeUrl(new URL(href, baseUrl).href);
  } catch {
    return undefined;
  }
}

function normalizeUrl(value) {
  const url = new URL(value);
  url.hash = "";
  for (const key of [...url.searchParams.keys()]) {
    if (/^(utm_|fbclid$|gclid$|mc_|ref$|ref_src$|spm$)/i.test(key))
      url.searchParams.delete(key);
  }
  return url.href;
}

function isReviewableUrl(value, seed) {
  const url = new URL(value);
  const seedUrl = new URL(seed.url);
  if (!["http:", "https:"].includes(url.protocol))
    return false;
  if (seed.sameOrigin && url.hostname !== seedUrl.hostname)
    return false;
  if (/\.(?:7z|avi|css|csv|docx?|gif|ico|jpe?g|js|json|mp3|mp4|pdf|png|pptx?|rss|svg|webp|xlsx?|xml|zip)$/i.test(url.pathname))
    return false;
  if (/\/(?:tag|tags|author|authors|login|signin|signup|privacy|terms|about|contact)(?:\/|$)/i.test(url.pathname))
    return false;
  return true;
}

function scoreCandidate(value, text) {
  const url = new URL(value);
  const path = url.pathname;
  let score = 0;
  const cleanAnchorText = cleanText(text);
  if (cleanAnchorText.length >= 12)
    score += 8;
  if (/\/\d{4}[/-]\d{1,2}[/-]\d{1,2}\//.test(path) || /\/\d{4}\//.test(path))
    score += 10;
  if (/(article|story|news|post|blog|docs|guide|learn|questions|discussion|thread|notice|press|release)/i.test(path))
    score += 8;
  if (path.split("/").filter(Boolean).length >= 2)
    score += 5;
  if (url.search)
    score -= 4;
  if (/\/(?:category|topics|search|archive|page)\b/i.test(path))
    score -= 8;
  return score;
}

function dedupeCandidates(candidates) {
  const seen = new Map();
  for (const candidate of candidates) {
    const key = canonicalTargetKey(candidate.url);
    const current = seen.get(key);
    if (!current || candidate.score > current.score)
      seen.set(key, candidate);
  }
  return [...seen.values()];
}

function selectBalancedTargets(discoveredTargets, limit) {
  const seen = new Set();
  const groups = new Map();
  for (const target of discoveredTargets) {
    const key = canonicalTargetKey(target.url);
    if (seen.has(key))
      continue;
    seen.add(key);
    const groupKey = `${target.category ?? "uncategorized"}:${target.pageType ?? "unknown"}`;
    const group = groups.get(groupKey) ?? [];
    group.push(target);
    groups.set(groupKey, group);
  }

  const selected = [];
  const orderedGroups = [...groups.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([, items]) => items);
  while (selected.length < limit && orderedGroups.some((items) => items.length > 0)) {
    for (const items of orderedGroups) {
      const item = items.shift();
      if (!item)
        continue;
      selected.push(item);
      if (selected.length >= limit)
        break;
    }
  }
  return selected;
}

function canonicalTargetKey(value) {
  const url = new URL(value);
  url.hash = "";
  url.searchParams.sort();
  return url.href.replace(/\/+$/, "");
}

function cleanText(value) {
  return value.replace(/\s+/g, " ").trim();
}

function errorKind(error) {
  if (error instanceof Error && ["AbortError", "TimeoutError"].includes(error.name))
    return "fetch-timeout";
  if (error instanceof TypeError)
    return "fetch-error";
  return "target-discovery-error";
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
