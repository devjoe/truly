import { describe, expect, it, vi } from "vitest";

import { scheduleGeneralPageInvestigationPreparation } from "@src/background/general-page-investigation-background";
import { ModelWorkScheduler } from "@src/background/model-work-scheduler";
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

function immediateScheduler() {
  const jobs: any[] = [];
  return {
    jobs,
    scheduler: {
      enqueue: vi.fn(async (job: any) => {
        jobs.push(job);
        return job.run();
      }),
    },
  };
}

function modelSelection(candidate: any, presentationTier: "primary" | "exploratory") {
  return {
    candidateId: candidate.id,
    presentationTier,
    exactClaim: candidate.exactText,
    sourceQuote: candidate.exactText,
    start: candidate.start,
    end: candidate.end,
  };
}

describe("background General Page single-pass investigation preparation", () => {
  it("runs one derived job and reveals a locally owned action atomically", async () => {
    const { jobs, scheduler } = immediateScheduler();
    const sendMessage = vi.fn();
    const callAdapter = vi.fn(async (input: any) => ({
      ok: true,
      attempts: 1 as const,
      value: {
        schemaVersion: 13 as const,
        selections: [modelSelection(input.candidates[1], "primary")],
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

    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({
      priority: "derived",
      supersedeKey: "general-page-investigation:42:page:select",
    });
    expect(callAdapter).toHaveBeenCalledWith(expect.objectContaining({
      targetKind: "page",
      authorizedSourceContext: request.context.mainText,
      structuredOutputMode: "json_schema",
      maxProtocolAttempts: 1,
      sourceLang: "zh-TW",
      source: expect.objectContaining({ url: request.context.url }),
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
        askAiPrompt: expect.stringContaining(
          "原文陳述：衛生局命令遠帆公司在七月三十一日前完成下架",
        ),
        presentationTier: "primary",
      }],
    });
  });

  it("publishes the first surviving model-ranked candidate regardless of cue tier", async () => {
    const { scheduler } = immediateScheduler();
    const sendMessage = vi.fn();

    scheduleGeneralPageInvestigationPreparation({
      scheduler: scheduler as never,
      request,
      endpoint: "http://127.0.0.1:8000/v1",
      model: "fixture-model",
      structuredOutputMode: "json_object",
      resourceKey: "gx10|fixture-model",
      callAdapter: vi.fn(async (input: any) => ({
        ok: true,
        value: {
          schemaVersion: 13 as const,
          selections: [
            modelSelection(input.candidates[0], "exploratory"),
            modelSelection(input.candidates[1], "primary"),
          ],
        },
      })),
      sendMessage,
    });
    await vi.waitFor(() => expect(sendMessage).toHaveBeenCalledTimes(1));

    expect(sendMessage).toHaveBeenCalledWith(expect.objectContaining({
      status: "prepared",
      preparedActions: [
        expect.objectContaining({
          displayClaim: "食藥署公布232項產品名單",
          presentationTier: "exploratory",
        }),
      ],
    }));
  });

  it("uses the first surviving exploratory action when no primary survives", async () => {
    const { scheduler } = immediateScheduler();
    const sendMessage = vi.fn();

    scheduleGeneralPageInvestigationPreparation({
      scheduler: scheduler as never,
      request,
      endpoint: "http://127.0.0.1:8000/v1",
      model: "fixture-model",
      structuredOutputMode: "json_schema",
      resourceKey: "gx10|fixture-model",
      callAdapter: vi.fn(async (input: any) => ({
        ok: true,
        value: {
          schemaVersion: 13 as const,
          selections: [modelSelection(input.candidates[0], "exploratory")],
        },
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

  it("skips a locally invalid first selection and uses a clean backup", async () => {
    const { scheduler } = immediateScheduler();
    const sendMessage = vi.fn();

    scheduleGeneralPageInvestigationPreparation({
      scheduler: scheduler as never,
      request,
      endpoint: "http://127.0.0.1:8000/v1",
      model: "fixture-model",
      structuredOutputMode: "json_schema",
      resourceKey: "gx10|fixture-model",
      callAdapter: vi.fn(async (input: any) => ({
        ok: true,
        value: {
          schemaVersion: 13 as const,
          selections: [{
            ...modelSelection(input.candidates[0], "primary"),
            exactClaim: "Returns the value",
            sourceQuote: "Returns the value",
          }, modelSelection(input.candidates[1], "exploratory")],
        },
      })),
      sendMessage,
    });
    await vi.waitFor(() => expect(sendMessage).toHaveBeenCalledTimes(1));

    expect(sendMessage).toHaveBeenCalledWith(expect.objectContaining({
      status: "prepared",
      preparedActions: [
        expect.objectContaining({
          displayClaim: "衛生局命令遠帆公司在七月三十一日前完成下架",
          presentationTier: "exploratory",
        }),
      ],
    }));
  });

  it("publishes ineligible for a valid empty semantic result", async () => {
    const { scheduler } = immediateScheduler();
    const sendMessage = vi.fn();

    scheduleGeneralPageInvestigationPreparation({
      scheduler: scheduler as never,
      request,
      endpoint: "http://127.0.0.1:8000/v1",
      model: "fixture-model",
      structuredOutputMode: "json_schema",
      resourceKey: "gx10|fixture-model",
      callAdapter: vi.fn(async () => ({
        ok: true,
        value: { schemaVersion: 13 as const, selections: [] },
      })),
      sendMessage,
    });
    await vi.waitFor(() => expect(sendMessage).toHaveBeenCalledTimes(1));

    expect(sendMessage).toHaveBeenCalledWith(expect.objectContaining({
      status: "ineligible",
    }));
  });

  it("fails closed when the single model job is unavailable", async () => {
    const { scheduler } = immediateScheduler();
    const sendMessage = vi.fn();

    scheduleGeneralPageInvestigationPreparation({
      scheduler: scheduler as never,
      request,
      endpoint: "http://127.0.0.1:8000/v1",
      model: "fixture-model",
      structuredOutputMode: "json_schema",
      resourceKey: "gx10|fixture-model",
      callAdapter: vi.fn(async () => ({
        ok: false,
        value: null,
        error: "investigation_span_adapter_timeout" as const,
      })),
      sendMessage,
    });
    await vi.waitFor(() => expect(sendMessage).toHaveBeenCalledTimes(1));

    expect(sendMessage).toHaveBeenCalledWith(expect.objectContaining({
      status: "unavailable",
    }));
  });

  it("does not schedule automatic investigation outside eligible Page scope", () => {
    const { scheduler } = immediateScheduler();
    const sendMessage = vi.fn();

    for (const blocked of [
      { ...request, scope: "selection" as const },
      {
        ...request,
        context: { ...request.context, targetKind: "selection" as const },
      },
      { ...request, allowedUse: "page_overview_only" as const },
      { ...request, screenshotDataUrl: "data:image/png;base64,AA==" },
    ]) {
      expect(scheduleGeneralPageInvestigationPreparation({
        scheduler: scheduler as never,
        request: blocked,
        endpoint: "http://127.0.0.1:8000/v1",
        model: "fixture-model",
        structuredOutputMode: "json_schema",
        resourceKey: "gx10|fixture-model",
        sendMessage,
      })).toBe(false);
    }
    expect(scheduler.enqueue).not.toHaveBeenCalled();
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it("remains derived work behind already queued user-blocking work", async () => {
    const scheduler = new ModelWorkScheduler({
      maxConcurrent: 1,
      foregroundBurstLimit: 3,
    });
    const blocker = scheduler.enqueue({
      id: "blocker",
      resourceKey: "gx10|fixture-model",
      priority: "user-blocking",
      run: async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
        return "done";
      },
    });
    const order: string[] = [];
    const sendMessage = vi.fn();

    scheduleGeneralPageInvestigationPreparation({
      scheduler,
      request,
      endpoint: "http://127.0.0.1:8000/v1",
      model: "fixture-model",
      structuredOutputMode: "json_schema",
      resourceKey: "gx10|fixture-model",
      callAdapter: vi.fn(async (input: any) => {
        order.push("investigation");
        return {
          ok: true,
          value: {
            schemaVersion: 13 as const,
            selections: [modelSelection(input.candidates[0], "primary")],
          },
        };
      }),
      sendMessage,
    });
    order.push("scheduled");
    await expect(blocker).resolves.toBe("done");
    await vi.waitFor(() => expect(sendMessage).toHaveBeenCalledTimes(1));

    expect(order).toEqual(["scheduled", "investigation"]);
  });
});
