import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const SOURCE_PATH = join(ROOT, "src/content_scripts/heads-up-styles.css");
const TARGET_PATH = join(ROOT, "src/content_scripts/feed-filter.css");

const START = "/* <truly-headsup-styles:start>";
const END = "/* <truly-headsup-styles:end> */";

const source = `${readFileSync(SOURCE_PATH, "utf8").trimEnd()}\n`;
const target = readFileSync(TARGET_PATH, "utf8");

const start = target.indexOf(START);
const end = target.indexOf(END);

if (start < 0 || end < 0 || end < start) {
  throw new Error("Could not find heads-up CSS generated block in feed-filter.css");
}

const generated = `${START}
   Generated from src/content_scripts/heads-up-styles.css.
   Run npm run sync:headsup-css after editing that source file.
*/
${source}${END}`;

const next = target.slice(0, start) + generated + target.slice(end + END.length);

if (next === target) {
  console.log("heads-up CSS already in sync");
} else {
  writeFileSync(TARGET_PATH, next);
  console.log("synced heads-up CSS into src/content_scripts/feed-filter.css");
}
