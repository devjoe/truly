export interface InvestigationRecoveryCandidate {
  id: string;
  caseId: string;
  expectedObligationIds: string[];
  estimatedAnswerability: number;
  acquisitionCost: number;
  sourceFamily: string;
  originKey?: string;
}

export interface InvestigationRecoverySchedule {
  selectedCandidateIds: string[];
  seedCandidateIds: string[];
  adaptiveCandidateIds: string[];
  skippedCandidateIds: string[];
}

/**
 * Deterministic two-pass development scheduler. The first pass gives every
 * unresolved case one answerability seed. The second optimizes expected
 * blocker reduction and origin novelty under global and per-case caps.
 */
export function scheduleInvestigationRecovery(input: {
  candidates: InvestigationRecoveryCandidate[];
  unresolvedObligationIds: string[];
  maxCandidates: number;
  maxCandidatesPerCase: number;
}): InvestigationRecoverySchedule {
  if (!Number.isInteger(input.maxCandidates) || input.maxCandidates < 1 ||
    !Number.isInteger(input.maxCandidatesPerCase) || input.maxCandidatesPerCase < 1 ||
    new Set(input.candidates.map((entry) => entry.id)).size !== input.candidates.length ||
    input.candidates.some((entry) => !entry.id || !entry.caseId || entry.expectedObligationIds.length < 1 ||
      entry.estimatedAnswerability < 0 || entry.estimatedAnswerability > 1 || entry.acquisitionCost <= 0)) {
    throw new Error("Invalid recovery scheduler input");
  }
  const unresolved = new Set(input.unresolvedObligationIds);
  const viable = input.candidates.filter((entry) => entry.expectedObligationIds.some((id) => unresolved.has(id)));
  const byCase = new Map<string, InvestigationRecoveryCandidate[]>();
  viable.forEach((candidate) => byCase.set(candidate.caseId, [...(byCase.get(candidate.caseId) ?? []), candidate]));
  const selected: InvestigationRecoveryCandidate[] = [];
  const selectedIds = new Set<string>();
  const perCase = new Map<string, number>();
  const seedIds: string[] = [];
  const adaptiveIds: string[] = [];
  const order = (a: InvestigationRecoveryCandidate, b: InvestigationRecoveryCandidate) =>
    b.estimatedAnswerability - a.estimatedAnswerability || a.acquisitionCost - b.acquisitionCost || a.id.localeCompare(b.id);
  for (const caseId of [...byCase.keys()].sort()) {
    if (selected.length >= input.maxCandidates) break;
    const seed = byCase.get(caseId)!.sort(order)[0];
    selected.push(seed);
    selectedIds.add(seed.id);
    seedIds.push(seed.id);
    perCase.set(caseId, 1);
  }
  const coveredObligations = new Set(selected.flatMap((entry) => entry.expectedObligationIds));
  const coveredFamilies = new Set(selected.map((entry) => entry.sourceFamily));
  const coveredOrigins = new Set(selected.map((entry) => entry.originKey).filter(Boolean));
  while (selected.length < input.maxCandidates) {
    const candidates = viable.filter((candidate) => !selectedIds.has(candidate.id) &&
      (perCase.get(candidate.caseId) ?? 0) < input.maxCandidatesPerCase);
    if (candidates.length === 0) break;
    const score = (candidate: InvestigationRecoveryCandidate) => {
      const newObligations = candidate.expectedObligationIds.filter((id) => unresolved.has(id) && !coveredObligations.has(id)).length;
      const originNovelty = candidate.originKey && !coveredOrigins.has(candidate.originKey) ? 1 : 0;
      const familyNovelty = !coveredFamilies.has(candidate.sourceFamily) ? 1 : 0;
      return (candidate.estimatedAnswerability * 3 + newObligations * 4 + originNovelty * 2 + familyNovelty) / candidate.acquisitionCost;
    };
    candidates.sort((a, b) => score(b) - score(a) || order(a, b));
    const next = candidates[0];
    selected.push(next);
    selectedIds.add(next.id);
    adaptiveIds.push(next.id);
    perCase.set(next.caseId, (perCase.get(next.caseId) ?? 0) + 1);
    next.expectedObligationIds.forEach((id) => coveredObligations.add(id));
    coveredFamilies.add(next.sourceFamily);
    if (next.originKey) coveredOrigins.add(next.originKey);
  }
  return {
    selectedCandidateIds: selected.map((entry) => entry.id),
    seedCandidateIds: seedIds,
    adaptiveCandidateIds: adaptiveIds,
    skippedCandidateIds: input.candidates.filter((entry) => !selectedIds.has(entry.id)).map((entry) => entry.id),
  };
}

export function shouldStopInvestigationRecovery(recentNewlySatisfiedCounts: number[], zeroYieldWindow = 2): boolean {
  if (!Number.isInteger(zeroYieldWindow) || zeroYieldWindow < 1) throw new Error("Invalid zero-yield window");
  return recentNewlySatisfiedCounts.length >= zeroYieldWindow &&
    recentNewlySatisfiedCounts.slice(-zeroYieldWindow).every((count) => count === 0);
}
