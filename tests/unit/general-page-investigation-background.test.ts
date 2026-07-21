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
  outputLang: "zh-TW",
  context: {
    surfaceKind: "web-page",
    surfaceSource: "general",
    targetKind: "page",
    title: "Fixture article",
    url: "https://example.test/article",
    domain: "example.test",
    sourceName: "Fixture News",
    authorName: "Fixture Author",
    publishedAt: "2026-07-16",
    mainText: "食藥署公布232項產品名單。衛生局命令遠帆公司在七月三十一日前完成下架。",
    links: [],
    imageAltText: [],
    extractionWarnings: [],
    modelEligible: true,
    modelReadiness: "ready",
    qualityIssues: [],
  },
};

describe("background General Page investigation preparation", () => {
  it("runs one derived span-selection job and reveals the locally owned batch atomically", async () => {
    let capturedJob: any;
    const scheduler = {
      enqueue: vi.fn(async (job: any) => {
        capturedJob = job;
        return job.run();
      }),
    };
    const sendMessage = vi.fn();
    const callAdapter = vi.fn(async (input: any) => ({
      ok: true,
      attempts: 1 as const,
      value: {
        schemaVersion: 3 as const,
        selections: [{
          candidateId: input.candidates[1].id,
          exactClaim: input.candidates[1].exactText,
          sourceQuote: input.candidates[1].exactText,
          start: input.candidates[1].start,
          end: input.candidates[1].end,
        }],
      },
    }));

    expect(scheduleGeneralPageInvestigationPreparation({
      scheduler: scheduler as never,
      request,
      endpoint: "http://127.0.0.1:8000/v1",
      model: "fixture-model",
      structuredOutputMode: "json_schema",
      resourceKey: "gx10|fixture-model",
      callAdapter,
      sendMessage,
    })).toBe(true);
    await vi.waitFor(() => expect(sendMessage).toHaveBeenCalledTimes(1));

    expect(capturedJob).toMatchObject({
      priority: "derived",
      supersedeKey: "general-page-investigation:42:page",
    });
    expect(callAdapter).toHaveBeenCalledTimes(1);
    expect(callAdapter).toHaveBeenCalledWith(expect.objectContaining({
      targetKind: "page",
      structuredOutputMode: "json_schema",
      outputLang: "zh-TW",
      sourceLang: "zh-TW",
      source: expect.objectContaining({ url: request.context.url }),
      candidates: expect.arrayContaining([
        expect.objectContaining({ exactText: "食藥署公布232項產品名單" }),
        expect.objectContaining({ exactText: "衛生局命令遠帆公司在七月三十一日前完成下架" }),
      ]),
    }));
    expect(sendMessage).toHaveBeenCalledWith({
      type: "GENERAL_PAGE_INVESTIGATION_RESULT",
      tabId: 42,
      analysisKey: "page:key",
      scope: "page",
      status: "prepared",
      preparedActions: [{
        displayClaim: "衛生局命令遠帆公司在七月三十一日前完成下架",
        evidenceHint: "比對直接相關的第一手或可信來源",
        askAiPrompt: expect.stringContaining("原文陳述：衛生局命令遠帆公司在七月三十一日前完成下架"),
      }],
    });
  });

  it("preserves Focus as the only target and uses the interface language for local presentation", async () => {
    const focusRequest: GeneralPageAnalysisRequestMsg = {
      ...request,
      scope: "focus",
      outputLang: "en",
      context: {
        ...request.context,
        targetKind: "selection",
        mainText: "The agency ordered a refund for 2,400 policies.",
      },
    };
    const scheduler = { enqueue: vi.fn(async (job: any) => job.run()) };
    const sendMessage = vi.fn();
    const callAdapter = vi.fn(async (input: any) => ({
      ok: true,
      attempts: 1 as const,
      value: {
        schemaVersion: 3 as const,
        selections: [{
          ...input.candidates[0],
          candidateId: input.candidates[0].id,
          exactClaim: input.candidates[0].exactText,
          sourceQuote: input.candidates[0].exactText,
        }],
      },
    }));

    expect(scheduleGeneralPageInvestigationPreparation({
      scheduler: scheduler as never,
      request: focusRequest,
      endpoint: "http://127.0.0.1:8000/v1",
      model: "fixture-model",
      structuredOutputMode: "json_object",
      resourceKey: "gx10|fixture-model",
      callAdapter,
      sendMessage,
    })).toBe(true);
    await vi.waitFor(() => expect(sendMessage).toHaveBeenCalledTimes(1));

    expect(callAdapter).toHaveBeenCalledWith(expect.objectContaining({
      targetKind: "selection",
      sourceLang: "en",
      outputLang: "en",
    }));
    expect(sendMessage).toHaveBeenCalledWith(expect.objectContaining({
      status: "prepared",
      preparedActions: [expect.objectContaining({
        evidenceHint: "Compare with directly relevant primary or authoritative evidence",
        askAiPrompt: expect.stringContaining("Original claim: The agency ordered a refund for 2,400 policies"),
      })],
    }));
  });

  it("settles abstention and malformed provider output without a repair request", async () => {
    const scheduler = { enqueue: vi.fn(async (job: any) => job.run()) };
    const sendMessage = vi.fn();
    const callAdapter = vi.fn(async () => ({
      ok: true,
      attempts: 1 as const,
      value: {
        schemaVersion: 3 as const,
        selections: [],
      },
    }));

    scheduleGeneralPageInvestigationPreparation({
      scheduler: scheduler as never,
      request,
      endpoint: "http://127.0.0.1:8000/v1",
      model: "fixture-model",
      structuredOutputMode: "json_object",
      resourceKey: "gx10|fixture-model",
      callAdapter,
      sendMessage,
    });
    await vi.waitFor(() => expect(sendMessage).toHaveBeenCalledTimes(1));

    expect(callAdapter).toHaveBeenCalledTimes(1);
    expect(sendMessage).toHaveBeenCalledWith(expect.objectContaining({ status: "ineligible" }));
  });

  it("does not schedule overview, screenshot, or text without local candidates", () => {
    const scheduler = { enqueue: vi.fn() };
    const base = {
      scheduler: scheduler as never,
      endpoint: "http://127.0.0.1:8000/v1",
      model: "fixture-model",
      structuredOutputMode: "json_object" as const,
      resourceKey: "local|fixture-model",
      callAdapter: vi.fn(),
      sendMessage: vi.fn(),
    };
    expect(scheduleGeneralPageInvestigationPreparation({
      ...base,
      request: { ...request, allowedUse: "page_overview_only" },
    })).toBe(false);
    expect(scheduleGeneralPageInvestigationPreparation({
      ...base,
      request: { ...request, screenshotDataUrl: "data:image/png;base64,AA==" },
    })).toBe(false);
    expect(scheduleGeneralPageInvestigationPreparation({
      ...base,
      request: { ...request, context: { ...request.context, mainText: "短文" } },
    })).toBe(false);
    expect(scheduler.enqueue).not.toHaveBeenCalled();
  });
});
