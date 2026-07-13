import fs from "node:fs";
import path from "node:path";

export const PRIVATE_EVAL_SURFACES = ["facebook", "news"];

export function parsePrivateEvalJsonl(text) {
  return String(text)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line, index) => {
      try {
        return JSON.parse(line);
      } catch {
        throw new Error(`Invalid JSONL at line ${index + 1}`);
      }
    });
}

export function privateEvalInputErrors(rows, expectedCount, declaredCategories) {
  const errors = [];
  if (!Number.isInteger(expectedCount) || expectedCount < 1) errors.push("--sample-count must be a positive integer");
  if (rows.length !== expectedCount) errors.push(`sample count mismatch: expected ${expectedCount}, found ${rows.length}`);
  const declared = new Set(String(declaredCategories).split(",").map((value) => value.trim()).filter(Boolean));
  const seenIds = new Set();
  const actual = new Set();
  for (const [index, row] of rows.entries()) {
    const label = `line ${index + 1}`;
    if (!row || typeof row !== "object" || Array.isArray(row)) {
      errors.push(`${label}: record must be an object`);
      continue;
    }
    if (typeof row.sampleId !== "string" || !/^(?:fb|news)_[a-f0-9]{32}$/.test(row.sampleId)) errors.push(`${label}: invalid opaque sampleId`);
    if (seenIds.has(row.sampleId)) errors.push(`${label}: duplicate sampleId`);
    seenIds.add(row.sampleId);
    if (!PRIVATE_EVAL_SURFACES.includes(row.surface)) errors.push(`${label}: invalid surface`);
    else actual.add(`${row.surface}-original`);
    if (!['zh-TW', 'en'].includes(row.language)) errors.push(`${label}: invalid language`);
    if (typeof row.text !== "string" || row.text.trim().length < 80 || row.text.length > 12000) errors.push(`${label}: text must be 80-12000 characters`);
    if (typeof row.sourceSha256 !== "string" || !/^[a-f0-9]{64}$/.test(row.sourceSha256)) errors.push(`${label}: invalid sourceSha256`);
  }
  if ([...actual].some((category) => !declared.has(category)) || [...declared].some((category) => !actual.has(category))) {
    errors.push(`data categories mismatch: declared ${[...declared].sort().join(",")}; actual ${[...actual].sort().join(",")}`);
  }
  return errors;
}

export function assertPrivateEvalPaths(inputPath, outputPath, metaOutputPath, cwd) {
  const resolved = [inputPath, outputPath, metaOutputPath].map((value) => path.resolve(value));
  if (new Set(resolved).size !== resolved.length) throw new Error("Input, output, and meta output paths must differ");
  const repoRoot = `${path.resolve(cwd)}${path.sep}`;
  const tmpRoot = `${path.resolve(cwd, "tmp")}${path.sep}`;
  for (const [index, value] of resolved.entries()) {
    if (index === 0 && !fs.existsSync(value)) throw new Error("Private eval input does not exist");
    if (value.startsWith(repoRoot) && !value.startsWith(tmpRoot)) throw new Error("Private eval files must stay outside the public repo or under tmp/");
  }
  return { input: resolved[0], output: resolved[1], metaOutput: resolved[2] };
}

export function outputLanguageForPrivateEval(language) {
  return language === "en" ? "en" : "zh-TW";
}
