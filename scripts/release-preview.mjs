#!/usr/bin/env node

import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import {
  assertCleanTree,
  assertNoDevProcesses,
  clearReleaseLock,
  createReleaseLock,
  readProjectMetadata,
  root,
  run,
  writeExtensionZipFromDist,
  writeSourceZipFromGitTrackedFiles,
} from "./lib/cws-artifacts.mjs";

const {
  packageJson,
  version,
  versionName,
  recommendedTag,
  commit,
} = readProjectMetadata();
const dirtyFiles = assertCleanTree({
  allowDirtyEnv: "TRULY_ALLOW_DIRTY_RELEASE",
  label: "Preview",
});
const dirty = dirtyFiles.length > 0;

assertNoDevProcesses();
createReleaseLock("release:preview");
try {
  rmSync(resolve(root, "dist"), { recursive: true, force: true });
  run("npm", ["run", "check:ollama-cloud-capabilities"]);
  run("npm", ["run", "check:public"]);
  run("npm", ["run", "build"]);
  run("node", ["scripts/audit-release-bundle.mjs", "--dist", "dist"]);

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const suffix = dirty ? `${version}-${commit}-dirty-${stamp}` : `${version}-${commit}-${stamp}`;
  const outDir = resolve(root, "artifacts/preview", suffix);
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });

  const dirtySuffix = dirty ? "-dirty" : "";
  const extensionZip = join(outDir, `truly-extension-${version}-${commit}${dirtySuffix}.zip`);
  const sourceZip = join(outDir, `truly-source-${version}-${commit}${dirtySuffix}.zip`);
  writeExtensionZipFromDist(extensionZip);
  run("node", ["scripts/audit-release-bundle.mjs", "--zip", extensionZip]);
  writeSourceZipFromGitTrackedFiles(sourceZip);

  const report = {
    name: packageJson.name,
    version,
    versionName,
    recommendedTag,
    commit,
    dirty,
    dirtyFiles,
    builtAt: new Date().toISOString(),
    checks: [
      "npm run check:ollama-cloud-capabilities",
      "npm run check:public",
      "npm run build",
      "verify release metadata and Preview tag naming",
      "audit dist release bundle boundary",
      "audit packaged extension zip boundary",
    ],
    artifacts: {
      extensionZip: relative(root, extensionZip),
      sourceZip: relative(root, sourceZip),
    },
    reviewerDocs: [
      "docs/release/privacy-policy.md",
      "docs/release/permission-justification.md",
      "docs/release/cws-reviewer-notes.md",
      "THIRD_PARTY_NOTICES.md",
    ],
  };

  writeFileSync(join(outDir, "build-report.json"), `${JSON.stringify(report, null, 2)}\n`);
  writeFileSync(join(outDir, "build-report.md"), renderReport(report));

  console.log(`Preview artifacts written to ${relative(root, outDir)}`);
} finally {
  clearReleaseLock();
}

function renderReport(report) {
  const dirtyLine = report.dirty ? "yes" : "no";
  return [
    "# Truly Preview Build Report",
    "",
    `- Version: ${report.version}`,
    `- Version name: ${report.versionName}`,
    `- Recommended tag: ${report.recommendedTag}`,
    `- Commit: ${report.commit}`,
    `- Built at: ${report.builtAt}`,
    `- Dirty tree: ${dirtyLine}`,
    "",
    "## Checks",
    "",
    ...report.checks.map((check) => `- ${check}`),
    "",
    "## Artifacts",
    "",
    `- Extension zip: \`${report.artifacts.extensionZip}\``,
    `- Source zip: \`${report.artifacts.sourceZip}\``,
    "",
    "## Reviewer Docs",
    "",
    ...report.reviewerDocs.map((doc) => `- \`${doc}\``),
    "",
  ].join("\n");
}
