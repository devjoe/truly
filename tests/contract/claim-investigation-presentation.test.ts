import { describe, expect, it } from "vitest";
import fixture from "../fixtures/claim-investigation/food-recall-contract.json";
import { buildEvidenceFirstInvestigationPresentation } from "../../src/lib/claim-investigation-presentation";
import type { InvestigationBundle } from "../../src/lib/claim-investigation-contract";

describe("evidence-first investigation presentation", () => {
  it("places evidence under questions before a bounded sufficiency and finding", () => {
    const presentation = buildEvidenceFirstInvestigationPresentation(fixture as InvestigationBundle);
    expect(presentation?.state).toBe("insufficient");
    expect(presentation?.questionGroups[0].evidence[0].exactExcerpt).toContain("232");
    expect(presentation?.questionGroups[0].answered).toBe(true);
    expect(presentation?.unansweredQuestionCount).toBe(1);
    expect(presentation?.sufficiency?.state).toBe("insufficient");
    expect(presentation?.finding?.state).toBe("insufficient");
  });

  it("does not count syndicated copies as independent evidence", () => {
    const duplicate = structuredClone(fixture) as InvestigationBundle;
    duplicate.evidence.push({
      ...duplicate.evidence[0],
      id: "evidence:agency-list-copy",
      url: "https://copy.example.test/synthetic-recall",
      sharedOriginGroup: "agency-list",
    });
    duplicate.evidence[0].sharedOriginGroup = "agency-list";
    duplicate.finding?.evidenceArtifactIds.push("evidence:agency-list-copy");
    const presentation = buildEvidenceFirstInvestigationPresentation(duplicate);
    expect(presentation?.evidenceCount).toBe(3);
    expect(presentation?.independentOriginCount).toBe(2);
    expect(presentation?.questionGroups[0].evidence[0].duplicateCount).toBe(2);
  });

  it("fails closed for an invalid cross-reference", () => {
    const invalid = structuredClone(fixture) as InvestigationBundle;
    invalid.evidence[0].questionId = "question:missing";
    expect(buildEvidenceFirstInvestigationPresentation(invalid)).toBeUndefined();
  });
});
