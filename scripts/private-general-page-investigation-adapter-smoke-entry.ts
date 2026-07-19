import fs from "node:fs";
import process from "node:process";
import { execFileSync } from "node:child_process";

import { buildGeneralPageModelContext } from "../src/lib/general-page-model-context";
import {
  buildTierBGeneralPageBriefChatBody,
  buildTierBGeneralPageInvestigationAdapterChatBody,
  callTierBGeneralPageInvestigationAdapter,
  type TierBChatBody,
  type TierBGeneralPageInvestigationAdapterRequest,
} from "../src/lib/tier-b-client";
import type { ReadingSurface } from "../src/lib/reading-surface-types";
import type { Lang } from "../src/lib/types";
import {
  assertPrivateSemanticAuditFetchTarget,
  hashPrivateSemanticAuditCoreFiles,
  semanticAuditCompletionsUrl,
  sha256Text,
} from "./lib/private-general-page-semantic-audit.mjs";
import {
  INVESTIGATION_ADAPTER_PROTOCOL_SMOKE_CONCURRENCY,
  INVESTIGATION_ADAPTER_PROTOCOL_SMOKE_SAMPLE_COUNT,
  INVESTIGATION_ADAPTER_PROTOCOL_SMOKE_TIMEOUT_MS,
  assertInvestigationAdapterProtocolSmokeOutputPath,
  buildInvestigationAdapterProtocolSmokeFixtures,
  buildInvestigationAdapterProtocolSmokeManifest,
  installInvestigationAdapterProtocolSmokeNetworkGuard,
  sha256CanonicalJson,
  writeInvestigationAdapterProtocolSmokeMeta,
} from "./lib/private-general-page-investigation-adapter-smoke.mjs";

interface SyntheticFixture {
  schemaVersion: 1;
  sampleId: string;
  dataCategory: "synthetic-only";
  language: Lang;
  fixtureKind: "prepared" | "abstain" | "attributed" | "compound" | "low-risk";
  candidateClaim: TierBGeneralPageInvestigationAdapterRequest["candidateClaim"];
  groundingText: string;
  source: NonNullable<TierBGeneralPageInvestigationAdapterRequest["source"]>;
}

interface ProtocolOutcome {
  ok: boolean;
  decision?: "prepared" | "abstain";
  error?: string;
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

function compactIdentifier(name: string, value: string): string {
  if (!/^[a-z0-9][a-z0-9._-]{2,80}$/i.test(value)) throw new Error(`Invalid ${name}`);
  return value;
}

function gitOutput(repoRoot: string, args: string[]): string {
  return execFileSync("git", args, {
    cwd: repoRoot,
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
  });
}

function bodySystemSha256(body: TierBChatBody): string {
  const system = body.messages.find((message) => message.role === "system")?.content ?? "";
  return sha256Text(typeof system === "string" ? system : JSON.stringify(system));
}

function surfaceFor(fixture: SyntheticFixture): ReadingSurface {
  return {
    id: fixture.sampleId,
    kind: "web-page",
    source: "general",
    url: fixture.source.url ?? `https://synthetic.example.test/${fixture.sampleId}`,
    canonicalUrl: fixture.source.url,
    title: fixture.source.title,
    sourceName: fixture.source.sourceName,
    publishedAt: fixture.source.publishedAt,
    mainText: fixture.groundingText,
    links: [],
    images: [],
    extraction: { method: "semantic-html", status: "complete", warnings: [] },
  };
}

if (!process.argv.includes("--confirm-synthetic-model-send")) {
  throw new Error("Missing --confirm-synthetic-model-send");
}

const outputArg = required("--output");
const endpoint = required("--endpoint");
const model = required("--model");
const runId = compactIdentifier("--run-id", required("--run-id"));
const datasetVersion = compactIdentifier("--dataset-version", required("--dataset-version"));
if (model !== "qwen3.6-35b") throw new Error("--model must be qwen3.6-35b for the frozen protocol smoke");

const repoRoot = gitOutput(process.cwd(), ["rev-parse", "--show-toplevel"]).trim();
const outputPath = assertInvestigationAdapterProtocolSmokeOutputPath(outputArg, repoRoot);
if (fs.existsSync(outputPath)) throw new Error("Protocol smoke output already exists; a run path may be used only once");

const candidateCommit = gitOutput(repoRoot, ["rev-parse", "HEAD"]).trim();
if (!/^[a-f0-9]{40}$/.test(candidateCommit)) throw new Error("Protocol smoke requires a full candidate commit hash");
const worktreeStatus = gitOutput(repoRoot, ["status", "--porcelain=v1", "--untracked-files=all"]);
if (worktreeStatus.length > 0) throw new Error("Protocol smoke requires a clean candidate worktree");

const allowedCompletionsUrl = semanticAuditCompletionsUrl(endpoint);
assertPrivateSemanticAuditFetchTarget(allowedCompletionsUrl, endpoint);
const fixtures = buildInvestigationAdapterProtocolSmokeFixtures() as SyntheticFixture[];
if (fixtures.length !== INVESTIGATION_ADAPTER_PROTOCOL_SMOKE_SAMPLE_COUNT) {
  throw new Error("Protocol smoke fixture count drifted");
}

const fixtureByLanguage = new Map<Lang, SyntheticFixture>();
for (const fixture of fixtures) {
  if (!fixtureByLanguage.has(fixture.language)) fixtureByLanguage.set(fixture.language, fixture);
}
const languages = ["en", "zh-TW"] as const;
const readingSystemSha256ByLanguage = Object.fromEntries(languages.map((language) => {
  const fixture = fixtureByLanguage.get(language);
  if (!fixture) throw new Error(`Missing synthetic fixture for ${language}`);
  const body = buildTierBGeneralPageBriefChatBody({
    endpoint,
    model,
    context: buildGeneralPageModelContext(surfaceFor(fixture)),
    allowedUse: "article_or_selection_analysis",
    outputLang: language,
    contract: "standard",
    structuredOutputMode: "json_object",
  });
  return [language, bodySystemSha256(body)];
}));
const adapterSystemSha256ByLanguage = Object.fromEntries(languages.map((language) => {
  const fixture = fixtureByLanguage.get(language);
  if (!fixture) throw new Error(`Missing synthetic fixture for ${language}`);
  const body = buildTierBGeneralPageInvestigationAdapterChatBody({
    endpoint,
    model,
    structuredOutputMode: "json_schema",
    candidateClaim: fixture.candidateClaim,
    groundingText: fixture.groundingText,
    source: fixture.source,
    outputLang: language,
  });
  return [language, bodySystemSha256(body)];
}));
const combinedPromptSha256 = sha256Text(JSON.stringify({
  readingSystemSha256ByLanguage,
  adapterSystemSha256ByLanguage,
}));

const protocolFixture = fixtures[0];
if (!protocolFixture) throw new Error("Missing protocol fixture");
const protocolBody = buildTierBGeneralPageInvestigationAdapterChatBody({
  endpoint,
  model,
  structuredOutputMode: "json_schema",
  candidateClaim: protocolFixture.candidateClaim,
  groundingText: protocolFixture.groundingText,
  source: protocolFixture.source,
  outputLang: protocolFixture.language,
});
if (protocolBody.response_format?.type !== "json_schema" ||
    protocolBody.response_format.json_schema.strict !== true) {
  throw new Error("Investigation Adapter protocol smoke requires strict json_schema response_format");
}
if (protocolBody.temperature !== 0 || protocolBody.max_tokens !== 1800) {
  throw new Error("Investigation Adapter protocol parameters drifted from the frozen smoke contract");
}
const schemaSha256 = sha256CanonicalJson(protocolBody.response_format.json_schema.schema);
const core = hashPrivateSemanticAuditCoreFiles(repoRoot);
const startedAt = new Date().toISOString();
const outcomes = new Array<ProtocolOutcome>(fixtures.length);
let cursor = 0;
let modelRequests = 0;

async function evaluateFixture(fixture: SyntheticFixture): Promise<ProtocolOutcome> {
  try {
    const result = await callTierBGeneralPageInvestigationAdapter({
      endpoint,
      model,
      structuredOutputMode: "json_schema",
      apiKey: process.env.TRULY_PRIVATE_EVAL_API_KEY,
      timeoutMs: INVESTIGATION_ADAPTER_PROTOCOL_SMOKE_TIMEOUT_MS,
      candidateClaim: fixture.candidateClaim,
      groundingText: fixture.groundingText,
      source: fixture.source,
      outputLang: fixture.language,
    });
    if (!result.ok || !result.value) {
      return { ok: false, error: result.error ?? "investigation_adapter_invalid_schema" };
    }
    return { ok: true, decision: result.value.decision };
  } catch {
    return { ok: false, error: "investigation_adapter_network_error" };
  }
}

async function worker(): Promise<void> {
  while (true) {
    const index = cursor++;
    if (index >= fixtures.length) return;
    outcomes[index] = await evaluateFixture(fixtures[index]);
  }
}

const originalFetch = globalThis.fetch;
const guardedFetch = installInvestigationAdapterProtocolSmokeNetworkGuard(
  endpoint,
  originalFetch.bind(globalThis),
);
globalThis.fetch = (async (input, init) => {
  assertPrivateSemanticAuditFetchTarget(input, endpoint);
  modelRequests += 1;
  return guardedFetch(input, init);
}) as typeof fetch;
try {
  await Promise.all(Array.from(
    { length: INVESTIGATION_ADAPTER_PROTOCOL_SMOKE_CONCURRENCY },
    () => worker(),
  ));
} finally {
  globalThis.fetch = originalFetch;
}

const manifest = buildInvestigationAdapterProtocolSmokeManifest({
  runId,
  datasetVersion,
  fixtures,
  outcomes,
  candidate: {
    commit: candidateCommit,
    coreSha256: core.coreSha256,
    coreFileSha256: core.fileSha256,
    worktreeDirty: false,
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
    temperature: protocolBody.temperature,
    adapterMaxTokens: protocolBody.max_tokens,
    timeoutMs: INVESTIGATION_ADAPTER_PROTOCOL_SMOKE_TIMEOUT_MS,
    concurrency: INVESTIGATION_ADAPTER_PROTOCOL_SMOKE_CONCURRENCY,
    responseFormat: "json_schema",
  },
  schemaSha256,
  allowedCompletionsUrl,
  modelRequests,
  startedAt,
  completedAt: new Date().toISOString(),
});
writeInvestigationAdapterProtocolSmokeMeta(outputPath, manifest);

console.log(JSON.stringify({
  result: manifest.counts.protocolFailed === 0 ? "pass" : "fail",
  runId,
  datasetVersion,
  samples: manifest.data.sampleCount,
  ...manifest.counts,
  modelRequests,
  publicSearchRequests: 0,
  actionsOpened: 0,
  output: "private-data/runs/<private>",
}, null, 2));
if (manifest.counts.protocolFailed > 0) process.exitCode = 1;
