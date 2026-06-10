import type { ClassificationScores, PostData } from "./types";
import { getAllSponsoredLabels, getAllSuggestedLabels } from "./i18n-patterns";

const ENGAGEMENT_BAIT_PATTERNS = [
  /share if you agree/i,
  /tag someone who/i,
  /like if you/i,
  /type\s+(yes|amen|1)\s+in\s+(the\s+)?comments?/i,
  /comment\s+\w+\s+if/i,
  /share\s+before\s+it('s|\s+is)\s+(deleted|removed|gone)/i,
  /bet you can'?t name/i,
  /only\s+\d+%?\s+(of\s+people\s+)?(can|will)/i,
  /don'?t\s+scroll\s+without/i,
  /ignore\s+if\s+you/i,
];

const EMOJI_REGEX =
  /[\u{1F300}-\u{1F9FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{FE00}-\u{FE0F}\u{1F000}-\u{1F02F}\u{1F0A0}-\u{1F0FF}\u{200D}\u{20E3}\u{FE0F}\u{E0020}-\u{E007F}]/gu;

function detectSponsored(article: HTMLElement): boolean {
  // Strategy 0: GraphQL already flagged as sponsored
  if (article.dataset.trulySponsored === "true") return true;

  // Strategy 1: Link href pattern
  const adLinks = article.querySelectorAll('a[href*="/ads/about"]');
  if (adLinks.length > 0) return true;

  // Strategy 2: "Why am I seeing this?" link
  const whyLinks = article.querySelectorAll(
    'a[href*="ads/about"], a[href*="ad_preferences"]'
  );
  if (whyLinks.length > 0) return true;

  // Strategy 3: Text content matching (handles "贊助 · 🌐" patterns)
  const sponsoredLabels = getAllSponsoredLabels();
  const spans = article.querySelectorAll("span, a");
  for (const span of spans) {
    const text = (span.textContent || "").trim();
    for (const label of sponsoredLabels) {
      if (text === label || text.startsWith(label + " ") || text.startsWith(label + "\u00a0")) {
        const rect = span.getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0 && rect.height < 30) return true;
      }
    }
  }

  // Strategy 4: Check first few lines of innerText
  const firstLines = (article.innerText || "").split("\n").slice(0, 5).join(" ");
  for (const label of sponsoredLabels) {
    if (firstLines.includes(label)) return true;
  }

  return false;
}

function detectSuggested(article: HTMLElement): boolean {
  const suggestedLabels = getAllSuggestedLabels();
  const text = article.innerText || "";
  const firstLines = text.split("\n").slice(0, 5).join(" ");
  return suggestedLabels.some((label) => firstLines.includes(label));
}

function computeEmojiDensity(text: string): number {
  if (!text) return 0;
  const emojiMatches = text.match(EMOJI_REGEX);
  const emojiCount = emojiMatches?.length ?? 0;
  const totalChars = [...text].length;
  if (totalChars === 0) return 0;
  return emojiCount / totalChars;
}

function detectEngagementBait(text: string): boolean {
  return ENGAGEMENT_BAIT_PATTERNS.some((pattern) => pattern.test(text));
}

export function runHeuristicFilter(post: PostData): ClassificationScores {
  const scores: ClassificationScores = {};

  // Sponsored detection
  if (detectSponsored(post.element)) {
    scores.commercial = 1.0;
    return scores;
  }

  // If the sharer added no text, attachment chrome such as "追蹤" buttons or
  // Reel metadata should not become a commercial/engagement-bait signal for
  // the sharer's post.
  if (post.contentKind === "share_without_comment") return scores;

  // Suggested content detection
  if (detectSuggested(post.element)) {
    scores.commercial = 0.9;
    return scores;
  }

  // Emoji density — high emoji → likely commercial
  const emojiDensity = computeEmojiDensity(post.text);
  if (emojiDensity > 0.3) {
    scores.commercial = Math.max(scores.commercial ?? 0, 0.5);
  }

  // Engagement bait — "留言+1", "私訊我" → commercial signal
  if (detectEngagementBait(post.text)) {
    scores.commercial = Math.max(scores.commercial ?? 0, 0.7);
  }

  return scores;
}
