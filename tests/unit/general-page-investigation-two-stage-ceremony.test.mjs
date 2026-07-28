import { describe, expect, it } from "vitest";

import {
  validateTwoStageInvestigationCeremony,
} from "../../scripts/lib/general-page-investigation-two-stage-ceremony.mjs";

const commit = "a".repeat(40);

function receipt(index, taskKey, responseFormat) {
  const startedAt = new Date(Date.UTC(2026, 6, 27, 0, index, 0)).toISOString();
  const completedAt = new Date(Date.UTC(2026, 6, 27, 0, index, 30)).toISOString();
  const admission = taskKey === "admission";
  const value = {
    schemaVersion: 1,
    task: admission
      ? "general_page_investigation_action_admission_synthetic_preflight"
      : "general_page_investigation_two_stage_synthetic_preflight",
    split: "synthetic-dev",
    passed: true,
    candidate: { commit, worktreeDirty: false },
    model: {
      endpoint: "http://model.test/v1",
      name: "qwen3.6-35b",
      responseFormat,
      concurrency: 2,
      timeoutMs: admission ? 10_000 : 60_000,
      ...(admission ? {} : { admissionTimeoutMs: 10_000 }),
    },
    contract: {
      systemPromptSha256: admission ? "d".repeat(64) : "b".repeat(64),
      fixtureSetSha256: admission ? "e".repeat(64) : "c".repeat(64),
      repairPolicy: "none_one_shot",
      ...(admission
        ? {}
        : {
            admissionSystemPromptSha256: "d".repeat(64),
            protocolRetryPolicy: "disabled_for_release_gate",
          }),
    },
    data: admission
      ? {
          sampleCount: 24,
          sourceLanguages: { "zh-TW": 12, en: 12 },
          expectedAdmit: 16,
          expectedReject: 8,
        }
      : {
          sampleCount: 30,
          sourceLanguages: { "zh-TW": 15, en: 15 },
          expectedPrimaryCount: 16,
          expectedExploratoryCount: 8,
          expectedNoneCount: 6,
        },
    counts: admission
      ? {
          protocolSucceeded: 24,
          protocolFailed: 0,
          correct: 24,
          incorrect: 0,
          admitCorrect: 16,
          rejectCorrect: 8,
        }
      : {
          protocolSucceeded: 30,
          protocolFailed: 0,
          oneShotRows: 30,
          primaryCorrect: 16,
          exploratoryCorrect: 8,
          noneCorrect: 6,
          admissionRequested: 24,
          admissionProtocolSucceeded: 24,
          admissionProtocolFailed: 0,
        },
    ...(admission
      ? {}
      : {
          gates: {
            protocol: { pass: true },
            primaryCorrect: { pass: true },
            exploratoryCorrect: { pass: true },
            noneCorrect: { pass: true },
            locale: { pass: true },
            candidatesAvailable: { pass: true },
            composedLatency: { pass: true },
          },
          diagnostics: {
            primaryUnderstated: 0,
            exploratoryOverstated: 0,
          },
        }),
    networkBoundary: {
      modelRequests: admission ? 24 : 54,
      publicSearchRequests: 0,
      actionsOpened: 0,
    },
    startedAt,
    completedAt,
  };
  return { path: `/tmp/${taskKey}-${index}.json`, raw: JSON.stringify(value), value };
}

function validReceipts() {
  const receipts = [];
  for (const taskKey of ["admission", "composed"]) {
    for (let index = 0; index < 6; index += 1) {
      receipts.push(receipt(
        receipts.length,
        taskKey,
        index < 3 ? "json_schema" : "json_object",
      ));
    }
  }
  return receipts;
}

describe("General Page two-stage Gate A ceremony", () => {
  it("binds twelve sequential passing receipts across both tasks and lowerings", () => {
    const result = validateTwoStageInvestigationCeremony(validReceipts(), commit);

    expect(result).toMatchObject({
      passed: true,
      sourceCount: 12,
      taskFormats: {
        "admission:json_object": 3,
        "admission:json_schema": 3,
        "composed:json_object": 3,
        "composed:json_schema": 3,
      },
      errors: [],
    });
    expect(result.sources).toHaveLength(12);
  });

  it("fails overlap, task imbalance, prompt drift, or candidate drift", () => {
    const receipts = validReceipts();
    receipts[1].value.startedAt = receipts[0].value.startedAt;
    receipts[1].value.completedAt = receipts[0].value.completedAt;
    receipts[2].value.candidate.worktreeDirty = true;
    receipts[4].value.model.responseFormat = "json_schema";
    receipts[6].value.contract.admissionSystemPromptSha256 = "f".repeat(64);

    const result = validateTwoStageInvestigationCeremony(receipts, commit);

    expect(result.passed).toBe(false);
    expect(result.errors.join(" ")).toMatch(/overlaps/);
    expect(result.errors.join(" ")).toMatch(/dirty worktree/);
    expect(result.errors.join(" ")).toMatch(/admission json_object requires 3/);
    expect(result.errors.join(" ")).toMatch(/composed prompt drift/);
  });

  it("fails task-specific count, boundary, or request mismatches", () => {
    const receipts = validReceipts();
    receipts[0].value.counts.admitCorrect = 15;
    receipts[6].value.counts.primaryCorrect = 15;
    receipts[7].value.diagnostics.exploratoryOverstated = 1;
    receipts[8].value.networkBoundary.modelRequests = 53;

    const result = validateTwoStageInvestigationCeremony(receipts, commit);

    expect(result.passed).toBe(false);
    expect(result.errors.join(" ")).toMatch(/24 of 24/);
    expect(result.errors.join(" ")).toMatch(/capability or hard boundary/);
    expect(result.errors.join(" ")).toMatch(/tier-confusion diagnostics/);
    expect(result.errors.join(" ")).toMatch(/request counts disagree/);
  });
});
