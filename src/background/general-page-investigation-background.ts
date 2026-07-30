import type { Lang } from "../lib/types";
import type {
  GeneralPageAnalysisRequestMsg,
  GeneralPageInvestigationResultMsg,
} from "../lib/messages";
import {
  buildGeneralPageInvestigationActionPresentation,
  firstSurvivingGeneralPageInvestigationSelection,
} from "../lib/general-page-investigation-span-adapter";
import {
  generalPageInvestigationSelectionRejectionReason,
  generalPageInvestigationSourceRejectionReason,
} from "../lib/general-page-investigation-action-boundary";
import { buildInvestigationSpanCandidates } from "../lib/investigation-span-candidate";
import {
  callTierBGeneralPageInvestigationSpanAdapter,
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
 * Starts one low-priority semantic ranking job. The model may return up to
 * three eligible locally owned exact spans with tiers. Local hard boundaries
 * select the first surviving model-ranked result. Presentation tier only
 * controls the caution shown with that result. The panel receives one final
 * atomic result.
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
  const source = {
    title: request.context.title,
    authorName: request.context.authorName,
    sourceName: request.context.sourceName || request.context.domain,
    publishedAt: request.context.publishedAt,
    url: request.context.canonicalUrl || request.context.url,
  };
  const sourceRejectionReason =
    generalPageInvestigationSourceRejectionReason(source);
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
    maxProtocolAttempts: 1,
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
    const selection = firstSurvivingGeneralPageInvestigationSelection(
      selections,
      (candidate) => Boolean(
        sourceRejectionReason ||
          generalPageInvestigationSelectionRejectionReason(candidate, {
            authorizedSourceContext: request.context.mainText,
            source,
          }),
      ),
    );
    if (selection) {
      return {
        status: "prepared" as const,
        selection,
      };
    }
    return { status: "ineligible" as const };
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
