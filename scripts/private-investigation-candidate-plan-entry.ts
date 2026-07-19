import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { execFileSync } from "node:child_process";

import {
  candidateSelectedInvestigationPlanJsonSchema,
  candidateSelectedInvestigationPlannerSystemPrompt,
  candidateSelectedInvestigationPlannerUserPrompt,
  materializeCandidateSelectedAtomicPlan,
  parseInvestigationPlanDraftContent,
} from "../src/lib/claim-investigation-planner";
import { buildGeneralPageModelContext } from "../src/lib/general-page-model-context";
import {
  buildInvestigationSpanCandidates,
  investigationSpanSelectionJsonSchema,
  investigationSpanSelectorSystemPrompt,
  investigationSpanSelectorUserPrompt,
  parseInvestigationSpanSelection,
} from "../src/lib/investigation-span-candidate";
import type { ReadingSurface } from "../src/lib/reading-surface-types";
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
  dataCategory?: string;
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
const thinking = option("--thinking", "disabled");
const concurrency = Math.max(1, Math.min(4, Number(option("--concurrency", "2")) || 2));
const timeoutMs = Math.max(1000, Math.min(180000, Number(option("--timeout-ms", "90000")) || 90000));
const selectorMaxTokens = Math.max(100, Math.min(800, Number(option("--selector-max-tokens", "300")) || 300));
const plannerMaxTokens = Math.max(500, Math.min(3000, Number(option("--planner-max-tokens", "1800")) || 1800));
const maxCandidates = Math.max(1, Math.min(100, Number(option("--max-candidates", "48")) || 48));
if (split !== "dev") throw new Error("Candidate-plan iteration may use only --split dev");
if (datasetVersion !== "gpr-authority-discovery-sequential-news-dev-v1") throw new Error("Unexpected --dataset-version");
if (!/^https?:\/\//u.test(endpoint)) throw new Error("--endpoint must be HTTP(S)");
if (thinking !== "disabled" && thinking !== "default") throw new Error("--thinking must be disabled or default");

const paths = assertPrivateEvalPaths(inputPath, outputPath, metaOutputPath, process.cwd());
const rows = parsePrivateEvalJsonl(fs.readFileSync(paths.input, "utf8")) as InputRow[];
const inputErrors = privateEvalInputErrors(rows, expectedCount, declaredCategories);
if (inputErrors.length > 0) throw new Error(inputErrors.join("; "));

function surfaceFor(row: InputRow): ReadingSurface {
  return {
    id: row.sampleId,
    kind: "web-page",
    source: "general",
    url: row.surface === "facebook"
      ? "https://www.facebook.com/private-evaluation"
      : "https://example.invalid/private-evaluation",
    mainText: row.text,
    links: [],
    images: [],
    extraction: { method: "semantic-html", status: "complete", warnings: [] },
  };
}

function effectiveText(row: InputRow): string {
  return buildGeneralPageModelContext(surfaceFor(row)).mainText;
}

async function completion(system: string, user: string, responseFormat: object, maxTokens: number) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  let response: Response;
  try {
    response = await fetch(`${endpoint.replace(/\/+$/u, "")}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(process.env.TRULY_PRIVATE_EVAL_API_KEY
          ? { Authorization: `Bearer ${process.env.TRULY_PRIVATE_EVAL_API_KEY}` }
          : {}),
      },
      body: JSON.stringify({
        model,
        temperature: 0,
        max_tokens: maxTokens,
        response_format: responseFormat,
        ...(thinking === "disabled" ? { chat_template_kwargs: { enable_thinking: false } } : {}),
        messages: [{ role: "system", content: system }, { role: "user", content: user }],
      }),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }
  const raw = await response.text();
  if (!response.ok) return { error: `http_${response.status}`, raw };
  let payload: any;
  try { payload = JSON.parse(raw); } catch { return { error: "invalid_response_json", raw }; }
  const content = payload?.choices?.[0]?.message?.content;
  const diagnostics = {
    finishReason: typeof payload?.choices?.[0]?.finish_reason === "string" ? payload.choices[0].finish_reason : undefined,
    completionTokens: Number.isInteger(payload?.usage?.completion_tokens) ? payload.usage.completion_tokens : undefined,
  };
  return typeof content === "string"
    ? { content, raw, ...diagnostics }
    : { error: "missing_content", raw, ...diagnostics };
}

const startedAt = new Date().toISOString();
const results = new Array(rows.length);
let cursor = 0;

async function evaluateRow(row: InputRow) {
  const text = effectiveText(row);
  const outputLang = outputLanguageForPrivateEval(row.language);
  const candidates = buildInvestigationSpanCandidates(text, { maxCandidates, maxCharacters: 240 });
  const started = Date.now();
  if (candidates.length === 0) {
    return {
      schemaVersion: 1,
      sampleId: row.sampleId,
      surface: row.surface,
      sourceSha256: row.sourceSha256,
      ok: true,
      latencyMs: Date.now() - started,
      selector: { eligible: false, candidateId: null, abstentionReason: "unsafe_to_plan", candidateCount: 0 },
      materialized: { ok: false, error: "abstained", reason: "unsafe_to_plan" },
    };
  }
  try {
    const candidateIds = candidates.map(({ id }) => id);
    const selectionSchema = investigationSpanSelectionJsonSchema(candidateIds);
    const selectorResponse = await completion(
      investigationSpanSelectorSystemPrompt(outputLang),
      investigationSpanSelectorUserPrompt(text, candidates),
      { type: "json_schema", json_schema: { name: "truly_investigation_span_selection_v1", strict: true, schema: selectionSchema } },
      selectorMaxTokens,
    );
    if (!selectorResponse.content) {
      return { schemaVersion: 1, sampleId: row.sampleId, surface: row.surface, sourceSha256: row.sourceSha256, ok: false, latencyMs: Date.now() - started, error: selectorResponse.error, selectorDiagnostics: { finishReason: selectorResponse.finishReason, completionTokens: selectorResponse.completionTokens }, selectorRaw: selectorResponse.raw };
    }
    const selection = parseInvestigationSpanSelection(selectorResponse.content, candidateIds);
    if (!selection) {
      return { schemaVersion: 1, sampleId: row.sampleId, surface: row.surface, sourceSha256: row.sourceSha256, ok: false, latencyMs: Date.now() - started, error: "invalid_selection", selectorRaw: selectorResponse.raw };
    }
    if (!selection.eligible) {
      return {
        schemaVersion: 1,
        sampleId: row.sampleId,
        surface: row.surface,
        sourceSha256: row.sourceSha256,
        ok: true,
        latencyMs: Date.now() - started,
        selector: { ...selection, candidateCount: candidates.length },
        selectorDiagnostics: { finishReason: selectorResponse.finishReason, completionTokens: selectorResponse.completionTokens },
        selectorRaw: selectorResponse.raw,
        materialized: { ok: false, error: "abstained", reason: selection.abstentionReason },
      };
    }
    const selected = candidates.find(({ id }) => id === selection.candidateId);
    if (!selected) throw new Error("selected candidate missing");
    const plannerResponse = await completion(
      candidateSelectedInvestigationPlannerSystemPrompt(outputLang),
      candidateSelectedInvestigationPlannerUserPrompt(selected.exactText, text),
      { type: "json_schema", json_schema: { name: "truly_investigation_candidate_plan_v2", strict: true, schema: candidateSelectedInvestigationPlanJsonSchema(selected.exactText) } },
      plannerMaxTokens,
    );
    if (!plannerResponse.content) {
      return { schemaVersion: 1, sampleId: row.sampleId, surface: row.surface, sourceSha256: row.sourceSha256, ok: false, latencyMs: Date.now() - started, error: plannerResponse.error, selector: { ...selection, candidateCount: candidates.length }, selectorDiagnostics: { finishReason: selectorResponse.finishReason, completionTokens: selectorResponse.completionTokens }, plannerDiagnostics: { finishReason: plannerResponse.finishReason, completionTokens: plannerResponse.completionTokens }, selectorRaw: selectorResponse.raw, plannerRaw: plannerResponse.raw };
    }
    const draft = parseInvestigationPlanDraftContent(plannerResponse.content);
    if (!draft) {
      return { schemaVersion: 1, sampleId: row.sampleId, surface: row.surface, sourceSha256: row.sourceSha256, ok: false, latencyMs: Date.now() - started, error: "invalid_draft", selector: { ...selection, candidateCount: candidates.length }, selectorDiagnostics: { finishReason: selectorResponse.finishReason, completionTokens: selectorResponse.completionTokens }, plannerDiagnostics: { finishReason: plannerResponse.finishReason, completionTokens: plannerResponse.completionTokens }, selectorRaw: selectorResponse.raw, plannerRaw: plannerResponse.raw };
    }
    const materialized = materializeCandidateSelectedAtomicPlan(draft, {
      sampleId: row.sampleId,
      scope: "page",
      sourceText: text,
      contentFingerprint: row.sourceSha256,
      observedAt: startedAt,
    }, selected.exactText);
    return {
      schemaVersion: 1,
      sampleId: row.sampleId,
      surface: row.surface,
      sourceSha256: row.sourceSha256,
      ok: materialized.ok || materialized.error === "abstained",
      latencyMs: Date.now() - started,
      selector: { ...selection, candidateCount: candidates.length, selectedSpanSha256: crypto.createHash("sha256").update(selected.exactText).digest("hex") },
      selectorDiagnostics: { finishReason: selectorResponse.finishReason, completionTokens: selectorResponse.completionTokens },
      selectorRaw: selectorResponse.raw,
      draft,
      materialized,
      plannerDiagnostics: { finishReason: plannerResponse.finishReason, completionTokens: plannerResponse.completionTokens },
      plannerRaw: plannerResponse.raw,
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
const trulyDiff = execFileSync("git", ["diff", "--binary", "HEAD"], { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
const languages = [...new Set(rows.map((row) => outputLanguageForPrivateEval(row.language)))].sort();
const selectorPromptSha256ByLanguage = Object.fromEntries(languages.map((language) => [language, crypto.createHash("sha256").update(investigationSpanSelectorSystemPrompt(language)).digest("hex")]));
const plannerPromptSha256ByLanguage = Object.fromEntries(languages.map((language) => [language, crypto.createHash("sha256").update(candidateSelectedInvestigationPlannerSystemPrompt(language)).digest("hex")]));
const manifest = {
  schemaVersion: 1,
  runId,
  task: "investigation_candidate_plan",
  datasetVersion,
  split,
  trulyCommit,
  trulyWorktreeDirty: trulyDiff.length > 0,
  trulyDiffSha256: trulyDiff.length > 0 ? crypto.createHash("sha256").update(trulyDiff).digest("hex") : undefined,
  selectorPromptSha256ByLanguage,
  plannerPromptSha256ByLanguage,
  plannerSchemaSha256: crypto.createHash("sha256").update("candidate-selected-v1:exact-span:null-metadata").digest("hex"),
  selectorSchemaPolicySha256: crypto.createHash("sha256").update("v1:eligible+candidate-enum+abstention:max100").digest("hex"),
  responseFormat: "json_schema",
  thinking,
  selectionPolicy: "constrained_local_candidate",
  repairMode: "none",
  maxCandidates,
  model: { provider: "openai-compatible", name: model, temperature: 0, selectorMaxTokens, plannerMaxTokens },
  startedAt,
  completedAt,
};
fs.writeFileSync(paths.metaOutput, `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 });

const valid = results.filter((result) => result.ok);
const materialized = valid.filter((result) => result.materialized?.ok);
const abstained = valid.filter((result) => result.materialized?.error === "abstained");
console.log(JSON.stringify({
  result: results.every((result) => result.ok) ? "pass" : "partial",
  runId,
  samples: rows.length,
  valid: valid.length,
  materialized: materialized.length,
  abstained: abstained.length,
  failed: results.length - valid.length,
  selectorPromptSha256ByLanguage,
  plannerPromptSha256ByLanguage,
  output: "private-eval/<private>",
}, null, 2));
