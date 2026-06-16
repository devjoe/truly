#!/usr/bin/env node

import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const packageJson = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"));
const manifest = JSON.parse(readFileSync(resolve(root, "src/manifest.json"), "utf8"));
const version = packageJson.version;
const versionName = manifest.version_name;
const expectedPrefix = `${version} Preview `;
const match = new RegExp(`^${escapeRegExp(version)} Preview ([1-9]\\d*)$`).exec(versionName ?? "");

let ok = true;

if (manifest.version !== version) {
  ok = false;
  console.error(`manifest.version must match package.json version: ${manifest.version} !== ${version}`);
}

if (!match) {
  ok = false;
  console.error(`manifest.version_name must look like "${expectedPrefix}N"; got ${JSON.stringify(versionName)}.`);
}

if (!ok) process.exit(1);

const previewNumber = match?.[1] ?? "unknown";
const tag = previewNumber === "unknown" ? "unknown" : `v${version}-preview.${previewNumber}`;

if (tag !== "unknown" && tagExists(tag) && process.env.TRULY_ALLOW_RELEASE_TAG_COLLISION !== "1") {
  ok = false;
  console.error(
    `Release tag already exists: ${tag}. Run "npm run release:bump-preview" before preparing another Preview.`,
  );
}

if (!ok) process.exit(1);

console.log(`Release metadata OK: ${versionName} -> ${tag}`);

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function tagExists(tag) {
  try {
    execFileSync("git", ["rev-parse", "-q", "--verify", `refs/tags/${tag}`], {
      cwd: root,
      stdio: "ignore",
    });
    return true;
  } catch {
    return false;
  }
}
