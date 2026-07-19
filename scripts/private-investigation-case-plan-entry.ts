import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { execFileSync } from "node:child_process";

import type { InvestigationBundle } from "../src/lib/claim-investigation-contract";
import { validateInvestigationBundle } from "../src/lib/claim-investigation-contract";
import {
  INVESTIGATION_CASE_SEMANTIC_DRAFT_JSON_SCHEMA,
  investigationCaseSemanticPlannerSystemPrompt,
  investigationCaseSemanticPlannerUserPrompt,
  materializeSemanticInvestigationCase,
  parseInvestigationCaseSemanticDraftContent,
} from "../src/lib/claim-investigation-case-planner";
import type { Lang } from "../src/lib/types";

interface PlanRow {
  sampleId: string;
  surface: "facebook" | "news";
  materialized?: { ok: boolean; bundle?: InvestigationBundle };
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

function assertPrivatePath(file: string, kind: "input" | "output"): string {
  const resolved = path.resolve(file);
  const publicRoot = `${path.resolve(process.cwd())}${path.sep}`;
  const publicTmp = `${path.resolve(process.cwd(), "tmp")}${path.sep}`;
  if (resolved.startsWith(publicRoot) && !resolved.startsWith(publicTmp)) {
    throw new Error(`${kind} must stay outside the public repo or under tmp/`);
  }
  if (kind === "input" && !fs.existsSync(resolved)) throw new Error(`Missing private input: ${resolved}`);
  return resolved;
}

function sha256(value: string | Buffer): string {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function languageFor(bundle: InvestigationBundle): Lang {
  return /\p{Script=Han}/u.test(bundle.subject.originalSpan) ? "zh-TW" : "en";
}

if (!process.argv.includes("--confirm-private-data-send")) throw new Error("Missing --confirm-private-data-send");
const plansPath = assertPrivatePath(required("--plans"), "input");
const outputPath = assertPrivatePath(required("--output"), "output");
const metaOutputPath = assertPrivatePath(required("--meta-output"), "output");
const endpoint = required("--endpoint");
const model = required("--model");
const split = required("--split");
const runId = required("--run-id");
const declaredCategories = required("--data-categories");
const expectedCount = Number(required("--sample-count"));
const concurrency = Math.max(1, Math.min(4, Number(option("--concurrency", "2")) || 2));
const timeoutMs = Math.max(1000, Math.min(180000, Number(option("--timeout-ms", "90000")) || 90000));
const maxTokens = Math.max(800, Math.min(3000, Number(option("--max-tokens", "1800")) || 1800));
const repairMode = option("--repair-mode", "none");
if (split !== "dev") throw new Error("Case-plan iteration may use only --split dev");
if (!/^https?:\/\//u.test(endpoint)) throw new Error("--endpoint must be HTTP(S)");
if (!Number.isInteger(expectedCount) || expectedCount < 1 || expectedCount > 30) {
  throw new Error("--sample-count must be an integer from 1 to 30");
}
if (repairMode !== "none" && repairMode !== "local_once") {
  throw new Error("--repair-mode must be none or local_once");
}

const rows = fs.readFileSync(plansPath, "utf8")
  .split(/\r?\n/u)
  .map((line) => line.trim())
  .filter(Boolean)
  .map((line) => JSON.parse(line) as PlanRow)
  .filter((row) => row.materialized?.ok && row.materialized.bundle);
if (rows.length !== expectedCount) throw new Error(`sample count mismatch: expected ${expectedCount}, got ${rows.length}`);
for (const row of rows) {
  const bundle = row.materialized!.bundle!;
  if (!validateInvestigationBundle(bundle).ok || bundle.evidence.length > 0) {
    throw new Error(`${row.sampleId}: invalid planned bundle`);
  }
}

const promptVariants = [...new Set(rows.map((row) => languageFor(row.materialized!.bundle!)))];
const promptVariantSha256ByLanguage = Object.fromEntries(promptVariants.map((language) => [
  language,
  sha256(investigationCaseSemanticPlannerSystemPrompt(language)),
]));
const schemaSha256 = sha256(JSON.stringify(INVESTIGATION_CASE_SEMANTIC_DRAFT_JSON_SCHEMA));
const startedAt = new Date().toISOString();
const results = new Array(rows.length);
let cursor = 0;

async function requestAttempt(
  row: PlanRow,
  bundle: InvestigationBundle,
  language: Lang,
  repairDetail?: string,
) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const baseUser = investigationCaseSemanticPlannerUserPrompt(bundle);
    const user = repairDetail
      ? `The previous semantic discovery plan failed deterministic local validation with: ${repairDetail}. Return a new full JSON object. Keep SUBJECT and NUMBERED QUESTIONS unchanged. Fix only the semantic choices; local code owns IDs, requirements, queries, and stopping conditions. Do not add facts.\n\n${baseUser}`
      : baseUser;
    const response = await fetch(`${endpoint.replace(/\/+$/u, "")}/chat/completions`, {
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
        response_format: {
          type: "json_schema",
          json_schema: {
            name: "truly_investigation_semantic_case_plan_v3",
            strict: true,
            schema: INVESTIGATION_CASE_SEMANTIC_DRAFT_JSON_SCHEMA,
          },
        },
        chat_template_kwargs: { enable_thinking: false },
        messages: [
          { role: "system", content: investigationCaseSemanticPlannerSystemPrompt(language) },
          { role: "user", content: user },
        ],
      }),
      signal: controller.signal,
    });
    const raw = await response.text();
    if (!response.ok) {
      return { ok: false as const, error: `http_${response.status}`, raw };
    }
    let payload: any;
    try {
      payload = JSON.parse(raw);
    } catch {
      return { ok: false as const, error: "invalid_response_json", raw };
    }
    const content = payload?.choices?.[0]?.message?.content;
    if (typeof content !== "string") {
      return { ok: false as const, error: "missing_content", raw };
    }
    const draft = parseInvestigationCaseSemanticDraftContent(content);
    if (!draft) {
      return { ok: false as const, error: "invalid_draft", content, raw };
    }
    const materialized = materializeSemanticInvestigationCase(draft, bundle, row.sampleId);
    return {
      ok: materialized.ok,
      draft,
      materialized,
      raw,
    };
  } catch (error) {
    const reason = error instanceof DOMException && error.name === "AbortError" ? "timeout" : "network_error";
    return { ok: false as const, error: reason };
  } finally {
    clearTimeout(timeout);
  }
}

async function evaluateRow(row: PlanRow) {
  const bundle = row.materialized!.bundle!;
  const language = languageFor(bundle);
  const started = Date.now();
  const first = await requestAttempt(row, bundle, language);
  const repairDetail = first.materialized && !first.materialized.ok && first.materialized.error === "invalid_case"
    ? first.materialized.detail
    : undefined;
  const repairAttempted = repairMode === "local_once" && Boolean(repairDetail);
  const final = repairAttempted
    ? await requestAttempt(row, bundle, language, repairDetail)
    : first;
  return {
    schemaVersion: 1,
    sampleId: row.sampleId,
    surface: row.surface,
    ...final,
    latencyMs: Date.now() - started,
    repairAttempted,
    ...(repairAttempted ? { firstAttempt: first } : {}),
  };
}

async function worker(): Promise<void> {
  while (true) {
    const index = cursor++;
    if (index >= rows.length) return;
    results[index] = await evaluateRow(rows[index]);
  }
}

await Promise.all(Array.from({ length: Math.min(concurrency, rows.length) }, () => worker()));
fs.mkdirSync(path.dirname(outputPath), { recursive: true, mode: 0o700 });
fs.writeFileSync(outputPath, `${results.map((result) => JSON.stringify(result)).join("\n")}\n`, { mode: 0o600 });
const trulyCommit = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
const trulyDiff = execFileSync("git", ["diff", "--binary", "HEAD"], { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
const completedAt = new Date().toISOString();
fs.writeFileSync(metaOutputPath, `${JSON.stringify({
  schemaVersion: 1,
  runId,
  task: "investigation_case_plan",
  split,
  trulyCommit,
  trulyWorktreeDirty: trulyDiff.length > 0,
  trulyDiffSha256: trulyDiff.length > 0 ? sha256(trulyDiff) : undefined,
  plansSha256: sha256(fs.readFileSync(plansPath)),
  promptVariantSha256ByLanguage,
  schemaSha256,
  responseFormat: "json_schema",
  thinking: "disabled",
  repairMode,
  dataCategories: declaredCategories.split(",").map((entry) => entry.trim()).filter(Boolean),
  model: { provider: "openai-compatible", name: model, temperature: 0, maxTokens },
  samples: rows.length,
  startedAt,
  completedAt,
}, null, 2)}\n`, { mode: 0o600 });

console.log(JSON.stringify({
  result: results.every((result) => result.ok) ? "pass" : "partial",
  samples: rows.length,
  validCases: results.filter((result) => result.ok).length,
  repaired: results.filter((result) => result.ok && result.repairAttempted).length,
  failed: results.filter((result) => !result.ok).length,
  output: "private-eval/<private>",
}, null, 2));
