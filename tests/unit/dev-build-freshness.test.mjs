import { mkdtempSync, mkdirSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { inspectBuildFreshness } from "../../scripts/lib/dev-build-freshness.mjs";

function fixture() {
  const root = mkdtempSync(resolve(tmpdir(), "truly-build-freshness-"));
  const src = resolve(root, "src");
  const dist = resolve(root, "dist");
  mkdirSync(src);
  mkdirSync(dist);
  const sourcePath = resolve(src, "entry.ts");
  const markerPath = resolve(dist, "build-id.txt");
  writeFileSync(sourcePath, "export const value = 1;\n");
  writeFileSync(markerPath, "test-build\n");
  return { root, sourcePath, markerPath };
}

describe("inspectBuildFreshness", () => {
  it("accepts a build marker newer than all configured inputs", () => {
    const { root, sourcePath, markerPath } = fixture();
    const sourceTime = new Date("2026-01-01T00:00:00Z");
    const buildTime = new Date("2026-01-01T00:01:00Z");
    utimesSync(sourcePath, sourceTime, sourceTime);
    utimesSync(markerPath, buildTime, buildTime);

    expect(inspectBuildFreshness({ root, markerPath, inputPaths: ["src"] })).toMatchObject({
      fresh: true,
      reason: "fresh",
      newerInputs: [],
    });
  });

  it("reports the source files that are newer than the build marker", () => {
    const { root, sourcePath, markerPath } = fixture();
    const buildTime = new Date("2026-01-01T00:00:00Z");
    const sourceTime = new Date("2026-01-01T00:01:00Z");
    utimesSync(markerPath, buildTime, buildTime);
    utimesSync(sourcePath, sourceTime, sourceTime);

    const result = inspectBuildFreshness({ root, markerPath, inputPaths: ["src"] });
    expect(result.fresh).toBe(false);
    expect(result.reason).toBe("source_newer_than_build");
    expect(result.newerInputs).toEqual([sourcePath]);
  });

  it("fails closed when the build marker is missing", () => {
    const { root } = fixture();
    const result = inspectBuildFreshness({
      root,
      markerPath: resolve(root, "dist", "missing-build-id.txt"),
      inputPaths: ["src"],
    });
    expect(result).toMatchObject({
      fresh: false,
      reason: "missing_build_marker",
      newerInputs: [],
    });
  });
});
