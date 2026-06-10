#!/usr/bin/env node

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

const root = fileURLToPath(new URL("..", import.meta.url));
const manifestPath = resolve(root, "dist/manifest.json");
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
