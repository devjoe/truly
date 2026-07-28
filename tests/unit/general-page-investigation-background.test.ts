import { describe, expect, it, vi } from "vitest";

import { scheduleGeneralPageInvestigationPreparation } from "@src/background/general-page-investigation-background";
import { ModelWorkScheduler } from "@src/background/model-work-scheduler";
import { createGeneralPageInvestigationCaptureBuffer } from "@src/background/general-page-investigation-capture";
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
  it("runs two derived stages and reveals the locally owned action atomically", async () => {
    const capturedJobs: any[] = [];
    const scheduler = {
      enqueue: vi.fn(async (job: any) => {
        capturedJobs.push(job);
        return job.run();
      }),
    };
    const sendMessage = vi.fn();
    const callAdapter = vi.fn(async (input: any) => ({
      ok: true,
      attempts: 1 as const,
      value: {
        schemaVersion: 7 as const,
        selections: [{
          candidateId: input.candidates[1].id,
          presentationTier: "primary" as const,
          exactClaim: input.candidates[1].exactText,
          sourceQuote: input.candidates[1].exactText,
          start: input.candidates[1].start,
          end: input.candidates[1].end,
        }],
      },
    }));
    const callAdmission = vi.fn(async () => ({
      ok: true,
      value: { schemaVersion: 1 as const, decision: "admit" as const },
    }));

    expect(scheduleGeneralPageInvestigationPreparation({
      scheduler: scheduler as never,
      request,
      endpoint: "http://127.0.0.1:8000/v1",
      model: "fixture-model",
      structuredOutputMode: "json_schema",
      resourceKey: "gx10|fixture-model",
      callAdapter,
      callAdmission,
      sendMessage,
    })).toBe(true);
    await vi.waitFor(() => expect(sendMessage).toHaveBeenCalledTimes(1));

    expect(capturedJobs).toHaveLength(2);
    expect(capturedJobs.map((job) => ({
      priority: job.priority,
      supersedeKey: job.supersedeKey,
    }))).toEqual([
      {
        priority: "derived",
        supersedeKey: "general-page-investigation:42:page:select",
      },
      {
        priority: "derived",
        supersedeKey: "general-page-investigation:42:page:admit",
      },
    ]);
    expect(callAdapter).toHaveBeenCalledTimes(1);
    expect(callAdmission).toHaveBeenCalledTimes(1);
    expect(callAdmission).toHaveBeenCalledWith(expect.objectContaining({
      authorizedSourceContext: request.context.mainText,
      structuredOutputMode: "json_schema",
      timeoutMs: 10_000,
      selection: expect.objectContaining({
        exactClaim: "衛生局命令遠帆公司在七月三十一日前完成下架",
      }),
    }));
    expect(callAdapter).toHaveBeenCalledWith(expect.objectContaining({
      targetKind: "page",
      authorizedSourceContext: request.context.mainText,
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
        evidenceHint: "優先比對直接相關的官方資料、當事人原始聲明或可信報導",
        askAiPrompt: expect.stringContaining("原文陳述：衛生局命令遠帆公司在七月三十一日前完成下架"),
        presentationTier: "primary",
      }],
    });
  });

  it("preserves an admitted exploratory tier for the reader-facing warning", async () => {
    const scheduler = { enqueue: vi.fn(async (job: any) => job.run()) };
    const sendMessage = vi.fn();
    const callAdapter = vi.fn(async (input: any) => ({
      ok: true,
      attempts: 1 as const,
      value: {
        schemaVersion: 7 as const,
        selections: [{
          candidateId: input.candidates[0].id,
          presentationTier: "exploratory" as const,
          exactClaim: input.candidates[0].exactText,
          sourceQuote: input.candidates[0].exactText,
          start: input.candidates[0].start,
          end: input.candidates[0].end,
        }],
      },
    }));

    scheduleGeneralPageInvestigationPreparation({
      scheduler: scheduler as never,
      request,
      endpoint: "http://127.0.0.1:8000/v1",
      model: "fixture-model",
      structuredOutputMode: "json_schema",
      resourceKey: "gx10|fixture-model",
      callAdapter,
      callAdmission: vi.fn(async () => ({
        ok: true,
        value: { schemaVersion: 1 as const, decision: "admit" as const },
      })),
      sendMessage,
    });
    await vi.waitFor(() => expect(sendMessage).toHaveBeenCalledTimes(1));

    expect(sendMessage).toHaveBeenCalledWith(expect.objectContaining({
      status: "prepared",
      preparedActions: [
        expect.objectContaining({ presentationTier: "exploratory" }),
      ],
    }));
  });

  it("lets queued user-blocking work run between selection and admission", async () => {
    const scheduler = new ModelWorkScheduler();
    let releaseSelection!: () => void;
    const selectionBlocked = new Promise<void>((resolve) => {
      releaseSelection = resolve;
    });
    const order: string[] = [];
    const sendMessage = vi.fn();
    const callAdapter = vi.fn(async (input: any) => {
      order.push("select");
      await selectionBlocked;
      return {
        ok: true,
        attempts: 1 as const,
        value: {
          schemaVersion: 7 as const,
          selections: [{
            candidateId: input.candidates[0].id,
            presentationTier: "primary" as const,
            exactClaim: input.candidates[0].exactText,
            sourceQuote: input.candidates[0].exactText,
            start: input.candidates[0].start,
            end: input.candidates[0].end,
          }],
        },
      };
    });
    const callAdmission = vi.fn(async () => {
      order.push("admit");
      return {
        ok: true,
        value: { schemaVersion: 1 as const, decision: "admit" as const },
      };
    });

    scheduleGeneralPageInvestigationPreparation({
      scheduler,
      request,
      endpoint: "http://127.0.0.1:8000/v1",
      model: "fixture-model",
      structuredOutputMode: "json_schema",
      resourceKey: "gx10|fixture-model",
      callAdapter,
      callAdmission,
      sendMessage,
    });
    await vi.waitFor(() => expect(order).toEqual(["select"]));

    const userWork = scheduler.enqueue({
      id: "foreground-user-action",
      resourceKey: "gx10|fixture-model",
      priority: "user_blocking",
      run: async () => {
        order.push("user");
        return "done";
      },
    });
    releaseSelection();

    await expect(userWork).resolves.toBe("done");
    await vi.waitFor(() => expect(sendMessage).toHaveBeenCalledTimes(1));
    expect(order).toEqual(["select", "user", "admit"]);
    expect(sendMessage).toHaveBeenCalledWith(expect.objectContaining({ status: "prepared" }));
  });

  it("admits after the bounded foreground burst instead of starving behind the Feed queue", async () => {
    const scheduler = new ModelWorkScheduler({ foregroundBurstLimit: 3 });
    let releaseSelection!: () => void;
    const selectionBlocked = new Promise<void>((resolve) => {
      releaseSelection = resolve;
    });
    const order: string[] = [];
    const sendMessage = vi.fn();
    const callAdapter = vi.fn(async (input: any) => {
      order.push("select");
      await selectionBlocked;
      return {
        ok: true,
        attempts: 1 as const,
        value: {
          schemaVersion: 7 as const,
          selections: [{
            candidateId: input.candidates[0].id,
            presentationTier: "primary" as const,
            exactClaim: input.candidates[0].exactText,
            sourceQuote: input.candidates[0].exactText,
            start: input.candidates[0].start,
            end: input.candidates[0].end,
          }],
        },
      };
    });
    const callAdmission = vi.fn(async () => {
      order.push("admit");
      return {
        ok: true,
        value: { schemaVersion: 1 as const, decision: "admit" as const },
      };
    });

    scheduleGeneralPageInvestigationPreparation({
      scheduler,
      request,
      endpoint: "http://127.0.0.1:8000/v1",
      model: "fixture-model",
      structuredOutputMode: "json_schema",
      resourceKey: "gx10|fixture-model",
      callAdapter,
      callAdmission,
      sendMessage,
    });
    await vi.waitFor(() => expect(order).toEqual(["select"]));

    const feedJobs = [1, 2, 3, 4].map((index) => scheduler.enqueue({
      id: `feed-${index}`,
      resourceKey: "gx10|fixture-model",
      priority: "foreground" as const,
      run: async () => {
        order.push(`feed-${index}`);
        return index;
      },
    }));
    releaseSelection();

    await Promise.all(feedJobs);
    await vi.waitFor(() => expect(sendMessage).toHaveBeenCalledTimes(1));
    expect(order).toEqual([
      "select",
      "feed-1",
      "feed-2",
      "feed-3",
      "admit",
      "feed-4",
    ]);
  });

  it("captures the exact selector envelope only when the volatile audit buffer is enabled", async () => {
    const capture = createGeneralPageInvestigationCaptureBuffer(1);
    const scheduler = { enqueue: vi.fn(async (job: any) => job.run()) };
    const callAdapter = vi.fn(async () => ({
      ok: true,
      attempts: 1 as const,
      value: { schemaVersion: 7 as const, selections: [] },
    }));

    scheduleGeneralPageInvestigationPreparation({
      scheduler: scheduler as never,
      request,
      endpoint: "http://127.0.0.1:8000/v1",
      model: "fixture-model",
      structuredOutputMode: "json_object",
      apiKey: "must-not-be-captured",
      resourceKey: "local|fixture-model",
      capture,
      callAdapter,
      sendMessage: vi.fn(),
    });
    await vi.waitFor(() => expect(callAdapter).toHaveBeenCalledTimes(1));
    expect(capture.items).toEqual([]);

    capture.enabled = true;
    scheduleGeneralPageInvestigationPreparation({
      scheduler: scheduler as never,
      request: { ...request, analysisKey: "page:captured" },
      endpoint: "http://127.0.0.1:8000/v1",
      model: "fixture-model",
      structuredOutputMode: "json_object",
      apiKey: "must-not-be-captured",
      resourceKey: "local|fixture-model",
      capture,
      callAdapter,
      sendMessage: vi.fn(),
    });
    await vi.waitFor(() => expect(callAdapter).toHaveBeenCalledTimes(2));

    expect(capture.items).toHaveLength(1);
    expect(capture.items[0]).toMatchObject({
      schemaVersion: 1,
      analysis: {
        tabId: 42,
        analysisKey: "page:captured",
        scope: "page",
        allowedUse: "article_or_selection_analysis",
        context: { mainText: request.context.mainText, targetKind: "page" },
        hasScreenshot: false,
      },
      adapter: {
        endpoint: "http://127.0.0.1:8000/v1",
        model: "fixture-model",
        targetKind: "page",
        authorizedSourceContext: request.context.mainText,
        candidates: expect.arrayContaining([
          expect.objectContaining({ exactText: "食藥署公布232項產品名單" }),
        ]),
      },
    });
    expect(capture.items[0].adapter).not.toHaveProperty("apiKey");
  });

  it("does not schedule ranked-action work for Focus", () => {
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
    const scheduler = { enqueue: vi.fn() };
    const sendMessage = vi.fn();
    const callAdapter = vi.fn();

    expect(scheduleGeneralPageInvestigationPreparation({
      scheduler: scheduler as never,
      request: focusRequest,
      endpoint: "http://127.0.0.1:8000/v1",
      model: "fixture-model",
      structuredOutputMode: "json_object",
      resourceKey: "gx10|fixture-model",
      callAdapter,
      sendMessage,
    })).toBe(false);
    expect(scheduler.enqueue).not.toHaveBeenCalled();
    expect(callAdapter).not.toHaveBeenCalled();
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it("settles abstention and malformed provider output without a repair request", async () => {
    const scheduler = { enqueue: vi.fn(async (job: any) => job.run()) };
    const sendMessage = vi.fn();
    const callAdapter = vi.fn(async () => ({
      ok: true,
      attempts: 1 as const,
      value: {
        schemaVersion: 7 as const,
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

  it("publishes nothing when the second stage rejects or is unavailable", async () => {
    const selection = {
      candidateId: "span:1",
      presentationTier: "primary" as const,
      exactClaim: "食藥署公布232項產品名單",
      sourceQuote: "食藥署公布232項產品名單",
      start: 0,
      end: 14,
    };
    const callAdapter = vi.fn(async () => ({
      ok: true,
      attempts: 1 as const,
      value: { schemaVersion: 7 as const, selections: [selection] },
    }));

    for (const admissionResult of [
      { ok: true, value: { schemaVersion: 1 as const, decision: "reject" as const } },
      { ok: false, value: null, error: "investigation_action_admission_invalid_json" as const },
    ]) {
      const scheduler = { enqueue: vi.fn(async (job: any) => job.run()) };
      const sendMessage = vi.fn();
      const callAdmission = vi.fn(async () => admissionResult);
      scheduleGeneralPageInvestigationPreparation({
        scheduler: scheduler as never,
        request: { ...request, analysisKey: `page:${admissionResult.ok ? "reject" : "failure"}` },
        endpoint: "http://127.0.0.1:8000/v1",
        model: "fixture-model",
        structuredOutputMode: "json_schema",
        resourceKey: "gx10|fixture-model",
        callAdapter,
        callAdmission,
        sendMessage,
      });
      await vi.waitFor(() => expect(sendMessage).toHaveBeenCalledTimes(1));

      expect(scheduler.enqueue).toHaveBeenCalledTimes(2);
      expect(callAdmission).toHaveBeenCalledTimes(1);
      expect(sendMessage).toHaveBeenCalledWith(expect.objectContaining({
        status: admissionResult.ok ? "ineligible" : "unavailable",
      }));
      expect(sendMessage).not.toHaveBeenCalledWith(expect.objectContaining({
        status: "prepared",
      }));
    }
  });

  it("does not schedule Focus, overview, screenshot, or text without local candidates", () => {
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
      request: {
        ...request,
        scope: "focus",
        context: { ...request.context, targetKind: "selection" },
      },
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
