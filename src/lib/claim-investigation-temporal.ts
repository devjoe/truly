import type { InvestigationBundle, InvestigationQuestion } from "./claim-investigation-contract";

export const INVESTIGATION_TEMPORAL_DERIVATION_VERSION = 1 as const;

export type InvestigationTemporalRole =
  | "publication"
  | "observation"
  | "event"
  | "effective"
  | "reporting_period";

export interface InvestigationTemporalAnchor {
  id: string;
  role: InvestigationTemporalRole;
  value: string;
  exactSpan: string;
  source: "source_metadata" | "claim_span";
}

export type InvestigationTemporalDerivation =
  | {
      version: typeof INVESTIGATION_TEMPORAL_DERIVATION_VERSION;
      questionId: string;
      originalQuestion: string;
      status: "derived";
      derivedQuestion: string;
      anchor: InvestigationTemporalAnchor;
      reason: "explicit_event_anchor" | "explicit_effective_anchor" | "explicit_reporting_period_anchor";
    }
  | {
      version: typeof INVESTIGATION_TEMPORAL_DERIVATION_VERSION;
      questionId: string;
      originalQuestion: string;
      status: "blocked";
      anchors: InvestigationTemporalAnchor[];
      reason: "missing_explicit_anchor" | "ambiguous_temporal_role" | "publication_or_observation_only";
    };

export type InvestigationTemporalAnchorStrength =
  | "canonical_record"
  | "authoritative_dated_source"
  | "independent_dated_report";

export interface InvestigationTemporalLedgerEntry {
  id: string;
  value: string;
  role: InvestigationTemporalRole;
  exactSpan: string;
  sourceUrl?: string;
  evidenceCutoff: string;
  anchorStrength: InvestigationTemporalAnchorStrength;
  conflict: boolean;
}

export type InvestigationTemporalRouteSelection =
  | { status: "derived_pending_review"; originalQuestion: string; derivedQuestion: string; anchor: InvestigationTemporalLedgerEntry }
  | { status: "quarantined"; originalQuestion: string; reason: "missing_anchor" | "conflicting_anchors" | "weak_anchor_only"; ledger: InvestigationTemporalLedgerEntry[] };

const ID_RE = /^[a-z0-9][a-z0-9._:-]{0,127}$/iu;
const DERIVABLE_ROLES = new Set<InvestigationTemporalRole>(["event", "effective", "reporting_period"]);

function questionById(bundle: InvestigationBundle, questionId: string): InvestigationQuestion {
  const question = bundle.plan.questions.find((entry) => entry.id === questionId);
  if (!question) throw new Error(`Unknown investigation question: ${questionId}`);
  return question;
}

function frozenText(bundle: InvestigationBundle, anchor: InvestigationTemporalAnchor): string {
  if (anchor.source === "claim_span") {
    return `${bundle.subject.originalSpan}\n${bundle.subject.proposition.originalSpan}`;
  }
  return [bundle.subject.source.publishedAt, bundle.subject.source.observedAt].filter(Boolean).join("\n");
}

function validAnchor(bundle: InvestigationBundle, anchor: InvestigationTemporalAnchor): boolean {
  return ID_RE.test(anchor.id) && anchor.value.trim().length > 0 && anchor.value.length <= 80 &&
    anchor.exactSpan.trim().length > 0 && anchor.exactSpan.length <= 160 &&
    anchor.exactSpan.includes(anchor.value) && frozenText(bundle, anchor).includes(anchor.exactSpan);
}

/**
 * Creates an auditable derived question without mutating the frozen plan.
 * Temporal meaning is never inferred here: callers must supply one explicit,
 * typed anchor from the frozen claim or source metadata.
 */
export function deriveInvestigationTemporalQuestion(input: {
  bundle: InvestigationBundle;
  questionId: string;
  anchors: InvestigationTemporalAnchor[];
  derivedQuestion?: string;
}): InvestigationTemporalDerivation {
  const question = questionById(input.bundle, input.questionId);
  const anchors = input.anchors.filter((anchor) => validAnchor(input.bundle, anchor));
  const derivable = anchors.filter((anchor) => DERIVABLE_ROLES.has(anchor.role));
  if (anchors.length === 0) {
    return { version: 1, questionId: question.id, originalQuestion: question.question, status: "blocked", anchors: [], reason: "missing_explicit_anchor" };
  }
  if (derivable.length === 0) {
    return { version: 1, questionId: question.id, originalQuestion: question.question, status: "blocked", anchors, reason: "publication_or_observation_only" };
  }
  if (derivable.length !== 1 || new Set(derivable.map((anchor) => `${anchor.role}:${anchor.value}`)).size !== 1) {
    return { version: 1, questionId: question.id, originalQuestion: question.question, status: "blocked", anchors, reason: "ambiguous_temporal_role" };
  }
  const anchor = derivable[0];
  const derivedQuestion = input.derivedQuestion?.trim() ?? "";
  if (!derivedQuestion || derivedQuestion === question.question || derivedQuestion.length > 320 || !derivedQuestion.includes(anchor.value)) {
    return { version: 1, questionId: question.id, originalQuestion: question.question, status: "blocked", anchors, reason: "ambiguous_temporal_role" };
  }
  const reason = anchor.role === "event"
    ? "explicit_event_anchor"
    : anchor.role === "effective" ? "explicit_effective_anchor" : "explicit_reporting_period_anchor";
  return {
    version: 1,
    questionId: question.id,
    originalQuestion: question.question,
    status: "derived",
    derivedQuestion,
    anchor,
    reason,
  };
}

/**
 * Anchor-first quarantine: no hypothesis is materialized until one explicit
 * event/effective/reporting-period role has a non-conflicting strong anchor.
 * Independent dated reports remain useful discovery observations but cannot
 * route proposition verification by themselves.
 */
export function selectInvestigationTemporalRoute(input: {
  originalQuestion: string;
  derivedQuestion: string;
  ledger: InvestigationTemporalLedgerEntry[];
  timeCutoff: string;
}): InvestigationTemporalRouteSelection {
  if (!input.originalQuestion.trim() || !input.derivedQuestion.trim() || input.derivedQuestion === input.originalQuestion ||
    Number.isNaN(Date.parse(input.timeCutoff)) || new Set(input.ledger.map((entry) => entry.id)).size !== input.ledger.length ||
    input.ledger.some((entry) => !entry.id || !entry.value || !entry.exactSpan.includes(entry.value) ||
      Number.isNaN(Date.parse(entry.evidenceCutoff)) || Date.parse(entry.evidenceCutoff) > Date.parse(input.timeCutoff))) {
    throw new Error("Invalid temporal ledger input");
  }
  const routeAnchors = input.ledger.filter((entry) => DERIVABLE_ROLES.has(entry.role));
  if (routeAnchors.length === 0) return { status: "quarantined", originalQuestion: input.originalQuestion, reason: "missing_anchor", ledger: input.ledger };
  if (routeAnchors.some((entry) => entry.conflict) || new Set(routeAnchors.map((entry) => `${entry.role}:${entry.value}`)).size > 1) {
    return { status: "quarantined", originalQuestion: input.originalQuestion, reason: "conflicting_anchors", ledger: input.ledger };
  }
  const strong = routeAnchors.find((entry) => entry.anchorStrength === "canonical_record" || entry.anchorStrength === "authoritative_dated_source");
  if (!strong) return { status: "quarantined", originalQuestion: input.originalQuestion, reason: "weak_anchor_only", ledger: input.ledger };
  if (!input.derivedQuestion.includes(strong.value)) {
    return { status: "quarantined", originalQuestion: input.originalQuestion, reason: "missing_anchor", ledger: input.ledger };
  }
  return { status: "derived_pending_review", originalQuestion: input.originalQuestion, derivedQuestion: input.derivedQuestion, anchor: strong };
}
