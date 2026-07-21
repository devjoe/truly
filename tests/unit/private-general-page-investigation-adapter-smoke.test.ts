import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { describe, expect, it, vi } from "vitest";

import {
  INVESTIGATION_ADAPTER_PROTOCOL_SMOKE_CONCURRENCY,
  INVESTIGATION_ADAPTER_PROTOCOL_SMOKE_SAMPLE_COUNT,
  INVESTIGATION_ADAPTER_PROTOCOL_SMOKE_TASK,
  INVESTIGATION_ADAPTER_PROTOCOL_SMOKE_TIMEOUT_MS,
  assertInvestigationAdapterProtocolErrorCounts,
  assertInvestigationAdapterProtocolSmokeOutputPath,
  buildInvestigationAdapterProtocolSmokeFixtures,
  buildInvestigationAdapterProtocolSmokeManifest,
  installInvestigationAdapterProtocolSmokeNetworkGuard,
  writeInvestigationAdapterProtocolSmokeMeta,
} from "../../scripts/lib/private-general-page-investigation-adapter-smoke.mjs";

describe("private General Page Investigation Adapter protocol smoke", () => {
  it("uses exactly 30 fixed synthetic-only fixtures with balanced languages and risk shapes", () => {
    const fixtures = buildInvestigationAdapterProtocolSmokeFixtures();

    expect(fixtures).toHaveLength(INVESTIGATION_ADAPTER_PROTOCOL_SMOKE_SAMPLE_COUNT);
    expect(fixtures.filter((fixture) => fixture.language === "zh-TW")).toHaveLength(15);
    expect(fixtures.filter((fixture) => fixture.language === "en")).toHaveLength(15);
    for (const fixtureKind of ["prepared", "abstain", "attributed", "compound", "routine-fact"]) {
      expect(fixtures.filter((fixture) => fixture.fixtureKind === fixtureKind)).toHaveLength(6);
    }
    expect(new Set(fixtures.map((fixture) => fixture.sampleId))).toHaveLength(30);
    expect(fixtures.every((fixture) => fixture.dataCategory === "synthetic-only")).toBe(true);
    expect(fixtures.every((fixture) => new URL(fixture.source.url).hostname === "synthetic.example.test"))
      .toBe(true);
  });

  it("accepts only private-data/runs paths outside the public repo or under its tmp directory", () => {
    const publicRoot = path.resolve("/workspace/truly-public");
    const privateOutput = path.resolve("/workspace/truly-private-evals/private-data/runs/smoke/run.json");
    const tmpOutput = path.join(publicRoot, "tmp/private-data/runs/smoke/run.json");

    expect(assertInvestigationAdapterProtocolSmokeOutputPath(privateOutput, publicRoot)).toBe(privateOutput);
    expect(assertInvestigationAdapterProtocolSmokeOutputPath(tmpOutput, publicRoot)).toBe(tmpOutput);
    expect(() => assertInvestigationAdapterProtocolSmokeOutputPath(
      path.join(publicRoot, "private-data/runs/smoke/run.json"),
      publicRoot,
    )).toThrow(/outside the public repo or under tmp/);
    expect(() => assertInvestigationAdapterProtocolSmokeOutputPath(
      path.resolve("/workspace/truly-private-evals/runs/smoke/run.json"),
      publicRoot,
    )).toThrow(/under private-data\/runs/);
  });

  it("allows only the declared model completion endpoint and rejects redirects", async () => {
    const endpoint = "https://synthetic-model.example/v1";
    const expected = "https://synthetic-model.example/v1/chat/completions";
    const response = new Response("{}", { status: 200 });
    const fetchImpl = vi.fn(async () => response);
    const guarded = installInvestigationAdapterProtocolSmokeNetworkGuard(endpoint, fetchImpl);

    await expect(guarded(expected, { method: "POST" })).resolves.toBe(response);
    expect(fetchImpl).toHaveBeenCalledWith(expected, expect.objectContaining({
      method: "POST",
      redirect: "error",
    }));
    await expect(guarded("https://www.google.com/search?q=synthetic", {}))
      .rejects.toThrow(/blocked undeclared network target/);
    await expect(guarded("https://synthetic.example.test/en/01", {}))
      .rejects.toThrow(/blocked undeclared network target/);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("builds the frozen private v2 run-meta contract without per-sample output", () => {
    const fixtures = buildInvestigationAdapterProtocolSmokeFixtures();
    const outcomes = fixtures.map((_, index) => ({
      ok: true,
      decision: index < 18 ? "prepared" as const : "abstain" as const,
    }));
    const manifest = buildInvestigationAdapterProtocolSmokeManifest({
      runId: "adapter-protocol-smoke-v1",
      datasetVersion: "adapter-protocol-synthetic-v1",
      fixtures,
      outcomes,
      candidate: {
        commit: "a".repeat(40),
        coreSha256: "b".repeat(64),
        coreFileSha256: { "src/lib/tier-b-client.ts": "c".repeat(64) },
        worktreeDirty: false,
      },
      prompts: {
        contract: "standard",
        readingSystemSha256ByLanguage: { en: "d".repeat(64), "zh-TW": "e".repeat(64) },
        adapterSystemSha256ByLanguage: { en: "f".repeat(64), "zh-TW": "0".repeat(64) },
        combinedSha256: "1".repeat(64),
      },
      model: {
        provider: "openai-compatible",
        endpoint: "https://model-runtime.example.test/v1",
        name: "qwen3.6-35b",
        temperature: 0,
        adapterMaxTokens: 1800,
        timeoutMs: INVESTIGATION_ADAPTER_PROTOCOL_SMOKE_TIMEOUT_MS,
        concurrency: INVESTIGATION_ADAPTER_PROTOCOL_SMOKE_CONCURRENCY,
        responseFormat: "json_schema",
      },
      schemaSha256: "2".repeat(64),
      allowedCompletionsUrl: "https://model-runtime.example.test/v1/chat/completions",
      modelRequests: 30,
      startedAt: "2026-07-17T00:00:00.000Z",
      completedAt: "2026-07-17T00:01:00.000Z",
    });

    expect(manifest).toMatchObject({
      schemaVersion: 1,
      task: INVESTIGATION_ADAPTER_PROTOCOL_SMOKE_TASK,
      split: "dev",
      candidate: { worktreeDirty: false },
      prompts: { contract: "standard" },
      model: {
        name: "qwen3.6-35b",
        adapterMaxTokens: 1800,
        concurrency: 2,
        timeoutMs: 120_000,
        responseFormat: "json_schema",
      },
      adapter: { repairMode: "none", runtimeParity: true, schemaSha256: "2".repeat(64) },
      data: {
        syntheticOnly: true,
        sampleCount: 30,
        declaredCategories: ["synthetic-only"],
      },
      counts: {
        protocolSucceeded: 30,
        protocolFailed: 0,
        prepared: 18,
        abstained: 12,
        protocolErrorCounts: {},
      },
      networkBoundary: { modelRequests: 30, publicSearchRequests: 0, actionsOpened: 0 },
      artifacts: {
        fixtureSetSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
        inputSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
        resultSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
      },
    });
    expect(manifest).not.toHaveProperty("results");
    expect(manifest).not.toHaveProperty("raw");
  });

  it("accepts only known anonymous protocol error counts with an exact failed total", () => {
    expect(assertInvestigationAdapterProtocolErrorCounts({
      investigation_adapter_invalid_schema: 2,
      investigation_adapter_timeout: 1,
    }, 3)).toEqual({
      investigation_adapter_invalid_schema: 2,
      investigation_adapter_timeout: 1,
    });
    expect(() => assertInvestigationAdapterProtocolErrorCounts({ unknown_error: 1 }, 1))
      .toThrow(/Unknown protocol error code/);
    expect(() => assertInvestigationAdapterProtocolErrorCounts({
      investigation_adapter_http_error: 1,
    }, 2)).toThrow(/sum to protocolFailed/);
    expect(() => assertInvestigationAdapterProtocolErrorCounts({
      investigation_adapter_network_error: 0,
    }, 0)).toThrow(/positive integers/);
  });

  it("writes the private run meta once and refuses to clobber it", () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "truly-adapter-smoke-test-"));
    const outputPath = path.join(directory, "private-data/runs/run-v1/run.json");
    try {
      writeInvestigationAdapterProtocolSmokeMeta(outputPath, { schemaVersion: 1 });
      expect(JSON.parse(fs.readFileSync(outputPath, "utf8"))).toEqual({ schemaVersion: 1 });
      expect(() => writeInvestigationAdapterProtocolSmokeMeta(outputPath, { schemaVersion: 2 }))
        .toThrow(/EEXIST/);
      expect(JSON.parse(fs.readFileSync(outputPath, "utf8"))).toEqual({ schemaVersion: 1 });
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });
});
