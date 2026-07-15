import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { evaluateInvestigationPairedProofUpperBound } from "../src/lib/investigation-paired-proof-bound";
function option(name: string): string | undefined { const index = process.argv.indexOf(name); return index >= 0 ? process.argv[index + 1] : undefined; }
function required(name: string): string { const value = option(name); if (!value) throw new Error(`Missing ${name}`); return value; }
function privatePath(value: string, exists: boolean): string { const resolved = path.resolve(value); if (!resolved.includes(`${path.sep}private-data${path.sep}`)) throw new Error("path must stay under private-data"); if (exists && !fs.existsSync(resolved)) throw new Error(`missing ${resolved}`); return resolved; }
const inputPath = privatePath(required("--input"), true);
const preregPath = privatePath(required("--preregistration"), true);
const outputPath = privatePath(required("--output"), false);
const rows = fs.readFileSync(inputPath, "utf8").split(/\r?\n/u).map((line) => line.trim()).filter(Boolean).map(JSON.parse);
const prereg = JSON.parse(fs.readFileSync(preregPath, "utf8"));
const trials = rows.map((row) => ({
  trialId: `trial:${row.sampleId}:${row.obligation.id}`,
  obligationType: row.obligation.type,
  minimumPassageCandidates: row.obligation.type === "independent_origins"
    ? row.obligation.minimumIndependentOrigins
    : 1,
  baselinePassageCandidates: row.routeRuns.find((run: any) => run.arm === "baseline")?.passageCandidates ?? 0,
  candidatePassageCandidates: row.routeRuns.find((run: any) => run.arm === "candidate")?.passageCandidates ?? 0,
}));
const result = evaluateInvestigationPairedProofUpperBound(trials, prereg.matchedPairedAudit.successGate.candidateOnlyRescuesMinimum);
const output = { schemaVersion: 1, split: "dev", ...result, snippetEvidenceCount: 0, proofCertificatesIssued: 0, evidenceProduced: false, verdictProduced: false, completedAt: new Date().toISOString() };
fs.mkdirSync(path.dirname(outputPath), { recursive: true, mode: 0o700 });
fs.writeFileSync(outputPath, `${JSON.stringify(output, null, 2)}\n`, { mode: 0o600 });
console.log(JSON.stringify({ result: result.canReachCandidateOnlyGate ? "proof_review_required" : "gate_failed_at_admission_ceiling", ...output, output: "private-data/<private>" }, null, 2));
