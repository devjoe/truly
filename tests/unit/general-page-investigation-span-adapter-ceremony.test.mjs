import { describe, expect, it } from "vitest";

import { validateSpanAdapterCeremony } from "../../scripts/lib/general-page-investigation-span-adapter-ceremony.mjs";

const commit = "a".repeat(40);

function receipt(index, responseFormat) {
  const startedAt = new Date(Date.UTC(2026, 6, 24, 0, index, 0)).toISOString();
  const completedAt = new Date(Date.UTC(2026, 6, 24, 0, index, 30)).toISOString();
  const value = {
    schemaVersion: 1,
    task: "general_page_investigation_span_adapter_synthetic_preflight",
    split: "synthetic-dev",
    passed: true,
    candidate: { commit, worktreeDirty: false },
    model: {
      endpoint: "http://model.test/v1",
      name: "qwen3.6-35b",
      responseFormat,
      concurrency: 2,
    },
    contract: {
      systemPromptSha256: "b".repeat(64),
      fixtureSetSha256: "c".repeat(64),
    },
    data: {
      sampleCount: 30,
      positiveCount: 20,
      softNegativeCount: 4,
      hardBoundaryCount: 6,
    },
    counts: {
      protocolSucceeded: 30,
      protocolFailed: 0,
      oneShotRows: 30,
      positivePrepared: 20,
      softNegativeAbstained: 2,
      hardBoundaryAbstained: 6,
    },
    gates: {
      protocol: { pass: true },
      positivePrepared: { pass: true },
      hardBoundaryAbstained: { pass: true },
      locale: { pass: true },
      candidatesAvailable: { pass: true },
    },
    diagnostics: {
      softNegativeAbstained: { result: 2, denominator: 4 },
    },
    networkBoundary: {
      modelRequests: 30,
      publicSearchRequests: 0,
      actionsOpened: 0,
    },
    startedAt,
    completedAt,
  };
  return { path: `/tmp/run-${index}.json`, raw: JSON.stringify(value), value };
}

function validReceipts() {
  return Array.from({ length: 6 }, (_, index) =>
    receipt(index, index < 3 ? "json_schema" : "json_object"));
}

describe("General Page span-adapter Gate A ceremony", () => {
  it("binds six sequential passing receipts across both lowerings", () => {
    const result = validateSpanAdapterCeremony(validReceipts(), commit);

    expect(result).toMatchObject({
      passed: true,
      sourceCount: 6,
      formats: { json_object: 3, json_schema: 3 },
      errors: [],
    });
    expect(result.sources).toHaveLength(6);
    expect(result.sources.every(({ sha256 }) => /^[a-f0-9]{64}$/u.test(sha256))).toBe(true);
  });

  it("fails on overlap, dirty snapshots, failed gates, or lowering imbalance", () => {
    const receipts = validReceipts();
    receipts[1].value.startedAt = receipts[0].value.startedAt;
    receipts[1].value.completedAt = receipts[0].value.completedAt;
    receipts[2].value.candidate.worktreeDirty = true;
    receipts[3].value.passed = false;
    receipts[5].value.model.responseFormat = "json_schema";

    const result = validateSpanAdapterCeremony(receipts, commit);

    expect(result.passed).toBe(false);
    expect(result.errors.join(" ")).toMatch(/overlaps/);
    expect(result.errors.join(" ")).toMatch(/dirty worktree/);
    expect(result.errors.join(" ")).toMatch(/source gate did not pass/);
    expect(result.errors.join(" ")).toMatch(/json_object requires 3/);
  });

  it("fails when positive capability or hard-boundary coverage is missing", () => {
    const receipts = validReceipts();
    receipts[0].value.counts.positivePrepared = 0;
    receipts[1].value.counts.hardBoundaryAbstained = 5;
    receipts[2].value.data.hardBoundaryCount = 5;
    receipts[3].value.diagnostics.softNegativeAbstained.denominator = 3;

    const result = validateSpanAdapterCeremony(receipts, commit);

    expect(result.passed).toBe(false);
    expect(result.errors.join(" ")).toMatch(/positive capability/);
    expect(result.errors.join(" ")).toMatch(/hard-boundary/);
    expect(result.errors.join(" ")).toMatch(/soft-negative diagnostic/);
  });
});
