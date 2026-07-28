import { describe, expect, it } from "vitest";

import { pageUrlIdentity } from "@src/lib/page-url-identity";
import {
  applyReadingTargetToSession,
  beginPageReadingSession,
  clearSessionForMeaningfulNavigation,
  completePageReadingSession,
  failPageReadingSession,
  materializeScopeSession,
  projectApprovedPageClaims,
  projectPreparedPageInvestigationActions,
  replaceScopeState,
  type PageReadingSession,
} from "@src/sidepanel/page-reading-session";

function session(): PageReadingSession {
  return {
    requestId: "page-read:session-12345678",
    tabId: 42,
    url: "https://example.test/article",
    identity: pageUrlIdentity("https://example.test/article"),
    title: "Fixture",
    status: "ready",
    updatedAt: 1_000,
    activationSource: "sidepanel",
    pageScope: {
      analysis: { status: "ready", updatedAt: 900, brief: { schemaVersion: 1, summary: "Web" } },
      investigation: { analysisKey: "page-key", claimIndex: 0 },
    },
    focusScope: {
      target: {
        id: "target:selection",
        surfaceId: "surface:fixture",
        kind: "selection",
        text: "Selected fixture text long enough for a target.",
        extraction: { method: "selection", status: "complete", warnings: [] },
      },
      analysis: { status: "ready", updatedAt: 950, brief: { schemaVersion: 1, summary: "Focus" } },
      investigation: { analysisKey: "focus-key", claimIndex: 0 },
    },
  };
}

describe("canonical page reading session", () => {
  it("materializes one scope without changing canonical slots", () => {
    const canonical = session();
    expect(materializeScopeSession(canonical, "page").analysis?.brief?.summary).toBe("Web");
    expect(materializeScopeSession(canonical, "page").target).toBeUndefined();
    expect(materializeScopeSession(canonical, "focus").analysis?.brief?.summary).toBe("Focus");
    expect(materializeScopeSession(canonical, "focus").target?.kind).toBe("selection");
    expect(materializeScopeSession(canonical, "page").investigation?.analysisKey).toBe("page-key");
    expect(materializeScopeSession(canonical, "focus").investigation?.analysisKey).toBe("focus-key");
    expect(canonical).not.toHaveProperty("analysis");
    expect(canonical).not.toHaveProperty("target");
  });

  it("updates one scope without replacing the other", () => {
    const canonical = session();
    const next = replaceScopeState(canonical, "page", {
      analysis: { status: "ready", updatedAt: 1_100, brief: { schemaVersion: 1, summary: "New Web" } },
    });
    expect(next.pageScope.analysis?.brief?.summary).toBe("New Web");
    expect(next.focusScope).toBe(canonical.focusScope);
  });

  it("preserves Focus only when a same-page reread asks for it", () => {
    const previous = session();
    const preserved = beginPageReadingSession({
      previous,
      requestId: "page-read:new-request-12345678",
      tabId: 42,
      url: previous.url,
      identity: previous.identity,
      title: previous.title,
      startedAt: 2_000,
      activationSource: "sidepanel",
      preserveFocus: true,
    });
    expect(preserved.pageScope).toEqual({});
    expect(preserved.focusScope).toBe(previous.focusScope);
    const cleared = beginPageReadingSession({
      ...preserved,
      previous,
      requestId: "page-read:other-request-12345678",
      startedAt: 3_000,
      preserveFocus: false,
    });
    expect(cleared.focusScope).toBeUndefined();
  });

  it("clears both scopes on meaningful navigation", () => {
    const next = clearSessionForMeaningfulNavigation(session(), {
      url: "https://example.test/other",
      title: "Other",
      updatedAt: 2_000,
    });
    expect(next.status).toBe("stale");
    expect(next.requestId).toBeUndefined();
    expect(next.pageScope).toEqual({});
    expect(next.focusScope).toBeUndefined();
    expect(next.surface).toBeUndefined();
  });

  it("completes a same-page reread while preserving Focus and screenshot recovery", () => {
    const previous = {
      ...session(),
      pageScope: {
        ...session().pageScope,
        screenshot: { status: "preview" as const, dataUrl: "data:image/png;base64,AA==", updatedAt: 900 },
      },
    };
    const result = completePageReadingSession({
      existing: previous,
      tabId: 42,
      requestId: "page-read:complete-12345678",
      surface: {
        id: "surface:fixture",
        kind: "web-page",
        source: "general",
        url: previous.url,
        title: "Updated fixture",
        mainText: "Updated synthetic surface text.",
        extraction: { method: "semantic-html", status: "complete", warnings: [] },
      },
      completedAt: 2_000,
      elapsedMs: 400,
    });
    expect(result.preservedRecovery).toBe(true);
    expect(result.session.focusScope).toBe(previous.focusScope);
    expect(result.session.pageScope.screenshot?.status).toBe("preview");
  });

  it("applies a Reading Target without changing the Web scope", () => {
    const previous = session();
    const target = previous.focusScope!.target!;
    const next = applyReadingTargetToSession({
      session: previous,
      surface: {
        id: target.surfaceId,
        kind: "web-page",
        source: "general",
        url: previous.url,
        mainText: target.text,
        extraction: { method: "selection", status: "complete", warnings: ["selection-only"] },
      },
      target,
      updatedAt: 2_000,
    });
    expect(next.pageScope).toBe(previous.pageScope);
    expect(next.focusScope).toEqual({ target });
  });

  it("fails a read without discarding either canonical scope", () => {
    const previous = session();
    const next = failPageReadingSession({
      existing: previous,
      requestId: previous.requestId,
      tabId: previous.tabId,
      url: previous.url,
      identity: previous.identity,
      error: "Synthetic failure",
      completedAt: 2_000,
    });
    expect(next.status).toBe("error");
    expect(next.error).toBe("Synthetic failure");
    expect(next.pageScope).toBe(previous.pageScope);
    expect(next.focusScope).toBe(previous.focusScope);
  });

  it("withholds locally accepted Adapter claims until the whole batch settles", () => {
    const preparedClaim = {
      c: "A consequential fixture claim.",
      why: "It affects public judgment.",
      need: "The responsible agency record.",
      q: "Is the consequential fixture claim accurate?",
    };
    const projection = projectApprovedPageClaims({
      analysisKey: "page-key",
      items: [
        { claimIndex: 0, status: "ready", preparedClaim },
        { claimIndex: 1, status: "ineligible" },
        { claimIndex: 2, status: "preparing" },
      ],
    }, "page-key");

    expect(projection).toEqual({ items: [], pending: true });
    expect(projectApprovedPageClaims({
      analysisKey: "stale-key",
      items: [{ claimIndex: 0, status: "ready", preparedClaim }],
    }, "page-key")).toEqual({ items: [], pending: false });
  });

  it("projects the narrow selector batch atomically and ignores stale analysis keys", () => {
    const preparedActions = [{
      displayClaim: "食藥署公布232項產品名單",
      evidenceHint: "建議比對官方公告",
      askAiPrompt: "請查核以下原文陳述。",
      presentationTier: "primary" as const,
    }];

    expect(projectPreparedPageInvestigationActions({
      analysisKey: "page-key",
      status: "preparing",
    }, "page-key")).toEqual({ items: [], pending: true });
    expect(projectPreparedPageInvestigationActions({
      analysisKey: "page-key",
      status: "ready",
      preparedActions,
    }, "page-key")).toEqual({ items: preparedActions, pending: false });
    expect(projectPreparedPageInvestigationActions({
      analysisKey: "stale-key",
      status: "ready",
      preparedActions,
    }, "page-key")).toEqual({ items: [], pending: false });
  });
});
