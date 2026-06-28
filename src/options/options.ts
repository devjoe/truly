import browser from "webextension-polyfill";
import { ALL_CATEGORIES, DEFAULT_SETTINGS, MAX_ACTIVE_FOLD_RULES } from "../lib/types";
import type { FilterCategory } from "../lib/types";
import type {
  CustomFoldRule,
  OpenAICompatibleFlavor,
  OpenAIResponseFormatMode,
  TierBProvider,
  TierAProvider,
  TierAOutputMode,
  TierAEndpointKind,
  ThemeMode,
  UserSettings,
} from "../lib/types";
import { applyUserSettingsPatch, getTierAProvider, getTierBProvider, normalizeUserSettings } from "../lib/settings";
import {
  defaultEndpointForProvider,
  defaultModelForProvider,
  endpointSecurityWarnings,
  isEndpointBackedModelProvider,
  normalizeEndpointInput,
  normalizeProviderModelConfigMap,
  providerModelConfigOrDefault,
  resolveModelName,
  validateEndpointUrl,
  withProviderModelConfig,
} from "../lib/model-source-config";
import type { ProviderModelConfigMap } from "../lib/model-source-config";
import {
  providerCapabilities,
  providerEndpointKind,
  providerFixedModel,
  providerNeedsApiKey,
  providerNeedsEndpoint,
  providerSupportsTierB,
} from "../lib/provider-capabilities";
import { resolveTierBFeatureGate } from "../lib/feature-readiness";
import { modelDisplayIdentity } from "../lib/model-display";
import {
  endpointLooksLikeOllamaCloud,
  modelLooksLikeOllamaCloud,
  ollamaCloudVisionSupport,
} from "../lib/ollama-cloud-capabilities";
import type { ReadinessFeature, ReadinessRecord, ReadinessSnapshot } from "../lib/readiness";
import {
  createReadinessRecord,
  isReadinessRecordFresh,
  PRIMARY_READINESS_FEATURES,
  READINESS_FEATURES,
  readinessFeatureGroup,
  readinessFingerprint,
} from "../lib/readiness";
import { loadReadinessSnapshot } from "../lib/readiness-storage";
import type { ReadinessRunChecksResultMsg } from "../lib/messages";
import { createExtensionThemeController, normalizeThemeMode } from "../lib/theme-mode";
import {
  createExtensionLanguageController,
  resolveLanguage,
  t,
} from "../lib/i18n";
import type { Lang, LanguageSetting } from "../lib/types";
import { debugLog } from "../lib/logger";

debugLog(`[Truly Options] Loaded buildId=${__TRULY_BUILD_ID__}`);

async function loadSettings(): Promise<UserSettings> {
  const result = await browser.storage.sync.get("settings");
  return normalizeUserSettings(result.settings as Partial<UserSettings> | undefined);
}

async function saveSettings(settings: UserSettings): Promise<void> {
  await browser.storage.sync.set({ settings: normalizeUserSettings(settings) });
}

type ApiKeyStorageKey = "tierAApiKey" | "tierBApiKey";
type ApiKeySessionFlagKey = "tierAApiKeySessionOnly" | "tierBApiKeySessionOnly";

async function sessionStorageGet(keys: string[]): Promise<Record<string, unknown>> {
  return chrome.storage.session?.get(keys).catch(() => ({} as Record<string, unknown>)) ??
    ({} as Record<string, unknown>);
}

async function sessionStorageSet(values: Record<string, unknown>): Promise<void> {
  await chrome.storage.session?.set(values).catch(() => {});
}

async function sessionStorageRemove(keys: string[]): Promise<void> {
  await chrome.storage.session?.remove(keys).catch(() => {});
}

async function persistApiKeyPreference(options: {
  key: ApiKeyStorageKey;
  sessionFlag: ApiKeySessionFlagKey;
  value: string;
  sessionOnly: boolean;
  clearLegacyApiKey?: boolean;
}): Promise<void> {
  const localUpdate: Record<string, unknown> = {
    [options.sessionFlag]: options.sessionOnly,
  };
  if (options.clearLegacyApiKey) localUpdate.apiKey = "";
  if (options.sessionOnly) {
    localUpdate[options.key] = "";
    await Promise.all([
      browser.storage.local.set(localUpdate),
      sessionStorageSet({ [options.key]: options.value }),
    ]);
    return;
  }
  localUpdate[options.key] = options.value;
  await Promise.all([
    browser.storage.local.set(localUpdate),
    sessionStorageRemove([options.key]),
  ]);
}

/** Broadcast the updated settings to all open FB tabs so liveSettings in
 *  each content script picks up rule edits / fold-threshold tweaks
 *  without a page reload. The runtime broadcast also reaches sidepanel. */
async function broadcastSettingsUpdate(settings: UserSettings): Promise<void> {
  try {
    await browser.runtime.sendMessage({ type: "SETTINGS_UPDATED", settings });
  } catch {
    /* ignore — sidepanel may not be open */
  }
  try {
    // Query all tabs (no URL filter — that requires the `tabs` permission
    // or host_permissions for facebook.com, which we don't grant by default
    // since FB pages already have content_scripts wired in the manifest).
    // Non-FB tabs have no SETTINGS_UPDATED listener registered, so they
    // safely ignore the message.
    const tabs = await browser.tabs.query({});
    for (const tab of tabs) {
      if (typeof tab.id === "number") {
        browser.tabs.sendMessage(tab.id, { type: "SETTINGS_UPDATED", settings }).catch(() => {});
      }
    }
  } catch {
    /* tabs API may be unavailable in test env */
  }
}

interface ThresholdRowOptions {
  label: string;
  previewLabel?: string;
  description?: string;
  max?: string;
  format?: (v: number) => string;
}

type ThresholdPresetName = "conservative" | "standard" | "active";

const THRESHOLD_PRESETS: Record<ThresholdPresetName, Record<FilterCategory, number>> = {
  conservative: {
    commercial: 0.85,
    political: 0.9,
    emotional: 0.85,
    personal: 1.0,
  },
  standard: {
    commercial: 0.7,
    political: 0.8,
    emotional: 0.7,
    personal: 1.0,
  },
  active: {
    commercial: 0.55,
    political: 0.6,
    emotional: 0.55,
    personal: 0.75,
  },
};

function thresholdPresetNoteText(preset: ThresholdPresetName | "custom", lang: Lang): string {
  return t(`preset.${preset}`, lang);
}

function detectThresholdPreset(thresholds: Record<FilterCategory, number>): ThresholdPresetName | "custom" {
  for (const preset of Object.keys(THRESHOLD_PRESETS) as ThresholdPresetName[]) {
    const values = THRESHOLD_PRESETS[preset];
    if (ALL_CATEGORIES.every((cat) => Math.abs((thresholds[cat] ?? 0) - values[cat]) < 0.001)) {
      return preset;
    }
  }
  return "custom";
}

function createThresholdRow(
  value: number,
  onChange: (val: number) => void,
  opts: ThresholdRowOptions,
): HTMLElement {
  const format = opts.format ?? ((v: number) => v.toFixed(2));

  const row = document.createElement("div");
  row.className = "threshold-row";

  const label = document.createElement("span");
  label.className = "threshold-label";
  const labelText = document.createElement("span");
  labelText.textContent = opts.label;
  label.appendChild(labelText);
  if (opts.previewLabel) {
    const preview = document.createElement("span");
    preview.className = "threshold-preview";
    preview.textContent = opts.previewLabel;
    label.appendChild(preview);
  }

  const slider = document.createElement("input");
  slider.type = "range";
  slider.min = "0";
  slider.max = opts.max ?? "1";
  slider.step = "0.05";
  slider.value = String(value);
  slider.className = "threshold-slider";
  const sliderWrap = document.createElement("div");
  sliderWrap.className = "threshold-slider-wrap";
  const sliderVisual = document.createElement("span");
  sliderVisual.className = "threshold-slider-visual";
  const updateSliderProgress = () => {
    const min = parseFloat(slider.min || "0");
    const max = parseFloat(slider.max || "1");
    const current = parseFloat(slider.value);
    const pct = max > min ? ((current - min) / (max - min)) * 100 : 0;
    sliderWrap.style.setProperty("--range-progress", `${Math.max(0, Math.min(100, pct))}%`);
  };
  updateSliderProgress();

  const display = document.createElement("span");
  display.className = "threshold-value";
  display.textContent = format(value);

  const description = document.createElement("div");
  description.className = "threshold-description";
  description.textContent = opts.description || "";

  slider.addEventListener("input", () => {
    const v = parseFloat(slider.value);
    updateSliderProgress();
    display.textContent = format(v);
    onChange(v);
  });

  row.appendChild(label);
  row.appendChild(display);
  row.appendChild(description);
  sliderWrap.appendChild(slider);
  sliderWrap.appendChild(sliderVisual);
  row.appendChild(sliderWrap);
  return row;
}

function makeUuid(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  // Fallback — non-crypto-safe but unique-enough for in-extension settings.
  return "rule_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 10);
}

async function init() {
  const settings = await loadSettings();
  const themeController = createExtensionThemeController();
  themeController.setMode(settings.themeMode);
  const languageController = createExtensionLanguageController();
  // TS-generated, language-dependent renderers register here so a language
  // toggle re-runs them (the static HTML is handled by the controller walk).
  const i18nDynamicRenderers: Array<() => void> = [];
  const currentLang = (): Lang => resolveLanguage(settings.language);
  const optT = (key: string, params?: Record<string, string | number>): string =>
    t(key, currentLang(), params);
  function renderDeveloperBuildMeta(): void {
    const meta = document.getElementById("developerBuildMeta");
    if (!meta) return;
    const manifest = chrome.runtime.getManifest() as chrome.runtime.Manifest & {
      version_name?: string;
    };
    meta.textContent = `Truly ${manifest.version_name || manifest.version} · Build ${__TRULY_BUILD_ID__}`;
  }
  function renderBrandSubtitle(): void {
    const title = document.querySelector<HTMLElement>(".page-header h1");
    if (!title) return;
    title.dataset.subtitle = currentLang() === "zh-TW" ? "梳 理" : "";
  }
  function renderPrivacyPolicyNote(): void {
    const item = document.getElementById("privacyGenerativePolicy");
    if (!item) return;
    item.innerHTML = "";
    item.append(document.createTextNode(optT("privacy.item3Prefix")));
    const link = document.createElement("a");
    link.href = "https://policies.google.com/terms/generative-ai/use-policy";
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.textContent = optT("privacy.policyLink");
    item.appendChild(link);
    item.append(document.createTextNode(currentLang() === "zh-TW" ? "。" : "."));
  }
  i18nDynamicRenderers.push(renderBrandSubtitle);
  i18nDynamicRenderers.push(renderPrivacyPolicyNote);
  renderDeveloperBuildMeta();
  function applyLanguage(): void {
    languageController.setLanguage(settings.language);
    for (const render of i18nDynamicRenderers) render();
  }
  let localModelConfig = await browser.storage.local.get([
    "ollamaEndpoint",
    "ollamaModel",
    "tierAProviderConfigs",
    "tierBProviderConfigs",
  ]);
  let tierAProviderConfigs: ProviderModelConfigMap = normalizeProviderModelConfigMap(
    localModelConfig.tierAProviderConfigs,
  );
  const initialTierAProvider = getTierAProvider(settings);
  if (isEndpointBackedModelProvider(initialTierAProvider)) {
    tierAProviderConfigs = withProviderModelConfig(
      tierAProviderConfigs,
      initialTierAProvider,
      {
        endpoint: typeof localModelConfig.ollamaEndpoint === "string"
          ? localModelConfig.ollamaEndpoint
          : providerModelConfigOrDefault(
              tierAProviderConfigs,
              initialTierAProvider,
              "reading-prompt",
            ).endpoint,
        model: typeof localModelConfig.ollamaModel === "string"
          ? localModelConfig.ollamaModel
          : providerModelConfigOrDefault(
              tierAProviderConfigs,
              initialTierAProvider,
              "reading-prompt",
            ).model,
      },
    );
  }
  let tierBProviderConfigs: ProviderModelConfigMap = normalizeProviderModelConfigMap(
    localModelConfig.tierBProviderConfigs,
  );
  let readinessSnapshot = await loadReadinessSnapshot(browser.storage.local as any);
  let refreshTierBManualInputsAfterReadiness: (() => void) | undefined;

  function currentReadinessEnvironment() {
    const provider = getTierAProvider(settings);
    if (isEndpointBackedModelProvider(provider)) {
      const config = providerModelConfigOrDefault(tierAProviderConfigs, provider, "reading-prompt");
      return {
        tierAEndpoint: config.endpoint,
        tierAModel: config.model,
        buildId: __TRULY_BUILD_ID__,
      };
    }
    return {
      tierAEndpoint: typeof localModelConfig.ollamaEndpoint === "string"
        ? localModelConfig.ollamaEndpoint.trim()
        : defaultEndpointForProvider("ollama"),
      tierAModel: typeof localModelConfig.ollamaModel === "string"
        ? localModelConfig.ollamaModel.trim()
        : defaultModelForProvider("ollama", "reading-prompt"),
      buildId: __TRULY_BUILD_ID__,
    };
  }

  function providerSupportsOptionalApiKey(provider: TierAProvider | TierBProvider): boolean {
    return provider === "openai-compatible";
  }

  function apiKeyForProvider(
    provider: TierAProvider | TierBProvider,
    input: HTMLInputElement,
  ): string | undefined {
    if (!providerSupportsOptionalApiKey(provider)) return undefined;
    return input.value.trim() || undefined;
  }

  function renderThemeControl(): void {
    const control = document.getElementById("themeControl");
    if (!control) return;
    const current = normalizeThemeMode(settings.themeMode);
    for (const button of control.querySelectorAll<HTMLButtonElement>("button[data-theme-mode]")) {
      const mode = normalizeThemeMode(button.dataset.themeMode);
      button.setAttribute("aria-pressed", String(mode === current));
    }
  }

  async function saveThemeMode(mode: ThemeMode): Promise<void> {
    Object.assign(settings, applyUserSettingsPatch(settings, { themeMode: mode }));
    themeController.setMode(settings.themeMode);
    renderThemeControl();
    await saveSettings(settings);
    await broadcastSettingsUpdate(settings);
  }

  function setupThemeControl(): void {
    const control = document.getElementById("themeControl");
    if (!control) return;
    renderThemeControl();
    control.addEventListener("click", (event) => {
      const button = (event.target as HTMLElement | null)?.closest<HTMLButtonElement>("button[data-theme-mode]");
      if (!button) return;
      void saveThemeMode(normalizeThemeMode(button.dataset.themeMode));
    });
  }

  setupThemeControl();

  function renderLangControl(): void {
    const control = document.getElementById("langControl");
    if (!control) return;
    const current = resolveLanguage(settings.language);
    for (const button of control.querySelectorAll<HTMLButtonElement>("button[data-lang]")) {
      button.setAttribute("aria-pressed", String(button.dataset.lang === current));
    }
  }

  async function saveLanguage(language: LanguageSetting): Promise<void> {
    Object.assign(settings, applyUserSettingsPatch(settings, { language }));
    applyLanguage();
    renderLangControl();
    await saveSettings(settings);
    await broadcastSettingsUpdate(settings);
  }

  function setupLangControl(): void {
    const control = document.getElementById("langControl");
    if (!control) return;
    renderLangControl();
    control.addEventListener("click", (event) => {
      const button = (event.target as HTMLElement | null)?.closest<HTMLButtonElement>("button[data-lang]");
      const lang = button?.dataset.lang;
      if (lang !== "en" && lang !== "zh-TW") return;
      void saveLanguage(lang);
    });
  }

  setupLangControl();
  applyLanguage();

  function freshReadinessRecord(feature: ReadinessFeature): ReadinessRecord | undefined {
    const fingerprint = readinessFingerprint(feature, settings, currentReadinessEnvironment());
    const record = readinessSnapshot[feature];
    return isReadinessRecordFresh(record, fingerprint) ? record : undefined;
  }

  function shouldDeferToRealtime(feature: ReadinessFeature): boolean {
    if (feature !== "ai_analysis" && feature !== "reading_brief") return false;
    const realtime = freshReadinessRecord("realtime");
    if (!readinessIsProblem(realtime)) return false;
    const gate = resolveTierBFeatureGate(feature, settings, currentReadinessEnvironment());
    return gate.effectiveProvider === settings.tierAProvider;
  }

  function displayReadinessRecord(feature: ReadinessFeature): ReadinessRecord | undefined {
    if (shouldDeferToRealtime(feature)) return undefined;
    return freshReadinessRecord(feature);
  }

  function readinessBadgeClass(record: ReadinessRecord | undefined): string {
    if (!record) return "untested";
    if (record.status === "passed" || record.status === "slow_but_usable") return "ok";
    if (record.status === "testing" || record.status === "model_downloading") return "working";
    if (record.status === "not_configured" || record.status === "unsupported") return "warn";
    return "error";
  }

  function providerDisplayLabel(provider: TierAProvider | TierBProvider): string {
    return optT(`provider.${provider}`);
  }

  function readinessFeatureDisplayLabel(feature: ReadinessFeature): string {
    return optT(`readiness.feature.${feature}`);
  }

  function readinessFeatureRoleDisplayLabel(feature: ReadinessFeature): string {
    return optT(`readiness.role.${feature}`);
  }

  function readinessStatusDisplayLabel(status: ReadinessRecord["status"]): string {
    return optT(`readiness.status.${status}`);
  }

  function readinessDisplayText(record: ReadinessRecord): string {
    return readinessStatusDisplayLabel(record.status);
  }

  function readinessRecoveryText(record: ReadinessRecord): string {
    if (record.apiKeyAccepted && record.status === "failed_output_format") {
      return optT("options.modelTest.apiKeyAcceptedOutputMismatch");
    }
    if (record.status === "connection_failed") {
      if (record.message?.includes("API key 未通過")) {
        return optT("options.modelTest.apiKeyNotAccepted");
      }
      return record.feature === "ai_analysis" || record.feature === "reading_brief"
        ? optT("readiness.hint.connectionDeep")
        : optT("readiness.hint.connection");
    }
    if (record.status === "failed_output_format") {
      return record.feature === "reading_brief"
        ? optT("readiness.hint.briefFormat")
        : optT("readiness.hint.outputFormat");
    }
    if (record.status === "needs_permission") return optT("readiness.hint.permission");
    if (record.status === "model_unavailable") {
      return record.provider === "chrome-gemini-nano" || record.effectiveProvider === "chrome-gemini-nano"
        ? optT("readiness.hint.geminiUnavailable")
        : optT("readiness.hint.modelUnavailable");
    }
    if (record.status === "model_downloading") return optT("readiness.hint.geminiDownloading");
    return readinessDisplayText(record);
  }

  function readinessBadgeText(record: ReadinessRecord | undefined): string {
    if (!record) return optT("readiness.status.untested");
    if (record.status === "slow_but_usable") return optT("readiness.status.slowShort");
    return readinessStatusDisplayLabel(record.status);
  }

  function activationBadgeVisibleText(record: ReadinessRecord | undefined): string {
    if (!record) return "?";
    if (record.status === "passed" || record.status === "testing" || record.status === "model_downloading") return "";
    return readinessBadgeText(record);
  }

  function readinessIsUsable(record: ReadinessRecord | undefined): boolean {
    return record?.status === "passed" || record?.status === "slow_but_usable";
  }

  function readinessIsProblem(record: ReadinessRecord | undefined): boolean {
    return !!record && !readinessIsUsable(record) && record.status !== "testing" && record.status !== "model_downloading";
  }

  function readinessIsPreparing(record: ReadinessRecord | undefined): boolean {
    return record?.status === "testing" || record?.status === "model_downloading";
  }

  function readinessItemNote(feature: ReadinessFeature, record: ReadinessRecord | undefined): string {
    const purpose = activationFeatureShortPurpose(feature);
    if (!record) return purpose;
    if (record.status === "passed" || record.status === "slow_but_usable") {
      return purpose;
    }
    return readinessDisplayText(record);
  }

  function activationFeatureShortPurpose(feature: ReadinessFeature): string {
    return optT(`readiness.purpose.${feature}`);
  }

  function readinessItemMeta(record: ReadinessRecord | undefined): string {
    if (!record) return "";
    const parts: string[] = [];
    if (record.apiKeyAccepted) {
      parts.push(optT("options.modelTest.apiKeyAccepted"));
    }
    if (record.effectiveProvider || record.provider) {
      parts.push(providerDisplayLabel(record.effectiveProvider || record.provider!));
    }
    if (record.model) {
      const model = modelDisplayIdentity(record.model).label;
      if (!parts.includes(model) && !parts.some((part) => part.includes(model))) {
        parts.push(model);
      }
    }
    if (typeof record.latencyMs === "number" && record.latencyMs > 0) {
      parts.push(optT("options.common.seconds", { value: (record.latencyMs / 1000).toFixed(1) }));
    }
    return parts.join(" · ");
  }

  function inlineReadinessSummary(features: ReadinessFeature[]): { text: string; className: string } {
    const records = features.map((feature) => displayReadinessRecord(feature)).filter((record): record is ReadinessRecord => !!record);
    if (records.length === 0) return { text: optT("options.inline.savedPending"), className: "status-text" };
    const failed = records.find(readinessIsProblem);
    if (failed) {
      return {
        text: readinessRecoveryText(failed),
        className: "status-text status-error",
      };
    }
    const textOnlyVision = records.find((record) =>
      record.feature === "ai_analysis" &&
      record.capabilities?.vision === "unsupported"
    );
    if (textOnlyVision) {
      const meta = readinessItemMeta(textOnlyVision);
      return {
        text: meta
          ? optT("options.modelTest.visionTextOnlyWithMeta", { meta })
          : optT("options.modelTest.visionTextOnly"),
        className: "status-text status-warn",
      };
    }
    const slow = records.find((record) => record.status === "slow_but_usable");
    const primary = slow || records[0];
    const meta = readinessItemMeta(primary);
    const suffix = meta ? ` · ${meta}` : "";
    return {
      text: `${slow ? optT("readiness.status.slowUsableShort") : optT("readiness.status.passed")}${suffix}`,
      className: "status-text status-ok",
    };
  }

  function parseTechnicalDetail(detail: string | undefined): Array<[string, string]> {
    if (!detail) return [];
    return detail
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line): [string, string] => {
        const idx = line.indexOf("=");
        if (idx === -1) return ["detail", line];
        return [line.slice(0, idx).trim(), line.slice(idx + 1).trim()];
      });
  }

  function activationDiagnostics(feature: ReadinessFeature, record: ReadinessRecord | undefined): HTMLElement | null {
    if (!record) return null;
    const isGemini = record.provider === "chrome-gemini-nano" || record.effectiveProvider === "chrome-gemini-nano";
    const entries = parseTechnicalDetail(record.technicalDetail);
    if (!isGemini && entries.length === 0) return null;

    const details = document.createElement("details");
    details.className = "activation-diagnostics";
    const summary = document.createElement("summary");
    summary.textContent = optT("options.activation.diagnostics");
    details.appendChild(summary);

    const list = document.createElement("dl");
    const add = (label: string, value: string | undefined) => {
      if (!value) return;
      const dt = document.createElement("dt");
      dt.textContent = label;
      const dd = document.createElement("dd");
      dd.textContent = value;
      list.appendChild(dt);
      list.appendChild(dd);
    };
    add(optT("options.activation.field.feature"), readinessFeatureDisplayLabel(feature));
    add(optT("options.activation.field.status"), readinessStatusDisplayLabel(record.status));
    add(optT("options.activation.field.source"), record.effectiveProvider || record.provider);
    add(optT("options.activation.field.model"), record.model ? modelDisplayIdentity(record.model).label : undefined);
    for (const [key, value] of entries) add(key, value);
    details.appendChild(list);

    if (isGemini && (record.status === "model_unavailable" || record.status === "unsupported")) {
      const hint = document.createElement("p");
      hint.textContent = optT("readiness.hint.geminiUnavailable");
      details.appendChild(hint);
    } else if (isGemini && record.status === "model_downloading") {
      const hint = document.createElement("p");
      hint.textContent = optT("readiness.hint.geminiDownloading");
      details.appendChild(hint);
    }

    return details;
  }

  function setActivationGuidance(): void {
    const guidance = document.getElementById("activationGuidance");
    const summaryPills = document.getElementById("activationSummaryPills");
    if (!guidance) return;

    const records = {
      realtime: freshReadinessRecord("realtime"),
      aiAnalysis: displayReadinessRecord("ai_analysis"),
      readingBrief: displayReadinessRecord("reading_brief"),
    };
    const allRecords = Object.values(records);
    const problemCount = allRecords.filter(readinessIsProblem).length;

    let title = "";
    let body = "";
    if (readinessIsProblem(records.realtime)) {
      title = "";
      body = "";
    } else if (readinessIsUsable(records.realtime) && !settings.deepClassifyEnabled) {
      title = optT("options.guidance.readyTitle");
      body = optT("options.guidance.enableSummary");
    } else if (readinessIsUsable(records.realtime) && readinessIsProblem(records.aiAnalysis)) {
      title = optT("options.guidance.summaryNeedsWork");
      body = records.aiAnalysis
        ? readinessRecoveryText(records.aiAnalysis)
        : optT("options.guidance.summaryFallback");
    } else if (readinessIsUsable(records.realtime) && readinessIsProblem(records.readingBrief)) {
      title = optT("options.guidance.briefNeedsWork");
      body = optT("options.guidance.briefFallback");
    } else if (readinessIsUsable(records.realtime) && readinessIsUsable(records.aiAnalysis) && readinessIsUsable(records.readingBrief)) {
      title = "";
      body = "";
    }

    if (summaryPills) summaryPills.innerHTML = "";
    const summaryItems = problemCount > 0
      ? [{ className: "error", text: optT("options.guidance.problemCount", { count: problemCount }) }]
      : [];
    for (const item of summaryItems) {
      const pill = document.createElement("span");
      pill.className = `activation-summary-pill ${item.className}`;
      pill.textContent = item.text;
      summaryPills?.appendChild(pill);
    }

    guidance.innerHTML = "";
    if (!title && !body) return;
    const text = document.createElement("div");
    const heading = document.createElement("strong");
    heading.textContent = title;
    const description = document.createElement("span");
    description.textContent = body;
    text.appendChild(heading);
    text.appendChild(description);
    guidance.appendChild(text);
  }

  function applySharedModelSettings(provider: UserSettings["tierAProvider"]): void {
    Object.assign(
      settings,
      applyUserSettingsPatch(settings, {
        tierAProvider: provider,
      }),
    );
  }

  function renderActivationOverview(): void {
    const title = document.getElementById("activationStatusTitle");
    const detail = document.getElementById("activationStatusDetail");
    const list = document.getElementById("activationCapabilityList");
    if (!title || !detail || !list) return;

    const realtime = displayReadinessRecord("realtime");
    const realtimeReady = realtime?.status === "passed" || realtime?.status === "slow_but_usable";
    if (realtimeReady) {
      title.textContent = optT("options.activation.readyTitle");
      detail.textContent = realtime.status === "slow_but_usable"
        ? optT("options.activation.readySlow")
        : "";
      setActivationStatus(title.textContent, detail.textContent, realtime.status === "slow_but_usable" ? "warn" : "ready");
    } else if (readinessIsPreparing(realtime)) {
      title.textContent = optT("options.activation.preparingTitle");
      detail.textContent = realtime ? readinessRecoveryText(realtime) : optT("options.activation.preparingDetail");
      setActivationStatus(title.textContent, detail.textContent, "working");
    } else if (realtime) {
      title.textContent = optT("options.activation.oneStepTitle");
      detail.textContent = readinessRecoveryText(realtime) || optT("options.activation.oneStepDetail");
      setActivationStatus(title.textContent, detail.textContent, readinessIsProblem(realtime) ? "error" : "warn");
    } else {
      title.textContent = optT("options.activation.checkTitle");
      detail.textContent = "";
      setActivationStatus(title.textContent, detail.textContent, "pending");
    }

    list.innerHTML = "";
    setActivationGuidance();
    const renderFeature = (feature: ReadinessFeature) => {
      const record = displayReadinessRecord(feature);
      const statusClass = readinessBadgeClass(record);
      const tile = document.createElement("div");
      tile.className = `activation-tile ${readinessFeatureGroup(feature)} activation-feature-${feature.replace(/_/g, "-")}`;
      tile.dataset.feature = feature;
      const row = document.createElement("div");
      row.className = `activation-item ${readinessFeatureGroup(feature)} activation-state-${statusClass}`;
      row.dataset.feature = feature;
      const featurePurpose = readinessItemNote(feature, record);
      const featureRole = readinessFeatureRoleDisplayLabel(feature);
      row.title = optT("options.activation.itemTitle", {
        feature: readinessFeatureDisplayLabel(feature),
        role: featureRole,
        purpose: featurePurpose,
      });
      row.setAttribute("aria-label", optT("options.activation.itemAria", {
        feature: readinessFeatureDisplayLabel(feature),
        role: featureRole,
        purpose: featurePurpose,
        status: readinessBadgeText(record),
      }));
      const badge = document.createElement("span");
      badge.className = `activation-badge ${readinessBadgeClass(record)}`;
      badge.textContent = activationBadgeVisibleText(record);
      badge.title = readinessBadgeText(record);
      badge.setAttribute("aria-label", readinessBadgeText(record));

      const body = document.createElement("div");
      body.className = "activation-item-body";
      const heading = document.createElement("div");
      heading.className = "activation-item-heading";
      const label = document.createElement("strong");
      label.textContent = readinessFeatureDisplayLabel(feature);
      const role = document.createElement("span");
      role.className = "activation-role";
      role.textContent = featureRole;
      heading.appendChild(label);
      heading.appendChild(role);
      const note = document.createElement("span");
      note.textContent = featurePurpose;
      body.appendChild(heading);
      note.className = "activation-note";
      body.appendChild(note);
      const metaText = readinessItemMeta(record);
      row.appendChild(body);
      row.appendChild(badge);
      tile.appendChild(row);
      if (metaText) {
        const meta = document.createElement("span");
        meta.className = "activation-meta-outside";
        meta.textContent = metaText;
        tile.appendChild(meta);
      }
      const diagnostics = activationDiagnostics(feature, record);
      if (diagnostics) tile.appendChild(diagnostics);
      list.appendChild(tile);
    };

    for (const feature of PRIMARY_READINESS_FEATURES) renderFeature(feature);
  }
  i18nDynamicRenderers.push(renderActivationOverview);

  function setActivationStatus(titleText: string, detailText: string, state: "pending" | "working" | "ready" | "warn" | "error" = "pending"): void {
    const title = document.getElementById("activationStatusTitle");
    const detail = document.getElementById("activationStatusDetail");
    const dot = document.getElementById("activationStatusDot");
    if (title) title.textContent = titleText;
    if (detail) detail.textContent = detailText;
    if (dot) {
      dot.className = `activation-status-glyph ${state}`;
      dot.setAttribute("title", titleText);
    }
  }

  function renderActivationTestingState(features: ReadinessFeature[] = READINESS_FEATURES): void {
    const checkedAt = new Date().toISOString();
    const nextSnapshot: ReadinessSnapshot = { ...(readinessSnapshot ?? {}) };
    for (const feature of features) {
      nextSnapshot[feature] = createReadinessRecord({
        feature,
        status: "testing",
        checkedAt,
        buildId: __TRULY_BUILD_ID__,
        message: optT("options.activation.testingFeature", {
          feature: readinessFeatureDisplayLabel(feature),
        }),
        settingsFingerprint: readinessFingerprint(feature, settings, currentReadinessEnvironment()),
      });
    }
    readinessSnapshot = nextSnapshot;
    renderActivationOverview();
    const label = features.length === READINESS_FEATURES.length
      ? optT("options.activation.testingAll")
      : optT("options.activation.testingFeatureList", {
          features: features.map(readinessFeatureDisplayLabel).join(optT("options.common.listSeparator")),
        });
    setActivationStatus(label, "", "working");
  }

  function formatActivationRunError(error: string | undefined): string {
    const message = error?.trim();
    if (!message) return optT("options.activation.runError.empty");
    if (/Gemini Nano request timed out/i.test(message)) {
      return optT("options.activation.runError.geminiTimeout");
    }
    return optT("options.activation.runError.withMessage", { message });
  }

  async function runActivationChecks(features: ReadinessFeature[] = READINESS_FEATURES): Promise<ReadinessSnapshot | undefined> {
    const button = document.getElementById("runActivationChecks") as HTMLButtonElement | null;
    const previousSnapshot = readinessSnapshot;
    if (button) {
      button.disabled = true;
      button.textContent = t("activation.testing", resolveLanguage(settings.language));
    }
    renderActivationTestingState(features);
    if (features.includes("realtime")) refreshTierALaneSummary();
    try {
      const response = await browser.runtime.sendMessage({
        type: "READINESS_RUN_CHECKS",
        settings: normalizeUserSettings(settings),
        features,
        tierAApiKey: apiKeyForProvider(settings.tierAProvider, apiKeyInput),
        tierBApiKey: apiKeyForProvider(settings.tierBProvider, tierBApiKeyInput),
        ...currentReadinessEnvironment(),
      }) as ReadinessRunChecksResultMsg;
      if (response.ok && (response.snapshot || response.records.length > 0)) {
        readinessSnapshot = response.snapshot ?? response.records.reduce<ReadinessSnapshot>(
          (snapshot, record) => ({ ...snapshot, [record.feature]: record }),
          previousSnapshot ?? {},
        );
        renderActivationOverview();
        if (features.includes("realtime")) refreshTierALaneSummary();
        refreshTierBManualInputsAfterReadiness?.();
        return readinessSnapshot;
      } else {
        readinessSnapshot = previousSnapshot;
        renderActivationOverview();
        if (features.includes("realtime")) refreshTierALaneSummary();
        refreshTierBManualInputsAfterReadiness?.();
        setActivationStatus(optT("options.activation.incompleteTitle"), formatActivationRunError(response.error), "error");
        return undefined;
      }
    } catch (error) {
      readinessSnapshot = previousSnapshot;
      renderActivationOverview();
      if (features.includes("realtime")) refreshTierALaneSummary();
      setActivationStatus(
        optT("options.activation.startFailedTitle"),
        optT("options.activation.startFailedBody", { error: error instanceof Error ? error.message : String(error) }),
        "error",
      );
      return undefined;
    } finally {
      if (button) {
        button.disabled = false;
        button.textContent = t("activation.runBtn", resolveLanguage(settings.language));
      }
    }
  }

  document.getElementById("runActivationChecks")?.addEventListener("click", () => {
    void runActivationChecks();
  });
  renderActivationOverview();

  async function runActivationChecksForInlineStatus(features: ReadinessFeature[]): Promise<{ text: string; className: string }> {
    const snapshot = await runActivationChecks(features);
    if (!snapshot) {
      return {
        text: optT("options.activation.inlineCheckFailed"),
        className: "status-text status-error",
      };
    }
    return inlineReadinessSummary(features);
  }

  // Thresholds
  const headsUpEnabled = document.getElementById("headsUpEnabled") as HTMLInputElement | null;
  if (headsUpEnabled) {
    headsUpEnabled.checked = settings.enabled !== false;
    headsUpEnabled.addEventListener("change", async () => {
      settings.enabled = headsUpEnabled.checked;
      await saveSettings(settings);
      await broadcastSettingsUpdate(settings);
      renderActivationOverview();
    });
  }

  function thresholdCopyFor(cat: FilterCategory): { label: string; previewLabel: string; description: string } {
    return {
      label: optT(`options.threshold.${cat}.label`),
      previewLabel: "",
      description: optT(`options.threshold.${cat}.description`),
    };
  }
  const container = document.getElementById("thresholds");
  const thresholdPresetControl = document.getElementById("thresholdPresetControl");
  const thresholdPresetNote = document.getElementById("thresholdPresetNote");

  function renderThresholdPresetState(): void {
    const preset = detectThresholdPreset(settings.thresholds);
    thresholdPresetNote!.textContent = thresholdPresetNoteText(preset, resolveLanguage(settings.language));
    for (const button of thresholdPresetControl!.querySelectorAll<HTMLButtonElement>("button[data-threshold-preset]")) {
      button.setAttribute("aria-pressed", String(button.dataset.thresholdPreset === preset));
    }
  }
  i18nDynamicRenderers.push(() => {
    if (thresholdPresetNote) renderThresholdPresetState();
  });

  function renderThresholdControls(): void {
    if (!container) return;
    container.innerHTML = "";
    for (const cat of ALL_CATEGORIES) {
      const copy = thresholdCopyFor(cat);
      const row = createThresholdRow(
        settings.thresholds[cat],
        async (val) => {
          settings.thresholds[cat] = val;
          renderThresholdPresetState();
          await saveSettings(settings);
          await broadcastSettingsUpdate(settings);
        },
        copy,
      );
      container.appendChild(row);
    }
    renderThresholdPresetState();
  }
  i18nDynamicRenderers.push(renderThresholdControls);

  thresholdPresetControl?.addEventListener("click", (event) => {
    const button = (event.target as HTMLElement | null)?.closest<HTMLButtonElement>("button[data-threshold-preset]");
    const preset = button?.dataset.thresholdPreset as ThresholdPresetName | undefined;
    if (!preset || !THRESHOLD_PRESETS[preset]) return;
    Object.assign(settings.thresholds, THRESHOLD_PRESETS[preset]);
    renderThresholdControls();
    void saveSettings(settings).then(() => broadcastSettingsUpdate(settings));
  });

  if (container && thresholdPresetControl && thresholdPresetNote) {
    renderThresholdControls();
  }

  // Custom fold rules CRUD
  const rulesList = document.getElementById("customFoldRulesList");
  const rulesError = document.getElementById("customFoldRulesError");
  const addRuleBtn = document.getElementById("addCustomRule");
  const foldEnabled = document.getElementById("foldEnabled") as HTMLInputElement | null;
  if (foldEnabled) {
    foldEnabled.checked = settings.foldEnabled === true;
  }
  if (rulesList && addRuleBtn) {
    if (!Array.isArray(settings.customFoldRules)) settings.customFoldRules = [];

    const showError = (msg: string) => {
      if (!rulesError) return;
      rulesError.textContent = msg;
      rulesError.style.display = "block";
      setTimeout(() => {
        if (rulesError) rulesError.style.display = "none";
      }, 4000);
    };

    const renderRules = () => {
      rulesList.innerHTML = "";
      for (const rule of settings.customFoldRules) {
        rulesList.appendChild(buildRuleRow(rule));
      }
    };
    i18nDynamicRenderers.push(renderRules);

    const buildRuleRow = (rule: CustomFoldRule): HTMLElement => {
      const row = document.createElement("div");
      row.className = "form-group custom-rule-row";

      const nameLabel = document.createElement("label");
      nameLabel.textContent = optT("options.rules.nameLabel");
      const nameInput = document.createElement("input");
      nameInput.type = "text";
      nameInput.maxLength = 32;
      nameInput.value = rule.name;
      nameInput.addEventListener("input", async () => {
        rule.name = nameInput.value.trim();
        await saveSettings(settings);
        await broadcastSettingsUpdate(settings);
      });

      const promptLabel = document.createElement("label");
      promptLabel.textContent = optT("options.rules.promptLabel");
      const promptInput = document.createElement("textarea");
      promptInput.maxLength = 500;
      promptInput.style.minHeight = "60px";
      promptInput.value = rule.prompt;
      promptInput.addEventListener("input", async () => {
        rule.prompt = promptInput.value.trim();
        await saveSettings(settings);
        await broadcastSettingsUpdate(settings);
      });

      const thresholdRow = createThresholdRow(
        rule.threshold,
        async (v) => {
          rule.threshold = v;
          await saveSettings(settings);
          await broadcastSettingsUpdate(settings);
        },
        {
          label: optT("options.rules.thresholdLabel"),
          description: optT("options.threshold.defaultDescription"),
        },
      );

      const enabledLabel = document.createElement("label");
      const enabledCheckbox = document.createElement("input");
      enabledCheckbox.type = "checkbox";
      enabledCheckbox.checked = rule.enabled;
      enabledCheckbox.addEventListener("change", async () => {
        if (enabledCheckbox.checked) {
          const enabledCount = settings.customFoldRules.filter(
            (r) => r.enabled && r.id !== rule.id,
          ).length;
          if (enabledCount >= MAX_ACTIVE_FOLD_RULES) {
            enabledCheckbox.checked = false;
            showError(optT("options.rules.maxActiveError", { count: MAX_ACTIVE_FOLD_RULES }));
            return;
          }
          // Name uniqueness among enabled rules.
          const dup = settings.customFoldRules.some(
            (r) => r.enabled && r.id !== rule.id && r.name === rule.name && r.name.length > 0,
          );
          if (dup) {
            enabledCheckbox.checked = false;
            showError(optT("options.rules.duplicateNameError", { name: rule.name }));
            return;
          }
        }
        rule.enabled = enabledCheckbox.checked;
        await saveSettings(settings);
        await broadcastSettingsUpdate(settings);
      });
      enabledLabel.appendChild(enabledCheckbox);
      enabledLabel.appendChild(document.createTextNode(optT("options.rules.enabledSuffix")));

      const deleteBtn = document.createElement("button");
      deleteBtn.type = "button";
      deleteBtn.className = "btn btn-danger-soft";
      deleteBtn.textContent = optT("options.rules.delete");
      deleteBtn.addEventListener("click", async () => {
        settings.customFoldRules = settings.customFoldRules.filter((r) => r.id !== rule.id);
        await saveSettings(settings);
        await broadcastSettingsUpdate(settings);
        renderRules();
      });

      row.appendChild(nameLabel);
      row.appendChild(nameInput);
      row.appendChild(promptLabel);
      row.appendChild(promptInput);
      row.appendChild(thresholdRow);
      const controlsRow = document.createElement("div");
      controlsRow.className = "custom-rule-actions";
      controlsRow.appendChild(enabledLabel);
      controlsRow.appendChild(deleteBtn);
      row.appendChild(controlsRow);
      return row;
    };

    addRuleBtn.addEventListener("click", async () => {
      const newRule: CustomFoldRule = {
        id: makeUuid(),
        name: "",
        prompt: "",
        threshold: 0.6,
        enabled: false,
      };
      settings.customFoldRules.unshift(newRule);
      await saveSettings(settings);
      renderRules();
    });

    renderRules();
  }
  document.getElementById("saveFoldRuleMode")?.addEventListener("click", async () => {
    settings.foldEnabled = foldEnabled?.checked === true;
    await saveSettings(settings);
    await broadcastSettingsUpdate(settings);
  });

  // Sponsored display mode
  const sponsoredCollapseEnabled = document.getElementById(
    "sponsoredCollapseEnabled"
  ) as HTMLInputElement | null;
  if (sponsoredCollapseEnabled) {
    sponsoredCollapseEnabled.checked = settings.sponsoredDisplayMode === "collapse";
  }
  const rightRailAdsCollapseEnabled = document.getElementById(
    "rightRailAdsCollapseEnabled",
  ) as HTMLInputElement | null;
  const reelsCollapseEnabled = document.getElementById(
    "reelsCollapseEnabled",
  ) as HTMLInputElement | null;
  if (rightRailAdsCollapseEnabled) {
    rightRailAdsCollapseEnabled.checked = settings.collapseRightRailAdsEnabled;
  }
  if (reelsCollapseEnabled) {
    reelsCollapseEnabled.checked = settings.collapseReelsEnabled;
  }

  async function saveDeveloperSurfaceSettings(): Promise<void> {
    if (sponsoredCollapseEnabled) {
      settings.sponsoredDisplayMode = sponsoredCollapseEnabled.checked ? "collapse" : "none";
    }
    if (rightRailAdsCollapseEnabled) {
      settings.collapseRightRailAdsEnabled = rightRailAdsCollapseEnabled.checked;
    }
    if (reelsCollapseEnabled) {
      settings.collapseReelsEnabled = reelsCollapseEnabled.checked;
    }
    await saveSettings(settings);
    await broadcastSettingsUpdate(settings);
  }

  sponsoredCollapseEnabled?.addEventListener("change", () => {
    void saveDeveloperSurfaceSettings();
  });
  rightRailAdsCollapseEnabled?.addEventListener("change", () => {
    void saveDeveloperSurfaceSettings();
  });
  reelsCollapseEnabled?.addEventListener("change", () => {
    void saveDeveloperSurfaceSettings();
  });

  // External tool settings
  const markdownDownloadModeInputs = Array.from(
    document.querySelectorAll<HTMLInputElement>('input[name="markdownDownloadMode"]'),
  );
  function renderMarkdownDownloadMode(): void {
    for (const input of markdownDownloadModeInputs) {
      input.checked = input.value === settings.markdownDownloadMode;
    }
  }
  renderMarkdownDownloadMode();
  for (const input of markdownDownloadModeInputs) {
    input.addEventListener("change", async () => {
      if (!input.checked) return;
      settings.markdownDownloadMode = input.value === "browser-download"
        ? "browser-download"
        : "directory-picker";
      renderMarkdownDownloadMode();
      await saveSettings(settings);
      await broadcastSettingsUpdate(settings);
    });
  }

  // Provider selection
  const providerSelect = document.getElementById(
    "providerSelect"
  ) as HTMLSelectElement;
  const apiKeyGroup = document.getElementById("apiKeyGroup")!;
  const ollamaConfig = document.getElementById("ollamaConfig") as HTMLElement;
  const apiKeyInput = document.getElementById("apiKey") as HTMLInputElement;
  const tierAApiKeySessionOnly = document.getElementById("tierAApiKeySessionOnly") as HTMLInputElement;
  const apiKeyStatus = document.getElementById("apiKeyStatus")!;
  const ollamaEndpoint = document.getElementById(
    "ollamaEndpoint"
  ) as HTMLInputElement;
  const ollamaModel = document.getElementById(
    "ollamaModel"
  ) as HTMLInputElement;
  const ollamaModelSelect = document.getElementById(
    "ollamaModelSelect"
  ) as HTMLSelectElement;
  const refreshTierAModelsButton = document.getElementById(
    "refreshTierAModels"
  ) as HTMLButtonElement;
  const llmEndpointLabel = document.getElementById("llmEndpointLabel")!;
  const openAICompatConfig = document.getElementById("openAICompatConfig")!;
  const openAICompatibleFlavor = document.getElementById(
    "openAICompatibleFlavor"
  ) as HTMLSelectElement;
  const openAICompatibleFlavorRadios = Array.from(
    document.querySelectorAll<HTMLInputElement>("input[data-tier-a-openai-compatible-flavor]")
  );
  const tierBOpenAICompatibleFlavorRadios = Array.from(
    document.querySelectorAll<HTMLInputElement>("input[data-tier-b-openai-compatible-flavor]")
  );
  const openAIResponseFormat = document.getElementById(
    "openAIResponseFormat"
  ) as HTMLSelectElement;
  const tierAOutputMode = document.getElementById(
    "tierAOutputMode"
  ) as HTMLInputElement;
  const ollamaEndpointError = document.getElementById("ollamaEndpointError")!;
  const ollamaEndpointWarning = document.getElementById("ollamaEndpointWarning")!;
  const ollamaStatus = document.getElementById("ollamaStatus")!;
  const copyTierADiagnosticsButton = document.getElementById("copyTierADiagnostics") as HTMLButtonElement;
  const tierAProviderHelp = document.getElementById("tierAProviderHelp")!;
  const tierALaneSource = document.getElementById("tierALaneSource")!;
  const tierALaneMeta = document.getElementById("tierALaneMeta")!;
  const tierALaneStatus = document.getElementById("tierALaneStatus")!;
  const tierAInlineStatus = document.getElementById("tierAInlineStatus")!;

  const savedTierAProvider = getTierAProvider(settings);
  providerSelect.value = savedTierAProvider === "none" ? "chrome-gemini-nano" : savedTierAProvider;
  openAICompatibleFlavor.value = settings.openAICompatibleFlavor;
  openAIResponseFormat.value = settings.openAIResponseFormat;
  tierAOutputMode.checked = settings.tierAOutputMode === "compact_digits";
  function syncOpenAICompatibleFlavor(value: string): void {
    openAICompatibleFlavor.value = value;
    [...openAICompatibleFlavorRadios, ...tierBOpenAICompatibleFlavorRadios].forEach((radio) => {
      radio.checked = radio.value === value;
    });
  }
  syncOpenAICompatibleFlavor(settings.openAICompatibleFlavor);

  function currentTierAOutputMode(): TierAOutputMode {
    return tierAOutputMode.checked ? "compact_digits" : "json";
  }

  function setLaneStatus(el: HTMLElement, text: string, record: ReadinessRecord | undefined): void {
    const statusClass = readinessBadgeClass(record);
    el.textContent = text;
    el.className = `model-lane-status ${statusClass}`;
  }

  function setTierAInlineStatus(text: string, className = "status-text model-inline-status"): void {
    tierAInlineStatus.textContent = text;
    tierAInlineStatus.className = className.includes("model-inline-status")
      ? className
      : `${className} model-inline-status`;
  }

  function endpointWarningText(rawEndpoint: string): string {
    return endpointSecurityWarnings(rawEndpoint)
      .map((warning) =>
        warning === "secret-in-url"
          ? optT("common.endpointWarnSecret")
          : optT("common.endpointWarnHttp")
      )
      .join("\n");
  }

  function renderEndpointWarning(input: HTMLInputElement, warningEl: HTMLElement): void {
    const text = endpointWarningText(input.value || input.placeholder);
    warningEl.textContent = text;
    warningEl.style.display = text ? "" : "none";
  }

  let tierADiagnosticsText = "";

  function clearTierADiagnostics(): void {
    tierADiagnosticsText = "";
    copyTierADiagnosticsButton.style.display = "none";
    copyTierADiagnosticsButton.textContent = optT("options.modelTest.copyDiagnostics");
  }

  function buildTierADiagnostics(details: {
    phase: string;
    endpoint?: string;
    model?: string;
    endpointKind?: TierAEndpointKind;
    error?: string;
    parseError?: string;
    raw?: string;
  }): string {
    const provider = providerSelect.value as TierAProvider;
    const endpoint = details.endpoint || ollamaEndpoint.value.trim() || "(empty)";
    const model = details.model || ollamaModel.value.trim() || "(empty)";
    const raw = details.raw?.replace(/\s+/g, " ").trim();
    const lines = [
      "Truly Tier A model diagnostic",
      `buildId: ${__TRULY_BUILD_ID__}`,
      `phase: ${details.phase}`,
      `provider: ${provider}`,
      `endpointKind: ${details.endpointKind || providerEndpointKind(provider)}`,
      `openAICompatibleFlavor: ${openAICompatibleFlavor.value}`,
      `responseFormat: ${openAIResponseFormat.value}`,
      `outputMode: ${currentTierAOutputMode()}`,
      `endpoint: ${endpoint}`,
      `model: ${model}`,
      `error: ${details.error || "(none)"}`,
      `parseError: ${details.parseError || "(none)"}`,
    ];
    if (raw) {
      lines.push(`rawExcerpt: ${raw.slice(0, 1200)}`);
    }
    return lines.join("\n");
  }

  function showTierADiagnostics(text: string): void {
    tierADiagnosticsText = text;
    copyTierADiagnosticsButton.style.display = "";
    copyTierADiagnosticsButton.textContent = optT("options.modelTest.copyDiagnostics");
  }

  async function copyTierADiagnostics(): Promise<void> {
    if (!tierADiagnosticsText) return;
    const original = optT("options.modelTest.copyDiagnostics");
    try {
      if (!navigator.clipboard?.writeText) throw new Error("clipboard_unavailable");
      await navigator.clipboard.writeText(tierADiagnosticsText);
      copyTierADiagnosticsButton.textContent = optT("options.modelTest.diagnosticsCopied");
      setTimeout(() => {
        if (copyTierADiagnosticsButton.style.display !== "none") {
          copyTierADiagnosticsButton.textContent = original;
        }
      }, 1600);
    } catch {
      copyTierADiagnosticsButton.textContent = optT("options.modelTest.diagnosticsCopyFailed");
      setTimeout(() => {
        if (copyTierADiagnosticsButton.style.display !== "none") {
          copyTierADiagnosticsButton.textContent = original;
        }
      }, 1800);
    }
  }

  copyTierADiagnosticsButton.addEventListener("click", () => {
    void copyTierADiagnostics();
  });

  function renderGeminiNanoProviderHelp(): void {
    tierAProviderHelp.innerHTML = "";
    tierAProviderHelp.append(document.createTextNode(optT("options.provider.geminiHelpPrefix")));
    const link = document.createElement("a");
    link.href = "chrome://on-device-internals/";
    link.target = "_blank";
    link.rel = "noreferrer";
    link.id = "onDeviceInternalsLink";
    link.textContent = optT("options.provider.geminiHelpLink");
    tierAProviderHelp.appendChild(link);
    link.addEventListener("click", (event) => {
      event.preventDefault();
      void browser.tabs.create({ url: "chrome://on-device-internals/" });
    });
  }

  function refreshTierALaneSummary(): void {
    const provider = providerSelect.value as TierAProvider;
    const record = freshReadinessRecord("realtime");
    const endpoint = ollamaEndpoint.value.trim() || currentReadinessEnvironment().tierAEndpoint;
    const model = ollamaModel.value.trim() || currentReadinessEnvironment().tierAModel;
    if (provider === "none") {
      tierALaneSource.textContent = optT("options.tierA.disabledSource");
      tierALaneMeta.textContent = optT("options.tierA.disabledMeta");
      setLaneStatus(tierALaneStatus, optT("readiness.status.off"), record);
      return;
    }
    tierALaneSource.textContent = providerDisplayLabel(provider);
    if (providerNeedsEndpoint(provider)) {
      tierALaneMeta.textContent = `${endpoint} · ${model}`;
    } else if (provider === "chrome-gemini-nano") {
      tierALaneMeta.textContent = optT("options.provider.noEndpointNoKey");
    } else if (providerNeedsApiKey(provider)) {
      tierALaneMeta.textContent = optT("options.provider.apiKeyThenCheck");
    } else {
      tierALaneMeta.textContent = optT("options.provider.saveThenCheck");
    }
    setLaneStatus(tierALaneStatus, readinessBadgeText(record), record);
  }

  function currentTierAEndpointInput(provider: TierAProvider): string {
    return normalizeEndpointInput(
      ollamaEndpoint.value,
      isEndpointBackedModelProvider(provider) ? defaultEndpointForProvider(provider) : "",
    );
  }

  function currentTierAModelInput(provider: TierAProvider): string {
    const value = ollamaModelSelect.style.display !== "none"
      ? ollamaModelSelect.value
      : ollamaModel.value.trim();
    return value || defaultModelForProvider(provider, "reading-prompt");
  }

  function rememberTierAProviderDraft(provider: TierAProvider): void {
    if (!isEndpointBackedModelProvider(provider)) return;
    tierAProviderConfigs = withProviderModelConfig(tierAProviderConfigs, provider, {
      endpoint: currentTierAEndpointInput(provider),
      model: currentTierAModelInput(provider),
    });
  }

  function restoreTierAProviderDraft(provider: TierAProvider): void {
    if (!isEndpointBackedModelProvider(provider)) return;
    const config = providerModelConfigOrDefault(tierAProviderConfigs, provider, "reading-prompt");
    ollamaEndpoint.value = config.endpoint;
    ollamaModel.value = config.model;
  }

  let activeTierAProviderDraft = providerSelect.value as TierAProvider;

  function updateProviderUI() {
    const provider = providerSelect.value as UserSettings["tierAProvider"];
    const capabilities = providerCapabilities(provider);
    const needsEndpoint = providerNeedsEndpoint(provider);
    apiKeyGroup.style.display = providerSupportsOptionalApiKey(provider) ? "block" : "none";
    apiKeyStatus.textContent = providerSupportsOptionalApiKey(provider)
      ? optT("options.provider.apiKeyOptionalHelp")
      : "";
    apiKeyStatus.className = "status-text";
    ollamaConfig.style.display = needsEndpoint ? "block" : "none";
    refreshTierAModelsButton.style.display = needsEndpoint ? "" : "none";
    openAICompatConfig.style.display = provider === "openai-compatible" ? "block" : "none";
    llmEndpointLabel.textContent = optT("common.endpoint");
    ollamaEndpoint.placeholder = defaultEndpointForProvider(provider);
    ollamaModel.placeholder = defaultModelForProvider(provider, "reading-prompt");
    renderEndpointWarning(ollamaEndpoint, ollamaEndpointWarning);
    ollamaStatus.textContent = "";
    clearTierADiagnostics();
    if (provider === "none") {
      tierAProviderHelp.textContent = optT("options.tierA.noneHelp");
    } else if (provider === "chrome-gemini-nano") {
      renderGeminiNanoProviderHelp();
    } else if (providerNeedsEndpoint(provider)) {
      tierAProviderHelp.textContent = provider === "openai-compatible"
        ? optT("options.provider.openAIHelp")
        : optT("options.provider.ollamaHelp");
    } else if (capabilities.requiresApiKey) {
      tierAProviderHelp.textContent = optT("options.provider.apiKeyHelp");
    } else {
      tierAProviderHelp.textContent = optT("options.provider.testOnSave");
    }
    setTierAInlineStatus("");
    refreshTierALaneSummary();
  }
  updateProviderUI();
  i18nDynamicRenderers.push(updateProviderUI);
  providerSelect.addEventListener("change", () => {
    rememberTierAProviderDraft(activeTierAProviderDraft);
    activeTierAProviderDraft = providerSelect.value as TierAProvider;
    restoreTierAProviderDraft(activeTierAProviderDraft);
    showModelFallback();
    updateProviderUI();
  });
  [...openAICompatibleFlavorRadios, ...tierBOpenAICompatibleFlavorRadios].forEach((radio) => {
    radio.addEventListener("change", () => {
      if (radio.checked) {
        syncOpenAICompatibleFlavor(radio.value);
        settings.openAICompatibleFlavor = radio.value as OpenAICompatibleFlavor;
      }
    });
  });
  tierAOutputMode.addEventListener("change", updateProviderUI);

  async function probeGeminiNano(mode: "tier-a" | "tier-b"): Promise<{ ok: boolean; availability?: string; error?: string }> {
    try {
      const result = await browser.runtime.sendMessage({
        type: "GEMINI_NANO_SMOKE",
        mode,
      });
      return {
        ok: result?.ok === true,
        availability: result?.availability,
        error: result?.error,
      };
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  interface HealthCheckOutcome {
    ok: boolean;
    models: string[];
    error?: string;
  }

  async function runHealthCheck(
    endpoint: string,
    endpointKind: TierAEndpointKind,
    statusEl: HTMLElement = ollamaStatus,
    apiKey?: string,
  ): Promise<HealthCheckOutcome> {
    statusEl.textContent = optT("options.modelTest.checking");
    statusEl.className = statusEl.className.includes("model-inline-status")
      ? "status-text model-inline-status is-working"
      : "status-text";
    try {
      const result = await browser.runtime.sendMessage({
        type: "OLLAMA_HEALTH_CHECK",
        endpoint,
        endpointKind,
        apiKey: endpointKind === "openai-compatible" ? apiKey : undefined,
      });
      if (result?.ok && Array.isArray(result.models)) {
        return { ok: true, models: result.models };
      }
      return { ok: false, models: [], error: result?.error || "unknown error" };
    } catch (e) {
      return {
        ok: false,
        models: [],
        error: e instanceof Error ? e.message : "unknown",
      };
    }
  }

  function isEndpointAuthError(error: string | undefined): boolean {
    return /\bHTTP\s*(401|403)\b/i.test(error ?? "");
  }

  function formatEndpointError(error: string | undefined): string {
    if (isEndpointAuthError(error)) return optT("options.modelTest.apiKeyNotAccepted");
    const message = error?.trim();
    return message
      ? optT("options.modelTest.connectionFailedWithMessage", { message })
      : optT("options.modelTest.connectionFailed");
  }

  function modelListStatusClass(statusEl: HTMLElement, kind: "ok" | "error"): string {
    const base = kind === "ok" ? "status-text status-ok" : "status-text status-error";
    return statusEl.className.includes("model-inline-status")
      ? `${base} model-inline-status`
      : base;
  }

  async function fetchEndpointModels(
    provider: TierAProvider | TierBProvider,
    endpointInput: HTMLInputElement,
    endpointErrorEl: HTMLElement,
    statusEl: HTMLElement,
    apiKey?: string,
  ): Promise<{ endpoint: string; health: HealthCheckOutcome } | null> {
    const endpoint = normalizeEndpointInput(
      endpointInput.value,
      defaultEndpointForProvider(provider),
    );
    endpointInput.value = endpoint;

    const validationError = validateEndpointUrl(endpoint);
    if (validationError) {
      endpointErrorEl.textContent = validationError;
      endpointErrorEl.className = "status-text status-error";
      endpointErrorEl.style.display = "";
      statusEl.textContent = optT("options.modelTest.endpointNeedsWork");
      statusEl.className = modelListStatusClass(statusEl, "error");
      return null;
    }
    endpointErrorEl.style.display = "none";

    const health = await runHealthCheck(endpoint, providerEndpointKind(provider), statusEl, apiKey);
    return { endpoint, health };
  }

  async function runResponseFormatCheck(
    endpoint: string,
    model: string,
    endpointKind: TierAEndpointKind,
    apiKey?: string,
  ): Promise<{ ok: boolean; error?: string; raw?: string; parseError?: string }> {
    if (
      endpointKind !== "openai-compatible" ||
      openAIResponseFormat.value === "none" ||
      currentTierAOutputMode() === "compact_digits"
    ) {
      return { ok: true };
    }
    ollamaStatus.textContent = optT("options.modelTest.responseFormatChecking");
    ollamaStatus.className = "status-text";
    try {
      const result = await browser.runtime.sendMessage({
        type: "OLLAMA_RESPONSE_FORMAT_CHECK",
        endpoint,
        model,
        endpointKind,
        openAICompatibleFlavor: openAICompatibleFlavor.value as OpenAICompatibleFlavor,
        responseFormat: openAIResponseFormat.value as OpenAIResponseFormatMode,
        outputMode: currentTierAOutputMode(),
        apiKey: endpointKind === "openai-compatible" ? apiKey : undefined,
      });
      return result?.ok
        ? { ok: true }
        : {
            ok: false,
            error: result?.error || "response_format check failed",
            raw: result?.raw,
            parseError: result?.parseError,
          };
    } catch (e) {
      return {
        ok: false,
        error: e instanceof Error ? e.message : "unknown",
      };
    }
  }

  function shortModelOutputExcerpt(raw?: string): string {
    if (!raw) return "";
    const normalized = raw.replace(/\s+/g, " ").trim();
    if (normalized.length <= 160) return normalized;
    return normalized.slice(0, 157).trimEnd() + "...";
  }

  function formatResponseFormatFailure(
    result: { error?: string; raw?: string; parseError?: string },
  ): string {
    const error = result.parseError || result.error || optT("options.modelTest.outputFormatDefaultError");
    const raw = shortModelOutputExcerpt(result.raw);
    if (raw) {
      return optT("options.modelTest.outputFormatFailedWithExcerpt", { error, raw });
    }
    return optT("options.modelTest.outputFormatFailed", { error });
  }

  function activeCustomRulesForProbe(): { id: string; prompt: string }[] {
    return (settings.customFoldRules || [])
      .filter((r) => r.enabled)
      .slice(0, MAX_ACTIVE_FOLD_RULES)
      .map((r) => ({ id: r.id, prompt: r.prompt }));
  }

  async function runCompactDigitsCheck(
    endpoint: string,
    model: string,
    endpointKind: TierAEndpointKind,
    apiKey?: string,
  ): Promise<{ ok: boolean; error?: string }> {
    if (currentTierAOutputMode() !== "compact_digits") return { ok: true };
    const customRules = activeCustomRulesForProbe();
    const expectedLength = 4 + customRules.length;
    ollamaStatus.textContent = optT("options.modelTest.compactDigitsChecking", { count: expectedLength });
    ollamaStatus.className = "status-text";
    try {
      const result = await browser.runtime.sendMessage({
        type: "OLLAMA_COMPACT_DIGITS_CHECK",
        endpoint,
        model,
        endpointKind,
        openAICompatibleFlavor: openAICompatibleFlavor.value as OpenAICompatibleFlavor,
        customRules,
        apiKey: endpointKind === "openai-compatible" ? apiKey : undefined,
      });
      return result?.ok
        ? { ok: true }
        : {
            ok: false,
            error:
              result?.error ||
              `expected exactly ${result?.expectedLength || expectedLength} digits`,
          };
    } catch (e) {
      return {
        ok: false,
        error: e instanceof Error ? e.message : "unknown",
      };
    }
  }

  function populateModelDropdown(models: string[], resolvedModel: string): void {
    ollamaModelSelect.innerHTML = "";
    for (const name of models) {
      const opt = document.createElement("option");
      opt.value = name;
      opt.textContent = name;
      ollamaModelSelect.appendChild(opt);
    }
    if (models.includes(resolvedModel)) {
      ollamaModelSelect.value = resolvedModel;
    }
    ollamaModelSelect.style.display = "";
    ollamaModel.style.display = "none";
    ollamaModelSelect.addEventListener(
      "change",
      () => {
        ollamaModel.value = ollamaModelSelect.value;
        rememberTierAProviderDraft(providerSelect.value as TierAProvider);
      },
      { once: true },
    );
  }

  function showModelFallback() {
    ollamaModelSelect.style.display = "none";
    ollamaModel.style.display = "";
  }

  async function refreshTierAModelList(): Promise<void> {
    const provider = providerSelect.value as TierAProvider;
    if (!providerNeedsEndpoint(provider)) return;
    const result = await fetchEndpointModels(
      provider,
      ollamaEndpoint,
      ollamaEndpointError,
      ollamaStatus,
      apiKeyForProvider(provider, apiKeyInput),
    );
    if (!result) return;

    const fallbackModel = defaultModelForProvider(provider, "reading-prompt");
    const userModel = ollamaModelSelect.style.display !== "none"
      ? ollamaModelSelect.value
      : (ollamaModel.value.trim() || fallbackModel);
    if (result.health.ok && result.health.models.length > 0) {
      const resolvedModel = resolveModelName(userModel, result.health.models);
      populateModelDropdown(result.health.models, resolvedModel);
      ollamaModel.value = resolvedModel;
      ollamaStatus.textContent = optT("options.modelTest.connectedModels", {
        count: result.health.models.length,
        note: resolvedModel !== userModel.trim()
          ? optT("options.common.usingModelSuffix", { model: resolvedModel })
          : "",
        formatNote: "",
      });
      ollamaStatus.className = modelListStatusClass(ollamaStatus, "ok");
      rememberTierAProviderDraft(provider);
      refreshTierALaneSummary();
    } else {
      showModelFallback();
      ollamaStatus.textContent = optT("options.modelTest.modelListFailed");
      ollamaStatus.className = modelListStatusClass(ollamaStatus, "error");
    }
  }

  // Load saved API key and Tier A endpoint config
  const stored = await browser.storage.local.get([
    "apiKey",
    "tierAApiKey",
    "tierAApiKeySessionOnly",
  ]);
  const storedSession = await sessionStorageGet(["tierAApiKey"]);
  const storedTierAApiKey = (stored.tierAApiKey as string) || (stored.apiKey as string) || "";
  tierAApiKeySessionOnly.checked = stored.tierAApiKeySessionOnly !== false;
  apiKeyInput.value = tierAApiKeySessionOnly.checked
    ? (storedSession.tierAApiKey as string) || storedTierAApiKey
    : storedTierAApiKey;
  restoreTierAProviderDraft(providerSelect.value as TierAProvider);
  refreshTierALaneSummary();
  ollamaEndpoint.addEventListener("input", () => {
    showModelFallback();
    rememberTierAProviderDraft(providerSelect.value as TierAProvider);
    renderEndpointWarning(ollamaEndpoint, ollamaEndpointWarning);
    refreshTierALaneSummary();
  });
  ollamaModel.addEventListener("input", () => {
    rememberTierAProviderDraft(providerSelect.value as TierAProvider);
    refreshTierALaneSummary();
  });
  refreshTierAModelsButton.addEventListener("click", () => {
    void runWithPendingButton(
      refreshTierAModelsButton,
      refreshTierAModelList,
      optT("options.modelTest.fetchingModels"),
    );
  });

  async function runWithPendingButton(
    button: HTMLButtonElement,
    action: () => Promise<void>,
    pendingText = optT("activation.testing"),
  ): Promise<void> {
    const label = button.textContent || optT("common.testSave");
    button.disabled = true;
    button.textContent = pendingText;
    try {
      await action();
    } finally {
      button.disabled = false;
      button.textContent = label;
    }
  }

  const modelTestPendingText = () => optT("options.modelTest.checking");
  const modelTestWorkingClass = "status-text model-inline-status is-working";
  const modelTestErrorClass = "status-text status-error model-inline-status";

  // Save provider
  const saveProviderButton = document.getElementById("saveProvider") as HTMLButtonElement;
  saveProviderButton.addEventListener("click", () => {
    void runWithPendingButton(saveProviderButton, async () => {
      const provider = providerSelect.value as UserSettings["tierAProvider"];
      clearTierADiagnostics();
      setTierAInlineStatus(modelTestPendingText(), modelTestWorkingClass);
      applySharedModelSettings(provider);
      settings.openAICompatibleFlavor = openAICompatibleFlavor.value as OpenAICompatibleFlavor;
      settings.openAIResponseFormat = DEFAULT_SETTINGS.openAIResponseFormat;
      settings.tierAOutputMode = currentTierAOutputMode();

      if (providerNeedsEndpoint(provider)) {
        const endpointKind = providerEndpointKind(provider);
        const defaultEndpoint = defaultEndpointForProvider(provider);
        const defaultModel = defaultModelForProvider(provider, "reading-prompt");
        const tierAApiKey = apiKeyForProvider(provider, apiKeyInput);
        const endpoint = normalizeEndpointInput(ollamaEndpoint.value, defaultEndpoint);
        ollamaEndpoint.value = endpoint;
        renderEndpointWarning(ollamaEndpoint, ollamaEndpointWarning);

        // Validate URL
        const validationError = validateEndpointUrl(endpoint);
        if (validationError) {
          ollamaEndpointError.textContent = validationError;
          ollamaEndpointError.className = "status-text status-error";
          ollamaEndpointError.style.display = "";
          setTierAInlineStatus(optT("options.modelTest.endpointNeedsWork"), modelTestErrorClass);
          return;
        }
        ollamaEndpointError.style.display = "none";

        // User's raw model input (before resolution).
        const userModel = ollamaModelSelect.style.display !== "none"
          ? ollamaModelSelect.value
          : (ollamaModel.value.trim() || defaultModel);
        ollamaModel.value = userModel;

        // Health check BEFORE persist so we can resolve partial model names
        // (e.g. "qwen3.5" → "qwen3.5:latest") against the server's list.
        const health = await runHealthCheck(endpoint, endpointKind, ollamaStatus, tierAApiKey);

        let resolvedModel = userModel;
        if (health.ok) {
          resolvedModel = resolveModelName(userModel, health.models);
          populateModelDropdown(health.models, resolvedModel);
          ollamaModel.value = resolvedModel;
          const formatCheck = await runResponseFormatCheck(endpoint, resolvedModel, endpointKind, tierAApiKey);
          if (!formatCheck.ok) {
            ollamaStatus.textContent = formatResponseFormatFailure(formatCheck);
            ollamaStatus.className = "status-text status-error";
            showTierADiagnostics(buildTierADiagnostics({
              phase: "response_format",
              endpoint,
              model: resolvedModel,
              endpointKind,
              error: formatCheck.error,
              parseError: formatCheck.parseError,
              raw: formatCheck.raw,
            }));
            setTierAInlineStatus(optT("options.modelTest.outputFormatNeedsWork"), modelTestErrorClass);
            return;
          }
          const compactCheck = await runCompactDigitsCheck(endpoint, resolvedModel, endpointKind, tierAApiKey);
          if (!compactCheck.ok) {
            ollamaStatus.textContent = optT("options.modelTest.compactDigitsUnsupported", { error: compactCheck.error || "unknown" });
            ollamaStatus.className = "status-text status-error";
            showTierADiagnostics(buildTierADiagnostics({
              phase: "compact_digits",
              endpoint,
              model: resolvedModel,
              endpointKind,
              error: compactCheck.error,
            }));
            setTierAInlineStatus(optT("options.modelTest.compactDigitsNeedsWork"), modelTestErrorClass);
            return;
          }
          const note = resolvedModel !== userModel.trim()
            ? optT("options.common.usingModelSuffix", { model: resolvedModel })
            : "";
          const formatNote = settings.tierAOutputMode === "compact_digits"
            ? " · compact_digits"
            : "";
          ollamaStatus.textContent = optT("options.modelTest.connectedModels", {
            count: health.models.length,
            note,
            formatNote,
          });
          ollamaStatus.className = "status-text status-ok";
          clearTierADiagnostics();
        } else {
          const endpointError = formatEndpointError(health.error);
          ollamaStatus.textContent = endpointError;
          ollamaStatus.className = "status-text status-error";
          showModelFallback();
          showTierADiagnostics(buildTierADiagnostics({
            phase: "health_check",
            endpoint,
            model: userModel,
            endpointKind,
            error: health.error,
          }));
          if (settings.tierAOutputMode === "compact_digits" && !isEndpointAuthError(health.error)) {
            ollamaStatus.textContent = optT("options.modelTest.compactDigitsConnectionFailed", { error: health.error || "unknown" });
            ollamaStatus.className = "status-text status-error";
            setTierAInlineStatus(optT("options.modelTest.connectionCannotComplete"), modelTestErrorClass);
            return;
          }
          if (provider === "openai-compatible") {
            setTierAInlineStatus(endpointError, modelTestErrorClass);
            return;
          }
        }

        if (isEndpointBackedModelProvider(provider)) {
          tierAProviderConfigs = withProviderModelConfig(tierAProviderConfigs, provider, {
            endpoint,
            model: resolvedModel,
          });
        }
        await browser.storage.local.set({
          ollamaEndpoint: endpoint,
          ollamaModel: resolvedModel,
          tierAProviderConfigs,
        });
        if (providerSupportsOptionalApiKey(provider)) {
          await persistApiKeyPreference({
            key: "tierAApiKey",
            sessionFlag: "tierAApiKeySessionOnly",
            value: tierAApiKey || "",
            sessionOnly: tierAApiKeySessionOnly.checked,
            clearLegacyApiKey: true,
          });
        }
        localModelConfig = {
          ...localModelConfig,
          ollamaEndpoint: endpoint,
          ollamaModel: resolvedModel,
          tierAProviderConfigs,
        };
        await saveSettings(settings);
        await broadcastSettingsUpdate(settings);
        refreshModelComboAfterSave();
        const summary = await runActivationChecksForInlineStatus(["realtime"]);
        setTierAInlineStatus(summary.text, `${summary.className} model-inline-status`);
      } else if (provider === "chrome-gemini-nano") {
        setTierAInlineStatus(modelTestPendingText(), modelTestWorkingClass);
        const probe = await probeGeminiNano("tier-a");
        if (!probe.ok) {
          setTierAInlineStatus(optT("options.modelTest.geminiUnavailable", { detail: probe.availability || probe.error || "unknown" }), modelTestErrorClass);
          return;
        }
        await saveSettings(settings);
        await broadcastSettingsUpdate(settings);
        refreshModelComboAfterSave();
        const summary = await runActivationChecksForInlineStatus(["realtime"]);
        setTierAInlineStatus(summary.text, `${summary.className} model-inline-status`);
      } else {
        await saveSettings(settings);
        await broadcastSettingsUpdate(settings);
        refreshModelComboAfterSave();
        const summary = await runActivationChecksForInlineStatus(["realtime"]);
        setTierAInlineStatus(summary.text, `${summary.className} model-inline-status`);
      }
    });
  });

  // Deep analysis settings
  const deepClassifyEnabled = document.getElementById("deepClassifyEnabled") as HTMLInputElement;
  const tierBProviderSelect = document.getElementById("tierBProviderSelect") as HTMLSelectElement;
  const tierBManualConfig = document.getElementById("tierBManualConfig") as HTMLElement;
  const tierBEndpointGroup = document.getElementById("tierBEndpointGroup") as HTMLElement;
  const tierBModelGroup = document.getElementById("tierBModelGroup") as HTMLElement;
  const tierBOpenAICompatConfig = document.getElementById("tierBOpenAICompatConfig") as HTMLElement;
  const tierBApiKeyGroup = document.getElementById("tierBApiKeyGroup") as HTMLElement;
  const tierBApiKeyInput = document.getElementById("tierBApiKey") as HTMLInputElement;
  const tierBApiKeySessionOnly = document.getElementById("tierBApiKeySessionOnly") as HTMLInputElement;
  const tierBApiKeyStatus = document.getElementById("tierBApiKeyStatus")!;
  const tierBEndpoint = document.getElementById("tierBEndpoint") as HTMLInputElement;
  const tierBModelSelect = document.getElementById("tierBModelSelect") as HTMLSelectElement;
  const tierBModel = document.getElementById("tierBModel") as HTMLInputElement;
  const refreshTierBModelsButton = document.getElementById("refreshTierBModels") as HTMLButtonElement;
  const tierBEndpointError = document.getElementById("tierBEndpointError")!;
  const tierBEndpointWarning = document.getElementById("tierBEndpointWarning")!;
  const tierBSetupError = document.getElementById("tierBSetupError")!;
  const tierBStatus = document.getElementById("tierBStatus")!;
  const tierBProviderHelp = document.getElementById("tierBProviderHelp")!;
  const tierBCapabilityStatus = document.getElementById("tierBCapabilityStatus")!;
  const tierBStoredEndpointNote = document.getElementById("tierBStoredEndpointNote")!;
  const tierBLaneSource = document.getElementById("tierBLaneSource")!;
  const tierBLaneMeta = document.getElementById("tierBLaneMeta")!;
  const tierBLaneStatus = document.getElementById("tierBLaneStatus")!;
  const readingBriefSettingStatus = document.getElementById("readingBriefSettingStatus");

  function setTierBStatus(text: string, className = "status-text model-inline-status"): void {
    tierBStatus.textContent = text;
    tierBStatus.className = className.includes("model-inline-status")
      ? className
      : `${className} model-inline-status`;
  }

  function selectableTierBProvider(savedProvider: TierBProvider, currentTierAProvider: TierAProvider): TierBProvider {
    if (savedProvider !== "tier-a" && savedProvider !== "none") return savedProvider;
    if (providerSupportsTierB(currentTierAProvider)) {
      return currentTierAProvider as TierBProvider;
    }
    return "chrome-gemini-nano";
  }

  deepClassifyEnabled.checked = true;
  const savedTierBProvider = getTierBProvider(settings);
  const tierBInheritedFromTierA = savedTierBProvider === "tier-a" ||
    settings.tierBUseTierAEndpoint === true ||
    settings.tierBUseTierAModel === true;
  const selectedTierBProvider = selectableTierBProvider(savedTierBProvider, getTierAProvider(settings));
  tierBProviderSelect.value = selectedTierBProvider;
  tierBEndpoint.value = tierBInheritedFromTierA && providerNeedsEndpoint(selectedTierBProvider)
    ? currentReadinessEnvironment().tierAEndpoint
    : settings.tierBEndpoint || "";
  tierBModel.value = tierBInheritedFromTierA
    ? providerFixedModel(selectedTierBProvider) ||
      (providerNeedsEndpoint(selectedTierBProvider)
        ? currentReadinessEnvironment().tierAModel
        : defaultModelForProvider(selectedTierBProvider, "summary-reading"))
    : settings.tierBModel || defaultModelForProvider(selectedTierBProvider, "summary-reading");
  if (isEndpointBackedModelProvider(selectedTierBProvider)) {
    tierBProviderConfigs = withProviderModelConfig(tierBProviderConfigs, selectedTierBProvider, {
      endpoint: tierBEndpoint.value || defaultEndpointForProvider(selectedTierBProvider),
      model: tierBModel.value || defaultModelForProvider(selectedTierBProvider, "summary-reading"),
    });
  }
  const tierBStored = await browser.storage.local.get(["tierBApiKey", "tierBApiKeySessionOnly"]);
  const tierBStoredSession = await sessionStorageGet(["tierBApiKey"]);
  const storedTierBApiKey = (tierBStored.tierBApiKey as string) || "";
  tierBApiKeySessionOnly.checked = tierBStored.tierBApiKeySessionOnly !== false;
  tierBApiKeyInput.value = tierBApiKeySessionOnly.checked
    ? (tierBStoredSession.tierBApiKey as string) || storedTierBApiKey
    : storedTierBApiKey;

  function refreshModelSelectionUI(): void {
    const brief = displayReadinessRecord("reading_brief");
    if (readingBriefSettingStatus) {
      readingBriefSettingStatus.textContent = brief ? readinessBadgeText(brief) : optT("options.tierB.byActivationCheck");
    }
  }

  function refreshModelComboAfterSave(): void {
    refreshModelSelectionUI();
  }

  function draftTierBSettings(): UserSettings {
    const provider = tierBProviderSelect.value as TierBProvider;
    return applyUserSettingsPatch(settings, {
      tierAProvider: providerSelect.value as TierAProvider,
      tierBProvider: provider,
      tierBEndpoint: tierBEndpoint.value.trim().replace(/\/+$/, ""),
      tierBModel: currentTierBModelInput() || defaultModelForProvider(provider, "summary-reading"),
      deepClassifyEnabled: deepClassifyEnabled.checked,
    });
  }

  function currentTierBModelInput(): string {
    return tierBModelSelect.style.display !== "none"
      ? tierBModelSelect.value.trim()
      : tierBModel.value.trim();
  }

  function currentTierBEndpointInput(provider: TierBProvider): string {
    return normalizeEndpointInput(
      tierBEndpoint.value,
      isEndpointBackedModelProvider(provider) ? defaultEndpointForProvider(provider) : "",
    );
  }

  function currentTierBModelInputOrDefault(provider: TierBProvider): string {
    return currentTierBModelInput() || defaultModelForProvider(provider, "summary-reading");
  }

  function rememberTierBProviderDraft(provider: TierBProvider): void {
    if (!isEndpointBackedModelProvider(provider)) return;
    tierBProviderConfigs = withProviderModelConfig(tierBProviderConfigs, provider, {
      endpoint: currentTierBEndpointInput(provider),
      model: currentTierBModelInputOrDefault(provider),
    });
  }

  function restoreTierBProviderDraft(provider: TierBProvider): void {
    if (!isEndpointBackedModelProvider(provider)) return;
    const config = providerModelConfigOrDefault(tierBProviderConfigs, provider, "summary-reading");
    tierBEndpoint.value = config.endpoint;
    tierBModel.value = config.model;
  }

  function populateTierBModelDropdown(models: string[], resolvedModel: string): void {
    tierBModelSelect.innerHTML = "";
    for (const name of models) {
      const opt = document.createElement("option");
      opt.value = name;
      opt.textContent = name;
      tierBModelSelect.appendChild(opt);
    }
    if (models.includes(resolvedModel)) {
      tierBModelSelect.value = resolvedModel;
    }
    tierBModel.value = resolvedModel;
    tierBModelSelect.style.display = "";
    tierBModel.style.display = "none";
  }

  function showTierBModelFallback(): void {
    tierBModelSelect.style.display = "none";
    tierBModel.style.display = "";
  }

  async function refreshTierBModelList(): Promise<void> {
    const provider = tierBProviderSelect.value as TierBProvider;
    if (!providerNeedsEndpoint(provider)) return;
    const result = await fetchEndpointModels(
      provider,
      tierBEndpoint,
      tierBEndpointError,
      tierBStatus,
      apiKeyForProvider(provider, tierBApiKeyInput),
    );
    if (!result) return;

    const fallbackModel = defaultModelForProvider(provider, "summary-reading");
    const userModel = currentTierBModelInput() || fallbackModel;
    if (result.health.ok && result.health.models.length > 0) {
      const resolvedModel = resolveModelName(userModel, result.health.models);
      populateTierBModelDropdown(result.health.models, resolvedModel);
      setTierBStatus(optT("options.modelTest.connectedModels", {
        count: result.health.models.length,
        note: resolvedModel !== userModel.trim()
          ? optT("options.common.usingModelSuffix", { model: resolvedModel })
          : "",
        formatNote: "",
      }), modelListStatusClass(tierBStatus, "ok"));
      rememberTierBProviderDraft(provider);
      refreshTierBManualInputs();
    } else {
      showTierBModelFallback();
      setTierBStatus(optT("options.modelTest.modelListFailed"), modelListStatusClass(tierBStatus, "error"));
    }
  }

  function refreshTierBManualInputs() {
    const provider = tierBProviderSelect.value as TierBProvider;
    const needsEndpoint = providerNeedsEndpoint(provider);
    const draftSettings = draftTierBSettings();
    const aiGate = resolveTierBFeatureGate("ai_analysis", draftSettings);
    const briefGate = resolveTierBFeatureGate("reading_brief", draftSettings);
    const aiRecord = freshReadinessRecord("ai_analysis");
    const briefRecord = freshReadinessRecord("reading_brief");
    const failedRecord = [aiRecord, briefRecord].find(readinessIsProblem);
    tierBCapabilityStatus.textContent = "";
    tierBCapabilityStatus.className = "status-text";
    tierBCapabilityStatus.style.display = "none";
    tierBManualConfig.style.display = needsEndpoint ? "block" : "none";
    tierBEndpointGroup.style.display = needsEndpoint ? "" : "none";
    tierBModelGroup.style.display = needsEndpoint ? "" : "none";
    refreshTierBModelsButton.style.display = needsEndpoint ? "" : "none";
    tierBOpenAICompatConfig.style.display = provider === "openai-compatible" ? "block" : "none";
    tierBApiKeyGroup.style.display = providerSupportsOptionalApiKey(provider) ? "" : "none";
    tierBApiKeyStatus.textContent = providerSupportsOptionalApiKey(provider)
      ? optT("options.provider.apiKeyOptionalHelp")
      : "";
    tierBApiKeyStatus.className = "status-text";
    if (!needsEndpoint) showTierBModelFallback();
    tierBEndpoint.placeholder = defaultEndpointForProvider(provider);
    tierBModel.placeholder = defaultModelForProvider(provider, "summary-reading");
    renderEndpointWarning(tierBEndpoint, tierBEndpointWarning);
    if (provider === "none") {
      tierBLaneSource.textContent = optT("options.tierB.disabledSource");
      tierBLaneMeta.textContent = optT("options.tierB.disabledMeta");
      setLaneStatus(tierBLaneStatus, optT("readiness.status.off"), aiRecord);
      tierBProviderHelp.textContent = optT("options.tierB.disabledHelp");
    } else if (provider === "chrome-gemini-nano") {
      tierBLaneSource.textContent = providerDisplayLabel(provider);
      tierBLaneMeta.textContent = optT("options.tierB.geminiMeta");
      tierBProviderHelp.textContent = optT("options.provider.noEndpoint");
    } else if (needsEndpoint) {
      tierBLaneSource.textContent = providerDisplayLabel(provider);
      tierBLaneMeta.textContent = `${tierBEndpoint.value.trim() || tierBEndpoint.placeholder} · ${currentTierBModelInput() || tierBModel.placeholder}`;
      tierBProviderHelp.textContent = provider === "openai-compatible"
        ? optT("options.provider.openAIHelp")
        : optT("options.provider.ollamaHelp");
      const aiVision = aiRecord?.capabilities?.vision;
      const tierBModelName = currentTierBModelInput() || tierBModel.placeholder;
      const useOllamaCloudRegistry = provider === "ollama" && (
        modelLooksLikeOllamaCloud(tierBModelName) ||
        endpointLooksLikeOllamaCloud(tierBEndpoint.value.trim() || tierBEndpoint.placeholder)
      );
      const registryVision = useOllamaCloudRegistry
        ? ollamaCloudVisionSupport(tierBModelName)
        : "unknown";
      if (!failedRecord && readinessIsUsable(aiRecord) && aiVision === "unsupported") {
        tierBCapabilityStatus.textContent = optT("options.tierB.visionProbeTextOnly");
        tierBCapabilityStatus.className = "status-text status-warn";
        tierBCapabilityStatus.style.display = "";
      } else if (!failedRecord && registryVision === "unsupported") {
        tierBCapabilityStatus.textContent = optT("options.tierB.registryTextOnlyWarning");
        tierBCapabilityStatus.className = "status-text status-warn";
        tierBCapabilityStatus.style.display = "";
      }
    } else if (!aiGate.canTest) {
      tierBLaneSource.textContent = providerDisplayLabel(provider);
      tierBLaneMeta.textContent = optT("options.tierB.unsupportedMeta");
      tierBProviderHelp.textContent = optT("options.tierB.unsupportedHelp");
      tierBCapabilityStatus.textContent = optT("options.tierB.unsupportedStatus");
      tierBCapabilityStatus.className = "status-text status-error";
      tierBCapabilityStatus.style.display = "";
    } else if (!briefGate.canTest) {
      tierBLaneSource.textContent = providerDisplayLabel(provider);
      tierBLaneMeta.textContent = optT("options.tierB.summaryOnlyMeta");
      tierBProviderHelp.textContent = optT("options.tierB.summaryOnlyHelp");
    } else {
      tierBLaneSource.textContent = providerDisplayLabel(provider);
      tierBLaneMeta.textContent = optT("options.tierB.fullMeta");
      tierBProviderHelp.textContent = optT("options.tierB.fullHelp");
    }
    const laneRecord = failedRecord || aiRecord || briefRecord;
    const aiReady = readinessIsUsable(aiRecord);
    const briefReady = readinessIsUsable(briefRecord);
    const laneStatus = provider === "none"
      ? optT("readiness.status.off")
      : failedRecord
        ? readinessBadgeText(failedRecord)
        : aiReady && briefReady
        ? optT("readiness.status.passed")
        : aiReady
          ? optT("options.tierB.analysisReady")
          : readinessBadgeText(aiRecord);
    setLaneStatus(tierBLaneStatus, laneStatus, laneRecord);

    tierBStoredEndpointNote.textContent = "";
    tierBStoredEndpointNote.style.display = "none";
    refreshModelSelectionUI();
  }
  refreshTierBManualInputsAfterReadiness = refreshTierBManualInputs;
  let activeTierBProviderDraft = tierBProviderSelect.value as TierBProvider;
  tierBProviderSelect.addEventListener("change", () => {
    rememberTierBProviderDraft(activeTierBProviderDraft);
    activeTierBProviderDraft = tierBProviderSelect.value as TierBProvider;
    restoreTierBProviderDraft(activeTierBProviderDraft);
    showTierBModelFallback();
    refreshTierBManualInputs();
  });
  providerSelect.addEventListener("change", refreshTierBManualInputs);
  deepClassifyEnabled.addEventListener("change", refreshTierBManualInputs);
  tierBEndpoint.addEventListener("input", () => {
    showTierBModelFallback();
    rememberTierBProviderDraft(tierBProviderSelect.value as TierBProvider);
    renderEndpointWarning(tierBEndpoint, tierBEndpointWarning);
    refreshTierBManualInputs();
  });
  tierBModel.addEventListener("input", () => {
    rememberTierBProviderDraft(tierBProviderSelect.value as TierBProvider);
    refreshTierBManualInputs();
  });
  tierBModelSelect.addEventListener("change", () => {
    tierBModel.value = tierBModelSelect.value;
    rememberTierBProviderDraft(tierBProviderSelect.value as TierBProvider);
    refreshTierBManualInputs();
  });
  refreshTierBModelsButton.addEventListener("click", () => {
    void runWithPendingButton(
      refreshTierBModelsButton,
      refreshTierBModelList,
      optT("options.modelTest.fetchingModels"),
    );
  });
  i18nDynamicRenderers.push(refreshTierBManualInputs);
  refreshTierBManualInputs();

  const saveDeepAnalysisButton = document.getElementById("saveDeepAnalysis") as HTMLButtonElement;
  saveDeepAnalysisButton.addEventListener("click", () => {
    void runWithPendingButton(saveDeepAnalysisButton, async () => {
      const provider = tierBProviderSelect.value as TierBProvider;
      const defaultEndpoint = defaultEndpointForProvider(provider);
      const defaultModel = defaultModelForProvider(provider, "summary-reading");
      const tierBApiKey = apiKeyForProvider(provider, tierBApiKeyInput);
      const manualEndpoint = normalizeEndpointInput(
        tierBEndpoint.value,
        providerNeedsEndpoint(provider) ? defaultEndpoint : "",
      );
      const endpoint = providerNeedsEndpoint(provider)
        ? manualEndpoint
        : "";
      if (providerNeedsEndpoint(provider)) {
        tierBEndpoint.value = manualEndpoint;
        renderEndpointWarning(tierBEndpoint, tierBEndpointWarning);
      }
      const enabled = deepClassifyEnabled.checked;
      let manualModel = currentTierBModelInput() || defaultModel;
      const aiGate = resolveTierBFeatureGate("ai_analysis", draftTierBSettings());

      tierBEndpointError.style.display = "none";
      tierBSetupError.style.display = "none";
      setTierBStatus(modelTestPendingText(), modelTestWorkingClass);

      if (enabled && providerNeedsEndpoint(provider) && !endpoint) {
        tierBEndpointError.textContent = optT("options.tierB.missingEndpointModel");
        tierBEndpointError.className = "status-text status-error";
        tierBEndpointError.style.display = "";
        setTierBStatus(optT("options.modelTest.endpointNeedsWork"), modelTestErrorClass);
        return;
      }

      if (enabled && !aiGate.canRun) {
        tierBSetupError.textContent = aiGate.blockedMessage || optT("options.tierB.unsupportedStatus");
        tierBSetupError.className = "status-text status-error";
        tierBSetupError.style.display = "";
        setTierBStatus(optT("options.tierB.unsupportedShort"), modelTestErrorClass);
        return;
      }

      if (provider === "chrome-gemini-nano" && enabled) {
        setTierBStatus(modelTestPendingText(), modelTestWorkingClass);
        const probe = await probeGeminiNano("tier-b");
        if (!probe.ok) {
          tierBSetupError.textContent = optT("options.modelTest.geminiUnavailable", { detail: probe.availability || probe.error || "unknown" });
          tierBSetupError.className = "status-text status-error";
          tierBSetupError.style.display = "";
          setTierBStatus(optT("options.modelTest.geminiUnavailable", { detail: probe.availability || probe.error || "unknown" }), modelTestErrorClass);
          return;
        }
      }

      if (endpoint) {
        const validationError = validateEndpointUrl(endpoint);
        if (validationError) {
          tierBEndpointError.textContent = validationError;
          tierBEndpointError.className = "status-text status-error";
          tierBEndpointError.style.display = "";
          setTierBStatus(optT("options.modelTest.endpointNeedsWork"), modelTestErrorClass);
          return;
        }

        const health = await runHealthCheck(endpoint, providerEndpointKind(provider), tierBStatus, tierBApiKey);
        if (health.ok) {
          manualModel = resolveModelName(manualModel, health.models);
          populateTierBModelDropdown(health.models, manualModel);
          const note = health.models.includes(manualModel) ? optT("options.common.usingModelSuffix", { model: manualModel }) : "";
          setTierBStatus(optT("options.modelTest.connectedModels", {
            count: health.models.length,
            note,
            formatNote: "",
          }), "status-text status-ok model-inline-status");
        } else {
          // Connection failed. Do NOT early-return: still persist the attempted
          // config and run the activation checks below so a connection_failed
          // readiness record is written and the popup feature-status reflects
          // the failure (otherwise the popup keeps showing the stale state).
          setTierBStatus(formatEndpointError(health.error), modelTestErrorClass);
          showTierBModelFallback();
        }
      }

      Object.assign(
        settings,
        applyUserSettingsPatch(settings, {
          tierBProvider: provider,
          deepClassifyEnabled: !providerNeedsEndpoint(provider)
            ? true
            : endpoint.length > 0,
          tierBUseTierAEndpoint: false,
          tierBUseTierAModel: false,
          tierBEndpoint: manualEndpoint,
          tierBModel: manualModel,
        }),
      );
      if (isEndpointBackedModelProvider(provider)) {
        tierBProviderConfigs = withProviderModelConfig(tierBProviderConfigs, provider, {
          endpoint: manualEndpoint,
          model: manualModel,
        });
        await browser.storage.local.set({ tierBProviderConfigs });
        localModelConfig = {
          ...localModelConfig,
          tierBProviderConfigs,
        };
      }
      tierBEndpoint.value = manualEndpoint;
      tierBModel.value = manualModel;
      refreshTierBManualInputs();

      await saveSettings(settings);
      if (providerSupportsOptionalApiKey(provider)) {
        await persistApiKeyPreference({
          key: "tierBApiKey",
          sessionFlag: "tierBApiKeySessionOnly",
          value: tierBApiKey || "",
          sessionOnly: tierBApiKeySessionOnly.checked,
        });
      }
      await broadcastSettingsUpdate(settings);
      refreshModelComboAfterSave();
      if (settings.deepClassifyEnabled) {
        setTierBStatus(modelTestPendingText(), modelTestWorkingClass);
        const summary = await runActivationChecksForInlineStatus(["ai_analysis", "reading_brief"]);
        setTierBStatus(summary.text, `${summary.className} model-inline-status`);
      } else {
        setTierBStatus(optT("options.tierB.savedDisabled"), "status-text status-ok model-inline-status");
      }
    });
  });

}

init();
