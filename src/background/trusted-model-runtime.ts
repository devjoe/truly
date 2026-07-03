import { resolveTierBFeatureGate, type TierBReadinessFeature } from "../lib/feature-readiness";
import { defaultEndpointForProvider, defaultModelForProvider } from "../lib/model-source-config";
import { providerEndpointKind } from "../lib/provider-capabilities";
import { providerRuntimeEndpoint, providerRuntimeModel } from "../lib/model-provider-runtime";
import { normalizeUserSettings } from "../lib/settings";
import type { GeneralPageParserAdvisorProviderRuntime, OllamaClassifyMsg } from "../lib/messages";
import type { UserSettings } from "../lib/types";

export interface StoredModelRuntimeInput {
  settings?: unknown;
  ollamaEndpoint?: unknown;
  ollamaModel?: unknown;
}

export type TrustedTierARuntime = Pick<
  OllamaClassifyMsg,
  "provider" | "endpoint" | "model" | "endpointKind" | "openAICompatibleFlavor" | "responseFormat" | "outputMode"
>;

function settingsPatch(input: unknown): Partial<UserSettings> | undefined {
  return input && typeof input === "object" ? input as Partial<UserSettings> : undefined;
}

function storedString(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function tierAEndpoint(input: StoredModelRuntimeInput, settings: UserSettings): string {
  return storedString(input.ollamaEndpoint, defaultEndpointForProvider(settings.tierAProvider));
}

function tierAModel(input: StoredModelRuntimeInput, settings: UserSettings): string {
  return storedString(input.ollamaModel, defaultModelForProvider(settings.tierAProvider, "reading-prompt"));
}

export function resolveTrustedTierARuntime(input: StoredModelRuntimeInput): TrustedTierARuntime {
  const settings = normalizeUserSettings(settingsPatch(input.settings));
  return {
    provider: settings.tierAProvider,
    endpoint: providerRuntimeEndpoint(settings.tierAProvider, tierAEndpoint(input, settings)),
    model: providerRuntimeModel(settings.tierAProvider, tierAModel(input, settings)),
    endpointKind: providerEndpointKind(settings.tierAProvider),
    openAICompatibleFlavor: settings.openAICompatibleFlavor,
    responseFormat: settings.openAIResponseFormat,
    outputMode: settings.tierAOutputMode,
  };
}

export function resolveTrustedTierBProviderRuntime(
  feature: TierBReadinessFeature,
  input: StoredModelRuntimeInput,
): GeneralPageParserAdvisorProviderRuntime {
  const settings = normalizeUserSettings(settingsPatch(input.settings));
  const gate = resolveTierBFeatureGate(feature, settings, {
    tierAEndpoint: tierAEndpoint(input, settings),
    tierAModel: tierAModel(input, settings),
  });
  return {
    configSource: "tier-b-provider",
    provider: gate.provider,
    effectiveProvider: gate.effectiveProvider,
    endpoint: gate.endpoint,
    model: gate.model,
    canUseModel: gate.canRun,
    mode: "rule-based-runtime-baseline",
    blockedReason: gate.blockedMessage,
  };
}
