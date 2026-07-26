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
  callTierBGeneralPageInvestigationSpanAdapter,
  type TierBGeneralPageInvestigationActionAdmissionRequest,
  type TierBGeneralPageInvestigationActionAdmissionResult,
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
  callAdmission?: (
    request: TierBGeneralPageInvestigationActionAdmissionRequest,
  ) => Promise<TierBGeneralPageInvestigationActionAdmissionResult>;
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
 * Starts one low-priority two-stage job. The first model call proposes one
 * locally owned exact span; the second only admits or rejects that selection.
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
  const work = options.scheduler.enqueue({
    id,
    resourceKey: options.resourceKey,
    priority: "derived",
    dedupeKey: id,
    supersedeKey: `general-page-investigation:${request.tabId}:${request.scope}`,
    run: async () => {
      const selectionResult = await callAdapter(adapterRequest);
      if (!selectionResult.ok || !selectionResult.value) {
        return { status: "unavailable" as const };
      }
      const selection = selectionResult.value.selections[0];
      if (!selection) {
        return { status: "ineligible" as const };
      }
      const admissionResult = await callAdmission({
        endpoint: options.endpoint,
        model: options.model,
        structuredOutputMode: options.structuredOutputMode,
        apiKey: options.apiKey,
        selection,
        authorizedSourceContext: request.context.mainText,
        source,
      });
      if (!admissionResult.ok || !admissionResult.value) {
        return { status: "unavailable" as const };
      }
      if (admissionResult.value.decision === "reject") {
        return { status: "ineligible" as const };
      }
      return { status: "prepared" as const, selection };
    },
  });

  void work.then((result) => {
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
