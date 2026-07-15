import { build } from "esbuild";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const result = await build({ entryPoints: [new URL("./private-investigation-witness-proposal-entry.ts", import.meta.url).pathname], bundle: true, platform: "node", format: "esm", target: "node22", packages: "external", write: false, logLevel: "silent" });
const bundled = result.outputFiles?.[0]?.text; if (!bundled) throw new Error("Private witness proposal bundle was empty");
const root = join(process.cwd(), "tmp"); mkdirSync(root, { recursive: true });
const directory = mkdtempSync(join(root, "truly-witness-proposal-")); const runner = join(directory, "runner.mjs");
writeFileSync(runner, bundled, { mode: 0o600 });
try { await import(pathToFileURL(runner).href); } finally { rmSync(directory, { recursive: true, force: true }); }
