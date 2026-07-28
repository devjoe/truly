import crypto from "node:crypto";

const REQUIRED_FORMATS = new Map([
  ["json_schema", 3],
  ["json_object", 3],
]);

const TASKS = {
  admission: "general_page_investigation_action_admission_synthetic_preflight",
  composed: "general_page_investigation_three_stage_synthetic_preflight",
};

function sha256Text(value) {
  return crypto.createHash("sha256").update(value, "utf8").digest("hex");
}

function validInstant(value) {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

function validLanguageCounts(value, expected) {
  return value?.["zh-TW"] === expected && value?.en === expected;
}

function validateAdmissionReceipt(receipt, label, errors) {
  if (receipt.data?.sampleCount !== 32 ||
      !validLanguageCounts(receipt.data?.sourceLanguages, 16) ||
      receipt.data?.expectedAdmit !== 16 ||
      receipt.data?.expectedReject !== 16) {
    errors.push(`${label}: wrong direct Admission fixture counts`);
  }
  if (receipt.counts?.protocolSucceeded !== 32 ||
      receipt.counts?.protocolFailed !== 0 ||
      receipt.counts?.correct !== 32 ||
      receipt.counts?.incorrect !== 0 ||
      receipt.counts?.admitCorrect !== 16 ||
      receipt.counts?.rejectCorrect !== 16) {
    errors.push(`${label}: direct Admission did not pass 32 of 32 controls`);
  }
  if (receipt.networkBoundary?.modelRequests !== 32 ||
      receipt.contract?.repairPolicy !== "none_one_shot" ||
      receipt.model?.timeoutMs !== 10_000) {
    errors.push(`${label}: wrong direct Admission request or retry contract`);
  }
}

function validateComposedReceipt(receipt, label, errors) {
  if (Object.values(receipt.gates ?? {}).some((gate) => gate?.pass !== true)) {
    errors.push(`${label}: composed source gate did not pass`);
  }
  if (receipt.data?.sampleCount !== 30 ||
      !validLanguageCounts(receipt.data?.sourceLanguages, 15) ||
      receipt.data?.expectedPrimaryCount !== 16 ||
      receipt.data?.expectedExploratoryCount !== 8 ||
      receipt.data?.expectedNoneCount !== 6) {
    errors.push(`${label}: wrong composed fixture counts`);
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
    errors.push(`${label}: composed capability or hard boundary failed`);
  }
  const exploratoryByLanguage = receipt.gates?.exploratoryCorrect?.byLanguage;
  if (receipt.gates?.exploratoryCorrect?.visible !== 8 ||
      receipt.gates?.exploratoryCorrect?.result !== receipt.counts?.exploratoryCorrect ||
      exploratoryByLanguage?.["zh-TW"] < 3 ||
      exploratoryByLanguage?.en < 3 ||
      exploratoryByLanguage?.["zh-TW"] + exploratoryByLanguage?.en !==
        receipt.counts?.exploratoryCorrect) {
    errors.push(`${label}: exploratory language floors or visibility disagree`);
  }
  if (!Number.isInteger(receipt.diagnostics?.primaryUnderstated) ||
      !Number.isInteger(receipt.diagnostics?.exploratoryOverstated) ||
      receipt.diagnostics.primaryUnderstated !== 0 ||
      receipt.diagnostics.exploratoryOverstated < 0 ||
      receipt.diagnostics.exploratoryOverstated > 1 ||
      !Array.isArray(receipt.diagnostics?.exploratoryOverstatedSamples) ||
      receipt.diagnostics.exploratoryOverstatedSamples.length !==
        receipt.diagnostics.exploratoryOverstated) {
    errors.push(`${label}: tier-confusion diagnostics exceed the bounded allowance`);
  }
  const admissionRequested = receipt.counts?.admissionRequested;
  const tierRequested = receipt.counts?.tierRequested;
  if (!Number.isInteger(admissionRequested) ||
      admissionRequested < 24 ||
      admissionRequested > 30 ||
      receipt.counts?.admissionProtocolSucceeded !== admissionRequested ||
      receipt.counts?.admissionProtocolFailed !== 0 ||
      !Number.isInteger(tierRequested) ||
      tierRequested < 24 ||
      tierRequested > admissionRequested ||
      receipt.counts?.tierProtocolSucceeded !== tierRequested ||
      receipt.counts?.tierProtocolFailed !== 0 ||
      receipt.networkBoundary?.modelRequests !== 30 + admissionRequested + tierRequested) {
    errors.push(`${label}: composed Selector, Admission, and Tier request counts disagree`);
  }
  if (receipt.contract?.repairPolicy !== "none_one_shot" ||
      receipt.contract?.protocolRetryPolicy !== "disabled_for_release_gate" ||
      receipt.model?.admissionTimeoutMs !== 10_000 ||
      receipt.model?.tierTimeoutMs !== 10_000) {
    errors.push(`${label}: wrong composed retry, Admission, or Tier timeout contract`);
  }
}

export function validateThreeStageInvestigationCeremony(receipts, expectedCandidateCommit) {
  const errors = [];
  if (!Array.isArray(receipts) || receipts.length !== 12) {
    errors.push(`ceremony requires exactly 12 receipts; found ${receipts?.length ?? 0}`);
  }
  if (typeof expectedCandidateCommit !== "string" || !/^[a-f0-9]{40}$/u.test(expectedCandidateCommit)) {
    errors.push("invalid expected candidate commit");
  }

  const seenPaths = new Set();
  const taskFormats = new Map();
  const taskContracts = new Map();
  const intervals = [];
  const sources = [];
  let endpoint;
  let model;
  let admissionPromptSha256;
  let selectorPromptSha256;
  let tierPromptSha256;
  const exploratoryOverstatedSamples = new Set();

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
    const taskKey = Object.entries(TASKS)
      .find(([, task]) => task === receipt.task)?.[0];
    if (receipt.schemaVersion !== 1 || receipt.split !== "synthetic-dev" || !taskKey) {
      errors.push(`${label}: wrong receipt contract`);
      continue;
    }
    if (receipt.passed !== true) errors.push(`${label}: source run did not pass`);
    if (receipt.candidate?.commit !== expectedCandidateCommit ||
        receipt.candidate?.worktreeDirty !== false) {
      errors.push(`${label}: candidate snapshot mismatch or dirty worktree`);
    }

    const format = receipt.model?.responseFormat;
    const formatKey = `${taskKey}:${format}`;
    taskFormats.set(formatKey, (taskFormats.get(formatKey) ?? 0) + 1);
    if (!REQUIRED_FORMATS.has(format)) errors.push(`${label}: invalid structured-output mode`);
    if (receipt.model?.concurrency !== 2) errors.push(`${label}: model concurrency must equal 2`);
    endpoint ??= receipt.model?.endpoint;
    model ??= receipt.model?.name;
    if (receipt.model?.endpoint !== endpoint || receipt.model?.name !== model) {
      errors.push(`${label}: endpoint or model drift`);
    }
    if (receipt.networkBoundary?.publicSearchRequests !== 0 ||
        receipt.networkBoundary?.actionsOpened !== 0) {
      errors.push(`${label}: ceremony opened an external action`);
    }

    const contractKey = `${receipt.contract?.systemPromptSha256}:${receipt.contract?.fixtureSetSha256}`;
    const existingContract = taskContracts.get(taskKey);
    if (existingContract && existingContract !== contractKey) {
      errors.push(`${label}: ${taskKey} prompt or fixture-set drift`);
    }
    taskContracts.set(taskKey, contractKey);
    if (taskKey === "admission") {
      admissionPromptSha256 ??= receipt.contract?.systemPromptSha256;
      if (receipt.contract?.systemPromptSha256 !== admissionPromptSha256) {
        errors.push(`${label}: direct Admission prompt drift`);
      }
      validateAdmissionReceipt(receipt, label, errors);
    } else {
      selectorPromptSha256 ??= receipt.contract?.systemPromptSha256;
      admissionPromptSha256 ??= receipt.contract?.admissionSystemPromptSha256;
      tierPromptSha256 ??= receipt.contract?.tierSystemPromptSha256;
      if (receipt.contract?.systemPromptSha256 !== selectorPromptSha256 ||
          receipt.contract?.admissionSystemPromptSha256 !== admissionPromptSha256 ||
          receipt.contract?.tierSystemPromptSha256 !== tierPromptSha256) {
        errors.push(`${label}: composed prompt drift`);
      }
      validateComposedReceipt(receipt, label, errors);
      for (const sampleId of receipt.diagnostics?.exploratoryOverstatedSamples ?? []) {
        if (typeof sampleId !== "string") {
          errors.push(`${label}: invalid exploratory overstatement sample ID`);
        } else {
          exploratoryOverstatedSamples.add(sampleId);
        }
      }
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
      task: taskKey,
      responseFormat: format,
      startedAt: receipt.startedAt,
      completedAt: receipt.completedAt,
    });
  }

  for (const taskKey of Object.keys(TASKS)) {
    for (const [format, required] of REQUIRED_FORMATS) {
      const count = taskFormats.get(`${taskKey}:${format}`) ?? 0;
      if (count !== required) {
        errors.push(`${taskKey} ${format} requires ${required} receipts; found ${count}`);
      }
    }
  }
  if (exploratoryOverstatedSamples.size > 1) {
    errors.push("composed receipts exceed the one-fixture exploratory variance bound");
  }
  const chronological = intervals.toSorted((left, right) => left.start - right.start);
  for (let index = 1; index < chronological.length; index += 1) {
    if (chronological[index].start < chronological[index - 1].end) {
      errors.push(`${chronological[index].label}: time interval overlaps ${chronological[index - 1].label}`);
    }
  }

  return {
    schemaVersion: 1,
    task: "general_page_investigation_three_stage_synthetic_ceremony",
    passed: errors.length === 0,
    candidateCommit: expectedCandidateCommit,
    sourceCount: sources.length,
    taskFormats: Object.fromEntries([...taskFormats.entries()].sort()),
    endpoint,
    model,
    selectorPromptSha256,
    admissionPromptSha256,
    tierPromptSha256,
    sources,
    errors,
  };
}
