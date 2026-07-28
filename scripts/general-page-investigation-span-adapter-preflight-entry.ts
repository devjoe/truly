import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { execFileSync } from "node:child_process";

import { buildInvestigationSpanCandidates } from "../src/lib/investigation-span-candidate";
import {
  buildGeneralPageInvestigationActionPresentation,
} from "../src/lib/general-page-investigation-span-adapter";
import {
  buildGeneralPageInvestigationActionAdmissionSystemPrompt,
  resolveGeneralPageInvestigationActionTier,
} from "../src/lib/general-page-investigation-action-admission";
import {
  buildTierBGeneralPageInvestigationActionAdmissionChatBody,
  buildTierBGeneralPageInvestigationSpanAdapterChatBody,
  callTierBGeneralPageInvestigationActionAdmission,
  callTierBGeneralPageInvestigationSpanAdapter,
} from "../src/lib/tier-b-client";
import type { Lang } from "../src/lib/types";
import {
  buildInvestigationAdapterProtocolSmokeFixtures,
  installInvestigationAdapterProtocolSmokeNetworkGuard,
  sha256CanonicalJson,
} from "./lib/private-general-page-investigation-adapter-smoke.mjs";
import { sha256Text } from "./lib/private-general-page-semantic-audit.mjs";

type FixtureKind =
  | "prepared"
  | "abstain"
  | "attributed"
  | "compound"
  | "routine-fact"
  | "hard-boundary";
type GateRole = "positive_control" | "soft_negative" | "hard_boundary_sentinel";
type ExpectedAction = "primary" | "exploratory" | "none";
type HardBoundaryKind = "incomplete_span" | "untrusted_instruction" | "private_data_request";
type StructuredOutputMode = "json_schema" | "json_object";

interface SyntheticFixture {
  sampleId: string;
  dataCategory: "synthetic-only";
  language: Lang;
  fixtureKind: FixtureKind;
  gateRole: GateRole;
  expectedAction: ExpectedAction;
  hardBoundaryKind?: HardBoundaryKind;
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

if (!process.argv.includes("--confirm-synthetic-model-send")) {
  throw new Error("Missing --confirm-synthetic-model-send");
}

const outputPath = path.resolve(required("--output"));
const endpoint = required("--endpoint");
const model = required("--model");
const concurrency = boundedInteger("--concurrency", 2, 1, 4);
const timeoutMs = boundedInteger("--timeout-ms", 60_000, 5_000, 120_000);
const withAdmission = process.argv.includes("--with-admission");
const admissionTimeoutMs = boundedInteger("--admission-timeout-ms", 10_000, 5_000, 30_000);
const responseFormat = structuredOutputMode();
if (!outputPath.includes(`${path.sep}tmp${path.sep}private-data${path.sep}runs${path.sep}`)) {
  throw new Error("Synthetic span Adapter preflight output must stay under tmp/private-data/runs");
}
if (fs.existsSync(outputPath)) throw new Error("Preflight output path already exists");

const fixtures = buildInvestigationAdapterProtocolSmokeFixtures() as SyntheticFixture[];
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
  const started = Date.now();
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
    authorizedSourceContext: fixture.groundingText,
    source: fixture.source,
    sourceLang: fixture.language,
    outputLang,
    // Gate A measures provider first-attempt correctness. Runtime recovery is
    // verified separately and must never turn a failed first response green.
    maxProtocolAttempts: 1 as const,
  };
  const selectorStarted = Date.now();
  const result = await callTierBGeneralPageInvestigationSpanAdapter(request);
  const selectorLatencyMs = Date.now() - selectorStarted;
  const gateRole = fixture.gateRole;
  const expectedAction = fixture.expectedAction;
  const selections = result.value?.selections ?? [];
  const selection = selections[0];
  const admissionStarted = Date.now();
  const admission = withAdmission && result.ok && selection
    ? await callTierBGeneralPageInvestigationActionAdmission({
        endpoint,
        model,
        structuredOutputMode: responseFormat,
        apiKey: process.env.TRULY_PRIVATE_EVAL_API_KEY,
        timeoutMs: admissionTimeoutMs,
        selection,
        authorizedSourceContext: fixture.groundingText,
        source: fixture.source,
      })
    : null;
  const admissionLatencyMs = admission ? Date.now() - admissionStarted : 0;
  const protocolOk = result.ok && (!withAdmission || !selection || admission?.ok === true);
  const finalTier = !withAdmission
    ? selection?.presentationTier ?? null
    : selection && admission?.value
      ? resolveGeneralPageInvestigationActionTier(
          selection.presentationTier,
          admission.value,
        )
      : null;
  const admittedSelections = selection && finalTier
    ? [{ ...selection, presentationTier: finalTier }]
    : [];
  const decision = admittedSelections.length > 0 ? "prepared" : "abstain";
  const actualAction: ExpectedAction = admittedSelections[0]?.presentationTier ?? "none";
  const presentations = admittedSelections.map((selected) =>
    buildGeneralPageInvestigationActionPresentation(selected, {
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
    gateRole,
    hardBoundaryKind: fixture.hardBoundaryKind,
    sourceLang: fixture.language,
    outputLang,
    expectedAction,
    candidateCount: candidates.length,
    protocolOk,
    decision,
    decisionCorrect: actualAction === expectedAction,
    actualAction,
    localeCorrect,
    selectionCount: selections.length,
    finishReason: result.finishReason,
    usage: result.usage,
    error: result.error,
    issue: result.issue,
    attempts: result.attempts,
    selectorLatencyMs,
    admissionLatencyMs,
    latencyMs: Date.now() - started,
    raw: result.raw,
    value: result.value,
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
const primaryRows = results.filter((row) => row.expectedAction === "primary");
const exploratoryRows = results.filter((row) => row.expectedAction === "exploratory");
const noneRows = results.filter((row) => row.expectedAction === "none");
const primaryCorrect = primaryRows.filter((row) => row.actualAction === "primary").length;
const exploratoryCorrect = exploratoryRows.filter((row) => row.actualAction === "exploratory").length;
const exploratoryVisible = exploratoryRows.filter((row) => row.actualAction !== "none").length;
const noneCorrect = noneRows.filter((row) => row.actualAction === "none").length;
const exploratoryCorrectByLanguage = {
  "zh-TW": exploratoryRows.filter((row) =>
    row.sourceLang === "zh-TW" && row.actualAction === "exploratory").length,
  en: exploratoryRows.filter((row) =>
    row.sourceLang === "en" && row.actualAction === "exploratory").length,
};
const localeEligible = results.filter((row) => row.protocolOk && row.decision === "prepared");
const localeCorrect = localeEligible.filter((row) => row.localeCorrect).length;
const latencyValues = results.map((row) => row.latencyMs).toSorted((left, right) => left - right);
const latencyPercentile = (percentile: number) =>
  latencyValues[Math.max(0, Math.ceil(latencyValues.length * percentile) - 1)] ?? 0;
const admissionRequested = results.filter((row) => row.admission).length;
const admissionProtocolSucceeded = results.filter((row) => row.admission?.ok === true).length;
const gates = {
  protocol: { result: protocolSucceeded, required: fixtures.length, pass: protocolSucceeded === fixtures.length },
  primaryCorrect: {
    result: primaryCorrect,
    required: primaryRows.length,
    denominator: primaryRows.length,
    pass: primaryCorrect === primaryRows.length,
  },
  exploratoryCorrect: {
    result: exploratoryCorrect,
    visible: exploratoryVisible,
    required: 7,
    denominator: exploratoryRows.length,
    requiredVisible: exploratoryRows.length,
    byLanguage: exploratoryCorrectByLanguage,
    requiredPerLanguage: 3,
    pass: exploratoryVisible === exploratoryRows.length &&
      exploratoryCorrect >= 7 &&
      Object.values(exploratoryCorrectByLanguage).every((count) => count >= 3),
  },
  noneCorrect: {
    result: noneCorrect,
    required: noneRows.length,
    denominator: noneRows.length,
    pass: noneCorrect === noneRows.length,
  },
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
  ...(withAdmission
    ? {
        composedLatency: {
          p95Ms: latencyPercentile(0.95),
          maxMs: latencyValues.at(-1) ?? 0,
          requiredP95Ms: 20_000,
          requiredMaxMs: 40_000,
          pass: latencyPercentile(0.95) <= 20_000 && (latencyValues.at(-1) ?? 0) <= 40_000,
        },
      }
    : {}),
};
const diagnostics = {
  primaryUnderstated: results.filter((row) =>
    row.expectedAction === "primary" && row.actualAction === "exploratory").length,
  exploratoryOverstated: results.filter((row) =>
    row.expectedAction === "exploratory" && row.actualAction === "primary").length,
  exploratoryOverstatedSamples: results.filter((row) =>
    row.expectedAction === "exploratory" && row.actualAction === "primary")
    .map((row) => row.sampleId),
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
  authorizedSourceContext: representative.groundingText,
  source: representative.source,
  sourceLang: representative.language,
  outputLang: outputLanguageFor(representative, 0),
});
const representativeSelection = {
  candidateId: representativeCandidates[0].id,
  presentationTier: "primary" as const,
  exactClaim: representativeCandidates[0].exactText,
  sourceQuote: representativeCandidates[0].exactText,
  start: representativeCandidates[0].start,
  end: representativeCandidates[0].end,
};
const admissionBody = withAdmission
  ? buildTierBGeneralPageInvestigationActionAdmissionChatBody({
      endpoint,
      model,
      structuredOutputMode: responseFormat,
      selection: representativeSelection,
      authorizedSourceContext: representative.groundingText,
      source: representative.source,
    })
  : undefined;
const artifact = {
  schemaVersion: 1,
  task: withAdmission
    ? "general_page_investigation_two_stage_synthetic_preflight"
    : "general_page_investigation_span_adapter_synthetic_preflight",
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
    ...(withAdmission ? {
      admissionMaxTokens: admissionBody?.max_tokens,
      admissionTimeoutMs,
    } : {}),
    timeoutMs,
    concurrency,
  },
  contract: {
    schemaSha256: body.response_format?.type === "json_schema"
      ? sha256CanonicalJson(body.response_format.json_schema.schema)
      : undefined,
    systemPromptSha256: sha256Text(String(body.messages[0]?.content ?? "")),
    ...(withAdmission ? {
      admissionSystemPromptSha256: sha256Text(
        buildGeneralPageInvestigationActionAdmissionSystemPrompt(),
      ),
    } : {}),
    fixtureSetSha256: sha256CanonicalJson(fixtures),
    sourceOwnership: "local_exact_span",
    modelAuthoredFields: withAdmission
      ? ["candidateId", "presentationTier", "decision"]
      : ["candidateId", "presentationTier"],
    locallyOwnedFields: ["exactClaim", "sourceQuote", "displayClaim", "evidenceHint", "askAiPrompt"],
    repairPolicy: "none_one_shot",
    protocolRetryPolicy: "disabled_for_release_gate",
    semanticGatePolicy: "exact_primary_exploratory_none_capability",
  },
  data: {
    category: "synthetic-only",
    sampleCount: fixtures.length,
    sourceLanguages: { "zh-TW": 15, en: 15 },
    outputLanguages: {
      "zh-TW": results.filter((row) => row.outputLang === "zh-TW").length,
      en: results.filter((row) => row.outputLang === "en").length,
    },
    expectedPrimaryCount: primaryRows.length,
    expectedExploratoryCount: exploratoryRows.length,
    expectedNoneCount: noneRows.length,
  },
  counts: {
    protocolSucceeded,
    protocolFailed: fixtures.length - protocolSucceeded,
    primaryCorrect,
    exploratoryCorrect,
    exploratoryVisible,
    noneCorrect,
    localeCorrect,
    localeEligible: localeEligible.length,
    oneShotRows: results.filter((row) => row.attempts === 1).length,
    ...(withAdmission ? {
      admissionRequested,
      admissionProtocolSucceeded,
      admissionProtocolFailed: admissionRequested - admissionProtocolSucceeded,
      admissionAdmitted: results.filter((row) => row.admission?.decision === "admit").length,
      admissionRejected: results.filter((row) => row.admission?.decision === "reject").length,
      latencyP50Ms: latencyPercentile(0.5),
      latencyP95Ms: latencyPercentile(0.95),
      latencyMaxMs: latencyValues.at(-1) ?? 0,
    } : {}),
  },
  gates,
  diagnostics,
  networkBoundary: { modelRequests, publicSearchRequests: 0, actionsOpened: 0, redirects: "error" },
  startedAt,
  completedAt: new Date().toISOString(),
  results,
};

fs.mkdirSync(path.dirname(outputPath), { recursive: true, mode: 0o700 });
fs.writeFileSync(outputPath, `${JSON.stringify(artifact, null, 2)}\n`, { flag: "wx", mode: 0o600 });
console.log(JSON.stringify({
  outputPath,
  passed,
  counts: artifact.counts,
  gates,
  diagnostics,
}, null, 2));
if (!passed) process.exitCode = 2;
