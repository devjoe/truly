import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export const PRIVATE_SEMANTIC_AUDIT_CORE_FILES = [
  "src/background/general-page-investigation-background.ts",
  "src/lib/general-page-analysis.ts",
  "src/lib/general-page-investigation-adapter.ts",
  "src/lib/reading-question-policy.ts",
  "src/lib/tier-b-client.ts",
  "src/sidepanel/page-claim-investigation.ts",
  "src/sidepanel/reading-brief-text.ts",
];

export function sha256Text(value) {
  return crypto.createHash("sha256").update(String(value)).digest("hex");
}

export function assertPrivateSemanticAuditCandidateSnapshot(input) {
  if (!/^[a-f0-9]{40}$/.test(input.expectedCommit || "") ||
      !/^[a-f0-9]{64}$/.test(input.expectedTrackedDiffSha256 || "")) {
    throw new Error("invalid preregistered candidate snapshot");
  }
  if (input.actualCommit !== input.expectedCommit) {
    throw new Error("candidate commit does not match preregistration");
  }
  const trackedDiffSha256 = sha256Text(input.actualTrackedDiff);
  if (trackedDiffSha256 !== input.expectedTrackedDiffSha256) {
    throw new Error("candidate tracked diff does not match preregistration");
  }
  return { commit: input.actualCommit, trackedDiffSha256 };
}

export function privateSemanticAuditRepairMode(argv) {
  const index = argv.indexOf("--repair-mode");
  const value = index >= 0 ? argv[index + 1] : "none";
  if (value !== "none") throw new Error("--repair-mode must be none for runtime-parity batch audit");
  return value;
}

export function privateSemanticAuditAdapterResponseFormat(argv) {
  const index = argv.indexOf("--adapter-response-format");
  const value = index >= 0 ? argv[index + 1] : "json_object";
  if (value !== "json_object" && value !== "json_schema") {
    throw new Error("--adapter-response-format must be json_object or json_schema");
  }
  return value;
}

export function privateSemanticAuditReadingResponseFormat(argv) {
  const index = argv.indexOf("--reading-response-format");
  const value = index >= 0 ? argv[index + 1] : "json_object";
  if (value !== "json_object" && value !== "json_schema") {
    throw new Error("--reading-response-format must be json_object or json_schema");
  }
  return value;
}

export function privateSemanticAuditReadingManifestMetadata(responseFormat, wireResponseFormat) {
  if (responseFormat === "json_object") {
    if (wireResponseFormat?.type !== "json_object") throw new Error("reading response format/body mismatch");
    return { responseFormat: "json_object" };
  }
  if (responseFormat !== "json_schema" || wireResponseFormat?.type !== "json_schema" ||
      wireResponseFormat?.json_schema?.strict !== true || !wireResponseFormat?.json_schema?.schema) {
    throw new Error("reading response format/body mismatch");
  }
  return {
    responseFormat: "json_schema",
    schemaSha256: sha256Text(JSON.stringify(wireResponseFormat.json_schema.schema)),
  };
}

export function privateSemanticAuditAdapterModelMetadata(responseFormat) {
  if (responseFormat === "json_schema") {
    return { responseFormat: "json_schema", adapterMaxTokens: 3_200 };
  }
  if (responseFormat === "json_object") return { adapterMaxTokens: 1_200 };
  throw new Error("adapter response format must be json_object or json_schema");
}

export function privateSemanticAuditAdapterManifestMetadata(responseFormat, wireResponseFormat) {
  if (responseFormat === "json_object") {
    if (wireResponseFormat?.type !== "json_object") throw new Error("adapter response format/body mismatch");
    return {};
  }
  if (responseFormat !== "json_schema" || wireResponseFormat?.type !== "json_schema" ||
      wireResponseFormat?.json_schema?.strict !== true || !wireResponseFormat?.json_schema?.schema) {
    throw new Error("adapter response format/body mismatch");
  }
  return { schemaSha256: sha256Text(JSON.stringify(wireResponseFormat.json_schema.schema)) };
}

export function semanticAuditCompletionsUrl(endpoint) {
  const url = new URL(endpoint);
  if (!/^https?:$/.test(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new Error("--endpoint must be a credential-free HTTP(S) URL without query or fragment");
  }
  const base = url.toString().replace(/\/v1\/?$/, "").replace(/\/$/, "");
  return `${base}/v1/chat/completions`;
}

export function assertPrivateSemanticAuditFetchTarget(input, endpoint) {
  const actual = new URL(typeof input === "string" || input instanceof URL ? input : input.url);
  const expected = new URL(semanticAuditCompletionsUrl(endpoint));
  if (actual.href !== expected.href) {
    throw new Error(`Private semantic audit blocked undeclared network target: ${actual.origin}`);
  }
  return expected.href;
}

export function installPrivateSemanticAuditNetworkGuard(endpoint, fetchImpl = globalThis.fetch) {
  if (typeof fetchImpl !== "function") throw new Error("fetch is unavailable");
  return async (input, init) => {
    assertPrivateSemanticAuditFetchTarget(input, endpoint);
    return fetchImpl(input, { ...init, redirect: "error" });
  };
}

export function hashPrivateSemanticAuditCoreFiles(repoRoot, files = PRIVATE_SEMANTIC_AUDIT_CORE_FILES) {
  const fileSha256 = Object.fromEntries(files.map((file) => {
    const bytes = fs.readFileSync(path.join(repoRoot, file));
    return [file, crypto.createHash("sha256").update(bytes).digest("hex")];
  }));
  return {
    coreSha256: sha256Text(Object.entries(fileSha256)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([file, hash]) => `${file}\0${hash}`)
      .join("\0")),
    fileSha256,
  };
}
