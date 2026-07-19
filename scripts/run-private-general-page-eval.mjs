import { build } from "esbuild";

const result = await build({
  entryPoints: [new URL("./private-general-page-eval-entry.ts", import.meta.url).pathname],
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  write: false,
  logLevel: "silent",
});

const bundled = result.outputFiles?.[0]?.text;
if (!bundled) throw new Error("Private eval CLI bundle was empty");
await import(`data:text/javascript;base64,${Buffer.from(bundled).toString("base64")}`);
