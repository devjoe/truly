#!/usr/bin/env node

import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import {
  assertCleanTree,
  assertNoDevProcesses,
  assertTagMatchesHead,
  assertUpstreamSynced,
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
  allowDirtyEnv: "TRULY_ALLOW_DIRTY_CWS_PACKAGE",
  label: "CWS package",
});
const dirty = dirtyFiles.length > 0;
const upstream = assertUpstreamSynced({
  allowUnpushedEnv: "TRULY_ALLOW_UNPUSHED_CWS_PACKAGE",
});
const releaseTag = assertTagMatchesHead(recommendedTag);

assertNoDevProcesses();
createReleaseLock("cws:package");
try {
  rmSync(resolve(root, "dist"), { recursive: true, force: true });
  runWithEnv("npm", ["run", "check:public"], {
    TRULY_ALLOW_RELEASE_TAG_COLLISION: "1",
  });

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const dirtySuffix = dirty ? "-dirty" : "";
  const outDir = resolve(root, "artifacts/cws", `${version}-${commit}${dirtySuffix}-${stamp}`);
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });

  const extensionZip = join(outDir, `truly-cws-extension-${version}-${commit}${dirtySuffix}.zip`);
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
      dirty ? "dirty tree allowed for local smoke package" : "git tree clean",
      "branch synced with upstream",
      "release tag points at HEAD",
      "no repo-local dev processes",
      "npm run check:public with verified release tag collision",
      "audit packaged extension zip boundary",
      "npm run cws:preflight",
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

  writeFileSync(join(outDir, "cws-package-report.json"), `${JSON.stringify(report, null, 2)}\n`);
  writeFileSync(join(outDir, "cws-package-report.md"), renderReport(report));

  console.log(`CWS package written to ${relative(root, extensionZip)}`);
  console.log(`CWS package report written to ${relative(root, join(outDir, "cws-package-report.md"))}`);
} finally {
  clearReleaseLock();
}

function renderReport(report) {
  const dirtyLine = report.dirty ? "yes" : "no";
  return [
    "# Truly CWS Package Report",
    "",
    `- Version: ${report.version}`,
    `- Version name: ${report.versionName}`,
    `- Recommended tag: ${report.recommendedTag}`,
    `- Commit: ${report.commit}`,
    `- Branch: ${report.branch}`,
    `- Upstream: ${report.upstream.upstream}`,
    `- Release tag: ${report.releaseTag.tag}`,
    `- Dirty tree: ${dirtyLine}`,
    `- Build ID: ${report.buildId ?? "not found"}`,
    `- Built at: ${report.builtAt}`,
    "",
    "## Artifact",
    "",
    `- Extension zip: \`${report.artifact.extensionZip}\``,
    `- SHA-256: \`${report.artifact.sha256}\``,
    "",
    "## Checks",
    "",
    ...report.checks.map((check) => `- ${check}`),
    "",
    "## CWS Inputs",
    "",
    ...Object.values(report.cwsInputs).map((path) => `- \`${path}\``),
    "",
  ].join("\n");
}
