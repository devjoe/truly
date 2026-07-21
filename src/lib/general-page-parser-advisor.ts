import type { ReadingSurfaceExtraction } from "./reading-surface-types";
import { GENERAL_PAGE_MIN_SELECTED_TEXT_LENGTH } from "./general-page-extraction";
import type {
  GeneralPageModelContext,
  GeneralPageModelQualityIssue,
  GeneralPageModelReadiness,
} from "./general-page-model-context";

export const GENERAL_PAGE_PARSER_ADVISOR_SCHEMA_VERSION = 1;
export const GENERAL_PAGE_ADVISOR_LANE = "general-page-advisor";
export const GENERAL_PAGE_ADVISOR_PROVIDER_CONFIG_SOURCE = "tier-b-provider";
export const GENERAL_PAGE_ADVISOR_UI_CONTEXT_LABEL = "Reading context";
export const GENERAL_PAGE_EFFECTIVE_MODEL_CONTEXT_CODE_NAME = "effectiveModelContext";
export const GENERAL_PAGE_PARSER_ADVISOR_TEXT_PREVIEW_LIMIT = 1200;
export const GENERAL_PAGE_PARSER_ADVISOR_FULL_TEXT_MAX_CHARS = 8000;
export const GENERAL_PAGE_PARSER_ADVISOR_MAX_PAYLOAD_CHARS = 12000;
export const GENERAL_PAGE_PARSER_ADVISOR_MAX_CANDIDATE_BLOCKS = 8;

export type GeneralPageParserAdvisorPageType =
  | "article"
  | "documentation"
  | "index_or_feed"
  | "social_thread"
  | "login_or_paywall"
  | "app_shell"
  | "unknown";

export type GeneralPageParserAdvisorDecision =
  | "accept_current"
  | "prefer_candidate_block"
  | "downgrade_to_index_or_feed"
  | "mark_blocked_or_empty"
  | "request_user_selection"
  | "request_screenshot_region";

export type GeneralPageParserAdvisorConfidence = "low" | "medium" | "high";

export type GeneralPageParserAdvisorLane = typeof GENERAL_PAGE_ADVISOR_LANE;
export type GeneralPageAdvisorProviderConfigSource = typeof GENERAL_PAGE_ADVISOR_PROVIDER_CONFIG_SOURCE;
export type GeneralPageParserAdvisorTrigger = "user_read_action";
export type GeneralPageParserAdvisorPersistence = "session-only";
export type GeneralPageParserAdvisorPayloadTextMode = "full" | "preview";
export type GeneralPageEffectiveModelContextUse =
  | "article_or_selection_analysis"
  | "page_overview_only"
  | "requires_user_target"
  | "blocked";

export interface GeneralPageParserAdvisorRuntimePolicy {
  lane: GeneralPageParserAdvisorLane;
  trigger: GeneralPageParserAdvisorTrigger;
  canAutoRunAfterReadIntent: true;
  canRunInBackground: false;
  providerConfigSource: GeneralPageAdvisorProviderConfigSource;
  resultPersistence: GeneralPageParserAdvisorPersistence;
  effectiveContextCodeName: typeof GENERAL_PAGE_EFFECTIVE_MODEL_CONTEXT_CODE_NAME;
  userFacingContextLabel: typeof GENERAL_PAGE_ADVISOR_UI_CONTEXT_LABEL;
  screenshot: {
    defaultRequiresConfirmation: true;
    autoScreenshotAllowed: boolean;
  };
}

export interface GeneralPageParserAdvisorPayloadBudget {
  fullTextMaxChars: number;
  maxPayloadChars: number;
  candidateBlockPreviewChars: number;
  maxCandidateBlocks: number;
  currentTextMode: GeneralPageParserAdvisorPayloadTextMode;
  estimatedPayloadChars: number;
  withinBudget: boolean;
}

export type GeneralPageParserAdvisorRiskTag =
  | "fallback_extraction"
  | "large_navigation_noise"
  | "no_main_content"
  | "short_text"
  | "index_or_feed"
  | "login_or_paywall"
  | "dynamic_content"
  | "candidate_block_ambiguous"
  | "needs_user_attention"
  | "needs_visual_grounding";

export interface GeneralPageParserAdvisorDocumentSignals {
  articleCount: number;
  mainCount: number;
  roleMainCount: number;
  paragraphCount: number;
  linkCount: number;
  imageCount: number;
  formCount: number;
  hasArticleMeta: boolean;
  hasOpenGraph: boolean;
}

export interface GeneralPageParserAdvisorCandidateBlock {
  id: string;
  label: string;
  role: "current-main-text" | "semantic-root" | "fallback-block" | "visible-region";
  textPreview: string;
  textLength: number;
  linkCount: number;
  imageCount: number;
}

export interface GeneralPageParserAdvisorEscalationPolicy {
  shouldAskModel: boolean;
  reasons: GeneralPageParserAdvisorRiskTag[];
  allowedDecisions: GeneralPageParserAdvisorDecision[];
}

export interface GeneralPageParserAdvisorRequest {
  schemaVersion: 1;
  lane: GeneralPageParserAdvisorLane;
  providerConfigSource: GeneralPageAdvisorProviderConfigSource;
  trigger: GeneralPageParserAdvisorTrigger;
  url: string;
  title?: string;
  targetKind: GeneralPageModelContext["targetKind"];
  extraction: ReadingSurfaceExtraction;
  modelReadiness: GeneralPageModelReadiness;
  qualityIssues: GeneralPageModelQualityIssue[];
  document?: GeneralPageParserAdvisorDocumentSignals;
  currentTextPreview: string;
  currentTextLength: number;
  candidateBlocks: GeneralPageParserAdvisorCandidateBlock[];
  escalation: GeneralPageParserAdvisorEscalationPolicy;
  payloadBudget: GeneralPageParserAdvisorPayloadBudget;
}

export interface GeneralPageEffectiveModelContext {
  codeName: typeof GENERAL_PAGE_EFFECTIVE_MODEL_CONTEXT_CODE_NAME;
  uiLabel: typeof GENERAL_PAGE_ADVISOR_UI_CONTEXT_LABEL;
  url: string;
  title?: string;
  mainText: string;
  modelEligible: boolean;
  modelReadiness: GeneralPageModelReadiness;
  allowedUse: GeneralPageEffectiveModelContextUse;
  pageType?: GeneralPageParserAdvisorPageType;
  appliedDecision: GeneralPageParserAdvisorDecision | "none";
  selectedBlockId?: string;
  source: "current-extraction" | "candidate-block" | "advisor-downgrade" | "advisor-block" | "user-target-required";
  trace: {
    deterministicSurfacePreserved: true;
    readingSurfaceOverwritten: false;
    advisorApplied: boolean;
  };
}

export interface GeneralPageParserAdvisorAdvice {
  schemaVersion: 1;
  pageType: GeneralPageParserAdvisorPageType;
  decision: GeneralPageParserAdvisorDecision;
  confidence: GeneralPageParserAdvisorConfidence;
  selectedBlockId?: string;
  needsUserSelection: boolean;
  needsScreenshot: boolean;
  riskTags: GeneralPageParserAdvisorRiskTag[];
  rationale: string;
}

export type GeneralPageParserAdvisorParseResult =
  | { ok: true; value: GeneralPageParserAdvisorAdvice }
  | { ok: false; error: string };

interface BuildGeneralPageEffectiveModelContextOptions {
  selectedBlockText?: string;
}

interface BuildGeneralPageParserAdvisorRequestOptions {
  candidateBlocks?: GeneralPageParserAdvisorCandidateBlock[];
  document?: GeneralPageParserAdvisorDocumentSignals;
  allowScreenshot?: boolean;
  payloadBudget?: Partial<Pick<GeneralPageParserAdvisorPayloadBudget, "fullTextMaxChars" | "maxPayloadChars" | "candidateBlockPreviewChars" | "maxCandidateBlocks">>;
}

const PAGE_TYPES = new Set<GeneralPageParserAdvisorPageType>([
  "article",
  "documentation",
  "index_or_feed",
  "social_thread",
  "login_or_paywall",
  "app_shell",
  "unknown",
]);

const DECISIONS = new Set<GeneralPageParserAdvisorDecision>([
  "accept_current",
  "prefer_candidate_block",
  "downgrade_to_index_or_feed",
  "mark_blocked_or_empty",
  "request_user_selection",
  "request_screenshot_region",
]);

const CONFIDENCES = new Set<GeneralPageParserAdvisorConfidence>([
  "low",
  "medium",
  "high",
]);

const RISK_TAGS = new Set<GeneralPageParserAdvisorRiskTag>([
  "fallback_extraction",
  "large_navigation_noise",
  "no_main_content",
  "short_text",
  "index_or_feed",
  "login_or_paywall",
  "dynamic_content",
  "candidate_block_ambiguous",
  "needs_user_attention",
  "needs_visual_grounding",
]);

export function resolveGeneralPageParserAdvisorRuntimePolicy(
  options: { autoScreenshotEnabled?: boolean } = {},
): GeneralPageParserAdvisorRuntimePolicy {
  return {
    lane: GENERAL_PAGE_ADVISOR_LANE,
    trigger: "user_read_action",
    canAutoRunAfterReadIntent: true,
    canRunInBackground: false,
    providerConfigSource: GENERAL_PAGE_ADVISOR_PROVIDER_CONFIG_SOURCE,
    resultPersistence: "session-only",
    effectiveContextCodeName: GENERAL_PAGE_EFFECTIVE_MODEL_CONTEXT_CODE_NAME,
    userFacingContextLabel: GENERAL_PAGE_ADVISOR_UI_CONTEXT_LABEL,
    screenshot: {
      defaultRequiresConfirmation: true,
      autoScreenshotAllowed: options.autoScreenshotEnabled === true,
    },
  };
}

export function buildGeneralPageParserAdvisorRequest(
  context: GeneralPageModelContext,
  options: BuildGeneralPageParserAdvisorRequestOptions = {},
): GeneralPageParserAdvisorRequest {
  const payloadBudget = resolvePayloadBudget(context.mainText, options.candidateBlocks ?? [], options.payloadBudget);
  const candidateBlocks = normalizeCandidateBlocks(options.candidateBlocks ?? [], payloadBudget);
  const escalation = resolveGeneralPageParserEscalation(context, {
    candidateBlocks,
    document: options.document,
    allowScreenshot: options.allowScreenshot ?? false,
  });

  return {
    schemaVersion: GENERAL_PAGE_PARSER_ADVISOR_SCHEMA_VERSION,
    lane: GENERAL_PAGE_ADVISOR_LANE,
    providerConfigSource: GENERAL_PAGE_ADVISOR_PROVIDER_CONFIG_SOURCE,
    trigger: "user_read_action",
    url: context.canonicalUrl || context.url,
    title: context.title,
    targetKind: context.targetKind,
    extraction: {
      method: context.qualityIssues.includes("fallback_extraction") ? "fallback" : "semantic-html",
      status: context.modelReadiness === "blocked" ? "blocked" : context.modelReadiness === "caution" ? "partial" : "complete",
      warnings: context.extractionWarnings as ReadingSurfaceExtraction["warnings"],
    },
    modelReadiness: context.modelReadiness,
    qualityIssues: [...context.qualityIssues],
    document: options.document,
    currentTextPreview: clampText(context.mainText, payloadBudget.currentTextMode === "full" ? payloadBudget.fullTextMaxChars : GENERAL_PAGE_PARSER_ADVISOR_TEXT_PREVIEW_LIMIT),
    currentTextLength: context.mainText.length,
    candidateBlocks,
    escalation,
    payloadBudget,
  };
}

export function resolveGeneralPageParserEscalation(
  context: GeneralPageModelContext,
  options: {
    candidateBlocks?: GeneralPageParserAdvisorCandidateBlock[];
    document?: GeneralPageParserAdvisorDocumentSignals;
    allowScreenshot?: boolean;
  } = {},
): GeneralPageParserAdvisorEscalationPolicy {
  const reasons: GeneralPageParserAdvisorRiskTag[] = [];
  const warnings = new Set(context.extractionWarnings);
  const issues = new Set(context.qualityIssues);

  if (issues.has("fallback_extraction"))
    reasons.push("fallback_extraction");
  const hasLargeNavigationNoise = issues.has("large_navigation_noise") || warnings.has("large-navigation-noise");
  if (hasLargeNavigationNoise)
    reasons.push("large_navigation_noise");
  const confidentArticleExtraction = hasConfidentArticleExtraction(context, options.document);
  if (!confidentArticleExtraction && (isDenseIndexLikeDocument(options.document) || isMultiArticleTeaserHub(options.document) || (hasLargeNavigationNoise && isLikelyIndexLikeNoisyDocument(options.document))))
    reasons.push("index_or_feed");
  if (issues.has("no_main_content") || warnings.has("no-main-content"))
    reasons.push("no_main_content");
  if (issues.has("dynamic_content_partial") || warnings.has("dynamic-content-partial"))
    reasons.push("dynamic_content");
  if (context.ineligibilityReason === "empty_or_blocked" || warnings.has("login-or-paywall-like"))
    reasons.push("login_or_paywall");
  if (context.ineligibilityReason === "main_text_too_short")
    reasons.push("short_text");
  const selectableCandidateBlocks = options.candidateBlocks?.filter((block) => block.role !== "current-main-text") ?? [];
  if (selectableCandidateBlocks.length > 0 && context.modelReadiness !== "ready")
    reasons.push("candidate_block_ambiguous");

  const uniqueReasons = uniqueRiskTags(reasons);
  const failClosedReasons = new Set<GeneralPageParserAdvisorRiskTag>([
    "dynamic_content",
    "login_or_paywall",
  ]);
  const allowedDecisions: GeneralPageParserAdvisorDecision[] = ["accept_current"];
  const canPreferCandidate = selectableCandidateBlocks.length > 0 &&
    !uniqueReasons.some((reason) => failClosedReasons.has(reason));
  if (canPreferCandidate)
    allowedDecisions.push("prefer_candidate_block");
  allowedDecisions.push("downgrade_to_index_or_feed", "mark_blocked_or_empty", "request_user_selection");
  if (options.allowScreenshot)
    allowedDecisions.push("request_screenshot_region");

  return {
    shouldAskModel: !confidentArticleExtraction && (context.modelReadiness !== "ready" || uniqueReasons.length > 0),
    reasons: uniqueReasons,
    allowedDecisions: allowedDecisions,
  };
}

export function buildGeneralPageParserAdvisorSystemPrompt(): string {
  return [
    "You are a web-page parser recovery classifier for Truly.",
    "Return JSON only. Do not summarize the page and do not answer the user.",
    "Choose one recovery decision from the allowedDecisions supplied by the user message.",
    "If the current extraction is a homepage, index, search result, social feed, or card grid, choose downgrade_to_index_or_feed.",
    "If a candidate block is clearly the article body, choose prefer_candidate_block and set selectedBlockId.",
    "If the page is blocked, empty, or app-shell-only, choose mark_blocked_or_empty or request_user_selection.",
    "Set request_screenshot_region only when visual grounding is necessary and allowed.",
    "Schema: {\"schemaVersion\":1,\"pageType\":\"article|documentation|index_or_feed|social_thread|login_or_paywall|app_shell|unknown\",\"decision\":\"accept_current|prefer_candidate_block|downgrade_to_index_or_feed|mark_blocked_or_empty|request_user_selection|request_screenshot_region\",\"confidence\":\"low|medium|high\",\"selectedBlockId\":\"optional candidate id\",\"needsUserSelection\":false,\"needsScreenshot\":false,\"riskTags\":[\"fallback_extraction\"],\"rationale\":\"short reason\"}",
  ].join("\n");
}

export function buildGeneralPageParserAdvisorUserPrompt(request: GeneralPageParserAdvisorRequest): string {
  const lines = [
    "## Parser Recovery Request",
    `url: ${request.url}`,
    request.title ? `title: ${request.title}` : undefined,
    `targetKind: ${request.targetKind}`,
    `modelReadiness: ${request.modelReadiness}`,
    `qualityIssues: ${request.qualityIssues.join(", ") || "none"}`,
    `warnings: ${request.extraction.warnings.join(", ") || "none"}`,
    `allowedDecisions: ${request.escalation.allowedDecisions.join(", ")}`,
    `escalationReasons: ${request.escalation.reasons.join(", ") || "none"}`,
    request.document ? `documentSignals: ${JSON.stringify(request.document)}` : undefined,
    "",
    "## Current Extraction",
    `textLength: ${request.currentTextLength}`,
    request.currentTextPreview,
  ];

  if (request.candidateBlocks.length > 0) {
    lines.push("", "## Candidate Blocks");
    for (const block of request.candidateBlocks) {
      lines.push(
        `id: ${block.id}`,
        `label: ${block.label}`,
        `role: ${block.role}`,
        `textLength: ${block.textLength}`,
        `linkCount: ${block.linkCount}`,
        `imageCount: ${block.imageCount}`,
        block.textPreview,
        "",
      );
    }
  }

  return lines.filter((line): line is string => typeof line === "string").join("\n");
}

export function parseGeneralPageParserAdvisorAdvice(
  raw: string,
  request: GeneralPageParserAdvisorRequest,
): GeneralPageParserAdvisorParseResult {
  const trimmed = raw.trim();
  if (!trimmed.startsWith("{") || !trimmed.endsWith("}"))
    return { ok: false, error: "not_json_only" };

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return { ok: false, error: "invalid_json" };
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
    return { ok: false, error: "invalid_shape" };

  const value = parsed as Record<string, unknown>;
  if (value.schemaVersion !== GENERAL_PAGE_PARSER_ADVISOR_SCHEMA_VERSION)
    return { ok: false, error: "unsupported_schema_version" };
  if (!isEnum(value.pageType, PAGE_TYPES))
    return { ok: false, error: "invalid_page_type" };
  if (!isEnum(value.decision, DECISIONS))
    return { ok: false, error: "invalid_decision" };
  if (!request.escalation.allowedDecisions.includes(value.decision))
    return { ok: false, error: "decision_not_allowed" };
  if (!isEnum(value.confidence, CONFIDENCES))
    return { ok: false, error: "invalid_confidence" };
  if (!Array.isArray(value.riskTags) || !value.riskTags.every((item) => isEnum(item, RISK_TAGS)))
    return { ok: false, error: "invalid_risk_tags" };
  if (typeof value.rationale !== "string" || value.rationale.trim().length === 0 || value.rationale.length > 240)
    return { ok: false, error: "invalid_rationale" };
  if (typeof value.needsUserSelection !== "boolean" || typeof value.needsScreenshot !== "boolean")
    return { ok: false, error: "invalid_recovery_flags" };
  if (value.decision === "prefer_candidate_block") {
    if (typeof value.selectedBlockId !== "string" || !request.candidateBlocks.some((block) => block.id === value.selectedBlockId))
      return { ok: false, error: "invalid_selected_block" };
  }
  if (value.needsScreenshot && !request.escalation.allowedDecisions.includes("request_screenshot_region"))
    return { ok: false, error: "screenshot_not_allowed" };

  return {
    ok: true,
    value: {
      schemaVersion: GENERAL_PAGE_PARSER_ADVISOR_SCHEMA_VERSION,
      pageType: value.pageType,
      decision: value.decision,
      confidence: value.confidence,
      selectedBlockId: typeof value.selectedBlockId === "string" ? value.selectedBlockId : undefined,
      needsUserSelection: value.needsUserSelection,
      needsScreenshot: value.needsScreenshot,
      riskTags: uniqueRiskTags(value.riskTags),
      rationale: value.rationale.trim(),
    },
  };
}

export function buildGeneralPageEffectiveModelContext(
  context: GeneralPageModelContext,
  request?: GeneralPageParserAdvisorRequest,
  advisor?: GeneralPageParserAdvisorAdvice,
  options: BuildGeneralPageEffectiveModelContextOptions = {},
): GeneralPageEffectiveModelContext {
  if (!advisor || advisor.decision === "accept_current") {
    return effectiveContext(context, {
      mainText: context.mainText,
      modelEligible: context.modelEligible,
      modelReadiness: context.modelReadiness,
      allowedUse: "article_or_selection_analysis",
      pageType: advisor?.pageType,
      appliedDecision: advisor?.decision ?? "none",
      source: "current-extraction",
      advisorApplied: Boolean(advisor),
    });
  }

  if (advisor.decision === "prefer_candidate_block") {
    const selectedBlock = request?.candidateBlocks.find((block) => block.id === advisor.selectedBlockId);
    const selectedBlockText = options.selectedBlockText?.trim();
    return effectiveContext(context, {
      mainText: selectedBlockText || selectedBlock?.textPreview || context.mainText,
      modelEligible: true,
      modelReadiness: advisor.confidence === "low" ? "caution" : "ready",
      allowedUse: "article_or_selection_analysis",
      pageType: advisor.pageType,
      appliedDecision: advisor.decision,
      selectedBlockId: selectedBlock?.id,
      source: "candidate-block",
      advisorApplied: true,
    });
  }

  if (advisor.decision === "downgrade_to_index_or_feed") {
    return effectiveContext(context, {
      mainText: context.mainText,
      modelEligible: true,
      modelReadiness: "caution",
      allowedUse: "page_overview_only",
      pageType: "index_or_feed",
      appliedDecision: advisor.decision,
      source: "advisor-downgrade",
      advisorApplied: true,
    });
  }

  if (advisor.decision === "request_user_selection" || advisor.decision === "request_screenshot_region") {
    return effectiveContext(context, {
      mainText: context.mainText,
      modelEligible: false,
      modelReadiness: "blocked",
      allowedUse: "requires_user_target",
      pageType: advisor.pageType,
      appliedDecision: advisor.decision,
      source: "user-target-required",
      advisorApplied: true,
    });
  }

  return effectiveContext(context, {
    mainText: "",
    modelEligible: false,
    modelReadiness: "blocked",
    allowedUse: "blocked",
    pageType: advisor.pageType,
    appliedDecision: advisor.decision,
    source: "advisor-block",
    advisorApplied: true,
  });
}

export function buildRuleBasedGeneralPageParserAdvice(
  request: GeneralPageParserAdvisorRequest,
): GeneralPageParserAdvisorAdvice {
  const reasons = new Set(request.escalation.reasons);
  const bestCandidate = bestCandidateBlock(request.candidateBlocks);

  if (request.targetKind === "selection" && request.currentTextLength >= GENERAL_PAGE_MIN_SELECTED_TEXT_LENGTH) {
    return advice("article", "accept_current", "high", request.escalation.reasons, "The user-selected text is the explicit reading target.");
  }

  if (reasons.has("index_or_feed")) {
    return advice("index_or_feed", "downgrade_to_index_or_feed", "high", uniqueRiskTags([...request.escalation.reasons, "index_or_feed"]), "Navigation or list-density signals are too strong to treat as one clean article.");
  }

  if (reasons.has("large_navigation_noise") && reasons.has("no_main_content")) {
    return advice("index_or_feed", "downgrade_to_index_or_feed", "medium", uniqueRiskTags([...request.escalation.reasons, "index_or_feed"]), "Fallback extraction came from a noisy page shell, so only page overview is safe.");
  }

  if (reasons.has("login_or_paywall")) {
    return advice("login_or_paywall", "mark_blocked_or_empty", "high", request.escalation.reasons, "Extraction appears blocked, empty, or login/paywall-like.");
  }

  if (reasons.has("dynamic_content")) {
    return advice("app_shell", "request_user_selection", "medium", uniqueRiskTags([...request.escalation.reasons, "needs_user_attention"]), "Current text appears to be a dynamic app shell or browser instruction page.");
  }

  if (bestCandidate && request.escalation.allowedDecisions.includes("prefer_candidate_block") && request.modelReadiness !== "ready") {
    return {
      ...advice("article", "prefer_candidate_block", "medium", uniqueRiskTags([...request.escalation.reasons, "candidate_block_ambiguous"]), "A candidate block is denser and cleaner than the current fallback extraction."),
      selectedBlockId: bestCandidate.id,
    };
  }

  if (reasons.has("short_text")) {
    return advice("unknown", "request_user_selection", "medium", uniqueRiskTags([...request.escalation.reasons, "needs_user_attention"]), "Current text is weak; user-selected text is the safest recovery path.");
  }

  return advice(inferReadyPageType(request), "accept_current", request.modelReadiness === "ready" ? "high" : "medium", request.escalation.reasons, "Current extraction is acceptable for model context.");
}

export function isGeneralPageParserAdvisorAdviceCompatible(
  request: GeneralPageParserAdvisorRequest,
  advisor: GeneralPageParserAdvisorAdvice,
): boolean {
  const reasons = new Set(request.escalation.reasons);
  if (
    (reasons.has("login_or_paywall") || reasons.has("dynamic_content")) &&
    advisor.decision !== "mark_blocked_or_empty" &&
    advisor.decision !== "request_user_selection" &&
    advisor.decision !== "request_screenshot_region"
  ) {
    return false;
  }
  if (
    advisor.decision === "accept_current" &&
    request.targetKind === "page" &&
    (reasons.has("index_or_feed") ||
      reasons.has("login_or_paywall") ||
      reasons.has("dynamic_content") ||
      reasons.has("no_main_content"))
  ) {
    return false;
  }
  if (advisor.decision === "prefer_candidate_block") {
    return request.candidateBlocks.some(
      (block) => block.id === advisor.selectedBlockId && block.role !== "current-main-text",
    );
  }
  return true;
}

function effectiveContext(
  context: GeneralPageModelContext,
  values: {
    mainText: string;
    modelEligible: boolean;
    modelReadiness: GeneralPageModelReadiness;
    allowedUse: GeneralPageEffectiveModelContextUse;
    pageType?: GeneralPageParserAdvisorPageType;
    appliedDecision: GeneralPageParserAdvisorDecision | "none";
    selectedBlockId?: string;
    source: GeneralPageEffectiveModelContext["source"];
    advisorApplied: boolean;
  },
): GeneralPageEffectiveModelContext {
  return {
    codeName: GENERAL_PAGE_EFFECTIVE_MODEL_CONTEXT_CODE_NAME,
    uiLabel: GENERAL_PAGE_ADVISOR_UI_CONTEXT_LABEL,
    url: context.canonicalUrl || context.url,
    title: context.title,
    mainText: values.mainText,
    modelEligible: values.modelEligible,
    modelReadiness: values.modelReadiness,
    allowedUse: values.allowedUse,
    pageType: values.pageType,
    appliedDecision: values.appliedDecision,
    selectedBlockId: values.selectedBlockId,
    source: values.source,
    trace: {
      deterministicSurfacePreserved: true,
      readingSurfaceOverwritten: false,
      advisorApplied: values.advisorApplied,
    },
  };
}

function resolvePayloadBudget(
  mainText: string,
  candidateBlocks: GeneralPageParserAdvisorCandidateBlock[],
  overrides: BuildGeneralPageParserAdvisorRequestOptions["payloadBudget"] = {},
): GeneralPageParserAdvisorPayloadBudget {
  const budget = {
    fullTextMaxChars: overrides.fullTextMaxChars ?? GENERAL_PAGE_PARSER_ADVISOR_FULL_TEXT_MAX_CHARS,
    maxPayloadChars: overrides.maxPayloadChars ?? GENERAL_PAGE_PARSER_ADVISOR_MAX_PAYLOAD_CHARS,
    candidateBlockPreviewChars: overrides.candidateBlockPreviewChars ?? GENERAL_PAGE_PARSER_ADVISOR_TEXT_PREVIEW_LIMIT,
    maxCandidateBlocks: overrides.maxCandidateBlocks ?? GENERAL_PAGE_PARSER_ADVISOR_MAX_CANDIDATE_BLOCKS,
  };
  const currentTextMode: GeneralPageParserAdvisorPayloadTextMode = mainText.length <= budget.fullTextMaxChars ? "full" : "preview";
  const currentTextChars = currentTextMode === "full"
    ? mainText.length
    : Math.min(mainText.length, GENERAL_PAGE_PARSER_ADVISOR_TEXT_PREVIEW_LIMIT);
  const candidateChars = candidateBlocks.slice(0, budget.maxCandidateBlocks).reduce((total, block) => {
    return total + Math.min(block.textPreview.length, budget.candidateBlockPreviewChars) + block.label.length + 64;
  }, 0);
  const estimatedPayloadChars = currentTextChars + candidateChars + 1200;
  return {
    ...budget,
    currentTextMode,
    estimatedPayloadChars,
    withinBudget: estimatedPayloadChars <= budget.maxPayloadChars,
  };
}

function advice(
  pageType: GeneralPageParserAdvisorPageType,
  decision: GeneralPageParserAdvisorDecision,
  confidence: GeneralPageParserAdvisorConfidence,
  riskTags: GeneralPageParserAdvisorRiskTag[],
  rationale: string,
): GeneralPageParserAdvisorAdvice {
  return {
    schemaVersion: GENERAL_PAGE_PARSER_ADVISOR_SCHEMA_VERSION,
    pageType,
    decision,
    confidence,
    needsUserSelection: decision === "request_user_selection",
    needsScreenshot: decision === "request_screenshot_region",
    riskTags: uniqueRiskTags(riskTags),
    rationale,
  };
}

function inferReadyPageType(request: GeneralPageParserAdvisorRequest): GeneralPageParserAdvisorPageType {
  const signals = `${request.url} ${request.title ?? ""}`.toLowerCase();
  if (/\b(?:docs?|documentation|handbook|reference|developer|api)\b/.test(signals))
    return "documentation";
  return "article";
}

function bestCandidateBlock(
  blocks: GeneralPageParserAdvisorCandidateBlock[],
): GeneralPageParserAdvisorCandidateBlock | undefined {
  return blocks
    .filter((block) => block.role !== "current-main-text" && block.textLength >= 240)
    .sort((a, b) => candidateScore(b) - candidateScore(a))[0];
}

function candidateScore(block: GeneralPageParserAdvisorCandidateBlock): number {
  return block.textLength - block.linkCount * 120 - block.imageCount * 20;
}

function normalizeCandidateBlocks(
  blocks: GeneralPageParserAdvisorCandidateBlock[],
  payloadBudget: GeneralPageParserAdvisorPayloadBudget,
): GeneralPageParserAdvisorCandidateBlock[] {
  const seen = new Set<string>();
  const clean: GeneralPageParserAdvisorCandidateBlock[] = [];
  for (const block of blocks) {
    if (!block.id || seen.has(block.id))
      continue;
    seen.add(block.id);
    clean.push({
      id: block.id,
      label: clampText(block.label, 80),
      role: block.role,
      textPreview: clampText(block.textPreview, payloadBudget.candidateBlockPreviewChars),
      textLength: Math.max(0, Math.floor(block.textLength)),
      linkCount: Math.max(0, Math.floor(block.linkCount)),
      imageCount: Math.max(0, Math.floor(block.imageCount)),
    });
    if (clean.length >= payloadBudget.maxCandidateBlocks)
      break;
  }
  return clean;
}

function isDenseIndexLikeDocument(document: GeneralPageParserAdvisorDocumentSignals | undefined): boolean {
  if (!document)
    return false;
  if (document.articleCount !== 1 && document.linkCount >= 100 && document.imageCount >= 20)
    return true;
  return document.articleCount >= 3 && document.linkCount >= 40 && document.paragraphCount <= 20;
}

function hasConfidentArticleExtraction(
  context: GeneralPageModelContext,
  document: GeneralPageParserAdvisorDocumentSignals | undefined,
): boolean {
  if (!document || context.mainText.length < 150)
    return false;
  if (context.qualityIssues.some((issue) => issue === "large_navigation_noise" || issue === "no_main_content" || issue === "dynamic_content_partial"))
    return false;
  if (context.extractionWarnings.some((warning) => warning !== "very-short-content"))
    return false;
  if (context.modelReadiness === "blocked")
    return false;
  if (context.extractionMethod === "fallback") {
    return context.extractionStatus === "complete" &&
      context.mainText.length >= 240 &&
      context.extractionWarnings.length === 0 &&
      context.qualityIssues.length === 0 &&
      document.hasArticleMeta;
  }
  if (context.extractionMethod !== "semantic-html")
    return false;
  if (document.hasArticleMeta)
    return true;
  if (context.mainText.length < 240)
    return false;
  const semanticMainCount = document.mainCount + document.roleMainCount;
  return semanticMainCount > 0 && document.paragraphCount >= 8;
}

function isMultiArticleTeaserHub(document: GeneralPageParserAdvisorDocumentSignals | undefined): boolean {
  if (!document || document.hasArticleMeta)
    return false;
  return document.articleCount >= 3 && document.paragraphCount <= Math.max(8, document.articleCount + 6);
}

function isLikelyIndexLikeNoisyDocument(document: GeneralPageParserAdvisorDocumentSignals | undefined): boolean {
  if (!document || document.hasArticleMeta)
    return false;
  const semanticMainCount = document.mainCount + document.roleMainCount;
  if (document.articleCount >= 2 && document.paragraphCount <= Math.max(8, document.articleCount + 6))
    return true;
  if (semanticMainCount > 0 && document.linkCount >= 3 && document.paragraphCount <= 6)
    return true;
  if (semanticMainCount > 0 && document.articleCount >= 1 && document.paragraphCount <= 8)
    return true;
  if (document.linkCount >= 3 && document.imageCount >= 3)
    return true;
  if (document.linkCount >= 20 && document.paragraphCount <= 12)
    return true;
  if (document.linkCount >= 5 && document.paragraphCount <= 4)
    return true;
  if (document.formCount > 0 && document.linkCount >= 6 && document.paragraphCount <= 8)
    return true;
  return false;
}

function uniqueRiskTags(tags: GeneralPageParserAdvisorRiskTag[]): GeneralPageParserAdvisorRiskTag[] {
  return [...new Set(tags)];
}

function clampText(value: string | undefined, maxLength: number): string {
  const clean = (value ?? "").replace(/\s+/g, " ").trim();
  return clean.length > maxLength ? clean.slice(0, maxLength).trim() : clean;
}

function isEnum<T extends string>(value: unknown, values: Set<T>): value is T {
  return typeof value === "string" && values.has(value as T);
}
