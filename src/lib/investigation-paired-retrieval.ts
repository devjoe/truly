import type { EvidenceSourceRole } from "./claim-investigation-contract";
import type { InvestigationVerificationFacet } from "./claim-investigation-case";
import type { InvestigationRouteBudget, InvestigationRouteTerm } from "./investigation-source-route";

export const INVESTIGATION_PAIRED_RETRIEVAL_VERSION = 1 as const;

export interface InvestigationRetrievalRoutePlan {
  route: "atomic_query" | "source_first";
  queries: string[];
  bridgeTerms: InvestigationRouteTerm[];
  sourceRouteIds: string[];
  budget: InvestigationRouteBudget;
}

export interface InvestigationPairedRetrievalTrial {
  version: typeof INVESTIGATION_PAIRED_RETRIEVAL_VERSION;
  id: string;
  caseId: string;
  obligationId: string;
  requiredFacets: InvestigationVerificationFacet[];
  acceptedSourceRoles: EvidenceSourceRole[];
  baseline: InvestigationRetrievalRoutePlan & { route: "atomic_query" };
  candidate: InvestigationRetrievalRoutePlan & { route: "source_first" };
  blindedReviewToken: string;
}

export interface InvestigationPairedRouteOutcome {
  trialId: string;
  route: "atomic_query" | "source_first";
  queriesAttempted: number;
  documentsAttempted: number;
  documentsFetched: number;
  answerableDocuments: number;
  qualifyingArtifacts: number;
  mandatoryObligationRescued: boolean;
  byteCost: number;
  durationMs: number;
  safety: { snippetsAsEvidence: false; verdictProduced: false; exactSpanTraceable: boolean };
}

export interface InvestigationPairedRetrievalSummary {
  trials: number;
  comparableTrials: number;
  sourceFirstWins: number;
  atomicWins: number;
  ties: number;
  sourceFirstMandatoryRescues: number;
  atomicMandatoryRescues: number;
  safetyPass: boolean;
}

const ID_RE = /^[a-z0-9][a-z0-9._:-]{0,127}$/iu;
const QUERY_RE = /https?:\/\/|\b(?:google|bing|duckduckgo)\b|(?:事實)?查核|真假|闢謠|辟谣/iu;

function sameBudget(a: InvestigationRouteBudget, b: InvestigationRouteBudget): boolean {
  return a.maxQueries === b.maxQueries && a.maxDocuments === b.maxDocuments &&
    a.maxBytes === b.maxBytes && a.maxDurationMs === b.maxDurationMs;
}

function validQueries(queries: string[], budget: InvestigationRouteBudget): boolean {
  return Array.isArray(queries) && queries.length >= 1 && queries.length <= budget.maxQueries &&
    new Set(queries).size === queries.length && queries.every((query) => query.trim().length >= 3 && query.length <= 320 && !QUERY_RE.test(query));
}

function validBridgeTerms(terms: InvestigationRouteTerm[]): boolean {
  return Array.isArray(terms) && terms.length <= 16 && terms.every((term) =>
    term.value.trim() && term.value.length <= 160 &&
    (term.provenance === "claim_text" ? term.sourceRef === undefined : Boolean(term.sourceRef?.trim())));
}

/** Freeze route inputs before retrieval so route quality is separable from online policy tuning. */
export function validateInvestigationPairedRetrievalTrial(trial: InvestigationPairedRetrievalTrial): string[] {
  const issues: string[] = [];
  if (trial.version !== 1 || !ID_RE.test(trial.id) || !ID_RE.test(trial.caseId) || !ID_RE.test(trial.obligationId) ||
    !trial.blindedReviewToken.trim() || trial.blindedReviewToken.length > 128) issues.push("invalid trial identity");
  if (trial.requiredFacets.length < 1 || new Set(trial.requiredFacets).size !== trial.requiredFacets.length ||
    trial.acceptedSourceRoles.length < 1 || new Set(trial.acceptedSourceRoles).size !== trial.acceptedSourceRoles.length) issues.push("invalid proof responsibility");
  if (trial.baseline.route !== "atomic_query" || trial.candidate.route !== "source_first" || !sameBudget(trial.baseline.budget, trial.candidate.budget)) {
    issues.push("paired routes must use equal budgets");
  }
  if (!validQueries(trial.baseline.queries, trial.baseline.budget) || !validQueries(trial.candidate.queries, trial.candidate.budget) ||
    !validBridgeTerms(trial.baseline.bridgeTerms) || !validBridgeTerms(trial.candidate.bridgeTerms) ||
    trial.baseline.sourceRouteIds.length !== 0 || trial.candidate.sourceRouteIds.length < 1 ||
    new Set(trial.candidate.sourceRouteIds).size !== trial.candidate.sourceRouteIds.length) issues.push("invalid paired route plan");
  return issues;
}

export function summarizeInvestigationPairedRetrieval(
  trials: InvestigationPairedRetrievalTrial[],
  outcomes: InvestigationPairedRouteOutcome[],
): InvestigationPairedRetrievalSummary {
  if (trials.length < 1 || new Set(trials.map((trial) => trial.id)).size !== trials.length ||
    trials.some((trial) => validateInvestigationPairedRetrievalTrial(trial).length > 0)) throw new Error("Invalid paired retrieval trials");
  const byTrial = new Map<string, InvestigationPairedRouteOutcome[]>();
  outcomes.forEach((outcome) => byTrial.set(outcome.trialId, [...(byTrial.get(outcome.trialId) ?? []), outcome]));
  let comparableTrials = 0;
  let sourceFirstWins = 0;
  let atomicWins = 0;
  let ties = 0;
  let sourceFirstMandatoryRescues = 0;
  let atomicMandatoryRescues = 0;
  let safetyPass = true;
  for (const trial of trials) {
    const rows = byTrial.get(trial.id) ?? [];
    const atomic = rows.find((row) => row.route === "atomic_query");
    const sourceFirst = rows.find((row) => row.route === "source_first");
    if (!atomic || !sourceFirst || rows.length !== 2) continue;
    comparableTrials += 1;
    safetyPass &&= rows.every((row) => !row.safety.snippetsAsEvidence && !row.safety.verdictProduced && row.safety.exactSpanTraceable);
    if (atomic.mandatoryObligationRescued) atomicMandatoryRescues += 1;
    if (sourceFirst.mandatoryObligationRescued) sourceFirstMandatoryRescues += 1;
    const score = (row: InvestigationPairedRouteOutcome) =>
      Number(row.mandatoryObligationRescued) * 100 + row.qualifyingArtifacts * 10 + row.answerableDocuments;
    if (score(sourceFirst) > score(atomic)) sourceFirstWins += 1;
    else if (score(atomic) > score(sourceFirst)) atomicWins += 1;
    else ties += 1;
  }
  return { trials: trials.length, comparableTrials, sourceFirstWins, atomicWins, ties, sourceFirstMandatoryRescues, atomicMandatoryRescues, safetyPass };
}
