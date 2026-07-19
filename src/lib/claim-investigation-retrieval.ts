import type { EvidenceSourceRole, InvestigationBundle } from "./claim-investigation-contract";
import { validateInvestigationBundle } from "./claim-investigation-contract";
import type { InvestigationCase, InvestigationDiscoveryTarget } from "./claim-investigation-case";
import { validateInvestigationCase } from "./claim-investigation-case";

export type InvestigationRetrievalRoute =
  | "single_search"
  | "question_decomposition"
  | "authority_document_first"
  | "adaptive_evidence_cascade"
  | "case_document_discovery";

export type InvestigationRetrievalOperation =
  | "search_web"
  | "locate_authority"
  | "locate_document"
  | "fetch_document"
  | "extract_exact_passage"
  | "assess_sufficiency"
  | "search_secondary_fallback";

export type InvestigationRetrievalRunCondition =
  | "always"
  | "primary_unavailable_or_insufficient";

export type InvestigationRetrievalResultUse =
  | "discovery_only"
  | "candidate_document"
  | "exact_passage"
  | "sufficiency_assessment";

export interface InvestigationRetrievalStep {
  id: string;
  route: InvestigationRetrievalRoute;
  operation: InvestigationRetrievalOperation;
  phase: "discovery" | "question" | "authority" | "document" | "fetch" | "passage" | "assessment" | "fallback";
  caseId?: string;
  discoveryTargetId?: string;
  questionId?: string;
  questionIds?: string[];
  query?: string;
  acceptedSourceRoles: EvidenceSourceRole[];
  dependsOnStepIds: string[];
  runWhen: InvestigationRetrievalRunCondition;
  resultUse: InvestigationRetrievalResultUse;
  evidenceQualityDowngrade: boolean;
  requiresFetchedDocument: boolean;
  evidenceFromSnippetAllowed: false;
  verdictFromSnippetAllowed: false;
}

const ARTIFACT_RE = /https?:\/\/|\[[^\]]+\]\(|\b(?:search|look up|query)\s+(?:on\s+)?(?:google|bing|duckduckgo)\b|\b(?:google|bing|duckduckgo)\s+(?:search|query)\s+(?:for|about)\b|(?:在|用|使用)(?:\s*)(?:google|bing|duckduckgo|搜尋引擎)(?:\s*)(?:搜尋|查詢)/iu;
const PRIVATE_RECORD_RE = /\b(?:medical|patient) records?\b|(?:私人|非公開)?(?:病歷|醫療紀錄)/iu;

function cleanQuery(value: string): string | undefined {
  const clean = value.replace(/\s+/g, " ").trim().slice(0, 240);
  return clean.length >= 3 && !ARTIFACT_RE.test(clean) && !PRIVATE_RECORD_RE.test(clean) ? clean : undefined;
}

function uniqueQueries(values: string[]): string[] {
  return [...new Set(values.map(cleanQuery).filter((value): value is string => Boolean(value)))];
}

function buildAdaptiveEvidenceCascade(bundle: InvestigationBundle): InvestigationRetrievalStep[] {
  const route = "adaptive_evidence_cascade" as const;
  return bundle.plan.questions.flatMap((question, questionIndex): InvestigationRetrievalStep[] => {
    const ordinal = questionIndex + 1;
    const candidateQueries = uniqueQueries(question.queryCandidates);
    const questionQuery = cleanQuery(question.question);
    const queries = candidateQueries.length > 0 ? candidateQueries : (questionQuery ? [questionQuery] : []);
    if (queries.length === 0) return [];

    const querySteps: InvestigationRetrievalStep[] = queries.map((query, queryIndex) => ({
      id: `step:adaptive:${ordinal}:query:${queryIndex + 1}`,
      route,
      operation: "search_web",
      phase: "question",
      questionId: question.id,
      query,
      acceptedSourceRoles: ["primary"],
      dependsOnStepIds: [],
      runWhen: "always",
      resultUse: "discovery_only",
      evidenceQualityDowngrade: false,
      requiresFetchedDocument: false,
      evidenceFromSnippetAllowed: false,
      verdictFromSnippetAllowed: false,
    }));
    const authorityId = `step:adaptive:${ordinal}:authority`;
    const documentId = `step:adaptive:${ordinal}:document`;
    const fetchId = `step:adaptive:${ordinal}:fetch`;
    const passageId = `step:adaptive:${ordinal}:passage`;
    const assessmentId = `step:adaptive:${ordinal}:assessment`;
    const fallbackSearchId = `step:adaptive:${ordinal}:fallback:search`;
    const fallbackDocumentId = `step:adaptive:${ordinal}:fallback:document`;
    const fallbackFetchId = `step:adaptive:${ordinal}:fallback:fetch`;
    const fallbackPassageId = `step:adaptive:${ordinal}:fallback:passage`;

    const primarySteps: InvestigationRetrievalStep[] = [
      retrievalStep(authorityId, route, "locate_authority", "authority", question.id, ["primary"], querySteps.map((step) => step.id), "discovery_only"),
      retrievalStep(documentId, route, "locate_document", "document", question.id, ["primary"], [authorityId], "candidate_document"),
      retrievalStep(fetchId, route, "fetch_document", "fetch", question.id, ["primary"], [documentId], "candidate_document"),
      retrievalStep(passageId, route, "extract_exact_passage", "passage", question.id, ["primary"], [fetchId], "exact_passage", true),
      retrievalStep(assessmentId, route, "assess_sufficiency", "assessment", question.id, ["primary"], [passageId], "sufficiency_assessment", true),
    ];
    const fallbackRoles: EvidenceSourceRole[] = ["independent_secondary", "fact_check"];
    const fallbackSteps: InvestigationRetrievalStep[] = [
      {
        ...retrievalStep(fallbackSearchId, route, "search_secondary_fallback", "fallback", question.id, fallbackRoles, [assessmentId], "discovery_only"),
        query: queries[0],
        runWhen: "primary_unavailable_or_insufficient",
        evidenceQualityDowngrade: true,
      },
      fallbackStep(fallbackDocumentId, route, "locate_document", question.id, fallbackRoles, [fallbackSearchId], "candidate_document"),
      fallbackStep(fallbackFetchId, route, "fetch_document", question.id, fallbackRoles, [fallbackDocumentId], "candidate_document"),
      fallbackStep(fallbackPassageId, route, "extract_exact_passage", question.id, fallbackRoles, [fallbackFetchId], "exact_passage", true),
      fallbackStep(`step:adaptive:${ordinal}:fallback:assessment`, route, "assess_sufficiency", question.id, fallbackRoles, [fallbackPassageId], "sufficiency_assessment", true),
    ];
    return [...querySteps, ...primarySteps, ...fallbackSteps];
  });
}

function retrievalStep(
  id: string,
  route: InvestigationRetrievalRoute,
  operation: InvestigationRetrievalOperation,
  phase: InvestigationRetrievalStep["phase"],
  questionId: string,
  acceptedSourceRoles: EvidenceSourceRole[],
  dependsOnStepIds: string[],
  resultUse: InvestigationRetrievalResultUse,
  requiresFetchedDocument = false,
): InvestigationRetrievalStep {
  return {
    id, route, operation, phase, questionId, acceptedSourceRoles, dependsOnStepIds,
    runWhen: "always", resultUse, evidenceQualityDowngrade: false,
    requiresFetchedDocument, evidenceFromSnippetAllowed: false, verdictFromSnippetAllowed: false,
  };
}

function fallbackStep(
  id: string,
  route: InvestigationRetrievalRoute,
  operation: InvestigationRetrievalOperation,
  questionId: string,
  acceptedSourceRoles: EvidenceSourceRole[],
  dependsOnStepIds: string[],
  resultUse: InvestigationRetrievalResultUse,
  requiresFetchedDocument = false,
): InvestigationRetrievalStep {
  return {
    ...retrievalStep(id, route, operation, "fallback", questionId, acceptedSourceRoles, dependsOnStepIds, resultUse, requiresFetchedDocument),
    runWhen: "primary_unavailable_or_insufficient",
    evidenceQualityDowngrade: true,
  };
}

function caseStep(input: {
  id: string;
  operation: InvestigationRetrievalOperation;
  phase: InvestigationRetrievalStep["phase"];
  investigationCase: InvestigationCase;
  target: InvestigationDiscoveryTarget;
  dependsOnStepIds: string[];
  resultUse: InvestigationRetrievalResultUse;
  query?: string;
  questionId?: string;
  requiresFetchedDocument?: boolean;
}): InvestigationRetrievalStep {
  const runWhen = input.target.fallback ? "primary_unavailable_or_insufficient" : "always";
  return {
    id: input.id,
    route: "case_document_discovery",
    operation: input.operation,
    phase: input.phase,
    caseId: input.investigationCase.id,
    discoveryTargetId: input.target.id,
    questionId: input.questionId,
    questionIds: input.questionId ? [input.questionId] : [...input.target.questionIds],
    query: input.query,
    acceptedSourceRoles: [...input.target.acceptedSourceRoles],
    dependsOnStepIds: input.dependsOnStepIds,
    runWhen,
    resultUse: input.resultUse,
    evidenceQualityDowngrade: false,
    requiresFetchedDocument: input.requiresFetchedDocument ?? false,
    evidenceFromSnippetAllowed: false,
    verdictFromSnippetAllowed: false,
  };
}

/**
 * Build a document-first route. Discovery targets can serve multiple atomic
 * questions, so a document is fetched once and then fans out into per-question
 * passage extraction and sufficiency assessment.
 */
export function buildInvestigationCaseRetrievalRoute(
  bundle: InvestigationBundle,
  investigationCase: InvestigationCase,
): InvestigationRetrievalStep[] {
  if (!validateInvestigationBundle(bundle).ok || bundle.evidence.length > 0) return [];
  if (!validateInvestigationCase(investigationCase, bundle).ok) return [];

  const primaryAssessmentIdsByQuestion = new Map<string, string[]>();
  investigationCase.discoveryPlan.targets.forEach((target, targetIndex) => {
    if (target.fallback) return;
    target.questionIds.forEach((questionId, questionIndex) => {
      const ids = primaryAssessmentIdsByQuestion.get(questionId) ?? [];
      ids.push(`step:case:${targetIndex + 1}:assessment:${questionIndex + 1}`);
      primaryAssessmentIdsByQuestion.set(questionId, ids);
    });
  });

  return investigationCase.discoveryPlan.targets.flatMap((target, targetIndex) => {
    const prefix = `step:case:${targetIndex + 1}`;
    const fallbackDependencies = target.fallback
      ? [...new Set(target.questionIds.flatMap((questionId) => primaryAssessmentIdsByQuestion.get(questionId) ?? []))]
      : [];
    const querySteps = target.queries.map((query, queryIndex) => caseStep({
      id: `${prefix}:query:${queryIndex + 1}`,
      operation: target.fallback ? "search_secondary_fallback" : "search_web",
      phase: target.fallback ? "fallback" : "discovery",
      investigationCase,
      target,
      dependsOnStepIds: fallbackDependencies,
      resultUse: "discovery_only",
      query,
    }));
    const authorityId = `${prefix}:authority`;
    const documentId = `${prefix}:document`;
    const fetchId = `${prefix}:fetch`;
    const sharedSteps = [
      caseStep({
        id: authorityId,
        operation: "locate_authority",
        phase: target.fallback ? "fallback" : "authority",
        investigationCase,
        target,
        dependsOnStepIds: querySteps.map((step) => step.id),
        resultUse: "discovery_only",
      }),
      caseStep({
        id: documentId,
        operation: "locate_document",
        phase: target.fallback ? "fallback" : "document",
        investigationCase,
        target,
        dependsOnStepIds: [authorityId],
        resultUse: "candidate_document",
      }),
      caseStep({
        id: fetchId,
        operation: "fetch_document",
        phase: target.fallback ? "fallback" : "fetch",
        investigationCase,
        target,
        dependsOnStepIds: [documentId],
        resultUse: "candidate_document",
      }),
    ];
    const questionSteps = target.questionIds.flatMap((questionId, questionIndex) => {
      const passageId = `${prefix}:passage:${questionIndex + 1}`;
      return [
        caseStep({
          id: passageId,
          operation: "extract_exact_passage",
          phase: target.fallback ? "fallback" : "passage",
          investigationCase,
          target,
          questionId,
          dependsOnStepIds: [fetchId],
          resultUse: "exact_passage",
          requiresFetchedDocument: true,
        }),
        caseStep({
          id: `${prefix}:assessment:${questionIndex + 1}`,
          operation: "assess_sufficiency",
          phase: target.fallback ? "fallback" : "assessment",
          investigationCase,
          target,
          questionId,
          dependsOnStepIds: [passageId],
          resultUse: "sufficiency_assessment",
          requiresFetchedDocument: true,
        }),
      ];
    });
    return [...querySteps, ...sharedSteps, ...questionSteps];
  });
}

/** Build inspectable retrieval steps; adapters execute them separately. */
export function buildInvestigationRetrievalRoute(
  bundle: InvestigationBundle,
  route: InvestigationRetrievalRoute,
): InvestigationRetrievalStep[] {
  if (!validateInvestigationBundle(bundle).ok || bundle.evidence.length > 0) return [];
  if (route === "single_search") {
    const query = cleanQuery(bundle.subject.normalizedClaim);
    return query ? [{
      id: "step:single:1",
      route,
      operation: "search_web",
      phase: "discovery",
      query,
      acceptedSourceRoles: ["primary", "independent_secondary", "fact_check"],
      dependsOnStepIds: [],
      runWhen: "always",
      resultUse: "discovery_only",
      evidenceQualityDowngrade: false,
      requiresFetchedDocument: false,
      evidenceFromSnippetAllowed: false,
      verdictFromSnippetAllowed: false,
    }] : [];
  }

  const questionSteps = bundle.plan.questions.flatMap((question, questionIndex) =>
    uniqueQueries(question.queryCandidates).map((query, queryIndex) => ({
      id: `step:question:${questionIndex + 1}:${queryIndex + 1}`,
      route,
      operation: "search_web" as const,
      phase: "question" as const,
      questionId: question.id,
      query,
      acceptedSourceRoles: question.preferredSourceRoles.filter((role) => role !== "claim_origin" && role !== "user_supplied"),
      dependsOnStepIds: [],
      runWhen: "always" as const,
      resultUse: "discovery_only" as const,
      evidenceQualityDowngrade: false,
      requiresFetchedDocument: false,
      evidenceFromSnippetAllowed: false as const,
      verdictFromSnippetAllowed: false as const,
    })));
  if (route === "question_decomposition") return questionSteps;
  if (route === "adaptive_evidence_cascade") return buildAdaptiveEvidenceCascade(bundle);

  return bundle.plan.questions.flatMap((question, questionIndex) => {
    const query = uniqueQueries(question.queryCandidates)[0] ?? cleanQuery(question.question);
    if (!query) return [];
    const ordinal = questionIndex + 1;
    const authorityStepId = `step:authority:${ordinal}`;
    const documentStepId = `step:document:${ordinal}`;
    return [{
      id: authorityStepId,
      route,
      operation: "locate_authority",
      phase: "authority",
      questionId: question.id,
      query,
      acceptedSourceRoles: ["primary"],
      dependsOnStepIds: [],
      runWhen: "always",
      resultUse: "discovery_only",
      evidenceQualityDowngrade: false,
      requiresFetchedDocument: false,
      evidenceFromSnippetAllowed: false,
      verdictFromSnippetAllowed: false,
    }, {
      id: documentStepId,
      route,
      operation: "locate_document",
      phase: "document",
      questionId: question.id,
      query,
      acceptedSourceRoles: ["primary"],
      dependsOnStepIds: [authorityStepId],
      runWhen: "always",
      resultUse: "candidate_document",
      evidenceQualityDowngrade: false,
      requiresFetchedDocument: false,
      evidenceFromSnippetAllowed: false,
      verdictFromSnippetAllowed: false,
    }, {
      id: `step:passage:${ordinal}`,
      route,
      operation: "extract_exact_passage",
      phase: "passage",
      questionId: question.id,
      acceptedSourceRoles: ["primary"],
      dependsOnStepIds: [documentStepId],
      runWhen: "always",
      resultUse: "exact_passage",
      evidenceQualityDowngrade: false,
      requiresFetchedDocument: true,
      evidenceFromSnippetAllowed: false,
      verdictFromSnippetAllowed: false,
    }];
  });
}
