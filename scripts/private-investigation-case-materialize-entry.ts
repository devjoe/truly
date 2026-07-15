import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

import type { InvestigationBundle } from "../src/lib/claim-investigation-contract";
import type {
  InvestigationCaseDraft,
  InvestigationCasePlannerDraft,
} from "../src/lib/claim-investigation-case-planner";
import { materializeInvestigationCasePlannerDraft } from "../src/lib/claim-investigation-case-planner";

interface PlanRow {
  sampleId: string;
  surface: "facebook" | "news";
  materialized?: { ok: boolean; bundle?: InvestigationBundle };
}

interface CaseRow {
  sampleId: string;
  surface: "facebook" | "news";
  draft?: InvestigationCasePlannerDraft;
}

interface OverrideRow {
  sampleId: string;
  reason: string;
  draft?: InvestigationCasePlannerDraft;
  appendTargets?: InvestigationCaseDraft["targets"];
}

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

function sha256(value: string | Buffer): string {
  return crypto.createHash("sha256").update(value).digest("hex");
}

const plansPath = privatePath(required("--plans"), "input");
const casesPath = privatePath(required("--cases"), "input");
const overridesPath = privatePath(required("--overrides"), "input");
const outputPath = privatePath(required("--output"), "output");
const metaOutputPath = privatePath(required("--meta-output"), "output");
const runId = required("--run-id");
const expectedCount = Number(required("--sample-count"));

const plans = readJsonl<PlanRow>(plansPath);
const cases = readJsonl<CaseRow>(casesPath);
const overrides = JSON.parse(fs.readFileSync(overridesPath, "utf8")) as { rows: OverrideRow[] };
if (plans.length !== expectedCount || cases.length !== expectedCount) throw new Error("sample count mismatch");
if (!Array.isArray(overrides.rows)) throw new Error("override rows are required");
const caseById = new Map(cases.map((row) => [row.sampleId, row]));
const overrideById = new Map(overrides.rows.map((row) => [row.sampleId, row]));
if (overrideById.size !== overrides.rows.length) throw new Error("duplicate override sampleId");

const outputRows = plans.map((planRow) => {
  const bundle = planRow.materialized?.bundle;
  const caseRow = caseById.get(planRow.sampleId);
  const override = overrideById.get(planRow.sampleId);
  if (!bundle || !caseRow) throw new Error(`${planRow.sampleId}: missing plan or case`);
  const baseDraft = override?.draft ?? caseRow.draft;
  if (!baseDraft) throw new Error(`${planRow.sampleId}: missing draft`);
  if (baseDraft.schemaVersion === 3 && override?.appendTargets?.length) {
    throw new Error(`${planRow.sampleId}: legacy appendTargets cannot modify a semantic draft`);
  }
  const draft: InvestigationCasePlannerDraft = baseDraft.schemaVersion === 2 && override?.appendTargets?.length
    ? { ...structuredClone(baseDraft), targets: [...baseDraft.targets, ...override.appendTargets] }
    : baseDraft;
  const materialized = materializeInvestigationCasePlannerDraft(draft, bundle, planRow.sampleId);
  if (!materialized.ok) throw new Error(`${planRow.sampleId}: ${materialized.error}: ${materialized.detail ?? ""}`);
  return {
    schemaVersion: 1,
    sampleId: planRow.sampleId,
    surface: planRow.surface,
    reviewStatus: override ? "human_overridden" : "model_draft_accepted",
    ...(override ? { reviewReason: override.reason } : {}),
    draft,
    materialized,
  };
});
if (outputRows.length !== expectedCount) throw new Error("output sample count mismatch");

fs.mkdirSync(path.dirname(outputPath), { recursive: true, mode: 0o700 });
fs.writeFileSync(outputPath, `${outputRows.map((row) => JSON.stringify(row)).join("\n")}\n`, { mode: 0o600 });
fs.writeFileSync(metaOutputPath, `${JSON.stringify({
  schemaVersion: 1,
  runId,
  task: "investigation_case_plan_materialization",
  split: "dev",
  samples: outputRows.length,
  humanOverrides: overrides.rows.length,
  modelDraftsAccepted: outputRows.length - overrides.rows.length,
  plansSha256: sha256(fs.readFileSync(plansPath)),
  casesSha256: sha256(fs.readFileSync(casesPath)),
  overridesSha256: sha256(fs.readFileSync(overridesPath)),
  verdictProduced: false,
  generatedAt: new Date().toISOString(),
}, null, 2)}\n`, { mode: 0o600 });
console.log(JSON.stringify({
  result: "pass",
  samples: outputRows.length,
  humanOverrides: overrides.rows.length,
  modelDraftsAccepted: outputRows.length - overrides.rows.length,
  output: "private-eval/<private>",
}, null, 2));
