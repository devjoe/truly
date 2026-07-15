/**
 * Case-level discovery contract for Claim Investigation.
 *
 * Search terms locate evidence-bearing documents; they are deliberately not
 * treated as the questions those documents must answer. This module remains
 * model-, transport-, and UI-neutral and is not wired into the extension
 * runtime.
 */

import type {
  EvidenceSourceRole,
  InvestigationBundle,
  InvestigationContractIssue,
  InvestigationContractValidation,
} from "./claim-investigation-contract";
import { validateInvestigationBundle } from "./claim-investigation-contract";

export const INVESTIGATION_CASE_CONTRACT_VERSION = 2 as const;

export type InvestigationDocumentKind =
  | "official_announcement"
  | "official_record"
  | "dataset"
  | "ruling"
  | "event_result"
  | "product_documentation"
  | "independent_report";

export type InvestigationVerificationFacet =
  | "actor"
  | "predicate"
  | "object"
  | "attribution"
  | "time"
  | "place"
  | "quantity";

export interface InvestigationEventFrame {
  description: string;
  entities: string[];
  time?: string;
  place?: string;
}

/**
 * Retrieval-only vocabulary. These values help locate document families but
 * never answer a verification question or satisfy a proof obligation.
 */
export interface InvestigationDiscoveryContext {
  aliases: string[];
  institutions: string[];
  languages: string[];
  jurisdictions: string[];
  timeBounds?: { from?: string; to?: string };
}

export interface InvestigationVerificationRequirement {
  questionId: string;
  requiredFacets: InvestigationVerificationFacet[];
  acceptableSourceRoles: EvidenceSourceRole[];
}

export interface InvestigationDiscoveryTarget {
  id: string;
  purpose: string;
  questionIds: string[];
  documentKinds: InvestigationDocumentKind[];
  authorityHints: string[];
  queries: string[];
  acceptedSourceRoles: EvidenceSourceRole[];
  fallback: boolean;
}

export interface InvestigationDiscoveryPlan {
  version: typeof INVESTIGATION_CASE_CONTRACT_VERSION;
  caseId: string;
  targets: InvestigationDiscoveryTarget[];
  stoppingConditions: string[];
}

export interface InvestigationCase {
  version: typeof INVESTIGATION_CASE_CONTRACT_VERSION;
  id: string;
  subjectId: string;
  eventFrame: InvestigationEventFrame;
  discoveryContext: InvestigationDiscoveryContext;
  questionIds: string[];
  requirements: InvestigationVerificationRequirement[];
  discoveryPlan: InvestigationDiscoveryPlan;
}

const ID_RE = /^[a-z0-9][a-z0-9._:-]{0,127}$/i;
const SEARCH_ARTIFACT_RE = /https?:\/\/|\[[^\]]+\]|\b(?:search|look up|query)\s+(?:on\s+)?(?:google|bing|duckduckgo)\b|\b(?:google|bing|duckduckgo)\s+(?:search|query)\s+(?:for|about)\b|\b(?:fact[ -]?check|debunk|verify (?:whether|if)|controversy)\b|\b(?:(?:year|day|week|month) prior to (?:the )?(?:article|report)(?: date)?|\d+\s+days?\s+ago)\b|(?:在|用|使用)(?:\s*)(?:google|bing|duckduckgo|搜尋引擎)(?:\s*)(?:搜尋|查詢)|(?:事實)?查核|真假|闢謠|辟谣|爭議|争议|質疑|质疑/iu;
const PRIVATE_RECORD_RE = /\b(?:medical|patient) records?\b|(?:私人|非公開)?(?:病歷|醫療紀錄)/iu;
const LEGAL_DOCUMENT_CONTEXT_RE = /\b(?:court|supreme court|judge|judgment|ruling|lawsuit|legal|regulation|regulator|enforcement|arrest|prosecution)\b|法院|判決|裁定|訴訟|法律|法規|規定|主管機關|執法|逮捕|起訴/iu;

const DOCUMENT_KINDS = new Set<InvestigationDocumentKind>([
  "official_announcement",
  "official_record",
  "dataset",
  "ruling",
  "event_result",
  "product_documentation",
  "independent_report",
]);
const FACETS = new Set<InvestigationVerificationFacet>([
  "actor", "predicate", "object", "attribution", "time", "place", "quantity",
]);
const SOURCE_ROLES = new Set<EvidenceSourceRole>([
  "primary", "independent_secondary", "fact_check", "claim_origin", "user_supplied",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function addIssue(
  issues: InvestigationContractIssue[],
  path: string,
  code: InvestigationContractIssue["code"],
  message: string,
): void {
  issues.push({ path, code, message });
}

function requireString(
  issues: InvestigationContractIssue[],
  value: unknown,
  path: string,
  maximum: number,
): value is string {
  if (typeof value !== "string") {
    addIssue(issues, path, "invalid_type", "must be a string");
    return false;
  }
  const clean = value.trim();
  if (!clean) {
    addIssue(issues, path, "missing_value", "must not be empty");
    return false;
  }
  if (Array.from(clean).length > maximum) {
    addIssue(issues, path, "out_of_bounds", `must be at most ${maximum} characters`);
    return false;
  }
  return true;
}

function requireId(
  issues: InvestigationContractIssue[],
  value: unknown,
  path: string,
): value is string {
  if (!requireString(issues, value, path, 128)) return false;
  if (!ID_RE.test(value)) {
    addIssue(issues, path, "invalid_value", "must be a stable opaque identifier");
    return false;
  }
  return true;
}

function validateUniqueStrings(
  issues: InvestigationContractIssue[],
  value: unknown,
  path: string,
  bounds: { minimum: number; maximum: number; maxLength: number },
): Set<string> {
  const result = new Set<string>();
  if (!Array.isArray(value)) {
    addIssue(issues, path, "invalid_type", "must be an array");
    return result;
  }
  if (value.length < bounds.minimum || value.length > bounds.maximum) {
    addIssue(issues, path, "out_of_bounds", `must contain ${bounds.minimum} to ${bounds.maximum} values`);
  }
  value.forEach((item, index) => {
    if (!requireString(issues, item, `${path}[${index}]`, bounds.maxLength)) return;
    if (result.has(item)) addIssue(issues, `${path}[${index}]`, "duplicate_id", "must be unique");
    result.add(item);
  });
  return result;
}

function validateEnumArray<T extends string>(
  issues: InvestigationContractIssue[],
  value: unknown,
  path: string,
  allowed: Set<T>,
  maximum: number,
): T[] {
  if (!Array.isArray(value)) {
    addIssue(issues, path, "invalid_type", "must be an array");
    return [];
  }
  if (value.length < 1 || value.length > maximum) {
    addIssue(issues, path, "out_of_bounds", `must contain 1 to ${maximum} values`);
  }
  const seen = new Set<T>();
  value.forEach((item, index) => {
    if (!allowed.has(item as T)) {
      addIssue(issues, `${path}[${index}]`, "invalid_value", "has an unsupported value");
      return;
    }
    if (seen.has(item as T)) addIssue(issues, `${path}[${index}]`, "duplicate_id", "must be unique");
    seen.add(item as T);
  });
  return [...seen];
}

/**
 * Validate a case against an already-valid subject/plan bundle. The case may
 * cover a subset of plan questions, but every covered question must have both
 * a verification requirement and at least one document-discovery target.
 */
export function validateInvestigationCase(
  value: unknown,
  bundle: InvestigationBundle,
): InvestigationContractValidation {
  const issues: InvestigationContractIssue[] = [];
  const bundleValidation = validateInvestigationBundle(bundle);
  if (!bundleValidation.ok) {
    return {
      ok: false,
      issues: bundleValidation.issues.map((entry) => ({
        ...entry,
        path: `bundle.${entry.path}`,
      })),
    };
  }
  if (!isRecord(value)) {
    return { ok: false, issues: [{ path: "case", code: "invalid_type", message: "must be an object" }] };
  }
  if (value.version !== INVESTIGATION_CASE_CONTRACT_VERSION) {
    addIssue(issues, "case.version", "invalid_version", `must equal ${INVESTIGATION_CASE_CONTRACT_VERSION}`);
  }
  requireId(issues, value.id, "case.id");
  if (requireId(issues, value.subjectId, "case.subjectId") && value.subjectId !== bundle.subject.id) {
    addIssue(issues, "case.subjectId", "unknown_reference", "must reference bundle.subject.id");
  }

  const planQuestionIds = new Set(bundle.plan.questions.map((question) => question.id));
  const subjectAndQuestionText = [
    bundle.subject.originalSpan,
    bundle.subject.normalizedClaim,
    ...bundle.plan.questions.map((question) => question.question),
  ].join(" ");
  const questionIds = validateUniqueStrings(issues, value.questionIds, "case.questionIds", {
    minimum: 1,
    maximum: 8,
    maxLength: 128,
  });
  questionIds.forEach((questionId) => {
    if (!planQuestionIds.has(questionId)) {
      addIssue(issues, "case.questionIds", "unknown_reference", `${questionId} is not a plan question`);
    }
  });

  if (!isRecord(value.eventFrame)) {
    addIssue(issues, "case.eventFrame", "invalid_type", "must be an object");
  } else {
    requireString(issues, value.eventFrame.description, "case.eventFrame.description", 320);
    validateUniqueStrings(issues, value.eventFrame.entities, "case.eventFrame.entities", {
      minimum: 1,
      maximum: 12,
      maxLength: 120,
    });
    if (value.eventFrame.time !== undefined) {
      requireString(issues, value.eventFrame.time, "case.eventFrame.time", 80);
    }
    if (value.eventFrame.place !== undefined) {
      requireString(issues, value.eventFrame.place, "case.eventFrame.place", 120);
    }
  }

  if (!isRecord(value.discoveryContext)) {
    addIssue(issues, "case.discoveryContext", "invalid_type", "must be a retrieval-only context object");
  } else {
    validateUniqueStrings(issues, value.discoveryContext.aliases, "case.discoveryContext.aliases", {
      minimum: 0, maximum: 24, maxLength: 160,
    });
    validateUniqueStrings(issues, value.discoveryContext.institutions, "case.discoveryContext.institutions", {
      minimum: 0, maximum: 12, maxLength: 160,
    });
    const languages = validateUniqueStrings(issues, value.discoveryContext.languages, "case.discoveryContext.languages", {
      minimum: 1, maximum: 6, maxLength: 35,
    });
    [...languages].forEach((language, index) => {
      if (!/^[a-z]{2,3}(?:-[A-Z][a-z]{3})?(?:-[A-Z]{2})?$/u.test(language)) {
        addIssue(issues, `case.discoveryContext.languages[${index}]`, "invalid_value", "must be a BCP 47 language tag");
      }
    });
    validateUniqueStrings(issues, value.discoveryContext.jurisdictions, "case.discoveryContext.jurisdictions", {
      minimum: 0, maximum: 8, maxLength: 120,
    });
    if (value.discoveryContext.timeBounds !== undefined) {
      if (!isRecord(value.discoveryContext.timeBounds)) {
        addIssue(issues, "case.discoveryContext.timeBounds", "invalid_type", "must be an object");
      } else {
        const { from, to } = value.discoveryContext.timeBounds;
        if (from !== undefined && (!requireString(issues, from, "case.discoveryContext.timeBounds.from", 40) || Number.isNaN(Date.parse(from)))) {
          addIssue(issues, "case.discoveryContext.timeBounds.from", "invalid_value", "must be an ISO-compatible date or time");
        }
        if (to !== undefined && (!requireString(issues, to, "case.discoveryContext.timeBounds.to", 40) || Number.isNaN(Date.parse(to)))) {
          addIssue(issues, "case.discoveryContext.timeBounds.to", "invalid_value", "must be an ISO-compatible date or time");
        }
        if (typeof from === "string" && typeof to === "string" && !Number.isNaN(Date.parse(from)) && !Number.isNaN(Date.parse(to)) && Date.parse(from) > Date.parse(to)) {
          addIssue(issues, "case.discoveryContext.timeBounds", "invalid_value", "from must not be later than to");
        }
      }
    }
  }

  const requirementQuestionIds = new Set<string>();
  if (!Array.isArray(value.requirements) || value.requirements.length < 1 || value.requirements.length > 8) {
    addIssue(issues, "case.requirements", "out_of_bounds", "must contain 1 to 8 requirements");
  } else {
    value.requirements.forEach((requirement, index) => {
      const path = `case.requirements[${index}]`;
      if (!isRecord(requirement)) {
        addIssue(issues, path, "invalid_type", "must be an object");
        return;
      }
      if (requireId(issues, requirement.questionId, `${path}.questionId`)) {
        if (requirementQuestionIds.has(requirement.questionId)) {
          addIssue(issues, `${path}.questionId`, "duplicate_id", "must be unique");
        }
        requirementQuestionIds.add(requirement.questionId);
        if (!questionIds.has(requirement.questionId)) {
          addIssue(issues, `${path}.questionId`, "unknown_reference", "must reference case.questionIds");
        }
      }
      validateEnumArray(issues, requirement.requiredFacets, `${path}.requiredFacets`, FACETS, 7);
      validateEnumArray(issues, requirement.acceptableSourceRoles, `${path}.acceptableSourceRoles`, SOURCE_ROLES, 5);
    });
  }
  questionIds.forEach((questionId) => {
    if (!requirementQuestionIds.has(questionId)) {
      addIssue(issues, "case.requirements", "missing_value", `missing requirement for ${questionId}`);
    }
  });

  const coveredQuestionIds = new Set<string>();
  const primaryCoveredQuestionIds = new Set<string>();
  if (!isRecord(value.discoveryPlan)) {
    addIssue(issues, "case.discoveryPlan", "invalid_type", "must be an object");
  } else {
    if (value.discoveryPlan.version !== INVESTIGATION_CASE_CONTRACT_VERSION) {
      addIssue(issues, "case.discoveryPlan.version", "invalid_version", `must equal ${INVESTIGATION_CASE_CONTRACT_VERSION}`);
    }
    if (requireId(issues, value.discoveryPlan.caseId, "case.discoveryPlan.caseId") &&
      typeof value.id === "string" && value.discoveryPlan.caseId !== value.id) {
      addIssue(issues, "case.discoveryPlan.caseId", "unknown_reference", "must reference case.id");
    }
    validateUniqueStrings(issues, value.discoveryPlan.stoppingConditions, "case.discoveryPlan.stoppingConditions", {
      minimum: 1,
      maximum: 8,
      maxLength: 240,
    });

    if (!Array.isArray(value.discoveryPlan.targets) ||
      value.discoveryPlan.targets.length < 1 || value.discoveryPlan.targets.length > 8) {
      addIssue(issues, "case.discoveryPlan.targets", "out_of_bounds", "must contain 1 to 8 targets");
    } else {
      const targetIds = new Set<string>();
      value.discoveryPlan.targets.forEach((target, index) => {
        const path = `case.discoveryPlan.targets[${index}]`;
        if (!isRecord(target)) {
          addIssue(issues, path, "invalid_type", "must be an object");
          return;
        }
        if (requireId(issues, target.id, `${path}.id`)) {
          if (targetIds.has(target.id)) addIssue(issues, `${path}.id`, "duplicate_id", "must be unique");
          targetIds.add(target.id);
        }
        requireString(issues, target.purpose, `${path}.purpose`, 240);
        const targetQuestionIds = validateUniqueStrings(issues, target.questionIds, `${path}.questionIds`, {
          minimum: 1,
          maximum: 8,
          maxLength: 128,
        });
        targetQuestionIds.forEach((questionId) => {
          if (!questionIds.has(questionId)) {
            addIssue(issues, `${path}.questionIds`, "unknown_reference", `${questionId} is not in this case`);
          } else {
            coveredQuestionIds.add(questionId);
            if (target.fallback === false) primaryCoveredQuestionIds.add(questionId);
          }
        });
        const documentKinds = validateEnumArray(issues, target.documentKinds, `${path}.documentKinds`, DOCUMENT_KINDS, 7);
        if (documentKinds.includes("ruling") && !LEGAL_DOCUMENT_CONTEXT_RE.test(subjectAndQuestionText)) {
          addIssue(issues, `${path}.documentKinds`, "invalid_value", "ruling requires an explicit legal or regulatory context");
        }
        validateUniqueStrings(issues, target.authorityHints, `${path}.authorityHints`, {
          minimum: 0,
          maximum: 8,
          maxLength: 160,
        });
        const queries = validateUniqueStrings(issues, target.queries, `${path}.queries`, {
          minimum: 1,
          maximum: 4,
          maxLength: 240,
        });
        [...queries].forEach((query, queryIndex) => {
          if (SEARCH_ARTIFACT_RE.test(query) || PRIVATE_RECORD_RE.test(query)) {
            addIssue(issues, `${path}.queries[${queryIndex}]`, "invalid_value", "must be a safe document-discovery query");
          }
        });
        validateEnumArray(issues, target.acceptedSourceRoles, `${path}.acceptedSourceRoles`, SOURCE_ROLES, 5);
        if (typeof target.fallback !== "boolean") {
          addIssue(issues, `${path}.fallback`, "invalid_type", "must be a boolean");
        }
      });
    }
  }
  questionIds.forEach((questionId) => {
    if (!coveredQuestionIds.has(questionId)) {
      addIssue(issues, "case.discoveryPlan.targets", "missing_value", `no discovery target covers ${questionId}`);
    }
    if (!primaryCoveredQuestionIds.has(questionId)) {
      addIssue(issues, "case.discoveryPlan.targets", "missing_value", `no non-fallback discovery target covers ${questionId}`);
    }
  });

  return issues.length === 0 ? { ok: true } : { ok: false, issues };
}
