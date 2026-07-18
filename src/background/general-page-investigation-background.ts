import type { GeneralPageBrief } from "../lib/general-page-analysis";
import type { Lang } from "../lib/types";
import type {
  GeneralPageAnalysisRequestMsg,
  GeneralPageInvestigationResultMsg,
} from "../lib/messages";
import {
  callTierBGeneralPageInvestigationAdapter,
  type TierBGeneralPageInvestigationAdapterRequest,
  type TierBGeneralPageInvestigationAdapterResult,
} from "../lib/tier-b-client";
import {
  ModelWorkScheduler,
  ModelWorkSupersededError,
} from "./model-work-scheduler";
import {
  preparePageClaimInvestigation,
} from "../sidepanel/page-claim-investigation";

export interface ScheduleGeneralPageInvestigationPreparationOptions {
  scheduler: ModelWorkScheduler;
  request: GeneralPageAnalysisRequestMsg;
  brief: GeneralPageBrief;
  endpoint: string;
  model: string;
  structuredOutputMode: TierBGeneralPageInvestigationAdapterRequest["structuredOutputMode"];
  apiKey?: string;
  resourceKey: string;
  callAdapter?: (
    request: TierBGeneralPageInvestigationAdapterRequest,
  ) => Promise<TierBGeneralPageInvestigationAdapterResult>;
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
    // Side panel may be closed. Preparation stays ephemeral and is discarded.
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

export function scheduleGeneralPageInvestigationPreparation(
  options: ScheduleGeneralPageInvestigationPreparationOptions,
): boolean {
  const candidateClaim = options.brief.claims?.[0];
  if (!candidateClaim || options.request.allowedUse === "page_overview_only" || options.request.screenshotDataUrl) return false;

  const { request } = options;
  const callAdapter = options.callAdapter ?? callTierBGeneralPageInvestigationAdapter;
  const source = {
    title: request.context.title,
    sourceName: request.context.sourceName || request.context.domain,
    publishedAt: request.context.publishedAt,
    url: request.context.canonicalUrl || request.context.url,
  };
  const adapterRequest: TierBGeneralPageInvestigationAdapterRequest = {
    endpoint: options.endpoint,
    model: options.model,
    structuredOutputMode: options.structuredOutputMode,
    apiKey: options.apiKey,
    candidateClaim,
    groundingText: request.context.mainText,
    source,
    sourceLang: investigationSourceLanguage(request.context.mainText, request.outputLang),
    outputLang: request.outputLang,
  };
  const id = `general-page-investigation:${request.tabId}:${request.scope}:${request.analysisKey}:0`;
  const work = options.scheduler.enqueue({
    id,
    resourceKey: options.resourceKey,
    priority: "derived",
    dedupeKey: id,
    supersedeKey: `general-page-investigation:${request.tabId}:${request.scope}`,
    // Semantic repair remains available to the private evaluation harness, but
    // runtime intentionally performs one adapter attempt only. The old-30
    // review found no accepted repair, so retrying here added latency without
    // producing a trustworthy user action.
    run: () => callAdapter(adapterRequest),
  });

  void work.then((result) => {
    const candidate = result.ok && result.value?.decision === "prepared"
      ? {
          ...result.value.claim,
          // The foreground reading already owns localized explanation copy.
          // The Adapter owns only the grounded claim/question projection.
          why: candidateClaim.why,
          need: candidateClaim.need,
        }
      : undefined;
    const preparation = candidate ? preparePageClaimInvestigation({
      analysisKey: request.analysisKey,
      scope: request.scope,
      claimIndex: 0,
      claim: candidate,
      groundingText: request.context.mainText,
      source,
    }) : undefined;
    const preparedClaim = preparation?.decision === "prepared" ? preparation.claim : undefined;
    sendSafely(options.sendMessage, {
      type: "GENERAL_PAGE_INVESTIGATION_RESULT",
      tabId: request.tabId,
      analysisKey: request.analysisKey,
      scope: request.scope,
      claimIndex: 0,
      status: preparedClaim
        ? "prepared"
        : result.ok && result.value?.decision === "abstain"
        ? "ineligible"
        : "unavailable",
      ...(preparedClaim ? { preparedClaim } : {}),
    });
  }).catch((error) => {
    if (error instanceof ModelWorkSupersededError) return;
    sendSafely(options.sendMessage, {
      type: "GENERAL_PAGE_INVESTIGATION_RESULT",
      tabId: request.tabId,
      analysisKey: request.analysisKey,
      scope: request.scope,
      claimIndex: 0,
      status: "unavailable",
    });
  });
  return true;
}
