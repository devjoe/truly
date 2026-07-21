import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { execFileSync } from "node:child_process";

import { buildInvestigationSpanCandidates } from "../src/lib/investigation-span-candidate";
import { buildGeneralPageInvestigationActionPresentation } from "../src/lib/general-page-investigation-span-adapter";
import {
  buildTierBGeneralPageInvestigationSpanAdapterChatBody,
  callTierBGeneralPageInvestigationSpanAdapter,
} from "../src/lib/tier-b-client";
import type { Lang } from "../src/lib/types";
import {
  buildInvestigationAdapterProtocolSmokeFixtures,
  installInvestigationAdapterProtocolSmokeNetworkGuard,
  sha256CanonicalJson,
} from "./lib/private-general-page-investigation-adapter-smoke.mjs";
import { sha256Text } from "./lib/private-general-page-semantic-audit.mjs";

type FixtureKind = "prepared" | "abstain" | "attributed" | "compound" | "routine-fact";
type StructuredOutputMode = "json_schema" | "json_object";

interface SyntheticFixture {
  sampleId: string;
  dataCategory: "synthetic-only";
  language: Lang;
  fixtureKind: FixtureKind;
  groundingText: string;
  source: {
    title?: string;
    authorName?: string;
    sourceName?: string;
    publishedAt?: string;
    url?: string;
  };
}

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
  if (!Number.isInteger(value) || value < minimum || value > maximum) throw new Error(`Invalid ${name}`);
  return value;
}

function structuredOutputMode(): StructuredOutputMode {
  const value = option("--structured-output-mode") ?? "json_schema";
  if (value !== "json_schema" && value !== "json_object") {
    throw new Error("Invalid --structured-output-mode");
  }
  return value;
}

function outputLanguageFor(fixture: SyntheticFixture, index: number): Lang {
  const languageIndex = fixture.language === "zh-TW" ? index : index - 15;
  return languageIndex % 3 === 0 ? "en" : "zh-TW";
}

function looksLikeLanguage(value: string, lang: Lang): boolean {
  if (lang === "zh-TW") return /\p{Script=Han}/u.test(value);
  return (value.match(/\b[A-Za-z][A-Za-z'-]*\b/gu) ?? []).length >= 2;
}

function expectedDecision(fixture: SyntheticFixture): "prepared" | "abstain" {
  return fixture.fixtureKind === "abstain" ? "abstain" : "prepared";
}

if (!process.argv.includes("--confirm-synthetic-model-send")) {
  throw new Error("Missing --confirm-synthetic-model-send");
}

const outputPath = path.resolve(required("--output"));
const endpoint = required("--endpoint");
const model = required("--model");
const concurrency = boundedInteger("--concurrency", 2, 1, 4);
const timeoutMs = boundedInteger("--timeout-ms", 60_000, 5_000, 120_000);
const responseFormat = structuredOutputMode();
if (!outputPath.includes(`${path.sep}tmp${path.sep}private-data${path.sep}runs${path.sep}`)) {
  throw new Error("Synthetic span Adapter preflight output must stay under tmp/private-data/runs");
}
if (fs.existsSync(outputPath)) throw new Error("Preflight output path already exists");

const fixtures = buildInvestigationAdapterProtocolSmokeFixtures() as SyntheticFixture[];
const positiveKinds = new Set<FixtureKind>(["prepared", "attributed", "compound", "routine-fact"]);
const startedAt = new Date().toISOString();
const results = new Array(fixtures.length);
let cursor = 0;
let modelRequests = 0;

const originalFetch = globalThis.fetch;
const guardedFetch = installInvestigationAdapterProtocolSmokeNetworkGuard(
  endpoint,
  originalFetch.bind(globalThis),
);
globalThis.fetch = (async (input, init) => {
  modelRequests += 1;
  return guardedFetch(input, init);
}) as typeof fetch;

async function evaluate(fixture: SyntheticFixture, index: number) {
  const outputLang = outputLanguageFor(fixture, index);
  const candidates = buildInvestigationSpanCandidates(fixture.groundingText, {
    maxCandidates: 48,
    maxCharacters: 240,
  });
  const request = {
    endpoint,
    model,
    structuredOutputMode: responseFormat,
    apiKey: process.env.TRULY_PRIVATE_EVAL_API_KEY,
    timeoutMs,
    candidates,
    targetKind: "page" as const,
    source: fixture.source,
    sourceLang: fixture.language,
    outputLang,
  };
  const result = await callTierBGeneralPageInvestigationSpanAdapter(request);
  const expected = expectedDecision(fixture);
  const selections = result.value?.selections ?? [];
  const decision = selections.length > 0 ? "prepared" : "abstain";
  const presentations = selections.map((selection) =>
    buildGeneralPageInvestigationActionPresentation(selection, {
      outputLang,
      source: fixture.source,
    }));
  const localeCorrect = presentations.every((presentation) =>
    looksLikeLanguage(presentation.evidenceHint, outputLang) &&
    looksLikeLanguage(presentation.askAiPrompt, outputLang));
  return {
    schemaVersion: 1,
    sampleId: fixture.sampleId,
    fixtureKind: fixture.fixtureKind,
    sourceLang: fixture.language,
    outputLang,
    expectedDecision: expected,
    candidateCount: candidates.length,
    protocolOk: result.ok,
    decision,
    decisionCorrect: decision === expected,
    localeCorrect,
    selectionCount: selections.length,
    finishReason: result.finishReason,
    usage: result.usage,
    error: result.error,
    issue: result.issue,
    attempts: result.attempts,
    raw: result.raw,
    value: result.value,
    presentations,
  };
}

async function worker() {
  while (true) {
    const index = cursor++;
    if (index >= fixtures.length) return;
    results[index] = await evaluate(fixtures[index], index);
  }
}

try {
  await Promise.all(Array.from({ length: concurrency }, () => worker()));
} finally {
  globalThis.fetch = originalFetch;
}

const protocolSucceeded = results.filter((row) => row.protocolOk).length;
const positiveRows = results.filter((_, index) => positiveKinds.has(fixtures[index].fixtureKind));
const negativeRows = results.filter((_, index) => !positiveKinds.has(fixtures[index].fixtureKind));
const positivePrepared = positiveRows.filter((row) => row.decision === "prepared").length;
const negativeAbstained = negativeRows.filter((row) => row.decision === "abstain").length;
const localeEligible = results.filter((row) => row.protocolOk && row.decision === "prepared");
const localeCorrect = localeEligible.filter((row) => row.localeCorrect).length;
const gates = {
  protocol: { result: protocolSucceeded, required: fixtures.length, pass: protocolSucceeded === fixtures.length },
  positivePrepared: {
    result: positivePrepared,
    required: positiveRows.length,
    denominator: positiveRows.length,
    pass: positivePrepared === positiveRows.length,
  },
  negativeAbstained: { result: negativeAbstained, required: negativeRows.length, denominator: negativeRows.length, pass: negativeAbstained === negativeRows.length },
  locale: {
    result: localeCorrect,
    denominator: localeEligible.length,
    requiredRate: 0.95,
    pass: localeEligible.length > 0 && localeCorrect / localeEligible.length >= 0.95,
  },
  candidatesAvailable: {
    result: results.filter((row) => row.candidateCount > 0).length,
    required: fixtures.length,
    pass: results.every((row) => row.candidateCount > 0),
  },
};
const passed = Object.values(gates).every((gate) => gate.pass);
const repoRoot = execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();
const diff = execFileSync("git", ["diff", "--binary", "HEAD"], {
  cwd: repoRoot,
  encoding: "utf8",
  maxBuffer: 16 * 1024 * 1024,
});
const representative = fixtures[0];
const representativeCandidates = buildInvestigationSpanCandidates(representative.groundingText, {
  maxCandidates: 48,
  maxCharacters: 240,
});
const body = buildTierBGeneralPageInvestigationSpanAdapterChatBody({
  endpoint,
  model,
  structuredOutputMode: responseFormat,
  candidates: representativeCandidates,
  targetKind: "page",
  source: representative.source,
  sourceLang: representative.language,
  outputLang: outputLanguageFor(representative, 0),
});
const artifact = {
  schemaVersion: 1,
  task: "general_page_investigation_span_adapter_synthetic_preflight",
  split: "synthetic-dev",
  passed,
  candidate: {
    commit: execFileSync("git", ["rev-parse", "HEAD"], { cwd: repoRoot, encoding: "utf8" }).trim(),
    worktreeDirty: diff.length > 0,
    diffSha256: diff.length > 0 ? sha256Text(diff) : undefined,
  },
  model: {
    provider: "openai-compatible",
    endpoint,
    name: model,
    responseFormat,
    temperature: body.temperature,
    maxTokens: body.max_tokens,
    timeoutMs,
    concurrency,
  },
  contract: {
    schemaSha256: body.response_format?.type === "json_schema"
      ? sha256CanonicalJson(body.response_format.json_schema.schema)
      : undefined,
    systemPromptSha256: sha256Text(String(body.messages[0]?.content ?? "")),
    fixtureSetSha256: sha256CanonicalJson(fixtures),
    sourceOwnership: "local_exact_span",
    modelAuthoredFields: ["selectedCandidateIds"],
    locallyOwnedFields: ["exactClaim", "sourceQuote", "displayClaim", "evidenceHint", "askAiPrompt"],
    repairPolicy: "none_one_shot",
  },
  data: {
    category: "synthetic-only",
    sampleCount: fixtures.length,
    sourceLanguages: { "zh-TW": 15, en: 15 },
    outputLanguages: {
      "zh-TW": results.filter((row) => row.outputLang === "zh-TW").length,
      en: results.filter((row) => row.outputLang === "en").length,
    },
    positiveCount: positiveRows.length,
    negativeCount: negativeRows.length,
  },
  counts: {
    protocolSucceeded,
    protocolFailed: fixtures.length - protocolSucceeded,
    positivePrepared,
    negativeAbstained,
    localeCorrect,
    localeEligible: localeEligible.length,
    oneShotRows: results.filter((row) => row.attempts === 1).length,
  },
  gates,
  networkBoundary: { modelRequests, publicSearchRequests: 0, actionsOpened: 0, redirects: "error" },
  startedAt,
  completedAt: new Date().toISOString(),
  results,
};

fs.mkdirSync(path.dirname(outputPath), { recursive: true, mode: 0o700 });
fs.writeFileSync(outputPath, `${JSON.stringify(artifact, null, 2)}\n`, { flag: "wx", mode: 0o600 });
console.log(JSON.stringify({ outputPath, passed, counts: artifact.counts, gates }, null, 2));
if (!passed) process.exitCode = 2;
