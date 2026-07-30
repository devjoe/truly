import crypto from "node:crypto";

import {
  ABSOLUTE_MAX_MS,
  INTERACTIVE_P95_MS,
  aggregateInvestigationServiceProfiles,
  classifyInvestigationServiceProfile,
} from "./general-page-investigation-service-profile.mjs";

const REQUIRED_FORMATS = new Map([
  ["json_schema", 3],
  ["json_object", 3],
]);
const TASK = "general_page_investigation_single_pass_synthetic_preflight";

function sha256Text(value) {
  return crypto.createHash("sha256").update(value, "utf8").digest("hex");
}

function validInstant(value) {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

function validateReceipt(receipt, label, errors) {
  if (receipt.schemaVersion !== 3 || receipt.task !== TASK ||
      receipt.split !== "synthetic-dev") {
    errors.push(`${label}: wrong single-pass receipt contract`);
    return "unqualified";
  }
  if (receipt.passed !== true || receipt.compatibility !== "compatible") {
    errors.push(`${label}: single-pass compatibility did not pass`);
  }
  if (receipt.data?.sampleCount !== 30 ||
      receipt.data?.sourceLanguages?.["zh-TW"] !== 15 ||
      receipt.data?.sourceLanguages?.en !== 15 ||
      receipt.data?.expectedPrimaryCount !== 16 ||
      receipt.data?.expectedExploratoryCount !== 8 ||
      receipt.data?.expectedNoneCount !== 6) {
    errors.push(`${label}: wrong single-pass fixture counts`);
  }
  if (receipt.counts?.protocolSucceeded !== 30 ||
      receipt.counts?.protocolFailed !== 0 ||
      receipt.counts?.oneShotRows !== 30 ||
      receipt.counts?.primaryCorrect !== 16 ||
      receipt.counts?.exploratoryVisible !== 8 ||
      !Number.isInteger(receipt.counts?.exploratoryCorrect) ||
      receipt.counts.exploratoryCorrect < 7 ||
      receipt.counts.exploratoryCorrect > 8 ||
      receipt.counts?.noneCorrect !== 6) {
    errors.push(`${label}: single-pass capability or hard boundary failed`);
  }
  if (receipt.networkBoundary?.modelRequests !== 30 ||
      receipt.networkBoundary?.publicSearchRequests !== 0 ||
      receipt.networkBoundary?.actionsOpened !== 0 ||
      receipt.contract?.repairPolicy !== "none_one_shot" ||
      receipt.contract?.protocolRetryPolicy !== "disabled_for_release_gate") {
    errors.push(`${label}: wrong one-job request or external-action contract`);
  }
  if (Object.values(receipt.gates ?? {}).some((gate) => gate?.pass !== true)) {
    errors.push(`${label}: source gate did not pass`);
  }
  const exploratoryByLanguage = receipt.gates?.exploratoryCorrect?.byLanguage;
  if (receipt.gates?.exploratoryCorrect?.visible !== 8 ||
      receipt.gates?.exploratoryCorrect?.result !==
        receipt.counts?.exploratoryCorrect ||
      exploratoryByLanguage?.["zh-TW"] < 3 ||
      exploratoryByLanguage?.en < 3) {
    errors.push(`${label}: exploratory language floors or visibility disagree`);
  }
  if (receipt.diagnostics?.primaryUnderstated !== 0 ||
      !Number.isInteger(receipt.diagnostics?.exploratoryOverstated) ||
      receipt.diagnostics.exploratoryOverstated < 0 ||
      receipt.diagnostics.exploratoryOverstated > 1 ||
      !Array.isArray(receipt.diagnostics?.exploratoryOverstatedSamples) ||
      receipt.diagnostics.exploratoryOverstatedSamples.length !==
        receipt.diagnostics.exploratoryOverstated) {
    errors.push(`${label}: tier-confusion diagnostics exceed the allowance`);
  }
  const latency = receipt.performance?.composedLatency;
  const measured = classifyInvestigationServiceProfile({
    compatibility: receipt.compatibility,
    p95Ms: latency?.p95Ms,
    maxMs: latency?.maxMs,
  });
  if (latency?.interactiveP95Ms !== INTERACTIVE_P95_MS ||
      latency?.absoluteMaxMs !== ABSOLUTE_MAX_MS ||
      receipt.serviceProfile !== measured ||
      measured === "unqualified") {
    errors.push(`${label}: invalid service profile or latency evidence`);
  }
  return measured;
}

export function validateSinglePassInvestigationCeremony(
  receipts,
  expectedCandidateCommit,
) {
  const errors = [];
  if (!Array.isArray(receipts) || receipts.length !== 6) {
    errors.push(`ceremony requires exactly 6 receipts; found ${receipts?.length ?? 0}`);
  }
  if (typeof expectedCandidateCommit !== "string" ||
      !/^[a-f0-9]{40}$/u.test(expectedCandidateCommit)) {
    errors.push("invalid expected candidate commit");
  }

  const seenPaths = new Set();
  const formatCounts = new Map();
  const serviceProfileRows = new Map();
  const intervals = [];
  const sources = [];
  const overstatementSamples = new Set();
  let endpoint;
  let model;
  let promptSha256;
  let fixtureSetSha256;
  let schemaSha256;

  for (const [index, source] of (receipts ?? []).entries()) {
    const label = `receipt ${index + 1}`;
    if (!source || typeof source.path !== "string" ||
        typeof source.raw !== "string" || !source.value) {
      errors.push(`${label}: invalid source envelope`);
      continue;
    }
    if (seenPaths.has(source.path)) errors.push(`${label}: duplicate source path`);
    seenPaths.add(source.path);
    const receipt = source.value;
    const format = receipt.model?.responseFormat;
    formatCounts.set(format, (formatCounts.get(format) ?? 0) + 1);
    if (!REQUIRED_FORMATS.has(format)) {
      errors.push(`${label}: invalid structured-output mode`);
    }
    if (receipt.candidate?.commit !== expectedCandidateCommit ||
        receipt.candidate?.worktreeDirty !== false) {
      errors.push(`${label}: candidate snapshot mismatch or dirty worktree`);
    }
    if (receipt.model?.concurrency !== 2) {
      errors.push(`${label}: model concurrency must equal 2`);
    }
    endpoint ??= receipt.model?.endpoint;
    model ??= receipt.model?.name;
    promptSha256 ??= receipt.contract?.systemPromptSha256;
    fixtureSetSha256 ??= receipt.contract?.fixtureSetSha256;
    if (receipt.model?.endpoint !== endpoint || receipt.model?.name !== model) {
      errors.push(`${label}: endpoint or model drift`);
    }
    if (receipt.contract?.systemPromptSha256 !== promptSha256 ||
        receipt.contract?.fixtureSetSha256 !== fixtureSetSha256) {
      errors.push(`${label}: prompt or fixture-set drift`);
    }
    if (format === "json_schema") {
      schemaSha256 ??= receipt.contract?.schemaSha256;
      if (!schemaSha256 || receipt.contract?.schemaSha256 !== schemaSha256) {
        errors.push(`${label}: schema drift`);
      }
    }
    const profile = validateReceipt(receipt, label, errors);
    const profiles = serviceProfileRows.get(format) ?? [];
    profiles.push(profile);
    serviceProfileRows.set(format, profiles);
    for (const sampleId of receipt.diagnostics?.exploratoryOverstatedSamples ?? []) {
      if (typeof sampleId === "string") overstatementSamples.add(sampleId);
    }
    if (!validInstant(receipt.startedAt) || !validInstant(receipt.completedAt) ||
        Date.parse(receipt.completedAt) < Date.parse(receipt.startedAt)) {
      errors.push(`${label}: invalid time interval`);
    } else {
      intervals.push({
        label,
        start: Date.parse(receipt.startedAt),
        end: Date.parse(receipt.completedAt),
      });
    }
    sources.push({
      path: source.path,
      sha256: sha256Text(source.raw),
      responseFormat: format,
      startedAt: receipt.startedAt,
      completedAt: receipt.completedAt,
    });
  }

  for (const [format, required] of REQUIRED_FORMATS) {
    const count = formatCounts.get(format) ?? 0;
    if (count !== required) {
      errors.push(`${format} requires ${required} receipts; found ${count}`);
    }
  }
  if (overstatementSamples.size > 1) {
    errors.push("receipts exceed the one-fixture exploratory variance bound");
  }
  const chronological = intervals.toSorted((left, right) => left.start - right.start);
  for (let index = 1; index < chronological.length; index += 1) {
    if (chronological[index].start < chronological[index - 1].end) {
      errors.push(
        `${chronological[index].label}: time interval overlaps ${chronological[index - 1].label}`,
      );
    }
  }
  const serviceProfiles = {};
  for (const format of REQUIRED_FORMATS.keys()) {
    serviceProfiles[format] = aggregateInvestigationServiceProfiles(
      serviceProfileRows.get(format) ?? [],
    );
    if (serviceProfiles[format] === "unqualified") {
      errors.push(`${format} has unqualified service profile`);
    }
  }

  return {
    schemaVersion: 1,
    task: "general_page_investigation_single_pass_synthetic_ceremony",
    passed: errors.length === 0,
    candidateCommit: expectedCandidateCommit,
    sourceCount: sources.length,
    formatCounts: Object.fromEntries([...formatCounts.entries()].sort()),
    serviceProfiles,
    endpoint,
    model,
    promptSha256,
    schemaSha256,
    fixtureSetSha256,
    sources,
    errors,
  };
}
