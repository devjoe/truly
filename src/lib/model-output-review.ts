import type {
  DeepClassification,
  ModelOutputFinding,
  ModelOutputFix,
  ModelOutputReview,
  ModelOutputReviewScope,
  ReadingBrief,
} from "./types";

const REVIEW_VERSION = "2026-05-20-zh-tw-safe-v1";

interface ReplacementRule {
  id: string;
  pattern: RegExp;
  replacement: string;
}

const SAFE_REPLACEMENTS: ReplacementRule[] = [
  { id: "zh-tw-video", pattern: /視頻|视频/g, replacement: "影片" },
  { id: "zh-tw-quality", pattern: /質量|质量/g, replacement: "品質" },
  { id: "zh-tw-software", pattern: /軟件|软件/g, replacement: "軟體" },
  { id: "zh-tw-info", pattern: /信息/g, replacement: "資訊" },
  { id: "zh-tw-network", pattern: /網絡|网络/g, replacement: "網路" },
  { id: "zh-tw-link", pattern: /鏈接|链接/g, replacement: "連結" },
  { id: "zh-tw-user", pattern: /用戶|用户/g, replacement: "使用者" },
  { id: "zh-tw-account", pattern: /账户/g, replacement: "帳號" },
];

function reviewText(
  text: string | undefined,
  path: string,
  findings: ModelOutputFinding[],
  fixes: ModelOutputFix[],
): string | undefined {
  if (typeof text !== "string" || text.length === 0) return text;
  let out = text;
  for (const rule of SAFE_REPLACEMENTS) {
    const before = out;
    out = out.replace(rule.pattern, (found) => {
      findings.push({
        path,
        ruleId: rule.id,
        found,
        replacement: rule.replacement,
        severity: "warning",
        autoFixable: true,
      });
      return rule.replacement;
    });
    if (out !== before) {
      fixes.push({ path, ruleId: rule.id, before, after: out });
    }
  }
  return out;
}

function buildReview(
  scope: ModelOutputReviewScope,
  findings: ModelOutputFinding[],
  fixes: ModelOutputFix[],
): ModelOutputReview | undefined {
  if (findings.length === 0 && fixes.length === 0) return undefined;
  return {
    source: "model-output-review",
    scope,
    profile: "zh-TW-safe",
    reviewVersion: REVIEW_VERSION,
    checkedAt: new Date().toISOString(),
    findingCount: findings.length,
    autoFixCount: fixes.length,
    findings,
    autoFixes: fixes,
  };
}

export function applyDeepOutputReview(deep: DeepClassification): DeepClassification {
  const findings: ModelOutputFinding[] = [];
  const fixes: ModelOutputFix[] = [];
  const out: DeepClassification = {
    ...deep,
    informationQuality: deep.informationQuality ? { ...deep.informationQuality } : undefined,
    imageInsights: deep.imageInsights?.map((item) => ({ ...item })),
  };

  out.summary = reviewText(out.summary, "summary", findings, fixes);
  if (out.informationQuality) {
    out.informationQuality.explanation = reviewText(
      out.informationQuality.explanation,
      "informationQuality.explanation",
      findings,
      fixes,
    );
  }
  out.imageInsights = out.imageInsights?.map((item, index) => ({
    ...item,
    observation: reviewText(item.observation, `imageInsights.${index}.observation`, findings, fixes) ?? item.observation,
  }));

  const review = buildReview("tier_b_deep", findings, fixes);
  if (review) out.outputReview = review;
  return out;
}

export function applyReadingBriefOutputReview(brief: ReadingBrief): ReadingBrief {
  const findings: ModelOutputFinding[] = [];
  const fixes: ModelOutputFix[] = [];
  const out: ReadingBrief = {
    ...brief,
    bg: brief.bg?.map((item) => ({ ...item })),
    claims: brief.claims?.map((item) => ({ ...item })),
    qs: brief.qs?.map((item) => ({ ...item })),
    checks: brief.checks?.map((item) => ({ ...item })),
  };

  out.bg = out.bg?.map((item, index) => ({
    ...item,
    t: reviewText(item.t, `bg.${index}.t`, findings, fixes) ?? item.t,
    why: reviewText(item.why, `bg.${index}.why`, findings, fixes) ?? item.why,
    q: reviewText(item.q, `bg.${index}.q`, findings, fixes),
  }));
  out.claims = out.claims?.map((item, index) => ({
    ...item,
    c: reviewText(item.c, `claims.${index}.c`, findings, fixes) ?? item.c,
    why: reviewText(item.why, `claims.${index}.why`, findings, fixes) ?? item.why,
    need: reviewText(item.need, `claims.${index}.need`, findings, fixes) ?? item.need,
    q: reviewText(item.q, `claims.${index}.q`, findings, fixes),
  }));
  out.qs = out.qs?.map((item, index) => ({
    ...item,
    q: reviewText(item.q, `qs.${index}.q`, findings, fixes) ?? item.q,
  }));
  out.checks = out.checks?.map((item, index) => ({
    ...item,
    label: reviewText(item.label, `checks.${index}.label`, findings, fixes) ?? item.label,
    q: reviewText(item.q, `checks.${index}.q`, findings, fixes) ?? item.q,
    why: reviewText(item.why, `checks.${index}.why`, findings, fixes) ?? item.why,
  }));
  out.note = reviewText(out.note, "note", findings, fixes);

  const review = buildReview("tier_b2_reading_brief", findings, fixes);
  if (review) out.outputReview = review;
  return out;
}
