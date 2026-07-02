import { describe, expect, it } from "vitest";

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
});
