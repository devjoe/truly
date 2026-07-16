import { describe, expect, it, vi } from "vitest";

import { scheduleGeneralPageInvestigationPreparation } from "@src/background/general-page-investigation-background";
import type { GeneralPageAnalysisRequestMsg } from "@src/lib/messages";

const request: GeneralPageAnalysisRequestMsg = {
  type: "GENERAL_PAGE_ANALYSIS_REQUEST",
  tabId: 42,
  analysisKey: "page:key",
  scope: "page",
  priority: "foreground",
  allowedUse: "article_or_selection_analysis",
  providerRuntime: { canUseModel: true, effectiveProvider: "openai-compatible" },
  context: {
    surfaceKind: "web-page",
    surfaceSource: "general",
    targetKind: "page",
    title: "Fixture article",
    url: "https://example.test/article",
    domain: "example.test",
    sourceName: "Fixture News",
    publishedAt: "2026-07-16",
    mainText: "Runtime fixture reports one synthetic claim.",
    links: [],
    imageAltText: [],
    extractionWarnings: [],
    modelEligible: true,
    modelReadiness: "ready",
    qualityIssues: [],
  },
};

const brief = {
  schemaVersion: 1 as const,
  summary: "Fixture summary.",
  claims: [{
    c: "Runtime fixture reports one synthetic claim.",
    why: "It matters.",
    need: "An authoritative record.",
    q: "Does Runtime fixture report one synthetic claim?",
  }],
  model: "fixture-model",
};

describe("background General Page investigation preparation", () => {
  it("schedules one derived, supersedable adapter job and preserves URL as metadata", async () => {
    let captured: any;
    const scheduler = {
      enqueue: vi.fn(async (job: any) => {
        captured = job;
        return job.run();
      }),
    };
    const sendMessage = vi.fn();
    const callAdapter = vi.fn(async (input: any) => ({
      ok: true,
      value: {
        schemaVersion: 1,
        decision: "prepared",
        reason: "actionable",
        claim: {
          ...brief.claims[0],
          atom: { s: "Runtime fixture", p: "reports", o: "one synthetic claim" },
          policy: { claimKind: "fact", consequence: "public_interest" },
        },
      },
    }));

    expect(scheduleGeneralPageInvestigationPreparation({
      scheduler: scheduler as never,
      request,
      brief,
      endpoint: "http://127.0.0.1:8000/v1",
      model: "fixture-model",
      resourceKey: "gx10|fixture-model",
      callAdapter,
      sendMessage,
    })).toBe(true);
    await vi.waitFor(() => expect(sendMessage).toHaveBeenCalled());

    expect(captured).toMatchObject({
      priority: "derived",
      supersedeKey: "general-page-investigation:42:page",
    });
    expect(callAdapter).toHaveBeenCalledWith(expect.objectContaining({
      groundingText: request.context.mainText,
      source: expect.objectContaining({ url: request.context.url }),
    }));
    expect(sendMessage).toHaveBeenCalledWith(expect.objectContaining({
      type: "GENERAL_PAGE_INVESTIGATION_RESULT",
      analysisKey: "page:key",
      status: "prepared",
    }));
  });

  it("uses the source-text language for an English-page verification task", async () => {
    const scheduler = {
      enqueue: vi.fn(async (job: any) => job.run()),
    };
    const sendMessage = vi.fn();
    const callAdapter = vi.fn(async () => ({
      ok: true,
      value: { schemaVersion: 1, decision: "abstain", reason: "unsupported_claim" },
    }));
    const englishRequest: GeneralPageAnalysisRequestMsg = {
      ...request,
      outputLang: "zh-TW",
      context: {
        ...request.context,
        mainText: "Troops 30 years old and over would have their testosterone levels tested annually, while younger soldiers could opt in to the test, Hegseth said.",
      },
    };

    expect(scheduleGeneralPageInvestigationPreparation({
      scheduler: scheduler as never,
      request: englishRequest,
      brief,
      endpoint: "http://127.0.0.1:8000/v1",
      model: "fixture-model",
      resourceKey: "gx10|fixture-model",
      callAdapter,
      sendMessage,
    })).toBe(true);
    await vi.waitFor(() => expect(callAdapter).toHaveBeenCalled());

    expect(callAdapter).toHaveBeenCalledWith(expect.objectContaining({ outputLang: "en" }));
  });

  it("performs at most one reason-specific semantic repair inside the same derived job", async () => {
    const scheduler = { enqueue: vi.fn(async (job: any) => job.run()) };
    const sendMessage = vi.fn();
    const callAdapter = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        value: {
          schemaVersion: 1,
          decision: "prepared",
          reason: "actionable",
          claim: {
            ...brief.claims[0],
            atom: { s: "Runtime fixture", p: "reported", o: "one synthetic claim" },
            policy: { claimKind: "fact", consequence: "public_interest" },
          },
        },
      })
      .mockResolvedValueOnce({
        ok: true,
        value: {
          schemaVersion: 1,
          decision: "prepared",
          reason: "actionable",
          claim: {
            ...brief.claims[0],
            atom: { s: "Runtime fixture", p: "reports", o: "one synthetic claim" },
            policy: { claimKind: "fact", consequence: "public_interest" },
          },
        },
      });

    scheduleGeneralPageInvestigationPreparation({
      scheduler: scheduler as never,
      request,
      brief,
      endpoint: "http://127.0.0.1:8000/v1",
      model: "fixture-model",
      resourceKey: "gx10|fixture-model",
      callAdapter,
      sendMessage,
    });
    await vi.waitFor(() => expect(sendMessage).toHaveBeenCalled());

    expect(callAdapter).toHaveBeenCalledTimes(2);
    expect(callAdapter).toHaveBeenLastCalledWith(expect.objectContaining({ repairReason: "atom_span_mismatch" }));
    expect(sendMessage).toHaveBeenCalledWith(expect.objectContaining({ status: "prepared" }));
  });

  it("does not schedule overview or claim-free reading results", () => {
    const scheduler = { enqueue: vi.fn() };
    expect(scheduleGeneralPageInvestigationPreparation({
      scheduler: scheduler as never,
      request: { ...request, allowedUse: "page_overview_only" },
      brief,
      endpoint: "http://127.0.0.1:8000/v1",
      model: "fixture-model",
      resourceKey: "gx10|fixture-model",
      callAdapter: vi.fn(),
      sendMessage: vi.fn(),
    })).toBe(false);
    expect(scheduleGeneralPageInvestigationPreparation({
      scheduler: scheduler as never,
      request,
      brief: { ...brief, claims: [] },
      endpoint: "http://127.0.0.1:8000/v1",
      model: "fixture-model",
      resourceKey: "gx10|fixture-model",
      callAdapter: vi.fn(),
      sendMessage: vi.fn(),
    })).toBe(false);
    expect(scheduleGeneralPageInvestigationPreparation({
      scheduler: scheduler as never,
      request: { ...request, screenshotDataUrl: "data:image/png;base64,AA==" },
      brief,
      endpoint: "http://127.0.0.1:8000/v1",
      model: "fixture-model",
      resourceKey: "local|fixture-model",
      callAdapter: vi.fn(),
      sendMessage: vi.fn(),
    })).toBe(false);
    expect(scheduler.enqueue).not.toHaveBeenCalled();
  });
});
