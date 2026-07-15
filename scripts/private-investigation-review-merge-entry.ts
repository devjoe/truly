import fs from "node:fs";
import path from "node:path";
import process from "node:process";

import { mergeInvestigationReviewParts, type ReviewMergeRetrievalRow } from "./lib/investigation-review-merge";

function option(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function required(name: string): string {
  const value = option(name);
  if (!value) throw new Error(`Missing ${name}`);
  return value;
}

function privatePath(file: string, kind: "input" | "output"): string {
  const resolved = path.resolve(file);
  const publicRoot = `${path.resolve(process.cwd())}${path.sep}`;
  const publicTmp = `${path.resolve(process.cwd(), "tmp")}${path.sep}`;
  if (resolved.startsWith(publicRoot) && !resolved.startsWith(publicTmp)) {
    throw new Error(`${kind} must stay outside the public repo or under tmp/`);
  }
  if (kind === "input" && !fs.existsSync(resolved)) throw new Error(`Missing private input: ${resolved}`);
  return resolved;
}

function readJsonl<T>(file: string): T[] {
  return fs.readFileSync(file, "utf8").split(/\r?\n/u).map((line) => line.trim()).filter(Boolean).map((line) => JSON.parse(line));
}

const retrievalPath = privatePath(required("--retrieval"), "input");
const outputPath = privatePath(required("--output"), "output");
const partPaths = required("--parts").split(",").map((entry) => privatePath(entry.trim(), "input"));
const expectedCount = Number(required("--sample-count"));
const retrievalRows = readJsonl<ReviewMergeRetrievalRow>(retrievalPath);
if (retrievalRows.length !== expectedCount) throw new Error("sample count mismatch");
const rows = mergeInvestigationReviewParts({
  retrievalRows,
  reviewParts: partPaths.map((file) => JSON.parse(fs.readFileSync(file, "utf8"))),
});
fs.mkdirSync(path.dirname(outputPath), { recursive: true, mode: 0o700 });
fs.writeFileSync(outputPath, `${JSON.stringify({
  schemaVersion: 2,
  split: "dev",
  reviewedAt: new Date().toISOString(),
  rows,
}, null, 2)}\n`, { mode: 0o600 });
console.log(JSON.stringify({
  result: "pass",
  samples: rows.length,
  assessments: rows.reduce((sum, row) => sum + row.assessments.length, 0),
  output: "private-eval/<private>",
}, null, 2));
