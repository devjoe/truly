import { describe, expect, it } from "vitest";

import {
  validateSinglePassInvestigationCeremony,
} from "../../scripts/lib/general-page-investigation-single-pass-ceremony.mjs";

const commit = "a".repeat(40);

function receipt(index, responseFormat) {
  const startedAt = new Date(Date.UTC(2026, 6, 30, 0, index, 0)).toISOString();
  const completedAt = new Date(Date.UTC(2026, 6, 30, 0, index, 30)).toISOString();
  const value = {
    schemaVersion: 3,
    task: "general_page_investigation_single_pass_synthetic_preflight",
    split: "synthetic-dev",
    passed: true,
    compatibility: "compatible",
    serviceProfile: "interactive",
    candidate: { commit, worktreeDirty: false },
    model: {
      endpoint: "http://model.test/v1",
      name: "qwen3.6-35b",
      responseFormat,
      concurrency: 2,
      timeoutMs: 60_000,
    },
    contract: {
      systemPromptSha256: "b".repeat(64),
      fixtureSetSha256: "c".repeat(64),
      schemaSha256: responseFormat === "json_schema" ? "d".repeat(64) : undefined,
      repairPolicy: "none_one_shot",
      protocolRetryPolicy: "disabled_for_release_gate",
    },
    data: {
      sampleCount: 30,
      sourceLanguages: { "zh-TW": 15, en: 15 },
      expectedPrimaryCount: 16,
      expectedExploratoryCount: 8,
      expectedNoneCount: 6,
    },
    counts: {
      protocolSucceeded: 30,
      protocolFailed: 0,
      oneShotRows: 30,
      primaryCorrect: 16,
      exploratoryCorrect: 7,
      exploratoryVisible: 8,
      noneCorrect: 6,
    },
    gates: {
      protocol: { pass: true },
      primaryCorrect: { pass: true },
      exploratoryCorrect: {
        pass: true,
        result: 7,
        visible: 8,
        byLanguage: { "zh-TW": 3, en: 4 },
      },
      noneCorrect: { pass: true },
      locale: { pass: true },
      candidatesAvailable: { pass: true },
    },
    diagnostics: {
      primaryUnderstated: 0,
      exploratoryOverstated: 1,
      exploratoryOverstatedSamples: ["synthetic-zh-04"],
    },
    performance: {
      composedLatency: {
        p95Ms: 12_000,
        maxMs: 18_000,
        interactiveP95Ms: 20_000,
        absoluteMaxMs: 40_000,
      },
    },
    networkBoundary: {
      modelRequests: 30,
      publicSearchRequests: 0,
      actionsOpened: 0,
    },
    startedAt,
    completedAt,
  };
  return {
    path: `/tmp/single-pass-${index}.json`,
    raw: JSON.stringify(value),
    value,
  };
}

function validReceipts() {
  return Array.from({ length: 6 }, (_, index) =>
    receipt(index, index < 3 ? "json_schema" : "json_object"));
}

describe("General Page single-pass Gate A ceremony", () => {
  it("binds six sequential passing receipts across both provider lowerings", () => {
    expect(validateSinglePassInvestigationCeremony(
      validReceipts(),
      commit,
    )).toMatchObject({
      passed: true,
      sourceCount: 6,
      formatCounts: { json_object: 3, json_schema: 3 },
      serviceProfiles: {
        json_object: "interactive",
        json_schema: "interactive",
      },
      errors: [],
    });
  });

  it("fails overlap, format imbalance, prompt drift, or candidate drift", () => {
    const receipts = validReceipts();
    receipts[1].value.startedAt = receipts[0].value.startedAt;
    receipts[1].value.completedAt = receipts[0].value.completedAt;
    receipts[2].value.candidate.worktreeDirty = true;
    receipts[4].value.model.responseFormat = "json_schema";
    receipts[5].value.contract.systemPromptSha256 = "e".repeat(64);

    const result = validateSinglePassInvestigationCeremony(receipts, commit);
    expect(result.passed).toBe(false);
    expect(result.errors.join(" ")).toMatch(/overlaps/);
    expect(result.errors.join(" ")).toMatch(/dirty worktree/);
    expect(result.errors.join(" ")).toMatch(/json_object requires 3/);
    expect(result.errors.join(" ")).toMatch(/prompt or fixture-set drift/);
  });

  it("fails capability, request-count, and rotating-overstatement defects", () => {
    const receipts = validReceipts();
    receipts[0].value.counts.primaryCorrect = 15;
    receipts[1].value.networkBoundary.modelRequests = 31;
    receipts[2].value.diagnostics.exploratoryOverstatedSamples = [
      "synthetic-en-04",
    ];

    const result = validateSinglePassInvestigationCeremony(receipts, commit);
    expect(result.passed).toBe(false);
    expect(result.errors.join(" ")).toMatch(/capability or hard boundary/);
    expect(result.errors.join(" ")).toMatch(/one-job request/);
    expect(result.errors.join(" ")).toMatch(/one-fixture exploratory variance/);
  });

  it("accepts background-deferred latency but rejects max over 40 seconds", () => {
    const deferred = validReceipts();
    for (const source of deferred.slice(3)) {
      source.value.serviceProfile = "background_deferred";
      source.value.performance.composedLatency.p95Ms = 27_000;
      source.value.performance.composedLatency.maxMs = 32_000;
    }
    expect(validateSinglePassInvestigationCeremony(
      deferred,
      commit,
    )).toMatchObject({
      passed: true,
      serviceProfiles: { json_object: "background_deferred" },
    });

    deferred[3].value.performance.composedLatency.maxMs = 40_001;
    expect(validateSinglePassInvestigationCeremony(
      deferred,
      commit,
    )).toMatchObject({
      passed: false,
      serviceProfiles: { json_object: "unqualified" },
    });
  });
});
