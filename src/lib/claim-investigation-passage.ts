export interface ExactPassageSelectionInput {
  documentText: string;
  question: string;
  queryCandidates: string[];
  normalizedClaim: string;
  minimumScore?: number;
  allowTwoCharacterSignals?: boolean;
}

export interface ExactPassageSelection {
  exactExcerpt: string;
  score: number;
  matchedTerms: string[];
}

const LATIN_STOP_WORDS = new Set([
  "about", "after", "against", "also", "been", "between", "could", "does", "from",
  "have", "into", "more", "official", "that", "their", "this", "through", "what",
  "when", "where", "which", "will", "with", "would", "是否", "公開", "正式", "資料",
  "聲明", "指出", "相關", "內容", "幾項", "如何", "多少", "當時", "目前",
]);

function normalized(value: string): string {
  return value.normalize("NFKC").toLocaleLowerCase().replace(/\s+/gu, " ").trim();
}

function termsFrom(value: string): string[] {
  const clean = normalized(value);
  const terms = clean.match(/[a-z][a-z0-9._-]{2,}|\d+(?:[.,]\d+)*|[\p{Script=Han}]{2,}|[\p{Script=Hangul}]{2,}/gu) ?? [];
  const expanded = terms.flatMap((term) => {
    if (!/^[\p{Script=Han}]+$/u.test(term) || term.length <= 4) return [term];
    const windows: string[] = [];
    for (let index = 0; index < term.length - 1; index += 1) windows.push(term.slice(index, index + 2));
    return [term, ...windows];
  });
  return [...new Set(expanded.filter((term) => term.length >= 2 && !LATIN_STOP_WORDS.has(term)))];
}

function segmentsFrom(value: string): string[] {
  const paragraphs = value
    .replace(/\r\n?/gu, "\n")
    .split(/\n{2,}|(?<=[。！？.!?])\s+(?=[\p{L}\p{N}])/u)
    .map((segment) => segment.replace(/\s+/gu, " ").trim())
    .filter((segment) => segment.length >= 36);
  const segments: string[] = [];
  for (const paragraph of paragraphs) {
    if (paragraph.length <= 900) {
      segments.push(paragraph);
      continue;
    }
    const sentences = paragraph.split(/(?<=[。！？.!?])\s*/u).filter(Boolean);
    for (let index = 0; index < sentences.length; index += 1) {
      let window = sentences[index];
      for (let next = index + 1; next < sentences.length && window.length < 560; next += 1) {
        window = `${window} ${sentences[next]}`;
      }
      if (window.length >= 36) segments.push(window.slice(0, 900));
    }
  }
  return [...new Set(segments)];
}

/**
 * Development retrieval helper. It ranks fetched document passages only; it
 * never treats a search-result snippet as evidence or infers a verdict.
 */
export function selectExactInvestigationPassage(input: ExactPassageSelectionInput): ExactPassageSelection | undefined {
  const terms = termsFrom([
    input.normalizedClaim,
    input.question,
    ...input.queryCandidates,
  ].join(" "));
  if (terms.length === 0) return undefined;

  let best: ExactPassageSelection | undefined;
  for (const segment of segmentsFrom(input.documentText)) {
    const haystack = normalized(segment);
    const matchedTerms = terms.filter((term) => haystack.includes(term));
    const distinctSignals = matchedTerms.filter((term) =>
      /^\d/u.test(term) || term.length >= 3 || (input.allowTwoCharacterSignals && term.length === 2)
    );
    if (new Set(distinctSignals).size < 2) continue;
    const score = matchedTerms.reduce((total, term) => {
      if (/^\d/u.test(term)) return total + 6;
      if (/^[a-z]/u.test(term)) return total + Math.min(5, term.length / 2);
      return total + (term.length > 2 ? 3 : 1);
    }, 0) + Math.min(12, 240 / Math.max(40, segment.length));
    if (score < (input.minimumScore ?? 10)) continue;
    if (!best || score > best.score || (score === best.score && segment.length < best.exactExcerpt.length)) {
      best = {
        exactExcerpt: segment,
        score: Math.round(score * 100) / 100,
        matchedTerms: [...new Set(matchedTerms)].slice(0, 24),
      };
    }
  }
  return best;
}
