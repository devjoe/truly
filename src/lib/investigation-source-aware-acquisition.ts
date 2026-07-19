import type { EvidenceSourceRole, InvestigationBundle } from "./claim-investigation-contract";
import type { InvestigationCase, InvestigationDocumentKind, InvestigationVerificationFacet } from "./claim-investigation-case";
import type { InvestigationObligationSet } from "./claim-investigation-obligations";
import {
  INVESTIGATION_SOURCE_ROUTE_VERSION,
  validateInvestigationAcquisitionPortfolio,
  type InvestigationLocatorKind,
  type InvestigationRouteBudget,
  type InvestigationRouteFamily,
  type InvestigationSourceFamily,
  type InvestigationSourceLocator,
  type InvestigationSourceRoute,
} from "./investigation-source-route";

export const INVESTIGATION_SOURCE_AWARE_VERSION = 1 as const;
export type InvestigationSourceResponsibilityKind = "canonical_record" | "first_party_answer" | "independent_corroboration" | "counterevidence_discovery";

export interface InvestigationSourceResponsibility {
  version: typeof INVESTIGATION_SOURCE_AWARE_VERSION;
  id: string;
  caseId: string;
  questionId: string;
  obligationId: string;
  kind: InvestigationSourceResponsibilityKind;
  requiredSourceFamilies: InvestigationSourceFamily[];
  acceptedDocumentKinds: InvestigationDocumentKind[];
  requiredFacets: InvestigationVerificationFacet[];
  preferredLocatorKinds: InvestigationLocatorKind[];
  minimumIndependentOrigins?: number;
}

export type InvestigationTrustedLocator =
  | { kind: "registry_record"; registry: string; documentKinds: InvestigationDocumentKind[] }
  | { kind: "domain_index"; domain: string; documentKinds: InvestigationDocumentKind[] }
  | { kind: "direct_url"; url: string; documentKinds: InvestigationDocumentKind[] };

export interface InvestigationTrustedLocatorEntry {
  id: string;
  authorityNames: string[];
  jurisdictions: string[];
  languages: string[];
  sourceFamily: InvestigationSourceFamily;
  documentKinds: InvestigationDocumentKind[];
  locators: InvestigationTrustedLocator[];
  provenance: "human_reviewed_source";
  sourceRef: string;
  status: "active" | "suspended";
  reviewedAt: string;
  reviewDueAt: string;
}

export interface InvestigationTrustedLocatorCatalog {
  version: typeof INVESTIGATION_SOURCE_AWARE_VERSION;
  entries: InvestigationTrustedLocatorEntry[];
}

export interface InvestigationSourceAwareRoute {
  responsibility: InvestigationSourceResponsibility;
  route: InvestigationSourceRoute;
  queryPortfolio: string[];
  locatorState: "matched_catalog" | "open_web_fallback";
  catalogEntryId?: string;
  unresolvedLocatorReason?: "trusted_locator_unavailable" | "trusted_locator_not_applicable";
}

export interface InvestigationSourceAwareAcquisitionPlan {
  version: typeof INVESTIGATION_SOURCE_AWARE_VERSION;
  caseId: string;
  responsibilities: InvestigationSourceResponsibility[];
  routes: InvestigationSourceAwareRoute[];
  evidenceProduced: false;
  verdictProduced: false;
}

export interface InvestigationSourceAwarePlannerOptions { budget?: InvestigationRouteBudget }

const DEFAULT_BUDGET: InvestigationRouteBudget = { maxQueries: 2, maxDocuments: 4, maxBytes: 3_000_000, maxDurationMs: 45_000 };
const ID_RE = /^[a-z0-9][a-z0-9._:-]{0,127}$/iu;
const DOMAIN_RE = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/iu;
const LANGUAGE_RE = /^[a-z]{2,3}(?:-[A-Z][a-z]{3})?(?:-[A-Z]{2})?$/u;
const DOCUMENT_KINDS = new Set<InvestigationDocumentKind>(["official_announcement", "official_record", "dataset", "ruling", "event_result", "product_documentation", "independent_report"]);
const SOURCE_FAMILIES = new Set<InvestigationSourceFamily>(["canonical_authority", "official_record", "first_party_statement", "independent_reporting", "domain_expert", "historical_archive", "counterparty_record"]);

function unique(values: string[]): boolean { return new Set(values.map((value) => value.toLocaleLowerCase())).size === values.length; }
function validStrings(values: string[], minimum: number, maximum: number, itemMaximum = 160): boolean {
  return Array.isArray(values) && values.length >= minimum && values.length <= maximum && unique(values) && values.every((value) => typeof value === "string" && value.trim().length > 0 && value.length <= itemMaximum);
}
function normalize(value: string): string { return value.normalize("NFKC").toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, ""); }
function intersects<T>(left: T[], right: T[]): boolean { const values = new Set(left); return right.some((value) => values.has(value)); }
function safeUrl(value: string): boolean { try { return ["http:", "https:"].includes(new URL(value).protocol); } catch { return false; } }

export function validateInvestigationTrustedLocatorCatalog(catalog: InvestigationTrustedLocatorCatalog): string[] {
  const issues: string[] = [];
  if (catalog.version !== INVESTIGATION_SOURCE_AWARE_VERSION || !Array.isArray(catalog.entries) || catalog.entries.length > 128) return ["invalid catalog boundary"];
  if (new Set(catalog.entries.map((entry) => entry.id)).size !== catalog.entries.length) issues.push("catalog entry IDs must be unique");
  catalog.entries.forEach((entry, index) => {
    const prefix = `entries[${index}]`;
    if (!ID_RE.test(entry.id)) issues.push(`${prefix}: invalid identity`);
    if (!validStrings(entry.authorityNames, 1, 16) || !validStrings(entry.jurisdictions, 0, 8, 120) || !validStrings(entry.languages, 1, 6, 35) || entry.languages.some((language) => !LANGUAGE_RE.test(language))) issues.push(`${prefix}: invalid matching vocabulary`);
    if (!SOURCE_FAMILIES.has(entry.sourceFamily) || !Array.isArray(entry.documentKinds) || entry.documentKinds.length < 1 || new Set(entry.documentKinds).size !== entry.documentKinds.length || entry.documentKinds.some((kind) => !DOCUMENT_KINDS.has(kind))) issues.push(`${prefix}: invalid source coverage`);
    if (entry.provenance !== "human_reviewed_source" || !entry.sourceRef?.trim() || Number.isNaN(Date.parse(entry.reviewedAt))) issues.push(`${prefix}: invalid provenance`);
    const reviewedAt = Date.parse(entry.reviewedAt);
    const reviewDueAt = Date.parse(entry.reviewDueAt);
    if ((entry.status !== "active" && entry.status !== "suspended") || Number.isNaN(reviewDueAt) || reviewDueAt <= reviewedAt) issues.push(`${prefix}: invalid review lifecycle`);
    if (!Array.isArray(entry.locators) || entry.locators.length < 1 || entry.locators.length > 12) { issues.push(`${prefix}: invalid locators`); return; }
    entry.locators.forEach((locator, locatorIndex) => {
      const invalidKinds = !Array.isArray(locator.documentKinds) || locator.documentKinds.length < 1 || new Set(locator.documentKinds).size !== locator.documentKinds.length || locator.documentKinds.some((kind) => !entry.documentKinds.includes(kind));
      const invalidLocator = locator.kind === "registry_record" ? !ID_RE.test(locator.registry) : locator.kind === "domain_index" ? !DOMAIN_RE.test(locator.domain) : locator.kind === "direct_url" ? !safeUrl(locator.url) : true;
      if (invalidKinds || invalidLocator) issues.push(`${prefix}.locators[${locatorIndex}]: invalid locator`);
    });
  });
  return issues;
}

function targetDocumentKinds(investigationCase: InvestigationCase, questionId: string): InvestigationDocumentKind[] {
  return [...new Set(investigationCase.discoveryPlan.targets.filter((target) => !target.fallback && target.questionIds.includes(questionId)).flatMap((target) => target.documentKinds))];
}

export function compileInvestigationSourceResponsibilities(input: { bundle: InvestigationBundle; investigationCase: InvestigationCase; obligationSet: InvestigationObligationSet }): InvestigationSourceResponsibility[] {
  if (input.obligationSet.caseId !== input.investigationCase.id) throw new Error("Case and obligation set must match");
  const questionIds = new Set(input.bundle.plan.questions.map((question) => question.id));
  return input.obligationSet.obligations.filter((obligation) => obligation.mandatory).map((obligation) => {
    if (!questionIds.has(obligation.questionId) || !input.investigationCase.questionIds.includes(obligation.questionId)) throw new Error(`Unknown obligation question ${obligation.questionId}`);
    const discoveredKinds = targetDocumentKinds(input.investigationCase, obligation.questionId);
    const base = { version: INVESTIGATION_SOURCE_AWARE_VERSION, id: `responsibility:${obligation.id.replace(/^obligation:/u, "")}`, caseId: input.investigationCase.id, questionId: obligation.questionId, obligationId: obligation.id };
    if (obligation.type === "independent_origins") return { ...base, kind: "independent_corroboration" as const, requiredSourceFamilies: ["independent_reporting" as const], acceptedDocumentKinds: ["independent_report" as const], requiredFacets: obligation.requiredFacets, preferredLocatorKinds: ["open_web" as const], minimumIndependentOrigins: obligation.minimumIndependentOrigins };
    if (obligation.type === "counterevidence_search") return { ...base, kind: "counterevidence_discovery" as const, requiredSourceFamilies: ["counterparty_record" as const, "independent_reporting" as const], acceptedDocumentKinds: discoveredKinds.length ? discoveredKinds : ["independent_report" as const], requiredFacets: [] as InvestigationVerificationFacet[], preferredLocatorKinds: ["domain_index" as const, "open_web" as const] };
    const canonical = Boolean(obligation.recordScope) && Boolean(obligation.acceptedSourceRoles?.length) && obligation.acceptedSourceRoles!.every((role) => role === "primary");
    return canonical
      ? { ...base, kind: "canonical_record" as const, requiredSourceFamilies: ["official_record" as const], acceptedDocumentKinds: discoveredKinds.length ? discoveredKinds : ["official_record" as const], requiredFacets: obligation.requiredFacets, preferredLocatorKinds: ["registry_record" as const, "domain_index" as const, "open_web" as const] }
      : { ...base, kind: "first_party_answer" as const, requiredSourceFamilies: ["first_party_statement" as const], acceptedDocumentKinds: discoveredKinds.length ? discoveredKinds : ["official_announcement" as const], requiredFacets: obligation.requiredFacets, preferredLocatorKinds: ["domain_index" as const, "open_web" as const] };
  });
}

function queryScore(query: string, question: string): number {
  const tokens = (value: string) => new Set(value.normalize("NFKC").toLocaleLowerCase().split(/[^\p{L}\p{N}]+/gu).filter((token) => token.length > 1));
  const questionTokens = tokens(question);
  return [...tokens(query)].filter((token) => questionTokens.has(token)).length;
}

function queryForResponsibility(query: string, responsibility: InvestigationSourceResponsibility): string {
  if (responsibility.kind !== "independent_corroboration") return query.trim();
  return query
    .replace(/\b(?:official\s+(?:announcement|release|notice|blog)|press\s+release)\b/giu, " ")
    .replace(/(?:官方公告|官方發布|新聞稿|官網公告)/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
}

function buildQueryPortfolio(input: { bundle: InvestigationBundle; investigationCase: InvestigationCase; responsibility: InvestigationSourceResponsibility; maximum: number }): string[] {
  const question = input.bundle.plan.questions.find((entry) => entry.id === input.responsibility.questionId);
  if (!question) throw new Error(`Unknown question ${input.responsibility.questionId}`);
  const questionTargets = input.investigationCase.discoveryPlan.targets.filter((target) => target.questionIds.includes(input.responsibility.questionId));
  const independentTargets = questionTargets.filter((target) => target.documentKinds.includes("independent_report"));
  const selectedTargets = input.responsibility.kind === "independent_corroboration" && independentTargets.length > 0
    ? independentTargets
    : questionTargets.filter((target) => !target.fallback);
  const candidates = selectedTargets.flatMap((target) => target.queries)
    .map((query) => queryForResponsibility(query, input.responsibility))
    .filter((query) => Array.from(query).length >= 3)
    .map((query, index) => ({ query, index, score: queryScore(query, question.question) }))
    .sort((left, right) => right.score - left.score || left.index - right.index);
  const targetQueries = [...new Map(candidates.map((entry) => [entry.query.trim().toLocaleLowerCase(), entry.query.trim()])).values()];
  const questionQueries = question.queryCandidates
    .map((query) => queryForResponsibility(query, input.responsibility))
    .filter((query) => Array.from(query).length >= 3);
  return [...new Set([...targetQueries, ...questionQueries])].slice(0, input.maximum);
}

function matchingCatalogEntry(input: { catalog: InvestigationTrustedLocatorCatalog; investigationCase: InvestigationCase; responsibility: InvestigationSourceResponsibility }): InvestigationTrustedLocatorEntry | undefined {
  if (input.responsibility.kind === "independent_corroboration") return undefined;
  const targets = input.investigationCase.discoveryPlan.targets.filter((target) => !target.fallback && target.questionIds.includes(input.responsibility.questionId));
  const confirmedNames = new Set([...input.investigationCase.discoveryContext.institutions, ...targets.flatMap((target) => target.authorityHints)].map(normalize).filter(Boolean));
  return input.catalog.entries.find((entry) =>
    entry.status === "active" &&
    input.responsibility.requiredSourceFamilies.includes(entry.sourceFamily) &&
    entry.authorityNames.some((name) => confirmedNames.has(normalize(name))) &&
    intersects(entry.documentKinds, input.responsibility.acceptedDocumentKinds) &&
    intersects(entry.languages, input.investigationCase.discoveryContext.languages) &&
    (input.investigationCase.discoveryContext.jurisdictions.length === 0 || entry.jurisdictions.length === 0 || intersects(entry.jurisdictions.map(normalize), input.investigationCase.discoveryContext.jurisdictions.map(normalize))));
}

function locatorFromCatalog(input: { entry: InvestigationTrustedLocatorEntry; responsibility: InvestigationSourceResponsibility; investigationCase: InvestigationCase; query: string }): InvestigationSourceLocator | undefined {
  for (const kind of input.responsibility.preferredLocatorKinds) {
    const locator = input.entry.locators.find((candidate) => candidate.kind === kind && intersects(candidate.documentKinds, input.responsibility.acceptedDocumentKinds));
    if (!locator) continue;
    if (locator.kind === "registry_record") {
      const entityKey = input.investigationCase.discoveryContext.aliases[0] ?? input.investigationCase.eventFrame.entities[0];
      if (!entityKey) continue;
      const filters = [
        ...(input.investigationCase.discoveryContext.timeBounds?.from ? [`from:${input.investigationCase.discoveryContext.timeBounds.from}`] : []),
        ...(input.investigationCase.discoveryContext.timeBounds?.to ? [`to:${input.investigationCase.discoveryContext.timeBounds.to}`] : []),
        ...input.investigationCase.discoveryContext.jurisdictions.map((value) => `jurisdiction:${value}`),
      ];
      return { kind: "registry_record", registry: locator.registry, entityKey, filters };
    }
    if (locator.kind === "domain_index") return { kind: "domain_index", domain: locator.domain, query: input.query };
    if (locator.kind === "direct_url") return { kind: "direct_url", url: locator.url };
  }
  return undefined;
}

function routeFamily(responsibility: InvestigationSourceResponsibility): InvestigationRouteFamily {
  if (responsibility.kind === "canonical_record") return "canonical_record";
  if (responsibility.kind === "independent_corroboration") return "lineage_diverse";
  return "contextual_discovery";
}
function requiredSourceRoles(responsibility: InvestigationSourceResponsibility): EvidenceSourceRole[] {
  if (responsibility.kind === "independent_corroboration") return ["independent_secondary"];
  if (responsibility.kind === "counterevidence_discovery") return ["primary", "independent_secondary"];
  return ["primary"];
}

export function buildSourceAwareAcquisitionPlan(input: {
  bundle: InvestigationBundle;
  investigationCase: InvestigationCase;
  obligationSet: InvestigationObligationSet;
  catalog: InvestigationTrustedLocatorCatalog;
  options?: InvestigationSourceAwarePlannerOptions;
}): InvestigationSourceAwareAcquisitionPlan {
  const catalogIssues = validateInvestigationTrustedLocatorCatalog(input.catalog);
  if (catalogIssues.length) throw new Error(`Invalid trusted locator catalog: ${catalogIssues.join("; ")}`);
  const budget = input.options?.budget ?? DEFAULT_BUDGET;
  const responsibilities = compileInvestigationSourceResponsibilities(input);
  const routes = responsibilities.map((responsibility, index): InvestigationSourceAwareRoute => {
    const queryPortfolio = buildQueryPortfolio({ bundle: input.bundle, investigationCase: input.investigationCase, responsibility, maximum: budget.maxQueries });
    if (queryPortfolio.length === 0) throw new Error(`No grounded query portfolio for ${responsibility.id}`);
    const catalogEntry = matchingCatalogEntry({ catalog: input.catalog, investigationCase: input.investigationCase, responsibility });
    const trustedLocator = catalogEntry ? locatorFromCatalog({ entry: catalogEntry, responsibility, investigationCase: input.investigationCase, query: queryPortfolio[0] }) : undefined;
    const route: InvestigationSourceRoute = {
      version: INVESTIGATION_SOURCE_ROUTE_VERSION,
      id: `route:source-aware:${index + 1}:${responsibility.obligationId.replace(/^obligation:/u, "")}`,
      caseId: input.investigationCase.id,
      obligationIds: [responsibility.obligationId],
      routeFamily: routeFamily(responsibility),
      sourceFamily: responsibility.requiredSourceFamilies[0],
      fallback: false,
      ...(responsibility.kind === "independent_corroboration" ? { lineageTarget: { minimumDistinctOrigins: responsibility.minimumIndependentOrigins ?? 2, excludedOriginKeys: [] } } : {}),
      hypothesis: `Acquire ${responsibility.kind.replaceAll("_", " ")} documents for ${responsibility.questionId}`,
      hypothesisConfidence: trustedLocator ? "high" : "low",
      hypothesisProvenance: "case_plan",
      entityTerms: (input.investigationCase.discoveryContext.aliases.length ? input.investigationCase.discoveryContext.aliases : input.investigationCase.eventFrame.entities).slice(0, 8).map((value) => ({ value, provenance: "case_plan" as const, sourceRef: "case.discoveryContext" })),
      institutionTerms: input.investigationCase.discoveryContext.institutions.slice(0, 8).map((value) => ({ value, provenance: "case_plan" as const, sourceRef: "case.discoveryContext" })),
      requiredSourceRoles: requiredSourceRoles(responsibility),
      expectedDocumentKinds: responsibility.acceptedDocumentKinds,
      locator: trustedLocator ?? { kind: "open_web", query: queryPortfolio[0] },
      budget: { ...budget },
    };
    return trustedLocator && catalogEntry
      ? { responsibility, route, queryPortfolio, locatorState: "matched_catalog", catalogEntryId: catalogEntry.id }
      : { responsibility, route, queryPortfolio, locatorState: "open_web_fallback", unresolvedLocatorReason: responsibility.kind === "independent_corroboration" ? "trusted_locator_not_applicable" : "trusted_locator_unavailable" };
  });
  const plan: InvestigationSourceAwareAcquisitionPlan = { version: INVESTIGATION_SOURCE_AWARE_VERSION, caseId: input.investigationCase.id, responsibilities, routes, evidenceProduced: false, verdictProduced: false };
  const issues = validateSourceAwareAcquisitionPlan({ plan, obligationSet: input.obligationSet, catalog: input.catalog });
  if (issues.length) throw new Error(`Invalid source-aware acquisition plan: ${issues.join("; ")}`);
  return plan;
}

function catalogContainsRoute(entry: InvestigationTrustedLocatorEntry, locator: InvestigationSourceLocator): boolean {
  return entry.locators.some((candidate) => candidate.kind === locator.kind &&
    (candidate.kind === "registry_record" && locator.kind === "registry_record" ? candidate.registry === locator.registry
      : candidate.kind === "domain_index" && locator.kind === "domain_index" ? candidate.domain === locator.domain
      : candidate.kind === "direct_url" && locator.kind === "direct_url" ? candidate.url === locator.url
      : false));
}

export function validateSourceAwareAcquisitionPlan(input: { plan: InvestigationSourceAwareAcquisitionPlan; obligationSet: InvestigationObligationSet; catalog: InvestigationTrustedLocatorCatalog }): string[] {
  const issues = validateInvestigationTrustedLocatorCatalog(input.catalog);
  if (input.plan.version !== INVESTIGATION_SOURCE_AWARE_VERSION || input.plan.caseId !== input.obligationSet.caseId || input.plan.evidenceProduced !== false || input.plan.verdictProduced !== false) issues.push("invalid source-aware plan boundary");
  if (input.plan.responsibilities.length !== input.plan.routes.length || new Set(input.plan.responsibilities.map((entry) => entry.id)).size !== input.plan.responsibilities.length) issues.push("invalid responsibility coverage");
  const obligationIds = new Set(input.obligationSet.obligations.filter((entry) => entry.mandatory).map((entry) => entry.id));
  input.plan.routes.forEach((entry, index) => {
    const prefix = `routes[${index}]`;
    if (!obligationIds.has(entry.responsibility.obligationId) || entry.route.obligationIds.length !== 1 || entry.route.obligationIds[0] !== entry.responsibility.obligationId || entry.route.caseId !== input.plan.caseId) issues.push(`${prefix}: invalid responsibility binding`);
    if (!Array.isArray(entry.queryPortfolio) || entry.queryPortfolio.length < 1 || entry.queryPortfolio.length > entry.route.budget.maxQueries || !unique(entry.queryPortfolio) || entry.queryPortfolio.some((query) => !query.trim() || query.length > 320)) issues.push(`${prefix}: invalid query portfolio`);
    if ((entry.route.locator.kind === "open_web" || entry.route.locator.kind === "domain_index") && entry.route.locator.query !== entry.queryPortfolio[0]) issues.push(`${prefix}: primary query must match the route locator`);
    if (entry.locatorState === "matched_catalog") {
      const catalogEntry = input.catalog.entries.find((candidate) => candidate.id === entry.catalogEntryId);
      if (!catalogEntry || entry.unresolvedLocatorReason !== undefined || !catalogContainsRoute(catalogEntry, entry.route.locator)) issues.push(`${prefix}: invalid catalog match`);
    } else if (entry.catalogEntryId !== undefined || entry.route.locator.kind !== "open_web" || !entry.unresolvedLocatorReason) issues.push(`${prefix}: invalid open-web fallback`);
  });
  issues.push(...validateInvestigationAcquisitionPortfolio({ ledger: { version: INVESTIGATION_SOURCE_ROUTE_VERSION, caseId: input.plan.caseId, routes: input.plan.routes.map((entry) => entry.route) }, obligationSet: input.obligationSet }));
  return issues;
}
