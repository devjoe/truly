import type { GeneralPageAnalysisRequestMsg } from "../lib/messages";
import type { TierBGeneralPageInvestigationSpanAdapterRequest } from "../lib/tier-b-client";

export const GENERAL_PAGE_INVESTIGATION_CAPTURE_SCHEMA_VERSION = 1 as const;

export interface GeneralPageInvestigationCaptureItem {
  schemaVersion: typeof GENERAL_PAGE_INVESTIGATION_CAPTURE_SCHEMA_VERSION;
  capturedAt: number;
  analysis: Pick<
    GeneralPageAnalysisRequestMsg,
    "tabId" | "analysisKey" | "scope" | "priority" | "context" | "allowedUse" | "outputLang"
  > & {
    hasScreenshot: boolean;
  };
  adapter: Omit<TierBGeneralPageInvestigationSpanAdapterRequest, "apiKey">;
}

export interface GeneralPageInvestigationCaptureBuffer {
  enabled: boolean;
  maxItems: number;
  items: GeneralPageInvestigationCaptureItem[];
}

export function createGeneralPageInvestigationCaptureBuffer(
  maxItems = 60,
): GeneralPageInvestigationCaptureBuffer {
  return {
    enabled: false,
    maxItems,
    items: [],
  };
}

export function maybeCaptureGeneralPageInvestigation(
  capture: GeneralPageInvestigationCaptureBuffer | undefined,
  request: GeneralPageAnalysisRequestMsg,
  adapterRequest: TierBGeneralPageInvestigationSpanAdapterRequest,
  now = Date.now(),
): void {
  if (!capture?.enabled) return;
  const { apiKey: _apiKey, ...adapter } = adapterRequest;
  capture.items.push({
    schemaVersion: GENERAL_PAGE_INVESTIGATION_CAPTURE_SCHEMA_VERSION,
    capturedAt: now,
    analysis: {
      tabId: request.tabId,
      analysisKey: request.analysisKey,
      scope: request.scope,
      priority: request.priority,
      context: request.context,
      allowedUse: request.allowedUse,
      outputLang: request.outputLang,
      hasScreenshot: Boolean(request.screenshotDataUrl),
    },
    adapter,
  });
  if (capture.items.length > capture.maxItems) {
    capture.items.splice(0, capture.items.length - capture.maxItems);
  }
}
