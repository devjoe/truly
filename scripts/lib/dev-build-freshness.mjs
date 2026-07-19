import { readdirSync, statSync } from "node:fs";
import { resolve } from "node:path";

export const DEFAULT_BUILD_INPUTS = [
  "src",
  "public",
  "manifest.json",
  "package.json",
  "package-lock.json",
  "tsconfig.json",
  "vite.config.ts",
];

function collectFiles(path, files) {
  const stat = statSync(path, { throwIfNoEntry: false });
  if (!stat) return;
  if (stat.isFile()) {
    files.push({ path, mtimeMs: stat.mtimeMs });
    return;
  }
  if (!stat.isDirectory()) return;
  for (const entry of readdirSync(path, { withFileTypes: true })) {
    collectFiles(resolve(path, entry.name), files);
  }
}

export function inspectBuildFreshness({
  root,
  markerPath,
  inputPaths = DEFAULT_BUILD_INPUTS,
}) {
  const marker = statSync(markerPath, { throwIfNoEntry: false });
  if (!marker?.isFile()) {
    return {
      fresh: false,
      markerMtimeMs: null,
      newestInputMtimeMs: null,
      newerInputs: [],
      reason: "missing_build_marker",
    };
  }

  const files = [];
  for (const inputPath of inputPaths) {
    collectFiles(resolve(root, inputPath), files);
  }
  files.sort((left, right) => right.mtimeMs - left.mtimeMs);
  const newerInputs = files
    .filter((file) => file.mtimeMs > marker.mtimeMs)
    .map((file) => file.path);

  return {
    fresh: newerInputs.length === 0,
    markerMtimeMs: marker.mtimeMs,
    newestInputMtimeMs: files[0]?.mtimeMs ?? null,
    newerInputs,
    reason: newerInputs.length === 0 ? "fresh" : "source_newer_than_build",
  };
}
