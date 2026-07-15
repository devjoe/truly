import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

import type { InvestigationCase } from "../src/lib/claim-investigation-case";
import {
  validateInvestigationRouteReceipt,
  validateInvestigationSourceRouteLedger,
  type InvestigationRouteReceipt,
  type InvestigationSourceFamilyPlan,
  type InvestigationSourceRoute,
} from "../src/lib/investigation-source-route";

interface PlanRow {
  sampleId: string;
  investigationCase: InvestigationCase;
  sourceFamilyPlan: InvestigationSourceFamilyPlan;
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
function privatePath(value: string, exists: boolean): string {
  const resolved = path.resolve(value);
  if (!resolved.includes(`${path.sep}private-data${path.sep}`)) throw new Error("path must stay under private-data");
  if (exists && !fs.existsSync(resolved)) throw new Error(`missing ${resolved}`);
  return resolved;
}
function readJsonl<T>(file: string): T[] {
  return fs.readFileSync(file, "utf8").split(/\r?\n/u).map((line) => line.trim()).filter(Boolean).map((line) => JSON.parse(line) as T);
}
function sha256(value: string): string {
  return crypto.createHash("sha256").update(value).digest("hex");
}

const inputPath = privatePath(required("--input"), true);
const planPath = privatePath(required("--plan-input"), true);
const metaPath = privatePath(required("--meta-input"), true);
const outputPath = privatePath(required("--output"), false);
const trials = readJsonl<any>(inputPath);
const planBySample = new Map(readJsonl<PlanRow>(planPath).map((row) => [row.sampleId, row]));
const runMeta = JSON.parse(fs.readFileSync(metaPath, "utf8"));
if (Number.isNaN(Date.parse(runMeta.completedAt))) throw new Error("matched run has no valid completion timestamp");

let receiptCount = 0;
const upgraded = trials.map((trial) => {
  const plan = planBySample.get(trial.sampleId);
  if (!plan) throw new Error(`${trial.sampleId}: missing source-family plan`);
  const candidateRun = trial.routeRuns.find((run: any) => run.arm === "candidate");
  const candidateRoute = plan.sourceFamilyPlan.routes.find((route) => route.id === candidateRun?.routeId);
  if (!candidateRoute) throw new Error(`${trial.sampleId}: missing candidate route`);
  const routeRuns = trial.routeRuns.map((run: any) => {
    const route: InvestigationSourceRoute = {
      ...candidateRoute,
      id: run.arm === "candidate"
        ? candidateRoute.id
        : `route:matched:${sha256(`${trial.sampleId}:${trial.obligation.id}:baseline`).slice(0, 20)}:baseline`,
      fallback: false,
      fallbackForRouteId: undefined,
      locator: { kind: "open_web", query: run.query },
      budget: {
        maxQueries: trial.budget.maxQueries,
        maxDocuments: trial.budget.maxDocuments,
        maxBytes: trial.budget.maxBytes * trial.budget.maxDocuments,
        maxDurationMs: trial.budget.maxDurationMs,
      },
    };
    const observedOriginKeys = [...new Set<string>(run.documentRuns.flatMap((document: any) => {
      if (document.status === "fetch_failed" || !document.finalUrl) return [];
      try { return [`host:${new URL(document.finalUrl).hostname.toLowerCase()}`]; }
      catch { return []; }
    }))];
    const unresolvedBlindSpots = [
      ...(run.searchCandidates.length > run.documentsConsidered ? ["search candidates remained outside the matched document budget"] : []),
      ...(run.documentRuns.some((document: any) => document.status === "fetch_failed") ? ["one or more selected documents could not be fetched"] : []),
      ...(run.passageCandidates === 0 ? ["no exact passage candidate was admitted"] : []),
      "per-route completion timestamp unavailable; receipt uses the immutable run completion timestamp",
    ];
    const stopReason: InvestigationRouteReceipt["stopReason"] = run.searchCandidates.length === 0
      ? "capability_unavailable"
      : run.searchCandidates.length > run.documentsConsidered
        ? "budget_exhausted"
        : run.documentsFetched === 0
          ? "access_denied"
          : "document_families_exhausted";
    const languages = [...new Set(plan.investigationCase.discoveryContext.languages)].slice(0, 6);
    const receipt: InvestigationRouteReceipt = {
      version: 2,
      routeId: route.id,
      obligationIds: route.obligationIds,
      queriesAttempted: 1,
      documentsConsidered: run.documentsConsidered,
      documentsFetched: run.documentsFetched,
      bytesFetched: run.bytesFetched,
      durationMs: run.durationMs,
      coveredSourceFamilies: run.searchCandidates.length > 0 ? [route.sourceFamily] : [],
      languages: languages.length > 0 ? languages : ["und"],
      observedOriginKeys,
      unresolvedBlindSpots,
      stopReason,
      completedAt: runMeta.completedAt,
      evidenceProduced: false,
      verdictProduced: false,
    };
    const routeIssues = validateInvestigationSourceRouteLedger({ version: 2, caseId: plan.investigationCase.id, routes: [route] });
    const receiptIssues = validateInvestigationRouteReceipt(receipt, route);
    if (routeIssues.length || receiptIssues.length) throw new Error(`${trial.sampleId}:${run.arm}: ${[...routeIssues, ...receiptIssues].join("; ")}`);
    receiptCount += 1;
    return { ...run, routeId: route.id, acquisitionRoute: route, receipt };
  });
  return { ...trial, routeRuns };
});

fs.mkdirSync(path.dirname(outputPath), { recursive: true, mode: 0o700 });
fs.writeFileSync(outputPath, `${upgraded.map((trial) => JSON.stringify(trial)).join("\n")}\n`, { mode: 0o600 });
console.log(JSON.stringify({ result: "pass", trials: upgraded.length, typedReceipts: receiptCount, evidenceProduced: false, verdictProduced: false, output: "private-data/<private>" }, null, 2));
