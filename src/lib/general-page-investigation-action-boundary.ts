import type { GeneralPageInvestigationSourceMetadata } from "./general-page-investigation-adapter";
import type { MaterializedGeneralPageInvestigationSpanSelection } from "./general-page-investigation-span-adapter";

export type GeneralPageInvestigationLocalRejectionReason =
  | "unavailable_source"
  | "satire_source"
  | "unresolved_reference"
  | "page_or_documentation_residue";

const KNOWN_SATIRE_HOSTS = new Set([
  "babylonbee.com",
  "newsthump.com",
  "theonion.com",
  "theshovel.com.au",
  "waterfordwhispersnews.com",
]);
const EXPLICIT_SATIRE_LABEL =
  /(?:\b(?:satire|satirical|parody)\b|(?:諷刺|讽刺|惡搞|恶搞)(?:新聞|新闻|媒體|媒体)?)/iu;
const UNAVAILABLE_TITLE =
  /^(?:404\b|page (?:not found|unavailable)\b|not found\b|找不到(?:此|這個|这个)?頁面|找不到網頁|頁面(?:不存在|無法使用)|页面(?:不存在|无法使用))/iu;
const UNRESOLVED_REFERENCE =
  /^(?:(?:(?:if|when)\s+)?(?:it|this|that|these|those)\b|both\s+(?:leaders?|sides?|parties?|companies?|countries?|teams?|officials?|candidates?|figures?|groups?|people|men|women)\b)|\bas described above\b/iu;
const PAGE_OR_DOCUMENTATION_RESIDUE =
  /^(?:supported by|sponsored by|presented by|advertisement|documentation\s+overview|overview\s+package|variables?\s+this section is empty)\b|(?:\bexample output:|\bfunc(?:\s+added\s+in\s+go\d+(?:\.\d+)*)?\s+func\b)|(?:^[A-Za-z_$][\w$]*\s*=\s*.+\/\/)|(?:\bthe (?:type|method|function|field|property|class|interface|package|module)\s*$)/iu;

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
  return undefined;
}

/**
 * Final deterministic boundary for defects that remain invalid regardless of
 * ranking. The model still owns all non-obvious semantic admission decisions.
 */
export function generalPageInvestigationSelectionRejectionReason(
  selection: MaterializedGeneralPageInvestigationSpanSelection,
): GeneralPageInvestigationLocalRejectionReason | undefined {
  const text = selection.exactClaim.replace(/\s+/gu, " ").trim();
  if (UNRESOLVED_REFERENCE.test(text)) return "unresolved_reference";
  if (hasDuplicatedLeadingToken(text) || PAGE_OR_DOCUMENTATION_RESIDUE.test(text)) {
    return "page_or_documentation_residue";
  }
  return undefined;
}
