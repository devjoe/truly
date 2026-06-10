import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * Guard against the #1 failure mode of zh-first development: adding a
 * user-facing string straight into a DOM display sink (`el.textContent = "中文"`)
 * instead of routing it through `t(key, lang)` / `data-i18n`. Such a string never
 * enters the i18n catalog, so the English UI silently shows Chinese — and no
 * other test catches it (the catalog/coverage guards only see annotated keys).
 *
 * This scans the user-facing render sources for a CJK literal assigned to a
 * display sink (textContent / innerText / innerHTML / placeholder / title,
 * setAttribute aria-label|title|placeholder, or createTextNode / append family).
 *
 * NOTE: this deliberately does NOT flag CJK in comparisons (`=== "查看更多"`),
 * arrays, regexes, or `.includes()` — those are Facebook-DOM *detection* inputs,
 * not UI output, and must stay literal.
 */

const RENDER_DIRS = [
  "../../src/options/",
  "../../src/popup/",
  "../../src/sidepanel/",
  "../../src/content_scripts/",
];

// Allowlisted exceptions: "<relative-path>:<line>" — add with a justification
// if a legitimate non-output CJK display assignment ever appears.
const ALLOWLIST = new Set<string>([]);

const CJK = "\\u4e00-\\u9fff";
const STR = "[`\"'][^`\"']*[" + CJK + "]";
const SINK_PATTERNS = [
  new RegExp(`\\.(?:textContent|innerText|innerHTML|placeholder|title)\\s*=\\s*${STR}`),
  new RegExp(`setAttribute\\(\\s*["'](?:aria-label|title|placeholder)["']\\s*,\\s*${STR}`),
  new RegExp(`(?:createTextNode|\\.append|\\.prepend|\\.before|\\.after)\\(\\s*${STR}`),
];

function tsFiles(dirRel: string): { rel: string; path: URL }[] {
  const dirUrl = new URL(dirRel, import.meta.url);
  let names: string[] = [];
  try {
    names = readdirSync(dirUrl);
  } catch {
    return [];
  }
  return names
    .filter((n) => n.endsWith(".ts") && !n.endsWith(".test.ts") && !n.endsWith(".d.ts"))
    .map((n) => ({ rel: dirRel.replace("../../", "") + n, path: new URL(dirRel + n, import.meta.url) }));
}

function stripBlockComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "));
}

describe("i18n: no hardcoded user-facing CJK in render sources", () => {
  it("routes every display-sink string through t()/data-i18n (none inline)", () => {
    const violations: string[] = [];
    for (const dir of RENDER_DIRS) {
      for (const { rel, path } of tsFiles(dir)) {
        const lines = stripBlockComments(readFileSync(path, "utf8")).split("\n");
        lines.forEach((line, i) => {
          // skip whole-line comments (cheap; line-internal // is rare here)
          if (line.trimStart().startsWith("//")) return;
          if (SINK_PATTERNS.some((re) => re.test(line))) {
            const id = `${rel}:${i + 1}`;
            if (!ALLOWLIST.has(id)) violations.push(`${id}  →  ${line.trim().slice(0, 100)}`);
          }
        });
      }
    }
    expect(
      violations,
      `Hardcoded CJK in a DOM display sink — route it through t(key, lang) and add the key to BOTH catalogs in src/lib/i18n.ts:\n${violations.join("\n")}`,
    ).toEqual([]);
  });

  it("actually scans a non-trivial number of render files (guard isn't a no-op)", () => {
    const count = RENDER_DIRS.reduce((n, d) => n + tsFiles(d).length, 0);
    expect(count).toBeGreaterThan(10);
  });
});
