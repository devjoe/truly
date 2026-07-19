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
import { buildReadingBriefQuestionActionPayload } from "@src/sidepanel/reading-brief-text";

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
      {
        type: "READING_TARGET_REQUEST",
        tabId: 1,
        trigger: "hotkey",
        activation: {
          source: "hotkey",
          targetKind: "current-region",
          action: "summarize",
        },
      },
    ];

    expect(messages.every((message) => isReadingActivation(message.activation))).toBe(true);
  });

  it("has an explicit error message for target actions that are reserved but not enabled", () => {
    const messages: TrulyMessage[] = [
      {
        type: "READING_TARGET_ERROR",
        tabId: 1,
        error: "reading_target_unsupported",
      },
      {
        type: "READING_TARGET_ERROR",
        tabId: 1,
        error: "no_meaningful_selection",
      },
      {
        type: "READING_TARGET_ERROR",
        tabId: 1,
        error: "target_stale",
      },
    ];

    expect(messages.map((message) => message.type)).toEqual([
      "READING_TARGET_ERROR",
      "READING_TARGET_ERROR",
      "READING_TARGET_ERROR",
    ]);
  });

  it("rejects partial or invented activation shapes", () => {
    expect(isReadingActivation(undefined)).toBe(false);
    expect(isReadingActivation({ source: "hotkey", targetKind: "selection" })).toBe(false);
    expect(isReadingActivation({ source: "sidepanel", targetKind: "paragraph", action: "read" })).toBe(false);
    expect(isReadingActivation({ source: "hotkey", targetKind: "current-region", action: "auto_verdict" })).toBe(false);
  });

  it("versions follow-up question projections without enabling the agent task", () => {
    const payload = buildReadingBriefQuestionActionPayload({
      question: "此內容有哪些不同觀點？",
      kind: "counter",
      lang: "zh-TW",
      source: {
        title: "Synthetic policy page",
        summary: "Synthetic context for a contract-only action.",
        url: "https://example.com/policy",
      },
    });

    expect(Object.keys(payload).sort()).toEqual([
      "agentTask",
      "aiModePrompt",
      "copyText",
      "displayText",
      "googleQuery",
      "modelText",
      "version",
    ]);
    expect(payload.version).toBe(1);
    expect(payload.agentTask).toMatchObject({
      version: 1,
      type: "reading_follow_up",
      kind: "counter",
    });
    expect(payload.copyText).not.toContain("https://");
    expect(payload.googleQuery).not.toContain("https://");
    expect(payload.aiModePrompt).toContain("https://example.com/policy");
  });
});
