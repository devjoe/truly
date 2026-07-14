import fs from "node:fs";

import { describe, expect, it } from "vitest";

import {
  CLAIM_INVESTIGATION_CONTRACT_VERSION,
  validateInvestigationBundle,
} from "@src/lib/claim-investigation-contract";

const fixture = JSON.parse(fs.readFileSync(
  "tests/fixtures/claim-investigation/food-recall-contract.json",
  "utf8",
));

function cloneFixture(): any {
  return structuredClone(fixture);
}

describe("Claim Investigation model-neutral contract", () => {
  it("accepts a synthetic evidence-first bundle with an insufficient finding", () => {
    expect(CLAIM_INVESTIGATION_CONTRACT_VERSION).toBe(2);
    expect(validateInvestigationBundle(fixture)).toEqual({ ok: true });
  });

  it("rejects a plan that references a different subject and legacy proposition indexing", () => {
    const value = cloneFixture();
    value.plan.subjectId = "subject:other";
    value.plan.questions[0].propositionIndex = 0;

    const result = validateInvestigationBundle(value);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: "plan.subjectId", code: "unknown_reference" }),
      expect.objectContaining({ path: "plan.questions[0].propositionIndex", code: "invalid_value" }),
    ]));
  });

  it("requires exactly one singular proposition instead of a proposition array", () => {
    const value = cloneFixture();
    value.subject.propositions = [value.subject.proposition, value.subject.proposition];
    delete value.subject.proposition;

    const result = validateInvestigationBundle(value);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues).toContainEqual(expect.objectContaining({
      path: "subject.proposition",
      code: "invalid_type",
    }));
  });

  it("does not count a source role as an evidence relation", () => {
    const value = cloneFixture();
    value.evidence[0].relation = "primary";

    const result = validateInvestigationBundle(value);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues).toContainEqual(expect.objectContaining({
      path: "evidence[0].relation",
      code: "invalid_value",
    }));
  });

  it("rejects a sufficient state that still has unanswered questions", () => {
    const value = cloneFixture();
    value.sufficiency.state = "sufficient";
    value.finding.state = "supported_by_available_evidence";

    const result = validateInvestigationBundle(value);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues).toContainEqual(expect.objectContaining({
      path: "sufficiency.state",
      code: "inconsistent_state",
    }));
  });

  it("requires a sufficiency assessment before a finding", () => {
    const value = cloneFixture();
    delete value.sufficiency;

    const result = validateInvestigationBundle(value);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues).toContainEqual(expect.objectContaining({
      path: "finding",
      code: "inconsistent_state",
    }));
  });

  it("rejects unknown evidence and question references in assessments", () => {
    const value = cloneFixture();
    value.sufficiency.unansweredQuestionIds.push("question:unknown");
    value.finding.evidenceArtifactIds.push("evidence:unknown");

    const result = validateInvestigationBundle(value);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: "sufficiency.unansweredQuestionIds[1]", code: "unknown_reference" }),
      expect.objectContaining({ path: "finding.evidenceArtifactIds[2]", code: "unknown_reference" }),
    ]));
  });
});
