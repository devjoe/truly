import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { JSDOM } from "jsdom";

import type { InvestigationBundle } from "../src/lib/claim-investigation-contract";
import type { InvestigationCase } from "../src/lib/claim-investigation-case";
import { selectExactInvestigationPassage } from "../src/lib/claim-investigation-passage";
import type { InvestigationProofObligation } from "../src/lib/claim-investigation-obligations";
import {
  validateInvestigationRouteReceipt,
  validateInvestigationSourceRouteLedger,
  type InvestigationRouteReceipt,
  type InvestigationSourceFamilyPlan,
  type InvestigationSourceRoute,
} from "../src/lib/investigation-source-route";
import { fetchInvestigationDocument } from "./lib/investigation-document-fetch";
import { extractBoundedPdfText } from "./lib/investigation-pdf-text";

interface PlanRow {
  sampleId: string;
  surface: "facebook" | "news";
  applicability: string;
  bundle: InvestigationBundle;
  investigationCase: InvestigationCase;
  obligationSet: { obligations: InvestigationProofObligation[] };
  sourceFamilyPlan: InvestigationSourceFamilyPlan;
}
interface SearchCandidate { rank: number; url: string; title: string }
function option(name: string, fallback?: string): string | undefined { const index = process.argv.indexOf(name); return index >= 0 ? process.argv[index + 1] : fallback; }
function required(name: string): string { const value = option(name); if (!value) throw new Error(`Missing ${name}`); return value; }
function privatePath(value: string, exists: boolean): string { const resolved = path.resolve(value); if (!resolved.includes(`${path.sep}private-data${path.sep}`)) throw new Error("path must stay under private-data"); if (exists && !fs.existsSync(resolved)) throw new Error(`missing ${resolved}`); return resolved; }
function readJsonl<T>(file: string): T[] { return fs.readFileSync(file, "utf8").split(/\r?\n/u).map((line) => line.trim()).filter(Boolean).map((line) => JSON.parse(line) as T); }
function sha256(value: string | Buffer): string { return crypto.createHash("sha256").update(value).digest("hex"); }
function decodeSearchUrl(href: string): string | undefined {
  try {
    const absolute = new URL(href, "https://html.duckduckgo.com");
    const decoded = absolute.searchParams.get("uddg");
    const candidate = decoded ? new URL(decoded) : absolute;
    if (!/^https?:$/u.test(candidate.protocol) || /(?:^|\.)duckduckgo\.com$/iu.test(candidate.hostname)) return undefined;
    candidate.hash = "";
    return candidate.toString();
  } catch { return undefined; }
}
async function publicSearch(query: string, timeoutMs: number): Promise<SearchCandidate[]> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`, { headers: { "User-Agent": "Mozilla/5.0 (compatible; TrulyPrivateDevelopmentAudit/1.0)" }, signal: controller.signal });
    if (!response.ok) return [];
    const dom = new JSDOM(await response.text());
    const seen = new Set<string>();
    const candidates: SearchCandidate[] = [];
    for (const anchor of dom.window.document.querySelectorAll<HTMLAnchorElement>("a.result__a")) {
      const url = decodeSearchUrl(anchor.href);
      if (!url || seen.has(url)) continue;
      seen.add(url);
      candidates.push({ rank: candidates.length + 1, url, title: anchor.textContent?.replace(/\s+/gu, " ").trim() ?? "" });
      if (candidates.length >= 6) break;
    }
    return candidates;
  } catch { return []; }
  finally { clearTimeout(timer); }
}

const inputPath = privatePath(required("--input"), true);
const preregPath = privatePath(required("--preregistration"), true);
const outputPath = privatePath(required("--output"), false);
const metaPath = privatePath(required("--meta-output"), false);
const searchTimeoutMs = Number(option("--search-timeout-ms", "15000"));
const fetchTimeoutMs = Number(option("--fetch-timeout-ms", "15000"));
const maxBytes = Number(option("--max-bytes", "2000000"));
const maxDocuments = Number(option("--max-documents", "2"));
const prereg = JSON.parse(fs.readFileSync(preregPath, "utf8"));
const selectedIds = new Set<string>(prereg.matchedPairedAudit.sampleIds);
const rows = readJsonl<PlanRow>(inputPath).filter((row) => row.applicability === "planned" && selectedIds.has(row.sampleId));
if (rows.length !== prereg.matchedPairedAudit.sampleIds.length) throw new Error("preregistered paired cohort mismatch");

const trials: any[] = [];
for (const row of rows) {
  const questionById = new Map(row.bundle.plan.questions.map((question) => [question.id, question]));
  const requirementByQuestion = new Map(row.investigationCase.requirements.map((requirement) => [requirement.questionId, requirement]));
  const obligations = row.obligationSet.obligations.filter((obligation) => obligation.mandatory && (obligation.type === "answering_evidence" || obligation.type === "independent_origins"));
  for (const obligation of obligations) {
    const question = questionById.get(obligation.questionId);
    if (!question) throw new Error(`${row.sampleId}: unknown obligation question`);
    const candidateRoutes = row.sourceFamilyPlan.routes.filter((route) => !route.fallback && route.obligationIds.includes(obligation.id));
    const candidateRoute = candidateRoutes.find((route) => obligation.type === "independent_origins" ? route.routeFamily === "lineage_diverse" : route.routeFamily !== "lineage_diverse") ?? candidateRoutes[0];
    if (!candidateRoute || candidateRoute.locator.kind !== "open_web") throw new Error(`${row.sampleId}: no paired candidate route`);
    const baselineQuery = question.queryCandidates[0];
    const candidateQuery = candidateRoute.locator.query;
    const matchedBudget = {
      maxQueries: 1,
      maxDocuments,
      maxBytes: maxBytes * maxDocuments,
      maxDurationMs: Math.min(600_000, searchTimeoutMs + fetchTimeoutMs * maxDocuments + 5_000),
    };
    const evaluationRoute = (arm: "baseline" | "candidate", query: string): InvestigationSourceRoute => ({
      ...candidateRoute,
      id: `route:matched:${sha256(`${row.sampleId}:${obligation.id}:${arm}`).slice(0, 20)}:${arm}`,
      fallback: false,
      fallbackForRouteId: undefined,
      locator: { kind: "open_web", query },
      budget: matchedBudget,
    });
    const routeInputs = [
      { arm: "baseline" as const, query: baselineQuery, route: evaluationRoute("baseline", baselineQuery) },
      { arm: "candidate" as const, query: candidateQuery, route: evaluationRoute("candidate", candidateQuery) },
    ];
    const routeRuns = [];
    for (const routeInput of routeInputs) {
      const started = Date.now();
      const candidates = await publicSearch(routeInput.query, searchTimeoutMs);
      const documentRuns = [];
      let bytesFetched = 0;
      for (const candidate of candidates.slice(0, maxDocuments)) {
        const fetched = await fetchInvestigationDocument(candidate.url, {
          timeoutMs: fetchTimeoutMs,
          maxBytes,
          titleHint: candidate.title,
          pdfTextExtractor: (buffer) => extractBoundedPdfText(buffer, { maxPages: 80, maxCharacters: 160_000, timeoutMs: fetchTimeoutMs }),
        });
        if (!fetched.ok) { documentRuns.push({ ...candidate, status: "fetch_failed", error: fetched.error }); continue; }
        bytesFetched += Buffer.byteLength(fetched.text, "utf8");
        const requiredFacets = obligation.type === "counterevidence_search" ? [] : obligation.requiredFacets;
        const passage = selectExactInvestigationPassage({ documentText: fetched.text, normalizedClaim: row.bundle.subject.normalizedClaim, question: question.question, queryCandidates: question.queryCandidates, requiredFacets });
        documentRuns.push({
          ...candidate,
          status: passage ? "passage_candidate" : "no_passage_candidate",
          finalUrl: fetched.finalUrl,
          title: fetched.title ?? candidate.title,
          documentSha256: fetched.documentSha256,
          ...(passage ? { exactExcerpt: passage.exactExcerpt, matchedTerms: passage.matchedTerms, passageScore: passage.score } : {}),
        });
      }
      const durationMs = Date.now() - started;
      const documentsFetched = documentRuns.filter((run) => run.status !== "fetch_failed").length;
      const passageCandidates = documentRuns.filter((run) => run.status === "passage_candidate").length;
      const observedOriginKeys = [...new Set(documentRuns.flatMap((run) => {
        if (run.status === "fetch_failed" || !run.finalUrl) return [];
        try { return [`host:${new URL(run.finalUrl).hostname.toLowerCase()}`]; }
        catch { return []; }
      }))];
      const unresolvedBlindSpots = [
        ...(candidates.length > maxDocuments ? ["search candidates remained outside the matched document budget"] : []),
        ...(documentRuns.some((run) => run.status === "fetch_failed") ? ["one or more selected documents could not be fetched"] : []),
        ...(passageCandidates === 0 ? ["no exact passage candidate was admitted"] : []),
      ];
      const stopReason: InvestigationRouteReceipt["stopReason"] = candidates.length === 0
        ? "capability_unavailable"
        : candidates.length > maxDocuments
          ? "budget_exhausted"
          : documentsFetched === 0
            ? "access_denied"
            : "document_families_exhausted";
      const receipt: InvestigationRouteReceipt = {
        version: 2,
        routeId: routeInput.route.id,
        obligationIds: routeInput.route.obligationIds,
        queriesAttempted: 1,
        documentsConsidered: Math.min(candidates.length, maxDocuments),
        documentsFetched,
        bytesFetched,
        durationMs,
        coveredSourceFamilies: candidates.length > 0 ? [routeInput.route.sourceFamily] : [],
        languages: row.investigationCase.discoveryContext.languages.length > 0
          ? row.investigationCase.discoveryContext.languages
          : ["und"],
        observedOriginKeys,
        unresolvedBlindSpots,
        stopReason,
        completedAt: new Date().toISOString(),
        evidenceProduced: false,
        verdictProduced: false,
      };
      const routeIssues = validateInvestigationSourceRouteLedger({ version: 2, caseId: row.investigationCase.id, routes: [routeInput.route] });
      const receiptIssues = validateInvestigationRouteReceipt(receipt, routeInput.route);
      if (routeIssues.length || receiptIssues.length) throw new Error(`${row.sampleId}:${routeInput.arm}: invalid typed acquisition receipt: ${[...routeIssues, ...receiptIssues].join("; ")}`);
      routeRuns.push({
        arm: routeInput.arm,
        query: routeInput.query,
        routeId: routeInput.route.id,
        routeFamily: routeInput.route.routeFamily,
        sourceFamily: routeInput.route.sourceFamily,
        acquisitionRoute: routeInput.route,
        searchCandidates: candidates,
        documentsConsidered: Math.min(candidates.length, maxDocuments),
        documentsFetched,
        passageCandidates,
        bytesFetched,
        durationMs,
        documentRuns,
        receipt,
        snippetEvidenceCount: 0,
        evidenceProduced: false,
        verdictProduced: false,
      });
    }
    trials.push({
      schemaVersion: 1,
      trialId: `trial:${row.sampleId}:${obligation.id}`,
      sampleId: row.sampleId,
      surface: row.surface,
      caseId: row.investigationCase.id,
      subjectId: row.investigationCase.subjectId,
      eventKey: `event:${row.sampleId}`,
      obligation,
      requirement: requirementByQuestion.get(obligation.questionId),
      question,
      budget: { maxQueries: 1, maxDocuments, maxBytes, maxDurationMs: searchTimeoutMs + fetchTimeoutMs * maxDocuments },
      routeRuns,
      evidenceProduced: false,
      verdictProduced: false,
    });
  }
}
fs.mkdirSync(path.dirname(outputPath), { recursive: true, mode: 0o700 });
fs.writeFileSync(outputPath, `${trials.map((trial) => JSON.stringify(trial)).join("\n")}\n`, { mode: 0o600 });
const routeRuns = trials.flatMap((trial) => trial.routeRuns);
const meta = {
  schemaVersion: 1,
  task: "investigation_matched_public_search",
  split: "dev",
  inputSha256: sha256(fs.readFileSync(inputPath)),
  preregistrationSha256: sha256(fs.readFileSync(preregPath)),
  cases: rows.length,
  trials: trials.length,
  routeRuns: routeRuns.length,
  searchCandidates: routeRuns.reduce((sum, run) => sum + run.searchCandidates.length, 0),
  documentsFetched: routeRuns.reduce((sum, run) => sum + run.documentsFetched, 0),
  passageCandidates: routeRuns.reduce((sum, run) => sum + run.passageCandidates, 0),
  baselinePassageCandidates: routeRuns.filter((run) => run.arm === "baseline").reduce((sum, run) => sum + run.passageCandidates, 0),
  candidatePassageCandidates: routeRuns.filter((run) => run.arm === "candidate").reduce((sum, run) => sum + run.passageCandidates, 0),
  snippetEvidenceCount: 0,
  evidenceProduced: false,
  verdictProduced: false,
  completedAt: new Date().toISOString(),
};
fs.writeFileSync(metaPath, `${JSON.stringify(meta, null, 2)}\n`, { mode: 0o600 });
console.log(JSON.stringify({ result: "pass", ...meta, output: "private-data/<private>" }, null, 2));
