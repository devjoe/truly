import { callGeminiNanoTierA, GEMINI_NANO_PROVIDER } from "../lib/gemini-nano-client";
import { defaultEndpointForProvider, defaultModelForProvider } from "../lib/model-source-config";
import { callOllamaSingle, type OllamaSingleResult } from "../lib/ollama-client";
import type { TrulyMessage } from "../lib/messages";

export type TierAClassificationResult = {
  requestedIds: string[];
  results: Record<string, OllamaSingleResult>;
};

async function callEndpointTierA(
  posts: Extract<TrulyMessage, { type: "OLLAMA_CLASSIFY" }>["posts"],
  endpoint: string,
  model: string,
  customRules?: Extract<TrulyMessage, { type: "OLLAMA_CLASSIFY" }>["customRules"],
  options?: {
    endpointKind?: import("../lib/types").TierAEndpointKind;
    openAICompatibleFlavor?: import("../lib/types").OpenAICompatibleFlavor;
    responseFormat?: import("../lib/types").OpenAIResponseFormatMode;
    outputMode?: import("../lib/types").TierAOutputMode;
  },
): Promise<Record<string, OllamaSingleResult>> {
  const results: Record<string, OllamaSingleResult> = {};
  const promises = posts.map(async (post) => {
    const result = await callOllamaSingle(post, endpoint, model, customRules, options);
    if (result) results[post.id] = result;
  });
  await Promise.all(promises);
  return results;
}

export async function classifyTierAPosts(
  message: Extract<TrulyMessage, { type: "OLLAMA_CLASSIFY" }>,
): Promise<TierAClassificationResult> {
  const posts = message.posts || [];
  const endpoint = message.endpoint || defaultEndpointForProvider("ollama");
  const model = message.model || defaultModelForProvider("ollama", "reading-prompt");
  const requestedIds = posts.map((post) => post.id);
  const results = message.provider === GEMINI_NANO_PROVIDER
    ? await callGeminiNanoTierA(posts, message.customRules)
    : await callEndpointTierA(posts, endpoint, model, message.customRules, {
        endpointKind: message.endpointKind,
        openAICompatibleFlavor: message.openAICompatibleFlavor,
        responseFormat: message.responseFormat,
        outputMode: message.outputMode,
      });
  return { requestedIds, results };
}
