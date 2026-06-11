import init, { scan_text } from "../vendor/zhtw-mcp/zhtw_mcp_wasm.js";
import type { ZhtwIssue, ZhtwReview, ZhtwSegmentReview } from "./types";
import {
  aggregateZhtwSegments,
  buildZhtwTextSegments,
  type ZhtwSegmentSource,
  type ZhtwTextSegment,
  ZHTW_RAW_MAX_EXAMPLES,
} from "./zhtw-review";

export const ZHTW_MCP_SOURCE_VERSION = "9b407b7bce3c603a0ade221d248eec1a0f531335";
export const ZHTW_SCAN_OPTIONS = { profile: "base", relaxed: true } as const;

const MAX_SCAN_CHARS_PER_SEGMENT = 5000;

let initPromise: Promise<unknown> | null = null;

interface RawZhtwIssue {
  offset?: unknown;
  length?: unknown;
  found?: unknown;
  suggestions?: unknown;
  rule_type?: unknown;
  severity?: unknown;
  context?: unknown;
  english?: unknown;
}

interface RawZhtwScanResult {
  issues?: unknown;
  issue_count?: unknown;
  badge_count?: unknown;
  severity_counts?: unknown;
}

async function ensureZhtwReady(): Promise<void> {
  if (!initPromise) {
    initPromise = init();
  }
  try {
    await initPromise;
  } catch (error) {
    initPromise = null;
    throw error;
  }
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function numberValue(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
}

function normalizeSeverity(value: unknown): ZhtwIssue["severity"] {
  return value === "error" || value === "warning" || value === "info" ? value : "info";
}

function normalizeIssue(raw: RawZhtwIssue): ZhtwIssue | null {
  const found = stringValue(raw.found);
  if (!found) return null;
  const suggestions = Array.isArray(raw.suggestions)
    ? raw.suggestions.map(stringValue).filter((item): item is string => !!item).slice(0, 3)
    : [];
  return {
    offset: numberValue(raw.offset),
    length: numberValue(raw.length),
    found,
    suggestions,
    ruleType: stringValue(raw.rule_type) || "unknown",
    severity: normalizeSeverity(raw.severity),
    context: stringValue(raw.context),
    english: stringValue(raw.english),
  };
}

function countIssuesByRuleType(issues: ZhtwIssue[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const issue of issues) {
    out[issue.ruleType] = (out[issue.ruleType] ?? 0) + 1;
  }
  return out;
}

function severityCounts(raw: RawZhtwScanResult, issues: ZhtwIssue[]): ZhtwSegmentReview["severityCounts"] {
  const fromRaw = raw.severity_counts && typeof raw.severity_counts === "object"
    ? raw.severity_counts as Record<string, unknown>
    : {};
  const counts = {
    info: numberValue(fromRaw.info),
    warning: numberValue(fromRaw.warning),
    error: numberValue(fromRaw.error),
  };
  if (counts.info || counts.warning || counts.error) return counts;
  for (const issue of issues) counts[issue.severity] += 1;
  return counts;
}

function normalizeSegmentScan(segment: ZhtwTextSegment, raw: RawZhtwScanResult): ZhtwSegmentReview {
  const issues = Array.isArray(raw.issues)
    ? raw.issues
        .map((item) => normalizeIssue(item as RawZhtwIssue))
        .filter((item): item is ZhtwIssue => !!item)
    : [];
  const counts = severityCounts(raw, issues);
  const issueCount = numberValue(raw.issue_count) || issues.length;
  const badgeCount = numberValue(raw.badge_count) || counts.warning + counts.error;
  return {
    kind: segment.kind,
    label: segment.label,
    issueCount,
    badgeCount,
    severityCounts: counts,
    issueSummary: countIssuesByRuleType(issues),
    examples: issues.slice(0, ZHTW_RAW_MAX_EXAMPLES),
  };
}

async function scanSegment(segment: ZhtwTextSegment): Promise<ZhtwSegmentReview> {
  const input = segment.text.slice(0, MAX_SCAN_CHARS_PER_SEGMENT);
  const rawJson = scan_text(input, JSON.stringify(ZHTW_SCAN_OPTIONS));
  return normalizeSegmentScan(segment, JSON.parse(rawJson));
}

export async function scanSourceWithZhtw(source: ZhtwSegmentSource): Promise<ZhtwReview> {
  const segments = buildZhtwTextSegments(source);
  await ensureZhtwReady();
  const reviews: ZhtwSegmentReview[] = [];
  for (const segment of segments) {
    reviews.push(await scanSegment(segment));
  }
  return aggregateZhtwSegments(reviews, ZHTW_MCP_SOURCE_VERSION);
}

export async function scanPostTextWithZhtw(text: string): Promise<ZhtwReview> {
  return scanSourceWithZhtw({ text, contentKind: "standard" });
}
