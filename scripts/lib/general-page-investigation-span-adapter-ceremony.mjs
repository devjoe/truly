import crypto from "node:crypto";

const REQUIRED_FORMATS = new Map([
  ["json_schema", 3],
  ["json_object", 3],
]);

function sha256Text(value) {
  return crypto.createHash("sha256").update(value, "utf8").digest("hex");
}

function validInstant(value) {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

export function validateSpanAdapterCeremony(receipts, expectedCandidateCommit) {
  const errors = [];
  if (!Array.isArray(receipts) || receipts.length !== 6) {
    errors.push(`ceremony requires exactly 6 receipts; found ${receipts?.length ?? 0}`);
  }
  if (typeof expectedCandidateCommit !== "string" || !/^[a-f0-9]{40}$/u.test(expectedCandidateCommit)) {
    errors.push("invalid expected candidate commit");
  }

  const seenPaths = new Set();
  const formats = new Map();
  const intervals = [];
  let endpoint;
  let model;
  let systemPromptSha256;
  let fixtureSetSha256;
  const sources = [];

  for (const [index, source] of (receipts ?? []).entries()) {
    const label = `receipt ${index + 1}`;
    if (!source || typeof source !== "object" || typeof source.path !== "string" ||
        typeof source.raw !== "string" || !source.value || typeof source.value !== "object") {
      errors.push(`${label}: invalid source envelope`);
      continue;
    }
    if (seenPaths.has(source.path)) errors.push(`${label}: duplicate source path`);
    seenPaths.add(source.path);
    const receipt = source.value;
    if (receipt.schemaVersion !== 1 ||
        receipt.task !== "general_page_investigation_span_adapter_synthetic_preflight" ||
        receipt.split !== "synthetic-dev") {
      errors.push(`${label}: wrong receipt contract`);
    }
    if (receipt.passed !== true || Object.values(receipt.gates ?? {}).some((gate) => gate?.pass !== true)) {
      errors.push(`${label}: source gate did not pass`);
    }
    if (receipt.candidate?.commit !== expectedCandidateCommit || receipt.candidate?.worktreeDirty !== false) {
      errors.push(`${label}: candidate snapshot mismatch or dirty worktree`);
    }
    const format = receipt.model?.responseFormat;
    formats.set(format, (formats.get(format) ?? 0) + 1);
    if (!REQUIRED_FORMATS.has(format)) errors.push(`${label}: invalid structured-output mode`);
    if (receipt.model?.concurrency !== 2) errors.push(`${label}: model concurrency must equal 2`);
    endpoint ??= receipt.model?.endpoint;
    model ??= receipt.model?.name;
    if (receipt.model?.endpoint !== endpoint || receipt.model?.name !== model) {
      errors.push(`${label}: endpoint or model drift`);
    }
    systemPromptSha256 ??= receipt.contract?.systemPromptSha256;
    fixtureSetSha256 ??= receipt.contract?.fixtureSetSha256;
    if (receipt.contract?.systemPromptSha256 !== systemPromptSha256 ||
        receipt.contract?.fixtureSetSha256 !== fixtureSetSha256) {
      errors.push(`${label}: prompt or fixture-set drift`);
    }
    if (receipt.data?.sampleCount !== 30 || receipt.counts?.protocolSucceeded !== 30 ||
        receipt.counts?.protocolFailed !== 0 || receipt.counts?.oneShotRows !== 30 ||
        receipt.networkBoundary?.modelRequests !== 30 ||
        receipt.networkBoundary?.publicSearchRequests !== 0 ||
        receipt.networkBoundary?.actionsOpened !== 0) {
      errors.push(`${label}: incomplete or non-one-shot ceremony counts`);
    }
    if (receipt.data?.positiveCount !== 20 || receipt.counts?.positivePrepared !== 20 ||
        receipt.gates?.positivePrepared?.pass !== true) {
      errors.push(`${label}: positive capability must select 20 of 20 controls`);
    }
    if (receipt.data?.hardBoundaryCount !== 6 ||
        receipt.counts?.hardBoundaryAbstained !== 6 ||
        receipt.gates?.hardBoundaryAbstained?.pass !== true) {
      errors.push(`${label}: hard-boundary sentinels must abstain 6 of 6`);
    }
    if (receipt.data?.softNegativeCount !== 4 ||
        receipt.diagnostics?.softNegativeAbstained?.denominator !== 4 ||
        !Number.isInteger(receipt.diagnostics?.softNegativeAbstained?.result) ||
        receipt.diagnostics.softNegativeAbstained.result < 0 ||
        receipt.diagnostics.softNegativeAbstained.result > 4) {
      errors.push(`${label}: soft-negative diagnostic must report 4 controls`);
    }
    if (!validInstant(receipt.startedAt) || !validInstant(receipt.completedAt) ||
        Date.parse(receipt.completedAt) < Date.parse(receipt.startedAt)) {
      errors.push(`${label}: invalid time interval`);
    } else {
      intervals.push({
        label,
        startedAt: receipt.startedAt,
        completedAt: receipt.completedAt,
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

  for (const [format, count] of REQUIRED_FORMATS) {
    if (formats.get(format) !== count) {
      errors.push(`${format} requires ${count} receipts; found ${formats.get(format) ?? 0}`);
    }
  }
  const chronological = intervals.toSorted((left, right) => left.start - right.start);
  for (let index = 1; index < chronological.length; index += 1) {
    if (chronological[index].start < chronological[index - 1].end) {
      errors.push(`${chronological[index].label}: time interval overlaps ${chronological[index - 1].label}`);
    }
  }

  return {
    schemaVersion: 1,
    task: "general_page_investigation_span_adapter_synthetic_ceremony",
    passed: errors.length === 0,
    candidateCommit: expectedCandidateCommit,
    sourceCount: sources.length,
    formats: Object.fromEntries([...formats.entries()].sort()),
    endpoint,
    model,
    systemPromptSha256,
    fixtureSetSha256,
    sources,
    errors,
  };
}
