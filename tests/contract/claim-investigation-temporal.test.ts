import { describe, expect, it } from "vitest";

import type { InvestigationBundle } from "../../src/lib/claim-investigation-contract";
import { deriveInvestigationTemporalQuestion, selectInvestigationTemporalRoute } from "../../src/lib/claim-investigation-temporal";

function bundle(): InvestigationBundle {
  return {
    subject: {
      version: 2,
      id: "subject:temporal",
      scope: "page",
      originalSpan: "The notice says the rule took effect on 2025-09-01.",
      normalizedClaim: "The rule took effect on 2025-09-01.",
      source: { publishedAt: "2026-07-15", observedAt: "2026-07-15T10:00:00Z", contentFingerprint: "a".repeat(64) },
      proposition: { originalSpan: "the rule took effect on 2025-09-01", normalizedText: "The rule took effect.", time: "2025-09-01" },
      consequence: "law",
    },
    plan: {
      version: 2,
      subjectId: "subject:temporal",
      questions: [{ id: "q:time", basis: "literal", purpose: "timeline", question: "Did the rule take effect on 2026-07-15?", queryCandidates: [], preferredSourceRoles: ["primary"] }],
      minimumIndependentSources: 2,
      stoppingConditions: ["answer found"],
    },
    evidence: [],
  };
}

describe("temporal question derivation", () => {
  it("preserves the original and derives only from one explicit event anchor", () => {
    const result = deriveInvestigationTemporalQuestion({
      bundle: bundle(),
      questionId: "q:time",
      anchors: [{ id: "anchor:event", role: "event", value: "2025-09-01", exactSpan: "took effect on 2025-09-01", source: "claim_span" }],
      derivedQuestion: "Did the rule take effect on 2025-09-01?",
    });
    expect(result).toMatchObject({ status: "derived", originalQuestion: "Did the rule take effect on 2026-07-15?", derivedQuestion: "Did the rule take effect on 2025-09-01?" });
    expect(bundle().plan.questions[0].question).toBe("Did the rule take effect on 2026-07-15?");
  });

  it("blocks publication-only anchors and ambiguous event roles", () => {
    expect(deriveInvestigationTemporalQuestion({
      bundle: bundle(), questionId: "q:time",
      anchors: [{ id: "anchor:published", role: "publication", value: "2026-07-15", exactSpan: "2026-07-15", source: "source_metadata" }],
      derivedQuestion: "Did the rule take effect on 2026-07-15?",
    })).toMatchObject({ status: "blocked", reason: "publication_or_observation_only" });
    expect(deriveInvestigationTemporalQuestion({
      bundle: bundle(), questionId: "q:time",
      anchors: [
        { id: "anchor:event", role: "event", value: "2025-09-01", exactSpan: "took effect on 2025-09-01", source: "claim_span" },
        { id: "anchor:period", role: "reporting_period", value: "2025-09-01", exactSpan: "took effect on 2025-09-01", source: "claim_span" },
      ],
      derivedQuestion: "Did the rule take effect on 2025-09-01?",
    })).toMatchObject({ status: "blocked", reason: "ambiguous_temporal_role" });
  });

  it("rejects an anchor that is not an exact frozen-source span", () => {
    expect(deriveInvestigationTemporalQuestion({
      bundle: bundle(), questionId: "q:time",
      anchors: [{ id: "anchor:invented", role: "event", value: "2024-01-01", exactSpan: "2024-01-01", source: "claim_span" }],
      derivedQuestion: "Did the rule take effect on 2024-01-01?",
    })).toMatchObject({ status: "blocked", reason: "missing_explicit_anchor" });
  });

  it("keeps weak or conflicting dated reports quarantined", () => {
    const weak = selectInvestigationTemporalRoute({
      originalQuestion: "Did the event occur on the publication date?",
      derivedQuestion: "Did the event occur on 2025-09-01?",
      timeCutoff: "2026-07-15",
      ledger: [{ id: "date:1", value: "2025-09-01", role: "event", exactSpan: "event on 2025-09-01", evidenceCutoff: "2026-07-15", anchorStrength: "independent_dated_report", conflict: false }],
    });
    expect(weak).toMatchObject({ status: "quarantined", reason: "weak_anchor_only" });
    const conflict = selectInvestigationTemporalRoute({
      originalQuestion: "Did the event occur on the publication date?",
      derivedQuestion: "Did the event occur on 2025-09-01?",
      timeCutoff: "2026-07-15",
      ledger: [
        { id: "date:1", value: "2025-09-01", role: "event", exactSpan: "event on 2025-09-01", evidenceCutoff: "2026-07-15", anchorStrength: "canonical_record", conflict: false },
        { id: "date:2", value: "2025-09-02", role: "event", exactSpan: "event on 2025-09-02", evidenceCutoff: "2026-07-15", anchorStrength: "authoritative_dated_source", conflict: true },
      ],
    });
    expect(conflict).toMatchObject({ status: "quarantined", reason: "conflicting_anchors" });
  });

  it("materializes one strong coherent anchor only as pending review", () => {
    const result = selectInvestigationTemporalRoute({
      originalQuestion: "Did the event occur on the publication date?",
      derivedQuestion: "Did the event occur on 2025-09-01?",
      timeCutoff: "2026-07-15",
      ledger: [{ id: "date:1", value: "2025-09-01", role: "event", exactSpan: "event on 2025-09-01", evidenceCutoff: "2026-07-15", anchorStrength: "canonical_record", conflict: false }],
    });
    expect(result).toMatchObject({ status: "derived_pending_review", originalQuestion: "Did the event occur on the publication date?" });
  });
});
