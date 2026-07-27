import fs from "node:fs";
import path from "node:path";
import process from "node:process";

import {
  validateTwoStageInvestigationCeremony,
} from "./lib/general-page-investigation-two-stage-ceremony.mjs";

function values(name) {
  const found = [];
  for (let index = 0; index < process.argv.length; index += 1) {
    if (process.argv[index] === name && process.argv[index + 1]) found.push(process.argv[index + 1]);
  }
  return found;
}

function required(name) {
  const value = values(name)[0];
  if (!value) throw new Error(`Missing ${name}`);
  return value;
}

const outputPath = path.resolve(required("--output"));
const candidateCommit = required("--candidate-commit");
const receiptPaths = values("--receipt").map((value) => path.resolve(value));
if (!outputPath.includes(`${path.sep}tmp${path.sep}private-data${path.sep}runs${path.sep}`)) {
  throw new Error("Ceremony output must stay under tmp/private-data/runs");
}
if (fs.existsSync(outputPath)) throw new Error("Ceremony output path already exists");

const receipts = receiptPaths.map((receiptPath) => {
  const raw = fs.readFileSync(receiptPath, "utf8");
  return { path: receiptPath, raw, value: JSON.parse(raw) };
});
const artifact = {
  ...validateTwoStageInvestigationCeremony(receipts, candidateCommit),
  createdAt: new Date().toISOString(),
};
fs.mkdirSync(path.dirname(outputPath), { recursive: true, mode: 0o700 });
fs.writeFileSync(outputPath, `${JSON.stringify(artifact, null, 2)}\n`, {
  flag: "wx",
  mode: 0o600,
});
console.log(JSON.stringify({
  outputPath,
  passed: artifact.passed,
  sourceCount: artifact.sourceCount,
  taskFormats: artifact.taskFormats,
  errors: artifact.errors,
}, null, 2));
if (!artifact.passed) process.exitCode = 2;
