import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { execFileSync } from "node:child_process";
import { buildGeneralPageModelContext } from "../src/lib/general-page-model-context";
import {
  buildTierBGeneralPageBriefChatBody,
  callTierBGeneralPageBrief,
} from "../src/lib/tier-b-client";
import type { ReadingSurface } from "../src/lib/reading-surface-types";
import {
  preparePageClaimInvestigation,
  usableClaimQuestion,
} from "../src/sidepanel/page-claim-investigation";
import {
  assertPrivateEvalPaths,
  outputLanguageForPrivateEval,
  parsePrivateEvalJsonl,
  privateEvalInputErrors,
} from "./lib/private-general-page-eval.mjs";

interface InputRow {
  sampleId: string;
  surface: "facebook" | "news";
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

if (!process.argv.includes("--confirm-private-data-send")) throw new Error("Missing --confirm-private-data-send");
const inputPath = required("--input");
const outputPath = required("--output");
const metaOutputPath = required("--meta-output");
const endpoint = required("--endpoint");
const model = required("--model");
const split = required("--split");
const runId = required("--run-id");
const datasetVersion = required("--dataset-version");
const declaredCategories = required("--data-categories");
const expectedCount = Number(required("--sample-count"));
const concurrency = Math.max(1, Math.min(8, Number(option("--concurrency", "2")) || 2));
const timeoutMs = Math.max(1000, Math.min(120000, Number(option("--timeout-ms", "45000")) || 45000));
if (!['dev', 'holdout'].includes(split)) throw new Error("--split must be dev or holdout");
if (!/^gpr-grounding-v[1-9]\d*$/.test(datasetVersion)) throw new Error("--dataset-version must be gpr-grounding-vN");
if (!/^https?:\/\//.test(endpoint)) throw new Error("--endpoint must be HTTP(S)");

const paths = assertPrivateEvalPaths(inputPath, outputPath, metaOutputPath, process.cwd());
const rows = parsePrivateEvalJsonl(fs.readFileSync(paths.input, "utf8")) as InputRow[];
const inputErrors = privateEvalInputErrors(rows, expectedCount, declaredCategories);
if (inputErrors.length > 0) throw new Error(inputErrors.join("; "));

function surfaceFor(row: InputRow): ReadingSurface {
  const placeholder = row.surface === "facebook"
    ? "https://www.facebook.com/private-evaluation"
    : "https://example.invalid/private-evaluation";
  return {
    id: row.sampleId,
    kind: "web-page",
    source: "general",
    url: placeholder,
    mainText: row.text,
    links: [],
    images: [],
    extraction: { method: "semantic-html", status: "complete", warnings: [] },
  };
}

function promptVariantSha(row: InputRow): string {
  const body = buildTierBGeneralPageBriefChatBody({
    endpoint,
    model,
    context: buildGeneralPageModelContext(surfaceFor(row)),
    allowedUse: "article_or_selection_analysis",
    outputLang: outputLanguageForPrivateEval(row.language),
    contract: "investigation_v3",
    structuredOutputMode: "json_object",
  });
  const system = body.messages.find((message) => message.role === "system")?.content ?? "";
  return crypto.createHash("sha256").update(JSON.stringify(system)).digest("hex");
}

const promptVariantSha256ByLanguage = Object.fromEntries(
  [...new Set(rows.map((row) => outputLanguageForPrivateEval(row.language)))].sort().map((language) => {
    const row = rows.find((candidate) => outputLanguageForPrivateEval(candidate.language) === language);
    if (!row) throw new Error(`Missing prompt row for ${language}`);
    return [language, promptVariantSha(row)];
  }),
);
const promptVariants = Object.values(promptVariantSha256ByLanguage).sort();
const promptSha256 = crypto.createHash("sha256").update(promptVariants.join("\0")).digest("hex");
const startedAt = new Date().toISOString();
const results = new Array(rows.length);
let cursor = 0;

async function evaluateRow(row: InputRow) {
  const outputLang = outputLanguageForPrivateEval(row.language);
  const request = {
    endpoint,
    model,
    context: buildGeneralPageModelContext(surfaceFor(row)),
    allowedUse: "article_or_selection_analysis" as const,
    outputLang,
    contract: "investigation_v3" as const,
    structuredOutputMode: "json_object" as const,
    enableFormatRepair: true,
  };
  const started = Date.now();
  try {
    const response = await callTierBGeneralPageBrief({
      ...request,
      apiKey: process.env.TRULY_PRIVATE_EVAL_API_KEY,
      timeoutMs,
    });
    if (!response.ok || !response.brief) return { schemaVersion: 1, sampleId: row.sampleId, surface: row.surface, sourceSha256: row.sourceSha256, ok: false, latencyMs: Date.now() - started, error: response.error ?? "model_error", attempts: response.attempts, raw: response.raw };
    const brief = response.brief;
    const claim = brief.claims?.[0];
    const preparation = claim ? preparePageClaimInvestigation({
      analysisKey: row.sampleId,
      scope: "page",
      claimIndex: 0,
      claim,
      groundingText: row.text,
      source: row.sourceContext,
    }) : undefined;
    const task = preparation?.decision === "prepared" ? preparation.task : undefined;
    const modelQuestion = preparation?.decision === "prepared"
      ? usableClaimQuestion(
          preparation.claim.q,
          preparation.claim.atom,
          preparation.claim.c,
          preparation.claim.attribution,
        )
      : undefined;
    return {
      schemaVersion: 1,
      sampleId: row.sampleId,
      surface: row.surface,
      sourceSha256: row.sourceSha256,
      ok: true,
      latencyMs: Date.now() - started,
      attempts: response.attempts,
      formatRecovered: response.formatRecovered,
      brief,
      investigation: {
        eligible: Boolean(task),
        eligibilityReason: preparation?.decision === "rejected" ? preparation.reason : undefined,
        questionSource: task ? (modelQuestion ? "model" : "deterministic_fallback") : "none",
        question: task?.intent.question,
        googleKeywords: task?.googleKeywords,
        aiModePrompt: task?.aiModePrompt,
      },
      raw: response.raw,
    };
  } catch (error) {
    const reason = error instanceof DOMException && error.name === "AbortError" ? "timeout" : "network_error";
    return { schemaVersion: 1, sampleId: row.sampleId, surface: row.surface, sourceSha256: row.sourceSha256, ok: false, latencyMs: Date.now() - started, error: reason };
  }
}

async function worker() {
  while (true) {
    const index = cursor++;
    if (index >= rows.length) return;
    results[index] = await evaluateRow(rows[index]);
  }
}

await Promise.all(Array.from({ length: Math.min(concurrency, rows.length) }, () => worker()));
const completedAt = new Date().toISOString();
fs.mkdirSync(path.dirname(paths.output), { recursive: true, mode: 0o700 });
fs.writeFileSync(paths.output, `${results.map((result) => JSON.stringify(result)).join("\n")}\n`, { mode: 0o600 });
const trulyCommit = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
const trulyDiff = execFileSync("git", ["diff", "--binary", "HEAD"], { encoding: "utf8", maxBuffer: 8 * 1024 * 1024 });
const trulyWorktreeDirty = trulyDiff.length > 0;
const trulyDiffSha256 = trulyWorktreeDirty
  ? crypto.createHash("sha256").update(trulyDiff).digest("hex")
  : undefined;
const manifest = {
  schemaVersion: 1,
  runId,
  datasetVersion,
  split,
  trulyCommit,
  trulyWorktreeDirty,
  trulyDiffSha256,
  promptSha256,
  promptVariantSha256ByLanguage,
  model: {
    provider: "openai-compatible",
    name: model,
    temperature: 0,
    maxTokens: 720,
    repairMaxTokens: 800,
  },
  guardVersion: trulyCommit,
  startedAt,
  completedAt,
};
fs.writeFileSync(paths.metaOutput, `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 });
console.log(JSON.stringify({
  result: results.every((result) => result.ok) ? "pass" : "partial",
  runId,
  split,
  samples: rows.length,
  succeeded: results.filter((result) => result.ok).length,
  failed: results.filter((result) => !result.ok).length,
  promptSha256,
  output: "private-eval/<private>",
}, null, 2));
