import { JSDOM } from "jsdom";
import { describe, expect, it } from "vitest";

import {
  buildPointReadingTarget,
  isPointerPointFresh,
  resolveReadingBlock,
  POINT_TARGET_MIN_TEXT_LENGTH,
  POINTER_FRESHNESS_MS,
} from "@src/lib/current-region-targeting";
import {
  buildGeneralPageModelContext,
} from "@src/lib/general-page-model-context";
import {
  buildGeneralPageParserAdvisorRequest,
  buildRuleBasedGeneralPageParserAdvice,
  isGeneralPageParserAdvisorAdviceCompatible,
} from "@src/lib/general-page-parser-advisor";
import type { ReadingTarget, ReadingTargetErrorReason } from "@src/lib/reading-target-types";
import type { ReadingSurface } from "@src/lib/reading-surface-types";

function surface(): ReadingSurface {
  return {
    id: "general:https://example.test/target-flow",
    kind: "web-page",
    source: "general",
    url: "https://example.test/target-flow",
    canonicalUrl: "https://example.test/target-flow",
    title: "Target Flow Fixture",
    mainText: [
      "Synthetic whole-page body text for the target-flow contract.",
      "The page itself may have noisy extraction warnings while a selected passage remains useful.",
      "Additional synthetic text keeps the whole-page surface above the normal model threshold.",
    ].join(" "),
    excerpt: "Synthetic whole-page body text for the target-flow contract.",
    extraction: {
      method: "fallback",
      status: "partial",
      warnings: ["large-navigation-noise", "no-main-content"],
    },
  };
}

function selectionTarget(surfaceId: string): ReadingTarget {
  return {
    id: "target:selection:fixture",
    surfaceId,
    kind: "selection",
    text: [
      "This selected passage is a focused synthetic reader target.",
      "It is long enough for the lower selected-text model threshold.",
    ].join(" "),
    surroundingText: "Surrounding synthetic article context remains available for the model prompt.",
    extraction: {
      method: "selection",
      status: "complete",
      warnings: [],
    },
  };
}

describe("current-region and selection targeting contract", () => {
  it("keeps target error reasons typed", () => {
    const reasons: ReadingTargetErrorReason[] = [
      "reading_target_unsupported",
      "no_meaningful_selection",
      "no_pointer_target",
      "page_grant_missing",
      "target_stale",
      "target_extraction_failed",
    ];

    expect(reasons).toContain("no_meaningful_selection");
    expect(reasons).toContain("target_stale");
  });

  it("binds a selection target to its originating surface", () => {
    const currentSurface = surface();
    const target = selectionTarget(currentSurface.id);

    expect(target.surfaceId).toBe(currentSurface.id);
    expect(target.kind).toBe("selection");
    expect(target.extraction.method).toBe("selection");
  });

  it("builds model and advisor context from selected text without treating the page as an index", () => {
    const currentSurface = surface();
    const target = selectionTarget(currentSurface.id);
    const context = buildGeneralPageModelContext(currentSurface, {
      target,
      minMainTextLength: 80,
    });
    const request = buildGeneralPageParserAdvisorRequest(context);
    const advice = buildRuleBasedGeneralPageParserAdvice(request);

    expect(context.targetKind).toBe("selection");
    expect(context.mainText).toBe(target.text);
    expect(context.modelEligible).toBe(true);
    expect(request.targetKind).toBe("selection");
    expect(advice.decision).toBe("accept_current");
    expect(isGeneralPageParserAdvisorAdviceCompatible(request, advice)).toBe(true);
  });

  it("resolves a paragraph block from the element under the pointer", () => {
    const dom = new JSDOM(`
      <main>
        <article>
          <p id="target-paragraph">This synthetic paragraph sits under the pointer and is long enough to become a current-region target.</p>
          <p>A sibling paragraph provides surrounding context for the resolved target block.</p>
        </article>
      </main>
    `);
    const paragraph = dom.window.document.getElementById("target-paragraph");
    const inlineText = paragraph?.firstChild;

    const block = resolveReadingBlock(paragraph);
    expect(block).toBe(paragraph);

    const resolution = buildPointReadingTarget({
      surfaceId: "general:https://example.test/target-flow",
      elementAtPoint: paragraph,
    });
    expect(resolution.ok).toBe(true);
    if (resolution.ok) {
      expect(resolution.target.kind).toBe("paragraph");
      expect(resolution.target.extraction.method).toBe("point-target");
      expect(resolution.target.text).toContain("under the pointer");
      expect(resolution.target.text.length).toBeGreaterThanOrEqual(POINT_TARGET_MIN_TEXT_LENGTH);
      expect(resolution.target.surroundingText).toContain("sibling paragraph");
      expect(resolution.target.surfaceId).toBe("general:https://example.test/target-flow");
    }
    void inlineText;
  });

  it("refuses editable, hidden, and extension-owned elements as point targets", () => {
    const dom = new JSDOM(`
      <main>
        <textarea id="editor">Editable text should never become an analysis target even when long enough for the threshold.</textarea>
        <div id="hidden-block" aria-hidden="true"><p>Hidden text that is long enough but must never resolve as a target block.</p></div>
        <div data-truly-ui="1"><p id="extension-owned">Extension UI text that is long enough but must be ignored by targeting.</p></div>
        <p id="tiny">Too short.</p>
      </main>
    `);
    const doc = dom.window.document;

    for (const id of ["editor", "hidden-block", "extension-owned", "tiny"]) {
      const resolution = buildPointReadingTarget({
        surfaceId: "general:https://example.test/target-flow",
        elementAtPoint: doc.getElementById(id),
      });
      expect(resolution.ok, id).toBe(false);
      if (!resolution.ok) expect(resolution.error, id).toBe("no_pointer_target");
    }
  });

  it("treats stale pointer positions as unusable", () => {
    const now = 1_000_000;
    expect(isPointerPointFresh({ x: 10, y: 10, ts: now - 100 }, now)).toBe(true);
    expect(isPointerPointFresh({ x: 10, y: 10, ts: now - POINTER_FRESHNESS_MS - 1 }, now)).toBe(false);
    expect(isPointerPointFresh(undefined, now)).toBe(false);
  });

  it("builds model context from a paragraph target as current-region", () => {
    const currentSurface = surface();
    const dom = new JSDOM(`
      <article>
        <p id="p1">This synthetic paragraph is the current-region target and carries enough text for the model threshold to pass.</p>
      </article>
    `);
    const resolution = buildPointReadingTarget({
      surfaceId: currentSurface.id,
      elementAtPoint: dom.window.document.getElementById("p1"),
    });
    expect(resolution.ok).toBe(true);
    if (!resolution.ok) return;

    const context = buildGeneralPageModelContext(currentSurface, {
      target: resolution.target,
      minMainTextLength: 80,
    });
    expect(context.targetKind).toBe("current-region");
    expect(context.mainText).toBe(resolution.target.text);
    expect(context.modelEligible).toBe(true);
  });
});
