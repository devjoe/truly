#!/usr/bin/env node

// Inject the in-browser labeling client into an already-generated
// general-page product-quality review.html so a reviewer can label cards,
// autosave to localStorage, and export manual-labels.jsonl.
//
// Use this on existing tmp/ reports without re-fetching 200 live URLs. New
// reports produced by review-general-page-product-quality.mjs already embed the
// client, so this is only needed for reports generated before that change.
//
// Usage:
//   node scripts/patch-review-html-labeling.mjs tmp/.../review.html
//   node scripts/patch-review-html-labeling.mjs tmp/.../review.html --force

import fs from "node:fs";
import process from "node:process";
import { LABELING_MARKER, labelingClientScript } from "./lib/review-labeling-client.mjs";

function main() {
  const args = process.argv.slice(2);
  const force = args.includes("--force");
  const seedPath = stringArg(args, "--seed");
  const target = args.find((a) => !a.startsWith("--") && a !== seedPath);
  if (!target) {
    console.error("Usage: node scripts/patch-review-html-labeling.mjs <review.html> [--seed labels.json] [--force]");
    process.exit(2);
  }
  if (!fs.existsSync(target))
    throw new Error(`Review report not found: ${target}`);

  const html = fs.readFileSync(target, "utf8");
  if (html.includes(LABELING_MARKER) && !force) {
    console.log(`Already patched (labeling client present): ${target}`);
    return;
  }

  const stripped = html.includes(LABELING_MARKER) ? removeExistingClient(html) : html;
  const closeIndex = stripped.lastIndexOf("</body>");
  if (closeIndex < 0)
    throw new Error("Could not find </body> in the review report.");

  const seedScript = buildSeedScript(seedPath);
  const patched =
    stripped.slice(0, closeIndex) + seedScript + labelingClientScript() + "\n" + stripped.slice(closeIndex);
  fs.writeFileSync(target, patched);
  console.log(`Injected labeling client into ${target}`);
  if (seedScript)
    console.log(`Seeded first-pass labels from ${seedPath} (used only if the browser has no saved labels yet).`);
  console.log("Open the file, adjust cards, then use Export all / Export reviewed to download manual-labels.jsonl.");
}

function stringArg(args, name) {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
}

function buildSeedScript(seedPath) {
  if (!seedPath) return "";
  if (!fs.existsSync(seedPath))
    throw new Error(`Seed file not found: ${seedPath}`);
  const seed = JSON.parse(fs.readFileSync(seedPath, "utf8"));
  const json = JSON.stringify(seed).replace(/</g, "\\u003c");
  return `<script data-truly="${LABELING_MARKER}-seed">window.__TRULY_LABEL_SEED__=${json};</script>\n`;
}

function removeExistingClient(html) {
  const open = `<script data-truly="${LABELING_MARKER}">`;
  const start = html.indexOf(open);
  if (start < 0) return html;
  const end = html.indexOf("</script>", start);
  if (end < 0) return html;
  return html.slice(0, start) + html.slice(end + "</script>".length).replace(/^\n/, "");
}

main();
