import type { InvestigationPlanAbstentionReason } from "./claim-investigation-planner";
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
const LIST_MARKER = /^(?:(?:[-*•●▪◦‣]|\d{1,2}[.)、]|[（(]\d{1,2}[）)])\s*)+/u;

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

function lineRanges(source: string): Array<{ start: number; end: number }> {
  if (!/[\r\n]/u.test(source)) return [];
  const ranges: Array<{ start: number; end: number }> = [];
  let lineStart = 0;
  for (let cursor = 0; cursor <= source.length; cursor += 1) {
    if (cursor < source.length && source[cursor] !== "\n" && source[cursor] !== "\r") continue;
    const trimmed = trimmedRange(source, lineStart, cursor);
    if (trimmed) {
      const text = source.slice(trimmed.start, trimmed.end);
      const marker = text.match(LIST_MARKER);
      const start = marker ? trimmed.start + marker[0].length : trimmed.start;
      const lineText = source.slice(start, trimmed.end);
      const sentences = sentenceRanges(lineText);
      if (sentences.length > 0) {
        for (const sentence of sentences) {
          ranges.push({ start: start + sentence.start, end: start + sentence.end });
        }
      } else {
        let end = trimmed.end;
        while (end > start && /[。！？!?.]/u.test(source[end - 1])) end -= 1;
        const withoutMarker = trimmedRange(source, start, end);
        if (withoutMarker) ranges.push(withoutMarker);
      }
    }
    if (cursor < source.length && source[cursor] === "\r" && source[cursor + 1] === "\n") cursor += 1;
    lineStart = cursor + 1;
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
  for (const rawSentence of sentenceRanges(source)) {
    if (/[\r\n]/u.test(source.slice(rawSentence.start, rawSentence.end))) continue;
    let sentence = rawSentence;
    const sentenceText = source.slice(sentence.start, sentence.end);
    const marker = sentenceText.match(LIST_MARKER);
    if (marker) sentence = { start: sentence.start + marker[0].length, end: sentence.end };
    const exact = source.slice(sentence.start, sentence.end);
    if ([...exact].length >= minimum && [...exact].length <= options.maxCharacters &&
      isContextIndependentSpan(exact)) ranges.push(sentence);
  }
  // Social posts often use line breaks instead of sentence punctuation. Offer each
  // exact list line as an additional candidate while preserving source offsets.
  for (const line of lineRanges(source)) {
    const exact = source.slice(line.start, line.end);
    if ([...exact].length >= minimum && [...exact].length <= options.maxCharacters &&
      isContextIndependentSpan(exact)) ranges.push(line);
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
