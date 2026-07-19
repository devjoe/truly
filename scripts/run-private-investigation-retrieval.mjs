import { build } from "esbuild";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

const result = await build({
  entryPoints: [new URL("./private-investigation-retrieval-entry.ts", import.meta.url).pathname],
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  packages: "external",
  write: false,
  logLevel: "silent",
});

const bundled = result.outputFiles?.[0]?.text;
if (!bundled) throw new Error("Private investigation-retrieval bundle was empty");
const runnerRoot = join(process.cwd(), "tmp");
mkdirSync(runnerRoot, { recursive: true });
const runnerDirectory = mkdtempSync(join(runnerRoot, "truly-investigation-retrieval-"));
const runnerPath = join(runnerDirectory, "runner.mjs");
writeFileSync(runnerPath, bundled, { mode: 0o600 });
try {
  await import(pathToFileURL(runnerPath).href);
} finally {
  rmSync(runnerDirectory, { recursive: true, force: true });
}
