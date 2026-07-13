import { describe, expect, it } from "vitest";

import type { GeneralPageEffectiveModelContext } from "@src/lib/general-page-parser-advisor";
import type { GeneralPageParserAdvisorProviderRuntime } from "@src/lib/messages";
import type { ReadingSurface } from "@src/lib/reading-surface-types";
import {
  pageReadingAnalysisRunIsCurrent,
  planPageReadingAnalysis,
  settlePageReadingAnalysis,
} from "@src/sidepanel/page-reading-analysis-coordinator";
import type { MaterializedPageReadingSession } from "@src/sidepanel/page-reading-session";

const surface: ReadingSurface = {
  id: "surface:analysis",
  kind: "web-page",
  source: "general",
  url: "https://example.test/article",
  title: "Coordinator fixture",
  mainText: "Coordinator fixture text long enough for a deterministic reading analysis request.",
  extraction: { method: "semantic-html", status: "complete", warnings: [] },
};
const effective = {
  source: "current",
  allowedUse: "article_or_selection_analysis",
  title: surface.title,
  url: surface.url,
  mainText: surface.mainText,
  modelEligible: true,
  modelReadiness: "ready",
} as GeneralPageEffectiveModelContext;
const providerRuntime = {
  canUseModel: true,
  effectiveProvider: "openai-compatible",
  endpoint: "http://127.0.0.1:4999/v1/chat/completions",
  model: "fixture-model",
} as GeneralPageParserAdvisorProviderRuntime;

function session(): MaterializedPageReadingSession {
  return {
    requestId: "page-read:coordinator-12345678",
    tabId: 42,
    url: surface.url,
    identity: { normalizedUrl: surface.url, meaningfulUrl: surface.url } as never,
    title: surface.title,
    surface,
    status: "ready",
    updatedAt: 1,
    activationSource: "sidepanel",
    pageScope: {},
    advisor: {
      status: "ready",
      effectiveModelContext: effective,
      providerRuntime,
      updatedAt: 1,
    },
  };
}

function standardRun() {
  const plan = planPageReadingAnalysis({
    tabId: 42,
    session: session(),
    scope: "page",
    force: false,
    activeTabId: 42,
    activeUrl: surface.url,
    outputLang: "zh-TW",
    now: 10,
  });
  if (plan.kind !== "start") throw new Error("unexpected plan: " + plan.kind);
  return plan.run;
}

describe("Page Reading Analysis Coordinator", () => {
  it("plans one keyed standard request and running state", () => {
    const run = standardRun();
    expect(run.key).toContain("article_or_selection_analysis|current");
    expect(run.running).toMatchObject({ status: "running", key: run.key });
    expect(run.message).toMatchObject({
      type: "GENERAL_PAGE_ANALYSIS_REQUEST",
      tabId: 42,
      allowedUse: "article_or_selection_analysis",
      outputLang: "zh-TW",
    });
    expect("mode" in run.message).toBe(false);
    expect("mode" in run.running).toBe(false);
    expect(run.message.context.mainText).toBe(surface.mainText);
  });

  it("plans screenshot analysis through the same seam with a distinct key", () => {
    const plan = planPageReadingAnalysis({
      tabId: 42,
      session: session(),
      scope: "page",
      force: true,
      activeTabId: 42,
      activeUrl: surface.url,
      outputLang: "en",
      now: 10,
      screenshotDataUrl: "data:image/jpeg;base64,ZmFrZQ==",
    });
    expect(plan.kind).toBe("start");
    if (plan.kind !== "start") return;
    expect(plan.run.key).toContain("|screenshot");
    expect(plan.run.message.screenshotDataUrl).toContain("data:image/jpeg");
  });

  it("skips stale and duplicate work with explicit reasons", () => {
    const stale = planPageReadingAnalysis({
      tabId: 42,
      session: session(),
      scope: "page",
      force: true,
      activeTabId: 42,
      activeUrl: "https://example.test/other",
      outputLang: "zh-TW",
      now: 10,
    });
    expect(stale).toMatchObject({
      kind: "skip",
      reason: "stale_surface",
      eligibilityReason: "stale_surface",
      reportError: true,
    });

    const previous = standardRun();
    const duplicateSession = session();
    duplicateSession.pageScope = { analysis: previous.running };
    duplicateSession.analysis = previous.running;
    const duplicate = planPageReadingAnalysis({
      tabId: 42,
      session: duplicateSession,
      scope: "page",
      force: false,
      activeTabId: 42,
      activeUrl: surface.url,
      outputLang: "zh-TW",
      now: 11,
    });
    expect(duplicate).toMatchObject({ kind: "skip", reason: "already_running_or_ready", reportError: false });
  });

  it("rejects late results after navigation or a newer scoped run", () => {
    const run = standardRun();
    const current = session();
    current.pageScope = { analysis: run.running };
    expect(pageReadingAnalysisRunIsCurrent({
      run,
      session: current,
      tabId: 42,
      activeTabId: 42,
      activeUrl: surface.url,
    })).toBe(true);
    current.pageScope = { analysis: { ...run.running, key: "newer" } };
    expect(pageReadingAnalysisRunIsCurrent({
      run,
      session: current,
      tabId: 42,
      activeTabId: 42,
      activeUrl: surface.url,
    })).toBe(false);
  });

  it("settles success, remote failure, missing response, and thrown errors uniformly", () => {
    const run = standardRun();
    const brief = { schemaVersion: 1 as const, summary: "Ready", model: "fixture-model" };
    expect(settlePageReadingAnalysis({
      run,
      response: { type: "GENERAL_PAGE_ANALYSIS_RESULT", tabId: 42, ok: true, brief },
      now: 20,
    })).toMatchObject({ kind: "ready", analysis: { status: "ready", brief } });
    expect(settlePageReadingAnalysis({
      run,
      response: { type: "GENERAL_PAGE_ANALYSIS_RESULT", tabId: 42, ok: false, error: "remote_failed" },
      now: 20,
    })).toMatchObject({ kind: "error", analysis: { status: "error", error: "remote_failed" } });
    expect(settlePageReadingAnalysis({ run, response: undefined, now: 20 }))
      .toMatchObject({ kind: "error", analysis: { error: "general_page_brief_no_response" } });
    expect(settlePageReadingAnalysis({ run, error: new Error("network_down"), now: 20 }))
      .toMatchObject({ kind: "error", analysis: { error: "network_down" } });
  });
});
