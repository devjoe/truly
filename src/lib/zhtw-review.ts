import type {
  PostContentKind,
  ZhtwIssue,
  ZhtwReview,
  ZhtwSegmentKind,
  ZhtwSegmentReview,
} from "./types";
import { cleanFacebookUiChrome, splitFacebookImageAltText } from "./post-text";
import { resolveStructuredPostContext } from "./post-context";
import { STRUCTURED_POST_SEGMENT_LABEL } from "./source-context-types";

export const ZHTW_SUMMARY_BADGE_THRESHOLD = 2;
export const ZHTW_HEADSUP_MAX_EXAMPLES = 5;
export const ZHTW_SIDEPANEL_MAX_TERMS = 8;
export const ZHTW_RAW_MAX_EXAMPLES = 100;
export const ZHTW_READING_BRIEF_MAX_TERMS = 20;
export const ZHTW_HEADSUP_MAX_FOUND_CHARS = 16;
export const ZHTW_SIDEPANEL_MAX_FOUND_CHARS = 80;
export const ZHTW_SIDEPANEL_STYLE_MAX_FOUND_CHARS = 22;

export const ZHTW_SEGMENT_LABEL: Record<ZhtwSegmentKind, string> = {
  post_text: STRUCTURED_POST_SEGMENT_LABEL.post_text,
  sharer_comment: STRUCTURED_POST_SEGMENT_LABEL.sharer_comment,
  shared_content: STRUCTURED_POST_SEGMENT_LABEL.shared_content,
  link_preview: STRUCTURED_POST_SEGMENT_LABEL.link_preview,
  image_text: STRUCTURED_POST_SEGMENT_LABEL.image_text,
};

export interface ZhtwTextSegment {
  kind: ZhtwSegmentKind;
  label: string;
  text: string;
}

export interface ZhtwSegmentSource {
  text?: string;
  fullText?: string;
  contentKind?: PostContentKind;
  sharedAttachmentText?: string;
  reshareOriginalText?: string;
  reshareOriginalAuthor?: string;
  authorName?: string;
  sourceName?: string;
  sourceContext?: unknown;
}

export interface ZhtwTermSummary {
  found: string;
  suggestions: string[];
  count: number;
  segments: ZhtwSegmentKind[];
  segmentLabels: string[];
  ruleTypes: string[];
  severity: ZhtwIssue["severity"];
}

type ZhtwTermDisplayGroup = "lexical" | "style" | "other";
export type ZhtwSidePanelFindingGroup = "lexical" | "style" | "punctuation" | "other";

export interface ZhtwSidePanelFinding {
  group: ZhtwSidePanelFindingGroup;
  text: string;
  count: number;
  segmentLabels: string[];
  ruleTypes: string[];
  severity: ZhtwIssue["severity"];
}

const MIN_SEGMENT_CHARS = 8;
function normalizeSpaces(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

export function cleanZhtwInputText(text: string): string {
  return normalizeSpaces(cleanFacebookUiChrome(text));
}

function comparable(text: string): string {
  return cleanZhtwInputText(text).normalize("NFKC").replace(/\s+/g, "");
}

function addSegment(out: ZhtwTextSegment[], seen: Set<string>, kind: ZhtwSegmentKind, text: string | undefined): void {
  const clean = cleanZhtwInputText(text ?? "");
  if (clean.length < MIN_SEGMENT_CHARS) return;
  const key = comparable(clean);
  if (!key || seen.has(key)) return;
  seen.add(key);
  out.push({ kind, label: ZHTW_SEGMENT_LABEL[kind], text: clean });
}

function addPostTextWithImageAltSplit(
  out: ZhtwTextSegment[],
  seen: Set<string>,
  kind: ZhtwSegmentKind,
  text: string | undefined,
): void {
  const split = splitFacebookImageAltText(text ?? "");
  addSegment(out, seen, kind, split.bodyText);
  for (const imageText of split.imageTexts) addSegment(out, seen, "image_text", imageText);
}

function isZhtwSegmentKind(kind: string): kind is ZhtwSegmentKind {
  return kind === "post_text" ||
    kind === "sharer_comment" ||
    kind === "shared_content" ||
    kind === "link_preview" ||
    kind === "image_text";
}

export function buildZhtwTextSegments(source: ZhtwSegmentSource): ZhtwTextSegment[] {
  const out: ZhtwTextSegment[] = [];
  const seen = new Set<string>();
  const context = resolveStructuredPostContext(source);
  for (const segment of context.sourceSegments) {
    if (!segment.scanForZhtw || !isZhtwSegmentKind(segment.kind)) continue;
    addPostTextWithImageAltSplit(out, seen, segment.kind, segment.text);
  }
  return out;
}

export function zhtwExamples(review: ZhtwReview | undefined, limit: number): Array<ZhtwIssue & { segmentLabel: string }> {
  if (!review) return [];
  const out: Array<ZhtwIssue & { segmentLabel: string }> = [];
  for (const segment of review.segments) {
    for (const issue of segment.examples) {
      out.push({ ...issue, segmentLabel: segment.label });
      if (out.length >= limit) return out;
    }
  }
  return out;
}

function isPunctuationOnly(text: string): boolean {
  return !!text && /^[\p{P}\p{S}\s]+$/u.test(text);
}

function isGenericImageWordSuggestion(issue: Pick<ZhtwIssue, "found" | "suggestions">): boolean {
  const imageWords = new Set(["圖像", "影像", "圖片", "相片", "照片"]);
  const found = issue.found.trim();
  return imageWords.has(found) &&
    issue.suggestions.length > 0 &&
    issue.suggestions.every((item) => imageWords.has(item.trim()));
}

function severityRank(severity: ZhtwIssue["severity"]): number {
  if (severity === "error") return 2;
  if (severity === "warning") return 1;
  return 0;
}

function isDisplayWorthyIssue(issue: ZhtwIssue, maxFoundChars: number): boolean {
  if (issue.ruleType === "punctuation") return false;
  if (issue.severity === "info") return false;
  const found = issue.found.trim();
  if (!found || isPunctuationOnly(found)) return false;
  if (found.length > maxFoundChars) return false;
  if (isGenericImageWordSuggestion(issue)) return false;
  return true;
}

function isHeadsUpWorthyIssue(issue: ZhtwIssue): boolean {
  return isDisplayWorthyIssue(issue, ZHTW_HEADSUP_MAX_FOUND_CHARS);
}

function termKey(issue: ZhtwIssue): string {
  return [
    issue.found.trim().normalize("NFKC"),
    ...issue.suggestions.map((item) => item.trim().normalize("NFKC")),
  ].join("\u0000");
}

export function summarizeZhtwTerms(
  review: ZhtwReview | undefined,
  limit: number,
  maxFoundChars = ZHTW_SIDEPANEL_MAX_FOUND_CHARS,
): ZhtwTermSummary[] {
  if (!review) return [];
  const order = new Map<string, number>();
  const terms = new Map<string, ZhtwTermSummary>();
  for (const segment of review.segments) {
    for (const issue of segment.examples) {
      if (!isDisplayWorthyIssue(issue, maxFoundChars)) continue;
      const key = termKey(issue);
      if (!terms.has(key)) {
        order.set(key, order.size);
        terms.set(key, {
          found: issue.found.trim(),
          suggestions: issue.suggestions,
          count: 0,
          segments: [],
          segmentLabels: [],
          ruleTypes: [],
          severity: issue.severity,
        });
      }
      const term = terms.get(key)!;
      term.count += 1;
      if (!term.segments.includes(segment.kind)) term.segments.push(segment.kind);
      if (!term.segmentLabels.includes(segment.label)) term.segmentLabels.push(segment.label);
      if (!term.ruleTypes.includes(issue.ruleType)) term.ruleTypes.push(issue.ruleType);
      if (severityRank(issue.severity) > severityRank(term.severity)) term.severity = issue.severity;
    }
  }
  return Array.from(terms.entries())
    .sort((a, b) => {
      const [, left] = a;
      const [, right] = b;
      return (
        right.count - left.count ||
        severityRank(right.severity) - severityRank(left.severity) ||
        (order.get(a[0]) ?? 0) - (order.get(b[0]) ?? 0)
      );
    })
    .slice(0, limit)
    .map(([, term]) => term);
}

export function summarizeZhtwTermsForHeadsUp(review: ZhtwReview | undefined): ZhtwTermSummary[] {
  return summarizeZhtwTerms(review, ZHTW_HEADSUP_MAX_EXAMPLES, ZHTW_HEADSUP_MAX_FOUND_CHARS);
}

export function summarizeZhtwTermsForSidePanel(review: ZhtwReview | undefined): ZhtwTermSummary[] {
  return summarizeZhtwTerms(review, ZHTW_SIDEPANEL_MAX_TERMS, ZHTW_SIDEPANEL_MAX_FOUND_CHARS);
}

function sidePanelIssueGroup(issue: ZhtwIssue): ZhtwSidePanelFindingGroup {
  if (issue.ruleType === "punctuation") return "punctuation";
  if (issue.suggestions.length > 0 || ["cross_strait", "lexical", "confusable"].includes(issue.ruleType)) {
    return "lexical";
  }
  if (["translationese", "grammar", "ai_style"].includes(issue.ruleType)) return "style";
  return "other";
}

function sidePanelIssueKey(issue: ZhtwIssue): string {
  const group = sidePanelIssueGroup(issue);
  if (group === "punctuation") return "punctuation";
  return `${group}\u0000${termKey(issue)}\u0000${issue.ruleType}`;
}

function punctuationKind(issue: ZhtwIssue): string {
  const found = issue.found.trim();
  if (found === "(" || found === ")") return "半形括號";
  if (found === '"' || found === "'") return "半形引號";
  if (found === "「" || found === "」" || found === "『" || found === "』") return "引號樣式";
  if (found === ",") return "半形逗號";
  if (found === ".") return "半形句點";
  if (found === ":" || found === ";") return "半形標點";
  if (/^[，。！？、：；（）【】《》「」『』]$/.test(found)) return "標點樣式";
  return found ? `「${found}」` : "標點樣式";
}

function sidePanelStyleText(issue: ZhtwIssue): string {
  return `句式較不自然：「${zhtwExampleText(issue, ZHTW_SIDEPANEL_STYLE_MAX_FOUND_CHARS, "……")}」`;
}

export function summarizeZhtwFindingsForSidePanel(review: ZhtwReview | undefined): ZhtwSidePanelFinding[] {
  if (!review) return [];
  const order = new Map<string, number>();
  const findings = new Map<string, ZhtwSidePanelFinding & { punctuationKinds: Map<string, number> }>();

  for (const segment of review.segments) {
    for (const issue of segment.examples) {
      if (issue.severity === "info") continue;
      if (isGenericImageWordSuggestion(issue)) continue;
      const key = sidePanelIssueKey(issue);
      if (!findings.has(key)) {
        order.set(key, order.size);
        const group = sidePanelIssueGroup(issue);
        findings.set(key, {
          group,
          text: group === "punctuation"
            ? "標點格式"
            : (group === "style" && issue.ruleType === "translationese"
              ? sidePanelStyleText(issue)
              : zhtwExampleText(issue, ZHTW_SIDEPANEL_MAX_FOUND_CHARS)),
          count: 0,
          segmentLabels: [],
          ruleTypes: [],
          severity: issue.severity,
          punctuationKinds: new Map(),
        });
      }
      const finding = findings.get(key)!;
      finding.count += 1;
      if (!finding.segmentLabels.includes(segment.label)) finding.segmentLabels.push(segment.label);
      if (!finding.ruleTypes.includes(issue.ruleType)) finding.ruleTypes.push(issue.ruleType);
      if (severityRank(issue.severity) > severityRank(finding.severity)) finding.severity = issue.severity;
      if (finding.group === "punctuation") {
        const kind = punctuationKind(issue);
        finding.punctuationKinds.set(kind, (finding.punctuationKinds.get(kind) ?? 0) + 1);
      }
    }
  }

  const sortedFindings = Array.from(findings.entries())
    .sort((a, b) => {
      const [, left] = a;
      const [, right] = b;
      return (
        severityRank(right.severity) - severityRank(left.severity) ||
        right.count - left.count ||
        (order.get(a[0]) ?? 0) - (order.get(b[0]) ?? 0)
      );
    });
  if (!sortedFindings.some(([, finding]) => finding.group !== "punctuation")) {
    return [];
  }
  return sortedFindings
    .map(([, finding]) => {
      const count = finding.count > 1 ? ` ×${finding.count}` : "";
      let text = finding.text;
      if (finding.group === "punctuation") {
        text = finding.count > 1 ? `標點格式 ×${finding.count}` : "標點格式";
      } else if (count && !text.endsWith(count)) {
        text = `${text}${count}`;
      }
      return {
        group: finding.group,
        text,
        count: finding.count,
        segmentLabels: finding.segmentLabels,
        ruleTypes: finding.ruleTypes,
        severity: finding.severity,
      };
    });
}

export function summarizeZhtwTermsForTierB2(review: ZhtwReview | undefined): ZhtwTermSummary[] {
  return summarizeZhtwTerms(review, ZHTW_READING_BRIEF_MAX_TERMS, ZHTW_SIDEPANEL_MAX_FOUND_CHARS);
}

export function formatZhtwTerm(term: ZhtwTermSummary): string {
  const suggestion = term.suggestions.length > 0 ? ` → ${term.suggestions.join(" / ")}` : "";
  const count = term.count > 1 ? ` ×${term.count}` : "";
  return `${term.found}${suggestion}${count}`;
}

export function zhtwRuleTypeLabel(ruleType: string): string {
  if (ruleType === "translationese") return "句式/語氣";
  if (ruleType === "cross_strait" || ruleType === "lexical" || ruleType === "confusable") return "詞彙";
  if (ruleType === "punctuation") return "標點";
  if (ruleType === "grammar") return "語法";
  if (ruleType === "ai_style") return "AI 文體";
  return ruleType;
}

export function zhtwTermDisplayGroup(term: ZhtwTermSummary): ZhtwTermDisplayGroup {
  if (term.suggestions.length > 0) return "lexical";
  if (term.ruleTypes.includes("translationese")) return "style";
  return "other";
}

export function formatZhtwTermExplanation(term: ZhtwTermSummary): string {
  const count = term.count > 1 ? ` ×${term.count}` : "";
  if (zhtwTermDisplayGroup(term) === "style") {
    return `「${term.found}」較像翻譯腔/直譯句式${count}`;
  }
  return formatZhtwTerm(term);
}

export function formatZhtwTermMeta(term: ZhtwTermSummary): string {
  const labels = term.ruleTypes.map(zhtwRuleTypeLabel);
  const uniqueLabels = Array.from(new Set(labels));
  return uniqueLabels.join(" / ");
}

export function formatZhtwTermSource(term: ZhtwTermSummary): string {
  const labels = term.segmentLabels.filter((label) => label !== ZHTW_SEGMENT_LABEL.post_text);
  return Array.from(new Set(labels)).join(" / ");
}

export function zhtwHeadsUpExamples(
  review: ZhtwReview | undefined,
  limit: number,
): Array<ZhtwIssue & { segmentLabel: string }> {
  if (!review) return [];
  const out: Array<ZhtwIssue & { segmentLabel: string }> = [];
  for (const segment of review.segments) {
    for (const issue of segment.examples) {
      if (!isHeadsUpWorthyIssue(issue)) continue;
      out.push({ ...issue, segmentLabel: segment.label });
      if (out.length >= limit) return out;
    }
  }
  return out;
}

export function zhtwHeadsUpIssueCount(review: ZhtwReview | undefined): number {
  return summarizeZhtwTerms(review, Number.MAX_SAFE_INTEGER, ZHTW_HEADSUP_MAX_FOUND_CHARS)
    .reduce((sum, term) => sum + term.count, 0);
}

function truncateText(text: string, maxChars: number, marker = "…"): string {
  const clean = text.trim();
  if (clean.length <= maxChars) return clean;
  const keepChars = Math.max(1, maxChars - marker.length);
  return `${clean.slice(0, keepChars)}${marker}`;
}

export function zhtwExampleText(
  issue: Pick<ZhtwIssue, "found" | "suggestions">,
  maxFoundChars = ZHTW_SIDEPANEL_MAX_FOUND_CHARS,
  marker = "…",
): string {
  const found = truncateText(issue.found, maxFoundChars, marker);
  const suggestion = issue.suggestions.length > 0 ? ` → ${issue.suggestions.join(" / ")}` : "";
  return `${found}${suggestion}`;
}

export function shouldShowZhtwInHeadsUp(review: ZhtwReview | undefined): boolean {
  return zhtwHeadsUpIssueCount(review) >= ZHTW_SUMMARY_BADGE_THRESHOLD;
}

export function compactZhtwEvidence(review: ZhtwReview | undefined): unknown {
  if (!review || review.issueCount === 0) return undefined;
  const topTerms = summarizeZhtwTermsForTierB2(review);
  if (topTerms.length === 0) return undefined;
  return {
    source: review.source,
    scope: review.scope,
    profile: review.profile,
    relaxed: review.relaxed,
    badge_count: review.badgeCount,
    issue_summary: review.issueSummary,
    top_terms: topTerms.map((term) => ({
      found: term.found,
      suggestions: term.suggestions,
      count: term.count,
      segments: term.segments,
      severity: term.severity,
      types: term.ruleTypes,
    })),
    segments: review.segments
      .filter((segment) => segment.issueCount > 0)
      .map((segment) => ({
        kind: segment.kind,
        label: segment.label,
        issue_count: segment.issueCount,
        badge_count: segment.badgeCount,
        issue_summary: segment.issueSummary,
      })),
    guardrail:
      "Use only as language-convention context. Mention it only when it helps reading, search keywords, or fact-checking. Do not infer author origin, nationality, political identity, account authenticity, intent, or factual accuracy.",
  };
}

export function aggregateZhtwSegments(
  segments: ZhtwSegmentReview[],
  sourceVersion: string,
  checkedAt = new Date().toISOString(),
): ZhtwReview {
  const severityCounts = { info: 0, warning: 0, error: 0 };
  const issueSummary: Record<string, number> = {};
  let issueCount = 0;
  let badgeCount = 0;
  const examples: ZhtwIssue[] = [];

  for (const segment of segments) {
    issueCount += segment.issueCount;
    badgeCount += segment.badgeCount;
    severityCounts.info += segment.severityCounts.info;
    severityCounts.warning += segment.severityCounts.warning;
    severityCounts.error += segment.severityCounts.error;
    for (const [rule, count] of Object.entries(segment.issueSummary)) {
      issueSummary[rule] = (issueSummary[rule] ?? 0) + count;
    }
    examples.push(...segment.examples);
  }

  return {
    source: "zhtw-mcp",
    scope: "segmented_post_text",
    profile: "base",
    relaxed: true,
    issueCount,
    badgeCount,
    severityCounts,
    issueSummary,
    segments,
    examples,
    signal: Math.min(1, badgeCount / 5),
    checkedAt,
    sourceVersion,
  };
}
