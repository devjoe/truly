import { build } from "esbuild";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const directory = mkdtempSync(join(tmpdir(), "truly-investigation-locator-catalog-"));
const runner = join(directory, "runner.mjs");
try {
  await build({ entryPoints: [new URL("./private-investigation-locator-catalog-entry.ts", import.meta.url).pathname], outfile: runner, bundle: true, platform: "node", format: "esm", target: "node22", logLevel: "silent" });
  await import(pathToFileURL(runner).href);
} finally { rmSync(directory, { recursive: true, force: true }); }
