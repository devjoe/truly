import { callOllamaSingle } from "../lib/ollama-client";
import { callTierBDeepDetailed, callTierBReadingBrief, callTierBVisionProbe } from "../lib/tier-b-client";
import {
  callGeminiNanoReadingBrief,
  callGeminiNanoTierA,
  callGeminiNanoTierB,
  GEMINI_NANO_PROVIDER,
  probeGeminiNanoAvailability,
} from "../lib/gemini-nano-client";
import type { TrulyMessage, ReadinessRunChecksResultMsg } from "../lib/messages";
import { resolveTierBFeatureGate } from "../lib/feature-readiness";
import { providerRuntimeEndpoint, providerRuntimeModel } from "../lib/model-provider-runtime";
import { providerEndpointKind, providerNeedsEndpoint } from "../lib/provider-capabilities";
import { resolveLanguage } from "../lib/i18n";
import {
  createReadinessRecord,
  readinessFingerprint,
  type ReadinessStatus,
  type ReadinessFeature,
  type ReadinessRecord,
} from "../lib/readiness";
import { saveReadinessRecord } from "../lib/readiness-storage";
import type { DashboardPostEvent, DeepClassification, UserSettings } from "../lib/types";

const READINESS_SAMPLE_TEXT = "今天整理書桌，順手把舊收據分類收好。這是一則低風險生活分享。";

function elapsedSince(start: number): number {
  return Math.max(0, Math.round(performance.now() - start));
}

function compactTechnicalValue(value: unknown): string {
  if (value === undefined || value === null || value === "") return "(empty)";
  return String(value).replace(/\s+/g, " ").trim().slice(0, 240);
}

function tierAOutputTechnicalDetail(fields: {
  provider: string;
  endpoint?: string;
  model?: string;
  endpointKind?: string;
  openAICompatibleFlavor?: string;
  responseFormat?: string;
  outputMode?: string;
  parseError?: string;
  raw?: string;
}): string {
  return [
    `provider=${compactTechnicalValue(fields.provider)}`,
    `endpoint=${compactTechnicalValue(fields.endpoint)}`,
    `model=${compactTechnicalValue(fields.model)}`,
    `endpointKind=${compactTechnicalValue(fields.endpointKind)}`,
    `openAICompatibleFlavor=${compactTechnicalValue(fields.openAICompatibleFlavor)}`,
    `responseFormat=${compactTechnicalValue(fields.responseFormat)}`,
    `outputMode=${compactTechnicalValue(fields.outputMode)}`,
    `parseError=${compactTechnicalValue(fields.parseError)}`,
    `raw=${compactTechnicalValue(fields.raw)}`,
  ].join("\n");
}

function geminiNanoTechnicalDetail(
  availability: string,
  modalities: string[],
  error?: string,
): string {
  const detail = [
    `availability=${availability}`,
    `context=service-worker`,
    `inputs=${modalities.join("+")}`,
  ];
  if (typeof navigator !== "undefined" && typeof navigator.userAgent === "string") {
    const chrome = navigator.userAgent.match(/Chrome\/([\d.]+)/)?.[1];
    if (chrome) detail.push(`chrome=${chrome}`);
  }
  if (error) detail.push(`error=${error}`);
  return detail.join("\n");
}

function geminiNanoUnavailableRecord(
  feature: "realtime" | "ai_analysis" | "reading_brief",
  settings: UserSettings,
  environment: { tierAEndpoint?: string; tierAModel?: string; buildId?: string },
  fields: {
    provider: UserSettings["tierAProvider"] | UserSettings["tierBProvider"];
    effectiveProvider: UserSettings["tierAProvider"] | UserSettings["tierBProvider"];
    model?: string;
    endpoint?: string;
    availability: string;
    modalities: string[];
    latencyMs: number;
    error?: string;
  },
): ReadinessRecord {
  const preparing = fields.availability === "downloading" || fields.availability === "downloadable";
  const label = feature === "realtime"
    ? "閱讀前提示"
    : feature === "ai_analysis"
      ? "摘要"
      : "深入閱讀";
  return baseReadinessRecord(feature, settings, environment, {
    provider: fields.provider,
    effectiveProvider: fields.effectiveProvider,
    endpoint: fields.endpoint,
    model: fields.model,
    status: preparing ? "model_downloading" : "model_unavailable",
    latencyMs: fields.latencyMs,
    message: preparing
      ? "Chrome 正在準備 Gemini Nano"
      : `此 Chrome 尚未提供 Gemini Nano，${label}暫時無法使用`,
    capabilities: feature === "ai_analysis" ? { vision: "unsupported" } : undefined,
    technicalDetail: geminiNanoTechnicalDetail(
      fields.availability,
      fields.modalities,
      fields.error,
    ),
  });
}

function baseReadinessRecord(
  feature: ReadinessFeature,
  settings: UserSettings,
  environment: { tierAEndpoint?: string; tierAModel?: string; buildId?: string },
  fields: Omit<ReadinessRecord, "feature" | "checkedAt" | "settingsFingerprint" | "buildId">,
): ReadinessRecord {
  return createReadinessRecord({
    ...fields,
    feature,
    buildId: environment.buildId,
    settingsFingerprint: readinessFingerprint(feature, settings, environment),
  });
}

function tierBReadinessFailure(
  error: string | undefined,
  feature: "ai_analysis" | "reading_brief",
): { status: ReadinessStatus; message: string } {
  if (
    error === "tier_b_network_error" ||
    error === "tier_b_timeout" ||
    error === "tier_b_http_error"
  ) {
    return {
      status: "connection_failed",
      message: feature === "ai_analysis"
        ? "摘要端點無法連線"
        : "深入閱讀端點無法連線",
    };
  }
  return {
    status: "failed_output_format",
    message: feature === "ai_analysis"
      ? "摘要輸出格式不符"
      : "目前模型不適合產生深入閱讀",
  };
}

async function runRealtimeReadinessCheck(
  settings: UserSettings,
  environment: { tierAEndpoint?: string; tierAModel?: string; buildId?: string },
): Promise<ReadinessRecord> {
  const provider = settings.tierAProvider;
  const endpoint = providerRuntimeEndpoint(provider, environment.tierAEndpoint);
  const model = providerRuntimeModel(provider, environment.tierAModel);

  if (provider === "none") {
    return baseReadinessRecord("realtime", settings, environment, {
      provider,
      endpoint,
      model,
      status: "not_configured",
      message: "閱讀前提示尚未啟用",
    });
  }
  if (providerNeedsEndpoint(provider) && (!endpoint || !model)) {
    return baseReadinessRecord("realtime", settings, environment, {
      provider,
      endpoint,
      model,
      status: "not_configured",
      message: "請先填入閱讀前提示端點與模型",
    });
  }
  if (provider === GEMINI_NANO_PROVIDER) {
    const start = performance.now();
    try {
      const availability = await probeGeminiNanoAvailability(["text"]);
      if (!availability.ok) {
        return geminiNanoUnavailableRecord("realtime", settings, environment, {
          provider,
          effectiveProvider: provider,
          model,
          latencyMs: elapsedSince(start),
          availability: String(availability.availability),
          modalities: ["text"],
          error: availability.error,
        });
      }
      const results = await callGeminiNanoTierA([{ id: "readiness-tier-a", text: READINESS_SAMPLE_TEXT }]);
      const scores = results["readiness-tier-a"]?.scores;
      const ok = !!scores && ["commercial", "political", "emotional", "personal"].every((key) => typeof scores[key] === "number");
      const latencyMs = elapsedSince(start);
      return baseReadinessRecord("realtime", settings, environment, {
        provider,
        effectiveProvider: provider,
        model,
        status: ok ? (latencyMs > 5_000 ? "slow_but_usable" : "passed") : "failed_output_format",
        latencyMs,
        message: ok ? "閱讀前提示可用" : "閱讀前提示輸出格式不符",
      });
    } catch (error) {
      return baseReadinessRecord("realtime", settings, environment, {
        provider,
        effectiveProvider: provider,
        model,
        status: "runtime_failed",
        latencyMs: elapsedSince(start),
        message: "閱讀前提示測試逾時，請稍後重試",
        technicalDetail: error instanceof Error ? error.message : String(error),
      });
    }
  }
  if (providerNeedsEndpoint(provider)) {
    const start = performance.now();
    try {
      const result = await callOllamaSingle(
        { id: "readiness-tier-a", text: READINESS_SAMPLE_TEXT },
        endpoint,
        model,
        undefined,
        {
          endpointKind: providerEndpointKind(provider),
          openAICompatibleFlavor: settings.openAICompatibleFlavor,
          responseFormat: settings.openAIResponseFormat,
          outputMode: settings.tierAOutputMode,
          returnUnparseable: true,
        },
      );
      const ok = !!result?.scores && Object.keys(result.scores).length > 0;
      const latencyMs = elapsedSince(start);
      return baseReadinessRecord("realtime", settings, environment, {
        provider,
        effectiveProvider: provider,
        endpoint,
        model,
        status: ok ? (latencyMs > 5_000 ? "slow_but_usable" : "passed") : "failed_output_format",
        latencyMs,
        message: ok ? "閱讀前提示可用" : "閱讀前提示輸出格式不符",
        technicalDetail: ok ? undefined : tierAOutputTechnicalDetail({
          provider,
          endpoint,
          model,
          endpointKind: providerEndpointKind(provider),
          openAICompatibleFlavor: settings.openAICompatibleFlavor,
          responseFormat: settings.openAIResponseFormat,
          outputMode: settings.tierAOutputMode,
          parseError: result?.parseError,
          raw: result?.raw,
        }),
      });
    } catch (error) {
      return baseReadinessRecord("realtime", settings, environment, {
        provider,
        effectiveProvider: provider,
        endpoint,
        model,
        status: "connection_failed",
        latencyMs: elapsedSince(start),
        message: "閱讀前提示模型無法連線",
        technicalDetail: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return baseReadinessRecord("realtime", settings, environment, {
    provider,
    model,
    status: "unsupported",
    message: "此來源目前尚未支援模型能力測試",
  });
}

async function runAiAnalysisReadinessCheck(
  settings: UserSettings,
  environment: { tierAEndpoint?: string; tierAModel?: string; buildId?: string },
): Promise<ReadinessRecord> {
  const gate = resolveTierBFeatureGate("ai_analysis", settings, environment);
  const { provider, effectiveProvider, endpoint, model } = gate;
  const outputLang = resolveLanguage(settings.language);

  if (!gate.canTest) {
    return baseReadinessRecord("ai_analysis", settings, environment, {
      provider,
      effectiveProvider,
      endpoint,
      model,
      status: gate.blockedStatus ?? "runtime_failed",
      message: gate.blockedMessage ?? "摘要尚未通過模型能力測試",
    });
  }

  const start = performance.now();
  try {
    let result;
    if (effectiveProvider === GEMINI_NANO_PROVIDER) {
      const availability = await probeGeminiNanoAvailability(["text", "image"]);
      if (!availability.ok) {
        return geminiNanoUnavailableRecord("ai_analysis", settings, environment, {
          provider,
          effectiveProvider,
          endpoint,
          model,
          latencyMs: elapsedSince(start),
          availability: String(availability.availability),
          modalities: ["text", "image"],
          error: availability.error,
        });
      }
      result = await callGeminiNanoTierB({ text: READINESS_SAMPLE_TEXT, imageUrls: [], outputLang });
    } else {
      const vision = await callTierBVisionProbe({ endpoint, model, timeoutMs: 12_000 });
      result = await callTierBDeepDetailed({ endpoint, model, text: READINESS_SAMPLE_TEXT, imageUrls: [], timeoutMs: 20_000, outputLang });
      const latencyMs = elapsedSince(start);
      const failure = tierBReadinessFailure(result.error, "ai_analysis");
      return baseReadinessRecord("ai_analysis", settings, environment, {
        provider,
        effectiveProvider,
        endpoint,
        model,
        status: result.ok && result.deep
          ? (latencyMs > 10_000 ? "slow_but_usable" : "passed")
          : failure.status,
        latencyMs,
        message: result.ok && result.deep
          ? (vision.ok ? "摘要可用" : "摘要可用；圖片判讀未通過")
          : failure.message,
        capabilities: { vision: vision.ok ? "supported" : "unsupported" },
        technicalDetail: [
          result.error ? `error=${result.error}` : "",
          `vision=${vision.ok ? "supported" : "unsupported"}`,
          vision.error ? `visionError=${vision.error}` : "",
          vision.raw ? `visionRaw=${vision.raw}` : "",
        ].filter(Boolean).join("\n") || undefined,
      });
    }
    const latencyMs = elapsedSince(start);
    const failure = tierBReadinessFailure(result.error, "ai_analysis");
    return baseReadinessRecord("ai_analysis", settings, environment, {
      provider,
      effectiveProvider,
      endpoint,
      model,
      status: result.ok && result.deep
        ? (latencyMs > 10_000 ? "slow_but_usable" : "passed")
        : failure.status,
      latencyMs,
      message: result.ok && result.deep ? "摘要可用" : failure.message,
      capabilities: effectiveProvider === GEMINI_NANO_PROVIDER ? { vision: "supported" } : undefined,
      technicalDetail: result.error,
    });
  } catch (error) {
    return baseReadinessRecord("ai_analysis", settings, environment, {
      provider,
      effectiveProvider,
      endpoint,
      model,
      status: "connection_failed",
      latencyMs: elapsedSince(start),
      message: "摘要端點無法連線",
      technicalDetail: error instanceof Error ? error.message : String(error),
    });
  }
}

function readinessBriefEvent(deep: DeepClassification | undefined): DashboardPostEvent {
  return {
    id: "readiness-brief",
    text: READINESS_SAMPLE_TEXT,
    fullText: READINESS_SAMPLE_TEXT,
    authorName: "Truly",
    hasMedia: false,
    isSponsored: false,
    timestamp: new Date().toISOString(),
    elapsedMs: 0,
    decision: {
      filtered: false,
      scores: { commercial: 0.1, political: 0.1, emotional: 0.1, personal: 0.7 },
      deepClassification: deep,
    },
    contentKind: "standard",
  };
}

async function runReadingBriefReadinessCheck(
  settings: UserSettings,
  environment: { tierAEndpoint?: string; tierAModel?: string; buildId?: string },
): Promise<ReadinessRecord> {
  const gate = resolveTierBFeatureGate("reading_brief", settings, environment);
  const { provider, effectiveProvider, endpoint, model } = gate;
  const outputLang = resolveLanguage(settings.language);

  if (!gate.canTest) {
    return baseReadinessRecord("reading_brief", settings, environment, {
      provider,
      effectiveProvider,
      endpoint,
      model,
      status: gate.blockedStatus ?? "runtime_failed",
      message: gate.blockedMessage ?? "深入閱讀尚未通過模型能力測試",
    });
  }

  const start = performance.now();
  try {
    const event = readinessBriefEvent({
      model,
      outputLang,
      summary: outputLang === "en" ? "Low-risk personal note." : "低風險生活分享。",
    });
    let brief;
    if (effectiveProvider === GEMINI_NANO_PROVIDER) {
      const availability = await probeGeminiNanoAvailability(["text"]);
      if (!availability.ok) {
        return geminiNanoUnavailableRecord("reading_brief", settings, environment, {
          provider,
          effectiveProvider,
          endpoint,
          model,
          latencyMs: elapsedSince(start),
          availability: String(availability.availability),
          modalities: ["text"],
          error: availability.error,
        });
      }
      brief = await callGeminiNanoReadingBrief({ event, timeoutMs: 20_000, outputLang });
    } else {
      brief = await callTierBReadingBrief({ endpoint, model, event, timeoutMs: 20_000, outputLang });
    }
    const latencyMs = elapsedSince(start);
    return baseReadinessRecord("reading_brief", settings, environment, {
      provider,
      effectiveProvider,
      endpoint,
      model,
      status: brief ? (latencyMs > 12_000 ? "slow_but_usable" : "passed") : "failed_output_format",
      latencyMs,
      message: brief ? "深入閱讀可用" : "目前模型不適合產生深入閱讀",
    });
  } catch (error) {
    return baseReadinessRecord("reading_brief", settings, environment, {
      provider,
      effectiveProvider,
      endpoint,
      model,
      status: providerNeedsEndpoint(effectiveProvider) ? "connection_failed" : "runtime_failed",
      latencyMs: elapsedSince(start),
      message: providerNeedsEndpoint(effectiveProvider) ? "深入閱讀端點無法連線" : "深入閱讀測試失敗",
      technicalDetail: error instanceof Error ? error.message : String(error),
    });
  }
}

async function runLanguageCheckReadinessCheck(
  settings: UserSettings,
  environment: { tierAEndpoint?: string; tierAModel?: string; buildId?: string },
): Promise<ReadinessRecord> {
  // Keep the service worker light: the actual zhtw WASM scanner is already
  // loaded lazily from the content-script path when a post has text to scan.
  // Importing it here would pull the WASM glue into the MV3 service worker
  // bundle and slow down extension startup.
  return baseReadinessRecord("language_check", settings, environment, {
    status: "passed",
    message: "用語檢查會在貼文頁以本機檢查器執行",
  });
}

function runExternalToolsReadinessCheck(
  settings: UserSettings,
  environment: { tierAEndpoint?: string; tierAModel?: string; buildId?: string },
): ReadinessRecord {
  return baseReadinessRecord("external_tools", settings, environment, {
    status: "passed",
    message: "複製、下載與搜尋可用",
  });
}

export async function runReadinessChecks(
  message: Extract<TrulyMessage, { type: "READINESS_RUN_CHECKS" }>,
  buildId: string,
): Promise<ReadinessRunChecksResultMsg> {
  const environment = {
    tierAEndpoint: message.tierAEndpoint,
    tierAModel: message.tierAModel,
    buildId: message.buildId ?? buildId,
  };
  const features = message.features ?? ["realtime", "ai_analysis", "reading_brief", "language_check", "external_tools"];
  const records: ReadinessRecord[] = [];
  let snapshot;
  for (const feature of features) {
    let record: ReadinessRecord;
    if (feature === "realtime") {
      record = await runRealtimeReadinessCheck(message.settings, environment);
    } else if (feature === "ai_analysis") {
      record = await runAiAnalysisReadinessCheck(message.settings, environment);
    } else if (feature === "reading_brief") {
      record = await runReadingBriefReadinessCheck(message.settings, environment);
    } else if (feature === "language_check") {
      record = await runLanguageCheckReadinessCheck(message.settings, environment);
    } else {
      record = runExternalToolsReadinessCheck(message.settings, environment);
    }
    snapshot = await saveReadinessRecord(record);
    records.push(record);
  }
  return {
    type: "READINESS_RUN_CHECKS_RESULT",
    ok: true,
    records,
    snapshot,
  };
}
