import { describe, expect, it } from "vitest";

import type { GeneralPageModelContext } from "@src/lib/general-page-model-context";
import type { ReadingSurface } from "@src/lib/reading-surface-types";
import { projectPageReadingPresentation } from "@src/sidepanel/page-reading-presentation";

const tr = (key: string) => key;
const surface = (warnings: ReadingSurface["extraction"]["warnings"] = []): ReadingSurface => ({
  id: "surface:fixture",
  kind: "web-page",
  source: "general",
  url: "https://example.test/article",
  mainText: "Synthetic presentation projection text.",
  extraction: { method: "semantic-html", status: "complete", warnings },
});
const context = (targetKind: GeneralPageModelContext["targetKind"] = "page"): GeneralPageModelContext => ({
  schemaVersion: 1,
  surfaceId: "surface:fixture",
  surfaceKind: "web-page",
  surfaceSource: "general",
  targetKind,
  title: "Fixture",
  url: "https://example.test/article",
  domain: "example.test",
  mainText: "Synthetic presentation projection text.",
  links: [],
  imageAltText: [],
  extraction: { method: "semantic-html", status: "complete", warnings: [] },
  modelReadiness: "ready",
  ineligibilityReasons: [],
  qualityIssues: [],
});

describe("page reading presentation projection", () => {
  it("keeps an ordinary ready Web page quiet", () => {
    const result = projectPageReadingPresentation({
      workspace: "page",
      surface: surface(),
      context: context(),
      advisor: {
        status: "not_needed",
        effectiveModelContext: { allowedUse: "article_or_selection_analysis" } as never,
        updatedAt: 1,
      },
      analysis: { status: "ready", updatedAt: 2, brief: { schemaVersion: 1, summary: "Ready" } },
      tr,
    });
    expect(result.surfaceState).toBe("ready");
    expect(result.focusState).toBe("empty");
    expect(result.hideReadyPipelineState).toBe(true);
    expect(result.hideTechnicalDetails).toBe(true);
    expect(result.pageContext).toBeUndefined();
  });

  it("promotes overview guidance into Page Context and suppresses a duplicate note", () => {
    const result = projectPageReadingPresentation({
      workspace: "page",
      surface: surface(["large-navigation-noise"]),
      context: context(),
      advisor: {
        status: "ready",
        effectiveModelContext: { allowedUse: "page_overview_only" } as never,
        updatedAt: 1,
      },
      analysis: {
        status: "ready",
        allowedUse: "page_overview_only",
        updatedAt: 2,
        brief: { schemaVersion: 1, summary: "Overview", note: "新聞彙整頁面，請開啟各來源連結。" },
      },
      tr,
    });
    expect(result.pageContext).toEqual({
      tone: "info",
      summary: "sidepanel.page.context.summary.overviewNavigation",
    });
    expect(result.omitBriefNote).toBe(true);
  });

  it("promotes an app-shell classification into Page Context and suppresses only the duplicate note", () => {
    const result = projectPageReadingPresentation({
      workspace: "page",
      surface: surface(["dynamic-content-partial"]),
      context: context(),
      advisor: {
        status: "ready",
        advice: { pageType: "app_shell", decision: "request_user_selection" } as never,
        effectiveModelContext: {
          allowedUse: "requires_user_target",
          pageType: "app_shell",
        } as never,
        updatedAt: 1,
      },
      analysis: {
        status: "ready",
        allowedUse: "requires_user_target",
        updatedAt: 2,
        brief: { schemaVersion: 1, summary: "Search results", note: "此為搜尋介面，非文章頁面。" },
      },
      tr,
    });
    expect(result.pageContext).toEqual({
      tone: "action-required",
      status: "sidepanel.page.context.status.needsTarget",
      summary: "sidepanel.page.context.summary.appShellRequiresTarget",
    });
    expect(result.omitBriefNote).toBe(true);
  });

  it("keeps an app-shell note when it adds content-specific information", () => {
    const result = projectPageReadingPresentation({
      workspace: "page",
      surface: surface(["dynamic-content-partial"]),
      context: context(),
      advisor: {
        status: "ready",
        advice: { pageType: "app_shell", decision: "request_user_selection" } as never,
        effectiveModelContext: {
          allowedUse: "requires_user_target",
          pageType: "app_shell",
        } as never,
        updatedAt: 1,
      },
      analysis: {
        status: "ready",
        allowedUse: "requires_user_target",
        updatedAt: 2,
        brief: {
          schemaVersion: 1,
          summary: "Search results",
          note: "此為搜尋介面，非文章頁面；前三筆結果來自官方文件。",
        },
      },
      tr,
    });
    expect(result.pageContext?.summary).toBe("sidepanel.page.context.summary.appShellRequiresTarget");
    expect(result.omitBriefNote).toBe(false);
  });

  it("keeps an app-shell overview while moving its duplicate classification into Page Context", () => {
    const result = projectPageReadingPresentation({
      workspace: "page",
      surface: surface(["dynamic-content-partial"]),
      context: context(),
      advisor: {
        status: "ready",
        advice: { pageType: "index_or_feed", decision: "downgrade_to_index_or_feed" } as never,
        effectiveModelContext: {
          allowedUse: "page_overview_only",
          pageType: "index_or_feed",
        } as never,
        updatedAt: 1,
      },
      analysis: {
        status: "ready",
        allowedUse: "page_overview_only",
        updatedAt: 2,
        brief: {
          schemaVersion: 1,
          summary: "Ollama model search overview",
          note: "此為搜尋入口，非詳細說明頁面。",
        },
      },
      tr,
    });
    expect(result.pageContext).toEqual({
      tone: "info",
      summary: "sidepanel.page.context.summary.appShellOverview",
    });
    expect(result.omitBriefNote).toBe(true);
  });

  it("does not treat an ordinary article mentioning a search interface as duplicate chrome", () => {
    const result = projectPageReadingPresentation({
      workspace: "page",
      surface: surface(),
      context: context(),
      advisor: {
        status: "ready",
        advice: { pageType: "article", decision: "accept_current" } as never,
        effectiveModelContext: {
          allowedUse: "article_or_selection_analysis",
          pageType: "article",
        } as never,
        updatedAt: 1,
      },
      analysis: {
        status: "ready",
        allowedUse: "article_or_selection_analysis",
        updatedAt: 2,
        brief: { schemaVersion: 1, summary: "Article", note: "文章介紹一個新的搜尋介面。" },
      },
      tr,
    });
    expect(result.pageContext).toBeUndefined();
    expect(result.omitBriefNote).toBe(false);
  });

  it("does not promote a Web-level app-shell classification inside Focus", () => {
    const result = projectPageReadingPresentation({
      workspace: "focus",
      surface: surface(["dynamic-content-partial"]),
      context: context("selection"),
      target: {
        id: "target:selection",
        surfaceId: "surface:fixture",
        kind: "selection",
        text: "A selected synthetic passage.",
        extraction: { method: "selection", status: "complete", warnings: [] },
      },
      advisor: {
        status: "ready",
        advice: { pageType: "app_shell", decision: "request_user_selection" } as never,
        effectiveModelContext: {
          allowedUse: "article_or_selection_analysis",
          pageType: "app_shell",
        } as never,
        updatedAt: 1,
      },
      analysis: {
        status: "ready",
        allowedUse: "article_or_selection_analysis",
        updatedAt: 2,
        brief: { schemaVersion: 1, summary: "Selection", note: "此為搜尋介面，非文章頁面。" },
      },
      tr,
    });
    expect(result.pageContext).toBeUndefined();
    expect(result.focusAdvisory).toBeUndefined();
    expect(result.omitBriefNote).toBe(false);
  });

  it("maps a selected Focus target to a quiet overview and aggregation advisory", () => {
    const result = projectPageReadingPresentation({
      workspace: "focus",
      surface: surface(),
      context: context("selection"),
      target: {
        id: "target:selection",
        surfaceId: "surface:fixture",
        kind: "selection",
        text: "A selected synthetic passage.",
        extraction: { method: "selection", status: "complete", warnings: [] },
      },
      analysis: {
        status: "ready",
        allowedUse: "page_overview_only",
        updatedAt: 2,
        brief: { schemaVersion: 1, summary: "Selection", note: "This is a news aggregation page with source links." },
      },
      tr,
    });
    expect(result.pageContext).toBeUndefined();
    expect(result.focusState).toBe("ready");
    expect(result.focusOverview).toBe("selection");
    expect(result.focusAdvisory).toBe("aggregation");
    expect(result.omitBriefNote).toBe(true);
  });

  it("keeps the whole-page loading frame neutral while the advisor is checking", () => {
    const result = projectPageReadingPresentation({
      workspace: "page",
      surface: surface(["large-navigation-noise"]),
      context: context(),
      advisor: { status: "checking", updatedAt: 1 },
      analysis: { status: "idle", updatedAt: 1 },
      tr,
    });
    expect(result.hidePendingAdvisorState).toBe(true);
    expect(result.hideReadyPipelineState).toBe(true);
    expect(result.hideTechnicalDetails).toBe(true);
    expect(result.pageContext).toBeUndefined();
    expect(result.surfaceState).toBe("ready");
  });

  it("projects empty and Focus error states without DOM policy", () => {
    const result = projectPageReadingPresentation({
      workspace: "focus",
      status: "idle",
      hasFocusError: true,
      tr,
    });
    expect(result.surfaceState).toBe("empty");
    expect(result.focusState).toBe("error");
  });
});
