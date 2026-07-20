import { build } from "esbuild";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const result = await build({
  entryPoints: [new URL("./private-general-page-span-audit-entry.ts", import.meta.url).pathname],
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  write: false,
  logLevel: "silent",
});

const bundled = result.outputFiles?.[0]?.text;
if (!bundled) throw new Error("Private span audit CLI bundle was empty");
const directory = mkdtempSync(join(tmpdir(), "truly-private-span-audit-"));
const runner = join(directory, "runner.mjs");
writeFileSync(runner, bundled, { mode: 0o600 });
try {
  await import(pathToFileURL(runner).href);
} finally {
  rmSync(directory, { recursive: true, force: true });
}
