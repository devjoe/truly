import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

import type { InvestigationBundle } from "../src/lib/claim-investigation-contract";
import type { InvestigationCase } from "../src/lib/claim-investigation-case";
import type { EvidencePassageAssessment } from "../src/lib/claim-investigation-evidence";
import { evaluateInvestigationEvidenceSufficiency } from "../src/lib/claim-investigation-evidence";
import type {
  InvestigationQuestionProofResponsibility,
  QuestionAcquisitionTrace,
  SearchCoverageReceipt,
} from "../src/lib/claim-investigation-obligations";
import { buildDefaultInvestigationObligations, evaluateInvestigationProgress } from "../src/lib/claim-investigation-obligations";

interface PlanRow {
  sampleId: string;
  materialized?: { bundle?: InvestigationBundle };
}

interface CaseRow {
  sampleId: string;
  materialized?: { investigationCase?: InvestigationCase };
}

interface RetrievalQuestionRun {
  questionId: string;
  status: string;
  evidence?: InvestigationBundle["evidence"][number];
}

interface RetrievalRow {
  sampleId: string;
  targetRuns: Array<{
    questionIds?: string[];
    status: string;
    questionRuns?: RetrievalQuestionRun[];
    documentRuns?: Array<{
      status: string;
      acquisitionFailureCode?: string;
    }>;
  }>;
}

interface ReviewRow {
  sampleId: string;
  assessments: EvidencePassageAssessment[];
}

interface SearchReceiptRow {
  sampleId: string;
  receipts: SearchCoverageReceipt[];
}

interface ProofResponsibilityRow {
  sampleId: string;
  responsibilities: InvestigationQuestionProofResponsibility[];
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
const retrievalPath = privatePath(required("--retrieval"), "input");
const reviewPath = privatePath(required("--review"), "input");
const searchReceiptsOption = option("--search-receipts");
const searchReceiptsPath = searchReceiptsOption ? privatePath(searchReceiptsOption, "input") : undefined;
const proofResponsibilitiesOption = option("--proof-responsibilities");
const proofResponsibilitiesPath = proofResponsibilitiesOption ? privatePath(proofResponsibilitiesOption, "input") : undefined;
const outputPath = privatePath(required("--output"), "output");
const metaOutputPath = privatePath(required("--meta-output"), "output");
const runId = required("--run-id");
const expectedCount = Number(required("--sample-count"));

const plans = readJsonl<PlanRow>(plansPath);
const cases = new Map(readJsonl<CaseRow>(casesPath).map((row) => [row.sampleId, row]));
const retrievalRows = new Map(readJsonl<RetrievalRow>(retrievalPath).map((row) => [row.sampleId, row]));
const reviewDocument = JSON.parse(fs.readFileSync(reviewPath, "utf8")) as { rows: ReviewRow[] };
const receiptDocument = searchReceiptsPath
  ? JSON.parse(fs.readFileSync(searchReceiptsPath, "utf8")) as { rows: SearchReceiptRow[] }
  : { rows: [] as SearchReceiptRow[] };
const proofResponsibilityDocument = proofResponsibilitiesPath
  ? JSON.parse(fs.readFileSync(proofResponsibilitiesPath, "utf8")) as { rows: ProofResponsibilityRow[] }
  : { rows: [] as ProofResponsibilityRow[] };
if (plans.length !== expectedCount || cases.size !== expectedCount || retrievalRows.size !== expectedCount) {
  throw new Error("sample count mismatch");
}
const expectedSampleIds = new Set(plans.map((row) => row.sampleId));
function exactRowMap<Row extends { sampleId: string }>(rows: Row[], label: string): Map<string, Row> {
  const result = new Map(rows.map((row) => [row.sampleId, row]));
  if (result.size !== rows.length || result.size !== expectedSampleIds.size ||
    [...expectedSampleIds].some((sampleId) => !result.has(sampleId)) ||
    rows.some((row) => !expectedSampleIds.has(row.sampleId))) {
    throw new Error(`${label} sample IDs must be unique and exactly match the plan samples`);
  }
  return result;
}
const reviews = exactRowMap(reviewDocument.rows, "review");
const receipts = searchReceiptsPath ? exactRowMap(receiptDocument.rows, "search receipt") : new Map<string, SearchReceiptRow>();
const proofResponsibilities = proofResponsibilitiesPath
  ? exactRowMap(proofResponsibilityDocument.rows, "proof responsibility")
  : new Map<string, ProofResponsibilityRow>();

const assessedAt = new Date().toISOString();
const outputRows = plans.map((planRow) => {
  const baseBundle = planRow.materialized?.bundle;
  const investigationCase = cases.get(planRow.sampleId)?.materialized?.investigationCase;
  const retrieval = retrievalRows.get(planRow.sampleId);
  if (!baseBundle || !investigationCase || !retrieval) throw new Error(`${planRow.sampleId}: missing input`);
  const artifacts = retrieval.targetRuns.flatMap((target) => target.questionRuns ?? [])
    .filter((run) => run.status === "passage_candidate_extracted" && run.evidence)
    .map((run) => structuredClone(run.evidence!));
  const review = reviews.get(planRow.sampleId);
  const assessments = review?.assessments ?? [];
  const artifactIds = new Set(artifacts.map((artifact) => artifact.id));
  const assessmentIds = new Set(assessments.map((assessment) => assessment.artifactId));
  if (artifactIds.size !== assessmentIds.size || [...artifactIds].some((id) => !assessmentIds.has(id))) {
    throw new Error(`${planRow.sampleId}: every passage candidate requires exactly one manual assessment`);
  }
  const relationByArtifact = new Map(assessments.map((assessment) => [assessment.artifactId, assessment.relation]));
  artifacts.forEach((artifact) => {
    artifact.relation = relationByArtifact.get(artifact.id) ?? "context";
  });
  const bundle = { ...structuredClone(baseBundle), evidence: artifacts };
  delete bundle.sufficiency;
  delete bundle.finding;
  const evaluation = evaluateInvestigationEvidenceSufficiency(bundle, investigationCase, assessments, assessedAt);
  if (!evaluation.validation.ok || !evaluation.sufficiency) {
    throw new Error(`${planRow.sampleId}: evidence evaluation failed: ${JSON.stringify(evaluation.validation)}`);
  }
  const obligationSet = buildDefaultInvestigationObligations(
    bundle,
    investigationCase,
    proofResponsibilities.get(planRow.sampleId)?.responsibilities ?? [],
  );
  const acquisitionTraces: QuestionAcquisitionTrace[] = investigationCase.questionIds.map((questionId) => {
    const targets = retrieval.targetRuns.filter((target) => target.questionIds?.includes(questionId));
    const documents = targets.flatMap((target) => target.documentRuns ?? []);
    const attempts = documents.length;
    const documentsFetched = documents.filter((document) => document.status === "document_fetched").length;
    const hasUnexploredPath = targets.some((target) => [
      "no_candidate_document", "budget_exhausted", "not_needed",
    ].includes(target.status));
    const terminalUnavailable = attempts > 0 && documentsFetched === 0 &&
      documents.every((document) => document.status === "acquisition_failed" &&
        ["capability_unavailable", "access_denied"].includes(document.acquisitionFailureCode ?? ""));
    return {
      questionId,
      attempts,
      documentsFetched,
      allKnownCandidatesUnavailable: terminalUnavailable && !hasUnexploredPath,
    };
  });
  const progress = evaluateInvestigationProgress({
    bundle,
    investigationCase,
    evidenceEvaluation: evaluation,
    obligationSet,
    searchReceipts: receipts.get(planRow.sampleId)?.receipts ?? [],
    acquisitionTraces,
    assessedAt,
  });
  return {
    schemaVersion: 2,
    sampleId: planRow.sampleId,
    caseId: investigationCase.id,
    passageCandidateCount: artifacts.length,
    assessmentCount: assessments.length,
    qualifyingEvidenceCount: evaluation.qualifyingArtifactIds.length,
    independentOriginCount: evaluation.independentOriginCount,
    sufficiency: evaluation.sufficiency,
    progress,
    verdictProduced: false,
  };
});

fs.mkdirSync(path.dirname(outputPath), { recursive: true, mode: 0o700 });
fs.writeFileSync(outputPath, `${outputRows.map((row) => JSON.stringify(row)).join("\n")}\n`, { mode: 0o600 });
fs.writeFileSync(metaOutputPath, `${JSON.stringify({
  schemaVersion: 1,
  runId,
  task: "investigation_case_manual_evidence_sufficiency",
  split: "dev",
  samples: outputRows.length,
  plansSha256: sha256(fs.readFileSync(plansPath)),
  casesSha256: sha256(fs.readFileSync(casesPath)),
  retrievalSha256: sha256(fs.readFileSync(retrievalPath)),
  reviewSha256: sha256(fs.readFileSync(reviewPath)),
  searchReceiptsSha256: searchReceiptsPath ? sha256(fs.readFileSync(searchReceiptsPath)) : undefined,
  proofResponsibilitiesSha256: proofResponsibilitiesPath ? sha256(fs.readFileSync(proofResponsibilitiesPath)) : undefined,
  assessedAt,
  searchSnippetsAreEvidence: false,
  verdictProduced: false,
}, null, 2)}\n`, { mode: 0o600 });

const states = outputRows.reduce<Record<string, number>>((counts, row) => {
  counts[row.sufficiency.state] = (counts[row.sufficiency.state] ?? 0) + 1;
  return counts;
}, {});
const progressStates = outputRows.reduce<Record<string, number>>((counts, row) => {
  counts[row.progress.state] = (counts[row.progress.state] ?? 0) + 1;
  return counts;
}, {});
console.log(JSON.stringify({
  result: "pass",
  samples: outputRows.length,
  passageCandidates: outputRows.reduce((sum, row) => sum + row.passageCandidateCount, 0),
  qualifyingEvidence: outputRows.reduce((sum, row) => sum + row.qualifyingEvidenceCount, 0),
  casesWithQualifyingEvidence: outputRows.filter((row) => row.qualifyingEvidenceCount > 0).length,
  states,
  progressStates,
  mandatoryObligationsSatisfied: outputRows.reduce((sum, row) => sum + row.progress.mandatorySatisfied, 0),
  mandatoryObligationsTotal: outputRows.reduce((sum, row) => sum + row.progress.mandatoryTotal, 0),
  snippetEvidenceCount: 0,
  verdictsProduced: 0,
  output: "private-eval/<private>",
}, null, 2));
