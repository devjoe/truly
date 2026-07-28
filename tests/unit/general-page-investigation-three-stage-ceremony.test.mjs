import { describe, expect, it } from "vitest";

import {
  validateThreeStageInvestigationCeremony,
} from "../../scripts/lib/general-page-investigation-three-stage-ceremony.mjs";

const commit = "a".repeat(40);

function receipt(index, taskKey, responseFormat) {
  const startedAt = new Date(Date.UTC(2026, 6, 27, 0, index, 0)).toISOString();
  const completedAt = new Date(Date.UTC(2026, 6, 27, 0, index, 30)).toISOString();
  const admission = taskKey === "admission";
  const value = {
    schemaVersion: 1,
    task: admission
      ? "general_page_investigation_action_admission_synthetic_preflight"
      : "general_page_investigation_three_stage_synthetic_preflight",
    split: "synthetic-dev",
    passed: true,
    candidate: { commit, worktreeDirty: false },
    model: {
      endpoint: "http://model.test/v1",
      name: "qwen3.6-35b",
      responseFormat,
      concurrency: 2,
      timeoutMs: admission ? 10_000 : 60_000,
      ...(admission ? {} : {
        admissionTimeoutMs: 10_000,
        tierTimeoutMs: 10_000,
      }),
    },
    contract: {
      systemPromptSha256: admission ? "d".repeat(64) : "b".repeat(64),
      fixtureSetSha256: admission ? "e".repeat(64) : "c".repeat(64),
      repairPolicy: "none_one_shot",
      ...(admission
        ? {}
        : {
            admissionSystemPromptSha256: "d".repeat(64),
            tierSystemPromptSha256: "f".repeat(64),
            protocolRetryPolicy: "disabled_for_release_gate",
          }),
    },
    data: admission
      ? {
          sampleCount: 32,
          sourceLanguages: { "zh-TW": 16, en: 16 },
          expectedAdmit: 16,
          expectedReject: 16,
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
          protocolSucceeded: 32,
          protocolFailed: 0,
          correct: 32,
          incorrect: 0,
          admitCorrect: 16,
          rejectCorrect: 16,
        }
      : {
          protocolSucceeded: 30,
          protocolFailed: 0,
          oneShotRows: 30,
          primaryCorrect: 16,
          exploratoryCorrect: 7,
          exploratoryVisible: 8,
          noneCorrect: 6,
          admissionRequested: 24,
          admissionProtocolSucceeded: 24,
          admissionProtocolFailed: 0,
          tierRequested: 24,
          tierProtocolSucceeded: 24,
          tierProtocolFailed: 0,
        },
    ...(admission
      ? {}
      : {
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
            composedLatency: { pass: true },
          },
          diagnostics: {
            primaryUnderstated: 0,
            exploratoryOverstated: 1,
            exploratoryOverstatedSamples: ["synthetic-zh-04"],
          },
        }),
    networkBoundary: {
      modelRequests: admission ? 32 : 78,
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

describe("General Page three-stage Gate A ceremony", () => {
  it("binds twelve sequential passing receipts across both tasks and lowerings", () => {
    const result = validateThreeStageInvestigationCeremony(validReceipts(), commit);

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

    const result = validateThreeStageInvestigationCeremony(receipts, commit);

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
    receipts[7].value.diagnostics.exploratoryOverstated = 2;
    receipts[7].value.diagnostics.exploratoryOverstatedSamples = [
      "synthetic-zh-04",
      "synthetic-en-04",
    ];
    receipts[8].value.networkBoundary.modelRequests = 53;

    const result = validateThreeStageInvestigationCeremony(receipts, commit);

    expect(result.passed).toBe(false);
    expect(result.errors.join(" ")).toMatch(/32 of 32/);
    expect(result.errors.join(" ")).toMatch(/capability or hard boundary/);
    expect(result.errors.join(" ")).toMatch(/tier-confusion diagnostics/);
    expect(result.errors.join(" ")).toMatch(/request counts disagree/);
  });

  it("fails when the bounded exploratory miss rotates across fixture identities", () => {
    const receipts = validReceipts();
    receipts[6].value.diagnostics.exploratoryOverstatedSamples = ["synthetic-zh-04"];
    receipts[7].value.diagnostics.exploratoryOverstatedSamples = ["synthetic-en-04"];

    const result = validateThreeStageInvestigationCeremony(receipts, commit);

    expect(result.passed).toBe(false);
    expect(result.errors.join(" ")).toMatch(/one-fixture exploratory variance bound/);
  });

  it("keeps exploratory visibility distinct from the bounded tier allowance", () => {
    const receipts = validReceipts();
    receipts[6].value.counts.exploratoryCorrect = 7;
    receipts[6].value.counts.exploratoryVisible = 7;
    receipts[6].value.gates.exploratoryCorrect.result = 7;
    receipts[6].value.gates.exploratoryCorrect.visible = 7;

    const result = validateThreeStageInvestigationCeremony(receipts, commit);

    expect(result.passed).toBe(false);
    expect(result.errors.join(" ")).toMatch(/capability or hard boundary/);
    expect(result.errors.join(" ")).toMatch(/language floors or visibility disagree/);
  });
});
