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

function trimmedRange(source: string, start: number, end: number): { start: number; end: number } | undefined {
  while (start < end && /\s/u.test(source[start])) start += 1;
  while (end > start && /\s/u.test(source[end - 1])) end -= 1;
  return end > start ? { start, end } : undefined;
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
  let sentenceStart = 0;
  for (let index = 0; index <= source.length; index += 1) {
    const boundary = index === source.length || /[。！？!?\n]/u.test(source[index]);
    if (!boundary) continue;
    const sentence = trimmedRange(source, sentenceStart, index);
    if (sentence) {
      const exact = source.slice(sentence.start, sentence.end);
      if ([...exact].length >= minimum && [...exact].length <= options.maxCharacters && !detectCompoundPropositionSignal(exact)) ranges.push(sentence);
      let clauseStart = sentence.start;
      for (let cursor = sentence.start; cursor <= sentence.end; cursor += 1) {
        if (cursor < sentence.end && !/[，,；;]/u.test(source[cursor])) continue;
        const clause = trimmedRange(source, clauseStart, cursor);
        if (clause) {
          const clauseText = source.slice(clause.start, clause.end);
          if ([...clauseText].length >= minimum && [...clauseText].length <= options.maxCharacters && !detectCompoundPropositionSignal(clauseText)) ranges.push(clause);
        }
        clauseStart = cursor + 1;
      }
    }
    sentenceStart = index + 1;
  }
  const seen = new Set<string>();
  const unique = ranges.sort((left, right) => left.start - right.start || left.end - right.end).filter((range) => {
    const key = source.slice(range.start, range.end).normalize("NFKC").replace(/\s+/gu, " ").trim();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, options.maxCandidates);
  return unique.map((range, index) => ({
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
