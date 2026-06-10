import type { TierAProvider, TierBProvider, UserSettings } from "./types";
import {
  providerCanTestTierB2,
  providerCapabilities,
  providerNeedsEndpoint,
  providerSupportsTierB,
} from "./provider-capabilities";
import { providerRuntimeEndpoint, providerRuntimeModel } from "./model-provider-runtime";
import type { ReadinessFeature, ReadinessStatus } from "./readiness";
import {
  resolveEffectiveTierBEndpoint,
  resolveEffectiveTierBModel,
  resolveEffectiveTierBProvider,
} from "./settings";

export type TierBReadinessFeature = Extract<ReadinessFeature, "ai_analysis" | "reading_brief">;

export interface FeatureReadinessEnvironment {
  tierAEndpoint?: string;
  tierAModel?: string;
}

export interface FeatureReadinessGate {
  feature: TierBReadinessFeature;
  provider: TierBProvider;
  effectiveProvider: TierAProvider | TierBProvider;
  endpoint: string;
  model: string;
  canRun: boolean;
  canTest: boolean;
  blockedStatus?: ReadinessStatus;
  blockedMessage?: string;
}

function blockedGate(
  gate: Omit<FeatureReadinessGate, "canRun" | "canTest">,
  status: ReadinessStatus,
  message: string,
): FeatureReadinessGate {
  return {
    ...gate,
    canRun: false,
    canTest: false,
    blockedStatus: status,
    blockedMessage: message,
  };
}

export function resolveTierBFeatureGate(
  feature: TierBReadinessFeature,
  settings: UserSettings,
  environment: FeatureReadinessEnvironment = {},
): FeatureReadinessGate {
  const provider = settings.tierBProvider;
  const effectiveProvider = resolveEffectiveTierBProvider(settings);
  const endpoint = providerRuntimeEndpoint(
    effectiveProvider,
    resolveEffectiveTierBEndpoint(settings, environment.tierAEndpoint),
  );
  const model = providerRuntimeModel(
    effectiveProvider,
    resolveEffectiveTierBModel(settings, environment.tierAModel),
  );
  const base = { feature, provider, effectiveProvider, endpoint, model };

  if (!settings.deepClassifyEnabled || provider === "none") {
    return blockedGate(
      base,
      "not_configured",
      feature === "ai_analysis" ? "摘要尚未啟用" : "深入閱讀尚未啟用",
    );
  }

  if (feature === "ai_analysis" && !providerSupportsTierB(effectiveProvider)) {
    return blockedGate(base, "unsupported", "目前模型來源不支援摘要");
  }

  if (feature === "reading_brief" && !providerCanTestTierB2(effectiveProvider)) {
    return blockedGate(base, "unsupported", "目前模型來源不支援深入閱讀");
  }

  if (providerNeedsEndpoint(effectiveProvider) && (!endpoint || !model)) {
    return blockedGate(
      base,
      "not_configured",
      feature === "ai_analysis" ? "請先填入摘要端點與模型" : "請先填入深入閱讀端點與模型",
    );
  }

  return {
    ...base,
    canRun: true,
    canTest: true,
  };
}

export function providerCanRunTierBFeature(
  feature: TierBReadinessFeature,
  provider: TierAProvider | TierBProvider,
): boolean {
  if (feature === "ai_analysis") return providerSupportsTierB(provider);
  return providerCanTestTierB2(provider);
}

export function tierBFeatureGateLabel(gate: Pick<FeatureReadinessGate, "effectiveProvider">): string {
  return providerCapabilities(gate.effectiveProvider).label.replace("（實驗）", "");
}
