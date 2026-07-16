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

export function privateSemanticAuditRepairMode(argv) {
  const index = argv.indexOf("--repair-mode");
  const value = index >= 0 ? argv[index + 1] : "none";
  if (value !== "none" && value !== "semantic_once") {
    throw new Error("--repair-mode must be none or semantic_once");
  }
  return value;
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
