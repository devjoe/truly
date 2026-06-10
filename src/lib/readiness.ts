import type { TierAProvider, TierBProvider, UserSettings } from "./types";
import { providerRuntimeEndpoint, providerRuntimeModel } from "./model-provider-runtime";
import {
  resolveEffectiveTierBEndpoint,
  resolveEffectiveTierBModel,
  resolveEffectiveTierBProvider,
} from "./settings";

export type ReadinessFeature =
  | "realtime"
  | "ai_analysis"
  | "reading_brief"
  | "language_check"
  | "external_tools";

export type ReadinessStatus =
  | "not_configured"
  | "needs_permission"
  | "connection_failed"
  | "model_unavailable"
  | "model_downloading"
  | "testing"
  | "passed"
  | "slow_but_usable"
  | "failed_output_format"
  | "unsupported"
  | "runtime_failed";

export interface ReadinessRecord {
  feature: ReadinessFeature;
  status: ReadinessStatus;
  provider?: TierAProvider | TierBProvider;
  effectiveProvider?: TierAProvider | TierBProvider;
  model?: string;
  endpoint?: string;
  checkedAt?: string;
  latencyMs?: number;
  message?: string;
  technicalDetail?: string;
  buildId?: string;
  settingsFingerprint?: string;
}

export type ReadinessSnapshot = Partial<Record<ReadinessFeature, ReadinessRecord>>;

export interface ReadinessEnvironment {
  tierAEndpoint?: string;
  tierAModel?: string;
  buildId?: string;
}

export const READINESS_FEATURES: ReadinessFeature[] = [
  "realtime",
  "ai_analysis",
  "reading_brief",
  "language_check",
  "external_tools",
];

export const PRIMARY_READINESS_FEATURES: ReadinessFeature[] = [
  "realtime",
  "ai_analysis",
  "reading_brief",
];

export const SECONDARY_READINESS_FEATURES: ReadinessFeature[] = [
  "language_check",
  "external_tools",
];

export function readinessFeatureLabel(feature: ReadinessFeature): string {
  switch (feature) {
    case "realtime": return "閱讀前提示";
    case "ai_analysis": return "摘要";
    case "reading_brief": return "深入閱讀";
    case "language_check": return "用語檢查";
    case "external_tools": return "外部工具整合";
  }
}

export function readinessFeaturePurpose(feature: ReadinessFeature): string {
  switch (feature) {
    case "realtime": return "Heads-up 提示的最低可用門檻。";
    case "ai_analysis": return "摘要、圖文判斷與資訊品質線索。";
    case "reading_brief": return "深入閱讀面板中的背景與可追問問題。";
    case "language_check": return "本機檢查繁中用語、標點與翻譯腔線索。";
    case "external_tools": return "複製、下載 Markdown 與搜尋等手動動作。";
  }
}

export function readinessFeatureRoleLabel(feature: ReadinessFeature): string {
  switch (feature) {
    case "realtime": return "Heads-up 門檻";
    case "ai_analysis": return "分析補充";
    case "reading_brief": return "側欄內容";
    case "language_check": return "本機檢查";
    case "external_tools": return "手動動作";
  }
}

export function readinessFeatureSetupHint(feature: ReadinessFeature): string {
  switch (feature) {
    case "realtime": return "先讓這項通過，Facebook 貼文才會出現 Heads-up。";
    case "ai_analysis": return "完成後會補上摘要、圖文判斷與資訊品質線索。";
    case "reading_brief": return "完成後，深入閱讀面板會產生閱讀重點與可追問問題。";
    case "language_check": return "不需設定端點；有可展示線索時才會出現在閱讀介面。";
    case "external_tools": return "不需模型；用來複製、下載或把問題交給搜尋。";
  }
}

export function readinessFeatureGroup(feature: ReadinessFeature): "primary" | "secondary" {
  return PRIMARY_READINESS_FEATURES.includes(feature) ? "primary" : "secondary";
}

export function readinessStatusLabel(status: ReadinessStatus): string {
  switch (status) {
    case "not_configured": return "尚未設定";
    case "needs_permission": return "需要授權";
    case "connection_failed": return "無法連線";
    case "model_unavailable": return "模型不可用";
    case "model_downloading": return "準備中";
    case "testing": return "測試中";
    case "passed": return "可用";
    case "slow_but_usable": return "可用，但速度較慢";
    case "failed_output_format": return "輸出格式不符";
    case "unsupported": return "目前不支援";
    case "runtime_failed": return "執行失敗";
  }
}

export function readinessDisplayMessage(record: ReadinessRecord): string {
  if (record.message && record.message.trim()) return record.message.trim();
  return readinessStatusLabel(record.status);
}

export function readinessRecoveryHint(record: ReadinessRecord): string {
  if (record.status === "connection_failed") {
    if (record.feature === "ai_analysis" || record.feature === "reading_brief") {
      return "端點無法連線。請確認模型服務已啟動，或重新設定摘要與深入閱讀模型。";
    }
    return "端點無法連線。請確認模型服務已啟動，或改用其他模型來源。";
  }
  if (record.status === "failed_output_format") {
    if (record.feature === "reading_brief") {
      return "目前模型可以嘗試閱讀輔助，但不一定能產生深入閱讀格式。";
    }
    return "模型有回應，但輸出格式不符合 Truly 需要。";
  }
  if (record.status === "needs_permission") {
    return "需要授權此端點後才能呼叫模型服務。";
  }
  if (record.status === "model_unavailable") {
    if (record.provider === "chrome-gemini-nano" || record.effectiveProvider === "chrome-gemini-nano") {
      return "Chrome 目前未提供 Gemini Nano。請確認 Chrome 已更新，並保留足夠磁碟空間讓 Chrome 下載本機模型。";
    }
    return "模型尚未準備完成，請稍後重試。";
  }
  if (record.status === "model_downloading") {
    return "Chrome 正在準備 Gemini Nano。請保持 Chrome 開啟，稍後重新檢查。";
  }
  return readinessDisplayMessage(record);
}

function stableJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  const object = value as Record<string, unknown>;
  return `{${Object.keys(object).sort().map((key) => `${JSON.stringify(key)}:${stableJson(object[key])}`).join(",")}}`;
}

export function readinessFingerprint(
  feature: ReadinessFeature,
  settings: UserSettings,
  environment: ReadinessEnvironment = {},
): string {
  const tierAProvider = settings.tierAProvider;
  const tierAEndpoint = providerRuntimeEndpoint(tierAProvider, environment.tierAEndpoint);
  const tierAModel = providerRuntimeModel(tierAProvider, environment.tierAModel);
  const tierBProvider = settings.tierBProvider;
  const effectiveTierBProvider = resolveEffectiveTierBProvider(settings);
  const effectiveTierBEndpoint = providerRuntimeEndpoint(
    effectiveTierBProvider,
    resolveEffectiveTierBEndpoint(settings, environment.tierAEndpoint),
  );
  const effectiveTierBModel = providerRuntimeModel(
    effectiveTierBProvider,
    resolveEffectiveTierBModel(settings, environment.tierAModel),
  );

  // `v` is the probe schema version: bump it ONLY when prompt / output schema /
  // probe logic changes in a way that should invalidate past readiness results.
  // buildId is deliberately excluded — a routine rebuild must not nag a user who
  // already passed a check whose configuration is unchanged.
  const base = {
    v: 1,
    feature,
  };

  switch (feature) {
    case "realtime":
      return stableJson({
        ...base,
        provider: tierAProvider,
        endpoint: tierAEndpoint,
        model: tierAModel,
        endpointKind: settings.openAICompatibleFlavor,
        responseFormat: settings.openAIResponseFormat,
        outputMode: settings.tierAOutputMode,
        customRules: settings.customFoldRules.filter((rule) => rule.enabled).map((rule) => ({
          id: rule.id,
          prompt: rule.prompt,
        })),
      });
    case "ai_analysis":
      return stableJson({
        ...base,
        enabled: settings.deepClassifyEnabled,
        provider: tierBProvider,
        effectiveProvider: effectiveTierBProvider,
        endpoint: effectiveTierBEndpoint,
        model: effectiveTierBModel,
      });
    case "reading_brief":
      return stableJson({
        ...base,
        enabled: settings.deepClassifyEnabled,
        provider: tierBProvider,
        effectiveProvider: effectiveTierBProvider,
        endpoint: effectiveTierBEndpoint,
        model: effectiveTierBModel,
      });
    case "language_check":
      return stableJson({
        ...base,
        checker: "zhtw-local",
      });
    case "external_tools":
      return stableJson({
        ...base,
        actions: ["copy-markdown", "download-markdown", "google-search"],
      });
  }
}

export function createReadinessRecord(input: Omit<ReadinessRecord, "checkedAt"> & { checkedAt?: string }): ReadinessRecord {
  return {
    ...input,
    checkedAt: input.checkedAt ?? new Date().toISOString(),
  };
}

export function isReadinessRecordFresh(
  record: ReadinessRecord | undefined,
  expectedFingerprint: string,
): record is ReadinessRecord {
  if (!record) return false;
  // Freshness is settings-driven only. A different buildId alone must not
  // invalidate an otherwise-matching check; probe-logic changes are handled by
  // bumping the fingerprint schema version (`v`) in readinessFingerprint.
  return record.settingsFingerprint === expectedFingerprint;
}

export function mergeReadinessRecord(
  snapshot: ReadinessSnapshot,
  record: ReadinessRecord,
): ReadinessSnapshot {
  return {
    ...snapshot,
    [record.feature]: record,
  };
}
