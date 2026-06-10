#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { existsSync, lstatSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve, sep } from "node:path";

const root = fileURLToPath(new URL("..", import.meta.url));

const deniedPathRules = [
  { label: "environment file", test: (path) => path === ".env" || path.startsWith(".env.") },
  { label: "local data directory", test: (path) => startsWithSegment(path, "data") },
  { label: "temporary output directory", test: (path) => startsWithSegment(path, "tmp") },
  { label: "build output directory", test: (path) => path === "dist" || path.startsWith("dist/") || path.startsWith("dist-") },
  { label: "test result directory", test: (path) => startsWithSegment(path, "test-results") },
  { label: "dependency install output", test: (path) => startsWithSegment(path, "node_modules") },
  { label: "local IDE state", test: (path) => startsWithSegment(path, ".idea") },
];

const contentRules = [
  {
    label: "parent-directory reference",
    regex: new RegExp("\\.\\." + "[/\\\\]"),
    appliesTo: (path) => !startsWithSegment(path, "src"),
  },
  {
    label: "absolute local user path",
    regex: new RegExp("[/\\\\]" + "Users" + "[/\\\\]"),
  },
  {
    label: "private host",
    regex: new RegExp("gx10" + "\\." + "local", "i"),
  },
  {
    label: "private IPv4 range",
    regex: new RegExp("192" + "\\." + "168" + "\\."),
  },
  {
    label: "raw Facebook tracking URL",
    regex: new RegExp("facebook" + "\\." + "com[^\\s)]*__cft__", "i"),
  },
  {
    label: "Facebook CDN capture",
    regex: new RegExp("scontent" + "-|https?://[^\\s\"'`)]*fb" + "cdn", "i"),
  },
];

const files = listCandidateFiles();
const failures = [];

for (const file of files) {
  const absolutePath = resolve(root, file);
  const normalized = file.split(sep).join("/");
  if (!existsSync(absolutePath)) {
    continue;
  }
  const stat = lstatSync(absolutePath);

  if (stat.isSymbolicLink()) {
    failures.push(`${normalized}: symlink is not allowed`);
    continue;
  }

  for (const rule of deniedPathRules) {
    if (rule.test(normalized)) {
      failures.push(`${normalized}: denied path (${rule.label})`);
    }
  }

  if (!stat.isFile()) {
    continue;
  }

  const bytes = readFileSync(absolutePath);
  if (bytes.includes(0)) {
    continue;
  }

  const content = bytes.toString("utf8");
  for (const rule of contentRules) {
    if ((rule.appliesTo?.(normalized) ?? true) && rule.regex.test(content)) {
      failures.push(`${normalized}: forbidden content (${rule.label})`);
    }
  }
}

if (failures.length > 0) {
  console.error("Public-boundary check failed:");
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log(`Public-boundary check passed (${files.length} files scanned).`);

function startsWithSegment(path, segment) {
  return path === segment || path.startsWith(`${segment}/`);
}

function listCandidateFiles() {
  try {
    const output = execFileSync("git", ["ls-files", "-co", "--exclude-standard", "-z", "--", "."], {
      cwd: root,
      encoding: "utf8",
    });
    return output.split("\0").filter(Boolean).sort();
  } catch {
    throw new Error("Unable to list public-boundary candidates with git.");
  }
}
