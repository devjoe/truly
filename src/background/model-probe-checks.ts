import {
  callOllamaSingle,
  isOpenAICompatEndpoint,
  probeTierACompactDigitsSupport,
} from "../lib/ollama-client";
import {
  callGeminiNanoTierA,
  callGeminiNanoTierB,
  probeGeminiNanoAvailability,
} from "../lib/gemini-nano-client";
import type {
  TrulyMessage,
  GeminiNanoProbeResultMsg,
  GeminiNanoSmokeResultMsg,
  OllamaCompactDigitsCheckResultMsg,
  OllamaHealthCheckResultMsg,
  OllamaResponseFormatCheckResultMsg,
} from "../lib/messages";
import { defaultEndpointForProvider, defaultModelForProvider } from "../lib/model-source-config";
import { TIER_B_VISION_PROBE_IMAGE } from "../lib/tier-b-client";

export async function runOllamaHealthCheck(
  message: Extract<TrulyMessage, { type: "OLLAMA_HEALTH_CHECK" }>,
): Promise<OllamaHealthCheckResultMsg> {
  const endpoint = message.endpoint || defaultEndpointForProvider("ollama");
  // Detect OpenAI-compatible endpoints — they expose /v1/models, not
  // Ollama's /api/tags. Mirror the dispatcher in `ollama-client.ts`.
  const useOpenAICompat = message.endpointKind
    ? message.endpointKind === "openai-compatible"
    : isOpenAICompatEndpoint(endpoint);
  const url = useOpenAICompat
    ? `${endpoint.replace(/\/v1\/?$/, "").replace(/\/$/, "")}/v1/models`
    : `${endpoint}/api/tags`;
  try {
    const resp = await fetch(url, { signal: AbortSignal.timeout(5000) });
    if (!resp.ok) {
      return {
        type: "OLLAMA_HEALTH_CHECK_RESULT",
        ok: false,
        error: `HTTP ${resp.status}`,
      };
    }
    const data = await resp.json();
    const models: string[] = useOpenAICompat
      ? ((data.data || []).map((m: { id?: string }) => m.id ?? "").filter(Boolean))
      : ((data.models || []).map((m: { name?: string }) => m.name ?? "").filter(Boolean));
    return {
      type: "OLLAMA_HEALTH_CHECK_RESULT",
      ok: true,
      models,
    };
  } catch (err) {
    return {
      type: "OLLAMA_HEALTH_CHECK_RESULT",
      ok: false,
      error: err instanceof Error ? err.message : "Unknown error",
    };
  }
}

export async function runGeminiNanoProbe(
  message: Extract<TrulyMessage, { type: "GEMINI_NANO_PROBE" }>,
): Promise<GeminiNanoProbeResultMsg> {
  const result = await probeGeminiNanoAvailability(
    message.mode === "tier-b" ? ["text", "image"] : ["text"],
  );
  return {
    type: "GEMINI_NANO_PROBE_RESULT",
    ok: result.ok,
    availability: String(result.availability),
    error: result.error,
  };
}

export async function runGeminiNanoSmoke(
  message: Extract<TrulyMessage, { type: "GEMINI_NANO_SMOKE" }>,
): Promise<GeminiNanoSmokeResultMsg> {
  const modalities = message.mode === "tier-b" ? ["text", "image"] as const : ["text"] as const;
  const availability = await probeGeminiNanoAvailability([...modalities]);
  if (!availability.ok) {
    return {
      type: "GEMINI_NANO_SMOKE_RESULT",
      ok: false,
      mode: message.mode,
      availability: String(availability.availability),
      error: availability.error,
    };
  }

  try {
    if (message.mode === "tier-a") {
      const result = await callGeminiNanoTierA([
        { id: "gemini-nano-smoke-a", text: "今天整理書桌，順手把舊收據分類收好。" },
      ]);
      const scores = result["gemini-nano-smoke-a"]?.scores;
      const ok = !!scores && ["commercial", "political", "emotional", "personal"].every(
        (key) => typeof scores[key] === "number",
      );
      return {
        type: "GEMINI_NANO_SMOKE_RESULT",
        ok,
        mode: message.mode,
        availability: String(availability.availability),
        summary: ok ? JSON.stringify(scores) : "missing_scores",
      };
    }

    const result = await callGeminiNanoTierB({
      text: "這是一則 Gemini Nano 圖片輸入 smoke test；圖片只是 1x1 測試圖，請不要過度解讀。",
      imageUrls: [message.imageDataUrl || TIER_B_VISION_PROBE_IMAGE],
    });
    return {
      type: "GEMINI_NANO_SMOKE_RESULT",
      ok: result.ok,
      mode: message.mode,
      availability: String(availability.availability),
      summary: result.deep?.summary || result.deep?.imageStatus || undefined,
      error: result.error,
    };
  } catch (error) {
    return {
      type: "GEMINI_NANO_SMOKE_RESULT",
      ok: false,
      mode: message.mode,
      availability: String(availability.availability),
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function runOllamaResponseFormatCheck(
  message: Extract<TrulyMessage, { type: "OLLAMA_RESPONSE_FORMAT_CHECK" }>,
): Promise<OllamaResponseFormatCheckResultMsg> {
  const endpoint = message.endpoint || defaultEndpointForProvider("ollama");
  const model = message.model || defaultModelForProvider("ollama", "reading-prompt");
  try {
    const result = await callOllamaSingle(
      {
        id: "response-format-check",
        text: "今天整理書桌，順手把幾張舊收據分類收好。",
      },
      endpoint,
      model,
      undefined,
      {
        endpointKind: message.endpointKind,
        openAICompatibleFlavor: message.openAICompatibleFlavor,
        responseFormat: message.responseFormat,
        outputMode: message.outputMode,
        returnUnparseable: true,
      },
    );
    const hasScores = !!result && Object.keys(result.scores).length > 0;
    return {
      type: "OLLAMA_RESPONSE_FORMAT_CHECK_RESULT",
      ok: hasScores,
      error: hasScores ? undefined : (result?.parseError ?? "empty_or_unparseable_response"),
      raw: hasScores ? undefined : result?.raw,
      parseError: hasScores ? undefined : result?.parseError,
    };
  } catch (err) {
    return {
      type: "OLLAMA_RESPONSE_FORMAT_CHECK_RESULT",
      ok: false,
      error: err instanceof Error ? err.message : "Unknown error",
    };
  }
}

export async function runOllamaCompactDigitsCheck(
  message: Extract<TrulyMessage, { type: "OLLAMA_COMPACT_DIGITS_CHECK" }>,
): Promise<OllamaCompactDigitsCheckResultMsg> {
  const endpoint = message.endpoint || defaultEndpointForProvider("ollama");
  const model = message.model || defaultModelForProvider("ollama", "reading-prompt");
  try {
    const result = await probeTierACompactDigitsSupport(
      endpoint,
      model,
      message.customRules,
      {
        endpointKind: message.endpointKind,
        openAICompatibleFlavor: message.openAICompatibleFlavor,
        responseFormat: "none",
        outputMode: "compact_digits",
      },
    );
    return {
      type: "OLLAMA_COMPACT_DIGITS_CHECK_RESULT",
      ok: result.ok,
      expectedLength: result.expectedLength,
      raw: result.raw,
      error: result.error,
    };
  } catch (err) {
    return {
      type: "OLLAMA_COMPACT_DIGITS_CHECK_RESULT",
      ok: false,
      error: err instanceof Error ? err.message : "Unknown error",
    };
  }
}
