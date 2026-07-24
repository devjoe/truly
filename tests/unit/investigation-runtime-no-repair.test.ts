import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The ranked-actions release standard promises that the product runtime
 * issues no repair call: `repairReason` is an evaluation-only bounded retry
 * that private eval runners may send, but extension runtime code must never
 * construct a request that carries it. This guard turns that contract claim
 * into a failing test instead of a doc sentence.
 *
 * The only allowed occurrence is the field's definition (and its eval-only
 * doc comment) in the legacy adapter input module itself.
 */
const SRC_ROOT = fileURLToPath(new URL("../../src/", import.meta.url));
const ALLOWED = new Set(["lib/general-page-investigation-adapter.ts"]);

function tsFilesUnder(relativeDir: string): string[] {
  const absolute = join(SRC_ROOT, relativeDir);
  const out: string[] = [];
  for (const name of readdirSync(absolute)) {
    const child = join(absolute, name);
    const relativeChild = relativeDir ? `${relativeDir}/${name}` : name;
    if (statSync(child).isDirectory()) {
      out.push(...tsFilesUnder(relativeChild));
    } else if (name.endsWith(".ts")) {
      out.push(relativeChild);
    }
  }
  return out;
}

describe("investigation runtime repair boundary", () => {
  it("keeps repairReason out of every runtime source except its eval-only definition", () => {
    const files = tsFilesUnder("");
    expect(files.length).toBeGreaterThan(50);
    const offenders = files.filter((file) => {
      if (ALLOWED.has(file)) return false;
      return readFileSync(join(SRC_ROOT, file), "utf8").includes("repairReason");
    });
    expect(offenders).toEqual([]);
  });
});
