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
import {
  buildSourceAwareAcquisitionPlan,
  validateInvestigationTrustedLocatorCatalog,
  type InvestigationTrustedLocatorCatalog,
} from "../src/lib/investigation-source-aware-acquisition";

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
function countBy(values: string[]): Record<string, number> {
  return values.reduce<Record<string, number>>((counts, value) => ({ ...counts, [value]: (counts[value] ?? 0) + 1 }), {});
}

const plansPath = privatePath(required("--plans"), true);
const casesPath = privatePath(required("--cases"), true);
const catalogPath = privatePath(required("--catalog"), true);
const outputPath = privatePath(required("--output"), false);
const metaPath = privatePath(required("--meta-output"), false);
const expectedCount = Number(required("--sample-count"));
const datasetVersion = required("--dataset-version");
if (!new Set([
  "gpr-source-aware-forward-dev-v1",
  "gpr-source-aware-news-forward-dev-v1",
  "gpr-authority-discovery-sequential-news-dev-v1",
]).has(datasetVersion) ||
  !Number.isInteger(expectedCount) || expectedCount < 1) {
  throw new Error("unexpected source-aware dataset contract");
}

const plans = readJsonl<PlanRow>(plansPath);
if (plans.length !== expectedCount || new Set(plans.map((row) => row.sampleId)).size !== plans.length) {
  throw new Error("source-aware input row contract mismatch");
}
const cases = new Map(readJsonl<CaseRow>(casesPath).map((row) => [row.sampleId, row]));
const catalog = JSON.parse(fs.readFileSync(catalogPath, "utf8")) as InvestigationTrustedLocatorCatalog;
const catalogIssues = validateInvestigationTrustedLocatorCatalog(catalog);
if (catalogIssues.length) throw new Error(`invalid trusted locator catalog: ${catalogIssues.join("; ")}`);

const rows = plans.map((row) => {
  if (!row.materialized?.ok || !row.materialized.bundle) {
    return { schemaVersion: 1, sampleId: row.sampleId, surface: row.surface, applicability: "not_applicable", reason: "no_materialized_checkworthy_claim", evidenceProduced: false, verdictProduced: false };
  }
  const caseRow = cases.get(row.sampleId);
  const investigationCase = caseRow?.materialized?.investigationCase;
  if (!caseRow?.ok || !caseRow.materialized?.ok || !investigationCase) {
    return { schemaVersion: 1, sampleId: row.sampleId, surface: row.surface, applicability: "invalid", reason: "missing_valid_case_v2", evidenceProduced: false, verdictProduced: false };
  }
  try {
    const proofResponsibilities = buildConservativeProofResponsibilities(row.materialized.bundle, investigationCase);
    const obligationSet = buildDefaultInvestigationObligations(row.materialized.bundle, investigationCase, proofResponsibilities);
    const sourceAwarePlan = buildSourceAwareAcquisitionPlan({ bundle: row.materialized.bundle, investigationCase, obligationSet, catalog });
    return {
      schemaVersion: 1,
      sampleId: row.sampleId,
      surface: row.surface,
      applicability: "planned",
      sourceAwarePlan,
      review: { responsibilityCoverage: null, queryPortfolioAligned: null, inventedLocator: null, catalogMismatch: null, unsafeAction: null, note: "" },
      evidenceProduced: false,
      verdictProduced: false,
    };
  } catch (error) {
    return { schemaVersion: 1, sampleId: row.sampleId, surface: row.surface, applicability: "invalid", reason: error instanceof Error ? error.message : String(error), evidenceProduced: false, verdictProduced: false };
  }
});

fs.mkdirSync(path.dirname(outputPath), { recursive: true, mode: 0o700 });
fs.writeFileSync(outputPath, `${rows.map((row) => JSON.stringify(row)).join("\n")}\n`, { mode: 0o600 });
const planned = rows.filter((row): row is Extract<typeof rows[number], { applicability: "planned" }> => row.applicability === "planned");
const routes = planned.flatMap((row) => row.sourceAwarePlan.routes);
const meta = {
  schemaVersion: 1,
  task: "source_aware_acquisition_plan_v1",
  datasetVersion,
  split: "dev",
  plansSha256: sha256(plansPath),
  casesSha256: sha256(casesPath),
  catalogSha256: sha256(catalogPath),
  rows: rows.length,
  planned: planned.length,
  notApplicable: rows.filter((row) => row.applicability === "not_applicable").length,
  invalid: rows.filter((row) => row.applicability === "invalid").length,
  surfaces: countBy(rows.map((row) => row.surface)),
  responsibilities: countBy(routes.map((route) => route.responsibility.kind)),
  locatorStates: countBy(routes.map((route) => route.locatorState)),
  sourceFamilies: countBy(routes.map((route) => route.route.sourceFamily)),
  queryPortfolioSizes: countBy(routes.map((route) => String(route.queryPortfolio.length))),
  catalogEntries: catalog.entries.length,
  evidenceProduced: false,
  verdictProduced: false,
  completedAt: new Date().toISOString(),
};
fs.writeFileSync(metaPath, `${JSON.stringify(meta, null, 2)}\n`, { mode: 0o600 });
console.log(JSON.stringify({ result: meta.invalid === 0 ? "pass" : "fail", ...meta, output: "private-data/<private>" }, null, 2));
