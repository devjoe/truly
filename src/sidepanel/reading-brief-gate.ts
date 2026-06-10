import type { DashboardPostEvent, UserSettings } from "../lib/types";
import { resolveLanguage } from "../lib/i18n";
import {
  resolveTierBFeatureGate,
  type FeatureReadinessEnvironment,
  type FeatureReadinessGate,
} from "../lib/feature-readiness";

export type ReadingBriefRequestBlockReason =
  | "missing_deep_analysis"
  | "fresh_brief_exists"
  | "pending"
  | "failed"
  | "inflight"
  | "feature_blocked";

export interface ReadingBriefRequestGateInput {
  event: DashboardPostEvent;
  settings: UserSettings;
  environment?: FeatureReadinessEnvironment;
  inflight?: boolean;
}

export interface ReadingBriefRequestGate {
  canRequest: boolean;
  featureGate: FeatureReadinessGate;
  blockReason?: ReadingBriefRequestBlockReason;
}

export function resolveReadingBriefRequestGate(input: ReadingBriefRequestGateInput): ReadingBriefRequestGate {
  const { event, settings, environment, inflight = false } = input;
  const featureGate = resolveTierBFeatureGate("reading_brief", settings, environment);
  const outputLang = resolveLanguage(settings.language);

  if (!event.decision.deepClassification) {
    return { canRequest: false, featureGate, blockReason: "missing_deep_analysis" };
  }
  if (event.decision.deepClassification.outputLang !== outputLang) {
    return { canRequest: false, featureGate, blockReason: "missing_deep_analysis" };
  }
  if (event.readingBrief && !event.readingBriefStale && event.readingBrief.outputLang === outputLang) {
    return { canRequest: false, featureGate, blockReason: "fresh_brief_exists" };
  }
  if (event.readingBriefPending) {
    return { canRequest: false, featureGate, blockReason: "pending" };
  }
  if (event.readingBriefError && !event.readingBriefStale) {
    return { canRequest: false, featureGate, blockReason: "failed" };
  }
  if (inflight) {
    return { canRequest: false, featureGate, blockReason: "inflight" };
  }
  if (!featureGate.canRun) {
    return { canRequest: false, featureGate, blockReason: "feature_blocked" };
  }
  return { canRequest: true, featureGate };
}
