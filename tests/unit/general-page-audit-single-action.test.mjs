import fs from "node:fs";
import { describe, expect, it } from "vitest";

describe("General Page UI audit single-action contract", () => {
  it("waits for the same one-action batch that the v5 runtime can reveal", () => {
    const source = fs.readFileSync(new URL("../../scripts/audit-general-page-reader.mjs", import.meta.url), "utf8");
    expect(source).toContain("const EXPECTED_INVESTIGATION_ACTION_COUNT = 1;");
    expect(source).not.toMatch(/investigationReadyCount === 3/u);
    expect(source).not.toMatch(/page-claim-investigation-actions'\)\.length === 3/u);
    expect(source).not.toMatch(/rowCount\s*[!=]==?\s*3/u);
    expect(source).not.toMatch(/count !== 3/u);
  });
});
