import type { TierAProvider, TierBProvider } from "./types";
import type {
  Lang,
  ModelOutputFinding,
  ModelOutputReview,
  ReadingBriefBackground,
  ReadingBriefClaim,
  ReadingBriefQuestion,
} from "./types";
import type { GeneralPageModelContext } from "./general-page-model-context";
import type { GeneralPageEffectiveModelContextUse } from "./general-page-parser-advisor";
import { providerCanRunTierBFeature } from "./feature-readiness";
import { applyGeneralPageBriefOutputReview } from "./model-output-review";
import {
  duplicatesReadingBriefVerification,
  isNaturalReadingBriefFollowUpQuestion,
} from "./reading-question-policy";

export interface GeneralPageBrief {
  schemaVersion: 1;
  summary: string;
  bg?: ReadingBriefBackground[];
  claims?: GeneralPageBriefClaim[];
  qs?: ReadingBriefQuestion[];
  note?: string;
  model: string;
  outputLang?: Lang;
  elapsedMs?: number;
  outputReview?: ModelOutputReview;
}

/** Machine-checkable decomposition used only by General Page investigation.
 *  These fields are not rendered. Missing or malformed atoms keep the reading
 *  brief usable but make the downstream investigation action fail closed. */
export interface GeneralPageAtomicProposition {
  /** Concrete subject copied from claim.c. */
  s: string;
  /** Single factual relation copied from claim.c. */
  p: string;
  /** Concrete object, outcome, number, or status copied from claim.c. */
  o: string;
}

export type GeneralPageClaimKind =
  | "fact"
  | "report"
  | "estimate"
  | "forecast"
  | "allegation"
  | "expert_analysis"
  | "opinion";

export type GeneralPageClaimConsequence =
  | "health"
  | "safety"
  | "money"
  | "rights"
  | "law"
  | "public_interest"
  | "none";

export type GeneralPageAttributionModality =
  | "statement"
  | "report"
  | "estimate"
  | "allegation"
  | "forecast"
  | "analysis";

/** Explicit source framing outside the atomic proposition. All text fields
 *  must be copied from claim.c so an investigation cannot silently promote an
 *  attributed estimate, allegation, or analysis into an established fact. */
export interface GeneralPageClaimAttribution {
  source: string;
  relation: string;
  modality: GeneralPageAttributionModality;
}

/** Model-authored classification consumed by a deterministic, fail-closed
 *  action policy. It is evidence for eligibility, never authority by itself. */
export interface GeneralPageClaimPolicy {
  claimKind: GeneralPageClaimKind;
  consequence: GeneralPageClaimConsequence;
}

export interface GeneralPageBriefClaim extends ReadingBriefClaim {
  atom?: GeneralPageAtomicProposition;
  attribution?: GeneralPageClaimAttribution;
  policy?: GeneralPageClaimPolicy;
  /** Session-only source-language span used to ground a localized claim. */
  sourceQuote?: string;
  /** Session-only localized question used only for the Side Panel display. */
  displayQ?: string;
}

export type GeneralPageAnalysisEligibilityReason =
  | "session_not_ready"
  | "stale_surface"
  | "model_ineligible"
  | "requires_user_target"
  | "blocked"
  | "provider_not_ready";

export interface GeneralPageAnalysisEligibilityInput {
  /** True only after the user explicitly confirmed sending a screenshot. */
  screenshotConfirmed?: boolean;
  sessionReady: boolean;
  surfaceCurrent: boolean;
  context: Pick<GeneralPageModelContext, "modelEligible">;
  allowedUse: GeneralPageEffectiveModelContextUse;
  provider: TierAProvider | TierBProvider;
}

export interface GeneralPageAnalysisEligibility {
  ok: boolean;
  reason?: GeneralPageAnalysisEligibilityReason;
}

interface ParsedGeneralPageBriefContent {
  ok: boolean;
  value: GeneralPageBrief | null;
  error?: "empty_content" | "json_not_found" | "invalid_json" | "invalid_schema";
}

export function generalPageBriefEligibility(
  input: GeneralPageAnalysisEligibilityInput,
): GeneralPageAnalysisEligibility {
  if (!input.sessionReady) return { ok: false, reason: "session_not_ready" };
  if (!input.surfaceCurrent) return { ok: false, reason: "stale_surface" };
  if (!input.context.modelEligible && !input.screenshotConfirmed) return { ok: false, reason: "model_ineligible" };
  if (input.allowedUse === "requires_user_target" && !input.screenshotConfirmed) {
    return { ok: false, reason: "requires_user_target" };
  }
  if (input.allowedUse === "blocked") return { ok: false, reason: "blocked" };
  if (!providerCanRunTierBFeature("reading_brief", input.provider)) {
    return { ok: false, reason: "provider_not_ready" };
  }
  return { ok: true };
}

/**
 * Screenshot recovery is offered only when the advisor explicitly asked for
 * visual grounding AND the configured Tier B provider passed the vision
 * probe. Sending always requires a fresh user confirmation in the panel;
 * there is intentionally no automatic-screenshot setting yet.
 */
export function canOfferGeneralPageScreenshot(input: {
  visionSupported: boolean;
  decision?: string;
  needsScreenshot?: boolean;
}): boolean {
  if (!input.visionSupported) return false;
  return input.decision === "request_screenshot_region" || input.needsScreenshot === true;
}

export function normalizeGeneralPageBrief(
  raw: unknown,
  model: string,
  outputLang?: Lang,
): GeneralPageBrief | null {
  if (!raw || typeof raw !== "object") return null;
  const record = raw as Record<string, unknown>;
  if (record.schemaVersion !== 1) return null;
  const summary = boundedSummary(record.summary, outputLang);
  if (!summary) return null;

  const brief: GeneralPageBrief = {
    schemaVersion: 1,
    summary,
    model,
    outputLang,
  };
  const bg = normalizeArray(record.bg, 2, normalizeBackground);
  const claims = normalizeArray(record.claims, 1, normalizeClaim);
  const verificationTexts = claims.flatMap((claim) => [claim.c, claim.need, claim.q]);
  const questionLang = outputLang === "en" ? "en" : "zh-TW";
  const qs = normalizeArray(record.qs, 4, normalizeQuestion)
    .filter((question) =>
      isNaturalReadingBriefFollowUpQuestion(question.q, questionLang) &&
      !duplicatesReadingBriefVerification(question.q, verificationTexts))
    .slice(0, 1);
  const note = boundedString(record.note, 200);
  if (bg.length > 0) brief.bg = bg;
  if (claims.length > 0) brief.claims = claims;
  if (qs.length > 0) brief.qs = qs;
  if (note) brief.note = note;
  return brief;
}

export function parseGeneralPageBriefContent(
  content: string,
  model: string,
  outputLang?: Lang,
): ParsedGeneralPageBriefContent {
  const trimmed = content.trim();
  if (!trimmed) return { ok: false, value: null, error: "empty_content" };
  const jsonText = extractJsonPayload(trimmed);
  if (!jsonText) return { ok: false, value: null, error: "json_not_found" };
  try {
    const value = normalizeGeneralPageBrief(JSON.parse(jsonText), model, outputLang);
    const reviewed = value && outputLang === "zh-TW"
      ? applyGeneralPageBriefOutputReview(value)
      : value;
    return value
      ? { ok: true, value: reviewed }
      : { ok: false, value: null, error: "invalid_schema" };
  } catch {
    return { ok: false, value: null, error: "invalid_json" };
  }
}

export function applyGeneralPageOverviewGuard(brief: GeneralPageBrief): GeneralPageBrief {
  if (!brief.claims || brief.claims.length === 0) return brief;
  const finding: ModelOutputFinding = {
    path: "claims",
    ruleId: "general-page-overview-no-claims",
    found: `${brief.claims.length} claim(s)`,
    replacement: "claims removed",
    severity: "warning",
    autoFixable: true,
  };
  const outputReview = mergeGeneralPageOutputReview(brief.outputReview, finding);
  const { claims: _claims, ...rest } = brief;
  return { ...rest, outputReview };
}

export function applyGeneralPageBriefPostGuards(
  brief: GeneralPageBrief,
  allowedUse: GeneralPageEffectiveModelContextUse,
): GeneralPageBrief {
  if (allowedUse === "page_overview_only") return applyGeneralPageOverviewGuard(brief);
  return brief;
}

function mergeGeneralPageOutputReview(
  existing: ModelOutputReview | undefined,
  finding: ModelOutputFinding,
): ModelOutputReview {
  const checkedAt = existing?.checkedAt ?? new Date().toISOString();
  const findings = [...(existing?.findings ?? []), finding];
  const autoFixes = [...(existing?.autoFixes ?? []), {
    path: finding.path,
    ruleId: finding.ruleId,
    before: finding.found,
    after: finding.replacement ?? "",
  }];
  return {
    source: "model-output-review",
    scope: "general_page_brief",
    profile: "zh-TW-safe",
    reviewVersion: existing?.reviewVersion ?? "2026-07-02-general-page-v1",
    checkedAt,
    findingCount: findings.length,
    autoFixCount: autoFixes.length,
    findings,
    autoFixes,
  };
}

function normalizeBackground(value: unknown): ReadingBriefBackground | null {
  const record = asRecord(value);
  const t = boundedString(record?.t, 80);
  const why = boundedString(record?.why, 120);
  if (!t || !why) return null;
  const q = boundedString(record?.q, 120);
  return q ? { t, why, q } : { t, why };
}

function normalizeClaim(value: unknown): GeneralPageBriefClaim | null {
  const record = asRecord(value);
  // English's 28-word prompt budget can legitimately exceed 120 characters.
  // Keep semantic fields intact within the UI/task budget instead of silently
  // slicing them mid-word and invalidating an otherwise coherent atom.
  const c = boundedString(record?.c, 180);
  const why = boundedString(record?.why, 120);
  const need = boundedString(record?.need, 90);
  if (!c || !why || !need) return null;
  const q = boundedString(record?.q, 180);
  const atom = normalizeAtomicProposition(record?.atom);
  const attribution = normalizeClaimAttribution(record?.attribution);
  const policy = normalizeClaimPolicy(record?.policy);
  return {
    c,
    why,
    need,
    ...(q ? { q } : {}),
    ...(atom ? { atom } : {}),
    ...(attribution ? { attribution } : {}),
    ...(policy ? { policy } : {}),
  };
}

function normalizeAtomicProposition(value: unknown): GeneralPageAtomicProposition | null {
  const record = asRecord(value);
  const s = boundedString(record?.s, 80);
  const p = boundedString(record?.p, 100);
  const o = boundedString(record?.o, 160);
  if (!s || !p || !o) return null;
  return { s, p, o };
}

function normalizeClaimAttribution(value: unknown): GeneralPageClaimAttribution | null {
  const record = asRecord(value);
  const source = boundedString(record?.source, 80);
  const relation = boundedString(record?.relation, 40);
  const modality = boundedString(record?.modality, 24);
  if (!source || !relation || !isClaimAttributionModality(modality)) return null;
  return { source, relation, modality };
}

function normalizeClaimPolicy(value: unknown): GeneralPageClaimPolicy | null {
  const record = asRecord(value);
  const claimKind = boundedString(record?.claimKind, 24);
  const consequence = boundedString(record?.consequence, 24);
  if (!isClaimKind(claimKind) || !isClaimConsequence(consequence)) return null;
  return { claimKind, consequence };
}

function isClaimKind(value: string | undefined): value is GeneralPageClaimKind {
  return value === "fact" || value === "report" || value === "estimate" || value === "forecast" ||
    value === "allegation" || value === "expert_analysis" || value === "opinion";
}

function isClaimConsequence(value: string | undefined): value is GeneralPageClaimConsequence {
  return value === "health" || value === "safety" || value === "money" ||
    value === "rights" || value === "law" || value === "public_interest" || value === "none";
}

function isClaimAttributionModality(value: string | undefined): value is GeneralPageAttributionModality {
  return value === "statement" || value === "report" || value === "estimate" ||
    value === "allegation" || value === "forecast" || value === "analysis";
}

function normalizeQuestion(value: unknown): ReadingBriefQuestion | null {
  const record = asRecord(value);
  const q = boundedString(record?.q, 140);
  const kind = boundedString(record?.kind, 30);
  if (!q) return null;
  if (kind === "verify" || kind === "source") return null;
  const normalizedKind = kind === "understand" ||
    kind === "context" ||
    kind === "counter" ||
    kind === "image"
    ? kind
    : "understand";
  return { q, kind: normalizedKind };
}

function normalizeArray<T>(
  value: unknown,
  limit: number,
  normalize: (value: unknown) => T | null,
): T[] {
  if (!Array.isArray(value)) return [];
  const out: T[] = [];
  for (const item of value) {
    const normalized = normalize(item);
    if (!normalized) continue;
    out.push(normalized);
    if (out.length >= limit) break;
  }
  return out;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function boundedString(value: unknown, maxLength: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const clean = value.trim().replace(/\s+/g, " ");
  if (!clean) return undefined;
  return clean.length > maxLength ? clean.slice(0, maxLength).trim() : clean;
}

function boundedSummary(value: unknown, outputLang: Lang | undefined): string | undefined {
  const clean = boundedString(value, 900);
  if (!clean) return undefined;
  if (outputLang === "zh-TW") return Array.from(clean).slice(0, 80).join("").trim();
  if (outputLang === "en") return clean.split(/\s+/).slice(0, 32).join(" ").trim();
  return clean.slice(0, 360).trim();
}

function extractJsonPayload(value: string): string | undefined {
  if (value.startsWith("{")) return value;
  const fenced = value.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i)?.[1]?.trim();
  if (fenced?.startsWith("{") && fenced.endsWith("}")) return fenced;
  return undefined;
}
