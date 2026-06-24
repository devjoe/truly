#!/usr/bin/env node

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

const root = fileURLToPath(new URL("..", import.meta.url));
const manifestPath = resolve(root, "dist/manifest.json");
const releaseLockPath = resolve(root, "tmp/release-preview.lock");

if (existsSync(releaseLockPath)) {
  console.error("Refusing to patch dist/manifest.json while release:preview is running.");
  console.error("Stop the release command or wait for it to finish, then rebuild the dev manifest.");
  process.exit(1);
}

const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));

manifest.commands = {
  ...(manifest.commands ?? {}),
  "reload-extension": {
    suggested_key: {
      default: "Alt+Shift+R",
      mac: "Alt+Shift+R",
    },
    description: "Reload Truly during local development",
  },
};

writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
console.log("Patched dist/manifest.json with dev reload shortcut.");
