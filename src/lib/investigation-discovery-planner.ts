import type { InvestigationBundle } from "./claim-investigation-contract";
import type { InvestigationCase, InvestigationDiscoveryTarget } from "./claim-investigation-case";
import type {
  InvestigationObligationSet,
  InvestigationProofObligation,
} from "./claim-investigation-obligations";
import {
  INVESTIGATION_SOURCE_ROUTE_VERSION,
  validateInvestigationAcquisitionPortfolio,
  type InvestigationRouteBudget,
  type InvestigationRouteFamily,
  type InvestigationSourceFamily,
  type InvestigationSourceFamilyPlan,
  type InvestigationSourceRoute,
} from "./investigation-source-route";

export const INVESTIGATION_DISCOVERY_PLANNER_VERSION = 2 as const;

export interface InvestigationDiscoveryPlannerOptions {
  budget?: InvestigationRouteBudget;
}

const DEFAULT_ROUTE_BUDGET: InvestigationRouteBudget = {
  maxQueries: 2,
  maxDocuments: 4,
  maxBytes: 3_000_000,
  maxDurationMs: 45_000,
};

function routeFamilyFor(obligation: InvestigationProofObligation, target: InvestigationDiscoveryTarget): InvestigationRouteFamily {
  if (target.fallback) return "contextual_discovery";
  if (obligation.type === "independent_origins") return "lineage_diverse";
  if (obligation.type === "answering_evidence" && obligation.recordScope && obligation.acceptedSourceRoles?.every((role) => role === "primary")) return "canonical_record";
  return "contextual_discovery";
}

function sourceFamilyFor(routeFamily: InvestigationRouteFamily, target: InvestigationDiscoveryTarget): InvestigationSourceFamily {
  if (routeFamily === "lineage_diverse") return "independent_reporting";
  if (routeFamily === "canonical_record") {
    return target.documentKinds.some((kind) => ["official_record", "dataset", "ruling", "event_result", "product_documentation"].includes(kind))
      ? "official_record"
      : "canonical_authority";
  }
  if (target.documentKinds.includes("independent_report")) return "independent_reporting";
  const routeText = `${target.purpose} ${target.queries.join(" ")}`;
  if (/\b(?:history|historical|origin|earliest|first|introduced|founded|when)\b|歷史|沿革|起源|首次|最早|創立|何時/iu.test(routeText)) return "historical_archive";
  return target.acceptedSourceRoles.includes("primary") ? "first_party_statement" : "domain_expert";
}

function querySimilarity(query: string, question: string): number {
  const ngrams = (value: string): Set<string> => {
    const clean = value.normalize("NFKC").toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
    return new Set(Array.from({ length: Math.max(0, clean.length - 1) }, (_, index) => clean.slice(index, index + 2)));
  };
  const queryNgrams = ngrams(query);
  const questionNgrams = ngrams(question);
  return [...queryNgrams].filter((term) => questionNgrams.has(term)).length;
}

function makeRoute(input: {
  index: number;
  investigationCase: InvestigationCase;
  target: InvestigationDiscoveryTarget;
  obligation: InvestigationProofObligation;
  questionText: string;
  fallbackForRouteId?: string;
  budget: InvestigationRouteBudget;
}): InvestigationSourceRoute {
  const routeFamily = routeFamilyFor(input.obligation, input.target);
  const rankedQueries = input.target.queries.map((query, index) => ({ query, index, score: querySimilarity(query, input.questionText) }))
    .sort((a, b) => b.score - a.score || a.index - b.index);
  const baseQuery = rankedQueries[0].query;
  const query = routeFamily === "lineage_diverse" && !/\b(?:independent|report|reporting|analysis)\b|獨立|報導|報告|分析/iu.test(baseQuery)
    ? `${baseQuery} independent report`
    : baseQuery;
  const fallback = input.target.fallback;
  return {
    version: INVESTIGATION_SOURCE_ROUTE_VERSION,
    id: `route:${input.investigationCase.id.replace(/^case:/u, "")}:${input.index + 1}`,
    caseId: input.investigationCase.id,
    obligationIds: [input.obligation.id],
    routeFamily,
    sourceFamily: sourceFamilyFor(routeFamily, input.target),
    fallback,
    ...(fallback && input.fallbackForRouteId ? { fallbackForRouteId: input.fallbackForRouteId } : {}),
    ...(routeFamily === "lineage_diverse" ? {
      lineageTarget: {
        minimumDistinctOrigins: input.obligation.type === "independent_origins" ? input.obligation.minimumIndependentOrigins : 2,
        excludedOriginKeys: [],
      },
    } : {}),
    hypothesis: input.target.purpose,
    hypothesisConfidence: "medium",
    hypothesisProvenance: "case_plan",
    entityTerms: (input.investigationCase.discoveryContext.aliases.length
      ? input.investigationCase.discoveryContext.aliases
      : input.investigationCase.eventFrame.entities).slice(0, 8).map((value) => ({ value, provenance: "case_plan" as const, sourceRef: "case.discoveryContext" })),
    institutionTerms: input.investigationCase.discoveryContext.institutions.slice(0, 8).map((value) => ({ value, provenance: "case_plan", sourceRef: "case.discoveryContext" })),
    requiredSourceRoles: input.target.fallback
      ? input.target.acceptedSourceRoles
      : routeFamily === "lineage_diverse"
      ? ["independent_secondary"]
      : input.obligation.type === "answering_evidence" && input.obligation.acceptedSourceRoles?.length
        ? input.obligation.acceptedSourceRoles
        : input.target.acceptedSourceRoles,
    expectedDocumentKinds: routeFamily === "lineage_diverse" ? ["independent_report"] : input.target.documentKinds,
    locator: { kind: "open_web", query },
    budget: { ...input.budget },
  };
}

/**
 * Deterministically compiles a model-reviewed case into bounded route families.
 * It does not generate evidence, fetch a document, or produce a verdict.
 */
export function buildInvestigationSourceFamilyPlan(input: {
  bundle: InvestigationBundle;
  investigationCase: InvestigationCase;
  obligationSet: InvestigationObligationSet;
  options?: InvestigationDiscoveryPlannerOptions;
}): InvestigationSourceFamilyPlan {
  if (input.obligationSet.caseId !== input.investigationCase.id) throw new Error("Case and obligation set must match");
  const questionById = new Map(input.bundle.plan.questions.map((question) => [question.id, question]));
  const budget = input.options?.budget ?? DEFAULT_ROUTE_BUDGET;
  const routes: InvestigationSourceRoute[] = [];
  const primaryByKey = new Map<string, InvestigationSourceRoute>();
  const addOrMergeRoute = (target: InvestigationDiscoveryTarget, obligation: InvestigationProofObligation, fallbackForRouteId?: string): InvestigationSourceRoute => {
    const family = routeFamilyFor(obligation, target);
    const questionText = questionById.get(obligation.questionId)?.question;
    if (!questionText) throw new Error(`Unknown obligation question ${obligation.questionId}`);
    const rankedQueries = target.queries.map((query, index) => ({ query, index, score: querySimilarity(query, questionText) }))
      .sort((a, b) => b.score - a.score || a.index - b.index);
    const key = `${target.id}|${family}|${rankedQueries[0].query}|${target.fallback ? fallbackForRouteId ?? "missing" : "primary"}`;
    const existing = primaryByKey.get(key);
    if (existing) {
      if (!existing.obligationIds.includes(obligation.id)) existing.obligationIds.push(obligation.id);
      if (existing.lineageTarget && obligation.type === "independent_origins") {
        existing.lineageTarget.minimumDistinctOrigins = Math.max(existing.lineageTarget.minimumDistinctOrigins, obligation.minimumIndependentOrigins);
      }
      return existing;
    }
    const route = makeRoute({ index: routes.length, investigationCase: input.investigationCase, target, obligation, questionText, fallbackForRouteId, budget });
    routes.push(route);
    primaryByKey.set(key, route);
    return route;
  };
  for (const obligation of input.obligationSet.obligations.filter((entry) => entry.mandatory)) {
    const targets = input.investigationCase.discoveryPlan.targets.filter((target) => target.questionIds.includes(obligation.questionId));
    const primaryTarget = targets.find((target) => !target.fallback);
    if (!primaryTarget) throw new Error(`No non-fallback discovery target for ${obligation.id}`);
    const primary = addOrMergeRoute(primaryTarget, obligation);
    const fallbackTarget = targets.find((target) => target.fallback);
    const fallbackDuplicatesLineage = obligation.type === "independent_origins" && fallbackTarget?.documentKinds.includes("independent_report");
    if (fallbackTarget && !fallbackDuplicatesLineage && fallbackTarget.queries[0].trim().toLocaleLowerCase() !== primaryTarget.queries[0].trim().toLocaleLowerCase()) {
      addOrMergeRoute(fallbackTarget, obligation, primary.id);
    }
  }
  const plan: InvestigationSourceFamilyPlan = {
    version: INVESTIGATION_SOURCE_ROUTE_VERSION,
    caseId: input.investigationCase.id,
    routes,
  };
  const issues = validateInvestigationAcquisitionPortfolio({ ledger: plan, obligationSet: input.obligationSet });
  if (issues.length) throw new Error(`Invalid source-family plan: ${issues.join("; ")}`);
  return plan;
}
