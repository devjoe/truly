#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join, relative, resolve } from "node:path";
import {
  git,
  readProjectMetadata,
  root,
} from "./lib/cws-artifacts.mjs";

const args = new Set(process.argv.slice(2));
const kindArg = valueAfter("--kind") ?? "release";
const sourceArg = valueAfter("--source") ?? "local";
const dryRun = args.has("--dry-run");
const timeoutMs = Number(valueAfter("--timeout-ms") ?? 300000);
const budgetUsd = valueAfter("--max-budget-usd") ?? "1";

if (!["local", "github"].includes(sourceArg)) {
  throw new Error(`Unknown review source: ${sourceArg}`);
}

const reviewKinds = expandKind(kindArg);
const metadata = readProjectMetadata();
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const outDir = resolve(root, "artifacts/review", `${metadata.version}-${metadata.commit}-${kindArg}-${sourceArg}-${stamp}-${process.pid}`);
mkdirSync(outDir, { recursive: true });

const reports = [];
for (const reviewKind of reviewKinds) {
  const context = buildContext(reviewKind);
  const prompt = buildPrompt(reviewKind, context);
  const prefix = `${reviewKind}-review`;
  writeFileSync(join(outDir, `${prefix}-prompt.md`), prompt);

  if (dryRun) {
    writeFileSync(join(outDir, `${prefix}.json`), `${JSON.stringify(dryRunReport(reviewKind, context), null, 2)}\n`);
    reports.push(dryRunReport(reviewKind, context));
    continue;
  }

  if (process.env.TRULY_ENABLE_CLAUDE_REVIEW !== "1") {
    throw new Error(
      "Refusing to send release context to Claude without TRULY_ENABLE_CLAUDE_REVIEW=1. Re-run with --dry-run to inspect the prompt locally.",
    );
  }

  const report = runClaudeReview(reviewKind, prompt);
  writeFileSync(join(outDir, `${prefix}.json`), `${JSON.stringify(report, null, 2)}\n`);
  reports.push(report);
}

const summary = renderSummary(reports);
writeFileSync(join(outDir, "summary.md"), summary);
console.log(`Claude release review artifacts written to ${relativePath(outDir)}`);

const blocking = reports.flatMap(blockingFindings);
const blockedReports = reports.filter((report) => report.status === "block");
if (blocking.length > 0 || blockedReports.length > 0) {
  console.error(
    `Claude release review blocked: ${blocking.length} blocking finding(s), ${blockedReports.length} blocked report(s).`,
  );
  process.exit(1);
}

function valueAfter(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
}

function expandKind(kind) {
  if (kind === "release") return ["functional", "security"];
  if (["functional", "security", "cws"].includes(kind)) return [kind];
  throw new Error(`Unknown review kind: ${kind}`);
}

function buildContext(reviewKind) {
  const base = resolveBaseRef();
  const head = git(["rev-parse", "HEAD"], "unknown").trim();
  if (sourceArg === "github") return buildGithubContext(reviewKind, base, head);

  const changedFiles = git(["diff", "--name-only", `${base}...HEAD`], "").trim().split("\n").filter(Boolean);
  const diffStat = git(["diff", "--stat", `${base}...HEAD`], "").trim();
  const diff = capText(git(["diff", "--no-ext-diff", "--unified=60", `${base}...HEAD`], ""), 70000);
  const workingTreeDiffStat = git(["diff", "--stat"], "").trim();
  const workingTreeDiff = capText(git(["diff", "--no-ext-diff", "--unified=60"], ""), 70000);
  const untrackedFiles = git(["ls-files", "--others", "--exclude-standard"], "").trim().split("\n").filter(Boolean);
  const untrackedTextFiles = untrackedFiles.filter(isPublicSafeTextFile);
  const latestCwsReport = reviewKind === "cws" ? latestFile("artifacts/cws", "cws-package-report.md") : null;

  return {
    reviewKind,
    reviewed: {
      version: metadata.version,
      versionName: metadata.versionName,
      tag: metadata.recommendedTag,
      base,
      head,
      commit: metadata.commit,
      branch: metadata.branch,
    },
    workingTreeStatus: git(["status", "--short", "--branch"], "").trim(),
    changedFiles,
    untrackedFiles,
    untrackedTextFiles,
    diffStat,
    diff,
    workingTreeDiffStat,
    workingTreeDiff,
    untrackedFileContents: Object.fromEntries(
      untrackedTextFiles.map((path) => [path, readText(path, 40000)]),
    ),
    repositoryFacts: {
      packageLockPresent: existsSync(resolve(root, "package-lock.json")),
    },
    files: {
      packageJson: readText("package.json", 20000),
      manifest: readText("src/manifest.json", 20000),
      releaseContract: readText("docs/release/preview-command-contract.md", 30000),
      cwsChecklist: readText("docs/release/cws-submission-checklist.md", 30000),
      cwsListingCopy: reviewKind === "cws" ? readText("docs/release/cws-listing-copy.md", 30000) : "",
      cwsReviewerNotes: reviewKind === "cws" ? readText("docs/release/cws-reviewer-notes.md", 30000) : "",
      permissionJustification: reviewKind !== "functional" ? readText("docs/release/permission-justification.md", 30000) : "",
      privacyPolicy: reviewKind !== "functional" ? readText("docs/release/privacy-policy.md", 30000) : "",
      cwsPackageReport: latestCwsReport ? readFile(latestCwsReport, 20000) : "",
    },
    limits: {
      diffCapChars: 70000,
      generatedAndPrivateMaterialExcluded: [
        "dist/",
        "artifacts/ release binaries except selected CWS report",
        ".env*",
        "node_modules/",
        "browser profiles",
        "binary assets and WASM contents",
      ],
    },
  };
}

function buildGithubContext(reviewKind, base, head) {
  const status = git(["status", "--short", "--branch"], "").trim();
  const dirtyLines = git(["status", "--porcelain"], "").trim();
  if (dirtyLines) {
    throw new Error("GitHub-source Claude review requires a clean working tree. Commit/stash changes or use --source local.");
  }

  const repoUrl = githubRepoUrl();
  const changedFiles = git(["diff", "--name-only", `${base}...HEAD`], "").trim().split("\n").filter(Boolean);
  const docs = [
    "package.json",
    "src/manifest.json",
    "docs/release/preview-command-contract.md",
    "docs/release/cws-submission-checklist.md",
  ];
  if (reviewKind !== "functional") {
    docs.push(
      "docs/release/permission-justification.md",
      "docs/release/privacy-policy.md",
    );
  }
  if (reviewKind === "cws") {
    docs.push(
      "docs/release/cws-listing-copy.md",
      "docs/release/cws-reviewer-notes.md",
      "docs/release/cws-published-version.json",
    );
  }

  return {
    reviewKind,
    source: "github",
    reviewed: {
      version: metadata.version,
      versionName: metadata.versionName,
      tag: metadata.recommendedTag,
      base,
      head,
      commit: metadata.commit,
      branch: metadata.branch,
    },
    workingTreeStatus: status,
    urls: {
      repository: repoUrl,
      headCommit: `${repoUrl}/commit/${head}`,
      compare: `${repoUrl}/compare/${encodeURIComponent(base)}...${head}`,
      release: `${repoUrl}/releases/tag/${metadata.recommendedTag}`,
      tree: `${repoUrl}/tree/${head}`,
      docs: Object.fromEntries(docs.map((path) => [path, `${repoUrl}/blob/${head}/${path}`])),
    },
    changedFiles,
    instructions: [
      "Review only public GitHub URLs in this context.",
      "Use immutable commit URLs rather than branch URLs.",
      "If a URL cannot be fetched, report it as a limitation instead of guessing.",
      "CWS package reports may not be public unless attached to a GitHub Release; report missing package artifacts as a limitation.",
    ],
    limits: {
      publicUrlsOnly: true,
      localDiffAndFileContentsExcluded: true,
    },
  };
}

function resolveBaseRef() {
  const previous = git(["describe", "--tags", "--abbrev=0", "--match", "v*-preview.*", "HEAD^"], "").trim();
  if (previous) return previous;
  const last = git(["describe", "--tags", "--abbrev=0", "--match", "v*-preview.*", "HEAD"], "").trim();
  return last || "HEAD~1";
}

function buildPrompt(reviewKind, context) {
  const focus = {
    functional: [
      "release regression risk",
      "settings and model-source behavior",
      "manifest/package/release metadata consistency",
      "missing tests or manual checks",
      "Chrome Web Store-visible UX or documentation mismatch",
    ],
    security: [
      "MV3 permission and host permission risk",
      "CSP and remote-code policy",
      "storage of sensitive values such as API keys",
      "message passing and postMessage origin validation",
      "DOM injection and attacker-controlled text handling",
      "external endpoint, localhost, and optional permission behavior",
    ],
    cws: [
      "CWS package/report consistency",
      "privacy declarations and listing claims",
      "permission justification mismatch",
      "remote-code ambiguity",
      "reviewer-note completeness",
      "dashboard upload or review rejection risks",
    ],
  }[reviewKind];

  return [
    `You are reviewing the Truly Chrome extension release as an advisory ${reviewKind} reviewer.`,
    "",
    "Rules:",
    "- This is advisory. Do not claim final release approval.",
    "- Report only findings backed by concrete file, line, diff, or metadata evidence.",
    "- If evidence is weak, use questions or limitations instead of findings.",
    "- Do not invent project behavior beyond the provided context.",
    "- Return only JSON matching the provided schema.",
    "",
    "Focus areas:",
    ...focus.map((item) => `- ${item}`),
    "",
    "Context:",
    "```json",
    JSON.stringify(context, null, 2),
    "```",
  ].join("\n");
}

function runClaudeReview(reviewKind, prompt) {
  const schema = JSON.stringify(reviewSchema(reviewKind));
  const disallowedTools = sourceArg === "github"
    ? "Bash,Edit,Write,Read,Grep,Glob,WebSearch"
    : "Bash,Edit,Write,Read,Grep,Glob,WebFetch,WebSearch";
  const toolArgs = sourceArg === "github"
    ? ["--tools=WebFetch", "--allowedTools=WebFetch"]
    : ["--tools="];
  const result = spawnSync(
    "claude",
    [
      "-p",
      "--no-session-persistence",
      "--permission-mode",
      "dontAsk",
      "--output-format",
      "json",
      "--json-schema",
      schema,
      "--max-budget-usd",
      budgetUsd,
      ...toolArgs,
      `--disallowedTools=${disallowedTools}`,
    ],
    {
      cwd: root,
      input: prompt,
      encoding: "utf8",
      timeout: timeoutMs,
      maxBuffer: 8 * 1024 * 1024,
    },
  );
  writeFileSync(join(outDir, `${reviewKind}-review-raw.json`), result.stdout || "");
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`claude -p exited with status ${result.status}: ${(result.stderr ?? "").trim()}`);
  }
  return validateReport(extractReport(result.stdout), reviewKind);
}

function extractReport(stdout) {
  const parsed = JSON.parse(stdout);
  if (parsed?.schemaVersion) return parsed;
  if (typeof parsed?.result === "string") return JSON.parse(parsed.result);
  if (parsed?.result?.schemaVersion) return parsed.result;
  if (typeof parsed?.content === "string") return JSON.parse(parsed.content);
  throw new Error("Could not find structured review report in Claude JSON output.");
}

function validateReport(report, expectedKind) {
  if (report.schemaVersion !== "truly.claudeReview.v1") throw new Error("Invalid review schemaVersion.");
  if (report.kind !== expectedKind) throw new Error(`Review kind mismatch: ${report.kind} !== ${expectedKind}`);
  if (!["pass", "needs_disposition", "block"].includes(report.status)) throw new Error("Invalid review status.");
  if (!Array.isArray(report.findings)) throw new Error("Review findings must be an array.");
  for (const finding of report.findings) {
    if (!finding.id || !finding.title || !finding.severity) throw new Error("Each finding needs id, title, and severity.");
    if (!["blocker", "high", "medium", "low", "info"].includes(finding.severity)) {
      throw new Error(`Invalid finding severity: ${finding.severity}`);
    }
    if (typeof finding.confidence !== "number") finding.confidence = 0;
    if (!finding.disposition) finding.disposition = "open";
  }
  report.questions ??= [];
  report.limitations ??= [];
  return report;
}

function reviewSchema(expectedKind) {
  return {
    type: "object",
    additionalProperties: false,
    required: ["schemaVersion", "kind", "reviewed", "status", "findings", "questions", "limitations"],
    properties: {
      schemaVersion: { const: "truly.claudeReview.v1" },
      kind: { const: expectedKind },
      reviewed: { type: "object" },
      status: { enum: ["pass", "needs_disposition", "block"] },
      findings: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: [
            "id",
            "severity",
            "confidence",
            "title",
            "category",
            "files",
            "evidence",
            "impact",
            "recommendation",
            "blocksRelease",
            "disposition",
          ],
          properties: {
            id: { type: "string" },
            severity: { enum: ["blocker", "high", "medium", "low", "info"] },
            confidence: { type: "number" },
            title: { type: "string" },
            category: { type: "string" },
            files: {
              type: "array",
              items: {
                type: "object",
                additionalProperties: false,
                required: ["path"],
                properties: {
                  path: { type: "string" },
                  line: { type: "number" },
                },
              },
            },
            evidence: { type: "string" },
            impact: { type: "string" },
            recommendation: { type: "string" },
            blocksRelease: { type: "boolean" },
            disposition: { enum: ["open", "fixed", "accepted", "false_positive", "defer"] },
          },
        },
      },
      questions: { type: "array", items: { type: "string" } },
      limitations: { type: "array", items: { type: "string" } },
    },
  };
}

function blockingFindings(report) {
  return report.findings.filter((finding) => {
    if (finding.disposition !== "open") return false;
    if (finding.blocksRelease === true) return true;
    return ["blocker", "high"].includes(finding.severity) && finding.confidence >= 0.6;
  });
}

function dryRunReport(reviewKind, context) {
  return {
    schemaVersion: "truly.claudeReview.v1",
    kind: reviewKind,
    reviewed: context.reviewed,
    status: "pass",
    findings: [],
    questions: [],
    limitations: ["Dry run only; Claude was not invoked."],
  };
}

function renderSummary(reports) {
  const lines = [
    "# Claude Release Review Summary",
    "",
    `- Version: ${metadata.version}`,
    `- Version name: ${metadata.versionName}`,
    `- Recommended tag: ${metadata.recommendedTag}`,
    `- Commit: ${metadata.commit}`,
    `- Generated at: ${new Date().toISOString()}`,
    `- Mode: ${dryRun ? "dry run" : "claude -p"}`,
    `- Source: ${sourceArg}`,
    "",
  ];
  for (const report of reports) {
    lines.push(`## ${report.kind}`);
    lines.push("");
    lines.push(`- Status: ${report.status}`);
    lines.push(`- Findings: ${report.findings.length}`);
    const blocking = blockingFindings(report);
    lines.push(`- Blocking findings: ${blocking.length}`);
    if (report.findings.length > 0) {
      lines.push("");
      for (const finding of report.findings) {
        lines.push(`- [${finding.severity}] ${finding.title} (${finding.disposition})`);
      }
    }
    if (report.limitations.length > 0) {
      lines.push("");
      lines.push("Limitations:");
      for (const limitation of report.limitations) lines.push(`- ${limitation}`);
    }
    lines.push("");
  }
  return `${lines.join("\n")}\n`;
}

function latestFile(dir, name) {
  const absoluteDir = resolve(root, dir);
  if (!existsSync(absoluteDir)) return null;
  const candidates = [];
  for (const entry of readdirSync(absoluteDir)) {
    const candidate = join(absoluteDir, entry, name);
    if (existsSync(candidate)) candidates.push(candidate);
  }
  candidates.sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs);
  return candidates[0] ?? null;
}

function isPublicSafeTextFile(path) {
  if (
    path.startsWith("artifacts/") ||
    path.startsWith("dist/") ||
    path.startsWith("tmp/") ||
    path.startsWith("node_modules/") ||
    path.startsWith("data/") ||
    path.startsWith("tools/") ||
    path.startsWith(".env")
  ) {
    return false;
  }
  if (!/\.(mjs|js|ts|tsx|json|md|txt|css|html|yml|yaml)$/.test(path)) return false;
  try {
    const stat = statSync(resolve(root, path));
    return stat.isFile() && stat.size <= 200000;
  } catch {
    return false;
  }
}

function readText(path, maxChars) {
  return readFile(resolve(root, path), maxChars);
}

function readFile(path, maxChars) {
  try {
    return capText(readFileSync(path, "utf8"), maxChars);
  } catch {
    return "";
  }
}

function capText(text, maxChars) {
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars)}\n\n[truncated ${text.length - maxChars} chars]`;
}

function relativePath(path) {
  return relative(root, path);
}

function githubRepoUrl() {
  const remote = git(["remote", "get-url", "origin"], "").trim();
  if (!remote) throw new Error("Cannot build GitHub review URLs because origin remote is missing.");
  const sshMatch = /^git@github\.com:(.+?)(?:\.git)?$/.exec(remote);
  if (sshMatch) return `https://github.com/${sshMatch[1]}`;
  const httpsMatch = /^https:\/\/github\.com\/(.+?)(?:\.git)?$/.exec(remote);
  if (httpsMatch) return `https://github.com/${httpsMatch[1]}`;
  throw new Error(`Cannot convert origin remote to GitHub URL: ${remote}`);
}
