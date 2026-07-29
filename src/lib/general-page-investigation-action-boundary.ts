import type { GeneralPageInvestigationSourceMetadata } from "./general-page-investigation-adapter";
import type { MaterializedGeneralPageInvestigationSpanSelection } from "./general-page-investigation-span-adapter";

export type GeneralPageInvestigationLocalRejectionReason =
  | "unavailable_source"
  | "satire_source"
  | "unresolved_reference"
  | "non_publicly_decidable"
  | "page_or_documentation_residue";

export interface GeneralPageInvestigationSelectionBoundaryContext {
  authorizedSourceContext?: string;
  source?: GeneralPageInvestigationSourceMetadata;
}

const KNOWN_SATIRE_HOSTS = new Set([
  "babylonbee.com",
  "newsthump.com",
  "thehardtimes.net",
  "theonion.com",
  "theshovel.com.au",
  "waterfordwhispersnews.com",
]);
const KNOWN_FICTION_READER_HOSTS = new Set([
  "standardebooks.org",
]);
const EXPLICIT_SATIRE_LABEL =
  /(?:\b(?:satire|satirical|parody)\b|(?:諷刺|讽刺|惡搞|恶搞)(?:新聞|新闻|媒體|媒体)?)/iu;
const UNAVAILABLE_TITLE =
  /^(?:404\b|page (?:not found|unavailable)\b|not found\b|找不到(?:此|這個|这个)?頁面|找不到網頁|頁面(?:不存在|無法使用)|页面(?:不存在|无法使用))/iu;
const UNRESOLVED_REFERENCE =
  /^(?:(?:(?:if|when)\s+)?(?:it|this|that|these|those)\b|both\s+(?:leaders?|sides?|parties?|companies?|countries?|teams?|officials?|candidates?|figures?|groups?|people|men|women)\b)|\bas described above\b/iu;
const UNRESOLVED_NAMED_MEMBER =
  /\b(?:this|that|these|those)\s+(?:method|property|field|feature|function|protocol|condition)\b/iu;
const VAGUE_PUBLIC_ATTRIBUTION =
  /\bmany(?:\s+people)?\s+(?:believe|think|say|feel)\b/iu;
const PAGE_META_DESCRIPTION =
  /^(?:today(?:'s|’s)?(?:\s+(?:article|newsletter|edition))?\s+(?:is\s+)?about\b|today,?\s+(?:[\p{L}'’.-]+\s+){1,4}(?:writes?|reports?|explores?|discusses?)\s+about\b|we\s+(?:came|went|visited|are here)\b.{0,80}\b(?:to\s+)?(?:see|learn|find|report)\b)/iu;
const PAGE_OR_DOCUMENTATION_RESIDUE =
  /^(?:supported by|sponsored by|presented by|advertisement|documentation\s+overview|overview\s+package|variables?\s+this section is empty)\b|(?:\bexample output:|\bfunc(?:\s+added\s+in\s+go\d+(?:\.\d+)*)?\s+func\b)|(?:^[A-Za-z_$][\w$]*\s*=\s*.+\/\/)|(?:\bthe (?:type|method|function|field|property|class|interface|package|module)\s*$)/iu;
const CONFLICT_DISCLOSURE =
  /\breports?\s+(?:grants?\s+or\s+contracts?|payments?\s+of\s+honoraria|other\s+financial\s+interests?)\b[\s\S]{0,240}\boutside\s+the\s+submitted\s+work\b/iu;
const FLATTENED_DOCUMENTATION_LABEL =
  /^(?:(?:parameters?|returns?|usage|examples?)\b|(?:參數|参数|回傳|返回|用法|範例|示例)).{0,100}[:：]/iu;
const UNSUBJECTED_API_DESCRIPTION =
  /^(?:returns?|takes?|creates?|provides?|specifies?|indicates?)\s+(?:an?|the)\b/iu;
const UNRESOLVED_GROUP_REFERENCE =
  /^(?:(?:one|another|other)\s+(?:objectives?|goals?|proposals?|recommendations?)\b|(?:目標|目标|目的)(?:之一|一|二|三)|(?:另一|其他)(?:項)?(?:目標|目标|目的|提案|建議|建议))/iu;
const NORMATIVE_VALUE_JUDGMENT =
  /\b(?:is|are|was|were)\s+essential\s+to\s+(?:ensure|ensuring|support|supporting|help|helping)\b|(?:對|对).{0,80}(?:至關重要|至关重要|不可或缺)/iu;
const CHAPTER_TITLE =
  /(?:\bchapter\s+[\dIVXLCDM]+\b|[-–—]\s*[\dIVXLCDM]+)\s*$/iu;
const CHAPTER_PATH = /\/(?:chapter|chapitre|capitulo|capítulo)[-_/]?\d+(?:[/?#]|$)/iu;
const CHAPTER_LEAD = /^(?:chapter\s+)?[\dIVXLCDM]+\s+\p{Lu}[\p{L}'’.-]+\b/u;
const FICTION_REVIEW_TITLE = /\breview\b/iu;
const FICTION_REVIEW_NARRATIVE_CUE =
  /\bfans?\s+(?:know|remember)(?:\s+that)?\b/iu;

function hasDuplicatedLeadingToken(text: string): boolean {
  const [first = "", second = ""] = text.split(/\s+/u, 2);
  const normalize = (token: string) =>
    token.replace(/^[^\p{L}\p{N}_$]+|[^\p{L}\p{N}_$]+$/gu, "").toLowerCase();
  const normalizedFirst = normalize(first);
  return normalizedFirst.length >= 3 && normalizedFirst === normalize(second);
}

function sourceHostname(source?: GeneralPageInvestigationSourceMetadata): string | undefined {
  try {
    const hostname = source?.url ? new URL(source.url).hostname.toLowerCase() : "";
    return hostname.replace(/^www\./u, "") || undefined;
  } catch {
    return undefined;
  }
}

function isCitedPaperTitle(
  selection: MaterializedGeneralPageInvestigationSpanSelection,
  authorizedSourceContext?: string,
): boolean {
  if (!authorizedSourceContext ||
      authorizedSourceContext.slice(selection.start, selection.end) !== selection.exactClaim) {
    return false;
  }
  const before = authorizedSourceContext.slice(
    Math.max(0, selection.start - 220),
    selection.start,
  );
  const after = authorizedSourceContext.slice(
    selection.end,
    Math.min(authorizedSourceContext.length, selection.end + 160),
  );
  return /(?:this is a summary of|references?|本文摘要自|參考文獻|参考文献)[\s\S]{0,180}(?:\bet al\.?|等人[。.])\s*$/iu
    .test(before) && /(?:doi(?:\.org\/|:\s*10\.)|https?:\/\/doi\.org\/)/iu.test(after);
}

function isChapterLeadNarrative(
  text: string,
  source?: GeneralPageInvestigationSourceMetadata,
): boolean {
  const title = source?.title?.replace(/\s+/gu, " ").trim() ?? "";
  let path = "";
  try {
    path = source?.url ? new URL(source.url).pathname : "";
  } catch {
    // Invalid metadata is ignored by this narrow optional boundary.
  }
  return CHAPTER_LEAD.test(text) &&
    (CHAPTER_TITLE.test(title) || CHAPTER_PATH.test(path));
}

/**
 * Rejects only obvious source-level states that cannot yield a truthful
 * reader-facing verification action. It does not score utility or truth.
 */
export function generalPageInvestigationSourceRejectionReason(
  source?: GeneralPageInvestigationSourceMetadata,
): GeneralPageInvestigationLocalRejectionReason | undefined {
  const title = source?.title?.replace(/\s+/gu, " ").trim() ?? "";
  if (UNAVAILABLE_TITLE.test(title)) return "unavailable_source";
  const hostname = sourceHostname(source);
  if ((hostname && KNOWN_SATIRE_HOSTS.has(hostname)) ||
      EXPLICIT_SATIRE_LABEL.test(source?.sourceName ?? "")) {
    return "satire_source";
  }
  if (hostname && KNOWN_FICTION_READER_HOSTS.has(hostname) &&
      CHAPTER_PATH.test(source?.url ?? "")) {
    return "non_publicly_decidable";
  }
  return undefined;
}

/**
 * Final deterministic boundary for defects that remain invalid regardless of
 * ranking. The model still owns all non-obvious semantic admission decisions.
 */
export function generalPageInvestigationSelectionRejectionReason(
  selection: MaterializedGeneralPageInvestigationSpanSelection,
  context: GeneralPageInvestigationSelectionBoundaryContext = {},
): GeneralPageInvestigationLocalRejectionReason | undefined {
  const text = selection.exactClaim.replace(/\s+/gu, " ").trim();
  if (UNRESOLVED_REFERENCE.test(text) ||
      UNRESOLVED_NAMED_MEMBER.test(text) ||
      UNRESOLVED_GROUP_REFERENCE.test(text) ||
      VAGUE_PUBLIC_ATTRIBUTION.test(text)) {
    return "unresolved_reference";
  }
  if (NORMATIVE_VALUE_JUDGMENT.test(text) ||
      (
        FICTION_REVIEW_TITLE.test(context.source?.title ?? "") &&
        FICTION_REVIEW_NARRATIVE_CUE.test(text)
      ) ||
      isChapterLeadNarrative(text, context.source)) {
    return "non_publicly_decidable";
  }
  if (hasDuplicatedLeadingToken(text) ||
      FLATTENED_DOCUMENTATION_LABEL.test(text) ||
      UNSUBJECTED_API_DESCRIPTION.test(text) ||
      CONFLICT_DISCLOSURE.test(text) ||
      isCitedPaperTitle(selection, context.authorizedSourceContext) ||
      PAGE_META_DESCRIPTION.test(text) ||
      PAGE_OR_DOCUMENTATION_RESIDUE.test(text)) {
    return "page_or_documentation_residue";
  }
  return undefined;
}
