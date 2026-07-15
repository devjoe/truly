import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import type { InvestigationBundle } from "../src/lib/claim-investigation-contract";
import type { InvestigationCase } from "../src/lib/claim-investigation-case";
import {
  buildFrozenLocalAcquisitionTrial,
  type FrozenLocatorDocument,
} from "../src/lib/investigation-local-snapshot-audit";
import type { InvestigationSourceAwareAcquisitionPlan } from "../src/lib/investigation-source-aware-acquisition";

interface PlanRow { sampleId: string; materialized?: { ok: boolean; bundle?: InvestigationBundle } }
interface CaseRow { sampleId: string; ok: boolean; materialized?: { ok: boolean; investigationCase?: InvestigationCase } }
interface SourceAwareRow { sampleId: string; applicability: string; sourceAwarePlan?: InvestigationSourceAwareAcquisitionPlan }

function option(name: string): string | undefined { const index = process.argv.indexOf(name); return index >= 0 ? process.argv[index + 1] : undefined; }
function required(name: string): string { const value = option(name); if (!value) throw new Error(`Missing ${name}`); return value; }
function privatePath(value: string, mustExist: boolean): string {
  const resolved = path.resolve(value);
  if (!resolved.includes(`${path.sep}private-data${path.sep}`)) throw new Error("all audit paths must stay under private-data");
  if (mustExist && !fs.existsSync(resolved)) throw new Error(`missing ${resolved}`);
  return resolved;
}
function readJsonl<T>(file: string): T[] { return fs.readFileSync(file, "utf8").split(/\r?\n/u).map((line) => line.trim()).filter(Boolean).map((line) => JSON.parse(line) as T); }
function sha256(file: string): string { return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex"); }

const plansPath = privatePath(required("--plans"), true);
const casesPath = privatePath(required("--cases"), true);
const sourceAwarePath = privatePath(required("--source-aware-plans"), true);
const documentsPath = privatePath(required("--documents"), true);
const outputPath = privatePath(required("--output"), false);
const metaPath = privatePath(required("--meta-output"), false);
const expectedRoutes = Number(required("--expected-matched-routes"));
const maxDocuments = Number(option("--max-documents") ?? "2");

const plans = new Map(readJsonl<PlanRow>(plansPath).map((row) => [row.sampleId, row]));
const cases = new Map(readJsonl<CaseRow>(casesPath).map((row) => [row.sampleId, row]));
const sourceAwareRows = readJsonl<SourceAwareRow>(sourceAwarePath);
const documents = readJsonl<FrozenLocatorDocument>(documentsPath);
const trials = sourceAwareRows.flatMap((row) => {
  if (row.applicability !== "planned" || !row.sourceAwarePlan) return [];
  const bundle = plans.get(row.sampleId)?.materialized?.bundle;
  const investigationCase = cases.get(row.sampleId)?.materialized?.investigationCase;
  if (!bundle || !investigationCase) throw new Error(`${row.sampleId}: missing valid plan or case`);
  return row.sourceAwarePlan.routes
    .filter((route) => route.locatorState === "matched_catalog")
    .map((route) => {
      const question = bundle.plan.questions.find((candidate) => candidate.id === route.responsibility.questionId);
      if (!question) throw new Error(`${row.sampleId}: unknown route question`);
      return buildFrozenLocalAcquisitionTrial({
        sampleId: row.sampleId,
        normalizedClaim: bundle.subject.normalizedClaim,
        question,
        requiredFacets: route.responsibility.requiredFacets,
        route,
        documents,
        maxDocuments,
      });
    });
});
if (!Number.isInteger(expectedRoutes) || expectedRoutes < 1 || trials.length !== expectedRoutes) {
  throw new Error(`matched route count mismatch: expected ${expectedRoutes}, got ${trials.length}`);
}
if (trials.some((trial) => trial.externalQueryCount !== 0 || trial.evidenceProduced || trial.verdictProduced)) {
  throw new Error("frozen audit crossed its safety boundary");
}

fs.mkdirSync(path.dirname(outputPath), { recursive: true, mode: 0o700 });
fs.writeFileSync(outputPath, `${trials.map((trial) => JSON.stringify(trial)).join("\n")}\n`, { mode: 0o600 });
const baselinePassageCandidates = trials.reduce((sum, trial) => sum + trial.baseline.documents.filter((document) => document.passageCandidate).length, 0);
const candidatePassageCandidates = trials.reduce((sum, trial) => sum + trial.candidate.documents.filter((document) => document.passageCandidate).length, 0);
const meta = {
  schemaVersion: 1,
  task: "frozen_local_source_aware_acquisition_audit",
  split: "dev",
  plansSha256: sha256(plansPath),
  casesSha256: sha256(casesPath),
  sourceAwarePlansSha256: sha256(sourceAwarePath),
  documentsSha256: sha256(documentsPath),
  frozenDocuments: documents.length,
  trials: trials.length,
  routeRuns: trials.length * 2,
  budget: { maxQueriesPerArm: 1, maxDocumentsPerArm: maxDocuments },
  baselinePassageCandidates,
  candidatePassageCandidates,
  candidateOnlyPassageCandidates: trials.filter((trial) => trial.candidateOnlyPassageCandidate).length,
  externalQueryCount: 0,
  privateDerivedQuerySentExternally: false,
  evidenceProduced: false,
  verdictProduced: false,
  completedAt: new Date().toISOString(),
};
fs.writeFileSync(metaPath, `${JSON.stringify(meta, null, 2)}\n`, { mode: 0o600 });
console.log(JSON.stringify({ result: "pass", ...meta, output: "private-data/<private>" }, null, 2));
