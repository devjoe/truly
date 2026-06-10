import type { TierAEndpointKind, TierAProvider, TierBProvider } from "./types";

export type ModelProvider = TierAProvider | TierBProvider;

export interface ProviderCapabilities {
  id: ModelProvider;
  label: string;
  requiresEndpoint: boolean;
  requiresApiKey: boolean;
  endpointKind?: TierAEndpointKind;
  supportsTierA: boolean;
  supportsTierB: boolean;
  supportsTierB2: boolean;
  /** Candidate means the provider may be attempted for the feature, but the
   *  current environment/model must pass a function test before UI calls it
   *  ready. This is important for browser-native providers whose capability
   *  can improve independently of extension releases. */
  candidateTierB2?: boolean;
  supportsImages: boolean;
  fixedModel?: string;
}

const PROVIDER_CAPABILITIES: Record<ModelProvider, ProviderCapabilities> = {
  "tier-a": {
    id: "tier-a",
    label: "沿用閱讀前提示",
    requiresEndpoint: false,
    requiresApiKey: false,
    supportsTierA: false,
    supportsTierB: true,
    supportsTierB2: true,
    supportsImages: true,
  },
  ollama: {
    id: "ollama",
    label: "Ollama",
    requiresEndpoint: true,
    requiresApiKey: false,
    endpointKind: "ollama",
    supportsTierA: true,
    supportsTierB: true,
    supportsTierB2: true,
    supportsImages: true,
  },
  "openai-compatible": {
    id: "openai-compatible",
    label: "OpenAI 相容端點",
    requiresEndpoint: true,
    requiresApiKey: false,
    endpointKind: "openai-compatible",
    supportsTierA: true,
    supportsTierB: true,
    supportsTierB2: true,
    supportsImages: true,
  },
  "chrome-gemini-nano": {
    id: "chrome-gemini-nano",
    label: "Chrome 內建 Gemini Nano（實驗）",
    requiresEndpoint: false,
    requiresApiKey: false,
    supportsTierA: true,
    supportsTierB: true,
    supportsTierB2: false,
    candidateTierB2: true,
    supportsImages: true,
    fixedModel: "chrome-gemini-nano",
  },
  groq: {
    id: "groq",
    label: "Groq",
    requiresEndpoint: false,
    requiresApiKey: true,
    supportsTierA: false,
    supportsTierB: false,
    supportsTierB2: false,
    supportsImages: false,
  },
  openai: {
    id: "openai",
    label: "OpenAI",
    requiresEndpoint: false,
    requiresApiKey: true,
    supportsTierA: false,
    supportsTierB: false,
    supportsTierB2: false,
    supportsImages: false,
  },
  anthropic: {
    id: "anthropic",
    label: "Anthropic",
    requiresEndpoint: false,
    requiresApiKey: true,
    supportsTierA: false,
    supportsTierB: false,
    supportsTierB2: false,
    supportsImages: false,
  },
  none: {
    id: "none",
    label: "關閉",
    requiresEndpoint: false,
    requiresApiKey: false,
    supportsTierA: false,
    supportsTierB: false,
    supportsTierB2: false,
    supportsImages: false,
  },
};

export function providerCapabilities(provider: ModelProvider): ProviderCapabilities {
  return PROVIDER_CAPABILITIES[provider];
}

export function providerNeedsEndpoint(provider: ModelProvider): boolean {
  return providerCapabilities(provider).requiresEndpoint;
}

export function providerNeedsApiKey(provider: ModelProvider): boolean {
  return providerCapabilities(provider).requiresApiKey;
}

export function providerEndpointKind(provider: ModelProvider): TierAEndpointKind {
  return providerCapabilities(provider).endpointKind ?? "ollama";
}

export function providerSupportsTierA(provider: ModelProvider): boolean {
  return providerCapabilities(provider).supportsTierA;
}

export function providerSupportsTierB(provider: ModelProvider): boolean {
  return providerCapabilities(provider).supportsTierB;
}

export function providerSupportsTierB2(provider: ModelProvider): boolean {
  return providerCapabilities(provider).supportsTierB2;
}

export function providerCanTestTierB2(provider: ModelProvider): boolean {
  const capabilities = providerCapabilities(provider);
  return capabilities.supportsTierB2 || capabilities.candidateTierB2 === true;
}

export function providerFixedModel(provider: ModelProvider): string | undefined {
  return providerCapabilities(provider).fixedModel;
}
