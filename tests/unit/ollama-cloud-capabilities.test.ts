import { describe, expect, it } from "vitest";

import {
  lookupOllamaCloudCapability,
  modelLooksLikeOllamaCloud,
  normalizeOllamaModelId,
  ollamaCloudVisionSupport,
} from "@src/lib/ollama-cloud-capabilities";

describe("Ollama Cloud capability registry", () => {
  it("normalizes model identifiers before lookup", () => {
    expect(normalizeOllamaModelId(" DeepSeek-V4-Flash:Cloud ")).toBe("deepseek-v4-flash:cloud");
    expect(lookupOllamaCloudCapability("deepseek-v4-flash")?.id).toBe("deepseek-v4-flash:cloud");
  });

  it("marks text-only and vision-capable cloud models distinctly", () => {
    expect(ollamaCloudVisionSupport("deepseek-v4-flash:cloud")).toBe("unsupported");
    expect(ollamaCloudVisionSupport("gemma4:cloud")).toBe("supported");
  });

  it("recognizes cloud-looking model ids without pretending unknown capability is known", () => {
    expect(modelLooksLikeOllamaCloud("some-new-model:cloud")).toBe(true);
    expect(ollamaCloudVisionSupport("some-new-model:cloud")).toBe("unknown");
  });
});
