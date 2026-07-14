import {
  CLAIM_INVESTIGATION_CONTRACT_VERSION,
  type EvidenceSourceRole,
  type InvestigationAttributionModality,
  type InvestigationBundle,
  type InvestigationConsequence,
  type InvestigationPlan,
  type InvestigationQuestionBasis,
  type InvestigationQuestionPurpose,
  type InvestigationScope,
  type InvestigationSubject,
  validateInvestigationBundle,
} from "./claim-investigation-contract";
import type { Lang } from "./types";

export type InvestigationPlanAbstentionReason =
  | "no_checkworthy_claim"
  | "missing_specifics"
  | "opinion_or_prediction"
  | "low_consequence"
  | "not_grounded"
  | "unsafe_to_plan";

export interface InvestigationPlanDraftProposition {
  originalSpan: string;
  normalizedText: string;
  time: string | null;
  place: string | null;
  quantity: string | null;
}

export interface InvestigationPlanDraftAttribution {
  actor: string;
  relation: string;
  modality: InvestigationAttributionModality;
}

export interface InvestigationPlanDraftQuestion {
  basis: InvestigationQuestionBasis;
  purpose: InvestigationQuestionPurpose;
  question: string;
  queryCandidates: string[];
  preferredSourceRoles: EvidenceSourceRole[];
}

export interface InvestigationPlanDraft {
  schemaVersion: 2;
  eligible: boolean;
  abstentionReason: InvestigationPlanAbstentionReason | null;
  subject: {
    originalSpan: string;
    normalizedClaim: string;
    attribution: InvestigationPlanDraftAttribution | null;
    proposition: InvestigationPlanDraftProposition;
    consequence: InvestigationConsequence;
  } | null;
  plan: {
    questions: InvestigationPlanDraftQuestion[];
    timeCutoff: string | null;
    minimumIndependentSources: number;
    stoppingConditions: string[];
  } | null;
}

export interface MaterializeInvestigationPlanInput {
  sampleId: string;
  scope: InvestigationScope;
  sourceText: string;
  contentFingerprint: string;
  observedAt: string;
  source?: {
    title?: string;
    publisher?: string;
    url?: string;
    publishedAt?: string;
  };
}

export type MaterializeInvestigationPlanResult =
  | { ok: true; bundle: InvestigationBundle }
  | { ok: false; error: "abstained"; reason: InvestigationPlanAbstentionReason }
  | { ok: false; error: "invalid_draft" | "ungrounded_span" | "ungrounded_proposition" | "compound_proposition"; detail?: string };

const ABSTENTION_REASONS = new Set<InvestigationPlanAbstentionReason>([
  "no_checkworthy_claim", "missing_specifics", "opinion_or_prediction",
  "low_consequence", "not_grounded", "unsafe_to_plan",
]);
const CONSEQUENCES = new Set<InvestigationConsequence>([
  "health", "safety", "money", "rights", "law", "public_interest",
]);
const MODALITIES = new Set<InvestigationAttributionModality>([
  "statement", "report", "estimate", "allegation", "forecast", "analysis",
]);
const BASES = new Set<InvestigationQuestionBasis>(["literal", "contextual"]);
const PURPOSES = new Set<InvestigationQuestionPurpose>([
  "proposition", "identity", "timeline", "quantity", "context", "counterevidence",
]);
const SOURCE_ROLES = new Set<EvidenceSourceRole>([
  "primary", "independent_secondary", "fact_check", "claim_origin", "user_supplied",
]);

export const INVESTIGATION_PLAN_DRAFT_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["schemaVersion", "eligible", "abstentionReason", "subject", "plan"],
  properties: {
    schemaVersion: { type: "integer", const: 2 },
    eligible: { type: "boolean" },
    abstentionReason: {
      type: ["string", "null"],
      enum: [
        "no_checkworthy_claim", "missing_specifics", "opinion_or_prediction",
        "low_consequence", "not_grounded", "unsafe_to_plan", null,
      ],
    },
    subject: {
      anyOf: [
        { type: "null" },
        {
          type: "object",
          additionalProperties: false,
          required: ["originalSpan", "normalizedClaim", "attribution", "proposition", "consequence"],
          properties: {
            originalSpan: {
              type: "string",
              minLength: 6,
              maxLength: 1200,
              description: "One contiguous passage copied character-for-character from SOURCE_TEXT.",
            },
            normalizedClaim: { type: "string", minLength: 6, maxLength: 280 },
            attribution: {
              anyOf: [
                { type: "null" },
                {
                  type: "object",
                  additionalProperties: false,
                  required: ["actor", "relation", "modality"],
                  properties: {
                    actor: { type: "string", minLength: 2, maxLength: 160 },
                    relation: { type: "string", minLength: 1, maxLength: 80 },
                    modality: {
                      enum: ["statement", "report", "estimate", "allegation", "forecast", "analysis"],
                      description: "statement=the actor directly said or announced it; report=a document or publisher reported a past/current fact; estimate=an explicitly approximate quantity; allegation=an explicit accusation or disputed charge; forecast=a future prediction only; analysis=an interpretation. Do not use allegation merely because a claim is unverified or forecast for current/historical data.",
                    },
                  },
                },
              ],
            },
            proposition: {
              type: "object",
              additionalProperties: false,
              required: ["originalSpan", "normalizedText", "time", "place", "quantity"],
              properties: {
                originalSpan: {
                  type: "string",
                  minLength: 3,
                  maxLength: 600,
                  description: "The one atomic claim copied character-for-character as a contiguous substring of the subject originalSpan.",
                },
                normalizedText: {
                  type: "string",
                  minLength: 3,
                  maxLength: 280,
                  description: "A self-contained reading of that one claim; time, place, quantity, and attribution remain attributes rather than additional propositions.",
                },
                time: { type: ["string", "null"], maxLength: 80 },
                place: { type: ["string", "null"], maxLength: 100 },
                quantity: { type: ["string", "null"], maxLength: 80 },
              },
            },
            consequence: { enum: ["health", "safety", "money", "rights", "law", "public_interest"] },
          },
        },
      ],
    },
    plan: {
      anyOf: [
        { type: "null" },
        {
          type: "object",
          additionalProperties: false,
          required: ["questions", "timeCutoff", "minimumIndependentSources", "stoppingConditions"],
          properties: {
            questions: {
              type: "array",
              minItems: 1,
              maxItems: 8,
              items: {
                type: "object",
                additionalProperties: false,
                required: ["basis", "purpose", "question", "queryCandidates", "preferredSourceRoles"],
                properties: {
                  basis: {
                    enum: ["literal", "contextual"],
                    description: "literal directly tests an explicit proposition; contextual supplies information needed to interpret it.",
                  },
                  purpose: { enum: ["proposition", "identity", "timeline", "quantity", "context", "counterevidence"] },
                  question: { type: "string", minLength: 6, maxLength: 320 },
                  queryCandidates: {
                    type: "array",
                    minItems: 1,
                    maxItems: 3,
                    items: { type: "string", minLength: 3, maxLength: 240 },
                  },
                  preferredSourceRoles: {
                    type: "array",
                    minItems: 1,
                    maxItems: 3,
                    items: { enum: ["primary", "independent_secondary", "fact_check", "claim_origin", "user_supplied"] },
                  },
                },
              },
            },
            timeCutoff: { type: ["string", "null"], maxLength: 40 },
            minimumIndependentSources: { type: "integer", minimum: 0, maximum: 5 },
            stoppingConditions: {
              type: "array",
              minItems: 1,
              maxItems: 8,
              items: { type: "string", minLength: 3, maxLength: 240 },
            },
          },
        },
      ],
    },
  },
} as const;

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function boundedString(value: unknown, max: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const clean = value.replace(/\s+/g, " ").trim();
  return clean && Array.from(clean).length <= max ? clean : undefined;
}

function nullableString(value: unknown, max: number): string | null | undefined {
  return value === null ? null : boundedString(value, max);
}

function containsPrivateRecordRequest(value: string): boolean {
  return /\b(?:medical|patient) records?\b|(?:私人|非公開)?(?:病歷|醫療紀錄)/iu.test(value);
}

function normalizeDraft(value: unknown): InvestigationPlanDraft | undefined {
  const root = record(value);
  if (!root || root.schemaVersion !== 2 || typeof root.eligible !== "boolean") return undefined;
  if (!root.eligible) {
    const reason = root.abstentionReason;
    if (typeof reason !== "string" || !ABSTENTION_REASONS.has(reason as InvestigationPlanAbstentionReason)) return undefined;
    if (root.subject !== null || root.plan !== null) return undefined;
    return { schemaVersion: 2, eligible: false, abstentionReason: reason as InvestigationPlanAbstentionReason, subject: null, plan: null };
  }
  if (root.abstentionReason !== null) return undefined;
  const subject = record(root.subject);
  const plan = record(root.plan);
  if (!subject || !plan) return undefined;
  const originalSpan = boundedString(subject.originalSpan, 1200);
  const normalizedClaim = boundedString(subject.normalizedClaim, 280);
  if (!originalSpan || !normalizedClaim || !CONSEQUENCES.has(subject.consequence as InvestigationConsequence)) return undefined;

  let attribution: InvestigationPlanDraftAttribution | null = null;
  if (subject.attribution !== null) {
    const raw = record(subject.attribution);
    if (!raw) return undefined;
    const actor = boundedString(raw.actor, 160);
    const relation = boundedString(raw.relation, 80);
    if (!actor || !relation || !MODALITIES.has(raw.modality as InvestigationAttributionModality)) return undefined;
    attribution = { actor, relation, modality: raw.modality as InvestigationAttributionModality };
  }

  const rawProposition = record(subject.proposition);
  if (!rawProposition) return undefined;
  const propositionSpan = boundedString(rawProposition.originalSpan, 600);
  const normalizedText = boundedString(rawProposition.normalizedText, 280);
  const time = nullableString(rawProposition.time, 80);
  const place = nullableString(rawProposition.place, 100);
  const quantity = nullableString(rawProposition.quantity, 80);
  if (!propositionSpan || !normalizedText || time === undefined || place === undefined || quantity === undefined) return undefined;
  const proposition: InvestigationPlanDraftProposition = {
    originalSpan: propositionSpan,
    normalizedText,
    time,
    place,
    quantity,
  };

  if (!Array.isArray(plan.questions) || plan.questions.length < 1 || plan.questions.length > 8) return undefined;
  const questions: InvestigationPlanDraftQuestion[] = [];
  for (const item of plan.questions) {
    const raw = record(item);
    if (!raw || raw.propositionIndex !== undefined ||
      !BASES.has(raw.basis as InvestigationQuestionBasis) ||
      !PURPOSES.has(raw.purpose as InvestigationQuestionPurpose)) return undefined;
    const question = boundedString(raw.question, 320);
    if (!question || !Array.isArray(raw.queryCandidates) || raw.queryCandidates.length < 1 || raw.queryCandidates.length > 3 ||
      !Array.isArray(raw.preferredSourceRoles) || raw.preferredSourceRoles.length < 1 || raw.preferredSourceRoles.length > 3) return undefined;
    const queryCandidates = raw.queryCandidates.map((candidate) => boundedString(candidate, 240));
    if (queryCandidates.some((candidate) => !candidate)) return undefined;
    if (queryCandidates.some((candidate) => candidate && containsPrivateRecordRequest(candidate))) return undefined;
    if (raw.preferredSourceRoles.some((role) => !SOURCE_ROLES.has(role as EvidenceSourceRole))) return undefined;
    questions.push({
      basis: raw.basis as InvestigationQuestionBasis,
      purpose: raw.purpose as InvestigationQuestionPurpose,
      question,
      queryCandidates: queryCandidates as string[],
      preferredSourceRoles: raw.preferredSourceRoles as EvidenceSourceRole[],
    });
  }
  const timeCutoff = nullableString(plan.timeCutoff, 40);
  if (timeCutoff === undefined || (timeCutoff !== null && !Number.isFinite(Date.parse(timeCutoff)))) return undefined;
  if (typeof plan.minimumIndependentSources !== "number" || !Number.isInteger(plan.minimumIndependentSources) ||
    plan.minimumIndependentSources < 0 || plan.minimumIndependentSources > 5) return undefined;
  if (!Array.isArray(plan.stoppingConditions) || plan.stoppingConditions.length < 1 || plan.stoppingConditions.length > 8) return undefined;
  const stoppingConditions = plan.stoppingConditions.map((condition) => boundedString(condition, 240));
  if (stoppingConditions.some((condition) => !condition)) return undefined;
  if (!questions.some((question) => question.basis === "literal")) return undefined;

  return {
    schemaVersion: 2,
    eligible: true,
    abstentionReason: null,
    subject: {
      originalSpan,
      normalizedClaim,
      attribution,
      proposition,
      consequence: subject.consequence as InvestigationConsequence,
    },
    plan: {
      questions,
      timeCutoff,
      minimumIndependentSources: plan.minimumIndependentSources,
      stoppingConditions: stoppingConditions as string[],
    },
  };
}

export function parseInvestigationPlanDraftContent(content: string): InvestigationPlanDraft | undefined {
  let text = content.trim();
  const fenced = text.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  if (fenced?.[1]) text = fenced[1].trim();
  if (!text.startsWith("{") || !text.endsWith("}")) return undefined;
  try {
    return normalizeDraft(JSON.parse(text));
  } catch {
    return undefined;
  }
}

function groundingText(value: string): string {
  return value.normalize("NFKC").toLocaleLowerCase("en").replace(/[\p{P}\p{S}\s]+/gu, "");
}

function groundedIn(haystack: string, needle: string): boolean {
  const cleanNeedle = groundingText(needle);
  return cleanNeedle.length >= 2 && groundingText(haystack).includes(cleanNeedle);
}

/**
 * Conservative local backstop for obvious compound output. The prompt and
 * singular schema do the semantic work; this guard only rejects boundaries
 * that are unlikely to be one independently verifiable proposition. It avoids
 * treating entity lists or a single comparison as compound by default.
 */
export function detectCompoundPropositionSignal(value: string): string | undefined {
  const clean = value.replace(/\s+/g, " ").trim();
  const sentenceParts = clean.split(/[。！？!?；;]+/u).map((part) => part.trim()).filter(Boolean);
  if (sentenceParts.length > 1) return "multiple_sentences";
  if (/[,，]\s*(?:and|but|while|whereas|且|並且|而且|同時|但|然而|以及)\s*/iu.test(clean)) {
    return "coordinated_clauses";
  }
  if (/，\s*(?:雙方|並|且|同時|這些|其中|共同|禁止|導致|造成|使得)\s*/u.test(clean)) {
    return "new_clause_after_comma";
  }
  if (/(?:宣稱|聲稱|妄稱).{0,100}(?:謊言|不實|虛假)/u.test(clean)) {
    return "claim_plus_truth_judgment";
  }
  if (/[,，]\s*(?:其中|另有|另|with|including)\s*[^,，]*\d/iu.test(clean) &&
    (clean.match(/\d+(?:[.,]\d+)?/gu)?.length ?? 0) > 1) {
    return "multiple_quantity_clauses";
  }
  return undefined;
}

export function materializeInvestigationPlan(
  draft: InvestigationPlanDraft,
  input: MaterializeInvestigationPlanInput,
): MaterializeInvestigationPlanResult {
  if (!draft.eligible) {
    return { ok: false, error: "abstained", reason: draft.abstentionReason ?? "unsafe_to_plan" };
  }
  if (!draft.subject || !draft.plan) return { ok: false, error: "invalid_draft" };
  if (!groundedIn(input.sourceText, draft.subject.originalSpan)) return { ok: false, error: "ungrounded_span" };
  if (!groundedIn(draft.subject.originalSpan, draft.subject.proposition.originalSpan)) {
    return { ok: false, error: "ungrounded_proposition" };
  }
  const compoundSignal = detectCompoundPropositionSignal(draft.subject.proposition.normalizedText);
  if (compoundSignal) {
    return { ok: false, error: "compound_proposition", detail: compoundSignal };
  }

  const subjectId = `subject:${input.sampleId}`;
  const subject: InvestigationSubject = {
    version: CLAIM_INVESTIGATION_CONTRACT_VERSION,
    id: subjectId,
    scope: input.scope,
    originalSpan: draft.subject.originalSpan,
    normalizedClaim: draft.subject.normalizedClaim,
    source: {
      ...input.source,
      observedAt: input.observedAt,
      contentFingerprint: input.contentFingerprint,
    },
    ...(draft.subject.attribution ? { attribution: draft.subject.attribution } : {}),
    proposition: {
      originalSpan: draft.subject.proposition.originalSpan,
      normalizedText: draft.subject.proposition.normalizedText,
      ...(draft.subject.proposition.time ? { time: draft.subject.proposition.time } : {}),
      ...(draft.subject.proposition.place ? { place: draft.subject.proposition.place } : {}),
      ...(draft.subject.proposition.quantity ? { quantity: draft.subject.proposition.quantity } : {}),
    },
    consequence: draft.subject.consequence,
  };
  const plan: InvestigationPlan = {
    version: CLAIM_INVESTIGATION_CONTRACT_VERSION,
    subjectId,
    questions: draft.plan.questions.map((question, index) => ({
      id: `question:${input.sampleId}:${index + 1}`,
      basis: question.basis,
      purpose: question.purpose,
      question: question.question,
      queryCandidates: question.queryCandidates,
      preferredSourceRoles: question.preferredSourceRoles,
    })),
    ...(draft.plan.timeCutoff ? { timeCutoff: draft.plan.timeCutoff } : {}),
    minimumIndependentSources: draft.plan.minimumIndependentSources,
    stoppingConditions: draft.plan.stoppingConditions,
  };
  const bundle: InvestigationBundle = { subject, plan, evidence: [] };
  const validation = validateInvestigationBundle(bundle);
  return validation.ok
    ? { ok: true, bundle }
    : { ok: false, error: "invalid_draft", detail: validation.issues.map((item) => `${item.path}:${item.code}`).join(",") };
}

/**
 * Bounded representation fallback for a claim that an independent human has
 * already reviewed as atomic. It never selects a claim or changes eligibility;
 * it only replaces unstable model segmentation with the approved exact span.
 */
export function materializeHumanPreselectedAtomicPlan(
  draft: InvestigationPlanDraft,
  input: MaterializeInvestigationPlanInput,
  approvedOriginalSpan: string,
): MaterializeInvestigationPlanResult {
  if (!draft.eligible || !draft.subject || !draft.plan ||
    !groundedIn(input.sourceText, approvedOriginalSpan)) return { ok: false, error: "invalid_draft" };
  const first = draft.subject.proposition;
  const adjusted: InvestigationPlanDraft = {
    ...draft,
    subject: {
      ...draft.subject,
      originalSpan: approvedOriginalSpan,
      proposition: {
        originalSpan: approvedOriginalSpan,
        normalizedText: draft.subject.normalizedClaim,
        time: first.time,
        place: first.place,
        quantity: first.quantity,
      },
    },
  };
  return materializeInvestigationPlan(adjusted, input);
}

export function investigationPlannerSystemPrompt(lang: Lang): string {
  const responseLanguage = lang === "zh-TW" ? "Traditional Chinese (Taiwan)" : "English";
  return `You prepare a bounded evidence investigation plan from one page or selected passage.
Return only JSON matching schemaVersion 2. Write human-facing text in ${responseLanguage}.

Select at most one consequential, externally verifiable claim. A claim must affect health, safety, money, rights, law, or public interest. Abstain from opinions, product taste, routine availability, vague controversy, writing style, AI-generation guesses, or claims missing the actor, event, product, number, place, or time needed for reliable retrieval.

If abstaining, set eligible=false, choose one abstentionReason, and set subject and plan to null.

If eligible:
- Select exactly one atomic proposition. If the source sentence combines an event with a cause, consequence, evaluation, second event, or separately verifiable quantity, select only one clause that can be copied safely; otherwise abstain with unsafe_to_plan.
- originalSpan must be copied verbatim from the supplied text and contain only that selected proposition plus attribution required to interpret its modality.
- normalizedClaim may clarify references but may not add facts.
- Preserve attribution and modality as subject attributes. Use statement only when the actor directly said or announced something; report when a document or publisher reports a past or current fact; estimate only for an explicitly approximate quantity; allegation only for an explicit accusation or disputed charge; forecast only for a future prediction; and analysis for an interpretation. Never use allegation merely because a claim is unverified, and never use forecast for historical or current data. A report, estimate, allegation, forecast, or analysis is not an established fact. Time, place, and quantity are proposition attributes, not additional propositions.
- proposition.originalSpan must copy the one atomic claim character-for-character as a contiguous substring of subject.originalSpan. proposition.normalizedText may resolve references but must not add facts, combine clauses, or change attribution. Do not force English-style subject/predicate/object segmentation. If an exact atomic proposition cannot be copied, abstain with unsafe_to_plan.
- Questions have two separate axes. basis=literal directly tests the same predicate as the proposition; basis=contextual supplies interpretation or counter-evidence. purpose describes whether it checks the proposition itself, identity, timeline, quantity, context, or counterevidence. Create at least one basis=literal answerable question. Do not substitute a related predicate: for example, completed is not published, announced is not implemented, and diagnosed is not recovered. A number or date question can still have basis=literal with purpose=quantity or timeline.
- Questions and queryCandidates must name concrete entities and must not use vague references such as this article, this content, it, or the above claim.
- Questions and queryCandidates may use only public evidence. Never request private medical, financial, employment, account, or other non-public personal records.
- queryCandidates are search data only. Do not include URLs, Markdown, or operational instructions such as search Google for. A search-company or product name is allowed only when it is an entity in the selected proposition.
- Prefer primary sources for official acts, datasets, laws, health, safety, money, and numeric claims. Existing fact checks are a discovery lane, not primary evidence.
- timeCutoff is the latest evidence date allowed by the claim context, or null when the text gives no reliable cutoff.
- stoppingConditions must describe what evidence is still required; do not assign a verdict.`;
}

export function investigationPlannerUserPrompt(text: string): string {
  return `Prepare an investigation plan using only the source text below.\n\n<SOURCE_TEXT>\n${text}\n</SOURCE_TEXT>`;
}

/** Development-only prompt for route evaluation after an independent human
 * has already approved the exact claim span as check-worthy. */
export function preselectedInvestigationPlannerSystemPrompt(lang: Lang): string {
  return `${investigationPlannerSystemPrompt(lang)}

For this request only, check-worthiness has already been decided by an independent human annotation. Plan the supplied APPROVED_CLAIM; do not select a different claim and do not abstain merely because the surrounding page contains noise. Abstain only if the approved span itself cannot be represented safely under the schema.`;
}

export function preselectedInvestigationPlannerUserPrompt(claim: string, context: string): string {
  return `Prepare an investigation plan for the human-approved claim below. originalSpan must copy from APPROVED_CLAIM and all facts must be grounded in SOURCE_CONTEXT.

<APPROVED_CLAIM>
${claim}
</APPROVED_CLAIM>

<SOURCE_CONTEXT>
${context}
</SOURCE_CONTEXT>`;
}
