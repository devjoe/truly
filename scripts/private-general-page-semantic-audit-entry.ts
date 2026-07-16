import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { execFileSync } from "node:child_process";

import { buildGeneralPageInvestigationAdapterSystemPrompt } from "../src/lib/general-page-investigation-adapter";
import { buildGeneralPageModelContext } from "../src/lib/general-page-model-context";
import {
  buildTierBGeneralPageBriefChatBody,
  buildTierBGeneralPageInvestigationAdapterChatBody,
  callTierBGeneralPageBrief,
  callTierBGeneralPageInvestigationAdapter,
  type TierBChatBody,
  type TierBGeneralPageInvestigationAdapterRequest,
} from "../src/lib/tier-b-client";
import type { ReadingSurface } from "../src/lib/reading-surface-types";
import type { Lang } from "../src/lib/types";
import {
  isRepairablePageClaimIneligibilityReason,
  preparePageClaimInvestigation,
} from "../src/sidepanel/page-claim-investigation";
import {
  assertPrivateSemanticAuditFetchTarget,
  hashPrivateSemanticAuditCoreFiles,
  installPrivateSemanticAuditNetworkGuard,
  privateSemanticAuditAdapterManifestMetadata,
  privateSemanticAuditAdapterModelMetadata,
  privateSemanticAuditAdapterResponseFormat,
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
import { buildPrivateSemanticAuditQuestionActions } from "./private-general-page-semantic-audit-projection";

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
const declaredCategories = required("--data-categories");
const expectedCount = Number(required("--sample-count"));
const concurrency = Math.max(1, Math.min(4, Number(option("--concurrency", "2")) || 2));
const timeoutMs = Math.max(1_000, Math.min(120_000, Number(option("--timeout-ms", "45_000")) || 45_000));
const repairMode = privateSemanticAuditRepairMode(process.argv);
const adapterResponseFormat = privateSemanticAuditAdapterResponseFormat(process.argv);
const adapterModelMetadata = privateSemanticAuditAdapterModelMetadata(adapterResponseFormat);
const adapterMaxTokens = adapterModelMetadata.adapterMaxTokens;
const adapterProtocolBody = buildTierBGeneralPageInvestigationAdapterChatBody({
  endpoint,
  model,
  structuredOutputMode: adapterResponseFormat,
  candidateClaim: {
    c: "Protocol schema hash fixture.",
    why: "Protocol metadata only.",
    need: "Protocol metadata only.",
    q: "What is the protocol schema hash fixture?",
  },
  groundingText: "Protocol schema hash fixture.",
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

const repoRoot = gitOutput(process.cwd(), ["rev-parse", "--show-toplevel"]).trim();
const candidateCommit = gitOutput(repoRoot, ["rev-parse", "HEAD"]).trim();
const worktreeStatus = gitOutput(repoRoot, ["status", "--porcelain=v1", "--untracked-files=all"]);
const trackedDiff = gitOutput(repoRoot, ["diff", "--binary", "HEAD"]);
const core = hashPrivateSemanticAuditCoreFiles(repoRoot);
const languages = [...new Set(rows.map((row) => outputLanguageForPrivateEval(row.language) as Lang))].sort();
const readingSystemSha256ByLanguage = Object.fromEntries(languages.map((language) => {
  const row = rows.find((candidate) => outputLanguageForPrivateEval(candidate.language) === language);
  if (!row) throw new Error(`Missing prompt row for ${language}`);
  const body = buildTierBGeneralPageBriefChatBody({
    endpoint,
    model,
    context: buildGeneralPageModelContext(surfaceFor(row)),
    allowedUse: "page_full_text",
    outputLang: language,
    contract: "standard",
  });
  return [language, bodyPromptHashes(body).systemSha256];
}));
const adapterSystemSha256ByLanguage = Object.fromEntries(languages.map((language) => [
  language,
  sha256Text(buildGeneralPageInvestigationAdapterSystemPrompt(language)),
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
    allowedUse: "page_full_text",
    outputLang,
    contract: "standard",
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
    allowedUse: "page_full_text",
    outputLang,
    contract: "standard",
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
  const claim = brief.claims?.[0];
  if (!claim) {
    return {
      ...base,
      ok: true,
      pipelineStatus: "no_claim",
      reading: {
        ok: true,
        latencyMs: Date.now() - readingStarted,
        attempts: reading.attempts,
        formatRecovered: reading.formatRecovered,
        brief,
        raw: reading.raw,
        prompt: readingPrompt,
      },
      adapter: { status: "not_requested", reason: "no_claim" },
      investigationTask: null,
      questionActions,
    };
  }

  const adapterOutputLang = sourceLanguage(row.text, outputLang);
  const adapterRequest: TierBGeneralPageInvestigationAdapterRequest = {
    endpoint,
    model,
    structuredOutputMode: adapterResponseFormat,
    apiKey: process.env.TRULY_PRIVATE_EVAL_API_KEY,
    timeoutMs,
    candidateClaim: claim,
    groundingText: row.text,
    source: row.sourceContext,
    outputLang: adapterOutputLang,
  };
  const adapterPrompt = bodyPromptHashes(buildTierBGeneralPageInvestigationAdapterChatBody(adapterRequest));
  const adapterStarted = Date.now();
  let adapter = await callTierBGeneralPageInvestigationAdapter(adapterRequest);
  let adapterAttempts: 1 | 2 = 1;
  let repairReason: TierBGeneralPageInvestigationAdapterRequest["repairReason"];
  let repairPrompt: ReturnType<typeof bodyPromptHashes> | undefined;
  const firstPreparedClaim = adapter.ok && adapter.value?.decision === "prepared" ? adapter.value.claim : undefined;
  if (firstPreparedClaim) {
    const firstPreparation = preparePageClaimInvestigation({
      analysisKey: row.sampleId,
      scope: "page",
      claimIndex: 0,
      claim: firstPreparedClaim,
      groundingText: row.text,
      source: row.sourceContext,
    });
    const firstReason = firstPreparation.decision === "rejected" ? firstPreparation.reason : undefined;
    if (repairMode === "semantic_once" && firstReason && isRepairablePageClaimIneligibilityReason(firstReason)) {
      repairReason = firstReason;
      const repairRequest: TierBGeneralPageInvestigationAdapterRequest = {
        ...adapterRequest,
        candidateClaim: firstPreparedClaim,
        repairReason,
      };
      repairPrompt = bodyPromptHashes(buildTierBGeneralPageInvestigationAdapterChatBody(repairRequest));
      adapter = await callTierBGeneralPageInvestigationAdapter(repairRequest);
      adapterAttempts = 2;
    }
  }
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
        attempts: adapterAttempts,
        ...(repairReason ? { repairReason, repairPrompt } : {}),
      },
      investigationTask: null,
      questionActions,
    };
  }

  const preparedClaim = adapter.value.decision === "prepared" ? adapter.value.claim : undefined;
  const preparation = preparedClaim
    ? preparePageClaimInvestigation({
        analysisKey: row.sampleId,
        scope: "page",
        claimIndex: 0,
        claim: preparedClaim,
        groundingText: row.text,
        source: row.sourceContext,
      })
    : undefined;
  const investigationTask = preparation?.decision === "prepared" ? preparation.task : undefined;
  const localGuardReason = preparation?.decision === "rejected" ? preparation.reason : undefined;
  return {
    ...base,
    ok: true,
    pipelineStatus: adapter.value.decision === "abstain"
      ? "adapter_abstained"
      : investigationTask
      ? "action_ready"
      : "local_guard_rejected",
    reading: {
      ok: true,
      latencyMs: adapterStarted - readingStarted,
      attempts: reading.attempts,
      formatRecovered: reading.formatRecovered,
      brief,
      raw: reading.raw,
      prompt: readingPrompt,
    },
    adapter: {
      status: adapter.value.decision,
      latencyMs: Date.now() - adapterStarted,
      value: adapter.value,
      rawAvailable: false,
      prompt: adapterPrompt,
      attempts: adapterAttempts,
      ...(repairReason ? { repairReason, repairPrompt } : {}),
    },
    preparation: preparation
      ? {
          decision: preparation.decision,
          canonicalizations: preparation.canonicalizations,
          ...(preparation.decision === "rejected" ? { reason: preparation.reason } : {}),
        }
      : null,
    investigationTask: investigationTask ?? null,
    ...(localGuardReason ? { localGuardReason } : {}),
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
    readingMaxTokens: 720,
    ...adapterModelMetadata,
    timeoutMs,
    concurrency,
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
  adapterMaxTokens,
  samples: rows.length,
  ...manifest.counts,
  publicSearchRequests: 0,
  output: "private-eval/<private>",
}, null, 2));
