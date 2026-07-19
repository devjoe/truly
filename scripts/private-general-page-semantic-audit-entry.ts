import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { execFileSync } from "node:child_process";

import { buildGeneralPageInvestigationAdapterBatchSystemPrompt } from "../src/lib/general-page-investigation-adapter";
import { buildGeneralPageModelContext } from "../src/lib/general-page-model-context";
import {
  buildTierBGeneralPageBriefChatBody,
  buildTierBGeneralPageInvestigationAdapterBatchChatBody,
  callTierBGeneralPageBrief,
  callTierBGeneralPageInvestigationAdapterBatch,
  type TierBChatBody,
  type TierBGeneralPageInvestigationAdapterBatchRequest,
} from "../src/lib/tier-b-client";
import type { ReadingSurface } from "../src/lib/reading-surface-types";
import type { Lang } from "../src/lib/types";
import {
  assertPrivateSemanticAuditCandidateSnapshot,
  assertPrivateSemanticAuditFetchTarget,
  hashPrivateSemanticAuditCoreFiles,
  installPrivateSemanticAuditNetworkGuard,
  privateSemanticAuditAdapterManifestMetadata,
  privateSemanticAuditAdapterModelMetadata,
  privateSemanticAuditAdapterResponseFormat,
  privateSemanticAuditReadingManifestMetadata,
  privateSemanticAuditReadingResponseFormat,
  privateSemanticAuditRepairMode,
  semanticAuditCompletionsUrl,
  sha256Text,
} from "./lib/private-general-page-semantic-audit.mjs";
import {
  assertPrivateEvalPaths,
  outputLanguageForPrivateEval,
  parsePrivateEvalJsonl,
  privateEvalInputErrors,
} from "./lib/private-general-page-eval.mjs";
import {
  buildPrivateSemanticAuditQuestionActions,
  projectPrivateSemanticAuditAdapterBatch,
} from "./private-general-page-semantic-audit-projection";

interface InputRow {
  sampleId: string;
  surface: "facebook" | "news";
  dataCategory?: string;
  language: "zh-TW" | "en";
  sourceSha256: string;
  text: string;
  sourceContext?: {
    title?: string;
    sourceName?: string;
    publishedAt?: string;
    url?: string;
  };
}

function option(name: string, fallback?: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

function required(name: string): string {
  const value = option(name);
  if (!value) throw new Error(`Missing ${name}`);
  return value;
}

function compactIdentifier(name: string, value: string): string {
  if (!/^[a-z0-9][a-z0-9._-]{2,80}$/i.test(value)) throw new Error(`Invalid ${name}`);
  return value;
}

function surfaceFor(row: InputRow): ReadingSurface {
  const fallbackUrl = row.surface === "facebook"
    ? "https://www.facebook.com/private-evaluation"
    : "https://news.example.test/private-evaluation";
  const url = row.sourceContext?.url || fallbackUrl;
  return {
    id: row.sampleId,
    kind: "web-page",
    source: "general",
    url,
    canonicalUrl: row.sourceContext?.url,
    title: row.sourceContext?.title,
    sourceName: row.sourceContext?.sourceName,
    publishedAt: row.sourceContext?.publishedAt,
    mainText: row.text,
    links: [],
    images: [],
    extraction: { method: "semantic-html", status: "complete", warnings: [] },
  };
}

function bodyPromptHashes(body: TierBChatBody): {
  systemSha256: string;
  userSha256: string;
  bodySha256: string;
} {
  const system = body.messages.find((message) => message.role === "system")?.content ?? "";
  const user = body.messages.find((message) => message.role === "user")?.content ?? "";
  return {
    systemSha256: sha256Text(typeof system === "string" ? system : JSON.stringify(system)),
    userSha256: sha256Text(typeof user === "string" ? user : JSON.stringify(user)),
    bodySha256: sha256Text(JSON.stringify(body)),
  };
}

function sourceLanguage(text: string, fallback: Lang): Lang {
  const latinCount = (text.match(/[A-Za-z]/g) ?? []).length;
  const hanCount = (text.match(/\p{Script=Han}/gu) ?? []).length;
  const counted = latinCount + hanCount;
  if (latinCount >= 24 && counted > 0 && latinCount / counted >= 0.7) return "en";
  if (hanCount >= 4) return "zh-TW";
  return fallback;
}

function gitOutput(repoRoot: string, args: string[]): string {
  return execFileSync("git", args, { cwd: repoRoot, encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
}

if (!process.argv.includes("--confirm-private-data-send")) {
  throw new Error("Missing --confirm-private-data-send");
}

const inputPath = required("--input");
const outputPath = required("--output");
const metaOutputPath = required("--meta-output");
const endpoint = required("--endpoint");
const model = compactIdentifier("--model", required("--model"));
const split = required("--split");
const runId = compactIdentifier("--run-id", required("--run-id"));
const datasetVersion = compactIdentifier("--dataset-version", required("--dataset-version"));
const expectedCandidateCommit = required("--expected-candidate-commit");
const expectedTrackedDiffSha256 = required("--expected-tracked-diff-sha256");
const declaredCategories = required("--data-categories");
const expectedCount = Number(required("--sample-count"));
const concurrency = Math.max(1, Math.min(4, Number(option("--concurrency", "2")) || 2));
const timeoutMs = Math.max(1_000, Math.min(120_000, Number(option("--timeout-ms", "45_000")) || 45_000));
const repairMode = privateSemanticAuditRepairMode(process.argv);
const readingResponseFormat = privateSemanticAuditReadingResponseFormat(process.argv);
const adapterResponseFormat = privateSemanticAuditAdapterResponseFormat(process.argv);
const adapterModelMetadata = privateSemanticAuditAdapterModelMetadata(adapterResponseFormat);
const adapterMaxTokens = adapterModelMetadata.adapterMaxTokens;
const adapterProtocolBody = buildTierBGeneralPageInvestigationAdapterBatchChatBody({
  endpoint,
  model,
  structuredOutputMode: adapterResponseFormat,
  candidateClaims: [{
    c: "Protocol schema hash fixture.",
    why: "Protocol metadata only.",
    need: "Protocol contract fixture document.",
    q: "What is the protocol schema hash fixture?",
  }],
  groundingText: "Protocol schema hash fixture.",
  sourceLang: "en",
  outputLang: "en",
});
const adapterManifestMetadata = privateSemanticAuditAdapterManifestMetadata(
  adapterResponseFormat,
  adapterProtocolBody.response_format,
);
if (split !== "dev" && split !== "holdout") throw new Error("--split must be dev or holdout");

const allowedCompletionsUrl = semanticAuditCompletionsUrl(endpoint);
assertPrivateSemanticAuditFetchTarget(allowedCompletionsUrl, endpoint);
const paths = assertPrivateEvalPaths(inputPath, outputPath, metaOutputPath, process.cwd());
if (fs.existsSync(paths.output) || fs.existsSync(paths.metaOutput)) {
  throw new Error("Private semantic audit output already exists; an evaluation path may run only once");
}
const inputFile = fs.readFileSync(paths.input, "utf8");
const inputSha256 = sha256Text(inputFile);
const rows = parsePrivateEvalJsonl(inputFile) as InputRow[];
const inputErrors = privateEvalInputErrors(rows, expectedCount, declaredCategories);
if (inputErrors.length > 0) throw new Error(inputErrors.join("; "));
const contextErrors = rows.flatMap((row, index) => {
  const context = buildGeneralPageModelContext(surfaceFor(row));
  return context.modelEligible ? [] : [`line ${index + 1}: ${context.ineligibilityReason || "model_ineligible"}`];
});
if (contextErrors.length > 0) throw new Error(contextErrors.join("; "));
const repoRoot = gitOutput(process.cwd(), ["rev-parse", "--show-toplevel"]).trim();
const candidateCommit = gitOutput(repoRoot, ["rev-parse", "HEAD"]).trim();
const worktreeStatus = gitOutput(repoRoot, ["status", "--porcelain=v1", "--untracked-files=all"]);
const trackedDiff = gitOutput(repoRoot, ["diff", "--binary", "HEAD"]);
const candidateSnapshot = assertPrivateSemanticAuditCandidateSnapshot({
  actualCommit: candidateCommit,
  actualTrackedDiff: trackedDiff,
  expectedCommit: expectedCandidateCommit,
  expectedTrackedDiffSha256,
});
if (process.argv.includes("--preflight-only")) {
  console.log(JSON.stringify({
    result: "preflight_pass",
    samples: rows.length,
    candidateSnapshot,
    modelRequests: 0,
    publicSearchRequests: 0,
  }, null, 2));
  process.exit(0);
}
const core = hashPrivateSemanticAuditCoreFiles(repoRoot);
const languages = [...new Set(rows.map((row) => outputLanguageForPrivateEval(row.language) as Lang))].sort();
const firstReadingRow = rows[0];
if (!firstReadingRow) throw new Error("Private semantic audit requires at least one input row");
const firstReadingBody = buildTierBGeneralPageBriefChatBody({
  endpoint,
  model,
  context: buildGeneralPageModelContext(surfaceFor(firstReadingRow)),
  allowedUse: "article_or_selection_analysis",
  outputLang: outputLanguageForPrivateEval(firstReadingRow.language) as Lang,
  contract: "standard",
  structuredOutputMode: readingResponseFormat,
});
const readingMaxTokens = firstReadingBody.max_tokens;
const readingManifestMetadata = privateSemanticAuditReadingManifestMetadata(
  readingResponseFormat,
  firstReadingBody.response_format,
);
const readingSystemSha256ByLanguage = Object.fromEntries(languages.map((language) => {
  const row = rows.find((candidate) => outputLanguageForPrivateEval(candidate.language) === language);
  if (!row) throw new Error(`Missing prompt row for ${language}`);
  const body = buildTierBGeneralPageBriefChatBody({
    endpoint,
    model,
    context: buildGeneralPageModelContext(surfaceFor(row)),
    allowedUse: "article_or_selection_analysis",
    outputLang: language,
    contract: "standard",
    structuredOutputMode: readingResponseFormat,
  });
  return [language, bodyPromptHashes(body).systemSha256];
}));
const adapterSystemSha256ByLanguage = Object.fromEntries(languages.map((language) => [
  language,
  sha256Text(buildGeneralPageInvestigationAdapterBatchSystemPrompt(language, language)),
]));
const combinedPromptSha256 = sha256Text(JSON.stringify({
  readingSystemSha256ByLanguage,
  adapterSystemSha256ByLanguage,
}));
const startedAt = new Date().toISOString();
const results = new Array<Record<string, unknown>>(rows.length);
let cursor = 0;
let modelRequestCount = 0;

async function evaluateRow(row: InputRow): Promise<Record<string, unknown>> {
  const outputLang = outputLanguageForPrivateEval(row.language) as Lang;
  const surface = surfaceFor(row);
  const context = buildGeneralPageModelContext(surface);
  const readingBody = buildTierBGeneralPageBriefChatBody({
    endpoint,
    model,
    context,
    allowedUse: "article_or_selection_analysis",
    outputLang,
    contract: "standard",
    structuredOutputMode: readingResponseFormat,
  });
  const readingPrompt = bodyPromptHashes(readingBody);
  const base = {
    schemaVersion: 1,
    sampleId: row.sampleId,
    surface: row.surface,
    dataCategory: row.dataCategory || `${row.surface}-original`,
    sourceSha256: row.sourceSha256,
  };
  if (!context.modelEligible) {
    return {
      ...base,
      ok: false,
      pipelineStatus: "reading_ineligible",
      reading: { ok: false, error: context.ineligibilityReason, prompt: readingPrompt },
      adapter: { status: "not_requested", reason: "reading_ineligible" },
      questionActions: [],
    };
  }

  const readingStarted = Date.now();
  const reading = await callTierBGeneralPageBrief({
    endpoint,
    model,
    apiKey: process.env.TRULY_PRIVATE_EVAL_API_KEY,
    context,
    allowedUse: "article_or_selection_analysis",
    outputLang,
    contract: "standard",
    structuredOutputMode: readingResponseFormat,
    timeoutMs,
  });
  if (!reading.ok || !reading.brief) {
    return {
      ...base,
      ok: false,
      pipelineStatus: "reading_failed",
      reading: {
        ok: false,
        latencyMs: Date.now() - readingStarted,
        error: reading.error || "model_error",
        attempts: reading.attempts,
        finishReason: reading.finishReason,
        usage: reading.usage,
        raw: reading.raw,
        prompt: readingPrompt,
      },
      adapter: { status: "not_requested", reason: "reading_failed" },
      questionActions: [],
    };
  }

  const brief = reading.brief;
  const questionActions = buildPrivateSemanticAuditQuestionActions({
    brief,
    lang: outputLang,
    source: {
      title: row.sourceContext?.title,
      summary: brief.summary,
      url: row.sourceContext?.url,
    },
  });
  const candidateClaims = brief.claims?.slice(0, 3) ?? [];
  if (!candidateClaims.length) {
    return {
      ...base,
      ok: true,
      pipelineStatus: "no_claim",
      reading: {
        ok: true,
        latencyMs: Date.now() - readingStarted,
        attempts: reading.attempts,
        formatRecovered: reading.formatRecovered,
        finishReason: reading.finishReason,
        usage: reading.usage,
        brief,
        raw: reading.raw,
        prompt: readingPrompt,
      },
      adapter: { status: "not_requested", reason: "no_claim" },
      investigationTask: null,
      investigationTasks: [],
      questionActions,
    };
  }

  const adapterSourceLang = sourceLanguage(row.text, outputLang);
  const adapterRequest: TierBGeneralPageInvestigationAdapterBatchRequest = {
    endpoint,
    model,
    structuredOutputMode: adapterResponseFormat,
    apiKey: process.env.TRULY_PRIVATE_EVAL_API_KEY,
    timeoutMs,
    candidateClaims,
    groundingText: row.text,
    source: row.sourceContext,
    sourceLang: adapterSourceLang,
    outputLang,
  };
  const adapterPrompt = bodyPromptHashes(buildTierBGeneralPageInvestigationAdapterBatchChatBody(adapterRequest));
  const adapterStarted = Date.now();
  const adapter = await callTierBGeneralPageInvestigationAdapterBatch(adapterRequest);
  if (!adapter.ok || !adapter.value) {
    return {
      ...base,
      ok: false,
      pipelineStatus: "adapter_failed",
      reading: {
        ok: true,
        latencyMs: adapterStarted - readingStarted,
        attempts: reading.attempts,
        formatRecovered: reading.formatRecovered,
        finishReason: reading.finishReason,
        usage: reading.usage,
        brief,
        raw: reading.raw,
        prompt: readingPrompt,
      },
      adapter: {
        status: "failed",
        latencyMs: Date.now() - adapterStarted,
        error: adapter.error || "model_error",
        rawAvailable: false,
        prompt: adapterPrompt,
        attempts: 1,
      },
      investigationTask: null,
      investigationTasks: [],
      questionActions,
    };
  }

  const projection = projectPrivateSemanticAuditAdapterBatch({
    batch: adapter.value,
    analysisKey: row.sampleId,
    groundingText: row.text,
    source: row.sourceContext,
  });
  return {
    ...base,
    ok: true,
    pipelineStatus: projection.pipelineStatus,
    reading: {
      ok: true,
      latencyMs: adapterStarted - readingStarted,
      attempts: reading.attempts,
      formatRecovered: reading.formatRecovered,
      finishReason: reading.finishReason,
      usage: reading.usage,
      brief,
      raw: reading.raw,
      prompt: readingPrompt,
    },
    adapter: {
      status: "batch_completed",
      latencyMs: Date.now() - adapterStarted,
      value: adapter.value,
      rawAvailable: false,
      prompt: adapterPrompt,
      attempts: 1,
    },
    preparations: projection.preparations,
    investigationTask: projection.investigationTasks[0] ?? null,
    investigationTasks: projection.investigationTasks,
    ...(projection.localGuardReasons.length > 0
      ? { localGuardReasons: projection.localGuardReasons }
      : {}),
    questionActions,
  };
}

async function worker(): Promise<void> {
  while (true) {
    const index = cursor++;
    if (index >= rows.length) return;
    results[index] = await evaluateRow(rows[index]);
  }
}

const originalFetch = globalThis.fetch;
const guardedFetch = installPrivateSemanticAuditNetworkGuard(endpoint, originalFetch.bind(globalThis));
globalThis.fetch = (async (input, init) => {
  modelRequestCount += 1;
  return guardedFetch(input, init);
}) as typeof fetch;
try {
  await Promise.all(Array.from({ length: Math.min(concurrency, rows.length) }, () => worker()));
} finally {
  globalThis.fetch = originalFetch;
}

const count = (status: string): number => results.filter((result) => result.pipelineStatus === status).length;
const categoryCounts = Object.fromEntries([...new Set(rows.map((row) => row.dataCategory || `${row.surface}-original`))]
  .sort()
  .map((category) => [category, rows.filter((row) => (row.dataCategory || `${row.surface}-original`) === category).length]));
const completedAt = new Date().toISOString();
fs.mkdirSync(path.dirname(paths.output), { recursive: true, mode: 0o700 });
const resultsFile = `${results.map((result) => JSON.stringify(result)).join("\n")}\n`;
const resultsSha256 = sha256Text(resultsFile);
fs.writeFileSync(paths.output, resultsFile, { flag: "wx", mode: 0o600 });
const manifest = {
  schemaVersion: 1,
  task: "general_page_product_semantic_audit",
  runId,
  datasetVersion,
  split,
  candidate: {
    commit: candidateCommit,
    snapshotVerified: true,
    coreSha256: core.coreSha256,
    coreFileSha256: core.fileSha256,
    worktreeDirty: worktreeStatus.length > 0,
    worktreeStatusSha256: sha256Text(worktreeStatus),
    trackedDiffSha256: trackedDiff ? sha256Text(trackedDiff) : undefined,
  },
  prompts: {
    contract: "standard",
    readingSystemSha256ByLanguage,
    adapterSystemSha256ByLanguage,
    combinedSha256: combinedPromptSha256,
  },
  model: {
    provider: "openai-compatible",
    endpoint,
    name: model,
    temperature: 0,
    readingMaxTokens,
    ...adapterModelMetadata,
    timeoutMs,
    concurrency,
  },
  reading: {
    contract: "truly-general-page-brief-v1",
    ...readingManifestMetadata,
  },
  adapter: {
    repairMode,
    runtimeParity: repairMode === "none",
    ...adapterManifestMetadata,
  },
  data: {
    sampleCount: rows.length,
    declaredCategories: declaredCategories.split(",").map((value) => value.trim()).filter(Boolean).sort(),
    categoryCounts,
  },
  counts: {
    readingSucceeded: results.filter((result) => result.reading && (result.reading as { ok?: boolean }).ok).length,
    readingFailed: count("reading_failed") + count("reading_ineligible"),
    readingTruncated: results.filter((result) =>
      (result.reading as { error?: string } | undefined)?.error === "general_page_brief_truncated"
    ).length,
    noClaim: count("no_claim"),
    adapterRequested: results.filter((result) => !["no_claim", "reading_failed", "reading_ineligible"].includes(String(result.pipelineStatus))).length,
    adapterFailed: count("adapter_failed"),
    adapterAbstained: count("adapter_abstained"),
    localGuardRejected: count("local_guard_rejected"),
    actionReady: count("action_ready"),
    questionActions: results.reduce((sum, result) => sum + (Array.isArray(result.questionActions) ? result.questionActions.length : 0), 0),
  },
  networkBoundary: {
    allowedCompletionsUrl,
    redirects: "error",
    modelRequests: modelRequestCount,
    publicSearchRequests: 0,
    actionsOpened: 0,
  },
  rawOutputPolicy: {
    outputPrivate: true,
    readingRawRecordedWhenAvailable: true,
    adapterRawExposedByRuntimeHelper: false,
    adapterParsedValueAndPromptHashesRecorded: true,
  },
  artifacts: {
    inputSha256,
    resultsSha256,
  },
  startedAt,
  completedAt,
};
fs.writeFileSync(paths.metaOutput, `${JSON.stringify(manifest, null, 2)}\n`, { flag: "wx", mode: 0o600 });
console.log(JSON.stringify({
  result: results.every((result) => result.ok) ? "pass" : "partial",
  runId,
  split,
  repairMode,
  adapterResponseFormat,
  readingResponseFormat,
  adapterMaxTokens,
  samples: rows.length,
  ...manifest.counts,
  publicSearchRequests: 0,
  output: "private-eval/<private>",
}, null, 2));
