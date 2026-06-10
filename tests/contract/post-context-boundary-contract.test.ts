import fs from "node:fs";
import { describe, expect, it } from "vitest";

import {
  buildStructuredPostContext,
  buildTierBPostText,
  type StructuredPostContext,
} from "@src/lib/post-context";
import type { PostData } from "@src/lib/types";

interface FieldBoundaryFixture {
  id: string;
  description: string;
  input: Partial<PostData>;
  visibleText?: string;
  expectedContext: Partial<StructuredPostContext>;
  tierBIncludes?: string[];
  tierBExcludes?: string[];
  expectedZhtwSegments?: Array<{ kind: string; label: string; text: string }>;
}

const fieldBoundaryFixtures = JSON.parse(
  fs.readFileSync("tests/fixtures/post-context/field-boundary-cases.json", "utf8"),
) as FieldBoundaryFixture[];

function makePost(overrides: Partial<PostData>): PostData {
  return {
    id: "public-fixture-post",
    element: {} as HTMLElement,
    text: "public fixture body",
    authorName: "Example Author",
    hasMedia: false,
    ...overrides,
  };
}

describe("post-context public field-boundary contract", () => {
  it.each(fieldBoundaryFixtures)(
    "$id keeps source fields separated for Tier B and zhtw consumers",
    (fixture) => {
      const context = buildStructuredPostContext(fixture.input);
      expect(context).toEqual(expect.objectContaining(fixture.expectedContext));
      if (fixture.expectedZhtwSegments) {
        const zhtwSegments = context.sourceSegments
          .filter((segment) => segment.scanForZhtw)
          .map(({ kind, label, text }) => ({ kind, label, text }));
        expect(zhtwSegments).toEqual(fixture.expectedZhtwSegments);
      }

      const post = makePost(fixture.input);
      const visibleText = fixture.visibleText ?? fixture.input.fullText ?? fixture.input.text ?? "";
      const tierBText = buildTierBPostText(post, visibleText);
      for (const text of fixture.tierBIncludes ?? []) {
        expect(tierBText).toContain(text);
      }
      for (const text of fixture.tierBExcludes ?? []) {
        expect(tierBText).not.toContain(text);
      }
    },
  );
});
