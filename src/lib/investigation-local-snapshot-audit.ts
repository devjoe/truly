import type { InvestigationQuestion } from "./claim-investigation-contract";
import type { InvestigationVerificationFacet } from "./claim-investigation-case";
import { selectExactInvestigationPassage } from "./claim-investigation-passage";
import type { InvestigationSourceFamily } from "./investigation-source-route";

export interface FrozenLocatorDocument {
  snapshotId: string;
  url: string;
  domain: string;
  title: string;
  text: string;
  catalogEntryIds: string[];
  sourceFamilies: InvestigationSourceFamily[];
}

export interface FrozenMatchedRouteInput {
  responsibility: { id: string; questionId: string };
  queryPortfolio: string[];
  locatorState: "matched_catalog" | "open_web_fallback";
  catalogEntryId?: string;
}

export interface FrozenLocalDocumentResult {
  snapshotId: string;
  url: string;
  domain: string;
  score: number;
  passageCandidate: boolean;
  exactExcerpt?: string;
  matchedTerms?: string[];
  passageScore?: number;
}

export interface FrozenLocalAcquisitionTrial {
  schemaVersion: 1;
  trialId: string;
  sampleId: string;
  questionId: string;
  question: string;
  responsibilityId: string;
  catalogEntryId: string;
  budget: { maxQueries: 1; maxDocuments: number };
  externalQueryCount: 0;
  baseline: { query: string; documents: FrozenLocalDocumentResult[] };
  candidate: { query: string; documents: FrozenLocalDocumentResult[] };
  candidateOnlyPassageCandidate: boolean;
  evidenceProduced: false;
  verdictProduced: false;
}

function tokens(value: string): string[] {
  const clean = value.normalize("NFKC").toLocaleLowerCase();
  const base = clean.match(/[a-z][a-z0-9._-]{1,}|\d+(?:[.,]\d+)*|[\p{Script=Han}]{2,}/gu) ?? [];
  return [...new Set(base.flatMap((token) => {
    if (!/^[\p{Script=Han}]+$/u.test(token) || token.length <= 3) return [token];
    return [token, ...Array.from({ length: token.length - 1 }, (_, index) => token.slice(index, index + 2))];
  }))];
}

function documentScore(document: FrozenLocatorDocument, query: string, question: string): number {
  const signals = new Set(tokens(`${query} ${question}`));
  const title = new Set(tokens(document.title));
  const text = new Set(tokens(document.text));
  return [...signals].reduce((score, signal) =>
    score + (title.has(signal) ? 4 : 0) + (text.has(signal) ? 1 : 0), 0);
}

function runArm(input: {
  documents: FrozenLocatorDocument[];
  query: string;
  question: InvestigationQuestion;
  normalizedClaim: string;
  requiredFacets: InvestigationVerificationFacet[];
  maxDocuments: number;
}): FrozenLocalDocumentResult[] {
  return input.documents
    .map((document, index) => ({ document, index, score: documentScore(document, input.query, input.question.question) }))
    .sort((left, right) => right.score - left.score || left.index - right.index)
    .slice(0, input.maxDocuments)
    .map(({ document, score }) => {
      const passage = selectExactInvestigationPassage({
        documentText: document.text,
        normalizedClaim: input.normalizedClaim,
        question: input.question.question,
        queryCandidates: [input.query],
        requiredFacets: input.requiredFacets,
        allowTwoCharacterSignals: true,
      });
      return {
        snapshotId: document.snapshotId,
        url: document.url,
        domain: document.domain,
        score,
        passageCandidate: Boolean(passage),
        ...(passage ? {
          exactExcerpt: passage.exactExcerpt,
          matchedTerms: passage.matchedTerms,
          passageScore: passage.score,
        } : {}),
      };
    });
}

/**
 * Runs both arms against one pre-frozen document snapshot. No query leaves the
 * process, and a passage candidate remains a review candidate rather than
 * evidence or a verdict.
 */
export function buildFrozenLocalAcquisitionTrial(input: {
  sampleId: string;
  normalizedClaim: string;
  question: InvestigationQuestion;
  requiredFacets: InvestigationVerificationFacet[];
  route: FrozenMatchedRouteInput;
  documents: FrozenLocatorDocument[];
  maxDocuments: number;
}): FrozenLocalAcquisitionTrial {
  if (input.route.locatorState !== "matched_catalog" || !input.route.catalogEntryId) {
    throw new Error("frozen audit requires a matched catalog route");
  }
  if (input.route.responsibility.questionId !== input.question.id) {
    throw new Error("route question mismatch");
  }
  if (!Number.isInteger(input.maxDocuments) || input.maxDocuments < 1 || input.maxDocuments > 8) {
    throw new Error("invalid frozen document budget");
  }
  const baselineQuery = input.question.queryCandidates[0];
  const candidateQuery = input.route.queryPortfolio[0];
  if (!baselineQuery || !candidateQuery) throw new Error("both arms require one local query");
  const baselineDocuments = runArm({ ...input, query: baselineQuery });
  const candidatePool = input.documents.filter((document) => document.catalogEntryIds.includes(input.route.catalogEntryId!));
  const candidateDocuments = runArm({ ...input, documents: candidatePool, query: candidateQuery });
  const baselineHasPassage = baselineDocuments.some((document) => document.passageCandidate);
  const candidateHasPassage = candidateDocuments.some((document) => document.passageCandidate);
  return {
    schemaVersion: 1,
    trialId: `frozen:${input.sampleId}:${input.route.responsibility.id}`,
    sampleId: input.sampleId,
    questionId: input.question.id,
    question: input.question.question,
    responsibilityId: input.route.responsibility.id,
    catalogEntryId: input.route.catalogEntryId,
    budget: { maxQueries: 1, maxDocuments: input.maxDocuments },
    externalQueryCount: 0,
    baseline: { query: baselineQuery, documents: baselineDocuments },
    candidate: { query: candidateQuery, documents: candidateDocuments },
    candidateOnlyPassageCandidate: candidateHasPassage && !baselineHasPassage,
    evidenceProduced: false,
    verdictProduced: false,
  };
}
