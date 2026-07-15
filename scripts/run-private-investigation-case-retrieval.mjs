import { build } from "esbuild";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

const result = await build({
  entryPoints: [new URL("./private-investigation-case-retrieval-entry.ts", import.meta.url).pathname],
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  packages: "external",
  write: false,
  sourcemap: false,
  logLevel: "silent",
});

const bundled = result.outputFiles?.[0]?.text;
if (!bundled) throw new Error("Private investigation-case retrieval bundle was empty");
const runnerRoot = join(process.cwd(), "tmp");
mkdirSync(runnerRoot, { recursive: true });
const directory = mkdtempSync(join(runnerRoot, "truly-investigation-case-retrieval-"));
const runner = join(directory, "runner.mjs");
writeFileSync(runner, bundled, { mode: 0o600 });
try {
  await import(pathToFileURL(runner).href);
} finally {
  rmSync(directory, { recursive: true, force: true });
}
