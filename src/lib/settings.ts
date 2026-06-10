import { DEFAULT_SETTINGS } from "./types";
import type { TierAProvider, TierBProvider, UserSettings } from "./types";
import { providerFixedModel, providerNeedsEndpoint } from "./provider-capabilities";
import { normalizeThemeMode } from "./theme-mode";
import { normalizeLanguage } from "./i18n";

type SettingsPatch = Partial<UserSettings>;

function resolveTierAProvider(raw: SettingsPatch): TierAProvider {
  return raw.tierAProvider ?? raw.cloudProvider ?? DEFAULT_SETTINGS.tierAProvider;
}

function resolveTierBProvider(raw: SettingsPatch): TierBProvider {
  if (raw.tierBProvider) return raw.tierBProvider;
  if (raw.tierBUseTierAEndpoint === true || raw.tierBUseTierAModel === true) return "tier-a";
  const hasManualTierBEndpoint = Boolean(raw.tierBEndpoint?.trim() || raw.vllmEndpoint?.trim());
  if (hasManualTierBEndpoint) return "openai-compatible";
  return DEFAULT_SETTINGS.tierBProvider;
}

function resolveTierBEndpoint(raw: SettingsPatch): string {
  return raw.tierBEndpoint ?? raw.vllmEndpoint ?? DEFAULT_SETTINGS.tierBEndpoint;
}

function resolveTierBModel(raw: SettingsPatch): string {
  return raw.tierBModel ?? raw.vllmModel ?? DEFAULT_SETTINGS.tierBModel;
}

function normalizeSponsoredDisplayMode(raw: unknown): UserSettings["sponsoredDisplayMode"] {
  return raw === "collapse" ? "collapse" : "none";
}

function normalizeMarkdownDownloadMode(raw: unknown): UserSettings["markdownDownloadMode"] {
  return raw === "directory-picker" ? "directory-picker" : "browser-download";
}

export function normalizeUserSettings(raw?: SettingsPatch | null): UserSettings {
  const source = raw ?? {};
  const tierAProvider = resolveTierAProvider(source);
  const tierBProvider = resolveTierBProvider(source);
  const tierBEndpoint = resolveTierBEndpoint(source);
  const tierBModel = resolveTierBModel(source);
  return {
    ...DEFAULT_SETTINGS,
    ...source,
    themeMode: normalizeThemeMode(source.themeMode),
    language: normalizeLanguage(source.language),
    markdownDownloadMode: normalizeMarkdownDownloadMode(source.markdownDownloadMode),
    tierAProvider,
    cloudProvider: tierAProvider,
    sponsoredDisplayMode: normalizeSponsoredDisplayMode(source.sponsoredDisplayMode),
    collapseRightRailAdsEnabled: source.collapseRightRailAdsEnabled === true,
    collapseReelsEnabled: source.collapseReelsEnabled === true,
    cacheEnabled: true,
    cacheTtlDays: 1,
    developerMode: false,
    analysisAutoFollow: true,
    tierBProvider,
    tierBUseTierAEndpoint: tierBProvider === "tier-a" ? true : source.tierBUseTierAEndpoint ?? false,
    tierBUseTierAModel: tierBProvider === "tier-a" ? true : source.tierBUseTierAModel ?? false,
    tierBEndpoint,
    vllmEndpoint: tierBEndpoint,
    tierBModel,
    vllmModel: tierBModel,
  };
}

export function applyUserSettingsPatch(
  current: SettingsPatch | null | undefined,
  patch: SettingsPatch,
): UserSettings {
  const normalizedPatch = { ...patch };

  if ("cloudProvider" in patch && !("tierAProvider" in patch)) {
    normalizedPatch.tierAProvider = patch.cloudProvider;
  }
  if ("tierAProvider" in patch && !("cloudProvider" in patch)) {
    normalizedPatch.cloudProvider = patch.tierAProvider;
  }
  if ("tierBProvider" in patch && patch.tierBProvider === "tier-a") {
    normalizedPatch.tierBUseTierAEndpoint = true;
    normalizedPatch.tierBUseTierAModel = true;
  } else if ("tierBProvider" in patch && patch.tierBProvider !== "tier-a") {
    normalizedPatch.tierBUseTierAEndpoint = false;
    normalizedPatch.tierBUseTierAModel = false;
  }
  if ("tierBUseTierAEndpoint" in patch || "tierBUseTierAModel" in patch) {
    const useEndpoint = patch.tierBUseTierAEndpoint ?? current?.tierBUseTierAEndpoint;
    const useModel = patch.tierBUseTierAModel ?? current?.tierBUseTierAModel;
    if (!("tierBProvider" in patch) && useEndpoint === true && useModel === true) {
      normalizedPatch.tierBProvider = "tier-a";
    }
  }
  if ("vllmEndpoint" in patch && !("tierBEndpoint" in patch)) {
    normalizedPatch.tierBEndpoint = patch.vllmEndpoint;
  }
  if ("tierBEndpoint" in patch && !("vllmEndpoint" in patch)) {
    normalizedPatch.vllmEndpoint = patch.tierBEndpoint;
  }
  if ("vllmModel" in patch && !("tierBModel" in patch)) {
    normalizedPatch.tierBModel = patch.vllmModel;
  }
  if ("tierBModel" in patch && !("vllmModel" in patch)) {
    normalizedPatch.vllmModel = patch.tierBModel;
  }

  return normalizeUserSettings({
    ...(current ?? {}),
    ...normalizedPatch,
  });
}

export function getTierAProvider(settings: SettingsPatch): TierAProvider {
  return resolveTierAProvider(settings);
}

export function getTierBProvider(settings: SettingsPatch): TierBProvider {
  return resolveTierBProvider(settings);
}

export function getTierBEndpoint(settings: SettingsPatch): string {
  return resolveTierBEndpoint(settings);
}

export function getTierBModel(settings: SettingsPatch): string {
  return resolveTierBModel(settings);
}

export function resolveEffectiveTierBEndpoint(
  settings: SettingsPatch,
  tierAEndpoint: string | undefined,
): string {
  const provider = resolveTierBProvider(settings);
  if (provider === "tier-a") return (tierAEndpoint ?? "").trim();
  if (!providerNeedsEndpoint(provider)) return "";
  return getTierBEndpoint(settings).trim();
}

export function resolveEffectiveTierBModel(
  settings: SettingsPatch,
  tierAModel: string | undefined,
): string {
  const provider = resolveTierBProvider(settings);
  const fixedModel = providerFixedModel(provider);
  if (fixedModel) return fixedModel;
  if (provider === "tier-a") return (tierAModel ?? "").trim();
  return getTierBModel(settings).trim();
}

export function resolveEffectiveTierBProvider(settings: SettingsPatch): TierBProvider | TierAProvider {
  const provider = resolveTierBProvider(settings);
  return provider === "tier-a" ? resolveTierAProvider(settings) : provider;
}

function normalizeEndpointForLane(endpoint: string | undefined): string {
  return (endpoint ?? "").trim().replace(/\/+$/, "").toLowerCase();
}

function normalizeModelForLane(model: string | undefined): string {
  return (model ?? "").trim().toLowerCase();
}

export function isSharedModelLane(
  settings: SettingsPatch,
  tierAEndpoint: string | undefined,
  tierAModel: string | undefined,
): boolean {
  const aEndpoint = normalizeEndpointForLane(tierAEndpoint);
  const bEndpoint = normalizeEndpointForLane(resolveEffectiveTierBEndpoint(settings, tierAEndpoint));
  const aModel = normalizeModelForLane(tierAModel);
  const bModel = normalizeModelForLane(resolveEffectiveTierBModel(settings, tierAModel));
  return Boolean(aEndpoint && bEndpoint && aModel && bModel && aEndpoint === bEndpoint && aModel === bModel);
}
