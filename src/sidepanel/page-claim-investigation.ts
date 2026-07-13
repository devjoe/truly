import type { ReadingBriefClaim } from "../lib/types";
import { cleanSearchContextText } from "./format";

export interface PageClaimInvestigationSource {
  title?: string;
  sourceName?: string;
  publishedAt?: string;
  url?: string;
}

export interface PageClaimInvestigationTask {
  version: 1;
  id: string;
  analysisKey: string;
  scope: "page" | "focus";
  claimIndex: number;
  claim: string;
  why: string;
  evidenceNeed: string;
  question: string;
  searchQuery: string;
  sourceUrl?: string;
}

const URL_RE = /https?:\/\/\S+/gi;
const DOMAIN_OR_PATH_RE = /(?:^|\s|\b)(?:[a-z0-9-]+\.)+(?:com|org|net|edu|gov|io|ai|co|app|dev|tw|cn|jp|uk)(?:[/:?#][^\s]*)?/i;
const COMMAND_OR_MARKDOWN_RE = /\[[^\]]+\]\([^\)]+\)|(?:^|\s)(?:curl|wget|npm|pnpm|brew|git)\s|(?:google.{0,80}(?:search|搜尋)|(?:search|搜尋).{0,80}google|bing|duckduckgo|搜尋引擎)/i;
const VAGUE_ONLY_RE = /^(?:這篇文章|此內容|它|上述說法|this article|this content|it|the above claim)[？?。.\s]*$/i;
const COMPOUND_CLAIM_RE = /(?:，|,|；|;)\s*(?:且|並|並且|以及|and\b)/i;

function cleanInvestigationText(value: string | undefined, limit: number): string {
  return cleanSearchContextText(value ?? "", limit)
    .replace(URL_RE, "")
    .replace(/\s+/g, " ")
    .trim();
}

function hasInvestigationArtifact(value: string | undefined): boolean {
  const text = value ?? "";
  return /https?:\/\/\S+/i.test(text) || DOMAIN_OR_PATH_RE.test(text) || COMMAND_OR_MARKDOWN_RE.test(text);
}

export function usableClaimQuestion(value: string | undefined): string | undefined {
  if (hasInvestigationArtifact(value)) return undefined;
  if (((value ?? "").match(/[？?]/g) ?? []).length > 1) return undefined;
  if (COMPOUND_CLAIM_RE.test(value ?? "")) return undefined;
  const question = cleanInvestigationText(value, 180);
  if (!question || question.length < 6 || VAGUE_ONLY_RE.test(question)) return undefined;
  if (/^(?:這篇文章|此內容|它|上述說法)(?:是否|有沒有|真假|來源)/.test(question)) return undefined;
  return question;
}

export function deterministicClaimQuestion(claim: ReadingBriefClaim): string | undefined {
  if (hasInvestigationArtifact(claim.c) || hasInvestigationArtifact(claim.need)) return undefined;
  const statement = cleanInvestigationText(claim.c, 120);
  const need = cleanInvestigationText(claim.need, 80);
  if (!statement || statement.length < 6 || COMPOUND_CLAIM_RE.test(statement)) return undefined;
  if (/\p{Script=Han}/u.test(statement)) {
    return `「${statement}」是否有${need || "外部證據"}支持？`.slice(0, 180);
  }
  return `Is “${statement}” supported by ${need || "external evidence"}?`.slice(0, 180);
}

export function standardEvidenceSearchUrl(query: string): string {
  const url = new URL("https://www.google.com/search");
  url.searchParams.set("q", query);
  return url.toString();
}

export function geminiEvidenceSearchUrl(query: string): string {
  const url = new URL("https://www.google.com/search");
  url.searchParams.set("q", query);
  url.searchParams.set("udm", "50");
  return url.toString();
}

export function buildPageClaimInvestigationTask(input: {
  analysisKey: string;
  scope: "page" | "focus";
  claimIndex: number;
  claim: ReadingBriefClaim;
  source?: PageClaimInvestigationSource;
}): PageClaimInvestigationTask | undefined {
  const claim = cleanInvestigationText(input.claim.c, 160);
  const why = cleanInvestigationText(input.claim.why, 120);
  const evidenceNeed = cleanInvestigationText(input.claim.need, 100);
  if (COMPOUND_CLAIM_RE.test(claim)) return undefined;
  const question = usableClaimQuestion(input.claim.q) ?? deterministicClaimQuestion(input.claim);
  if (!input.analysisKey || !claim || !evidenceNeed || !question) return undefined;
  const context = [
    question,
    cleanInvestigationText(input.source?.title, 100),
    cleanInvestigationText(input.source?.sourceName, 60),
    cleanInvestigationText(input.source?.publishedAt, 32),
  ].filter(Boolean);
  const searchQuery = [...new Set(context)].join(" ").slice(0, 360);
  return {
    version: 1,
    id: `${input.scope}:${input.analysisKey}:${input.claimIndex}`,
    analysisKey: input.analysisKey,
    scope: input.scope,
    claimIndex: input.claimIndex,
    claim,
    why,
    evidenceNeed,
    question,
    searchQuery,
    ...(input.source?.url && /^https?:\/\//i.test(input.source.url) ? { sourceUrl: input.source.url } : {}),
  };
}
