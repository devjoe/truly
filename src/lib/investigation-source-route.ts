import type { EvidenceSourceRole } from "./claim-investigation-contract";
import type { InvestigationDocumentKind } from "./claim-investigation-case";
import type {
  AnsweringEvidenceObligation,
  IndependentOriginsObligation,
  InvestigationObligationSet,
  InvestigationProofObligation,
  SearchCoverageStopReason,
} from "./claim-investigation-obligations";

export const INVESTIGATION_SOURCE_ROUTE_VERSION = 2 as const;

export type InvestigationLocatorKind = "direct_url" | "registry_record" | "domain_index" | "open_web";
export type InvestigationRouteFamily = "canonical_record" | "contextual_discovery" | "lineage_diverse";
export type InvestigationSourceFamily =
  | "canonical_authority"
  | "official_record"
  | "first_party_statement"
  | "independent_reporting"
  | "domain_expert"
  | "historical_archive"
  | "counterparty_record";

export type InvestigationRouteTermProvenance = "claim_text" | "confirmed_metadata" | "case_plan" | "human_reviewed_source";

export interface InvestigationRouteTerm {
  value: string;
  provenance: InvestigationRouteTermProvenance;
  sourceRef?: string;
}

export interface InvestigationRouteBudget {
  maxQueries: number;
  maxDocuments: number;
  maxBytes: number;
  maxDurationMs: number;
}

export type InvestigationSourceLocator =
  | { kind: "direct_url"; url: string }
  | { kind: "registry_record"; registry: string; entityKey: string; filters: string[] }
  | { kind: "domain_index"; domain: string; query: string }
  | { kind: "open_web"; query: string };

export interface InvestigationLineageTarget {
  minimumDistinctOrigins: number;
  excludedOriginKeys: string[];
}

export interface InvestigationSourceRoute {
  version: typeof INVESTIGATION_SOURCE_ROUTE_VERSION;
  id: string;
  caseId: string;
  obligationIds: string[];
  routeFamily: InvestigationRouteFamily;
  sourceFamily: InvestigationSourceFamily;
  fallback: boolean;
  fallbackForRouteId?: string;
  lineageTarget?: InvestigationLineageTarget;
  hypothesis: string;
  hypothesisConfidence: "low" | "medium" | "high";
  hypothesisProvenance: InvestigationRouteTermProvenance;
  entityTerms: InvestigationRouteTerm[];
  institutionTerms: InvestigationRouteTerm[];
  requiredSourceRoles: EvidenceSourceRole[];
  expectedDocumentKinds: InvestigationDocumentKind[];
  locator: InvestigationSourceLocator;
  budget: InvestigationRouteBudget;
}

/** An obligation-driven acquisition plan. It is not evidence. */
export interface InvestigationSourceRouteLedger {
  version: typeof INVESTIGATION_SOURCE_ROUTE_VERSION;
  caseId: string;
  routes: InvestigationSourceRoute[];
}

export type InvestigationSourceFamilyPlan = InvestigationSourceRouteLedger;

export interface InvestigationRouteReceipt {
  version: typeof INVESTIGATION_SOURCE_ROUTE_VERSION;
  routeId: string;
  obligationIds: string[];
  queriesAttempted: number;
  documentsConsidered: number;
  documentsFetched: number;
  bytesFetched: number;
  durationMs: number;
  coveredSourceFamilies: InvestigationSourceFamily[];
  languages: string[];
  observedOriginKeys: string[];
  unresolvedBlindSpots: string[];
  stopReason: SearchCoverageStopReason;
  completedAt: string;
  evidenceProduced: false;
  verdictProduced: false;
}

const ID_RE = /^[a-z0-9][a-z0-9._:-]{0,127}$/iu;
const DOMAIN_RE = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/iu;
const LANGUAGE_RE = /^[a-z]{2,3}(?:-[A-Z][a-z]{3})?(?:-[A-Z]{2})?$/u;
const SOURCE_ROLES = new Set<EvidenceSourceRole>(["primary", "independent_secondary", "fact_check", "claim_origin", "user_supplied"]);
const DOCUMENT_KINDS = new Set<InvestigationDocumentKind>([
  "official_announcement", "official_record", "dataset", "ruling", "event_result", "product_documentation", "independent_report",
]);
const PROVENANCE = new Set<InvestigationRouteTermProvenance>(["claim_text", "confirmed_metadata", "case_plan", "human_reviewed_source"]);
const ROUTE_FAMILIES = new Set<InvestigationRouteFamily>(["canonical_record", "contextual_discovery", "lineage_diverse"]);
const SOURCE_FAMILIES = new Set<InvestigationSourceFamily>([
  "canonical_authority", "official_record", "first_party_statement", "independent_reporting",
  "domain_expert", "historical_archive", "counterparty_record",
]);
const STOP_REASONS = new Set<SearchCoverageStopReason>([
  "document_families_exhausted", "budget_exhausted", "time_cutoff_reached", "capability_unavailable", "access_denied",
]);
const SEARCH_ARTIFACT_RE = /https?:\/\/|\b(?:search|look up|query)\s+(?:on\s+)?(?:google|bing|duckduckgo)\b|\b(?:google|bing|duckduckgo)\s+(?:search|query)\s+(?:for|about)\b|(?:在|用|使用)(?:\s*)(?:google|bing|duckduckgo|搜尋引擎)(?:\s*)(?:搜尋|查詢)|(?:事實)?查核|真假|闢謠|辟谣/iu;

function unique(values: string[]): boolean { return new Set(values).size === values.length; }
function validIdList(values: string[], minimum = 1, maximum = 12): boolean {
  return Array.isArray(values) && values.length >= minimum && values.length <= maximum && unique(values) && values.every((id) => ID_RE.test(id));
}
function validStringList(values: string[], maximum: number, itemMaximum: number, pattern?: RegExp): boolean {
  return Array.isArray(values) && values.length <= maximum && unique(values) && values.every((value) => value.trim() && value.length <= itemMaximum && (!pattern || pattern.test(value)));
}
function validTerms(terms: InvestigationRouteTerm[], allowEmpty: boolean): boolean {
  return Array.isArray(terms) && (allowEmpty || terms.length > 0) && terms.length <= 16 &&
    unique(terms.map((entry) => entry.value.toLocaleLowerCase())) && terms.every((entry) =>
      entry.value.trim().length > 0 && entry.value.length <= 160 && PROVENANCE.has(entry.provenance) &&
      (entry.provenance === "claim_text" ? entry.sourceRef === undefined : Boolean(entry.sourceRef?.trim())));
}
function validBudget(budget: InvestigationRouteBudget): boolean {
  return Boolean(budget) && Number.isInteger(budget.maxQueries) && budget.maxQueries >= 1 && budget.maxQueries <= 8 &&
    Number.isInteger(budget.maxDocuments) && budget.maxDocuments >= 1 && budget.maxDocuments <= 12 &&
    Number.isInteger(budget.maxBytes) && budget.maxBytes >= 10_000 && budget.maxBytes <= 20_000_000 &&
    Number.isInteger(budget.maxDurationMs) && budget.maxDurationMs >= 1_000 && budget.maxDurationMs <= 600_000;
}
function validLocator(locator: InvestigationSourceLocator): boolean {
  if (!locator) return false;
  switch (locator.kind) {
    case "direct_url": { try { const parsed = new URL(locator.url); return parsed.protocol === "https:" || parsed.protocol === "http:"; } catch { return false; } }
    case "registry_record": return locator.registry.trim().length > 0 && locator.registry.length <= 120 && locator.entityKey.trim().length > 0 && locator.entityKey.length <= 160 && locator.filters.length <= 12 && unique(locator.filters) && locator.filters.every((entry) => entry.trim() && entry.length <= 160);
    case "domain_index": return DOMAIN_RE.test(locator.domain) && locator.query.trim().length >= 3 && locator.query.length <= 320 && !SEARCH_ARTIFACT_RE.test(locator.query);
    case "open_web": return locator.query.trim().length >= 3 && locator.query.length <= 320 && !SEARCH_ARTIFACT_RE.test(locator.query);
  }
}

/** Validate the local shape of a development-only acquisition plan. */
export function validateInvestigationSourceRouteLedger(ledger: InvestigationSourceRouteLedger): string[] {
  const issues: string[] = [];
  if (ledger.version !== INVESTIGATION_SOURCE_ROUTE_VERSION || !ID_RE.test(ledger.caseId) || !Array.isArray(ledger.routes) || ledger.routes.length < 1 || ledger.routes.length > 24) return ["invalid ledger boundary"];
  if (!unique(ledger.routes.map((route) => route.id))) issues.push("route IDs must be unique");
  const routeIds = new Set(ledger.routes.map((route) => route.id));
  ledger.routes.forEach((route, index) => {
    const prefix = `routes[${index}]`;
    if (route.version !== INVESTIGATION_SOURCE_ROUTE_VERSION || !ID_RE.test(route.id) || route.caseId !== ledger.caseId) issues.push(`${prefix}: invalid identity`);
    if (!validIdList(route.obligationIds)) issues.push(`${prefix}: invalid obligations`);
    if (!ROUTE_FAMILIES.has(route.routeFamily) || !SOURCE_FAMILIES.has(route.sourceFamily) || typeof route.fallback !== "boolean") issues.push(`${prefix}: invalid route family`);
    if (route.fallback) {
      if (!route.fallbackForRouteId || !routeIds.has(route.fallbackForRouteId) || route.fallbackForRouteId === route.id) issues.push(`${prefix}: invalid fallback relationship`);
    } else if (route.fallbackForRouteId !== undefined) issues.push(`${prefix}: non-fallback route cannot reference fallbackForRouteId`);
    if (route.routeFamily === "lineage_diverse") {
      if (!route.lineageTarget || !Number.isInteger(route.lineageTarget.minimumDistinctOrigins) || route.lineageTarget.minimumDistinctOrigins < 2 || route.lineageTarget.minimumDistinctOrigins > 8 || !validStringList(route.lineageTarget.excludedOriginKeys, 24, 160)) issues.push(`${prefix}: invalid lineage target`);
    } else if (route.lineageTarget !== undefined) issues.push(`${prefix}: lineage target belongs only to lineage-diverse routes`);
    if (!route.hypothesis.trim() || route.hypothesis.length > 320 || !PROVENANCE.has(route.hypothesisProvenance)) issues.push(`${prefix}: invalid hypothesis`);
    if (!validTerms(route.entityTerms, false) || !validTerms(route.institutionTerms, true)) issues.push(`${prefix}: invalid route terms`);
    if (!Array.isArray(route.requiredSourceRoles) || route.requiredSourceRoles.length < 1 || !unique(route.requiredSourceRoles) || route.requiredSourceRoles.some((role) => !SOURCE_ROLES.has(role))) issues.push(`${prefix}: invalid source roles`);
    if (!Array.isArray(route.expectedDocumentKinds) || route.expectedDocumentKinds.length < 1 || !unique(route.expectedDocumentKinds) || route.expectedDocumentKinds.some((kind) => !DOCUMENT_KINDS.has(kind))) issues.push(`${prefix}: invalid document kinds`);
    if (!validLocator(route.locator) || !validBudget(route.budget)) issues.push(`${prefix}: invalid locator or budget`);
  });
  ledger.routes.filter((route) => route.fallback).forEach((route) => {
    const primary = ledger.routes.find((entry) => entry.id === route.fallbackForRouteId);
    if (primary && !route.obligationIds.some((id) => primary.obligationIds.includes(id))) issues.push(`route ${route.id}: fallback must share an obligation with its primary route`);
    if (primary && JSON.stringify(primary.locator) === JSON.stringify(route.locator) && primary.sourceFamily === route.sourceFamily) issues.push(`route ${route.id}: fallback must use a distinct acquisition path`);
  });
  return issues;
}

function obligationNeedsCanonicalRoute(obligation: InvestigationProofObligation): obligation is AnsweringEvidenceObligation {
  return obligation.type === "answering_evidence" && Boolean(obligation.recordScope) && Boolean(obligation.acceptedSourceRoles?.length) && obligation.acceptedSourceRoles!.every((role) => role === "primary");
}
function obligationNeedsLineageRoute(obligation: InvestigationProofObligation): obligation is IndependentOriginsObligation {
  return obligation.type === "independent_origins";
}

export function validateInvestigationRouteReceipt(receipt: InvestigationRouteReceipt, route: InvestigationSourceRoute): string[] {
  const issues: string[] = [];
  if (receipt.version !== INVESTIGATION_SOURCE_ROUTE_VERSION || receipt.routeId !== route.id || receipt.evidenceProduced !== false || receipt.verdictProduced !== false) issues.push("invalid receipt boundary");
  if (!validIdList(receipt.obligationIds) || receipt.obligationIds.some((id) => !route.obligationIds.includes(id))) issues.push("invalid receipt obligations");
  if (!Number.isInteger(receipt.queriesAttempted) || receipt.queriesAttempted < 0 || receipt.queriesAttempted > route.budget.maxQueries ||
    !Number.isInteger(receipt.documentsConsidered) || receipt.documentsConsidered < 0 ||
    !Number.isInteger(receipt.documentsFetched) || receipt.documentsFetched < 0 || receipt.documentsFetched > receipt.documentsConsidered || receipt.documentsFetched > route.budget.maxDocuments ||
    !Number.isInteger(receipt.bytesFetched) || receipt.bytesFetched < 0 || receipt.bytesFetched > route.budget.maxBytes ||
    !Number.isInteger(receipt.durationMs) || receipt.durationMs < 0 || receipt.durationMs > route.budget.maxDurationMs) issues.push("receipt exceeds route budget");
  if (!validStringList(receipt.coveredSourceFamilies, 7, 80) || receipt.coveredSourceFamilies.some((family) => !SOURCE_FAMILIES.has(family))) issues.push("invalid covered source families");
  if (!validStringList(receipt.languages, 6, 35, LANGUAGE_RE) || receipt.languages.length < 1) issues.push("invalid receipt languages");
  if (!validStringList(receipt.observedOriginKeys, 24, 160) || !validStringList(receipt.unresolvedBlindSpots, 16, 240)) issues.push("invalid receipt coverage details");
  if (!STOP_REASONS.has(receipt.stopReason) || Number.isNaN(Date.parse(receipt.completedAt))) issues.push("invalid receipt completion");
  return issues;
}

/**
 * Cross-contract validation: a route portfolio must cover every mandatory
 * proof obligation, but route completion still cannot satisfy that obligation.
 */
export function validateInvestigationAcquisitionPortfolio(input: {
  ledger: InvestigationSourceRouteLedger;
  obligationSet: InvestigationObligationSet;
  receipts?: InvestigationRouteReceipt[];
}): string[] {
  const issues = validateInvestigationSourceRouteLedger(input.ledger);
  if (input.obligationSet.caseId !== input.ledger.caseId) issues.push("obligation set and route plan must reference the same case");
  const obligations = new Map(input.obligationSet.obligations.map((obligation) => [obligation.id, obligation]));
  input.ledger.routes.forEach((route) => route.obligationIds.forEach((id) => {
    if (!obligations.has(id)) issues.push(`route ${route.id}: unknown obligation ${id}`);
  }));
  for (const obligation of input.obligationSet.obligations.filter((entry) => entry.mandatory)) {
    const routes = input.ledger.routes.filter((route) => route.obligationIds.includes(obligation.id));
    if (!routes.some((route) => !route.fallback)) issues.push(`mandatory obligation ${obligation.id} requires a non-fallback route`);
    if (obligationNeedsCanonicalRoute(obligation) && !routes.some((route) => !route.fallback && route.routeFamily === "canonical_record")) issues.push(`canonical obligation ${obligation.id} requires a canonical-record route`);
    if (obligationNeedsLineageRoute(obligation) && !routes.some((route) => !route.fallback && route.routeFamily === "lineage_diverse" && (route.lineageTarget?.minimumDistinctOrigins ?? 0) >= obligation.minimumIndependentOrigins)) issues.push(`origin obligation ${obligation.id} requires a sufficient lineage-diverse route`);
  }
  if (new Set(input.ledger.routes.map((route) => route.routeFamily)).size > 3) issues.push("route family portfolio exceeds three families");
  if (input.receipts) {
    if (!unique(input.receipts.map((receipt) => receipt.routeId))) issues.push("route receipts must be unique");
    for (const route of input.ledger.routes) {
      const receipt = input.receipts.find((entry) => entry.routeId === route.id);
      if (!receipt) issues.push(`route ${route.id}: missing stopping receipt`);
      else issues.push(...validateInvestigationRouteReceipt(receipt, route).map((entry) => `route ${route.id}: ${entry}`));
    }
    input.receipts.filter((receipt) => !input.ledger.routes.some((route) => route.id === receipt.routeId)).forEach((receipt) => issues.push(`unknown route receipt ${receipt.routeId}`));
  }
  return issues;
}

export function summarizeInvestigationLocatorKinds(ledger: InvestigationSourceRouteLedger): Record<InvestigationLocatorKind, number> {
  const issues = validateInvestigationSourceRouteLedger(ledger);
  if (issues.length) throw new Error(issues.join("; "));
  const counts: Record<InvestigationLocatorKind, number> = { direct_url: 0, registry_record: 0, domain_index: 0, open_web: 0 };
  ledger.routes.forEach((route) => { counts[route.locator.kind] += 1; });
  return counts;
}
