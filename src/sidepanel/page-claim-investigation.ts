import type {
  GeneralPageAtomicProposition,
  GeneralPageClaimAttribution,
  GeneralPageBriefClaim,
} from "../lib/general-page-analysis";
import {
  resolveSourceQuote,
  sourceQuoteMatchesGroundingText,
} from "../lib/general-page-investigation-adapter";
import { cleanSearchContextText } from "./format";

export interface PageClaimInvestigationSource {
  title?: string;
  sourceName?: string;
  publishedAt?: string;
  url?: string;
}

export interface ClaimVerificationIntent {
  exactClaim: string;
  why: string;
  evidenceNeed: string;
  question: string;
  /** URL is allowed only as source metadata for conversational AI search. */
  sourceContext?: PageClaimInvestigationSource;
}

export interface PageClaimInvestigationTask {
  version: 4;
  id: string;
  analysisKey: string;
  scope: "page" | "focus";
  claimIndex: number;
  intent: ClaimVerificationIntent;
  googleKeywords: string;
  aiModePrompt: string;
  sourceUrl?: string;
}

export type PageClaimInvestigationIneligibilityReason =
  | "missing_policy"
  | "non_consequential"
  | "unsupported_claim_kind"
  | "low_consequence_availability"
  | "generic_controversy"
  | "generic_subject"
  | "navigation_fragment"
  | "underspecified_comparison"
  | "generic_evidence_need"
  | "atom_span_mismatch"
  | "compound_claim"
  | "vague_atom"
  | "ungrounded_atom"
  | "invalid_structure"
  | "missing_attribution"
  | "invalid_attribution"
  | "invalid_question";

const REPAIRABLE_INELIGIBILITY_REASONS = new Set<PageClaimInvestigationIneligibilityReason>([
  "atom_span_mismatch",
  "compound_claim",
  "vague_atom",
  "generic_subject",
  "ungrounded_atom",
  "missing_attribution",
  "invalid_attribution",
  "invalid_question",
]);

export function isRepairablePageClaimIneligibilityReason(
  reason: PageClaimInvestigationIneligibilityReason,
): boolean {
  return REPAIRABLE_INELIGIBILITY_REASONS.has(reason);
}

export type PageClaimInvestigationEligibility =
  | { ok: true }
  | { ok: false; reason: PageClaimInvestigationIneligibilityReason };

const URL_RE = /https?:\/\/\S+/gi;
const DOMAIN_OR_PATH_RE = /(?:^|\s|\b)(?:[a-z0-9-]+\.)+(?:com|org|net|edu|gov|io|ai|co|app|dev|tw|cn|jp|uk)(?:[/:?#][^\s]*)?/i;
const COMMAND_OR_MARKDOWN_RE = /\[[^\]]+\]\([^\)]+\)|(?:^|\s)(?:curl|wget|npm|pnpm|brew|git)\s|(?:google.{0,80}(?:search|搜尋)|(?:search|搜尋).{0,80}google|bing|duckduckgo|搜尋引擎)/i;
const VAGUE_ONLY_RE = /^(?:這篇文章|此內容|它|上述說法|this article|this content|it|the above claim)[？?。.\s]*$/i;
const VAGUE_ATOMIC_PART_RE = /^(?:這段內容|此內容|上述內容|這件事|它|this content|the content|it)$/i;
const GENERIC_ATOMIC_SUBJECT_RE = /^(?:(?:the|a|an)\s+)?(?:death toll|number|figure|rate|treaty|agreement|report|study|officials?|authorities|government|company|agency|experts?|researchers?)$|^(?:死亡人數|數字|比率|條約|協議|報告|研究|官員|當局|政府|公司|機構|專家|研究人員)$/iu;
const COMPOUND_CLAIM_RE = /(?:且|並|以及|同時|；|;)|(?:，|,)\s*(?:並|且|也|另|同時)|(?:，|,)\s*[^，,。.!?]{0,28}(?:因此|隨後|未來|已|將|會|成立|出版|推動|聚焦|導致|引發|強調|要求|呼籲|批評|質疑|抗議|指出|買(?:了|下)|購買|禁止|擴大|創下)|\b(?:and|while|as)\s+(?:(?:he|she|they|it|the|a|an|[A-Z][\p{L}'-]*)\s+)?(?:is|are|was|were|has|have|had|did|does|will|can|must|take|takes|took)\b|\b(?:signed|announced|released|approved|passed|launched)\b[^.!?]{0,100}\b(?:that|which)\b/iu;
const SECOND_PROPOSITION_RE = /(?:，|,)\s*(?:(?:he|she|they|it|the|a|an|[A-Z][\p{L}'-]*)\s+)(?:said|says|reported|announced|is|are|was|were|has|have|had|did|does|will|can)\b/iu;
const ATTRIBUTION_RELATION_RE = /(?:數據顯示|表示|指出|指稱|宣稱|估計|聲稱|報導|according to|said|reported|estimated|alleged|claimed)/iu;
const LOW_CONSEQUENCE_AVAILABILITY_RE = /(?:現已|目前)?(?:上市|開賣|販售|供應|有貨|可(?:供)?購買)|\b(?:now\s+)?(?:available|in stock|for sale)\b/iu;
const GENERIC_CONTROVERSY_RE = /(?:引發|掀起|造成|受到).{0,12}(?:爭議|熱議|討論|批評)|\b(?:sparked|caused|drew|generated)\s+(?:online\s+)?(?:controversy|debate|discussion|criticism)\b/iu;
const NAVIGATION_SECTION_LABEL_RE = /^(?:related(?:\s+(?:stories|articles|news|links))?|read\s+more|recommended|more\s+(?:news|stories|articles)|see\s+also|相關(?:文章|新聞|報導|連結)|延伸閱讀|推薦閱讀|更多(?:新聞|報導|文章|內容))[：:]?$/iu;
const COMPARATIVE_ASSERTION_RE = /\b(?:better|worse|higher|lower|faster|slower|cheaper|costlier|more\s+(?:effective|accurate|popular|expensive)|less\s+(?:effective|accurate|popular|expensive)|outperform(?:s|ed)?|best|worst|largest|smallest|highest|lowest)\b|(?:優於|劣於|勝過|不如|表現更好|較(?:高|低|快|慢|便宜|昂貴|準確|有效)|最(?:高|低|快|慢|便宜|昂貴|準確|有效)|排名第一)/iu;
const COMPARISON_TIME_RE = /\b(?:19|20)\d{2}\b|\b(?:january|february|march|april|may|june|july|august|september|october|november|december|quarter|year)\b|(?:民國\s*\d{2,3}\s*年|\d{2,3}\s*年度|\d{1,2}\s*月|季度)/iu;
const COMPARISON_MARKET_OR_REGION_RE = /\b(?:market|region|worldwide|global|national|nationwide|local)\b|(?:市場|地區|區域|全球|全國|台灣|臺灣|美國|中國|日本|歐盟)/iu;
const COMPARISON_METRIC_RE = /\b(?:benchmark|score|rate|accuracy|latency|price|cost|revenue|sales|market\s+share|users?|cases?|points?|percent(?:age)?|seconds?|minutes?|hours?)\b|(?:基準測試|分數|得分|比率|準確率|延遲|價格|成本|營收|銷量|市占率|市場占有率|占有率|使用者|用戶|人數|件數|百分比|百分點|秒|分鐘|小時|指標)/iu;
const GENERIC_EVIDENCE_NEED_RE = /^(?:(?:(?:an?|the)\s+)?(?:(?:external|supporting|reliable|authoritative|official|independent|additional|more)\s+)*(?:evidence|proof|sources?|data|information)|(?:(?:外部|支持|可靠|權威|官方|獨立|更多|相關)\s*)*(?:證據|證明|資料|來源|資訊))$/iu;
const SEARCH_STOP_WORDS = new Set([
  "a", "an", "and", "are", "as", "at", "be", "been", "being", "by", "did", "do", "does", "for",
  "from", "has", "have", "had", "in", "is", "it", "of", "on", "or", "that", "the", "this", "to",
  "was", "were", "will", "with",
]);

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

function cleanSourceMetadataUrl(value: string | undefined): string | undefined {
  if (!value || /[\u0000-\u001f\u007f]/u.test(value)) return undefined;
  try {
    const url = new URL(value);
    if (!/^https?:$/i.test(url.protocol) || url.username || url.password) return undefined;
    const normalized = url.toString();
    return normalized.length <= 320 ? normalized : undefined;
  } catch {
    return undefined;
  }
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

function hasSharedGroundingAnchor(claimText: string, sourceQuote: string): boolean {
  const quote = normalizedMatchText(sourceQuote);
  const anchors = claimText.match(/\d+(?:[.,]\d+)*|[A-Za-z][A-Za-z0-9._-]{3,}|[\p{Script=Han}]{2,}/gu) ?? [];
  return anchors.some((anchor) => {
    const normalized = normalizedMatchText(anchor);
    return normalized.length >= 2 && quote.includes(normalized);
  });
}

function sourceQuoteIsNavigationFragment(claim: GeneralPageBriefClaim, groundingText: string): boolean {
  const quote = resolveSourceQuote(claim.sourceQuote, groundingText, claim.c);
  if (!quote) return false;
  const positions: number[] = [];
  for (let cursor = groundingText.indexOf(quote); cursor >= 0; cursor = groundingText.indexOf(quote, cursor + quote.length)) {
    positions.push(cursor);
  }
  if (positions.length === 0) return false;
  return positions.every((position) => {
    const precedingLines = groundingText.slice(Math.max(0, position - 240), position)
      .split(/\r?\n/u)
      .map((line) => line.trim())
      .filter(Boolean);
    const followsNavigationLabel = precedingLines.slice(-2)
      .some((line) => NAVIGATION_SECTION_LABEL_RE.test(line));
    const quoteEnd = position + quote.length;
    const extractionBoundary = groundingText.slice(quoteEnd);
    const touchesExtractionBoundary = groundingText.length >= 1_200 &&
      position >= groundingText.length * 0.8 &&
      groundingText.length - quoteEnd <= 2 &&
      !hasTerminalSentencePunctuation(`${quote}${extractionBoundary}`);
    return followsNavigationLabel || touchesExtractionBoundary;
  });
}

function isUnderspecifiedComparison(claim: GeneralPageBriefClaim): boolean {
  const proposition = `${claim.atom?.p ?? ""} ${claim.atom?.o ?? ""}`.trim();
  if (!COMPARATIVE_ASSERTION_RE.test(proposition)) return false;
  return !COMPARISON_TIME_RE.test(claim.c) ||
    !COMPARISON_MARKET_OR_REGION_RE.test(claim.c) ||
    !COMPARISON_METRIC_RE.test(claim.c);
}

function hasGenericEvidenceNeed(value: string): boolean {
  return GENERIC_EVIDENCE_NEED_RE.test(value.replace(/[。！？.!?]+$/u, "").trim());
}

function searchKeywordSegment(value: string | undefined, limit: number): string {
  const clean = cleanInvestigationText(value, limit)
    .replace(/[「」『』“”‘’"()[\]{}，。！？、,;；:：?!.]/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
  if (!clean || /\p{Script=Han}/u.test(clean)) return clean;
  return (clean.match(/[\p{L}\p{N}][\p{L}\p{N}._'-]*/gu) ?? [])
    .filter((token) => !SEARCH_STOP_WORDS.has(token.toLocaleLowerCase("en")))
    .join(" ");
}

function boundedKeywordSegment(value: string | undefined, limit: number): string {
  return Array.from(searchKeywordSegment(value, Math.max(limit * 2, limit)))
    .slice(0, limit)
    .join("")
    .trim();
}

function claimNumberAndDateAnchors(value: string): string {
  return [...new Set(value.match(
    /\b(?:19|20)\d{2}(?:[-/]\d{1,2}(?:[-/]\d{1,2})?)?\b|\b\d+(?:[.,]\d+)*(?:%|％|萬|億|項|件|人|元|年|月|日|歲|points?|percent(?:age)?)?/giu,
  ) ?? [])].join(" ");
}

function joinKeywordSegments(segments: string[], limit = 240): string {
  const output: string[] = [];
  for (const segment of segments.map((value) => value.trim()).filter(Boolean)) {
    const normalized = normalizedMatchText(segment);
    if (!normalized || output.some((value) => normalizedMatchText(value).includes(normalized))) continue;
    const remaining = limit - Array.from(output.join(" ")).length - (output.length > 0 ? 1 : 0);
    if (remaining <= 0) break;
    const bounded = Array.from(segment).slice(0, remaining).join("").trim();
    if (bounded) output.push(bounded);
  }
  return output.join(" ");
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

function inspectAtomicProposition(
  claim: GeneralPageBriefClaim,
): { atom?: GeneralPageAtomicProposition; reason?: PageClaimInvestigationIneligibilityReason } {
  const atom = claim.atom;
  if (!atom) return { reason: "invalid_structure" };
  if ([atom.s, atom.p, atom.o].some((part) => hasInvestigationArtifact(part))) return { reason: "invalid_structure" };
  if ([atom.s, atom.p, atom.o].some((part) => VAGUE_ATOMIC_PART_RE.test(part.trim()))) return { reason: "vague_atom" };
  if (GENERIC_ATOMIC_SUBJECT_RE.test(atom.s.trim())) return { reason: "generic_subject" };
  const atomicSpan = orderedAtomicSpan(claim.c, atom);
  if (!atomicSpan) return { reason: "atom_span_mismatch" };
  if (!hasTerminalSentencePunctuation(claim.c)) return { reason: "invalid_structure" };
  // A typed or recognizable source frame may precede the atom without making
  // the inner proposition compound. The source frame is validated separately
  // before an action can become eligible.
  const propositionText = outerAttribution(claim.c, atom) ? atomicSpan : claim.c;
  if (!hasOneProposition(propositionText)) return { reason: "compound_claim" };
  const statuses = legalStatuses(`${atom.p} ${claim.c}`);
  if (statuses.size > 1) return { reason: "compound_claim" };
  return { atom };
}

function usableAtomicProposition(claim: GeneralPageBriefClaim): GeneralPageAtomicProposition | undefined {
  return inspectAtomicProposition(claim).atom;
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
  if (hasGenericEvidenceNeed(claim.need)) return { ok: false, reason: "generic_evidence_need" };
  if (LOW_CONSEQUENCE_AVAILABILITY_RE.test(claim.c)) {
    return { ok: false, reason: "low_consequence_availability" };
  }
  if (GENERIC_CONTROVERSY_RE.test(claim.c)) return { ok: false, reason: "generic_controversy" };
  if (isUnderspecifiedComparison(claim)) return { ok: false, reason: "underspecified_comparison" };
  if (groundingText && sourceQuoteIsNavigationFragment(claim, groundingText)) {
    return { ok: false, reason: "navigation_fragment" };
  }
  if (claim.atom && GENERIC_ATOMIC_SUBJECT_RE.test(claim.atom.s.trim())) {
    return { ok: false, reason: "generic_subject" };
  }
  const inspected = inspectAtomicProposition(claim);
  const atom = inspected.atom;
  if (!atom) return { ok: false, reason: inspected.reason ?? "invalid_structure" };
  if (groundingText && [atom.s, atom.p, atom.o].some((part) => !containsAtomicPart(groundingText, part))) {
    if (!claim.sourceQuote || hasInvestigationArtifact(claim.sourceQuote) ||
      !sourceQuoteMatchesGroundingText(claim.sourceQuote, groundingText) ||
      !hasSharedGroundingAnchor(claim.c, claim.sourceQuote)) {
      return { ok: false, reason: "ungrounded_atom" };
    }
  }
  const inferredAttribution = outerAttribution(claim.c, atom);
  if (inferredAttribution && !claim.attribution) return { ok: false, reason: "missing_attribution" };
  if (inferredAttribution && claim.attribution && !validTypedAttribution(claim.c, atom, claim.attribution)) {
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
    inferredAttribution ? completeClaim : orderedAtomicSpan(claim.c, atom) ?? "",
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

export function buildGoogleSearchKeywords(
  intent: ClaimVerificationIntent,
  claim?: Pick<GeneralPageBriefClaim, "atom" | "attribution">,
): string {
  if (!claim?.atom) {
    return joinKeywordSegments([
      boundedKeywordSegment(intent.exactClaim, 140),
      boundedKeywordSegment(intent.evidenceNeed, 70),
      boundedKeywordSegment(intent.sourceContext?.publishedAt, 24),
    ]);
  }
  return joinKeywordSegments([
    boundedKeywordSegment(claim.attribution
      ? `${claim.attribution.source} ${claim.attribution.relation}`
      : undefined, 35),
    boundedKeywordSegment(claim.atom.s, 40),
    boundedKeywordSegment(claim.atom.p, 25),
    boundedKeywordSegment(intent.evidenceNeed, 55),
    boundedKeywordSegment(claim.atom.o, 55),
    boundedKeywordSegment(claimNumberAndDateAnchors(intent.exactClaim), 25),
    boundedKeywordSegment(intent.sourceContext?.publishedAt, 20),
  ]);
}

export function buildGoogleAiModePrompt(intent: ClaimVerificationIntent): string {
  const sourceContext = [
    cleanInvestigationText(intent.sourceContext?.title, 100),
    cleanInvestigationText(intent.sourceContext?.sourceName, 60),
    cleanInvestigationText(intent.sourceContext?.publishedAt, 32),
  ].filter(Boolean).join(" · ");
  const terminate = (value: string, punctuation: "." | "。") =>
    /[。！？.!?]$/u.test(value) ? value : `${value}${punctuation}`;
  const sourceUrl = cleanSourceMetadataUrl(intent.sourceContext?.url);
  if (/\p{Script=Han}/u.test(intent.exactClaim)) {
    return [
      `請協助查核以下說法：「${intent.exactClaim}」`,
      `查核問題：${intent.question}`,
      `需要的證據：${terminate(intent.evidenceNeed, "。")}`,
      sourceContext ? `頁面來源脈絡：${terminate(sourceContext, "。")}` : "",
      sourceUrl ? `來源網址（metadata）：${sourceUrl}` : "",
      "請優先引用能直接回答問題的原始或權威來源，標明來源與日期，並區分已證實、尚不確定與推論。",
    ].filter(Boolean).join(" ").slice(0, 960);
  }
  return [
    `Please verify this claim: “${intent.exactClaim}”`,
    `Verification question: ${intent.question}`,
    `Evidence needed: ${terminate(intent.evidenceNeed, ".")}`,
    sourceContext ? `Page source context: ${terminate(sourceContext, ".")}` : "",
    sourceUrl ? `Source URL (metadata): ${sourceUrl}` : "",
    "Prioritize primary or authoritative sources that directly answer the question, cite the source and date, and distinguish verified facts, uncertainty, and inference.",
  ].filter(Boolean).join(" ").slice(0, 960);
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
  const inferredAttribution = outerAttribution(input.claim.c, atom);
  const question = usableClaimQuestion(
    input.claim.q,
    atom,
    claim,
    inferredAttribution ? input.claim.attribution : undefined,
  ) ??
    deterministicClaimQuestion(input.claim);
  if (!input.analysisKey || !claim || !evidenceNeed || !question) return undefined;
  const sourceContext = {
    ...(cleanInvestigationText(input.source?.title, 100) ? { title: cleanInvestigationText(input.source?.title, 100) } : {}),
    ...(cleanInvestigationText(input.source?.sourceName, 60) ? { sourceName: cleanInvestigationText(input.source?.sourceName, 60) } : {}),
    ...(cleanInvestigationText(input.source?.publishedAt, 32) ? { publishedAt: cleanInvestigationText(input.source?.publishedAt, 32) } : {}),
    ...(cleanSourceMetadataUrl(input.source?.url) ? { url: cleanSourceMetadataUrl(input.source?.url) } : {}),
  };
  const intent: ClaimVerificationIntent = {
    exactClaim: claim,
    why,
    evidenceNeed,
    question,
    ...(Object.keys(sourceContext).length > 0 ? { sourceContext } : {}),
  };
  return {
    version: 4,
    id: `${input.scope}:${input.analysisKey}:${input.claimIndex}`,
    analysisKey: input.analysisKey,
    scope: input.scope,
    claimIndex: input.claimIndex,
    intent,
    googleKeywords: buildGoogleSearchKeywords(intent, input.claim),
    aiModePrompt: buildGoogleAiModePrompt(intent),
    ...(cleanSourceMetadataUrl(input.source?.url) ? { sourceUrl: cleanSourceMetadataUrl(input.source?.url) } : {}),
  };
}
