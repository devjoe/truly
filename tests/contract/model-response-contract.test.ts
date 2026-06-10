import fs from "node:fs";
import { describe, expect, it } from "vitest";

import { parseCompactScores } from "@src/lib/ollama-client";
import {
  parseTierBDeepContent,
  parseTierBReadingBriefContent,
} from "@src/lib/tier-b-client";
import type { ReadingBrief } from "@src/lib/types";

interface TierACompactFixture {
  id: string;
  description: string;
  raw: string;
  customRules?: { id: string }[];
  expected: ReturnType<typeof parseCompactScores>;
}

interface TierBCompactFixture {
  id: string;
  description: string;
  model: string;
  raw: string;
  expected?: Record<string, unknown>;
  expectedError?: string;
}

interface ReadingBriefFixture {
  id: string;
  description: string;
  model: string;
  raw: string;
  expected?: Partial<ReadingBrief>;
  expectedError?: string;
}

const tierACompactFixtures = JSON.parse(
  fs.readFileSync("tests/fixtures/tier-a/compact-digits-contract.json", "utf8"),
) as TierACompactFixture[];

const tierBCompactFixtures = JSON.parse(
  fs.readFileSync("tests/fixtures/tier-b/compact-json-contract.json", "utf8"),
) as TierBCompactFixture[];

const readingBriefFixtures = JSON.parse(
  fs.readFileSync("tests/fixtures/tier-b/reading-brief-contract.json", "utf8"),
) as ReadingBriefFixture[];

describe("Tier A compact-digits public contract", () => {
  it.each(tierACompactFixtures)("$id", (fixture) => {
    expect(parseCompactScores(fixture.raw, fixture.customRules)).toEqual(fixture.expected);
  });
});

describe("Tier B compact JSON public contract", () => {
  it.each(tierBCompactFixtures)("$id", (fixture) => {
    const parsed = parseTierBDeepContent(fixture.raw, fixture.model);
    if (fixture.expectedError) {
      expect(parsed).toMatchObject({ ok: false, error: fixture.expectedError });
      return;
    }
    expect(parsed.ok).toBe(true);
    expect(parsed.value).toEqual(expect.objectContaining(fixture.expected ?? {}));
  });
});

describe("Tier B-2 reading brief public contract", () => {
  it.each(readingBriefFixtures)("$id", (fixture) => {
    const parsed = parseTierBReadingBriefContent(fixture.raw, fixture.model);
    if (fixture.expectedError) {
      expect(parsed).toMatchObject({ ok: false, error: fixture.expectedError });
      return;
    }
    expect(parsed.ok).toBe(true);
    expect(parsed.value).toEqual(expect.objectContaining(fixture.expected ?? {}));
  });
});
