import { describe, expect, it } from "vitest";

import { evaluateInvestigationProofCompilerGate } from "../../src/lib/investigation-proof-certificate-gate";

describe("proof certificate compiler gate", () => {
  it("authorizes only the next targeted experiment after exact counterfactual coverage", () => {
    const result = evaluateInvestigationProofCompilerGate([
      { fixtureId: "fb-answer", surface: "facebook", kind: "answer", expectedValid: true, actualValid: true, withholdingChecks: [{ artifactId: "a", expectedValid: false, actualValid: false }] },
      { fixtureId: "news-answer", surface: "news", kind: "answer", expectedValid: true, actualValid: true, withholdingChecks: [{ artifactId: "b", expectedValid: false, actualValid: false }] },
      { fixtureId: "fb-origins", surface: "facebook", kind: "independent_origins", expectedValid: true, actualValid: true, withholdingChecks: [{ artifactId: "c", expectedValid: false, actualValid: false }] },
      { fixtureId: "negative", surface: "news", kind: "independent_origins", expectedValid: false, actualValid: false, withholdingChecks: [] },
    ]);
    expect(result).toMatchObject({
      pass: true,
      falseClosures: 0,
      falseRejections: 0,
      authorizesTargetedAcquisition: true,
      authorizesDevelopmentPromotion: false,
    });
  });

  it("fails on false closure, missing surfaces, or missing proof kinds", () => {
    const rows = ["a", "b", "c", "d"].map((fixtureId) => ({
      fixtureId,
      surface: "news" as const,
      kind: "answer" as const,
      expectedValid: fixtureId !== "d",
      actualValid: true,
      withholdingChecks: [{ artifactId: fixtureId, expectedValid: false, actualValid: true }],
    }));
    expect(evaluateInvestigationProofCompilerGate(rows)).toMatchObject({ pass: false, authorizesDevelopmentPromotion: false });
  });
});
