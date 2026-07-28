import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { execFileSync } from "node:child_process";

import {
  buildGeneralPageInvestigationActionPresentation,
  buildGeneralPageInvestigationSpanAdapterSystemPrompt,
} from "../src/lib/general-page-investigation-span-adapter";
import {
  buildGeneralPageInvestigationActionAdmissionSystemPrompt,
  resolveGeneralPageInvestigationActionTier,
} from "../src/lib/general-page-investigation-action-admission";
import { buildInvestigationSpanCandidates } from "../src/lib/investigation-span-candidate";
import {
  buildTierBGeneralPageInvestigationActionAdmissionChatBody,
  buildTierBGeneralPageInvestigationSpanAdapterChatBody,
  callTierBGeneralPageInvestigationActionAdmission,
  callTierBGeneralPageInvestigationSpanAdapter,
} from "../src/lib/tier-b-client";
import type { Lang } from "../src/lib/types";
import {
  assertPrivateSemanticAuditCandidateSnapshot,
  installPrivateSemanticAuditNetworkGuard,
  semanticAuditCompletionsUrl,
  sha256Text,
} from "./lib/private-general-page-semantic-audit.mjs";
import {
  assertPrivateEvalPaths,
  parsePrivateEvalJsonl,
  privateEvalInputErrors,
  privateRuntimeEnvelopeInputErrors,
  privateSpanAuditNoCandidateResult,
} from "./lib/private-general-page-eval.mjs";

type StructuredOutputMode = "json_schema" | "json_object";

interface InputRow {
  sampleId: string;
  surface: "facebook" | "news";
  dataCategory?: string;
  language: Lang;
  sourceSha256: string;
  text: string;
  sourceContext?: {
    title?: string;
    sourceName?: string;
    publishedAt?: string;
    url?: string;
  };
}

interface RuntimeEnvelopeInputRow {
  schemaVersion: 2;
  sampleId: string;
  sourceClass: "news_article" | "general_web" | "facebook";
  captureSha256: string;
  capture: {
    schemaVersion: 1;
    analysis: {
      scope: "page" | "focus";
      outputLang: Lang;
      context: { mainText: string; targetKind: "page" | "selection" | "current-region" };
    };
    adapter: {
      candidates: Array<{ id: `span:${number}`; exactText: string; start: number; end: number }>;
      targetKind: "page" | "selection" | "current-region";
      authorizedSourceContext: string;
      source?: InputRow["sourceContext"];
      sourceLang?: Lang;
      outputLang?: Lang;
    };
  };
}

interface NormalizedInputRow {
  sampleId: string;
  group: "facebook" | "news" | "page" | "focus";
  scope?: "page" | "focus";
  sourceClass?: RuntimeEnvelopeInputRow["sourceClass"];
  dataCategory: string;
  language: Lang;
  sourceSha256: string;
  text: string;
  candidates: ReturnType<typeof buildInvestigationSpanCandidates>;
  targetKind: "page" | "selection" | "current-region";
  sourceContext?: InputRow["sourceContext"];
  outputLang: Lang;
  captureSha256?: string;
}

function normalizeInputRow(row: InputRow | RuntimeEnvelopeInputRow, defaultOutputLang: Lang): NormalizedInputRow {
  if ((row as RuntimeEnvelopeInputRow).schemaVersion === 2) {
    const runtime = row as RuntimeEnvelopeInputRow;
    const text = runtime.capture.analysis.context.mainText;
    return {
      sampleId: runtime.sampleId,
      group: runtime.capture.analysis.scope,
      scope: runtime.capture.analysis.scope,
      sourceClass: runtime.sourceClass,
      dataCategory: `${runtime.capture.analysis.scope}-${runtime.sourceClass}`,
      language: runtime.capture.adapter.sourceLang ?? runtime.capture.analysis.outputLang,
      sourceSha256: sha256Text(text),
      text,
      candidates: runtime.capture.adapter.candidates,
      targetKind: runtime.capture.adapter.targetKind,
      sourceContext: runtime.capture.adapter.source,
      outputLang: runtime.capture.adapter.outputLang ?? runtime.capture.analysis.outputLang,
      captureSha256: runtime.captureSha256,
    };
  }
  const legacy = row as InputRow;
  return {
    sampleId: legacy.sampleId,
    group: legacy.surface,
    dataCategory: legacy.dataCategory || `${legacy.surface}-original`,
    language: legacy.language,
    sourceSha256: legacy.sourceSha256,
    text: legacy.text,
    candidates: buildInvestigationSpanCandidates(legacy.text, { maxCandidates: 48, maxCharacters: 240 }),
    targetKind: "page",
    sourceContext: legacy.sourceContext,
    outputLang: defaultOutputLang,
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

function boundedInteger(name: string, fallback: number, minimum: number, maximum: number): number {
  const value = Number(option(name, String(fallback)));
  if (!Number.isInteger(value) || value < minimum || value > maximum) throw new Error(`Invalid ${name}`);
  return value;
}

function responseFormat(): StructuredOutputMode {
  const value = option("--response-format", "json_object");
  if (value !== "json_schema" && value !== "json_object") throw new Error("Invalid --response-format");
  return value;
}

function languageOption(): Lang {
  const value = option("--output-language", "zh-TW");
  if (value !== "zh-TW" && value !== "en") throw new Error("Invalid --output-language");
  return value;
}

function gitOutput(repoRoot: string, args: string[]): string {
  return execFileSync("git", args, {
    cwd: repoRoot,
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
  });
}

function writePrivateFile(target: string, value: unknown): void {
  fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
  fs.writeFileSync(target, `${JSON.stringify(value, null, 2)}\n`, { flag: "wx", mode: 0o600 });
}

if (!process.argv.includes("--confirm-private-data-send")) {
  throw new Error("Missing --confirm-private-data-send");
}

const inputPath = required("--input");
const outputPath = required("--output");
const metaOutputPath = required("--meta-output");
const endpoint = required("--endpoint");
const model = required("--model");
const runId = required("--run-id");
const datasetVersion = required("--dataset-version");
const expectedCandidateCommit = required("--expected-candidate-commit");
const expectedTrackedDiffSha256 = required("--expected-tracked-diff-sha256");
const declaredCategories = required("--data-categories");
const expectedCount = boundedInteger("--sample-count", 30, 1, 100);
const concurrency = boundedInteger("--concurrency", 2, 1, 4);
const timeoutMs = boundedInteger("--timeout-ms", 120_000, 5_000, 120_000);
const structuredOutputMode = responseFormat();
const outputLang = languageOption();
if (!/^[a-z0-9][a-z0-9._-]{2,80}$/i.test(runId) ||
    !/^[a-z0-9][a-z0-9._-]{2,80}$/i.test(datasetVersion)) {
  throw new Error("Invalid run or dataset identifier");
}

const paths = assertPrivateEvalPaths(inputPath, outputPath, metaOutputPath, process.cwd());
if (fs.existsSync(paths.output) || fs.existsSync(paths.metaOutput)) {
  throw new Error("Private span audit output already exists; a run path may be used only once");
}
const inputFile = fs.readFileSync(paths.input, "utf8");
const rows = parsePrivateEvalJsonl(inputFile) as Array<InputRow | RuntimeEnvelopeInputRow>;
const runtimeEnvelopeMode = rows.length > 0 && rows.every((row) => (row as RuntimeEnvelopeInputRow).schemaVersion === 2);
const inputErrors = runtimeEnvelopeMode
  ? privateRuntimeEnvelopeInputErrors(rows, expectedCount, declaredCategories)
  : privateEvalInputErrors(rows, expectedCount, declaredCategories);
if (inputErrors.length > 0) throw new Error(inputErrors.join("; "));
const normalizedRows = rows.map((row) => normalizeInputRow(row, outputLang));
if (runtimeEnvelopeMode && normalizedRows.some((row) => row.outputLang !== outputLang)) {
  throw new Error("Captured output language does not match --output-language");
}

const repoRoot = gitOutput(process.cwd(), ["rev-parse", "--show-toplevel"]).trim();
const candidateCommit = gitOutput(repoRoot, ["rev-parse", "HEAD"]).trim();
const trackedDiff = gitOutput(repoRoot, ["diff", "--binary", "HEAD"]);
const candidateSnapshot = assertPrivateSemanticAuditCandidateSnapshot({
  actualCommit: candidateCommit,
  actualTrackedDiff: trackedDiff,
  expectedCommit: expectedCandidateCommit,
  expectedTrackedDiffSha256,
});
const worktreeStatus = gitOutput(repoRoot, ["status", "--porcelain=v1", "--untracked-files=all"]);
if (worktreeStatus.length > 0) throw new Error("Private span audit requires a clean candidate worktree");

const firstProtocolSample = normalizedRows.find(({ candidates }) => candidates.length > 0);
if (!firstProtocolSample) throw new Error("Private span audit requires at least one row with span candidates");
const protocolBody = buildTierBGeneralPageInvestigationSpanAdapterChatBody({
  endpoint,
  model,
  structuredOutputMode,
  candidates: firstProtocolSample.candidates,
  targetKind: firstProtocolSample.targetKind,
  authorizedSourceContext: firstProtocolSample.text,
  source: firstProtocolSample.sourceContext,
  sourceLang: firstProtocolSample.language,
  outputLang: firstProtocolSample.outputLang,
});
if (protocolBody.response_format?.type !== structuredOutputMode || protocolBody.temperature !== 0) {
  throw new Error("Span audit response format/body mismatch");
}
const firstProtocolCandidate = firstProtocolSample.candidates[0];
const admissionProtocolBody = buildTierBGeneralPageInvestigationActionAdmissionChatBody({
  endpoint,
  model,
  structuredOutputMode,
  selection: {
    candidateId: firstProtocolCandidate.id,
    exactClaim: firstProtocolCandidate.exactText,
    sourceQuote: firstProtocolCandidate.exactText,
    start: firstProtocolCandidate.start,
    end: firstProtocolCandidate.end,
  },
  authorizedSourceContext: firstProtocolSample.text,
  source: firstProtocolSample.sourceContext,
});
if (admissionProtocolBody.response_format?.type !== structuredOutputMode ||
    admissionProtocolBody.temperature !== 0) {
  throw new Error("Action admission response format/body mismatch");
}

const preflight = {
  result: "preflight_pass",
  runId,
  datasetVersion,
  samples: rows.length,
  candidateSnapshot,
  responseFormat: structuredOutputMode,
  outputLanguage: outputLang,
  modelRequests: 0,
  publicSearchRequests: 0,
  actionsOpened: 0,
};
if (process.argv.includes("--preflight-only")) {
  console.log(JSON.stringify(preflight, null, 2));
  process.exit(0);
}

const startedAt = new Date().toISOString();
const results = new Array<Record<string, unknown>>(rows.length);
let cursor = 0;
let modelRequests = 0;
const originalFetch = globalThis.fetch;
const guardedFetch = installPrivateSemanticAuditNetworkGuard(endpoint, originalFetch.bind(globalThis));
globalThis.fetch = (async (input, init) => {
  modelRequests += 1;
  return guardedFetch(input, init);
}) as typeof fetch;

async function evaluateRow(row: NormalizedInputRow): Promise<Record<string, unknown>> {
  const { candidates } = row;
  const base = {
    schemaVersion: 1,
    sampleId: row.sampleId,
    ...(runtimeEnvelopeMode
      ? { scope: row.scope, sourceClass: row.sourceClass, captureSha256: row.captureSha256 }
      : { surface: row.group }),
    dataCategory: row.dataCategory,
    sourceSha256: row.sourceSha256,
    candidateCount: candidates.length,
  };
  if (candidates.length < 1) {
    return privateSpanAuditNoCandidateResult(base);
  }
  const started = Date.now();
  const result = await callTierBGeneralPageInvestigationSpanAdapter({
    endpoint,
    model,
    structuredOutputMode,
    timeoutMs,
    apiKey: process.env.TRULY_PRIVATE_EVAL_API_KEY,
    candidates,
    targetKind: row.targetKind,
    authorizedSourceContext: row.text,
    source: row.sourceContext,
    sourceLang: row.language,
    outputLang: row.outputLang,
  });
  const selections = result.value?.selections ?? [];
  const proposedActions = selections.map((selection) => ({
    ...selection,
    presentation: buildGeneralPageInvestigationActionPresentation(selection, {
      outputLang: row.outputLang,
      source: row.sourceContext,
    }),
    exactGrounding: row.text.slice(selection.start, selection.end) === selection.exactClaim,
  }));
  const selection = selections[0];
  const admission = result.ok && selection
    ? await callTierBGeneralPageInvestigationActionAdmission({
        endpoint,
        model,
        structuredOutputMode,
        timeoutMs,
        apiKey: process.env.TRULY_PRIVATE_EVAL_API_KEY,
        selection,
        authorizedSourceContext: row.text,
        source: row.sourceContext,
      })
    : null;
  const finalTier = admission?.ok === true && admission.value
    ? resolveGeneralPageInvestigationActionTier(
      selection?.presentationTier ?? "exploratory",
      admission.value,
    )
    : null;
  const admitted = finalTier !== null;
  const admittedAction = finalTier !== null && selection
    ? {
        ...selection,
        presentationTier: finalTier,
        presentation: buildGeneralPageInvestigationActionPresentation(
          { ...selection, presentationTier: finalTier },
          {
            outputLang: row.outputLang,
            source: row.sourceContext,
          },
        ),
        exactGrounding:
          row.text.slice(selection.start, selection.end) === selection.exactClaim,
      }
    : null;
  const protocolOk = result.ok && (!selection || admission?.ok === true);
  const status = !protocolOk
    ? "protocol_failed"
    : !selection || finalTier === null
    ? "abstain"
    : "prepared";
  return {
    ...base,
    ok: protocolOk,
    status,
    latencyMs: Date.now() - started,
    selector: {
      ok: result.ok,
      attempts: result.attempts,
      finishReason: result.finishReason,
      usage: result.usage,
      error: result.error,
      issue: result.issue,
      raw: result.raw,
    },
    admission: admission
      ? {
          ok: admission.ok,
          decision: admission.value?.decision,
          presentationTier: admission.value?.presentationTier,
          finishReason: admission.finishReason,
          usage: admission.usage,
          error: admission.error,
          raw: admission.raw,
        }
      : null,
    proposedActions,
    actions: admittedAction ? [admittedAction] : [],
  };
}

async function worker(): Promise<void> {
  while (true) {
    const index = cursor++;
    if (index >= rows.length) return;
    results[index] = await evaluateRow(normalizedRows[index]);
  }
}

try {
  await Promise.all(Array.from({ length: concurrency }, () => worker()));
} finally {
  globalThis.fetch = originalFetch;
}

const resultFile = `${results.map((row) => JSON.stringify(row)).join("\n")}\n`;
fs.mkdirSync(path.dirname(paths.output), { recursive: true, mode: 0o700 });
fs.writeFileSync(paths.output, resultFile, { flag: "wx", mode: 0o600 });
const protocolSucceeded = results.filter((row) => row.ok === true).length;
const prepared = results.filter((row) => row.status === "prepared").length;
const abstained = results.filter((row) => row.status === "abstain").length;
const proposed = results.reduce((sum, row) =>
  sum + (Array.isArray(row.proposedActions) ? row.proposedActions.length : 0), 0);
const admissionRejected = results.filter((row) =>
  (row.admission as { decision?: string } | null)?.decision === "reject").length;
const actionCount = results.reduce((sum, row) => sum + (Array.isArray(row.actions) ? row.actions.length : 0), 0);
const exactGrounding = results.reduce((sum, row) => sum +
  (Array.isArray(row.actions) ? row.actions.filter((action) => action.exactGrounding === true).length : 0), 0);
const meta = {
  schemaVersion: 1,
  task: runtimeEnvelopeMode
    ? "general_page_investigation_runtime_envelope_forward_dev"
    : "general_page_investigation_span_forward_dev",
  runId,
  datasetVersion,
  split: "dev",
  candidate: {
    commit: candidateSnapshot.commit,
    trackedDiffSha256: candidateSnapshot.trackedDiffSha256,
  },
  contract: {
    selector: "ranked_exact_span_proposal_v6",
    selectorPromptSha256: sha256Text(buildGeneralPageInvestigationSpanAdapterSystemPrompt()),
    admission: "reader_action_admission_v7",
    admissionPromptSha256: sha256Text(buildGeneralPageInvestigationActionAdmissionSystemPrompt()),
    responseFormat: structuredOutputMode,
    outputLanguage: outputLang,
    repairMode: "none",
    maxCandidates: 48,
    maxActions: 1,
    replacementAfterRejection: false,
    inputBoundary: runtimeEnvelopeMode ? "captured_adapter_envelope" : "legacy_rebuilt_candidates",
  },
  model: {
    provider: "openai-compatible",
    endpoint,
    name: model,
    temperature: protocolBody.temperature,
    maxTokens: protocolBody.max_tokens,
    admissionMaxTokens: admissionProtocolBody.max_tokens,
    timeoutMs,
    concurrency,
  },
  data: {
    sampleCount: rows.length,
    declaredCategories: declaredCategories.split(",").map((value) => value.trim()).filter(Boolean),
  },
  counts: {
    protocolSucceeded,
    protocolFailed: rows.length - protocolSucceeded,
    prepared,
    abstained,
    proposed,
    admissionRejected,
    actionCount,
    exactGrounding,
  },
  networkBoundary: {
    allowedCompletionsUrl: semanticAuditCompletionsUrl(endpoint),
    redirects: "error",
    modelRequests,
    publicSearchRequests: 0,
    actionsOpened: 0,
  },
  artifacts: {
    inputSha256: sha256Text(inputFile),
    resultSha256: sha256Text(resultFile),
  },
  startedAt,
  completedAt: new Date().toISOString(),
};
writePrivateFile(paths.metaOutput, meta);
console.log(JSON.stringify({
  result: protocolSucceeded === rows.length ? "pass" : "fail",
  ...meta.counts,
  modelRequests,
  publicSearchRequests: 0,
  actionsOpened: 0,
  output: "private-data/runs/<private>",
}, null, 2));
if (protocolSucceeded !== rows.length) process.exitCode = 1;
