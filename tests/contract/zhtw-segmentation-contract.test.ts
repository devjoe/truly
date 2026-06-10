import fs from "node:fs";
import { describe, expect, it } from "vitest";

import {
  buildZhtwTextSegments,
  type ZhtwSegmentSource,
  type ZhtwTextSegment,
} from "@src/lib/zhtw-review";

interface ZhtwSegmentFixture {
  id: string;
  description: string;
  input: ZhtwSegmentSource;
  expectedSegments: ZhtwTextSegment[];
}

const zhtwSegmentFixtures = JSON.parse(
  fs.readFileSync("tests/fixtures/zhtw/segmented-input-contract.json", "utf8"),
) as ZhtwSegmentFixture[];

describe("zhtw segmented-input public contract", () => {
  it.each(zhtwSegmentFixtures)("$id", (fixture) => {
    expect(buildZhtwTextSegments(fixture.input)).toEqual(fixture.expectedSegments);
  });
});
