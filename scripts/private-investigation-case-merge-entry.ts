import fs from "node:fs";
import path from "node:path";
import process from "node:process";

import type { InvestigationBundle } from "../src/lib/claim-investigation-contract";
import type { InvestigationCaseDraft } from "../src/lib/claim-investigation-case-planner";
import {
  completeMissingInvestigationDiscoveryCoverage,
  materializeInvestigationCase,
} from "../src/lib/claim-investigation-case-planner";

interface PlanRow { sampleId: string; surface: "facebook" | "news"; materialized?: { ok: boolean; bundle?: InvestigationBundle } }
interface CaseRow { sampleId: string; surface: "facebook" | "news"; ok: boolean; draft?: InvestigationCaseDraft; materialized?: { ok: boolean } }
function option(name: string): string | undefined { const index = process.argv.indexOf(name); return index >= 0 ? process.argv[index + 1] : undefined; }
function required(name: string): string { const value = option(name); if (!value) throw new Error(`Missing ${name}`); return value; }
function privatePath(value: string, exists: boolean): string { const resolved = path.resolve(value); if (!resolved.includes(`${path.sep}private-data${path.sep}`)) throw new Error("path must stay under private-data"); if (exists && !fs.existsSync(resolved)) throw new Error(`missing ${resolved}`); return resolved; }
function readJsonl<T>(file: string): T[] { return fs.readFileSync(file, "utf8").split(/\r?\n/u).map((line) => line.trim()).filter(Boolean).map((line) => JSON.parse(line) as T); }

const plansPath = privatePath(required("--plans"), true);
const primaryPath = privatePath(required("--primary-cases"), true);
const fallbackPath = privatePath(required("--fallback-cases"), true);
const outputPath = privatePath(required("--output"), false);
const plans = readJsonl<PlanRow>(plansPath).filter((row) => row.materialized?.ok && row.materialized.bundle);
const primary = new Map(readJsonl<CaseRow>(primaryPath).map((row) => [row.sampleId, row]));
const fallback = new Map(readJsonl<CaseRow>(fallbackPath).map((row) => [row.sampleId, row]));
let fallbackCount = 0;
let localRepairCount = 0;
const output = plans.map((plan) => {
  const preferred = primary.get(plan.sampleId);
  const source = preferred?.ok && preferred.materialized?.ok ? preferred : fallback.get(plan.sampleId);
  if (!source?.draft || !plan.materialized?.bundle) throw new Error(`${plan.sampleId}: no valid case draft`);
  const firstMaterialized = materializeInvestigationCase(source.draft, plan.materialized.bundle, plan.sampleId);
  const repairedDraft = !firstMaterialized.ok
    ? completeMissingInvestigationDiscoveryCoverage(source.draft, plan.materialized.bundle)
    : undefined;
  const materialized = repairedDraft
    ? materializeInvestigationCase(repairedDraft, plan.materialized.bundle, plan.sampleId)
    : firstMaterialized;
  if (!materialized.ok) throw new Error(`${plan.sampleId}: fallback draft invalid: ${materialized.detail ?? materialized.error}`);
  if (repairedDraft) localRepairCount += 1;
  else if (source !== preferred) fallbackCount += 1;
  return { schemaVersion: 1, sampleId: plan.sampleId, surface: plan.surface, ok: true, source: repairedDraft ? "local_coverage_repair" : source === preferred ? "iteration_2" : "iteration_1_fallback", draft: repairedDraft ?? source.draft, materialized };
});
fs.mkdirSync(path.dirname(outputPath), { recursive: true, mode: 0o700 });
fs.writeFileSync(outputPath, `${output.map((row) => JSON.stringify(row)).join("\n")}\n`, { mode: 0o600 });
console.log(JSON.stringify({
  result: "pass",
  samples: output.length,
  iteration2: output.length - fallbackCount - localRepairCount,
  iteration1Fallback: fallbackCount,
  localCoverageRepair: localRepairCount,
  output: "private-data/<private>",
}, null, 2));
