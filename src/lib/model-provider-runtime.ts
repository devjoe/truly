import {
  providerFixedModel,
  providerNeedsEndpoint,
  type ModelProvider,
} from "./provider-capabilities";

export function providerRuntimeEndpoint(provider: ModelProvider, endpoint: string | undefined): string {
  return providerNeedsEndpoint(provider) ? (endpoint ?? "").trim() : "";
}

export function providerRuntimeModel(provider: ModelProvider, model: string | undefined): string {
  return providerFixedModel(provider) ?? (model ?? "").trim();
}
