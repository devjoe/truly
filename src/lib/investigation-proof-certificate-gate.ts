export interface InvestigationProofCompilerFixtureResult {
  fixtureId: string;
  surface: "facebook" | "news";
  kind: "answer" | "independent_origins";
  expectedValid: boolean;
  actualValid: boolean;
  withholdingChecks: Array<{ artifactId: string; expectedValid: boolean; actualValid: boolean }>;
}

export interface InvestigationProofCompilerGateResult {
  pass: boolean;
  fixtureCount: number;
  positiveFixtures: number;
  negativeFixtures: number;
  withholdingChecks: number;
  falseClosures: number;
  falseRejections: number;
  surfaceCoverage: Array<"facebook" | "news">;
  kindCoverage: Array<"answer" | "independent_origins">;
  authorizesTargetedAcquisition: boolean;
  authorizesDevelopmentPromotion: false;
}

/** Contract-only gate. Passing authorizes a matched acquisition experiment, never product or development promotion. */
export function evaluateInvestigationProofCompilerGate(fixtures: InvestigationProofCompilerFixtureResult[]): InvestigationProofCompilerGateResult {
  if (fixtures.length < 4 || new Set(fixtures.map((fixture) => fixture.fixtureId)).size !== fixtures.length) {
    throw new Error("Proof compiler gate requires at least four unique fixtures");
  }
  const falseClosures = fixtures.filter((fixture) => !fixture.expectedValid && fixture.actualValid).length +
    fixtures.flatMap((fixture) => fixture.withholdingChecks).filter((check) => !check.expectedValid && check.actualValid).length;
  const falseRejections = fixtures.filter((fixture) => fixture.expectedValid && !fixture.actualValid).length +
    fixtures.flatMap((fixture) => fixture.withholdingChecks).filter((check) => check.expectedValid && !check.actualValid).length;
  const surfaceCoverage = [...new Set(fixtures.filter((fixture) => fixture.expectedValid).map((fixture) => fixture.surface))];
  const kindCoverage = [...new Set(fixtures.filter((fixture) => fixture.expectedValid).map((fixture) => fixture.kind))];
  const withholdingChecks = fixtures.reduce((sum, fixture) => sum + fixture.withholdingChecks.length, 0);
  const positiveFixtures = fixtures.filter((fixture) => fixture.expectedValid).length;
  const negativeFixtures = fixtures.length - positiveFixtures;
  const pass = positiveFixtures >= 3 && negativeFixtures >= 1 && withholdingChecks >= 3 &&
    surfaceCoverage.length === 2 && kindCoverage.length === 2 && falseClosures === 0 && falseRejections === 0;
  return {
    pass,
    fixtureCount: fixtures.length,
    positiveFixtures,
    negativeFixtures,
    withholdingChecks,
    falseClosures,
    falseRejections,
    surfaceCoverage,
    kindCoverage,
    authorizesTargetedAcquisition: pass,
    authorizesDevelopmentPromotion: false,
  };
}
