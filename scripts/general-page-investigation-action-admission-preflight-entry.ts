import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { execFileSync } from "node:child_process";

import {
  buildGeneralPageInvestigationActionAdmissionSystemPrompt,
} from "../src/lib/general-page-investigation-action-admission";
import {
  buildTierBGeneralPageInvestigationActionAdmissionChatBody,
  callTierBGeneralPageInvestigationActionAdmission,
  type TierBGeneralPageInvestigationActionAdmissionRequest,
} from "../src/lib/tier-b-client";
import type { Lang } from "../src/lib/types";
import {
  installInvestigationAdapterProtocolSmokeNetworkGuard,
  sha256CanonicalJson,
} from "./lib/private-general-page-investigation-adapter-smoke.mjs";
import { sha256Text } from "./lib/private-general-page-semantic-audit.mjs";

type StructuredOutputMode = "json_schema" | "json_object";
type Decision = "admit" | "reject";

interface Fixture {
  sampleId: string;
  language: Lang;
  expectedDecision: Decision;
  title: string;
  context: string;
  selectedText: string;
}

const fixtures: Fixture[] = [
  {
    sampleId: "admit-zh-official-recall",
    language: "zh-TW",
    expectedDecision: "admit",
    title: "清泉食品 A17 批次下架",
    context: "青河市衛生局公告清泉食品 A17 批次自 2026 年 7 月 18 日起停止販售。消費者可持發票退貨。",
    selectedText: "青河市衛生局公告清泉食品 A17 批次自 2026 年 7 月 18 日起停止販售。",
  },
  {
    sampleId: "admit-en-official-recall",
    language: "en",
    expectedDecision: "admit",
    title: "Harbor Foods lot A17 recall",
    context: "The Northbridge Health Office recalled Harbor Foods lot A17 on July 18, 2026. Customers may return it with a receipt.",
    selectedText: "The Northbridge Health Office recalled Harbor Foods lot A17 on July 18, 2026.",
  },
  {
    sampleId: "admit-zh-security-boundary",
    language: "zh-TW",
    expectedDecision: "admit",
    title: "瀏覽器安全限制",
    context: "北港瀏覽器只允許已授權的安全來源使用裝置憑證 API。一般 HTTP 頁面無法呼叫此介面。",
    selectedText: "北港瀏覽器只允許已授權的安全來源使用裝置憑證 API。",
  },
  {
    sampleId: "admit-en-security-boundary",
    language: "en",
    expectedDecision: "admit",
    title: "Browser security boundary",
    context: "Northbridge Browser allows only authorized secure origins to use the device credential API. Ordinary HTTP pages cannot call it.",
    selectedText: "Northbridge Browser allows only authorized secure origins to use the device credential API.",
  },
  {
    sampleId: "admit-zh-support-deadline",
    language: "zh-TW",
    expectedDecision: "admit",
    title: "支援期限公告",
    context: "遠帆軟體宣布 4.2 版的安全更新支援將於 2026 年 12 月 31 日結束。使用者應在期限前升級。",
    selectedText: "遠帆軟體宣布 4.2 版的安全更新支援將於 2026 年 12 月 31 日結束。",
  },
  {
    sampleId: "admit-en-support-deadline",
    language: "en",
    expectedDecision: "admit",
    title: "Support deadline notice",
    context: "Far Harbor Software will end security-update support for version 4.2 on December 31, 2026. Users should upgrade before then.",
    selectedText: "Far Harbor Software will end security-update support for version 4.2 on December 31, 2026.",
  },
  {
    sampleId: "reject-zh-basic-definition",
    language: "zh-TW",
    expectedDecision: "reject",
    title: "壓縮串流 API",
    context: "壓縮串流 API 提供 JavaScript 介面，用來壓縮或解壓縮資料串流。以下範例示範基本用法。",
    selectedText: "壓縮串流 API 提供 JavaScript 介面，用來壓縮或解壓縮資料串流。",
  },
  {
    sampleId: "reject-en-basic-definition",
    language: "en",
    expectedDecision: "reject",
    title: "Compression Streams API",
    context: "The Compression Streams API provides a JavaScript API for compressing and decompressing streams of data. The example shows ordinary usage.",
    selectedText: "The Compression Streams API provides a JavaScript API for compressing and decompressing streams of data.",
  },
  {
    sampleId: "reject-zh-release-date",
    language: "zh-TW",
    expectedDecision: "reject",
    title: "3.11 版新功能",
    context: "Python 3.11 於 2022 年 10 月 24 日發布。這個頁面列出語言與標準函式庫的變更。",
    selectedText: "Python 3.11 於 2022 年 10 月 24 日發布。",
  },
  {
    sampleId: "reject-en-release-date",
    language: "en",
    expectedDecision: "reject",
    title: "What's New in Python 3.11",
    context: "Python 3.11 was released on October 24, 2022. This page lists language and standard-library changes.",
    selectedText: "Python 3.11 was released on October 24, 2022.",
  },
  {
    sampleId: "reject-zh-catalog-metadata",
    language: "zh-TW",
    expectedDecision: "reject",
    title: "古騰堡電子書目錄",
    context: "原始出版：海港出版社，1900 年。電子書發布日期：2026 年 7 月 20 日。",
    selectedText: "原始出版：海港出版社，1900 年。",
  },
  {
    sampleId: "reject-en-catalog-metadata",
    language: "en",
    expectedDecision: "reject",
    title: "Project Gutenberg catalog",
    context: "Original Publication: Harbor Press, 1900. Ebook release date: July 20, 2026.",
    selectedText: "Original Publication: Harbor Press, 1900.",
  },
];

function option(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function required(name: string): string {
  const value = option(name);
  if (!value) throw new Error(`Missing ${name}`);
  return value;
}

function boundedInteger(name: string, fallback: number, minimum: number, maximum: number): number {
  const value = Number(option(name) ?? fallback);
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new Error(`Invalid ${name}`);
  }
  return value;
}

function responseMode(): StructuredOutputMode {
  const value = option("--structured-output-mode") ?? "json_schema";
  if (value !== "json_schema" && value !== "json_object") {
    throw new Error("Invalid --structured-output-mode");
  }
  return value;
}

if (!process.argv.includes("--confirm-synthetic-model-send")) {
  throw new Error("Missing --confirm-synthetic-model-send");
}

const outputPath = path.resolve(required("--output"));
const endpoint = required("--endpoint");
const model = required("--model");
const structuredOutputMode = responseMode();
const concurrency = boundedInteger("--concurrency", 2, 1, 4);
const timeoutMs = boundedInteger("--timeout-ms", 30_000, 5_000, 120_000);
if (!outputPath.includes(`${path.sep}tmp${path.sep}private-data${path.sep}runs${path.sep}`)) {
  throw new Error("Action admission preflight output must stay under tmp/private-data/runs");
}
if (fs.existsSync(outputPath)) throw new Error("Action admission preflight output already exists");

const originalFetch = globalThis.fetch;
const guardedFetch = installInvestigationAdapterProtocolSmokeNetworkGuard(
  endpoint,
  originalFetch.bind(globalThis),
);
let modelRequests = 0;
globalThis.fetch = (async (input, init) => {
  modelRequests += 1;
  return guardedFetch(input, init);
}) as typeof fetch;

const startedAt = new Date().toISOString();
const rows = new Array<Record<string, unknown>>(fixtures.length);
let cursor = 0;
let representativeBody:
  | ReturnType<typeof buildTierBGeneralPageInvestigationActionAdmissionChatBody>
  | undefined;

function requestFor(fixture: Fixture): TierBGeneralPageInvestigationActionAdmissionRequest {
  const start = fixture.context.indexOf(fixture.selectedText);
  if (start < 0) throw new Error(`Fixture ${fixture.sampleId} is not locally grounded`);
  return {
    endpoint,
    model,
    structuredOutputMode,
    apiKey: process.env.TRULY_PRIVATE_EVAL_API_KEY,
    timeoutMs,
    selection: {
      candidateId: "span:0",
      exactClaim: fixture.selectedText,
      sourceQuote: fixture.selectedText,
      start,
      end: start + fixture.selectedText.length,
    },
    authorizedSourceContext: fixture.context,
    source: {
      title: fixture.title,
      sourceName: "Synthetic source",
      url: `https://synthetic.invalid/${fixture.sampleId}`,
    },
  };
}

async function evaluate(fixture: Fixture): Promise<Record<string, unknown>> {
  const request = requestFor(fixture);
  representativeBody ??= buildTierBGeneralPageInvestigationActionAdmissionChatBody(request);
  const started = Date.now();
  const result = await callTierBGeneralPageInvestigationActionAdmission(request);
  return {
    sampleId: fixture.sampleId,
    language: fixture.language,
    expectedDecision: fixture.expectedDecision,
    protocolOk: result.ok,
    decision: result.value?.decision ?? null,
    correct: result.ok && result.value?.decision === fixture.expectedDecision,
    latencyMs: Date.now() - started,
    finishReason: result.finishReason,
    usage: result.usage,
    error: result.error,
    raw: result.raw,
  };
}

async function worker(): Promise<void> {
  while (true) {
    const index = cursor++;
    if (index >= fixtures.length) return;
    rows[index] = await evaluate(fixtures[index]);
  }
}

try {
  await Promise.all(Array.from({ length: concurrency }, () => worker()));
} finally {
  globalThis.fetch = originalFetch;
}

if (!representativeBody) throw new Error("No representative Admission request body");
const protocolSucceeded = rows.filter((row) => row.protocolOk === true).length;
const correct = rows.filter((row) => row.correct === true).length;
const admitCorrect = rows.filter((row) =>
  row.expectedDecision === "admit" && row.correct === true).length;
const rejectCorrect = rows.filter((row) =>
  row.expectedDecision === "reject" && row.correct === true).length;
const passed = protocolSucceeded === fixtures.length && correct === fixtures.length;
const repoRoot = execFileSync("git", ["rev-parse", "--show-toplevel"], {
  encoding: "utf8",
}).trim();
const diff = execFileSync("git", ["diff", "--binary", "HEAD"], {
  cwd: repoRoot,
  encoding: "utf8",
  maxBuffer: 16 * 1024 * 1024,
});
const responseSchema = representativeBody.response_format?.type === "json_schema"
  ? representativeBody.response_format.json_schema.schema
  : undefined;
const artifact = {
  schemaVersion: 1,
  task: "general_page_investigation_action_admission_synthetic_preflight",
  split: "synthetic-dev",
  passed,
  candidate: {
    commit: execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: repoRoot,
      encoding: "utf8",
    }).trim(),
    worktreeDirty: diff.length > 0,
    diffSha256: diff.length > 0 ? sha256Text(diff) : undefined,
  },
  model: {
    provider: "openai-compatible",
    endpoint,
    name: model,
    responseFormat: structuredOutputMode,
    temperature: representativeBody.temperature,
    maxTokens: representativeBody.max_tokens,
    timeoutMs,
    concurrency,
  },
  contract: {
    schemaSha256: responseSchema ? sha256CanonicalJson(responseSchema) : undefined,
    systemPromptSha256: sha256Text(buildGeneralPageInvestigationActionAdmissionSystemPrompt()),
    fixtureSetSha256: sha256CanonicalJson(fixtures),
    modelAuthoredFields: ["decision"],
    repairPolicy: "none_one_shot",
  },
  data: {
    category: "synthetic-only",
    sampleCount: fixtures.length,
    sourceLanguages: { "zh-TW": 6, en: 6 },
    expectedAdmit: fixtures.filter(({ expectedDecision }) => expectedDecision === "admit").length,
    expectedReject: fixtures.filter(({ expectedDecision }) => expectedDecision === "reject").length,
  },
  counts: {
    protocolSucceeded,
    protocolFailed: fixtures.length - protocolSucceeded,
    correct,
    incorrect: fixtures.length - correct,
    admitCorrect,
    rejectCorrect,
  },
  networkBoundary: {
    modelRequests,
    publicSearchRequests: 0,
    actionsOpened: 0,
    redirects: "error",
  },
  startedAt,
  completedAt: new Date().toISOString(),
  rows,
};

fs.mkdirSync(path.dirname(outputPath), { recursive: true, mode: 0o700 });
fs.writeFileSync(outputPath, `${JSON.stringify(artifact, null, 2)}\n`, {
  flag: "wx",
  mode: 0o600,
});
console.log(JSON.stringify({
  outputPath,
  passed,
  counts: artifact.counts,
  contract: artifact.contract,
}, null, 2));
if (!passed) process.exitCode = 2;
