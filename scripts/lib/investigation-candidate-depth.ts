export type CandidateDepthStopReason = "candidate_exhausted" | "target_budget" | "case_budget";

export interface RankedDocumentCandidate {
  targetId: string;
  url: string;
  discoveryRank: number;
}

export interface CandidateDepthSelection<Candidate extends RankedDocumentCandidate> {
  candidates: Candidate[];
  stopReason: CandidateDepthStopReason;
  caseBudgetExhausted: boolean;
}

export function normalizeCandidateUrl(value: string): string {
  const url = new URL(value);
  url.hash = "";
  return url.toString();
}

/**
 * Selects a bounded replay portfolio. The function measures existing ranked
 * candidates; it does not predict relevance or silently substitute a source.
 */
export function selectBoundedDocumentCandidates<Candidate extends RankedDocumentCandidate>(input: {
  candidates: Candidate[];
  maxDocumentsPerTarget: number;
  maxDocumentsPerCase: number;
  caseCandidateUrls: Set<string>;
}): CandidateDepthSelection<Candidate> {
  const sorted = [...input.candidates].sort((left, right) => left.discoveryRank - right.discoveryRank);
  if (new Set(sorted.map((candidate) => candidate.discoveryRank)).size !== sorted.length ||
    sorted.some((candidate) => !Number.isInteger(candidate.discoveryRank) || candidate.discoveryRank < 1)) {
    throw new Error("Candidate ranks must be unique positive integers within a target");
  }
  const selected: Candidate[] = [];
  let skippedForCaseBudget = false;
  for (const candidate of sorted) {
    if (selected.length >= input.maxDocumentsPerTarget) {
      return { candidates: selected, stopReason: "target_budget", caseBudgetExhausted: false };
    }
    const url = normalizeCandidateUrl(candidate.url);
    if (!input.caseCandidateUrls.has(url) && input.caseCandidateUrls.size >= input.maxDocumentsPerCase) {
      skippedForCaseBudget = true;
      continue;
    }
    input.caseCandidateUrls.add(url);
    selected.push(candidate);
  }
  return {
    candidates: selected,
    stopReason: skippedForCaseBudget ? "case_budget" : "candidate_exhausted",
    caseBudgetExhausted: skippedForCaseBudget,
  };
}

export function buildCandidateEvidenceId(input: {
  sampleId: string;
  targetId: string;
  questionId: string;
  discoveryRank: number;
}): string {
  const targetSuffix = input.targetId.split(":").at(-1);
  const questionSuffix = input.questionId.split(":").at(-1);
  return input.discoveryRank === 1
    ? `evidence:${input.sampleId}:${targetSuffix}:${questionSuffix}`
    : `evidence:${input.sampleId}:${targetSuffix}:${input.discoveryRank}:${questionSuffix}`;
}
