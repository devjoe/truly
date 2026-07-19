#!/usr/bin/env node

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  collectCwsAssetEvidence,
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
const contractDocs = [
  {
    path: "docs/release/preview-command-contract.md",
    snippets: [
      "cws:package:local-smoke",
      "Uploadable: no",
      "must never be uploaded to Chrome Web Store",
    ],
  },
  {
    path: "docs/release/cws-reviewer-notes.md",
    snippets: [
      "artifacts/cws-local-smoke/",
      "explicitly non-uploadable",
      "Screenshot-assisted recovery is offered only after a user-triggered Page/Web",
      "vision input",
      "not written to extension storage or logs",
      "authorize-domain action",
      "authorizes a single domain from the Page/Web side panel",
    ],
  },
  {
    path: "docs/release/privacy-policy.md",
    snippets: [
      "screenshot-assisted recovery",
      "confirm the preview",
      "not written to Chrome extension storage, logs",
      "durable page history",
      "automatically while the Side Panel is",
      "authorize a single domain",
      "Closing the side panel stops these",
    ],
  },
  {
    path: "docs/release/permission-justification.md",
    snippets: [
      "Page/Web screenshot-assisted recovery uses the same user-gesture boundary",
      "does not add a separate screenshot permission",
      "not written to Chrome extension storage or logs",
      "single-domain grant",
      "authorize-domain action",
      "while the Side Panel is open",
    ],
  },
  {
    path: "docs/release/cws-submission-checklist.md",
    snippets: [
      "artifacts/cws-local-smoke/",
      "explicitly non-uploadable",
      "Before dashboard upload",
      "otherwise occupied package",
      "Record the outcome of Preview 9's numeric `0.1.1` submission before",
    ],
  },
  {
    path: "docs/release/cws-listing-copy.md",
    snippets: [
      "Page/Web screenshot-assisted recovery",
      "selected model source supports",
      "user confirms the preview",
      "session-only and is not stored",
      "hook in-page Facebook",
      "GraphQL/network responses",
      "General Page all-sites access",
      "sponsorship signals",
      "authorizes a single domain",
      "while the Side Panel is open",
    ],
  },
];
const errors = [];

for (const path of requiredFiles) {
  if (!existsSync(resolve(root, path))) errors.push(`missing required CWS file: ${path}`);
}

for (const asset of collectCwsAssetEvidence()) {
  if (!asset.exists) {
    errors.push(`missing required CWS image: ${asset.path}`);
  } else if (!asset.actual) {
    errors.push(`CWS image is not a readable PNG: ${asset.path}`);
  } else if (asset.status !== "ok") {
    errors.push(`CWS image size mismatch: ${asset.path} expected ${asset.width}x${asset.height}, got ${asset.actual.width}x${asset.actual.height}`);
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

for (const entry of contractDocs) {
  const absolutePath = resolve(root, entry.path);
  if (!existsSync(absolutePath)) continue;
  const text = readFileSync(absolutePath, "utf8");
  for (const snippet of entry.snippets) {
    if (!text.includes(snippet)) {
      errors.push(`${entry.path} does not mention required CWS contract snippet: ${snippet}`);
    }
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
