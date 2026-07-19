import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

import type { InvestigationBundle } from "../src/lib/claim-investigation-contract";
import type { InvestigationCase } from "../src/lib/claim-investigation-case";
import {
  INVESTIGATION_WITNESS_POINTER_JSON_SCHEMA,
  buildInvestigationWitnessBlocks,
  parseInvestigationWitnessPointerContent,
  reconstructInvestigationWitness,
} from "../src/lib/claim-investigation-witness-pointer";
import { fetchInvestigationDocument } from "./lib/investigation-document-fetch";
import { extractBoundedPdfText } from "./lib/investigation-pdf-text";

interface PlanRow { sampleId: string; surface: "facebook" | "news"; materialized?: { bundle?: InvestigationBundle } }
interface CaseRow { sampleId: string; materialized?: { investigationCase?: InvestigationCase } }
interface EvidenceRow { sampleId: string; progress: { obligations: Array<{ obligationId: string; blocker?: string }> } }
interface RetrievalRow {
  sampleId: string;
  targetRuns: Array<{ questionIds?: string[]; documentRuns?: Array<{ status: string; finalUrl?: string; url?: string; sourceRole?: string; sharedOriginGroup?: string; contentFingerprint?: string }> }>;
}

function option(name: string, fallback?: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
}
function required(name: string): string { const value = option(name); if (!value) throw new Error(`Missing ${name}`); return value; }
function privatePath(file: string, kind: "input" | "output"): string {
  const resolved = path.resolve(file);
  const publicRoot = `${path.resolve(process.cwd())}${path.sep}`;
  const publicTmp = `${path.resolve(process.cwd(), "tmp")}${path.sep}`;
  if (resolved.startsWith(publicRoot) && !resolved.startsWith(publicTmp)) throw new Error(`${kind} must stay outside the public repo or under tmp/`);
  if (kind === "input" && !fs.existsSync(resolved)) throw new Error(`Missing private input: ${resolved}`);
  return resolved;
}
function readJsonl<T>(file: string): T[] { return fs.readFileSync(file, "utf8").split(/\r?\n/u).map((line) => line.trim()).filter(Boolean).map(JSON.parse); }
function sha256(value: string | Buffer): string { return crypto.createHash("sha256").update(value).digest("hex"); }

if (!process.argv.includes("--confirm-private-data-send")) throw new Error("Missing --confirm-private-data-send");
const plansPath = privatePath(required("--plans"), "input");
const casesPath = privatePath(required("--cases"), "input");
const retrievalPath = privatePath(required("--retrieval"), "input");
const evidencePath = privatePath(required("--evidence"), "input");
const outputPath = privatePath(required("--output"), "output");
const metaOutputPath = privatePath(required("--meta-output"), "output");
const endpoint = required("--endpoint");
const model = required("--model");
const runId = required("--run-id");
const expectedCount = Number(required("--sample-count"));
const dataCategories = required("--data-categories").split(",").map((entry) => entry.trim()).filter(Boolean);
const concurrency = Math.max(1, Math.min(3, Number(option("--concurrency", "2")) || 2));
const timeoutMs = Math.max(5_000, Math.min(180_000, Number(option("--timeout-ms", "90000")) || 90_000));
const maxDocumentCharacters = Math.max(10_000, Math.min(120_000, Number(option("--max-document-characters", "90000")) || 90_000));
if (!/^https?:\/\//u.test(endpoint) || expectedCount < 1 || expectedCount > 30) throw new Error("Invalid witness proposal run configuration");

const plans = readJsonl<PlanRow>(plansPath);
const cases = new Map(readJsonl<CaseRow>(casesPath).map((row) => [row.sampleId, row]));
const retrievals = new Map(readJsonl<RetrievalRow>(retrievalPath).map((row) => [row.sampleId, row]));
const evidenceRows = new Map(readJsonl<EvidenceRow>(evidencePath).map((row) => [row.sampleId, row]));
if (plans.length !== expectedCount || cases.size !== expectedCount || retrievals.size !== expectedCount || evidenceRows.size !== expectedCount) throw new Error("sample count mismatch");

const work: Array<{
  sampleId: string;
  surface: "facebook" | "news";
  bundle: InvestigationBundle;
  investigationCase: InvestigationCase;
  url: string;
  sourceRole?: string;
  sharedOriginGroup?: string;
  questionIds: string[];
}> = [];
for (const plan of plans) {
  const bundle = plan.materialized?.bundle;
  const investigationCase = cases.get(plan.sampleId)?.materialized?.investigationCase;
  const retrieval = retrievals.get(plan.sampleId);
  const evidence = evidenceRows.get(plan.sampleId);
  if (!bundle || !investigationCase || !retrieval || !evidence) throw new Error(`${plan.sampleId}: missing input`);
  const missingQuestions = new Set(evidence.progress.obligations
    .filter((entry) => entry.blocker === "missing_answering_evidence" && entry.obligationId.endsWith(":answer"))
    .map((entry) => entry.obligationId.slice("obligation:".length, -":answer".length)));
  const grouped = new Map<string, { sourceRole?: string; sharedOriginGroup?: string; questionIds: Set<string> }>();
  for (const target of retrieval.targetRuns) {
    const relevant = (target.questionIds ?? []).filter((questionId) => missingQuestions.has(questionId));
    if (relevant.length === 0) continue;
    for (const document of target.documentRuns ?? []) {
      if (document.status !== "document_fetched") continue;
      const url = document.finalUrl ?? document.url;
      if (!url) continue;
      const entry = grouped.get(url) ?? { sourceRole: document.sourceRole, sharedOriginGroup: document.sharedOriginGroup, questionIds: new Set<string>() };
      relevant.forEach((questionId) => entry.questionIds.add(questionId));
      grouped.set(url, entry);
    }
  }
  for (const [url, entry] of grouped) work.push({ sampleId: plan.sampleId, surface: plan.surface, bundle, investigationCase, url, sourceRole: entry.sourceRole, sharedOriginGroup: entry.sharedOriginGroup, questionIds: [...entry.questionIds] });
}

const fetchCache = new Map<string, ReturnType<typeof fetchInvestigationDocument>>();
function fetchOnce(url: string) {
  const cached = fetchCache.get(url); if (cached) return cached;
  const promise = fetchInvestigationDocument(url, {
    timeoutMs: Math.min(timeoutMs, 30_000), maxBytes: 4_000_000,
    pdfTextExtractor: (buffer) => extractBoundedPdfText(buffer, { maxPages: 80, maxCharacters: maxDocumentCharacters, timeoutMs: 20_000 }),
  });
  fetchCache.set(url, promise); return promise;
}

async function evaluate(item: typeof work[number]) {
  const fetched = await fetchOnce(item.url);
  if (!fetched.ok) return { sampleId: item.sampleId, url: item.url, questionIds: item.questionIds, status: "acquisition_failed", error: fetched.error };
  if (fetched.text.length > maxDocumentCharacters) return { sampleId: item.sampleId, url: item.url, questionIds: item.questionIds, status: "document_too_long", characters: fetched.text.length };
  let blockSet;
  try { blockSet = buildInvestigationWitnessBlocks({ text: fetched.text, documentFingerprint: fetched.documentSha256, maxBlockCharacters: 700, maxBlocks: 180 }); }
  catch (error) { return { sampleId: item.sampleId, url: item.url, questionIds: item.questionIds, status: "block_segmentation_failed", error: error instanceof Error ? error.message : "unknown" }; }
  const questions = item.questionIds.map((questionId) => {
    const question = item.bundle.plan.questions.find((entry) => entry.id === questionId)!;
    const requirement = item.investigationCase.requirements.find((entry) => entry.questionId === questionId)!;
    return { questionId, question: question.question, requiredFacets: requirement.requiredFacets };
  });
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${endpoint.replace(/\/+$/u, "")}/chat/completions`, {
      method: "POST", signal: controller.signal,
      headers: { "Content-Type": "application/json", ...(process.env.TRULY_PRIVATE_EVAL_API_KEY ? { Authorization: `Bearer ${process.env.TRULY_PRIVATE_EVAL_API_KEY}` } : {}) },
      body: JSON.stringify({
        model, temperature: 0, max_tokens: 1400,
        response_format: { type: "json_schema", json_schema: { name: "truly_witness_pointer_v1", strict: true, schema: INVESTIGATION_WITNESS_POINTER_JSON_SCHEMA } },
        chat_template_kwargs: { enable_thinking: false },
        messages: [
          { role: "system", content: "You locate possible answering passages; you do not decide truth. For every requested question return exactly one proposal. Choose candidate only when at most three adjacent immutable blocks directly contain the requested answer. Use only block IDs from the input. Mark only explicitly covered facets. Otherwise abstain. Never rewrite or quote source text." },
          { role: "user", content: JSON.stringify({ subject: item.bundle.subject.normalizedClaim, questions, blocks: blockSet.blocks.map((block) => ({ id: block.id, text: block.text })) }) },
        ],
      }),
    });
    const raw = await response.text();
    if (!response.ok) return {
      sampleId: item.sampleId,
      url: item.url,
      questionIds: item.questionIds,
      status: "model_http_error",
      httpStatus: response.status,
      httpError: raw.slice(0, 2_000),
    };
    let payload: any; try { payload = JSON.parse(raw); } catch { return { sampleId: item.sampleId, url: item.url, questionIds: item.questionIds, status: "model_response_invalid_json" }; }
    const content = payload?.choices?.[0]?.message?.content;
    if (typeof content !== "string") return { sampleId: item.sampleId, url: item.url, questionIds: item.questionIds, status: "model_content_missing" };
    const proposals = parseInvestigationWitnessPointerContent(content, fetched.documentSha256);
    if (!proposals || proposals.length !== item.questionIds.length || item.questionIds.some((questionId) => !proposals.some((entry) => entry.questionId === questionId))) {
      return { sampleId: item.sampleId, url: item.url, questionIds: item.questionIds, status: "model_pointer_contract_invalid", content };
    }
    const candidates = proposals.map((proposal) => {
      const requirement = item.investigationCase.requirements.find((entry) => entry.questionId === proposal.questionId)!;
      const reconstructed = reconstructInvestigationWitness({ sourceText: fetched.text, blockSet, proposal, allowedQuestionIds: item.questionIds, requiredFacets: requirement.requiredFacets, maxBlockWindow: 3 });
      return reconstructed ? { ...reconstructed, status: "candidate", sourceRole: item.sourceRole, sharedOriginGroup: item.sharedOriginGroup, url: fetched.finalUrl } : { questionId: proposal.questionId, status: "abstain", reason: proposal.reason };
    });
    return { sampleId: item.sampleId, surface: item.surface, url: fetched.finalUrl, contentFingerprint: fetched.documentSha256, questionIds: item.questionIds, status: "complete", candidates, modelContent: content };
  } catch (error) {
    return { sampleId: item.sampleId, url: item.url, questionIds: item.questionIds, status: error instanceof DOMException && error.name === "AbortError" ? "timeout" : "model_request_failed" };
  } finally { clearTimeout(timeout); }
}

const results = new Array(work.length); let cursor = 0;
async function worker() { while (true) { const index = cursor++; if (index >= work.length) return; results[index] = await evaluate(work[index]); } }
const startedAt = new Date().toISOString();
await Promise.all(Array.from({ length: Math.min(concurrency, work.length) }, () => worker()));
const completedAt = new Date().toISOString();
fs.mkdirSync(path.dirname(outputPath), { recursive: true, mode: 0o700 });
fs.writeFileSync(outputPath, `${results.map((entry) => JSON.stringify(entry)).join("\n")}\n`, { mode: 0o600 });
fs.writeFileSync(metaOutputPath, `${JSON.stringify({ schemaVersion: 1, runId, task: "investigation_witness_pointer_proposal", split: "dev", model: { provider: "openai-compatible", endpoint, name: model, temperature: 0, maxTokens: 1400 }, samples: expectedCount, documentQuestionGroups: work.length, dataCategories, plansSha256: sha256(fs.readFileSync(plansPath)), casesSha256: sha256(fs.readFileSync(casesPath)), retrievalSha256: sha256(fs.readFileSync(retrievalPath)), evidenceSha256: sha256(fs.readFileSync(evidencePath)), startedAt, completedAt, searchSnippetsAreEvidence: false, evidenceAdmissionPerformed: false, verdictProduced: false }, null, 2)}\n`, { mode: 0o600 });
const candidates = results.flatMap((entry) => entry.candidates ?? []).filter((entry: any) => entry.status === "candidate");
const completedGroups = results.filter((entry) => entry.status === "complete").length;
const result = completedGroups > 0 ? "pass" : "fail";
console.log(JSON.stringify({ result, samples: expectedCount, documentQuestionGroups: work.length, completedGroups, pointerCandidates: candidates.length, abstentions: results.flatMap((entry) => entry.candidates ?? []).filter((entry: any) => entry.status === "abstain").length, contractFailures: results.filter((entry) => entry.status === "model_pointer_contract_invalid").length, evidenceAdmissionPerformed: false, verdictsProduced: 0, output: "private-eval/<private>" }, null, 2));
if (result === "fail") process.exitCode = 1;
