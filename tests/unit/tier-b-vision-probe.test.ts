import { afterEach, describe, expect, it, vi } from "vitest";

import {
  buildTierBVisionProbeChatBody,
  callTierBVisionProbe,
  TIER_B_VISION_PROBE_IMAGE,
} from "@src/lib/tier-b-client";

describe("Tier B vision probe", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("sends an image_url part through the same OpenAI-compatible route", () => {
    const body = buildTierBVisionProbeChatBody({
      endpoint: "http://localhost:11434",
      model: "gemma4:e4b-it-qat",
    });

    const content = body.messages[1].content;
    expect(Array.isArray(content)).toBe(true);
    expect(content).toContainEqual({ type: "image_url", image_url: { url: TIER_B_VISION_PROBE_IMAGE } });
    expect(body.reasoning_effort).toBe("none");
  });

  it("passes when the model identifies the blue probe image", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: true,
      json: async () => ({ choices: [{ message: { content: "blue" } }] }),
    })));

    const result = await callTierBVisionProbe({
      endpoint: "http://localhost:11434",
      model: "gemma4:e4b-it-qat",
    });

    expect(result.ok).toBe(true);
    expect(fetch).toHaveBeenCalledWith(
      "http://localhost:11434/v1/chat/completions",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("fails closed when the endpoint only returns text-model fallback output", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: true,
      json: async () => ({ choices: [{ message: { content: "I cannot inspect images." } }] }),
    })));

    const result = await callTierBVisionProbe({
      endpoint: "http://localhost:11434",
      model: "deepseek-v4-flash:cloud",
    });

    expect(result.ok).toBe(false);
    expect(result.error).toBe("vision_probe_format_error");
  });
});
