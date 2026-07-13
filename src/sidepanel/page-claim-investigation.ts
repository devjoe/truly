import type {
  GeneralPageAtomicProposition,
  GeneralPageBriefClaim,
} from "../lib/general-page-analysis";
import { cleanSearchContextText } from "./format";

export interface PageClaimInvestigationSource {
  title?: string;
  sourceName?: string;
  publishedAt?: string;
  url?: string;
}

export interface PageClaimInvestigationTask {
  version: 2;
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
const VAGUE_ATOMIC_PART_RE = /^(?:這段內容|此內容|上述內容|這件事|它|this content|the content|it)$/i;
const COMPOUND_CLAIM_RE = /(?:且|並|以及|同時|；|;)|(?:，|,)\s*(?:並|且|也|另|同時)|\b(?:and|while)\s+(?:(?:he|she|they|it|the|a|an|[A-Z][\p{L}'-]*)\s+)?(?:is|are|was|were|has|have|had|did|does|will|can|must)\b/iu;
const SECOND_PROPOSITION_RE = /(?:，|,)\s*(?:(?:he|she|they|it|the|a|an|[A-Z][\p{L}'-]*)\s+)(?:said|says|reported|announced|is|are|was|were|has|have|had|did|does|will|can)\b/iu;

type LegalStatus = "arrest" | "charge" | "bail" | "conviction" | "sentence" | "investigation";

const LEGAL_STATUS_PATTERNS: Array<[LegalStatus, RegExp]> = [
  ["arrest", /(?:被捕|逮捕|拘捕|遭捕|arrest(?:ed)?)/iu],
  ["charge", /(?:被控|遭控|起訴|控告|charged|indicted|accused\s+of)/iu],
  ["bail", /(?:不得交保|拒絕保釋|羈押|denied\s+bail|without\s+bail|remand(?:ed)?)/iu],
  ["conviction", /(?:判決?有罪|定罪|罪名成立|convict(?:ed|ion)?|found\s+guilty|guilty\s+verdict)/iu],
  ["sentence", /(?:判刑|刑期|量刑|sentenc(?:ed|ing)?)/iu],
  ["investigation", /(?:偵辦|偵查|調查中|investigat(?:e|ed|ion|ing))/iu],
];

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

function normalizedMatchText(value: string): string {
  return value.normalize("NFKC").toLocaleLowerCase("en").replace(/[\p{P}\p{S}\s]+/gu, "");
}

function containsAtomicPart(text: string, part: string): boolean {
  const normalizedPart = normalizedMatchText(part);
  return normalizedPart.length >= 2 && normalizedMatchText(text).includes(normalizedPart);
}

function legalStatuses(text: string): Set<LegalStatus> {
  const statuses = new Set<LegalStatus>();
  for (const [status, pattern] of LEGAL_STATUS_PATTERNS) {
    if (pattern.test(text)) statuses.add(status);
  }
  if (/(?:法院|法官).{0,24}(?:裁定|判決).{0,24}(?:有罪|罪名)|(?:court|judge).{0,32}(?:ruled|found|held).{0,20}(?:guilty|convict)/iu.test(text)) {
    statuses.add("conviction");
  }
  return statuses;
}

function hasOneProposition(value: string): boolean {
  return !COMPOUND_CLAIM_RE.test(value) && !SECOND_PROPOSITION_RE.test(value);
}

function hasTerminalSentencePunctuation(value: string): boolean {
  return /[。！？.!?][」』”’\"']?$/.test(value.trim());
}

function orderedAtomicSpan(claimText: string, atom: GeneralPageAtomicProposition): string | undefined {
  const subjectStart = claimText.indexOf(atom.s);
  if (subjectStart < 0) return undefined;
  const predicateStart = claimText.indexOf(atom.p, subjectStart + atom.s.length);
  if (predicateStart < subjectStart + atom.s.length) return undefined;
  const objectStart = claimText.indexOf(atom.o, predicateStart + atom.p.length);
  if (objectStart < predicateStart + atom.p.length) return undefined;
  return claimText.slice(subjectStart, objectStart + atom.o.length).trim();
}

function usableAtomicProposition(
  claim: GeneralPageBriefClaim,
): GeneralPageAtomicProposition | undefined {
  const atom = claim.atom;
  if (!atom) return undefined;
  if ([atom.s, atom.p, atom.o].some((part) => hasInvestigationArtifact(part))) return undefined;
  if ([atom.s, atom.p, atom.o].some((part) => VAGUE_ATOMIC_PART_RE.test(part.trim()))) return undefined;
  if (!orderedAtomicSpan(claim.c, atom)) return undefined;
  if (!hasTerminalSentencePunctuation(claim.c)) return undefined;
  if (!hasOneProposition(claim.c)) return undefined;
  const statuses = legalStatuses(`${atom.p} ${claim.c}`);
  if (statuses.size > 1) return undefined;
  return atom;
}

export function usableClaimQuestion(
  value: string | undefined,
  atom?: GeneralPageAtomicProposition,
  claimText?: string,
): string | undefined {
  if (hasInvestigationArtifact(value)) return undefined;
  if (!/[？?][」』”’\"']?$/.test((value ?? "").trim())) return undefined;
  if (((value ?? "").match(/[？?]/g) ?? []).length > 1) return undefined;
  if (!hasOneProposition(value ?? "")) return undefined;
  const question = cleanInvestigationText(value, 180);
  if (!question || question.length < 6 || VAGUE_ONLY_RE.test(question)) return undefined;
  if (/^(?:這篇文章|此內容|它|上述說法)(?:是否|有沒有|真假|來源)/.test(question)) return undefined;
  if (atom) {
    if (!containsAtomicPart(question, atom.s) ||
      !containsAtomicPart(question, atom.p) ||
      !containsAtomicPart(question, atom.o)) return undefined;
    const claimStatuses = legalStatuses(`${atom.p} ${claimText ?? ""}`);
    const questionStatuses = legalStatuses(question);
    if (claimStatuses.size > 0 && !containsAtomicPart(question, atom.p)) return undefined;
    if ([...questionStatuses].some((status) => !claimStatuses.has(status))) return undefined;
  }
  return question;
}

export function deterministicClaimQuestion(claim: GeneralPageBriefClaim): string | undefined {
  if (hasInvestigationArtifact(claim.c) || hasInvestigationArtifact(claim.need)) return undefined;
  const atom = usableAtomicProposition(claim);
  if (!atom) return undefined;
  const proposition = cleanInvestigationText(orderedAtomicSpan(claim.c, atom) ?? "", 160);
  if (!proposition || proposition.length < 6) return undefined;
  if (/\p{Script=Han}/u.test(proposition)) {
    const question = `「${proposition}」是否有外部證據支持？`;
    return question.length <= 180 ? question : undefined;
  }
  const question = `Is “${proposition}” supported by external evidence?`;
  return question.length <= 180 ? question : undefined;
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
  claim: GeneralPageBriefClaim;
  source?: PageClaimInvestigationSource;
}): PageClaimInvestigationTask | undefined {
  const claim = cleanInvestigationText(input.claim.c, 160);
  const why = cleanInvestigationText(input.claim.why, 120);
  const evidenceNeed = cleanInvestigationText(input.claim.need, 100);
  const atom = usableAtomicProposition(input.claim);
  if (!atom) return undefined;
  const question = usableClaimQuestion(input.claim.q, atom, claim) ?? deterministicClaimQuestion(input.claim);
  if (!input.analysisKey || !claim || !evidenceNeed || !question) return undefined;
  const context = [
    question,
    cleanInvestigationText(input.source?.title, 100),
    cleanInvestigationText(input.source?.sourceName, 60),
    cleanInvestigationText(input.source?.publishedAt, 32),
  ].filter(Boolean);
  const searchQuery = [...new Set(context)].join(" ").slice(0, 360);
  return {
    version: 2,
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
