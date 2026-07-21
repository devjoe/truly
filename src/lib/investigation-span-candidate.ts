import { detectCompoundPropositionSignal, type InvestigationPlanAbstentionReason } from "./claim-investigation-planner";
import type { Lang } from "./types";

export interface InvestigationSpanCandidate {
  id: `span:${number}`;
  exactText: string;
  start: number;
  end: number;
}

export interface InvestigationSpanSelection {
  eligible: boolean;
  candidateId: string | null;
  abstentionReason: InvestigationPlanAbstentionReason | null;
}

const ABSTENTION_REASONS: InvestigationPlanAbstentionReason[] = [
  "no_checkworthy_claim", "missing_specifics", "opinion_or_prediction",
  "low_consequence", "not_grounded", "unsafe_to_plan",
];

const DEPENDENT_ZH_START = /^(?:並|且|而|但|又|也|因此|所以|業者|該(?:公司|產品|計畫|政策|案件|命令|公告)|此(?:事|案|產品|計畫|政策|命令|公告)|前述|上述|退款作業|召回原因)/u;
const DEPENDENT_EN_START = /^(?:and|but|or|also|then|however|therefore|each|it|they|he|she|this|that|these|those|the company)\b/iu;
const DEPENDENT_EN_EVENT_REFERENCE = /\b(?:the|this|that) (?:recall|decision|announcement|program|plan|order|proposal)\b/iu;
const PROMPT_CONTROL_DIRECTIVE = /(?:\b(?:ignore|disregard|override)\b.{0,40}\b(?:previous|prior|system|developer)\b.{0,24}\b(?:instruction|message|prompt)s?\b|忽略.{0,16}(?:先前|之前|系統|開發者).{0,16}(?:指令|訊息|提示)|(?:system prompt|developer message|系統提示|開發者訊息))/iu;
const PRIVATE_DATA_DIRECTIVE = /(?:\b(?:find|reveal|publish|send|provide|give me|look up)\b.{0,48}\b(?:password|home address|private phone|social security number|personal data)\b|(?:找出|提供|揭露|公布|傳送).{0,32}(?:密碼|住址|私人電話|身分證|非公開個資))/iu;

function isContextIndependentSpan(text: string): boolean {
  const compact = text.replace(/\s+/gu, " ").trim();
  return !DEPENDENT_ZH_START.test(compact) &&
    !DEPENDENT_EN_START.test(compact) &&
    !DEPENDENT_EN_EVENT_REFERENCE.test(compact) &&
    !PROMPT_CONTROL_DIRECTIVE.test(compact) &&
    !PRIVATE_DATA_DIRECTIVE.test(compact);
}

function trimmedRange(source: string, start: number, end: number): { start: number; end: number } | undefined {
  while (start < end && /\s/u.test(source[start])) start += 1;
  while (end > start && /\s/u.test(source[end - 1])) end -= 1;
  return end > start ? { start, end } : undefined;
}

function sentenceRanges(source: string): Array<{ start: number; end: number }> {
  const ranges: Array<{ start: number; end: number }> = [];
  const segmenter = new Intl.Segmenter(undefined, { granularity: "sentence" });
  for (const part of segmenter.segment(source)) {
    const trimmed = trimmedRange(source, part.index, part.index + part.segment.length);
    if (!trimmed) continue;
    let end = trimmed.end;
    while (end > trimmed.start && /[。！？!?.]/u.test(source[end - 1])) end -= 1;
    const withoutTerminalPunctuation = trimmedRange(source, trimmed.start, end);
    if (withoutTerminalPunctuation) ranges.push(withoutTerminalPunctuation);
  }
  return ranges;
}

/** Exact local candidate enumeration; it selects no claim and adds no text. */
export function buildInvestigationSpanCandidates(
  source: string,
  options: { maxCandidates: number; maxCharacters: number; minCharacters?: number },
): InvestigationSpanCandidate[] {
  const minimum = options.minCharacters ?? 6;
  if (typeof source !== "string" || !Number.isInteger(options.maxCandidates) || options.maxCandidates < 1 || options.maxCandidates > 100 ||
    !Number.isInteger(options.maxCharacters) || options.maxCharacters < 20 || options.maxCharacters > 600 ||
    !Number.isInteger(minimum) || minimum < 3 || minimum > options.maxCharacters) throw new TypeError("invalid span candidate options");
  const ranges: Array<{ start: number; end: number }> = [];
  for (const sentence of sentenceRanges(source)) {
    const exact = source.slice(sentence.start, sentence.end);
    const compound = detectCompoundPropositionSignal(exact);
    const delimiters: Array<{ start: number; end: number }> = [];
    let hasEnglishCoordination = false;
    for (let cursor = sentence.start; cursor < sentence.end; cursor += 1) {
      if (/[，；;]/u.test(source[cursor])) delimiters.push({ start: cursor, end: cursor + 1 });
    }
    for (const match of exact.matchAll(/(?:,\s*|\s+)(?:and|but)\s+/giu)) {
      const left = exact.slice(0, match.index).trim();
      const right = exact.slice(match.index + match[0].length).trim();
      const leftHasPredicate = /\b(?:\p{L}+ed|said|says?|reports?|announces?|estimates?|orders?|closes?|recalls?|promises?|moves?|will|would|has|have|is|are|was|were)\b/iu.test(left);
      if ([...left].length >= minimum && [...right].length >= minimum && leftHasPredicate) {
        hasEnglishCoordination = true;
        delimiters.push({ start: sentence.start + match.index, end: sentence.start + match.index + match[0].length });
      }
    }
    if ([...exact].length >= minimum && [...exact].length <= options.maxCharacters &&
      !compound && !hasEnglishCoordination && isContextIndependentSpan(exact)) ranges.push(sentence);
    delimiters.sort((left, right) => left.start - right.start);
    let clauseStart = sentence.start;
    for (const delimiter of [...delimiters, { start: sentence.end, end: sentence.end }]) {
      const clause = trimmedRange(source, clauseStart, delimiter.start);
      if (clause) {
        const clauseText = source.slice(clause.start, clause.end);
        if ([...clauseText].length >= minimum && [...clauseText].length <= options.maxCharacters &&
          !detectCompoundPropositionSignal(clauseText) && isContextIndependentSpan(clauseText)) ranges.push(clause);
      }
      clauseStart = delimiter.end;
    }
  }
  const seen = new Set<string>();
  const unique = ranges.sort((left, right) => left.start - right.start || left.end - right.end).filter((range) => {
    const key = source.slice(range.start, range.end).normalize("NFKC").replace(/\s+/gu, " ").trim();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  const maximal = unique.filter((range, index) => !unique.some((other, otherIndex) =>
    index !== otherIndex && other.start <= range.start && other.end >= range.end &&
    (other.start < range.start || other.end > range.end)));
  return maximal.slice(0, options.maxCandidates).map((range, index) => ({
    id: `span:${index + 1}`,
    exactText: source.slice(range.start, range.end),
    start: range.start,
    end: range.end,
  }));
}

export function investigationSpanSelectionJsonSchema(candidateIds: string[]) {
  if (!Array.isArray(candidateIds) || candidateIds.length < 1 || candidateIds.length > 100 ||
    new Set(candidateIds).size !== candidateIds.length || candidateIds.some((id) => !/^span:\d+$/u.test(id))) throw new TypeError("invalid candidate IDs");
  return {
    type: "object",
    additionalProperties: false,
    required: ["eligible", "candidateId", "abstentionReason"],
    properties: {
      eligible: { type: "boolean" },
      candidateId: { enum: [...candidateIds, null] },
      abstentionReason: { enum: [...ABSTENTION_REASONS, null] },
    },
  } as const;
}

export function parseInvestigationSpanSelection(content: string, candidateIds: string[]): InvestigationSpanSelection | undefined {
  let parsed: unknown;
  try { parsed = JSON.parse(content); } catch { return undefined; }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return undefined;
  const value = parsed as Record<string, unknown>;
  if (typeof value.eligible !== "boolean") return undefined;
  if (value.eligible) {
    return typeof value.candidateId === "string" && candidateIds.includes(value.candidateId) && value.abstentionReason === null
      ? { eligible: true, candidateId: value.candidateId, abstentionReason: null }
      : undefined;
  }
  return value.candidateId === null && typeof value.abstentionReason === "string" && ABSTENTION_REASONS.includes(value.abstentionReason as InvestigationPlanAbstentionReason)
    ? { eligible: false, candidateId: null, abstentionReason: value.abstentionReason as InvestigationPlanAbstentionReason }
    : undefined;
}

export function investigationSpanSelectorSystemPrompt(lang: Lang): string {
  const responseLanguage = lang === "zh-TW" ? "Traditional Chinese (Taiwan)" : "English";
  return `Select at most one consequential, externally verifiable atomic claim from a fixed list of exact source spans.
Return only JSON. Write no explanation. Human-facing judgment is in ${responseLanguage}.
Choose only a supplied candidateId; never combine candidates or rewrite their text. The claim must affect health, safety, money, rights, law, or public interest and contain enough actor, event, product, number, place, or time detail for reliable public-evidence retrieval. Abstain from opinion, prediction, routine availability, vague controversy, or low-consequence trivia.`;
}

export function investigationSpanSelectorUserPrompt(source: string, candidates: InvestigationSpanCandidate[]): string {
  return `Choose one candidateId or abstain. Candidate exactText is copied from SOURCE_TEXT and must not be rewritten.\n\n<CANDIDATES>\n${JSON.stringify(candidates.map(({ id, exactText }) => ({ id, exactText })))}\n</CANDIDATES>\n\n<SOURCE_TEXT>\n${source}\n</SOURCE_TEXT>`;
}
