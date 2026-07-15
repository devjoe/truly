import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

import type { InvestigationBundle } from "../src/lib/claim-investigation-contract";
import type { InvestigationCase } from "../src/lib/claim-investigation-case";
import {
  buildConservativeProofResponsibilities,
  buildDefaultInvestigationObligations,
} from "../src/lib/claim-investigation-obligations";
import { buildInvestigationSourceFamilyPlan } from "../src/lib/investigation-discovery-planner";
import { validateInvestigationAcquisitionPortfolio } from "../src/lib/investigation-source-route";

interface PlanRow {
  sampleId: string;
  surface: "facebook" | "news";
  materialized?: { ok: boolean; bundle?: InvestigationBundle };
}

interface CaseRow {
  sampleId: string;
  surface: "facebook" | "news";
  ok: boolean;
  materialized?: { ok: boolean; investigationCase?: InvestigationCase };
}

function option(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}
function required(name: string): string { const value = option(name); if (!value) throw new Error(`Missing ${name}`); return value; }
function privatePath(value: string, mustExist: boolean): string {
  const resolved = path.resolve(value);
  if (!resolved.includes(`${path.sep}private-data${path.sep}`)) throw new Error("all inputs and outputs must remain under private-data");
  if (mustExist && !fs.existsSync(resolved)) throw new Error(`missing private input: ${resolved}`);
  return resolved;
}
function readJsonl<T>(file: string): T[] {
  return fs.readFileSync(file, "utf8").split(/\r?\n/u).map((line) => line.trim()).filter(Boolean).map((line) => JSON.parse(line) as T);
}
function sha256(file: string): string { return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex"); }

const plansPath = privatePath(required("--plans"), true);
const casesPath = privatePath(required("--cases"), true);
const preregistrationPath = privatePath(required("--preregistration"), true);
const outputPath = privatePath(required("--output"), false);
const metaPath = privatePath(required("--meta-output"), false);
const plans = readJsonl<PlanRow>(plansPath);
const cases = new Map(readJsonl<CaseRow>(casesPath).map((row) => [row.sampleId, row]));
const preregistration = JSON.parse(fs.readFileSync(preregistrationPath, "utf8"));
if (plans.length !== preregistration.plannerReview.expectedRows) throw new Error("preregistered row count mismatch");

const rows = plans.map((row) => {
  if (!row.materialized?.ok || !row.materialized.bundle) {
    return { schemaVersion: 1, sampleId: row.sampleId, surface: row.surface, applicability: "not_applicable", reason: "no_materialized_checkworthy_claim", evidenceProduced: false, verdictProduced: false };
  }
  const caseRow = cases.get(row.sampleId);
  const investigationCase = caseRow?.materialized?.investigationCase;
  if (!caseRow?.ok || !caseRow.materialized?.ok || !investigationCase) {
    return { schemaVersion: 1, sampleId: row.sampleId, surface: row.surface, applicability: "invalid", reason: "missing_valid_case_v2", evidenceProduced: false, verdictProduced: false };
  }
  const responsibilities = buildConservativeProofResponsibilities(row.materialized.bundle, investigationCase);
  const obligationSet = buildDefaultInvestigationObligations(row.materialized.bundle, investigationCase, responsibilities);
  try {
    const sourceFamilyPlan = buildInvestigationSourceFamilyPlan({ bundle: row.materialized.bundle, investigationCase, obligationSet });
    const issues = validateInvestigationAcquisitionPortfolio({ ledger: sourceFamilyPlan, obligationSet });
    return {
      schemaVersion: 1,
      sampleId: row.sampleId,
      surface: row.surface,
      applicability: issues.length ? "invalid" : "planned",
      bundle: row.materialized.bundle,
      investigationCase,
      responsibilities,
      obligationSet,
      sourceFamilyPlan,
      issues,
      review: { contextGrounded: null, routeFit: null, fallbackFit: null, unsafeAction: null, note: "" },
      evidenceProduced: false,
      verdictProduced: false,
    };
  } catch (error) {
    return { schemaVersion: 1, sampleId: row.sampleId, surface: row.surface, applicability: "invalid", reason: error instanceof Error ? error.message : String(error), evidenceProduced: false, verdictProduced: false };
  }
});

fs.mkdirSync(path.dirname(outputPath), { recursive: true, mode: 0o700 });
fs.writeFileSync(outputPath, `${rows.map((row) => JSON.stringify(row)).join("\n")}\n`, { mode: 0o600 });
const planned = rows.filter((row) => row.applicability === "planned");
const meta = {
  schemaVersion: 1,
  task: "investigation_discovery_plan_v2",
  split: "dev",
  preregistrationSha256: sha256(preregistrationPath),
  plansSha256: sha256(plansPath),
  casesSha256: sha256(casesPath),
  rows: rows.length,
  planned: planned.length,
  notApplicable: rows.filter((row) => row.applicability === "not_applicable").length,
  invalid: rows.filter((row) => row.applicability === "invalid").length,
  surfaces: Object.fromEntries(["facebook", "news"].map((surface) => [surface, rows.filter((row) => row.surface === surface).length])),
  routeFamilies: Object.fromEntries(["canonical_record", "contextual_discovery", "lineage_diverse"].map((family) => [family, planned.reduce((sum, row) => sum + ("sourceFamilyPlan" in row ? row.sourceFamilyPlan.routes.filter((route) => route.routeFamily === family).length : 0), 0)])),
  mandatoryObligations: planned.reduce((sum, row) => sum + ("obligationSet" in row ? row.obligationSet.obligations.filter((obligation) => obligation.mandatory).length : 0), 0),
  evidenceProduced: false,
  verdictProduced: false,
  completedAt: new Date().toISOString(),
};
fs.writeFileSync(metaPath, `${JSON.stringify(meta, null, 2)}\n`, { mode: 0o600 });
console.log(JSON.stringify({ result: meta.invalid === 0 && meta.planned === preregistration.plannerReview.expectedPlanCandidates ? "pass" : "fail", ...meta, output: "private-data/<private>" }, null, 2));
