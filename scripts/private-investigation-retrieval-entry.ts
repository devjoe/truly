import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { execFileSync } from "node:child_process";

import { Readability } from "@mozilla/readability";
import { JSDOM, VirtualConsole } from "jsdom";

import type { EvidenceSourceRole, InvestigationBundle, InvestigationQuestion } from "../src/lib/claim-investigation-contract";
import { validateInvestigationBundle } from "../src/lib/claim-investigation-contract";
import { selectExactInvestigationPassage } from "../src/lib/claim-investigation-passage";
import { buildInvestigationRetrievalRoute } from "../src/lib/claim-investigation-retrieval";

interface PlanRow {
  sampleId: string;
  surface: "facebook" | "news";
  materialized?: { ok: boolean; bundle?: InvestigationBundle };
}

interface DiscoveryCandidate {
  questionId: string | "*";
  query: string;
  url: string;
  title?: string;
  sourceRole: Extract<EvidenceSourceRole, "primary" | "independent_secondary" | "fact_check">;
  discoveryRank: number;
  searchSnippet?: string;
  matchTerms?: string[];
}

interface DiscoveryRow {
  sampleId: string;
  candidates: DiscoveryCandidate[];
}

interface DiscoveryOverride {
  sampleId: string;
  url: string;
  matchTerms: string[];
}

interface DiscoveryCandidateAddition {
  sampleId: string;
  candidate: DiscoveryCandidate;
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

function readJsonl(file: string): PlanRow[] {
  return fs.readFileSync(file, "utf8").split(/\r?\n/u).map((line) => line.trim()).filter(Boolean).map((line) => JSON.parse(line));
}

function sha256(value: string): string {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function readDiscovery(file: string): { schemaVersion: number; rows: DiscoveryRow[] } {
  const payload = JSON.parse(fs.readFileSync(file, "utf8")) as {
    schemaVersion: number;
    rows?: DiscoveryRow[];
    extends?: string;
    overrides?: DiscoveryOverride[];
    addCandidates?: DiscoveryCandidateAddition[];
  };
  if (payload.extends) {
    if (path.basename(payload.extends) !== payload.extends) throw new Error("discovery extends must be a sibling file");
    const base = readDiscovery(path.join(path.dirname(file), payload.extends));
    for (const override of payload.overrides ?? []) {
      const row = base.rows.find((candidateRow) => candidateRow.sampleId === override.sampleId);
      const candidate = row?.candidates.find((item) => item.url === override.url);
      if (!candidate) throw new Error(`${override.sampleId}: discovery override target missing`);
      candidate.matchTerms = override.matchTerms;
    }
    for (const addition of payload.addCandidates ?? []) {
      const row = base.rows.find((candidateRow) => candidateRow.sampleId === addition.sampleId);
      if (!row) throw new Error(`${addition.sampleId}: discovery addition target missing`);
      if (!row.candidates.some((candidate) => candidate.url === addition.candidate.url)) {
        row.candidates.push(addition.candidate);
      }
    }
    return base;
  }
  if (!Array.isArray(payload.rows)) throw new Error("discovery rows are required");
  return { schemaVersion: payload.schemaVersion, rows: payload.rows };
}

function assertPrivatePath(file: string, kind: "input" | "output"): string {
  const resolved = path.resolve(file);
  const publicRoot = `${path.resolve(process.cwd())}${path.sep}`;
  if (resolved.startsWith(publicRoot) && !resolved.startsWith(`${path.resolve(process.cwd(), "tmp")}${path.sep}`)) {
    throw new Error(`${kind} must stay outside the public repo or under tmp/`);
  }
  if (kind === "input" && !fs.existsSync(resolved)) throw new Error(`Missing private input: ${resolved}`);
  return resolved;
}

function parseDocumentText(html: string, url: string): { title?: string; text: string; parser: string } {
  const virtualConsole = new VirtualConsole();
  const dom = new JSDOM(html, { url, virtualConsole });
  const clone = dom.window.document.cloneNode(true) as Document;
  const article = new Readability(clone, { charThreshold: 40 }).parse();
  const readabilityText = article?.textContent?.replace(/\s*\n\s*/gu, "\n\n").trim() ?? "";
  if (readabilityText.length >= 80) return { title: article?.title ?? undefined, text: readabilityText, parser: "readability" };
  const fallback = dom.window.document.body?.textContent?.replace(/\s*\n\s*/gu, "\n\n").replace(/[ \t]+/gu, " ").trim() ?? "";
  return { title: dom.window.document.title || undefined, text: fallback, parser: "body_text" };
}

async function fetchDocument(candidate: DiscoveryCandidate, timeoutMs: number, maxBytes: number) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(candidate.url, {
      redirect: "follow",
      signal: controller.signal,
      headers: {
        accept: "text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.1",
        "user-agent": "Truly development evidence retrieval audit/1.0",
      },
    });
    if (!response.ok) return { ok: false as const, error: `http_${response.status}` };
    const contentType = response.headers.get("content-type") ?? "";
    if (!/(?:text\/html|application\/xhtml\+xml|text\/plain)/iu.test(contentType)) {
      return { ok: false as const, error: "unsupported_content_type", contentType };
    }
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.byteLength > maxBytes) return { ok: false as const, error: "document_too_large" };
    const raw = buffer.toString("utf8");
    const parsed = contentType.includes("text/plain")
      ? { text: raw.trim(), parser: "plain_text", title: candidate.title }
      : parseDocumentText(raw, response.url);
    if (parsed.text.length < 40) return { ok: false as const, error: "empty_document" };
    return {
      ok: true as const,
      finalUrl: response.url,
      contentType,
      documentSha256: sha256(parsed.text),
      ...parsed,
    };
  } catch (error) {
    const name = error instanceof Error ? error.name : "Error";
    return { ok: false as const, error: name === "AbortError" ? "timeout" : "network_error" };
  } finally {
    clearTimeout(timeout);
  }
}

async function executeQuestion(
  sampleId: string,
  bundle: InvestigationBundle,
  question: InvestigationQuestion,
  candidates: DiscoveryCandidate[],
  timeoutMs: number,
  maxBytes: number,
) {
  const route = buildInvestigationRetrievalRoute(bundle, "adaptive_evidence_cascade")
    .filter((step) => step.questionId === question.id);
  const traces: unknown[] = route.filter((step) => step.operation === "search_web").map((step) => ({
    stepId: step.id,
    operation: step.operation,
    query: step.query,
    resultUse: "discovery_only",
    evidenceFromSnippetAllowed: false,
    status: "observed_external_search",
  }));
  const sorted = [...candidates].sort((a, b) => a.discoveryRank - b.discoveryRank);
  const phases = [
    { name: "primary", candidates: sorted.filter((candidate) => candidate.sourceRole === "primary"), downgrade: false },
    { name: "secondary_fallback", candidates: sorted.filter((candidate) => candidate.sourceRole !== "primary"), downgrade: true },
  ] as const;

  for (const phase of phases) {
    if (phase.candidates.length === 0) {
      traces.push({ phase: phase.name, status: "no_candidate_document", evidenceQualityDowngrade: phase.downgrade });
      continue;
    }
    for (const candidate of phase.candidates) {
      const fetched = await fetchDocument(candidate, timeoutMs, maxBytes);
      traces.push({
        phase: phase.name,
        operation: "fetch_document",
        url: candidate.url,
        sourceRole: candidate.sourceRole,
        status: fetched.ok ? "fetched" : "failed",
        error: fetched.ok ? undefined : fetched.error,
        evidenceQualityDowngrade: phase.downgrade,
        searchSnippetStoredForDiscoveryOnly: Boolean(candidate.searchSnippet),
      });
      if (!fetched.ok) continue;
      const passage = selectExactInvestigationPassage({
        documentText: fetched.text,
        normalizedClaim: bundle.subject.normalizedClaim,
        question: question.question,
        queryCandidates: [...question.queryCandidates, ...(candidate.matchTerms ?? [])],
        minimumScore: candidate.matchTerms?.length ? 6 : undefined,
        allowTwoCharacterSignals: Boolean(candidate.matchTerms?.length),
      });
      if (!passage) {
        traces.push({
          phase: phase.name,
          operation: "extract_exact_passage",
          url: fetched.finalUrl,
          status: "no_matching_passage",
          parser: fetched.parser,
          documentChars: fetched.text.length,
          documentPreview: fetched.text.slice(0, 600),
        });
        continue;
      }
      const evidenceId = `evidence:${sampleId}:${question.id.split(":").at(-1)}:${phase.name}`;
      traces.push({
        phase: phase.name,
        operation: "extract_exact_passage",
        url: fetched.finalUrl,
        status: "passage_candidate_extracted",
        passageScore: passage.score,
        matchedTerms: passage.matchedTerms,
        evidenceQualityDowngrade: phase.downgrade,
      });
      return {
        questionId: question.id,
        status: "passage_candidate_extracted",
        route: "adaptive_evidence_cascade",
        usedSecondaryFallback: phase.downgrade,
        evidenceQualityDowngrade: phase.downgrade,
        evidence: {
          version: 2,
          id: evidenceId,
          questionId: question.id,
          sourceRole: candidate.sourceRole,
          url: fetched.finalUrl,
          publisher: candidate.title ?? fetched.title,
          retrievedAt: new Date().toISOString(),
          exactExcerpt: passage.exactExcerpt,
          contentFingerprint: fetched.documentSha256,
          relation: "context",
        },
        trace: traces,
      };
    }
  }
  return {
    questionId: question.id,
    status: "no_passage_candidate",
    route: "adaptive_evidence_cascade",
    usedSecondaryFallback: phases[1].candidates.length > 0,
    evidenceQualityDowngrade: phases[1].candidates.length > 0,
    trace: traces,
  };
}

async function main(): Promise<void> {
  const plansPath = assertPrivatePath(required("--plans"), "input");
  const discoveryPath = assertPrivatePath(required("--discovery"), "input");
  const outputPath = assertPrivatePath(required("--output"), "output");
  const metaOutputPath = assertPrivatePath(required("--meta-output"), "output");
  const runId = required("--run-id");
  const sampleCount = Number(required("--sample-count"));
  const timeoutMs = Math.max(1000, Math.min(30000, Number(option("--timeout-ms") ?? "12000")));
  const maxBytes = Math.max(100_000, Math.min(4_000_000, Number(option("--max-bytes") ?? "2000000")));

  const planRows = readJsonl(plansPath).filter((row) => row.materialized?.ok && row.materialized.bundle);
  const discoveryPayload = readDiscovery(discoveryPath);
  if (planRows.length !== sampleCount || discoveryPayload.rows.length !== sampleCount) {
    throw new Error("sample count mismatch");
  }
  const discoveryById = new Map(discoveryPayload.rows.map((row) => [row.sampleId, row]));
  const startedAt = new Date().toISOString();
  const outputRows = [];

  for (const planRow of planRows) {
    const bundle = planRow.materialized!.bundle!;
    if (!validateInvestigationBundle(bundle).ok) throw new Error(`${planRow.sampleId}: invalid bundle`);
    const discovery = discoveryById.get(planRow.sampleId);
    if (!discovery) throw new Error(`${planRow.sampleId}: missing discovery row`);
    const literalQuestions = bundle.plan.questions.filter((question) => question.basis === "literal");
    const questionRuns = [];
    for (const question of literalQuestions) {
      questionRuns.push(await executeQuestion(
        planRow.sampleId,
        bundle,
        question,
        discovery.candidates.filter((candidate) => candidate.questionId === "*" || candidate.questionId === question.id),
        timeoutMs,
        maxBytes,
      ));
    }
    outputRows.push({
      schemaVersion: 1,
      sampleId: planRow.sampleId,
      surface: planRow.surface,
      subjectId: bundle.subject.id,
      literalQuestionCount: literalQuestions.length,
      questionRuns,
      passageCandidateCount: questionRuns.filter((run) => run.status === "passage_candidate_extracted").length,
      snippetEvidenceCount: 0,
    });
  }

  fs.mkdirSync(path.dirname(outputPath), { recursive: true, mode: 0o700 });
  fs.writeFileSync(outputPath, `${outputRows.map((row) => JSON.stringify(row)).join("\n")}\n`, { mode: 0o600 });
  const trulyCommit = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  const trulyDiff = execFileSync("git", ["diff", "--binary", "HEAD"], { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
  const completedAt = new Date().toISOString();
  const manifest = {
    schemaVersion: 1,
    runId,
    task: "investigation_retrieval_adaptive_cascade",
    split: "dev",
    trulyCommit,
    trulyWorktreeDirty: trulyDiff.length > 0,
    trulyDiffSha256: trulyDiff.length > 0 ? sha256(trulyDiff) : undefined,
    plansSha256: sha256(fs.readFileSync(plansPath)),
    discoverySha256: sha256(JSON.stringify(discoveryPayload)),
    samples: sampleCount,
    timeoutMs,
    maxBytes,
    searchSnippetsAreEvidence: false,
    verdictProduced: false,
    startedAt,
    completedAt,
  };
  fs.writeFileSync(metaOutputPath, `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 });
  console.log(JSON.stringify({
    result: "pass",
    samples: outputRows.length,
    withPassageCandidate: outputRows.filter((row) => row.passageCandidateCount > 0).length,
    primaryCandidates: outputRows.filter((row) => row.questionRuns.some((run) => run.status === "passage_candidate_extracted" && !run.usedSecondaryFallback)).length,
    fallbackCandidates: outputRows.filter((row) => row.questionRuns.some((run) => run.status === "passage_candidate_extracted" && run.usedSecondaryFallback)).length,
    snippetEvidenceCount: 0,
    output: "private-eval/<private>",
  }, null, 2));
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
