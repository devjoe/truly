import type { InvestigationBundle } from "./claim-investigation-contract";
import type { InvestigationQuestion } from "./claim-investigation-contract";
import { validateInvestigationBundle } from "./claim-investigation-contract";
import {
  INVESTIGATION_CASE_CONTRACT_VERSION,
  type InvestigationCase,
  type InvestigationDiscoveryTarget,
  type InvestigationDocumentKind,
  type InvestigationVerificationFacet,
  type InvestigationVerificationRequirement,
  validateInvestigationCase,
} from "./claim-investigation-case";
import type { Lang } from "./types";

export interface InvestigationCaseDraft {
  schemaVersion: 2;
  eventFrame: {
    description: string;
    entities: string[];
    time: string | null;
    place: string | null;
  };
  discoveryContext: {
    aliases: string[];
    institutions: string[];
    languages: string[];
    jurisdictions: string[];
    timeFrom: string | null;
    timeTo: string | null;
  };
  requirements: InvestigationVerificationRequirement[];
  targets: Omit<InvestigationDiscoveryTarget, "id">[];
  stoppingConditions: string[];
}

export type MaterializeInvestigationCaseResult =
  | { ok: true; investigationCase: InvestigationCase }
  | { ok: false; error: "invalid_bundle" | "invalid_draft" | "invalid_case"; detail?: string };

export const INVESTIGATION_CASE_DRAFT_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["schemaVersion", "eventFrame", "discoveryContext", "requirements", "targets", "stoppingConditions"],
  properties: {
    schemaVersion: { type: "integer", const: 2 },
    eventFrame: {
      type: "object",
      additionalProperties: false,
      required: ["description", "entities", "time", "place"],
      properties: {
        description: { type: "string", minLength: 6, maxLength: 320 },
        entities: {
          type: "array",
          minItems: 1,
          maxItems: 12,
          items: { type: "string", minLength: 1, maxLength: 120 },
        },
        time: { type: ["string", "null"], maxLength: 80 },
        place: { type: ["string", "null"], maxLength: 120 },
      },
    },
    discoveryContext: {
      type: "object",
      additionalProperties: false,
      required: ["aliases", "institutions", "languages", "jurisdictions", "timeFrom", "timeTo"],
      properties: {
        aliases: { type: "array", minItems: 0, maxItems: 24, items: { type: "string", minLength: 1, maxLength: 160 } },
        institutions: { type: "array", minItems: 0, maxItems: 12, items: { type: "string", minLength: 1, maxLength: 160 } },
        languages: { type: "array", minItems: 1, maxItems: 6, items: { type: "string", minLength: 2, maxLength: 35 } },
        jurisdictions: { type: "array", minItems: 0, maxItems: 8, items: { type: "string", minLength: 1, maxLength: 120 } },
        timeFrom: { type: ["string", "null"], maxLength: 40 },
        timeTo: { type: ["string", "null"], maxLength: 40 },
      },
    },
    requirements: {
      type: "array",
      minItems: 1,
      maxItems: 8,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["questionId", "requiredFacets", "acceptableSourceRoles"],
        properties: {
          questionId: { type: "string", minLength: 1, maxLength: 128 },
          requiredFacets: {
            type: "array",
            minItems: 1,
            maxItems: 7,
            items: { enum: ["actor", "predicate", "object", "attribution", "time", "place", "quantity"] },
          },
          acceptableSourceRoles: {
            type: "array",
            minItems: 1,
            maxItems: 3,
            items: { enum: ["primary", "independent_secondary", "claim_origin"] },
          },
        },
      },
    },
    targets: {
      type: "array",
      minItems: 1,
      maxItems: 6,
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "purpose", "questionIds", "documentKinds", "authorityHints", "queries",
          "acceptedSourceRoles", "fallback",
        ],
        properties: {
          purpose: { type: "string", minLength: 3, maxLength: 240 },
          questionIds: {
            type: "array",
            minItems: 1,
            maxItems: 8,
            items: { type: "string", minLength: 1, maxLength: 128 },
          },
          documentKinds: {
            type: "array",
            minItems: 1,
            maxItems: 4,
            items: {
              enum: [
                "official_announcement", "official_record", "dataset", "ruling",
                "event_result", "product_documentation", "independent_report",
              ],
            },
          },
          authorityHints: {
            type: "array",
            minItems: 0,
            maxItems: 8,
            items: { type: "string", minLength: 1, maxLength: 160 },
          },
          queries: {
            type: "array",
            minItems: 1,
            maxItems: 4,
            items: {
              type: "string",
              minLength: 3,
              maxLength: 240,
              description: "A broad document-discovery query, not an atomic verification question.",
            },
          },
          acceptedSourceRoles: {
            type: "array",
            minItems: 1,
            maxItems: 3,
            items: { enum: ["primary", "independent_secondary", "claim_origin"] },
          },
          fallback: { type: "boolean" },
        },
      },
    },
    stoppingConditions: {
      type: "array",
      minItems: 1,
      maxItems: 8,
      items: { type: "string", minLength: 3, maxLength: 240 },
    },
  },
} as const;

const DOCUMENT_KINDS = new Set<InvestigationDocumentKind>([
  "official_announcement", "official_record", "dataset", "ruling", "event_result",
  "product_documentation", "independent_report",
]);
const FACETS = new Set<InvestigationVerificationFacet>([
  "actor", "predicate", "object", "attribution", "time", "place", "quantity",
]);
const SOURCE_ROLES = new Set(["primary", "independent_secondary", "claim_origin"] as const);
type DiscoverySourceRole = "primary" | "independent_secondary" | "claim_origin";

function discoverySourceRoles(question: InvestigationQuestion): DiscoverySourceRole[] {
  const roles = question.preferredSourceRoles.flatMap<DiscoverySourceRole>((role) => {
    if (role === "primary" || role === "independent_secondary" || role === "claim_origin") return [role];
    if (role === "fact_check") return ["independent_secondary"];
    return [];
  });
  return [...new Set(roles.length > 0 ? roles : ["independent_secondary"] as const)];
}

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function text(value: unknown, maximum: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const clean = value.replace(/\s+/gu, " ").trim();
  return clean && Array.from(clean).length <= maximum ? clean : undefined;
}

function strings(value: unknown, minimum: number, maximum: number, maxLength: number): string[] | undefined {
  if (!Array.isArray(value) || value.length < minimum || value.length > maximum) return undefined;
  const result = value.map((entry) => text(entry, maxLength));
  if (result.some((entry) => !entry)) return undefined;
  return [...new Set(result as string[])];
}

function enumStrings<T extends string>(
  value: unknown,
  allowed: Set<T>,
  minimum: number,
  maximum: number,
): T[] | undefined {
  if (!Array.isArray(value) || value.length < minimum || value.length > maximum) return undefined;
  if (value.some((entry) => !allowed.has(entry as T))) return undefined;
  return [...new Set(value as T[])];
}

function normalizedGroundingText(value: string): string {
  return value.normalize("NFKC").toLocaleLowerCase().replace(/[\s\p{P}\p{S}]+/gu, "");
}

function groundedDiscoveryTerm(value: string, sourceText: string): boolean {
  const needle = normalizedGroundingText(value);
  return needle.length >= 2 && normalizedGroundingText(sourceText).includes(needle);
}

function groundedTimeBound(value: string | null, sourceText: string): string | null {
  if (!value) return null;
  if (groundedDiscoveryTerm(value, sourceText)) return value;
  const numericParts = value.match(/\d+/gu) ?? [];
  return numericParts.length > 0 && numericParts.every((part) => sourceText.includes(String(Number(part)))) ? value : null;
}

function sanitizeDiscoveryQuery(input: {
  query: string;
  sourceText: string;
  fallbackTerms: string[];
}): string {
  let query = input.query;
  const groundedNumbers = new Set((input.sourceText.match(/\d+/gu) ?? []).map((value) => String(Number(value))));
  query = query.replace(/\d+/gu, (value) => groundedNumbers.has(String(Number(value))) ? value : " ");
  query = query.replace(/\s+/gu, " ").trim();
  if (Array.from(query).length >= 3) return query;
  return input.fallbackTerms.filter(Boolean).join(" ").replace(/\s+/gu, " ").trim();
}

export function parseInvestigationCaseDraft(value: unknown): InvestigationCaseDraft | undefined {
  const root = record(value);
  const rawEventFrame = record(root?.eventFrame);
  const rawDiscoveryContext = record(root?.discoveryContext);
  if (!root || root.schemaVersion !== 2 || !rawEventFrame || !rawDiscoveryContext) return undefined;
  const description = text(rawEventFrame.description, 320);
  const entities = strings(rawEventFrame.entities, 1, 12, 120);
  const time = rawEventFrame.time === null ? null : text(rawEventFrame.time, 80);
  const place = rawEventFrame.place === null ? null : text(rawEventFrame.place, 120);
  if (!description || !entities || time === undefined || place === undefined) return undefined;

  const aliases = strings(rawDiscoveryContext.aliases, 0, 24, 160);
  const institutions = strings(rawDiscoveryContext.institutions, 0, 12, 160);
  const languages = strings(rawDiscoveryContext.languages, 1, 6, 35);
  const jurisdictions = strings(rawDiscoveryContext.jurisdictions, 0, 8, 120);
  const timeFrom = rawDiscoveryContext.timeFrom === null ? null : text(rawDiscoveryContext.timeFrom, 40);
  const timeTo = rawDiscoveryContext.timeTo === null ? null : text(rawDiscoveryContext.timeTo, 40);
  if (!aliases || !institutions || !languages || !jurisdictions || timeFrom === undefined || timeTo === undefined) return undefined;

  if (!Array.isArray(root.requirements) || root.requirements.length < 1 || root.requirements.length > 8) return undefined;
  const requirements: InvestigationVerificationRequirement[] = [];
  for (const value of root.requirements) {
    const item = record(value);
    const questionId = text(item?.questionId, 128);
    const requiredFacets = enumStrings(item?.requiredFacets, FACETS, 1, 7);
    const acceptableSourceRoles = enumStrings(item?.acceptableSourceRoles, SOURCE_ROLES, 1, 3);
    if (!questionId || !requiredFacets || !acceptableSourceRoles) return undefined;
    requirements.push({ questionId, requiredFacets, acceptableSourceRoles });
  }

  if (!Array.isArray(root.targets) || root.targets.length < 1 || root.targets.length > 6) return undefined;
  const targets: Omit<InvestigationDiscoveryTarget, "id">[] = [];
  for (const value of root.targets) {
    const item = record(value);
    const purpose = text(item?.purpose, 240);
    const questionIds = strings(item?.questionIds, 1, 8, 128);
    const documentKinds = enumStrings(item?.documentKinds, DOCUMENT_KINDS, 1, 4);
    const authorityHints = strings(item?.authorityHints, 0, 8, 160);
    const queries = strings(item?.queries, 1, 4, 240);
    const acceptedSourceRoles = enumStrings(item?.acceptedSourceRoles, SOURCE_ROLES, 1, 3);
    if (!purpose || !questionIds || !documentKinds || !authorityHints || !queries ||
      !acceptedSourceRoles || typeof item?.fallback !== "boolean") return undefined;
    targets.push({
      purpose,
      questionIds,
      documentKinds,
      authorityHints,
      queries,
      acceptedSourceRoles,
      fallback: item.fallback,
    });
  }
  const stoppingConditions = strings(root.stoppingConditions, 1, 8, 240);
  if (!stoppingConditions) return undefined;
  return {
    schemaVersion: 2,
    eventFrame: { description, entities, time, place },
    discoveryContext: { aliases, institutions, languages, jurisdictions, timeFrom, timeTo },
    requirements,
    targets,
    stoppingConditions,
  };
}

export function parseInvestigationCaseDraftContent(content: string): InvestigationCaseDraft | undefined {
  try {
    return parseInvestigationCaseDraft(JSON.parse(content));
  } catch {
    return undefined;
  }
}

/**
 * Explicit development-only recovery for a structurally valid model draft that
 * omitted non-fallback discovery coverage for a frozen verification question.
 * It reuses only the already-grounded question query and source-role contract;
 * it never adds an authority, domain, registry, date, place, or claim fact.
 */
export function completeMissingInvestigationDiscoveryCoverage(
  draft: InvestigationCaseDraft,
  bundle: InvestigationBundle,
): InvestigationCaseDraft | undefined {
  const normalized = parseInvestigationCaseDraft(draft);
  if (!normalized || !validateInvestigationBundle(bundle).ok) return undefined;
  const covered = new Set(normalized.targets.filter((target) => !target.fallback).flatMap((target) => target.questionIds));
  const missing = bundle.plan.questions.filter((question) => !covered.has(question.id));
  if (missing.length === 0) return normalized;
  const targets = [...normalized.targets];
  for (const question of missing) {
    const queries = question.queryCandidates.map((query) => query.trim()).filter((query) => Array.from(query).length >= 3);
    if (queries.length === 0) return undefined;
    const acceptedSourceRoles = discoverySourceRoles(question);
    const primaryOnly = acceptedSourceRoles.every((role) => role === "primary");
    if (targets.length >= 6) {
      const compatible = targets.find((target) => !target.fallback &&
        acceptedSourceRoles.some((role) => target.acceptedSourceRoles.includes(role)) &&
        (!primaryOnly || target.acceptedSourceRoles.every((role) => role === "primary")));
      if (!compatible) return undefined;
      compatible.questionIds = [...new Set([...compatible.questionIds, question.id])];
      continue;
    }
    targets.push({
      purpose: `Locate a document that can answer ${question.id}.`,
      questionIds: [question.id],
      documentKinds: primaryOnly ? ["official_record"] : ["independent_report"],
      authorityHints: [],
      queries: [...new Set(queries)].slice(0, 4),
      acceptedSourceRoles,
      fallback: false,
    });
  }
  return { ...normalized, targets };
}

export function materializeInvestigationCase(
  draft: InvestigationCaseDraft,
  bundle: InvestigationBundle,
  sampleId: string,
): MaterializeInvestigationCaseResult {
  if (!validateInvestigationBundle(bundle).ok || bundle.evidence.length > 0) {
    return { ok: false, error: "invalid_bundle" };
  }
  const normalized = parseInvestigationCaseDraft(draft);
  if (!normalized) return { ok: false, error: "invalid_draft" };
  const questionById = new Map(bundle.plan.questions.map((question) => [question.id, question]));
  const discoveryGroundingSource = [
    bundle.subject.originalSpan,
    bundle.subject.normalizedClaim,
    bundle.subject.proposition.originalSpan,
    bundle.subject.proposition.normalizedText,
    bundle.subject.attribution?.actor,
    ...bundle.plan.questions.map((question) => question.question),
  ].filter((entry): entry is string => Boolean(entry)).join(" ");
  const groundedContext = {
    aliases: normalized.discoveryContext.aliases.filter((entry) => groundedDiscoveryTerm(entry, discoveryGroundingSource)),
    institutions: normalized.discoveryContext.institutions.filter((entry) => groundedDiscoveryTerm(entry, discoveryGroundingSource)),
    languages: normalized.discoveryContext.languages,
    jurisdictions: normalized.discoveryContext.jurisdictions.filter((entry) => groundedDiscoveryTerm(entry, discoveryGroundingSource)),
    timeFrom: groundedTimeBound(normalized.discoveryContext.timeFrom, discoveryGroundingSource),
    timeTo: groundedTimeBound(normalized.discoveryContext.timeTo, discoveryGroundingSource),
  };
  const requirements = normalized.requirements.map((requirement) => {
    const question = questionById.get(requirement.questionId);
    if (!question) return requirement;
    return {
      ...requirement,
      requiredFacets: [...new Set([
        ...mandatoryFacetsForQuestion(question),
        ...requirement.requiredFacets,
      ])],
    };
  });
  const investigationCase: InvestigationCase = {
    version: INVESTIGATION_CASE_CONTRACT_VERSION,
    id: `case:${sampleId}`,
    subjectId: bundle.subject.id,
    eventFrame: {
      description: normalized.eventFrame.description,
      entities: normalized.eventFrame.entities,
      ...(normalized.eventFrame.time ? { time: normalized.eventFrame.time } : {}),
      ...(normalized.eventFrame.place ? { place: normalized.eventFrame.place } : {}),
    },
    discoveryContext: {
      aliases: groundedContext.aliases,
      institutions: groundedContext.institutions,
      languages: groundedContext.languages,
      jurisdictions: groundedContext.jurisdictions,
      ...((groundedContext.timeFrom || groundedContext.timeTo) ? {
        timeBounds: {
          ...(groundedContext.timeFrom ? { from: groundedContext.timeFrom } : {}),
          ...(groundedContext.timeTo ? { to: groundedContext.timeTo } : {}),
        },
      } : {}),
    },
    questionIds: bundle.plan.questions.map((question) => question.id),
    requirements,
    discoveryPlan: {
      version: INVESTIGATION_CASE_CONTRACT_VERSION,
      caseId: `case:${sampleId}`,
      targets: normalized.targets.map((target, index) => ({
        id: `target:${sampleId}:${index + 1}`,
        ...target,
        queries: [...new Set(target.queries.map((query) => sanitizeDiscoveryQuery({
          query,
          sourceText: discoveryGroundingSource,
          fallbackTerms: [
            groundedContext.institutions[0] ?? groundedContext.aliases[0] ?? bundle.subject.normalizedClaim,
            target.documentKinds[0].replaceAll("_", " "),
          ],
        })))],
      })),
      stoppingConditions: normalized.stoppingConditions,
    },
  };
  const validation = validateInvestigationCase(investigationCase, bundle);
  if (!validation.ok) {
    return {
      ok: false,
      error: "invalid_case",
      detail: validation.issues.slice(0, 8).map((entry) =>
        `${entry.path}: ${entry.message}`
      ).join("; "),
    };
  }
  return { ok: true, investigationCase };
}

function mandatoryFacetsForQuestion(question: InvestigationQuestion): InvestigationVerificationFacet[] {
  switch (question.purpose) {
    case "proposition":
      return ["actor", "predicate", "object"];
    case "identity":
      return ["actor", "predicate"];
    case "timeline":
      return ["actor", "predicate", "object", "time"];
    case "quantity":
      return ["actor", "predicate", "object", "quantity"];
    case "context":
    case "counterevidence":
      return ["predicate", "object"];
  }
}

export function investigationCasePlannerSystemPrompt(lang: Lang): string {
  const shared = `You plan document discovery for one already-approved Claim Investigation subject.

Keep two levels separate:
- Discovery targets and queries locate evidence-bearing documents at the event or document-family level.
- Atomic questions define what a fetched passage must answer later.

Rules:
1. Do not turn every atomic question into its own search query. Prefer one target and query portfolio that can cover several related question IDs.
2. A discovery query should name the main entity or authority, event or document family, and useful time/place anchors. It is not the verification criterion and must not presume the answer.
3. Prefer primary documents: official announcements, records, datasets, rulings, event results, or product documentation. Use each document kind only when it fits the subject. Add an independent-report target only as an explicit fallback when useful.
4. Use only facts explicitly present in SUBJECT and QUESTIONS. Do not invent organizations, dates, places, document titles, domains, or URLs.
5. authorityHints may name an authority explicitly present in SUBJECT or QUESTIONS. Otherwise use a generic role such as "responsible regulator"; do not guess a specific organization.
6. Queries must not contain URLs, Markdown, search-engine names, operating instructions, requests for private records, unresolved placeholders, or words such as fact-check, debunk, controversy, verify-whether, 查核, 真假, 爭議, 質疑, or 闢謠. Resolve relative dates from SUBJECT when possible; otherwise omit the date anchor.
7. Every question ID appears in exactly one requirement and at least one non-fallback discovery target. A fallback target is optional and never the only route for a question.
8. requiredFacets names what an exact answering passage must contain. Every question needs a predicate plus the actor/object/time/place/quantity/attribution dimensions necessary to answer it; a number or date alone is never sufficient.
9. Use ruling only for an explicit court, legal, regulatory, enforcement, or adjudication context. Do not use it as a generic official-document kind.
10. Use claim_origin only when a question asks what the original source said, attributed, or characterized. Claim-origin evidence can establish that wording or attribution, but never independently establish the underlying real-world proposition.
11. Search snippets are discovery hints only. The later stage must fetch a document and extract an exact passage.
12. Do not produce a truth verdict, evidence relation, citation, or answer to the claim.
13. discoveryContext is retrieval vocabulary only. Include only aliases, institutions, languages, jurisdictions and time bounds whose literal wording appears in SUBJECT or QUESTIONS. Do not translate, expand acronyms, infer a country, add a parent organization, or add a current date. Use BCP 47 language tags. Do not place conclusions or answers there.
14. Return only the schema-valid JSON object.`;
  return lang === "zh-TW"
    ? `${shared}\nWrite descriptions, purposes, queries, authority hints, and stopping conditions in Traditional Chinese when the source is Chinese. Preserve official proper nouns as written.`
    : `${shared}\nWrite all generated text in English.`;
}

export function investigationCasePlannerUserPrompt(bundle: InvestigationBundle): string {
  const questions = bundle.plan.questions.map((question) => ({
    id: question.id,
    basis: question.basis,
    purpose: question.purpose,
    question: question.question,
    preferredSourceRoles: question.preferredSourceRoles,
  }));
  return `SUBJECT:\n${JSON.stringify({
    normalizedClaim: bundle.subject.normalizedClaim,
    originalSpan: bundle.subject.originalSpan,
    attribution: bundle.subject.attribution ?? null,
    proposition: bundle.subject.proposition,
  })}\n\nQUESTIONS:\n${JSON.stringify(questions)}`;
}
