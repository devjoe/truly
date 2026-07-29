import type { Lang } from "../lib/types";
import type {
  GeneralPageAnalysisRequestMsg,
  GeneralPageInvestigationResultMsg,
} from "../lib/messages";
import {
  buildGeneralPageInvestigationActionPresentation,
} from "../lib/general-page-investigation-span-adapter";
import { buildInvestigationSpanCandidates } from "../lib/investigation-span-candidate";
import {
  callTierBGeneralPageInvestigationActionAdmission,
  callTierBGeneralPageInvestigationActionTier,
  callTierBGeneralPageInvestigationSpanAdapter,
  type TierBGeneralPageInvestigationActionAdmissionRequest,
  type TierBGeneralPageInvestigationActionAdmissionResult,
  type TierBGeneralPageInvestigationActionTierRequest,
  type TierBGeneralPageInvestigationActionTierResult,
  type TierBGeneralPageInvestigationSpanAdapterRequest,
  type TierBGeneralPageInvestigationSpanAdapterResult,
} from "../lib/tier-b-client";
import {
  ModelWorkScheduler,
  ModelWorkSupersededError,
} from "./model-work-scheduler";
import {
  maybeCaptureGeneralPageInvestigation,
  type GeneralPageInvestigationCaptureBuffer,
} from "./general-page-investigation-capture";

const MAX_SPAN_CANDIDATES = 48;
const MAX_SPAN_CHARACTERS = 240;
const ACTION_ADMISSION_TIMEOUT_MS = 10_000;
const ACTION_TIER_TIMEOUT_MS = 10_000;

export interface ScheduleGeneralPageInvestigationPreparationOptions {
  scheduler: ModelWorkScheduler;
  request: GeneralPageAnalysisRequestMsg;
  endpoint: string;
  model: string;
  structuredOutputMode: TierBGeneralPageInvestigationSpanAdapterRequest["structuredOutputMode"];
  apiKey?: string;
  resourceKey: string;
  capture?: GeneralPageInvestigationCaptureBuffer;
  callAdapter?: (
    request: TierBGeneralPageInvestigationSpanAdapterRequest,
  ) => Promise<TierBGeneralPageInvestigationSpanAdapterResult>;
  callAdmission?: (
    request: TierBGeneralPageInvestigationActionAdmissionRequest,
  ) => Promise<TierBGeneralPageInvestigationActionAdmissionResult>;
  callTier?: (
    request: TierBGeneralPageInvestigationActionTierRequest,
  ) => Promise<TierBGeneralPageInvestigationActionTierResult>;
  sendMessage(message: GeneralPageInvestigationResultMsg): unknown;
}

function sendSafely(
  sendMessage: ScheduleGeneralPageInvestigationPreparationOptions["sendMessage"],
  message: GeneralPageInvestigationResultMsg,
): void {
  try {
    const result = sendMessage(message);
    if (result && typeof (result as PromiseLike<unknown>).then === "function") {
      void Promise.resolve(result).catch(() => undefined);
    }
  } catch {
    // The panel may be closed. Investigation state is intentionally ephemeral.
  }
}

function investigationSourceLanguage(text: string, fallback?: Lang): Lang | undefined {
  const latinCount = (text.match(/[A-Za-z]/g) ?? []).length;
  const hanCount = (text.match(/\p{Script=Han}/gu) ?? []).length;
  const counted = latinCount + hanCount;
  if (latinCount >= 24 && counted > 0 && latinCount / counted >= 0.7) return "en";
  if (hanCount >= 4) return "zh-TW";
  return fallback;
}

/**
 * Starts low-priority ranking, admission, and tier stages. The first model call
 * proposes up to three locally owned exact spans. Later stages evaluate those
 * backups in order, preferring the first primary result and otherwise retaining
 * the first exploratory result. Separate derived scheduler jobs let already
 * queued user work run between them, while the panel still receives only one
 * final atomic result.
 * Reading-model claims remain outside the action identity boundary.
 */
export function scheduleGeneralPageInvestigationPreparation(
  options: ScheduleGeneralPageInvestigationPreparationOptions,
): boolean {
  const { request } = options;
  if (request.scope !== "page" || request.context.targetKind !== "page" ||
    request.allowedUse === "page_overview_only" || request.screenshotDataUrl) return false;
  const candidates = buildInvestigationSpanCandidates(request.context.mainText, {
    maxCandidates: MAX_SPAN_CANDIDATES,
    maxCharacters: MAX_SPAN_CHARACTERS,
  });
  if (candidates.length === 0) return false;

  const callAdapter = options.callAdapter ?? callTierBGeneralPageInvestigationSpanAdapter;
  const callAdmission =
    options.callAdmission ?? callTierBGeneralPageInvestigationActionAdmission;
  const callTier = options.callTier ?? callTierBGeneralPageInvestigationActionTier;
  const source = {
    title: request.context.title,
    authorName: request.context.authorName,
    sourceName: request.context.sourceName || request.context.domain,
    publishedAt: request.context.publishedAt,
    url: request.context.canonicalUrl || request.context.url,
  };
  const adapterRequest: TierBGeneralPageInvestigationSpanAdapterRequest = {
    endpoint: options.endpoint,
    model: options.model,
    structuredOutputMode: options.structuredOutputMode,
    apiKey: options.apiKey,
    candidates,
    targetKind: request.context.targetKind,
    authorizedSourceContext: request.context.mainText,
    source,
    sourceLang: investigationSourceLanguage(request.context.mainText, request.outputLang),
    outputLang: request.outputLang,
  };
  maybeCaptureGeneralPageInvestigation(options.capture, request, adapterRequest);
  const id = `general-page-investigation:${request.tabId}:${request.scope}:${request.analysisKey}`;
  const selectionWork = options.scheduler.enqueue({
    id: `${id}:select`,
    resourceKey: options.resourceKey,
    priority: "derived",
    dedupeKey: `${id}:select`,
    supersedeKey: `general-page-investigation:${request.tabId}:${request.scope}:select`,
    run: () => callAdapter(adapterRequest),
  });

  void selectionWork.then(async (selectionResult) => {
    if (!selectionResult.ok || !selectionResult.value) {
      return { status: "unavailable" as const };
    }
    const selections = selectionResult.value.selections;
    if (selections.length === 0) {
      return { status: "ineligible" as const };
    }
    let exploratorySelection:
      | (typeof selections[number] & { presentationTier: "exploratory" })
      | undefined;
    for (const [index, selection] of selections.entries()) {
      const stage = index + 1;
      const admissionResult = await options.scheduler.enqueue({
        id: `${id}:admit:${stage}`,
        resourceKey: options.resourceKey,
        priority: "derived",
        dedupeKey: `${id}:admit:${stage}`,
        supersedeKey:
          `general-page-investigation:${request.tabId}:${request.scope}:admit:${stage}`,
        run: () => callAdmission({
          endpoint: options.endpoint,
          model: options.model,
          structuredOutputMode: options.structuredOutputMode,
          apiKey: options.apiKey,
          timeoutMs: ACTION_ADMISSION_TIMEOUT_MS,
          selection,
          authorizedSourceContext: request.context.mainText,
          source,
        }),
      });
      if (!admissionResult.ok || !admissionResult.value) {
        return { status: "unavailable" as const };
      }
      if (admissionResult.value.decision === "reject") continue;
      const tierResult = await options.scheduler.enqueue({
        id: `${id}:tier:${stage}`,
        resourceKey: options.resourceKey,
        priority: "derived",
        dedupeKey: `${id}:tier:${stage}`,
        supersedeKey:
          `general-page-investigation:${request.tabId}:${request.scope}:tier:${stage}`,
        run: () => callTier({
          endpoint: options.endpoint,
          model: options.model,
          structuredOutputMode: options.structuredOutputMode,
          apiKey: options.apiKey,
          timeoutMs: ACTION_TIER_TIMEOUT_MS,
          selection,
          authorizedSourceContext: request.context.mainText,
          source,
        }),
      });
      if (!tierResult.ok || !tierResult.value) {
        return { status: "unavailable" as const };
      }
      if (tierResult.value.tier === "primary") {
        return {
          status: "prepared" as const,
          selection: { ...selection, presentationTier: "primary" as const },
        };
      }
      exploratorySelection ??= {
        ...selection,
        presentationTier: "exploratory",
      };
    }
    return exploratorySelection
      ? { status: "prepared" as const, selection: exploratorySelection }
      : { status: "ineligible" as const };
  }).then((result) => {
    if (result.status === "unavailable") {
      sendSafely(options.sendMessage, {
        type: "GENERAL_PAGE_INVESTIGATION_RESULT",
        tabId: request.tabId,
        analysisKey: request.analysisKey,
        scope: request.scope,
        status: "unavailable",
      });
      return;
    }
    if (result.status === "ineligible") {
      sendSafely(options.sendMessage, {
        type: "GENERAL_PAGE_INVESTIGATION_RESULT",
        tabId: request.tabId,
        analysisKey: request.analysisKey,
        scope: request.scope,
        status: "ineligible",
      });
      return;
    }
    const preparedActions = [
      buildGeneralPageInvestigationActionPresentation(result.selection, {
        outputLang: request.outputLang,
        source,
      }),
    ];
    sendSafely(options.sendMessage, {
      type: "GENERAL_PAGE_INVESTIGATION_RESULT",
      tabId: request.tabId,
      analysisKey: request.analysisKey,
      scope: request.scope,
      status: "prepared",
      preparedActions,
    });
  }).catch((error) => {
    if (error instanceof ModelWorkSupersededError) return;
    sendSafely(options.sendMessage, {
      type: "GENERAL_PAGE_INVESTIGATION_RESULT",
      tabId: request.tabId,
      analysisKey: request.analysisKey,
      scope: request.scope,
      status: "unavailable",
    });
  });
  return true;
}
