import { build } from "esbuild";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const runnerDirectory = mkdtempSync(join(tmpdir(), "truly-investigation-case-plan-"));
const runner = join(runnerDirectory, "runner.mjs");
try {
  await build({
    entryPoints: [new URL("./private-investigation-case-plan-entry.ts", import.meta.url).pathname],
    outfile: runner,
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node22",
    sourcemap: false,
    logLevel: "silent",
  });
  await import(pathToFileURL(runner).href);
} finally {
  rmSync(runnerDirectory, { recursive: true, force: true });
}
