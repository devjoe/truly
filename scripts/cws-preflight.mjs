#!/usr/bin/env node

import { existsSync, readFileSync, statSync } from "node:fs";
import { relative, resolve } from "node:path";
import {
  readProjectMetadata,
  root,
} from "./lib/cws-artifacts.mjs";

const {
  version,
  versionName,
  recommendedTag,
} = readProjectMetadata();
const requiredFiles = [
  "docs/release/cws-submission-checklist.md",
  "docs/release/cws-listing-copy.md",
  "docs/release/cws-reviewer-notes.md",
  "docs/release/cws-published-version.json",
  "docs/release/privacy-policy.md",
  "docs/release/permission-justification.md",
  "docs/release/store-assets.md",
  "THIRD_PARTY_NOTICES.md",
  "src/icons/icon-128.png",
];
const requiredPngs = [
  ["docs/assets/cws/truly-cws-professional-screenshot-01-feed-signal.png", 1280, 800],
  ["docs/assets/cws/truly-cws-professional-screenshot-02-expanded-context.png", 1280, 800],
  ["docs/assets/cws/truly-cws-professional-screenshot-03-side-panel-handoff.png", 1280, 800],
  ["docs/assets/cws/truly-cws-promo-og-image.png", 440, 280],
];
const versionedDocs = [
  "docs/release/cws-submission-checklist.md",
  "docs/release/cws-reviewer-notes.md",
  "docs/release/cws-listing-copy.md",
];
const expectedSnippets = [
  version,
  versionName,
  recommendedTag,
];
const errors = [];

for (const path of requiredFiles) {
  if (!existsSync(resolve(root, path))) errors.push(`missing required CWS file: ${path}`);
}

for (const [path, width, height] of requiredPngs) {
  const absolutePath = resolve(root, path);
  if (!existsSync(absolutePath)) {
    errors.push(`missing required CWS image: ${path}`);
    continue;
  }
  const actual = readPngDimensions(absolutePath);
  if (!actual) {
    errors.push(`CWS image is not a readable PNG: ${path}`);
    continue;
  }
  if (actual.width !== width || actual.height !== height) {
    errors.push(`CWS image size mismatch: ${path} expected ${width}x${height}, got ${actual.width}x${actual.height}`);
  }
}

for (const path of versionedDocs) {
  const absolutePath = resolve(root, path);
  if (!existsSync(absolutePath)) continue;
  const text = readFileSync(absolutePath, "utf8");
  for (const snippet of expectedSnippets) {
    if (!text.includes(snippet)) {
      errors.push(`${path} does not mention current release snippet: ${snippet}`);
    }
  }
  const stalePreview = text.match(new RegExp(`${escapeRegExp(version)} Preview (?!${escapeRegExp(versionName.split(" Preview ")[1] ?? "")})\\d+`));
  if (stalePreview) {
    errors.push(`${path} appears to mention stale preview label: ${stalePreview[0]}`);
  }
}

const publishedStatePath = "docs/release/cws-published-version.json";
const publishedState = readJsonIfExists(publishedStatePath);
if (publishedState?.publishedVersion) {
  const comparison = compareChromeVersions(version, publishedState.publishedVersion);
  if (comparison <= 0) {
    errors.push(
      `${publishedStatePath} says CWS already published manifest.version ${publishedState.publishedVersion}; current manifest.version ${version} must be greater before CWS upload`,
    );
  }
}

if (errors.length > 0) {
  console.error("CWS preflight failed:");
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

console.log(`CWS preflight passed (${versionName} / ${recommendedTag}).`);

function readPngDimensions(path) {
  const stat = statSync(path);
  if (!stat.isFile() || stat.size < 24) return null;
  const data = readFileSync(path);
  const signature = data.slice(0, 8).toString("hex");
  if (signature !== "89504e470d0a1a0a") return null;
  return {
    width: data.readUInt32BE(16),
    height: data.readUInt32BE(20),
    path: relative(root, path),
  };
}

function readJsonIfExists(path) {
  const absolutePath = resolve(root, path);
  if (!existsSync(absolutePath)) return null;
  try {
    return JSON.parse(readFileSync(absolutePath, "utf8"));
  } catch (error) {
    errors.push(`${path} is not valid JSON: ${error.message}`);
    return null;
  }
}

function compareChromeVersions(left, right) {
  const leftParts = parseChromeVersion(left);
  const rightParts = parseChromeVersion(right);
  if (!leftParts || !rightParts) return 0;
  const width = Math.max(leftParts.length, rightParts.length);
  for (let index = 0; index < width; index += 1) {
    const diff = (leftParts[index] ?? 0) - (rightParts[index] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

function parseChromeVersion(value) {
  const parts = String(value).split(".");
  if (parts.length < 1 || parts.length > 4 || parts.some((part) => !/^\d+$/.test(part))) {
    errors.push(`invalid Chrome manifest version in CWS preflight: ${value}`);
    return null;
  }
  return parts.map(Number);
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
