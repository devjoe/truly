#!/usr/bin/env node

import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join, relative, resolve } from "node:path";
import {
  assertCleanTree,
  assertNoDevProcesses,
  clearReleaseLock,
  createReleaseLock,
  readDistBuildId,
  readProjectMetadata,
  root,
  run,
  runWithEnv,
  sha256File,
  writeExtensionZipFromDist,
} from "./lib/cws-artifacts.mjs";

const {
  packageJson,
  version,
  versionName,
  recommendedTag,
  commit,
  branch,
} = readProjectMetadata();

const dirtyFiles = assertCleanTree({
  allowDirtyEnv: "TRULY_ALLOW_DIRTY_CWS_LOCAL_SMOKE",
  label: "CWS local smoke package",
});
const dirty = dirtyFiles.length > 0;
const upstream = readUpstreamState();
const releaseTag = readReleaseTagState(recommendedTag);

assertNoDevProcesses();
createReleaseLock("cws:package:local-smoke");
try {
  rmSync(resolve(root, "dist"), { recursive: true, force: true });
  runWithEnv("npm", ["run", "check:public"], {
    TRULY_ALLOW_RELEASE_TAG_COLLISION: "1",
  });

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const dirtySuffix = dirty ? "-dirty" : "";
  const outDir = resolve(root, "artifacts/cws-local-smoke", `${version}-${commit}${dirtySuffix}-${stamp}`);
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });

  const extensionZip = join(outDir, `truly-local-smoke-extension-${version}-${commit}${dirtySuffix}.zip`);
  writeExtensionZipFromDist(extensionZip);
  run("node", ["scripts/audit-release-bundle.mjs", "--zip", extensionZip]);
  run("npm", ["run", "cws:preflight"]);

  const report = {
    name: packageJson.name,
    version,
    versionName,
    recommendedTag,
    commit,
    branch,
    uploadable: false,
    uploadBlockers: [
      "local smoke artifact only",
      "does not require or prove upstream sync",
      "does not require or prove release tag at HEAD",
      "must not be uploaded to Chrome Web Store",
    ],
    upstream,
    releaseTag,
    dirty,
    dirtyFiles,
    buildId: readDistBuildId(),
    builtAt: new Date().toISOString(),
    artifact: {
      extensionZip: relative(root, extensionZip),
      sha256: sha256File(extensionZip),
    },
    checks: [
      "local smoke only; not uploadable",
      dirty ? "dirty tree allowed for local smoke package" : "git tree clean",
      "no repo-local dev processes",
      "npm run check:public with release tag collision allowed for local smoke",
      "audit packaged extension zip boundary",
      "npm run cws:preflight",
    ],
    omittedUploadGates: [
      "branch synced with upstream",
      "release tag points at HEAD",
    ],
    cwsInputs: {
      checklist: "docs/release/cws-submission-checklist.md",
      listingCopy: "docs/release/cws-listing-copy.md",
      reviewerNotes: "docs/release/cws-reviewer-notes.md",
      privacyPolicy: "docs/release/privacy-policy.md",
      permissionJustification: "docs/release/permission-justification.md",
      assets: "docs/assets/cws/",
    },
  };

  writeFileSync(join(outDir, "cws-local-smoke-report.json"), `${JSON.stringify(report, null, 2)}\n`);
  writeFileSync(join(outDir, "cws-local-smoke-report.md"), renderReport(report));

  console.log("CWS local smoke package written. This artifact is not uploadable.");
  console.log(`Local smoke zip written to ${relative(root, extensionZip)}`);
  console.log(`Local smoke report written to ${relative(root, join(outDir, "cws-local-smoke-report.md"))}`);
} finally {
  clearReleaseLock();
}

function readUpstreamState() {
  const upstream = gitQuiet(["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"]).trim();
  if (!upstream) {
    return { upstream: null, ahead: null, behind: null, status: "no_upstream" };
  }
  const [aheadRaw, behindRaw] = (gitQuiet(["rev-list", "--left-right", "--count", "HEAD...@{u}"]) || "0\t0")
    .trim()
    .split(/\s+/);
  const ahead = Number(aheadRaw);
  const behind = Number(behindRaw);
  return { upstream, ahead, behind, status: behind > 0 ? "behind" : ahead > 0 ? "ahead" : "synced" };
}

function readReleaseTagState(tag) {
  const head = gitQuiet(["rev-parse", "HEAD"]).trim();
  const tagCommit = gitQuiet(["rev-list", "-n", "1", tag]).trim();
  if (!tagCommit) return { tag, commit: null, status: "missing" };
  return { tag, commit: tagCommit, status: tagCommit === head ? "points_at_head" : "points_elsewhere" };
}

function gitQuiet(args) {
  try {
    return execFileSync("git", args, {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
  } catch {
    return "";
  }
}

function renderReport(report) {
  const dirtyLine = report.dirty ? "yes" : "no";
  const upstreamLine = report.upstream.upstream
    ? `${report.upstream.upstream} (${report.upstream.status}; ahead=${report.upstream.ahead}, behind=${report.upstream.behind})`
    : "none (local smoke only)";
  const releaseTagLine = report.releaseTag.commit
    ? `${report.releaseTag.tag} (${report.releaseTag.status}; ${report.releaseTag.commit})`
    : `${report.releaseTag.tag} (${report.releaseTag.status})`;
  return [
    "# Truly CWS Local Smoke Package Report",
    "",
    "> This artifact is for local packaging smoke tests only. Do not upload it to Chrome Web Store.",
    "",
    `- Version: ${report.version}`,
    `- Version name: ${report.versionName}`,
    `- Recommended tag: ${report.recommendedTag}`,
    `- Commit: ${report.commit}`,
    `- Branch: ${report.branch}`,
    `- Uploadable: ${report.uploadable ? "yes" : "no"}`,
    `- Upstream: ${upstreamLine}`,
    `- Release tag: ${releaseTagLine}`,
    `- Dirty tree: ${dirtyLine}`,
    `- Build ID: ${report.buildId ?? "not found"}`,
    `- Built at: ${report.builtAt}`,
    "",
    "## Artifact",
    "",
    `- Extension zip: \`${report.artifact.extensionZip}\``,
    `- SHA-256: \`${report.artifact.sha256}\``,
    "",
    "## Upload Blockers",
    "",
    ...report.uploadBlockers.map((blocker) => `- ${blocker}`),
    "",
    "## Checks",
    "",
    ...report.checks.map((check) => `- ${check}`),
    "",
    "## Omitted Upload Gates",
    "",
    ...report.omittedUploadGates.map((check) => `- ${check}`),
    "",
    "## CWS Inputs",
    "",
    ...Object.values(report.cwsInputs).map((path) => `- \`${path}\``),
    "",
  ].join("\n");
}
