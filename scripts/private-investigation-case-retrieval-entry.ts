import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { execFileSync } from "node:child_process";

import type { EvidenceSourceRole, InvestigationBundle } from "../src/lib/claim-investigation-contract";
import { validateInvestigationBundle } from "../src/lib/claim-investigation-contract";
import type { InvestigationCase } from "../src/lib/claim-investigation-case";
import { validateInvestigationCase } from "../src/lib/claim-investigation-case";
import { selectExactInvestigationPassage } from "../src/lib/claim-investigation-passage";
import { buildInvestigationCaseRetrievalRoute } from "../src/lib/claim-investigation-retrieval";
import { fetchInvestigationDocument } from "./lib/investigation-document-fetch";
import {
  buildCandidateEvidenceId,
  normalizeCandidateUrl,
  selectBoundedDocumentCandidates,
} from "./lib/investigation-candidate-depth";
import { extractBoundedPdfText } from "./lib/investigation-pdf-text";

interface PlanRow {
  sampleId: string;
  surface: "facebook" | "news";
  materialized?: { ok: boolean; bundle?: InvestigationBundle };
}

interface CaseRow {
  sampleId: string;
  materialized?: { ok: boolean; investigationCase?: InvestigationCase };
}

interface DiscoveryCandidate {
  targetId: string;
  url: string;
  title?: string;
  publisher?: string;
  sourceRole: EvidenceSourceRole;
  discoveryRank: number;
  sharedOriginGroup?: string;
  likelySharedOriginGroup?: string;
}

interface DiscoveryRow {
  sampleId: string;
  candidates: DiscoveryCandidate[];
}

function option(name: string, fallback?: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
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
const discoveryPath = privatePath(required("--discovery"), "input");
const outputPath = privatePath(required("--output"), "output");
const metaOutputPath = privatePath(required("--meta-output"), "output");
const runId = required("--run-id");
const expectedCount = Number(required("--sample-count"));
const timeoutMs = Math.max(1000, Math.min(30000, Number(option("--timeout-ms", "12000")) || 12000));
const maxBytes = Math.max(100_000, Math.min(4_000_000, Number(option("--max-bytes", "2000000")) || 2_000_000));
const maxDocumentsPerTarget = Math.max(1, Math.min(5, Number(option("--max-documents-per-target", "1")) || 1));
const maxDocumentsPerCase = Math.max(1, Math.min(40, Number(option("--max-documents-per-case", "12")) || 12));
const includeFallbacks = option("--include-fallbacks", "true") !== "false";

const plans = readJsonl<PlanRow>(plansPath);
const cases = readJsonl<CaseRow>(casesPath);
const discovery = JSON.parse(fs.readFileSync(discoveryPath, "utf8")) as { schemaVersion: number; rows: DiscoveryRow[] };
if (plans.length !== expectedCount || cases.length !== expectedCount || discovery.rows?.length !== expectedCount) {
  throw new Error("sample count mismatch");
}
const caseById = new Map(cases.map((row) => [row.sampleId, row]));
const discoveryById = new Map(discovery.rows.map((row) => [row.sampleId, row]));
const startedAt = new Date().toISOString();
const outputRows = [];
const acquisitionCache = new Map<string, ReturnType<typeof fetchInvestigationDocument> extends Promise<infer Result> ? Promise<Result> : never>();

function acquireOnce(candidate: DiscoveryCandidate) {
  const cacheKey = normalizeCandidateUrl(candidate.url);
  const cached = acquisitionCache.get(cacheKey);
  if (cached) return { reusedAcquisition: true, result: cached };
  const result = fetchInvestigationDocument(candidate.url, {
    timeoutMs,
    maxBytes,
    titleHint: candidate.title,
    pdfTextExtractor: (buffer) => extractBoundedPdfText(buffer, {
      maxPages: 80,
      maxCharacters: 160_000,
      timeoutMs: Math.min(timeoutMs, 20_000),
    }),
  });
  acquisitionCache.set(cacheKey, result);
  return { reusedAcquisition: false, result };
}

for (const planRow of plans) {
  const bundle = planRow.materialized?.bundle;
  const caseRow = caseById.get(planRow.sampleId);
  const investigationCase = caseRow?.materialized?.investigationCase;
  const discoveryRow = discoveryById.get(planRow.sampleId);
  if (!bundle || !investigationCase || !discoveryRow) throw new Error(`${planRow.sampleId}: missing input`);
  if (!validateInvestigationBundle(bundle).ok || !validateInvestigationCase(investigationCase, bundle).ok) {
    throw new Error(`${planRow.sampleId}: invalid contract input`);
  }
  const route = buildInvestigationCaseRetrievalRoute(bundle, investigationCase);
  if (route.length === 0) throw new Error(`${planRow.sampleId}: empty case route`);
  const questionById = new Map(bundle.plan.questions.map((question) => [question.id, question]));
  const requirementByQuestionId = new Map(investigationCase.requirements.map((requirement) => [requirement.questionId, requirement]));
  const targetRuns = [];
  const questionsWithPrimaryPassage = new Set<string>();
  const seenEvidenceDocuments = new Set<string>();
  const caseCandidateUrls = new Set<string>();

  for (const target of investigationCase.discoveryPlan.targets) {
    const candidates = discoveryRow.candidates
      .filter((candidate) => candidate.targetId === target.id)
      .sort((a, b) => a.discoveryRank - b.discoveryRank);
    const invalidCandidate = candidates.find((candidate) => !target.acceptedSourceRoles.includes(candidate.sourceRole));
    if (invalidCandidate) throw new Error(`${planRow.sampleId}: candidate source role does not match target`);
    if (!includeFallbacks && target.fallback && target.questionIds.every((questionId) => questionsWithPrimaryPassage.has(questionId))) {
      targetRuns.push({ targetId: target.id, questionIds: target.questionIds, fallback: true, status: "not_needed", stopReason: "primary_passage_found", documentRuns: [], questionRuns: [] });
      continue;
    }
    if (candidates.length === 0) {
      targetRuns.push({ targetId: target.id, questionIds: target.questionIds, fallback: target.fallback, status: "no_candidate_document", stopReason: "candidate_exhausted", documentRuns: [], questionRuns: [] });
      continue;
    }

    const documentRuns = [];
    let selection;
    try {
      selection = selectBoundedDocumentCandidates({
        candidates,
        maxDocumentsPerTarget,
        maxDocumentsPerCase,
        caseCandidateUrls,
      });
    } catch (error) {
      throw new Error(`${planRow.sampleId}: ${error instanceof Error ? error.message : "invalid candidate selection"}`);
    }
    for (const candidate of selection.candidates) {
      const acquisition = acquireOnce(candidate);
      const fetched = await acquisition.result;
      if (!fetched.ok) {
        documentRuns.push({
          candidateRank: candidate.discoveryRank,
          url: candidate.url,
          sourceRole: candidate.sourceRole,
          sharedOriginGroup: candidate.sharedOriginGroup,
          likelySharedOriginGroup: candidate.likelySharedOriginGroup,
          status: "acquisition_failed",
          reusedAcquisition: acquisition.reusedAcquisition,
          error: fetched.error,
          acquisitionFailureCode: fetched.acquisitionFailure.code,
          requiredCapability: fetched.acquisitionFailure.requiredCapability,
          contentType: fetched.contentType,
          questionRuns: [],
        });
        continue;
      }
      const questionRuns = target.questionIds.map((questionId) => {
        const question = questionById.get(questionId)!;
        const passage = selectExactInvestigationPassage({
          documentText: fetched.text,
          normalizedClaim: bundle.subject.normalizedClaim,
          question: question.question,
          queryCandidates: question.queryCandidates,
          requiredFacets: requirementByQuestionId.get(questionId)?.requiredFacets,
        });
        if (!passage) return { questionId, status: "no_passage_candidate" };
        const evidenceDocumentKey = `${questionId}:${fetched.documentSha256}`;
        if (seenEvidenceDocuments.has(evidenceDocumentKey)) {
          return { questionId, status: "duplicate_document_content" };
        }
        seenEvidenceDocuments.add(evidenceDocumentKey);
        if (!target.fallback) questionsWithPrimaryPassage.add(questionId);
        const evidenceId = buildCandidateEvidenceId({
          sampleId: planRow.sampleId,
          targetId: target.id,
          questionId,
          discoveryRank: candidate.discoveryRank,
        });
        return {
          questionId,
          status: "passage_candidate_extracted",
          evidence: {
            version: 2,
            id: evidenceId,
            questionId,
            sourceRole: candidate.sourceRole,
            url: fetched.finalUrl,
            publisher: candidate.publisher ?? candidate.title ?? fetched.title,
            retrievedAt: new Date().toISOString(),
            exactExcerpt: passage.exactExcerpt,
            contentFingerprint: fetched.documentSha256,
            sharedOriginGroup: candidate.sharedOriginGroup,
            relation: "context",
          },
          passageScore: passage.score,
          matchedTerms: passage.matchedTerms,
        };
      });
      documentRuns.push({
        candidateRank: candidate.discoveryRank,
        url: candidate.url,
        finalUrl: fetched.finalUrl,
        sourceRole: candidate.sourceRole,
        sharedOriginGroup: candidate.sharedOriginGroup,
        likelySharedOriginGroup: candidate.likelySharedOriginGroup,
        status: "document_fetched",
        reusedAcquisition: acquisition.reusedAcquisition,
        acquisitionCapability: fetched.acquisition.capability,
        contentKind: fetched.acquisition.contentKind,
        contentType: fetched.contentType,
        contentFingerprint: fetched.documentSha256,
        questionRuns,
      });
    }
    const questionRuns = documentRuns.flatMap((documentRun: any) => documentRun.questionRuns);
    const fetchedCount = documentRuns.filter((documentRun: any) => documentRun.status === "document_fetched").length;
    targetRuns.push({
      targetId: target.id,
      questionIds: target.questionIds,
      fallback: target.fallback,
      status: fetchedCount > 0 ? "documents_processed" : selection.caseBudgetExhausted ? "budget_exhausted" : "document_fetch_failed",
      stopReason: selection.stopReason,
      candidateCount: candidates.length,
      documentsConsidered: documentRuns.length,
      documentsFetched: fetchedCount,
      documentRuns,
      questionRuns,
    });
  }
  const questionRuns = targetRuns.flatMap((targetRun: any) => targetRun.questionRuns);
  const documentRuns = targetRuns.flatMap((targetRun: any) => targetRun.documentRuns ?? []);
  outputRows.push({
    schemaVersion: 2,
    sampleId: planRow.sampleId,
    surface: planRow.surface,
    caseId: investigationCase.id,
    route: "case_document_discovery",
    selectionPolicy: "bounded_candidate_depth_measurement",
    maxDocumentsPerTarget,
    maxDocumentsPerCase,
    includeFallbacks,
    targetRuns,
    documentRunCount: documentRuns.length,
    fetchedDocumentCount: documentRuns.filter((run: any) => run.status === "document_fetched").length,
    uniqueFetchedContentCount: new Set(documentRuns.filter((run: any) => run.status === "document_fetched").map((run: any) => run.contentFingerprint)).size,
    questionRunCount: questionRuns.length,
    passageCandidateCount: questionRuns.filter((run: any) => run.status === "passage_candidate_extracted").length,
    snippetEvidenceCount: 0,
    verdictProduced: false,
  });
}

fs.mkdirSync(path.dirname(outputPath), { recursive: true, mode: 0o700 });
fs.writeFileSync(outputPath, `${outputRows.map((row) => JSON.stringify(row)).join("\n")}\n`, { mode: 0o600 });
const trulyCommit = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
const trulyDiff = execFileSync("git", ["diff", "--binary", "HEAD"], { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
fs.writeFileSync(metaOutputPath, `${JSON.stringify({
  schemaVersion: 1,
  runId,
  task: "investigation_case_retrieval",
  split: "dev",
  trulyCommit,
  trulyWorktreeDirty: trulyDiff.length > 0,
  trulyDiffSha256: trulyDiff.length > 0 ? sha256(trulyDiff) : undefined,
  plansSha256: sha256(fs.readFileSync(plansPath)),
  casesSha256: sha256(fs.readFileSync(casesPath)),
  discoverySha256: sha256(fs.readFileSync(discoveryPath)),
  samples: outputRows.length,
  timeoutMs,
  maxBytes,
  maxDocumentsPerTarget,
  maxDocumentsPerCase,
  includeFallbacks,
  searchSnippetsAreEvidence: false,
  verdictProduced: false,
  startedAt,
  completedAt: new Date().toISOString(),
}, null, 2)}\n`, { mode: 0o600 });

const targetRuns = outputRows.flatMap((row: any) => row.targetRuns);
const documentRuns = targetRuns.flatMap((run: any) => run.documentRuns ?? []);
console.log(JSON.stringify({
  result: "pass",
  samples: outputRows.length,
  documentCandidatesConsidered: documentRuns.length,
  documentsFetched: documentRuns.filter((run: any) => run.status === "document_fetched").length,
  uniqueFetchedDocuments: new Set(documentRuns.filter((run: any) => run.status === "document_fetched").map((run: any) => run.contentFingerprint)).size,
  documentFetchFailures: documentRuns.filter((run: any) => run.status === "acquisition_failed").length,
  capabilityUnavailable: documentRuns.filter((run: any) => run.acquisitionFailureCode === "capability_unavailable").length,
  samplesWithPassageCandidate: outputRows.filter((row) => row.passageCandidateCount > 0).length,
  passageCandidates: outputRows.reduce((sum, row) => sum + row.passageCandidateCount, 0),
  snippetEvidenceCount: 0,
  verdictsProduced: 0,
  output: "private-eval/<private>",
}, null, 2));
