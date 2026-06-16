#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const packageJson = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"));
const manifestPath = resolve(root, "src/manifest.json");
const manifestText = readFileSync(manifestPath, "utf8");
const manifest = JSON.parse(manifestText);
const version = packageJson.version;
const currentPreview = parsePreviewNumber(manifest.version_name, version) ?? 0;
const highestTaggedPreview = highestPreviewTag(version);
const nextPreview = Math.max(currentPreview, highestTaggedPreview + 1, 1);
const nextVersionName = `${version} Preview ${nextPreview}`;

if (manifest.version !== version) {
  throw new Error(
    `manifest.version must match package.json version before bumping: ${manifest.version} !== ${version}`,
  );
}

if (manifest.version_name === nextVersionName) {
  console.log(`Preview version already current: ${nextVersionName}`);
  process.exit(0);
}

const nextManifest = manifestText.replace(
  /"version_name":\s*"[^"]*"/,
  `"version_name": "${nextVersionName}"`,
);
if (nextManifest === manifestText) {
  throw new Error("Could not find manifest.version_name to update.");
}
writeFileSync(manifestPath, nextManifest);
console.log(`Updated src/manifest.json: ${manifest.version_name ?? "(none)"} -> ${nextVersionName}`);

function highestPreviewTag(version) {
  const output = git(["tag", "--list", `v${version}-preview.*`]).trim();
  if (!output) return 0;
  let highest = 0;
  for (const tag of output.split("\n")) {
    const match = new RegExp(`^v${escapeRegExp(version)}-preview\\.([1-9]\\d*)$`).exec(tag);
    if (!match) continue;
    highest = Math.max(highest, Number(match[1]));
  }
  return highest;
}

function parsePreviewNumber(versionName, version) {
  const match = new RegExp(`^${escapeRegExp(version)} Preview ([1-9]\\d*)$`).exec(versionName ?? "");
  return match ? Number(match[1]) : null;
}

function git(args) {
  return execFileSync("git", args, { cwd: root, encoding: "utf8" });
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
