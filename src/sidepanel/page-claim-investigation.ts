import type {
  GeneralPageAtomicProposition,
  GeneralPageClaimAttribution,
  GeneralPageBriefClaim,
} from "../lib/general-page-analysis";
import {
  resolveSourceQuote,
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
  /** Canonical source-language question used for source-language workflows. */
  question: string;
  /** Localized question used for Side Panel display and copy. */
  displayQuestion: string;
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

export interface PageClaimInvestigationPreparationInput {
  analysisKey: string;
  scope: "page" | "focus";
  claimIndex: number;
  claim: GeneralPageBriefClaim;
  /** Exact effective Page or Focus text supplied to the model. */
  groundingText?: string;
  source?: PageClaimInvestigationSource;
}

export type PageClaimInvestigationCanonicalization =
  | "infer_typed_attribution"
  | "project_exact_atomic_span";

export type PageClaimInvestigationPreparation =
  | {
      decision: "prepared";
      claim: GeneralPageBriefClaim;
      task: PageClaimInvestigationTask;
      canonicalizations: PageClaimInvestigationCanonicalization[];
    }
  | {
      decision: "rejected";
      reason: PageClaimInvestigationIneligibilityReason;
      canonicalizations: PageClaimInvestigationCanonicalization[];
    };

export type PageClaimInvestigationIneligibilityReason =
  | "missing_policy"
  | "non_consequential"
  | "unsupported_claim_kind"
  | "low_consequence_availability"
  | "low_consequence_routine_event"
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
const ATTRIBUTION_RELATION_RE = /(?:數據顯示|表示|指出|指稱|宣稱|估計|聲稱|報導|according to|announced by|announced|said|reported|estimated|alleged|claimed)/iu;
const LOW_CONSEQUENCE_AVAILABILITY_RE = /(?:現已|目前)?(?:上市|開賣|販售|供應|有貨|可(?:供)?購買)|\b(?:now\s+)?(?:available|in stock|for sale)\b/iu;
const LOW_CONSEQUENCE_ROUTINE_EVENT_RE = /(?:\b(?:bar|restaurant|cafe|shop|store|venue|hotel)\b.{0,60}\b(?:(?:\w+-)?anniversary\s+(?:party|event)|grand\s+opening|guest\s+(?:chef|dj)|live\s+performance)\b)|(?:(?:酒吧|餐廳|咖啡廳|門市|商店|飯店).{0,32}(?:週年(?:派對|活動)|開幕(?:派對|活動)|客座(?:料理|主廚|DJ|演出)|現場演出))/iu;
const GENERIC_CONTROVERSY_RE = /(?:引發|掀起|造成|受到).{0,12}(?:爭議|熱議|討論|批評)|\b(?:sparked|caused|drew|generated)\s+(?:online\s+)?(?:controversy|debate|discussion|criticism)\b/iu;
const NAVIGATION_SECTION_LABEL_RE = /^(?:related(?:\s+(?:stories|articles|news|links))?|read\s+more|recommended|more\s+(?:news|stories|articles)|see\s+also|相關(?:文章|新聞|報導|連結)|延伸閱讀|推薦閱讀|更多(?:新聞|報導|文章|內容))[：:]?$/iu;
const COMPARATIVE_ASSERTION_RE = /\b(?:better|worse|higher|lower|faster|slower|cheaper|costlier|more\s+(?:effective|accurate|popular|expensive)|less\s+(?:effective|accurate|popular|expensive)|outperform(?:s|ed)?|overtak(?:e|es|ing)|overtook|overtaken|best|worst|largest|smallest|highest|lowest)\b|\bsurpass(?:es|ed|ing)?\s+(?!\d)\p{L}[\p{L}\p{N}._'-]*(?:\s+[\p{L}\p{N}._'-]+){0,4}|\b(?:take|takes|took|taken|taking)\s+the\s+lead\s+over\b|\blead(?:s|ing)?\b(?=.{0,40}\b(?:by|in|with)\b.{0,60}\b(?:benchmark|score|rate|accuracy|latency|price|cost|revenue|sales|market\s+share|users?|cases?|points?|percent(?:age)?)\b)|(?:優於|劣於|勝過|不如|表現更好|較(?:高|低|快|慢|便宜|昂貴|準確|有效)|最(?:高|低|快|慢|便宜|昂貴|準確|有效)|排名第一)|(?:超越|趕超|反超)(?!\s*\d)/iu;
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
  statement: /(?:表示|指出|聲稱|announced by|announced|said|stated|claimed)/iu,
  report: /(?:報導|報告|數據顯示|according to|reported)/iu,
  estimate: /(?:估計|estimated?)/iu,
  allegation: /(?:指稱|宣稱|alleged?)/iu,
  forecast: /(?:預計|預測|forecast|projected?)/iu,
  analysis: /(?:分析|研判|analysis|analys(?:is|ed)|assessed?)/iu,
} satisfies Record<GeneralPageClaimAttribution["modality"], RegExp>;

const DETERMINISTIC_ATTRIBUTION_RELATIONS: Array<{
  relation: RegExp;
  modality: GeneralPageClaimAttribution["modality"];
}> = [
  { relation: /數據顯示/giu, modality: "report" },
  { relation: /\baccording to\b/giu, modality: "report" },
  { relation: /\bestimated?\b/giu, modality: "estimate" },
  { relation: /估計/giu, modality: "estimate" },
  { relation: /\breported\b/giu, modality: "report" },
  { relation: /報導/giu, modality: "report" },
  { relation: /\bforecast\b/giu, modality: "forecast" },
  { relation: /預測/giu, modality: "forecast" },
  { relation: /\banalys(?:is|ed)\b/giu, modality: "analysis" },
  { relation: /(?:分析|研判)/giu, modality: "analysis" },
  { relation: /\balleged\b/giu, modality: "allegation" },
  { relation: /指稱/giu, modality: "allegation" },
  { relation: /\bannounced by\b/giu, modality: "statement" },
  { relation: /\b(?:said|stated)\b/giu, modality: "statement" },
  { relation: /(?:表示|指出)/giu, modality: "statement" },
];

const GENERIC_ATTRIBUTION_SOURCE_RE = /^(?:(?:the|an?)\s+)?(?:government|officials?|authorities|experts?|researchers?|agency|company|source|report|study|he|she|they|it|政府|官員|當局|專家|研究人員|機構|公司|消息人士|報告|研究|他|她|他們|它)$/iu;
const PROJECTION_CRITICAL_TEXT_RE = /\d|\b(?:not|no|never|without|unless|if|provided|subject\s+to)\b|(?:未(?:曾|能|有|獲|完成|通過|達成|公布|確認|批准|同意|發現|提供|支持)|不(?:會|能|是|曾|再|予|允許|承認|支持|符合)|無法|沒有|並非|若|如果|除非|只要|條件)/iu;
const NON_RELATIONAL_PREDICATE_RE = /^(?:於|在|自|從|截至|between|during|on|at|in|from|as\s+of)(?:\s|\d|年|月|日|時|點|分|至|-|–|—|:|：|\/)*$/iu;
const UNSAFE_ATOMIC_GAP_RE = /\b(?:not|no|never|may|might|could|would|should|reportedly|allegedly|apparently|purportedly)\b|(?:不|未(?!來)|無|沒|若|如果|假如|倘若|除非|可能|或許|也許|據稱|傳聞|疑似|聲稱|宣稱|預計|預測|估計|推測|研判|尚未|應該|應當|可以|可望|將|會|能|恐怕|恐將|初步|暫定|修正|更正|未經|僅|只|部分|約)/iu;
const SENTENCE_BOUNDARY_IN_GAP_RE = /[。！？!?]|\.(?=\s|$)/u;
const SAFE_AUXILIARY_FILLER_RE = /\b(?:has|have|had)\b/iu;
// A publisher often inserts a short, factual publication-time bridge between
// an institution and a report relation. This list stays deliberately closed:
// it must not absorb modality, negation, or an additional proposition.
const SAFE_ATTRIBUTION_BRIDGE_RE = /^(?:(?:今天|今日|昨日|昨天|本日|當日|日前|近日|近期|本週|本月|今年|最新)?(?:所)?(?:公布|發布)(?:的|之))$/u;
const SAFE_SOURCE_QUOTE_PREFIX_RE = /^(?:今年)$/u;
const SAFE_TRAILING_ATTRIBUTION_PREFIX_RE = /^(?:in\s+(?:a|the)\s+programme)$/iu;
const SAFE_ACCORDING_TO_SUFFIX_RE = /^[,，]\s*and\s+the\s+(?:(?:\d+(?:st|nd|rd|th))|first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth)[-\s](?:driest|wettest|warmest|coldest)\s+since\s+(?:(?:nationwide|national|official)\s+)?(?:(?:rainfall|weather|temperature|climate)\s+)?records\s+began(?:\s+in\s+(?:19|20)\d{2})?[,，]\s*$/iu;
const UNSAFE_ATTRIBUTION_SUFFIX_RE = /\b(?:but|however|although|though|yet|whereas|except|deny|denied|dispute|disputed|retract|retracted|withdraw|withdrawn|correct|corrected|clarify|clarified|false|incorrect|contradict|contradicted|questioned)\b|(?:但是|但|然而|儘管|否認|質疑|撤回|撤銷|更正|修正|澄清|錯誤|不實|相反|矛盾)/iu;

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

function sourceQuoteIsNavigationFragment(claim: GeneralPageBriefClaim, groundingText: string): boolean {
  const quote = resolveSourceQuote(claim.sourceQuote, groundingText);
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
  const segment = searchKeywordSegment(value, Math.max(limit * 2, limit));
  if (Array.from(segment).length <= limit) return segment;
  const words = segment.split(/\s+/u).filter(Boolean);
  const bounded: string[] = [];
  for (const word of words) {
    const candidate = [...bounded, word].join(" ");
    if (Array.from(candidate).length > limit) break;
    bounded.push(word);
  }
  // Search terms must never end in a partial word. A single long identifier is
  // still more useful intact than an arbitrary character prefix.
  return bounded.join(" ") || words[0] || "";
}

function claimNumberAndDateAnchors(value: string): string {
  return [...new Set(value.match(
    /\b(?:19|20)\d{2}(?:[-/]\d{1,2}(?:[-/]\d{1,2})?)?\b|\b\d+(?:[.,]\d+)*(?:%|％|萬|億|項|件|人|元|年|月|日|歲|points?|percent(?:age)?)?/giu,
  ) ?? [])].join(" ");
}

function numericAndDateAnchorSet(value: string): Set<string> {
  return new Set(
    claimNumberAndDateAnchors(value)
      .split(/\s+/u)
      .map((anchor) => anchor.normalize("NFKC").toLocaleLowerCase("en"))
      .filter(Boolean),
  );
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

function allExactOccurrences(text: string, part: string): number[] {
  const positions: number[] = [];
  if (!part) return positions;
  for (let cursor = text.indexOf(part); cursor >= 0; cursor = text.indexOf(part, cursor + 1)) {
    positions.push(cursor);
    if (positions.length > 64) return [];
  }
  return positions;
}

interface ExactAtomicAlignment {
  start: number;
  predicateStart: number;
  objectStart: number;
  end: number;
  span: string;
  gaps: readonly [string, string];
}

function exactAtomicAlignments(
  text: string,
  atom: GeneralPageAtomicProposition,
): ExactAtomicAlignment[] {
  const subjectPositions = allExactOccurrences(text, atom.s);
  const predicatePositions = allExactOccurrences(text, atom.p);
  const objectPositions = allExactOccurrences(text, atom.o);
  const candidates: ExactAtomicAlignment[] = [];
  for (const start of subjectPositions) {
    for (const predicateStart of predicatePositions) {
      if (predicateStart < start + atom.s.length) continue;
      for (const objectStart of objectPositions) {
        if (objectStart < predicateStart + atom.p.length) continue;
        const end = objectStart + atom.o.length;
        candidates.push({
          start,
          predicateStart,
          objectStart,
          end,
          span: text.slice(start, end).trim(),
          gaps: [
            text.slice(start + atom.s.length, predicateStart),
            text.slice(predicateStart + atom.p.length, objectStart),
          ],
        });
        if (candidates.length > 128) return [];
      }
    }
  }
  return candidates.filter((candidate, index) => candidates.findIndex((other) =>
    other.start === candidate.start &&
    other.predicateStart === candidate.predicateStart &&
    other.objectStart === candidate.objectStart &&
    other.end === candidate.end) === index);
}

function exactAtomicCoordinates(
  claimText: string,
  atom: GeneralPageAtomicProposition,
): ExactAtomicAlignment | undefined {
  const candidates = exactAtomicAlignments(claimText, atom);
  return candidates.length === 1 ? candidates[0] : undefined;
}

function normalizedAtomicGap(value: string): string {
  return value.normalize("NFKC").replace(/\s+/gu, " ").trim();
}

function atomicGapIsUnsafe(value: string): boolean {
  return SENTENCE_BOUNDARY_IN_GAP_RE.test(value) || UNSAFE_ATOMIC_GAP_RE.test(value);
}

function atomicGapsSafelyAlign(
  claimGap: string,
  evidenceGap: string,
  allowTrailingAuxiliary: boolean,
): boolean {
  if (atomicGapIsUnsafe(claimGap) || atomicGapIsUnsafe(evidenceGap)) return false;
  const claim = normalizedAtomicGap(claimGap);
  const evidence = normalizedAtomicGap(evidenceGap);
  if (claim === evidence) return true;
  if (!allowTrailingAuxiliary) return false;
  const withoutTrailingAuxiliary = (value: string) => normalizedAtomicGap(value)
    .replace(/(?:^|\s)(?:has|have|had)$/iu, "")
    .trim();
  return withoutTrailingAuxiliary(claimGap) === withoutTrailingAuxiliary(evidenceGap) &&
    (claimGap.search(SAFE_AUXILIARY_FILLER_RE) >= 0 || evidenceGap.search(SAFE_AUXILIARY_FILLER_RE) >= 0);
}

interface ExactAtomicGroundingWitness {
  evidenceText: string;
  alignments: ExactAtomicAlignment[];
}

function resolveExactAtomicGroundingWitness(
  claim: GeneralPageBriefClaim,
  groundingText: string,
): ExactAtomicGroundingWitness | undefined {
  const atom = claim.atom;
  if (!atom) return undefined;
  const claimAlignment = exactAtomicCoordinates(claim.c, atom);
  if (!claimAlignment || claimAlignment.gaps.some(atomicGapIsUnsafe)) return undefined;
  const evidenceText = claim.sourceQuote
    ? resolveSourceQuote(claim.sourceQuote, groundingText)
    : groundingText;
  if (!evidenceText) return undefined;
  const alignments = exactAtomicAlignments(evidenceText, atom).filter((alignment) =>
    atomicGapsSafelyAlign(claimAlignment.gaps[0], alignment.gaps[0], true) &&
    atomicGapsSafelyAlign(claimAlignment.gaps[1], alignment.gaps[1], false));
  const gapSignatures = new Set(alignments.map((alignment) => JSON.stringify(
    alignment.gaps.map(normalizedAtomicGap),
  )));
  // Repeated DOM copies with the same gaps are equivalent evidence. Distinct
  // gap signatures could encode different modality or scope and stay closed.
  return gapSignatures.size === 1 ? { evidenceText, alignments } : undefined;
}

function exactAtomicGroundingWitness(
  claim: GeneralPageBriefClaim,
  groundingText: string,
): string | undefined {
  return resolveExactAtomicGroundingWitness(claim, groundingText)?.evidenceText;
}

function trimmedOuterRegion(value: string): string {
  return value.replace(/^[\s，,；;:：。.!?「『“‘"']+|[\s，,；;:：。.!?」』”’"']+$/gu, "").trim();
}

function attributionUsesAtomicAlignment(
  claimText: string,
  evidenceText: string,
  alignments: ExactAtomicAlignment[],
  atom: GeneralPageAtomicProposition,
  attribution: GeneralPageClaimAttribution,
  claimParts: Array<{ key: "source" | "relation" | "s" | "p" | "o"; start: number; end: number }>,
  options?: {
    allowReportBridge?: boolean;
    sourceQuote?: string;
    failOnCompetingFrame?: boolean;
  },
): boolean {
  const signatures = new Set<string>();
  let sawCompetingFrame = false;
  const claimOrder = claimParts.map((part) => part.key).join(":");
  for (const alignment of alignments) {
    for (const sourceStart of allExactOccurrences(evidenceText, attribution.source)) {
      for (const relationStart of allExactOccurrences(evidenceText, attribution.relation)) {
        const sourceEnd = sourceStart + attribution.source.length;
        const relationEnd = relationStart + attribution.relation.length;
        const parts = [
          { key: "source" as const, start: sourceStart, end: sourceEnd },
          { key: "relation" as const, start: relationStart, end: relationEnd },
          { key: "s" as const, start: alignment.start, end: alignment.start + atom.s.length },
          { key: "p" as const, start: alignment.predicateStart, end: alignment.predicateStart + atom.p.length },
          { key: "o" as const, start: alignment.objectStart, end: alignment.end },
        ].sort((left, right) => left.start - right.start);
        if (parts.map((part) => part.key).join(":") !== claimOrder) continue;
        if (parts.some((part, index) => index > 0 && part.start < parts[index - 1].end)) continue;
        const start = parts[0].start;
        const end = parts[parts.length - 1].end;
        if (end - start > 320 || SENTENCE_BOUNDARY_IN_GAP_RE.test(evidenceText.slice(start, end))) continue;
        const gaps = parts.slice(1).map((part, index) => ({
          previous: parts[index],
          next: part,
          claim: claimParts[index + 1].start >= claimParts[index].end
            ? claimText.slice(claimParts[index].end, claimParts[index + 1].start)
            : "",
          evidence: evidenceText.slice(parts[index].end, part.start),
        }));
        const quoteOccurrence = options?.sourceQuote
          ? allExactOccurrences(evidenceText, options.sourceQuote).find((position) =>
            alignment.start >= position && alignment.end <= position + options.sourceQuote!.length)
          : undefined;
        const gapsAlign = gaps.every((gap) => {
          if (gap.previous.key === "s" && gap.next.key === "p") {
            return atomicGapsSafelyAlign(gap.claim, gap.evidence, true);
          }
          if (gap.previous.key === "p" && gap.next.key === "o") {
            return atomicGapsSafelyAlign(gap.claim, gap.evidence, false);
          }
          if (atomicGapIsUnsafe(gap.claim) || atomicGapIsUnsafe(gap.evidence)) return false;
          if (normalizedAtomicGap(gap.claim) === normalizedAtomicGap(gap.evidence)) return true;
          if (options?.allowReportBridge &&
            attribution.relation === "數據顯示" && attribution.modality === "report" &&
            gap.previous.key === "source" && gap.next.key === "relation" &&
            normalizedAtomicGap(gap.claim) === "" &&
            SAFE_ATTRIBUTION_BRIDGE_RE.test(normalizedAtomicGap(gap.evidence))) {
            return true;
          }
          if (options?.allowReportBridge && quoteOccurrence !== undefined &&
            gap.previous.key === "relation" && gap.next.key === "s" &&
            trimmedOuterRegion(gap.claim) === "") {
            const quotePrefix = trimmedOuterRegion(
              evidenceText.slice(quoteOccurrence, alignment.start),
            );
            return SAFE_SOURCE_QUOTE_PREFIX_RE.test(quotePrefix) &&
              trimmedOuterRegion(gap.evidence) === quotePrefix;
          }
          // A suffix "according to SOURCE" may scope an additional coordinated
          // fact in the exact quote. Keep a closed coordination grammar and
          // reject contrast, correction, retraction, or another reporting frame.
          return gap.previous.key === "o" && gap.next.key === "relation" &&
            /^according to$/iu.test(attribution.relation) &&
            SAFE_ACCORDING_TO_SUFFIX_RE.test(gap.evidence) &&
            !UNSAFE_ATTRIBUTION_SUFFIX_RE.test(gap.evidence) &&
            !ATTRIBUTION_RELATION_RE.test(trimmedOuterRegion(gap.evidence));
        });
        if (!gapsAlign) {
          if (options?.failOnCompetingFrame) sawCompetingFrame = true;
          continue;
        }
        signatures.add(JSON.stringify(parts.map((part, index) => [
          part.key,
          index === 0 ? "" : normalizedAtomicGap(evidenceText.slice(parts[index - 1].end, part.start)),
        ])));
      }
    }
  }
  return signatures.size === 1 && !sawCompetingFrame;
}

function inferUniqueGroundedAttribution(
  claim: GeneralPageBriefClaim,
  groundingText: string,
): GeneralPageClaimAttribution | undefined {
  const atom = claim.atom;
  if (!atom) return undefined;
  const coordinates = exactAtomicCoordinates(claim.c, atom);
  if (!coordinates) return undefined;
  const regions = [
    { text: claim.c.slice(0, coordinates.start), offset: 0 },
    { text: claim.c.slice(coordinates.end), offset: coordinates.end },
  ];
  const candidates: Array<{
    attribution: GeneralPageClaimAttribution;
    sourceStart: number;
    relationStart: number;
  }> = [];

  for (const region of regions) {
    const clean = trimmedOuterRegion(region.text);
    if (!clean) continue;
    const cleanOffset = region.text.indexOf(clean);
    for (const mapping of DETERMINISTIC_ATTRIBUTION_RELATIONS) {
      mapping.relation.lastIndex = 0;
      for (let match = mapping.relation.exec(clean); match; match = mapping.relation.exec(clean)) {
        const relation = match[0];
        const before = trimmedOuterRegion(clean.slice(0, match.index));
        const after = trimmedOuterRegion(clean.slice(match.index + relation.length));
        const source = /^according to$/iu.test(relation)
          ? (!before && after ? after : undefined)
          : before && !after
          ? before
          : !before && after
          ? after
          : before && after && SAFE_TRAILING_ATTRIBUTION_PREFIX_RE.test(before)
          ? after
          : undefined;
        if (!source || source.length > 100 || normalizedMatchText(source).length < 2 ||
          GENERIC_ATTRIBUTION_SOURCE_RE.test(source) || hasInvestigationArtifact(source) ||
          /[，,；;。.!?]/u.test(source) || ATTRIBUTION_RELATION_RE.test(source)) continue;
        const relationStart = region.offset + cleanOffset + match.index;
        const sourceStartInClean = clean.indexOf(source);
        if (sourceStartInClean < 0) continue;
        candidates.push({
          attribution: { source, relation, modality: mapping.modality },
          sourceStart: region.offset + cleanOffset + sourceStartInClean,
          relationStart,
        });
      }
    }
  }

  const unique = candidates.filter((candidate, index) => candidates.findIndex((other) =>
    other.sourceStart === candidate.sourceStart &&
    other.relationStart === candidate.relationStart &&
    other.attribution.modality === candidate.attribution.modality) === index);
  if (unique.length !== 1) return undefined;
  const candidate = unique[0];
  const claimParts = [
    { key: "source" as const, start: candidate.sourceStart, end: candidate.sourceStart + candidate.attribution.source.length },
    { key: "relation" as const, start: candidate.relationStart, end: candidate.relationStart + candidate.attribution.relation.length },
    { key: "s" as const, start: coordinates.start, end: coordinates.start + atom.s.length },
    { key: "p" as const, start: coordinates.predicateStart, end: coordinates.predicateStart + atom.p.length },
    { key: "o" as const, start: coordinates.objectStart, end: coordinates.end },
  ].sort((left, right) => left.start - right.start);
  const primaryWitness = resolveExactAtomicGroundingWitness(claim, groundingText);
  if (primaryWitness && attributionUsesAtomicAlignment(
    claim.c,
    primaryWitness.evidenceText,
    primaryWitness.alignments,
    atom,
    candidate.attribution,
    claimParts,
  )) return candidate.attribution;

  const exactQuote = claim.sourceQuote
    ? resolveSourceQuote(claim.sourceQuote, groundingText)
    : undefined;
  if (!exactQuote || containsAtomicPart(exactQuote, candidate.attribution.source) ||
    containsAtomicPart(exactQuote, candidate.attribution.relation) ||
    candidate.attribution.relation !== "數據顯示" || candidate.attribution.modality !== "report") {
    return undefined;
  }
  const sourceRelationGap = claim.c.slice(
    candidate.sourceStart + candidate.attribution.source.length,
    candidate.relationStart,
  );
  if (normalizedAtomicGap(sourceRelationGap) !== "") return undefined;
  const fullWitness = resolveExactAtomicGroundingWitness({ ...claim, sourceQuote: undefined }, groundingText);
  return fullWitness && attributionUsesAtomicAlignment(
    claim.c,
    fullWitness.evidenceText,
    fullWitness.alignments,
    atom,
    candidate.attribution,
    claimParts,
    {
      allowReportBridge: true,
      sourceQuote: exactQuote,
      failOnCompetingFrame: true,
    },
  ) ? candidate.attribution : undefined;
}

function typedAttributionHasGroundedWitness(
  claim: GeneralPageBriefClaim,
  groundingText: string,
): boolean {
  const attribution = claim.attribution;
  if (!attribution) return false;
  if (attribution.modality === "statement" && /^announced by$/iu.test(attribution.relation.trim())) {
    const atom = claim.atom;
    const evidenceText = claim.sourceQuote
      ? resolveSourceQuote(claim.sourceQuote, groundingText)
      : undefined;
    const alignment = atom && evidenceText ? exactAtomicCoordinates(evidenceText, atom) : undefined;
    const relationStart = alignment ? evidenceText!.indexOf(attribution.relation, alignment.end) : -1;
    const sourceStart = relationStart >= 0
      ? evidenceText!.indexOf(attribution.source, relationStart + attribution.relation.length)
      : -1;
    const frame = sourceStart >= 0 ? evidenceText!.slice(alignment!.end, sourceStart + attribution.source.length) : "";
    if (alignment && relationStart >= alignment.end && sourceStart >= relationStart + attribution.relation.length &&
      frame.length <= 180 && !SENTENCE_BOUNDARY_IN_GAP_RE.test(frame) && !UNSAFE_ATTRIBUTION_SUFFIX_RE.test(frame)) {
      return true;
    }
  }
  const grounded = inferUniqueGroundedAttribution(
    { ...claim, attribution: undefined },
    groundingText,
  );
  return Boolean(grounded) && grounded!.modality === attribution.modality &&
    normalizedMatchText(grounded!.source) === normalizedMatchText(attribution.source) &&
    normalizedMatchText(grounded!.relation) === normalizedMatchText(attribution.relation);
}

function projectExactAtomicClaim(
  claim: GeneralPageBriefClaim,
  groundingText: string,
): GeneralPageBriefClaim | undefined {
  const atom = claim.atom;
  if (!atom || outerAttribution(claim.c, atom) || NON_RELATIONAL_PREDICATE_RE.test(atom.p.trim())) {
    return undefined;
  }
  const coordinates = exactAtomicCoordinates(claim.c, atom);
  if (!coordinates || !hasOneProposition(coordinates.span)) return undefined;
  const prefix = claim.c.slice(0, coordinates.start);
  const suffix = claim.c.slice(coordinates.end);
  if (!/^[\s「『“‘"']*$/u.test(prefix)) return undefined;
  const suffixWithoutTerminal = suffix.replace(/[。！？.!?][」』”’"']?\s*$/u, "").trim();
  if (!suffixWithoutTerminal || !/^(?:[，,；;:]|(?:and|while|as)\b|並且|並|且|以及|同時)/iu.test(suffixWithoutTerminal)) {
    return undefined;
  }
  let removedText = `${prefix} ${suffixWithoutTerminal}`;
  if (claim.attribution) {
    const relationStart = claim.c.indexOf(claim.attribution.relation, coordinates.end);
    const sourceStart = claim.c.indexOf(claim.attribution.source, coordinates.end);
    const detachableTrailingAnnouncement = claim.attribution.modality === "statement" &&
      /^announced by$/iu.test(claim.attribution.relation.trim()) &&
      relationStart >= coordinates.end &&
      sourceStart >= relationStart + claim.attribution.relation.length;
    if (!detachableTrailingAnnouncement) return undefined;
    removedText = removedText
      .replace(claim.attribution.relation, " ")
      .replace(claim.attribution.source, " ");
  }
  if (PROJECTION_CRITICAL_TEXT_RE.test(removedText) || ATTRIBUTION_RELATION_RE.test(removedText) ||
    legalStatuses(removedText).size > 0) return undefined;
  const originalStatuses = legalStatuses(claim.c);
  const projectedStatuses = legalStatuses(coordinates.span);
  if (originalStatuses.size !== projectedStatuses.size ||
    [...originalStatuses].some((status) => !projectedStatuses.has(status))) return undefined;
  if (!groundingText.includes(coordinates.span)) return undefined;
  if (claim.sourceQuote && !exactAtomicGroundingWitness(claim, groundingText)) return undefined;
  const punctuation = claim.c.trim().match(/[。！？.!?][」』”’"']?$/u)?.[0] ??
    (/\p{Script=Han}/u.test(coordinates.span) ? "。" : ".");
  const { attribution: _detachedAttribution, ...atomicClaim } = claim;
  return { ...atomicClaim, c: `${coordinates.span}${punctuation}` };
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

function usableDisplayQuestion(
  value: string | undefined,
  exactClaim: GeneralPageBriefClaim,
): string | undefined {
  if (hasInvestigationArtifact(value)) return undefined;
  const raw = (value ?? "").trim();
  if (!/[？?][」』”’\"']?$/.test(raw)) return undefined;
  if ((raw.match(/[？?]/g) ?? []).length > 1) return undefined;
  let cleaned = cleanInvestigationText(raw, 219);
  if (!cleaned || cleaned.length < 5 || VAGUE_ONLY_RE.test(cleaned)) return undefined;
  // A trailing source frame such as "announced by PERSON" must not turn into
  // a new action by the atomic subject when localized. Keep this deliberately
  // narrow: the only supported repair removes the translated announcement verb
  // immediately after a Chinese yes/no marker.
  if (exactClaim.attribution?.modality === "statement" &&
    /^announced by$/iu.test(exactClaim.attribution.relation.trim()) &&
    !/\bannounce(?:d|s|ing)?\b/iu.test(exactClaim.atom?.p ?? "") &&
    /\p{Script=Han}/u.test(cleaned)) {
    cleaned = cleaned
      .replace(/(是否)(?:已)?(?:宣布|宣告|公告)(?=(?:將|會|要|為|向|提供))/u, "$1")
      .replace(/[，,]\s*(?:該|此)(?:項)?(?:計劃|計畫|方案|措施).{0,48}(?:宣布|宣告|公告)$/u, "");
  }
  const question = `${cleaned}${raw.includes("？") ? "？" : "?"}`;
  const claimAnchors = numericAndDateAnchorSet(exactClaim.c);
  const displayAnchors = numericAndDateAnchorSet(question);
  if ([...displayAnchors].some((anchor) => !claimAnchors.has(anchor))) return undefined;
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
  if (LOW_CONSEQUENCE_ROUTINE_EVENT_RE.test(claim.c)) {
    return { ok: false, reason: "low_consequence_routine_event" };
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
  if (groundingText && (!exactAtomicGroundingWitness(claim, groundingText) ||
    (claim.sourceQuote ? hasInvestigationArtifact(claim.sourceQuote) : false))) {
    return { ok: false, reason: "ungrounded_atom" };
  }
  const inferredAttribution = outerAttribution(claim.c, atom);
  if (inferredAttribution && !claim.attribution) return { ok: false, reason: "missing_attribution" };
  if (claim.attribution && (!inferredAttribution ||
    !validTypedAttribution(claim.c, atom, claim.attribution) ||
    (groundingText && !typedAttributionHasGroundedWitness(claim, groundingText)))) {
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
    ]);
  }
  return joinKeywordSegments([
    boundedKeywordSegment(claim.attribution
      ? claim.attribution.source
      : undefined, 35),
    boundedKeywordSegment(claim.atom.s, 40),
    boundedKeywordSegment(claim.atom.p, 40),
    boundedKeywordSegment(claim.atom.o, 55),
    boundedKeywordSegment(claimNumberAndDateAnchors(intent.exactClaim), 25),
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
  if (/\p{Script=Han}/u.test(intent.displayQuestion)) {
    return [
      "請查核以下主張，並以繁體中文回答。",
      `查核問題：${intent.displayQuestion}`,
      `原文主張：\"${intent.exactClaim}\"`,
      `需要的證據：${terminate(intent.evidenceNeed, "。")}`,
      sourceContext ? `頁面來源脈絡：${terminate(sourceContext, "。")}` : "",
      sourceUrl ? `來源網址（metadata）：${sourceUrl}` : "",
      "請優先引用能直接回答問題的原始或權威來源，標明來源與日期，並區分已證實、尚不確定與推論。",
    ].filter(Boolean).join(" ").slice(0, 960);
  }
  return [
    "Please verify the following claim and answer in English.",
    `Verification question: ${intent.displayQuestion}`,
    `Original-language claim: \"${intent.exactClaim}\"`,
    `Evidence needed: ${terminate(intent.evidenceNeed, ".")}`,
    sourceContext ? `Page source context: ${terminate(sourceContext, ".")}` : "",
    sourceUrl ? `Source URL (metadata): ${sourceUrl}` : "",
    "Prioritize primary or authoritative sources that directly answer the question, cite the source and date, and distinguish verified facts, uncertainty, and inference.",
  ].filter(Boolean).join(" ").slice(0, 960);
}

function buildPreparedPageClaimInvestigationTask(
  input: PageClaimInvestigationPreparationInput,
  preparedClaim: GeneralPageBriefClaim,
): PageClaimInvestigationTask | undefined {
  const claim = cleanInvestigationText(preparedClaim.c, 160);
  const why = cleanInvestigationText(preparedClaim.why, 120);
  const evidenceNeed = cleanInvestigationText(preparedClaim.need, 100);
  const atom = usableAtomicProposition(preparedClaim);
  if (!atom) return undefined;
  const inferredAttribution = outerAttribution(preparedClaim.c, atom);
  const question = usableClaimQuestion(
    preparedClaim.q,
    atom,
    claim,
    inferredAttribution ? preparedClaim.attribution : undefined,
  ) ??
    deterministicClaimQuestion(preparedClaim);
  if (!input.analysisKey || !claim || !evidenceNeed || !question) return undefined;
  const displayQuestion = usableDisplayQuestion(preparedClaim.displayQ, preparedClaim) ?? question;
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
    displayQuestion,
    ...(Object.keys(sourceContext).length > 0 ? { sourceContext } : {}),
  };
  return {
    version: 4,
    id: `${input.scope}:${input.analysisKey}:${input.claimIndex}`,
    analysisKey: input.analysisKey,
    scope: input.scope,
    claimIndex: input.claimIndex,
    intent,
    googleKeywords: buildGoogleSearchKeywords(intent, preparedClaim),
    aiModePrompt: buildGoogleAiModePrompt(intent),
    ...(cleanSourceMetadataUrl(input.source?.url) ? { sourceUrl: cleanSourceMetadataUrl(input.source?.url) } : {}),
  };
}

export function preparePageClaimInvestigation(
  input: PageClaimInvestigationPreparationInput,
): PageClaimInvestigationPreparation {
  const canonicalizations: PageClaimInvestigationCanonicalization[] = [];
  if (!input.groundingText?.trim()) {
    return { decision: "rejected", reason: "invalid_structure", canonicalizations };
  }

  let claim: GeneralPageBriefClaim = input.claim;
  let eligibility = pageClaimInvestigationEligibility(claim, input.groundingText);
  if (!eligibility.ok && (eligibility.reason === "missing_attribution" || eligibility.reason === "invalid_attribution")) {
    const attribution = inferUniqueGroundedAttribution(claim, input.groundingText);
    if (attribution) {
      claim = { ...claim, attribution };
      canonicalizations.push("infer_typed_attribution");
      eligibility = pageClaimInvestigationEligibility(claim, input.groundingText);
    }
  }

  if (!eligibility.ok && (eligibility.reason === "compound_claim" || eligibility.reason === "invalid_attribution")) {
    const projected = projectExactAtomicClaim(claim, input.groundingText);
    if (projected) {
      claim = projected;
      canonicalizations.push("project_exact_atomic_span");
      eligibility = pageClaimInvestigationEligibility(claim, input.groundingText);
    }
  }

  if (!eligibility.ok) {
    return { decision: "rejected", reason: eligibility.reason, canonicalizations };
  }
  const task = buildPreparedPageClaimInvestigationTask(input, claim);
  if (!task) return { decision: "rejected", reason: "invalid_question", canonicalizations };
  return { decision: "prepared", claim, task, canonicalizations };
}

export function buildPageClaimInvestigationTask(
  input: PageClaimInvestigationPreparationInput,
): PageClaimInvestigationTask | undefined {
  if (!input.groundingText?.trim()) return undefined;
  const eligibility = pageClaimInvestigationEligibility(input.claim, input.groundingText);
  if (!eligibility.ok) return undefined;
  return buildPreparedPageClaimInvestigationTask(input, input.claim);
}
