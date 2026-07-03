#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { root } from "./lib/cws-artifacts.mjs";

const baseRef = process.env.TRULY_MERGE_BASE_REF || "origin/main";
const allowDirty = process.env.TRULY_ALLOW_DIRTY_MERGE_READINESS === "1";
const allowUnpushed = process.env.TRULY_ALLOW_UNPUSHED_MERGE_READINESS === "1";

const failures = [];

const head = git(["rev-parse", "--short=12", "HEAD"]).trim();
const branch = git(["rev-parse", "--abbrev-ref", "HEAD"]).trim();
const baseCommit = git(["rev-parse", "--verify", `${baseRef}^{commit}`], "").trim();
if (!baseCommit) {
  failures.push(`base ref is missing or not a commit: ${baseRef}`);
}

const dirtyFiles = git(["status", "--porcelain", "--", "."], "")
  .split("\n")
  .filter(Boolean);
if (dirtyFiles.length > 0 && !allowDirty) {
  failures.push(
    `working tree is dirty (${dirtyFiles.length} file(s)); commit/stash first or set TRULY_ALLOW_DIRTY_MERGE_READINESS=1 for local script development`,
  );
}

let upstreamSummary = null;
const upstream = git(["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"], "").trim();
if (!upstream) {
  failures.push("current branch has no configured upstream");
} else {
  const [aheadRaw, behindRaw] = git(["rev-list", "--left-right", "--count", "HEAD...@{u}"], "0\t0")
    .trim()
    .split(/\s+/);
  const ahead = Number(aheadRaw);
  const behind = Number(behindRaw);
  upstreamSummary = { upstream, ahead, behind };
  if (behind > 0) failures.push(`branch is behind ${upstream} by ${behind} commit(s)`);
  if (ahead > 0 && !allowUnpushed) {
    failures.push(
      `branch has ${ahead} unpushed commit(s); push first or set TRULY_ALLOW_UNPUSHED_MERGE_READINESS=1 for local script development`,
    );
  }
}

let mainlineSummary = null;
if (baseCommit) {
  const ancestor = spawnGit(["merge-base", "--is-ancestor", baseRef, "HEAD"]).status === 0;
  const [leftRaw, rightRaw] = git(["rev-list", "--left-right", "--count", `${baseRef}...HEAD`], "0\t0")
    .trim()
    .split(/\s+/);
  const behind = Number(leftRaw);
  const ahead = Number(rightRaw);
  mainlineSummary = { baseRef, behind, ahead, ancestor };
  if (!ancestor || behind > 0) {
    failures.push(`HEAD is not caught up with ${baseRef} (${baseRef}...HEAD = ${behind} ${ahead})`);
  }
}

if (failures.length > 0) {
  console.error("Merge-readiness check failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  if (dirtyFiles.length > 0) {
    console.error("Dirty files:");
    for (const file of dirtyFiles) console.error(`- ${file}`);
  }
  process.exit(1);
}

console.log(`Merge-readiness check passed (${branch}@${head}).`);
if (mainlineSummary) {
  console.log(
    `mainline ${mainlineSummary.baseRef}: behind=${mainlineSummary.behind}, ahead=${mainlineSummary.ahead}, ancestor=${mainlineSummary.ancestor}`,
  );
}
if (upstreamSummary) {
  console.log(
    `upstream ${upstreamSummary.upstream}: ahead=${upstreamSummary.ahead}, behind=${upstreamSummary.behind}`,
  );
}

function git(args, fallback = null) {
  const result = spawnGit(args);
  if (result.status !== 0) {
    if (fallback !== null) return fallback;
    throw new Error(`git ${args.join(" ")} failed`);
  }
  return result.stdout;
}

function spawnGit(args) {
  return execFileSyncSafe("git", args);
}

function execFileSyncSafe(command, args) {
  try {
    return {
      status: 0,
      stdout: execFileSync(command, args, {
        cwd: root,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      }),
    };
  } catch (error) {
    return {
      status: typeof error.status === "number" ? error.status : 1,
      stdout: typeof error.stdout === "string" ? error.stdout : "",
    };
  }
}
