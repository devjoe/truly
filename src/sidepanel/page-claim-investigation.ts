import type {
  GeneralPageAtomicProposition,
  GeneralPageClaimAttribution,
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
  version: 3;
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

export type PageClaimInvestigationIneligibilityReason =
  | "missing_policy"
  | "non_consequential"
  | "unsupported_claim_kind"
  | "low_consequence_availability"
  | "generic_controversy"
  | "generic_subject"
  | "ungrounded_atom"
  | "invalid_structure"
  | "missing_attribution"
  | "invalid_attribution";

export type PageClaimInvestigationEligibility =
  | { ok: true }
  | { ok: false; reason: PageClaimInvestigationIneligibilityReason };

const URL_RE = /https?:\/\/\S+/gi;
const DOMAIN_OR_PATH_RE = /(?:^|\s|\b)(?:[a-z0-9-]+\.)+(?:com|org|net|edu|gov|io|ai|co|app|dev|tw|cn|jp|uk)(?:[/:?#][^\s]*)?/i;
const COMMAND_OR_MARKDOWN_RE = /\[[^\]]+\]\([^\)]+\)|(?:^|\s)(?:curl|wget|npm|pnpm|brew|git)\s|(?:google.{0,80}(?:search|搜尋)|(?:search|搜尋).{0,80}google|bing|duckduckgo|搜尋引擎)/i;
const VAGUE_ONLY_RE = /^(?:這篇文章|此內容|它|上述說法|this article|this content|it|the above claim)[？?。.\s]*$/i;
const VAGUE_ATOMIC_PART_RE = /^(?:這段內容|此內容|上述內容|這件事|它|this content|the content|it)$/i;
const GENERIC_ATOMIC_SUBJECT_RE = /^(?:(?:the|a|an)\s+)?(?:death toll|number|figure|rate|treaty|agreement|report|study|officials?|authorities|government|company|agency|experts?|researchers?)$|^(?:死亡人數|數字|比率|條約|協議|報告|研究|官員|當局|政府|公司|機構|專家|研究人員)$/iu;
const COMPOUND_CLAIM_RE = /(?:且|並|以及|同時|；|;)|(?:，|,)\s*(?:並|且|也|另|同時)|(?:，|,)\s*[^，,。.!?]{0,28}(?:因此|隨後|未來|已|將|會|成立|出版|推動|聚焦|買(?:了|下)|購買|禁止|擴大|創下)|\b(?:and|while|as)\s+(?:(?:he|she|they|it|the|a|an|[A-Z][\p{L}'-]*)\s+)?(?:is|are|was|were|has|have|had|did|does|will|can|must|take|takes|took)\b|\b(?:signed|announced|released|approved|passed|launched)\b[^.!?]{0,100}\b(?:that|which)\b/iu;
const SECOND_PROPOSITION_RE = /(?:，|,)\s*(?:(?:he|she|they|it|the|a|an|[A-Z][\p{L}'-]*)\s+)(?:said|says|reported|announced|is|are|was|were|has|have|had|did|does|will|can)\b/iu;
const ATTRIBUTION_RELATION_RE = /(?:數據顯示|表示|指出|指稱|宣稱|估計|聲稱|報導|according to|said|reported|estimated|alleged|claimed)/iu;
const LOW_CONSEQUENCE_AVAILABILITY_RE = /(?:現已|目前)?(?:上市|開賣|販售|供應|有貨|可(?:供)?購買)|\b(?:now\s+)?(?:available|in stock|for sale)\b/iu;
const GENERIC_CONTROVERSY_RE = /(?:引發|掀起|造成|受到).{0,12}(?:爭議|熱議|討論|批評)|\b(?:sparked|caused|drew|generated)\s+(?:online\s+)?(?:controversy|debate|discussion|criticism)\b/iu;

const ATTRIBUTION_MODALITY_RE = {
  statement: /(?:表示|指出|聲稱|said|stated|claimed)/iu,
  report: /(?:報導|報告|數據顯示|according to|reported)/iu,
  estimate: /(?:估計|estimated?)/iu,
  allegation: /(?:指稱|宣稱|alleged?)/iu,
  forecast: /(?:預計|預測|forecast|projected?)/iu,
  analysis: /(?:分析|研判|analysis|analys(?:is|ed)|assessed?)/iu,
} satisfies Record<GeneralPageClaimAttribution["modality"], RegExp>;

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

function outerAttribution(
  claimText: string,
  atom: GeneralPageAtomicProposition,
): { relation: string; entity?: string } | undefined {
  const subjectStart = claimText.indexOf(atom.s);
  const atomicSpan = orderedAtomicSpan(claimText, atom);
  if (subjectStart < 0 || !atomicSpan) return undefined;
  const objectStart = claimText.indexOf(atom.o, subjectStart + atom.s.length);
  const objectEnd = objectStart + atom.o.length;
  const outerRegions = [claimText.slice(0, subjectStart), claimText.slice(objectEnd)];
  for (const region of outerRegions) {
    const clean = region.replace(/^[，,:：\s]+|[，,:：。.!?\s]+$/gu, "").trim();
    const match = clean.match(ATTRIBUTION_RELATION_RE);
    if (!match?.[0]) continue;
    const entity = clean.replace(match[0], " ").replace(/[，,:：\s]+/gu, " ").trim();
    return { relation: match[0], ...(normalizedMatchText(entity).length >= 2 ? { entity } : {}) };
  }
  return undefined;
}

function validTypedAttribution(
  claimText: string,
  atom: GeneralPageAtomicProposition,
  attribution: GeneralPageClaimAttribution,
): boolean {
  if ([attribution.source, attribution.relation].some((part) => hasInvestigationArtifact(part))) return false;
  const subjectStart = claimText.indexOf(atom.s);
  const atomicSpan = orderedAtomicSpan(claimText, atom);
  if (!atomicSpan) return false;
  const objectStart = claimText.indexOf(atom.o, subjectStart + atom.s.length);
  const objectEnd = objectStart + atom.o.length;
  const sourceStart = claimText.indexOf(attribution.source);
  const relationStart = claimText.indexOf(attribution.relation);
  const relationMatchesModality = ATTRIBUTION_MODALITY_RE[attribution.modality].test(attribution.relation);
  const beforeAtom = sourceStart >= 0 && relationStart >= 0 &&
    sourceStart + attribution.source.length <= subjectStart &&
    relationStart + attribution.relation.length <= subjectStart;
  const afterAtom = sourceStart >= objectEnd && relationStart >= objectEnd;
  return relationMatchesModality && (beforeAtom || afterAtom);
}

function usableAtomicProposition(
  claim: GeneralPageBriefClaim,
): GeneralPageAtomicProposition | undefined {
  const atom = claim.atom;
  if (!atom) return undefined;
  if ([atom.s, atom.p, atom.o].some((part) => hasInvestigationArtifact(part))) return undefined;
  if ([atom.s, atom.p, atom.o].some((part) => VAGUE_ATOMIC_PART_RE.test(part.trim()))) return undefined;
  if (GENERIC_ATOMIC_SUBJECT_RE.test(atom.s.trim())) return undefined;
  const atomicSpan = orderedAtomicSpan(claim.c, atom);
  if (!atomicSpan) return undefined;
  if (!hasTerminalSentencePunctuation(claim.c)) return undefined;
  // A typed or recognizable source frame may precede the atom without making
  // the inner proposition compound. The source frame is validated separately
  // before an action can become eligible.
  const propositionText = outerAttribution(claim.c, atom) ? atomicSpan : claim.c;
  if (!hasOneProposition(propositionText)) return undefined;
  const statuses = legalStatuses(`${atom.p} ${claim.c}`);
  if (statuses.size > 1) return undefined;
  return atom;
}

export function usableClaimQuestion(
  value: string | undefined,
  atom?: GeneralPageAtomicProposition,
  claimText?: string,
  attribution?: GeneralPageClaimAttribution,
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
    const inferredAttribution = outerAttribution(claimText ?? "", atom);
    if (attribution) {
      if (!containsAtomicPart(question, attribution.relation) ||
        !containsAtomicPart(question, attribution.source)) return undefined;
    } else if (inferredAttribution && (!containsAtomicPart(question, inferredAttribution.relation) ||
      (inferredAttribution.entity && !containsAtomicPart(question, inferredAttribution.entity)))) return undefined;
    const claimStatuses = legalStatuses(`${atom.p} ${claimText ?? ""}`);
    const questionStatuses = legalStatuses(question);
    if (claimStatuses.size > 0 && !containsAtomicPart(question, atom.p)) return undefined;
    if ([...questionStatuses].some((status) => !claimStatuses.has(status))) return undefined;
  }
  return question;
}

export function pageClaimInvestigationEligibility(
  claim: GeneralPageBriefClaim,
  groundingText?: string,
): PageClaimInvestigationEligibility {
  if (!claim.policy) return { ok: false, reason: "missing_policy" };
  if (claim.policy.consequence === "none") return { ok: false, reason: "non_consequential" };
  if (claim.policy.claimKind === "opinion") return { ok: false, reason: "unsupported_claim_kind" };
  if (LOW_CONSEQUENCE_AVAILABILITY_RE.test(claim.c)) {
    return { ok: false, reason: "low_consequence_availability" };
  }
  if (GENERIC_CONTROVERSY_RE.test(claim.c)) return { ok: false, reason: "generic_controversy" };
  if (claim.atom && GENERIC_ATOMIC_SUBJECT_RE.test(claim.atom.s.trim())) {
    return { ok: false, reason: "generic_subject" };
  }
  const atom = usableAtomicProposition(claim);
  if (!atom) return { ok: false, reason: "invalid_structure" };
  if (groundingText && [atom.s, atom.p, atom.o].some((part) => !containsAtomicPart(groundingText, part))) {
    return { ok: false, reason: "ungrounded_atom" };
  }
  const inferredAttribution = outerAttribution(claim.c, atom);
  if (inferredAttribution && !claim.attribution) return { ok: false, reason: "missing_attribution" };
  if (claim.attribution && !validTypedAttribution(claim.c, atom, claim.attribution)) {
    return { ok: false, reason: "invalid_attribution" };
  }
  return { ok: true };
}

export function deterministicClaimQuestion(claim: GeneralPageBriefClaim): string | undefined {
  if (hasInvestigationArtifact(claim.c) || hasInvestigationArtifact(claim.need)) return undefined;
  const atom = usableAtomicProposition(claim);
  if (!atom) return undefined;
  const inferredAttribution = outerAttribution(claim.c, atom);
  if (inferredAttribution && (!claim.attribution || !validTypedAttribution(claim.c, atom, claim.attribution))) {
    return undefined;
  }
  const completeClaim = claim.c.replace(/[。！？.!?][」』”’"']?$/u, "").trim();
  const proposition = cleanInvestigationText(
    claim.attribution ? completeClaim : orderedAtomicSpan(claim.c, atom) ?? "",
    160,
  );
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
  /** Exact effective Page or Focus text supplied to the model. */
  groundingText?: string;
  source?: PageClaimInvestigationSource;
}): PageClaimInvestigationTask | undefined {
  const claim = cleanInvestigationText(input.claim.c, 160);
  const why = cleanInvestigationText(input.claim.why, 120);
  const evidenceNeed = cleanInvestigationText(input.claim.need, 100);
  if (!input.groundingText?.trim()) return undefined;
  const eligibility = pageClaimInvestigationEligibility(input.claim, input.groundingText);
  if (!eligibility.ok) return undefined;
  const atom = usableAtomicProposition(input.claim);
  if (!atom) return undefined;
  const question = usableClaimQuestion(input.claim.q, atom, claim, input.claim.attribution) ??
    deterministicClaimQuestion(input.claim);
  if (!input.analysisKey || !claim || !evidenceNeed || !question) return undefined;
  const context = [
    question,
    cleanInvestigationText(input.source?.title, 100),
    cleanInvestigationText(input.source?.sourceName, 60),
    cleanInvestigationText(input.source?.publishedAt, 32),
  ].filter(Boolean);
  const searchQuery = [...new Set(context)].join(" ").slice(0, 360);
  return {
    version: 3,
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
