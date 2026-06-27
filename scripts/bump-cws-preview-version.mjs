#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const dryRun = process.argv.includes("--dry-run");

const packagePath = resolve(root, "package.json");
const lockPath = resolve(root, "package-lock.json");
const manifestPath = resolve(root, "src/manifest.json");

const packageJson = readJson(packagePath);
const packageLock = readJson(lockPath);
const manifest = readJson(manifestPath);

if (manifest.version !== packageJson.version) {
  throw new Error(
    `manifest.version must match package.json version before bumping: ${manifest.version} !== ${packageJson.version}`,
  );
}

const currentPreview = parsePreviewNumber(manifest.version_name, packageJson.version) ?? 0;
const nextPreview = Math.max(currentPreview + 1, highestPreviewTag() + 1, 1);
const nextVersion = incrementPatchVersion(packageJson.version);
const nextVersionName = `${nextVersion} Preview ${nextPreview}`;

const summary = `${packageJson.version} / ${manifest.version_name ?? "(none)"} -> ${nextVersion} / ${nextVersionName}`;
if (dryRun) {
  console.log(`CWS Preview bump dry run: ${summary}`);
  process.exit(0);
}

packageJson.version = nextVersion;
manifest.version = nextVersion;
manifest.version_name = nextVersionName;
packageLock.version = nextVersion;
if (packageLock.packages?.[""]) packageLock.packages[""].version = nextVersion;

writeJson(packagePath, packageJson);
writeJson(lockPath, packageLock);
writeJson(manifestPath, manifest);

console.log(`Updated CWS Preview metadata: ${summary}`);

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function writeJson(path, value) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

function highestPreviewTag() {
  const output = git(["tag", "--list", "v*-preview.*"]).trim();
  if (!output) return 0;
  let highest = 0;
  for (const tag of output.split("\n")) {
    const match = /^v\d+(?:\.\d+){1,3}-preview\.([1-9]\d*)$/.exec(tag);
    if (!match) continue;
    highest = Math.max(highest, Number(match[1]));
  }
  return highest;
}

function parsePreviewNumber(versionName, version) {
  const match = new RegExp(`^${escapeRegExp(version)} Preview ([1-9]\\d*)$`).exec(versionName ?? "");
  return match ? Number(match[1]) : null;
}

function incrementPatchVersion(version) {
  const parts = String(version).split(".");
  if (parts.length < 3 || parts.length > 4 || parts.some((part) => !/^\d+$/.test(part))) {
    throw new Error(`Expected a Chrome-compatible dotted numeric version with 3 or 4 parts; got ${version}`);
  }
  const next = [...parts];
  next[2] = String(Number(next[2]) + 1);
  if (next.length === 4) next[3] = "0";
  return next.join(".");
}

function git(args) {
  return execFileSync("git", args, { cwd: root, encoding: "utf8" });
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
