import { build } from "esbuild";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const result = await build({
  entryPoints: [new URL("./private-investigation-candidate-plan-entry.ts", import.meta.url).pathname],
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  write: false,
  logLevel: "silent",
});

const bundled = result.outputFiles?.[0]?.text;
if (!bundled) throw new Error("Private candidate-plan eval CLI bundle was empty");
const runnerDirectory = mkdtempSync(join(tmpdir(), "truly-investigation-candidate-plan-"));
const runnerPath = join(runnerDirectory, "runner.mjs");
writeFileSync(runnerPath, bundled, { mode: 0o600 });

try {
  await import(pathToFileURL(runnerPath).href);
} finally {
  rmSync(runnerDirectory, { recursive: true, force: true });
}
