import { afterEach, describe, expect, it, vi } from "vitest";

import { runOllamaHealthCheck } from "@src/background/model-probe-checks";
import { runReadinessChecks } from "@src/background/readiness-checks";
import { callOllamaSingle } from "@src/lib/ollama-client";
import { callTierBVisionProbe } from "@src/lib/tier-b-client";
import { DEFAULT_SETTINGS } from "@src/lib/types";

const REQUIRED_AUTH = "Bearer test-key";
const ENDPOINT = "http://auth.example.test/v1";

function jsonResponse(status: number, payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function hasImagePart(body: any): boolean {
  return body?.messages?.some((message: any) =>
    Array.isArray(message?.content) &&
    message.content.some((part: any) => part?.type === "image_url")
  );
}

function installAuthenticatedOpenAIMock(): string[] {
  const seenAuthHeaders: string[] = [];
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const headers = new Headers(init?.headers);
    const auth = headers.get("Authorization") || "";
    seenAuthHeaders.push(auth);

    if (auth !== REQUIRED_AUTH) {
      return jsonResponse(401, { error: "missing bearer token" });
    }

    if (url === `${ENDPOINT}/models`) {
      return jsonResponse(200, { data: [{ id: "auth-model" }] });
    }

    if (url === `${ENDPOINT}/chat/completions`) {
      const body = init?.body ? JSON.parse(String(init.body)) : {};
      return jsonResponse(200, {
        choices: [
          {
            message: {
              content: hasImagePart(body) ? "blue" : "{\"c\":0,\"p\":0,\"e\":0,\"P\":0}",
            },
          },
        ],
      });
    }

    return jsonResponse(404, { error: "not found" });
  }));
  return seenAuthHeaders;
}

function installChromeStorageMock(): void {
  const store: Record<string, unknown> = {};
  vi.stubGlobal("chrome", {
    storage: {
      local: {
        async get(keys?: string | string[] | Record<string, unknown> | null) {
          if (!keys) return { ...store };
          if (typeof keys === "string") return { [keys]: store[keys] };
          if (Array.isArray(keys)) {
            return Object.fromEntries(keys.map((key) => [key, store[key]]));
          }
          return Object.fromEntries(Object.keys(keys).map((key) => [key, store[key] ?? keys[key]]));
        },
        async set(items: Record<string, unknown>) {
          Object.assign(store, items);
        },
        async remove(keys: string | string[]) {
          for (const key of Array.isArray(keys) ? keys : [keys]) delete store[key];
        },
      },
    },
  });
}

describe("OpenAI-compatible API key requests", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("fails health check without the API key and succeeds with it", async () => {
    installAuthenticatedOpenAIMock();

    const withoutKey = await runOllamaHealthCheck({
      type: "OLLAMA_HEALTH_CHECK",
      endpoint: ENDPOINT,
      endpointKind: "openai-compatible",
    });
    expect(withoutKey.ok).toBe(false);
    expect(withoutKey.error).toBe("HTTP 401");

    const withKey = await runOllamaHealthCheck({
      type: "OLLAMA_HEALTH_CHECK",
      endpoint: ENDPOINT,
      endpointKind: "openai-compatible",
      apiKey: "test-key",
    });
    expect(withKey.ok).toBe(true);
    expect(withKey.models).toEqual(["auth-model"]);
  });

  it("sends bearer auth for Tier A OpenAI-compatible classification", async () => {
    const seenAuthHeaders = installAuthenticatedOpenAIMock();

    const result = await callOllamaSingle(
      { id: "post-1", text: "今天整理書桌，順手把舊收據分類收好。" },
      ENDPOINT,
      "auth-model",
      undefined,
      {
        endpointKind: "openai-compatible",
        apiKey: "test-key",
        responseFormat: "json_object",
        outputMode: "json",
      },
    );

    expect(result?.scores).toMatchObject({
      commercial: 0,
      political: 0,
      emotional: 0,
      personal: 0,
    });
    expect(seenAuthHeaders).toContain(REQUIRED_AUTH);
  });

  it("sends bearer auth for Tier B vision probing", async () => {
    const seenAuthHeaders = installAuthenticatedOpenAIMock();

    const result = await callTierBVisionProbe({
      endpoint: ENDPOINT,
      model: "auth-model",
      apiKey: "test-key",
    });

    expect(result.ok).toBe(true);
    expect(seenAuthHeaders).toContain(REQUIRED_AUTH);
  });

  it("passes API keys through readiness checks for OpenAI-compatible providers", async () => {
    installChromeStorageMock();
    const seenAuthHeaders = installAuthenticatedOpenAIMock();

    const result = await runReadinessChecks({
      type: "READINESS_RUN_CHECKS",
      settings: {
        ...DEFAULT_SETTINGS,
        tierAProvider: "openai-compatible",
        tierBProvider: "openai-compatible",
        tierBEndpoint: ENDPOINT,
        tierBModel: "auth-model",
        deepClassifyEnabled: true,
      },
      features: ["realtime", "ai_analysis", "reading_brief"],
      tierAEndpoint: ENDPOINT,
      tierAModel: "auth-model",
      tierAApiKey: "test-key",
      tierBApiKey: "test-key",
    }, "test-build");

    expect(result.ok).toBe(true);
    expect(result.records.map((record) => [record.feature, record.status])).toEqual([
      ["realtime", "passed"],
      ["ai_analysis", "passed"],
      ["reading_brief", "passed"],
    ]);
    expect(result.records.every((record) => record.apiKeyAccepted === true)).toBe(true);
    expect(seenAuthHeaders.length).toBeGreaterThanOrEqual(4);
    expect(seenAuthHeaders.every((header) => header === REQUIRED_AUTH)).toBe(true);
  });

  it("reports API key rejection separately from generic connection failures", async () => {
    installChromeStorageMock();
    installAuthenticatedOpenAIMock();

    const result = await runReadinessChecks({
      type: "READINESS_RUN_CHECKS",
      settings: {
        ...DEFAULT_SETTINGS,
        tierAProvider: "openai-compatible",
      },
      features: ["realtime"],
      tierAEndpoint: ENDPOINT,
      tierAModel: "auth-model",
      tierAApiKey: "wrong-key",
    }, "test-build");

    expect(result.ok).toBe(true);
    expect(result.records[0]).toMatchObject({
      feature: "realtime",
      status: "connection_failed",
      message: "API key 未通過 · 請檢查金鑰或權限",
    });
    expect(result.records[0].apiKeyAccepted).toBeUndefined();
  });
});
