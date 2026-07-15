import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { execFileSync } from "node:child_process";

import {
  INVESTIGATION_PLAN_DRAFT_JSON_SCHEMA,
  investigationPlannerRepairPrompt,
  investigationPlannerSystemPrompt,
  investigationPlannerUserPrompt,
  materializeHumanPreselectedAtomicPlan,
  materializeInvestigationPlan,
  parseInvestigationPlanDraftContent,
  preselectedInvestigationPlannerSystemPrompt,
  preselectedInvestigationPlannerUserPrompt,
} from "../src/lib/claim-investigation-planner";
import { buildGeneralPageModelContext } from "../src/lib/general-page-model-context";
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
  preselectedClaim?: string;
  preselectedAtomic?: boolean;
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
const responseFormat = required("--response-format");
const thinking = option("--thinking", "disabled");
const selectionPolicy = option("--selection-policy", "auto");
const repairMode = option("--repair-mode", "none");
const concurrency = Math.max(1, Math.min(4, Number(option("--concurrency", "2")) || 2));
const timeoutMs = Math.max(1000, Math.min(180000, Number(option("--timeout-ms", "90000")) || 90000));
const maxTokens = Math.max(500, Math.min(3000, Number(option("--max-tokens", "1800")) || 1800));
if (split !== "dev") throw new Error("Investigation-plan iteration may use only --split dev");
if (!new Set(["gpr-investigation-plan-v1", "gpr-source-aware-forward-dev-v1", "gpr-source-aware-news-forward-dev-v1", "gpr-authority-discovery-sequential-news-dev-v1"]).has(datasetVersion)) {
  throw new Error("Unexpected --dataset-version");
}
if (!/^https?:\/\//.test(endpoint)) throw new Error("--endpoint must be HTTP(S)");
if (responseFormat !== "json_object" && responseFormat !== "json_schema") {
  throw new Error("--response-format must be json_object or json_schema");
}
if (thinking !== "disabled" && thinking !== "default") {
  throw new Error("--thinking must be disabled or default");
}
if (selectionPolicy !== "auto" && selectionPolicy !== "human_preselected") {
  throw new Error("--selection-policy must be auto or human_preselected");
}
if (repairMode !== "none" && repairMode !== "grounding_once" && repairMode !== "atomic_once") {
  throw new Error("--repair-mode must be none, grounding_once, or atomic_once");
}
if (repairMode === "grounding_once" && selectionPolicy !== "human_preselected") {
  throw new Error("grounding_once is limited to human_preselected development runs");
}
if (repairMode === "atomic_once" && selectionPolicy !== "auto") {
  throw new Error("atomic_once is limited to auto-selected development runs");
}

const paths = assertPrivateEvalPaths(inputPath, outputPath, metaOutputPath, process.cwd());
const rows = parsePrivateEvalJsonl(fs.readFileSync(paths.input, "utf8")) as InputRow[];
const inputErrors = privateEvalInputErrors(rows, expectedCount, declaredCategories);
if (inputErrors.length > 0) throw new Error(inputErrors.join("; "));
if (selectionPolicy === "human_preselected") {
  for (const row of rows) {
    if (typeof row.preselectedClaim !== "string" || row.preselectedClaim.trim().length < 6 ||
      !row.text.normalize("NFKC").includes(row.preselectedClaim.normalize("NFKC")) || row.preselectedAtomic !== true) {
      throw new Error(`${row.sampleId}: human_preselected requires a grounded preselectedClaim`);
    }
  }
}

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

function responseFormatBody() {
  return responseFormat === "json_schema"
    ? {
        type: "json_schema",
        json_schema: {
          name: "truly_investigation_plan_v2",
          strict: true,
          schema: INVESTIGATION_PLAN_DRAFT_JSON_SCHEMA,
        },
      }
    : { type: "json_object" };
}

function promptSha(language: "zh-TW" | "en"): string {
  const prompt = selectionPolicy === "human_preselected"
    ? preselectedInvestigationPlannerSystemPrompt(language)
    : investigationPlannerSystemPrompt(language);
  return crypto.createHash("sha256").update(prompt).digest("hex");
}

const promptVariantSha256ByLanguage = Object.fromEntries(
  [...new Set(rows.map((row) => outputLanguageForPrivateEval(row.language)))].sort().map((language) => [language, promptSha(language)]),
);
const promptSha256 = crypto.createHash("sha256")
  .update(Object.values(promptVariantSha256ByLanguage).sort().join("\0"))
  .digest("hex");
const schemaSha256 = crypto.createHash("sha256")
  .update(JSON.stringify(INVESTIGATION_PLAN_DRAFT_JSON_SCHEMA))
  .digest("hex");
const startedAt = new Date().toISOString();
const results = new Array(rows.length);
let cursor = 0;

async function requestAttempt(row: InputRow, text: string, outputLang: "zh-TW" | "en", repairError?: string) {
  const system = selectionPolicy === "human_preselected"
    ? preselectedInvestigationPlannerSystemPrompt(outputLang)
    : investigationPlannerSystemPrompt(outputLang);
  const baseUser = selectionPolicy === "human_preselected"
    ? preselectedInvestigationPlannerUserPrompt(row.preselectedClaim ?? "", text)
    : investigationPlannerUserPrompt(text);
  const user = repairError
    ? investigationPlannerRepairPrompt(repairError, baseUser, selectionPolicy)
    : baseUser;
  if (!user) throw new Error(`Unsupported repair request: ${repairError}`);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  let response: Response;
  try {
    response = await fetch(`${endpoint.replace(/\/+$/, "")}/chat/completions`, {
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
        response_format: responseFormatBody(),
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
  try {
    payload = JSON.parse(raw);
  } catch {
    return { error: "invalid_response_json", raw };
  }
  const content = payload?.choices?.[0]?.message?.content;
  if (typeof content !== "string") return { error: "missing_content", raw };
  const draft = parseInvestigationPlanDraftContent(content);
  if (!draft) return { error: "invalid_draft", content, raw };
  const materialized = materializeInvestigationPlan(draft, {
    sampleId: row.sampleId,
    scope: "page",
    sourceText: text,
    contentFingerprint: row.sourceSha256,
    observedAt: startedAt,
  });
  return {
    ok: materialized.ok || materialized.error === "abstained",
    draft,
    materialized,
    raw,
  };
}

async function evaluateRow(row: InputRow) {
  const text = effectiveText(row);
  const outputLang = outputLanguageForPrivateEval(row.language);
  const started = Date.now();
  try {
    const first = await requestAttempt(row, text, outputLang);
    const firstError = first.materialized && !first.materialized.ok
      ? first.materialized.error
      : first.error;
    const canRepair = (repairMode === "grounding_once" &&
      (firstError === "ungrounded_span" || firstError === "ungrounded_proposition")) ||
      (repairMode === "atomic_once" && firstError === "compound_proposition");
    const repaired = canRepair ? await requestAttempt(row, text, outputLang, firstError) : first;
    const repairedError = repaired.materialized && !repaired.materialized.ok
      ? repaired.materialized.error
      : repaired.error;
    const canUseHumanAtomicFallback = row.preselectedAtomic === true && repaired.draft &&
      (repairedError === "ungrounded_span" || repairedError === "ungrounded_proposition" ||
        repairedError === "compound_proposition");
    const fallbackMaterialized = canUseHumanAtomicFallback
      ? materializeHumanPreselectedAtomicPlan(repaired.draft, {
          sampleId: row.sampleId,
          scope: "page",
          sourceText: text,
          contentFingerprint: row.sourceSha256,
          observedAt: startedAt,
        }, row.preselectedClaim ?? "")
      : undefined;
    const final = fallbackMaterialized?.ok
      ? { ...repaired, ok: true, materialized: fallbackMaterialized }
      : repaired;
    return {
      schemaVersion: 1,
      sampleId: row.sampleId,
      surface: row.surface,
      sourceSha256: row.sourceSha256,
      ok: final.ok === true,
      latencyMs: Date.now() - started,
      ...(final.error ? { error: final.error } : {}),
      ...(final.content ? { content: final.content } : {}),
      ...(final.draft ? { draft: final.draft } : {}),
      ...(final.materialized ? { materialized: final.materialized } : {}),
      ...(final.raw ? { raw: final.raw } : {}),
      repairAttempted: canRepair,
      humanAtomicFallbackUsed: fallbackMaterialized?.ok === true,
      ...(canRepair ? {
        firstAttempt: {
          ...(first.error ? { error: first.error } : {}),
          ...(first.materialized ? { materialized: first.materialized } : {}),
          ...(first.raw ? { raw: first.raw } : {}),
        },
      } : {}),
    };
  } catch (error) {
    const reason = error instanceof DOMException && error.name === "AbortError" ? "timeout" : "network_error";
    return { schemaVersion: 1, sampleId: row.sampleId, surface: row.surface, sourceSha256: row.sourceSha256, ok: false, latencyMs: Date.now() - started, error: reason, repairAttempted: false };
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
const manifest = {
  schemaVersion: 1,
  runId,
  task: "investigation_plan",
  datasetVersion,
  split,
  trulyCommit,
  trulyWorktreeDirty: trulyDiff.length > 0,
  trulyDiffSha256: trulyDiff.length > 0 ? crypto.createHash("sha256").update(trulyDiff).digest("hex") : undefined,
  promptSha256,
  promptVariantSha256ByLanguage,
  schemaSha256,
  responseFormat,
  thinking,
  selectionPolicy,
  repairMode,
  model: { provider: "openai-compatible", name: model, temperature: 0, maxTokens },
  startedAt,
  completedAt,
};
fs.writeFileSync(paths.metaOutput, `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 });

const valid = results.filter((result) => result.ok);
const materialized = valid.filter((result) => result.materialized?.ok);
const abstained = valid.filter((result) => result.materialized?.error === "abstained");
const repaired = valid.filter((result) => result.repairAttempted);
const humanAtomicFallbacks = valid.filter((result) => result.humanAtomicFallbackUsed);
console.log(JSON.stringify({
  result: results.every((result) => result.ok) ? "pass" : "partial",
  runId,
  responseFormat,
  samples: rows.length,
  valid: valid.length,
  materialized: materialized.length,
  abstained: abstained.length,
  repaired: repaired.length,
  humanAtomicFallbacks: humanAtomicFallbacks.length,
  failed: results.length - valid.length,
  promptSha256,
  schemaSha256,
  output: "private-eval/<private>",
}, null, 2));
