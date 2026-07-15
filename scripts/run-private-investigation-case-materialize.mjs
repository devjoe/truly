import { build } from "esbuild";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const directory = mkdtempSync(join(tmpdir(), "truly-investigation-case-materialize-"));
const runner = join(directory, "runner.mjs");
try {
  await build({
    entryPoints: [new URL("./private-investigation-case-materialize-entry.ts", import.meta.url).pathname],
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
  rmSync(directory, { recursive: true, force: true });
}
