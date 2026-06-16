import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it, vi } from "vitest";

const HOT_RUNTIME_FILES = [
  "src/background/service-worker.ts",
  "src/content_scripts/feed-filter.ts",
  "src/content_scripts/feed-interception.ts",
  "src/content_scripts/graphql-interceptor.ts",
  "src/lib/filter-engine.ts",
  "src/options/options.ts",
  "src/popup/popup.ts",
  "src/sidepanel/sidepanel.ts",
] as const;

describe("runtime logging policy", () => {
  it("keeps routine production logs behind debugLog", () => {
    for (const file of HOT_RUNTIME_FILES) {
      const content = readFileSync(resolve(process.cwd(), file), "utf8");
      expect(
        content,
        `${file} should use debugLog for routine logs; warn/error stay visible.`,
      ).not.toMatch(/\bconsole\.(log|info|debug)\s*\(/);
    }
  });

  it("enables routine debug logs automatically only for dev builds", async () => {
    vi.resetModules();
    vi.stubGlobal("__TRULY_DEV_BUILD__", true);
    const devLogger = await import("../../src/lib/logger");
    expect(devLogger.isDebugLoggingEnabled()).toBe(true);

    vi.resetModules();
    vi.stubGlobal("__TRULY_DEV_BUILD__", false);
    const prodLogger = await import("../../src/lib/logger");
    expect(prodLogger.isDebugLoggingEnabled()).toBe(false);

    vi.unstubAllGlobals();
  });
});
