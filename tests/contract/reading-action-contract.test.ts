import { describe, expect, it } from "vitest";

import type { TrulyMessage } from "@src/lib/messages";
import {
  isReadingAction,
  isReadingActivation,
  isReadingActivationSource,
  isReadingActivationTargetKind,
  READING_ACTIONS,
  READING_ACTIVATION_SOURCES,
  READING_ACTIVATION_TARGET_KINDS,
} from "@src/lib/reading-action-types";

describe("reading action contract", () => {
  it("keeps the future action vocabulary explicit and stable", () => {
    expect(READING_ACTIVATION_SOURCES).toEqual(["toolbar", "popup", "sidepanel", "hotkey"]);
    expect(READING_ACTIVATION_TARGET_KINDS).toEqual(["page", "selection", "current-region"]);
    expect(READING_ACTIONS).toEqual(["read", "summarize", "explain", "extract_claims", "fact_check"]);
  });

  it("validates activation source, target, and action values", () => {
    expect(isReadingActivationSource("hotkey")).toBe(true);
    expect(isReadingActivationSource("context-menu")).toBe(false);
    expect(isReadingActivationTargetKind("current-region")).toBe(true);
    expect(isReadingActivationTargetKind("paragraph")).toBe(false);
    expect(isReadingAction("fact_check")).toBe(true);
    expect(isReadingAction("auto_verdict")).toBe(false);
  });

  it("allows future selection and current-region requests without enabling runtime behavior", () => {
    const messages: TrulyMessage[] = [
      {
        type: "PAGE_READING_REQUEST",
        tabId: 1,
        activation: {
          source: "hotkey",
          targetKind: "selection",
          action: "summarize",
        },
      },
      {
        type: "PAGE_READING_REQUEST",
        tabId: 1,
        activation: {
          source: "hotkey",
          targetKind: "current-region",
          action: "fact_check",
        },
      },
    ];

    expect(messages.every((message) => isReadingActivation(message.activation))).toBe(true);
  });

  it("rejects partial or invented activation shapes", () => {
    expect(isReadingActivation(undefined)).toBe(false);
    expect(isReadingActivation({ source: "hotkey", targetKind: "selection" })).toBe(false);
    expect(isReadingActivation({ source: "sidepanel", targetKind: "paragraph", action: "read" })).toBe(false);
    expect(isReadingActivation({ source: "hotkey", targetKind: "current-region", action: "auto_verdict" })).toBe(false);
  });
});
