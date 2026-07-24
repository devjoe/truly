#!/usr/bin/env node

import { readFileSync } from "node:fs";

const REQUIRED_SNIPPETS = [
  {
    path: "docs/plans/general-page-reader-merge-readiness.md",
    snippets: [
      "430px Page/Web responsive overflow",
      "Page/Web design restraint",
      "Page/Web interaction accessibility",
      "phase-level timeouts",
      "Individual CDP commands also have client-side timeouts",
      "audit-progress.json",
      "audit-phase-log.json",
      "smoke:general-page-current -- --all-open",
      "--min-page-count",
      "--max-error-count",
      "--max-ready-count 0",
      "P24 dashboard/data-surface",
      "Real-web observation and 200-target live-DOM product-quality reviews stay under `tmp/` or private repos.",
      "codex/general-page-reader-ranked-actions",
      "requires the release tag `v0.1.2-preview.12`",
      "dashboard state for the earlier `0.1.1 Preview 9`",
      "cws:package:local-smoke",
      "artifacts/cws-local-smoke/",
      "explicitly non-uploadable",
      "Uploadable: no",
      "current-browser-smoke-summary.md",
      "omit real URLs",
      "threshold results",
      "private-host",
      "rejects unsafe summary fields",
      "`mainText`",
      "`http(s)` strings",
      "summarize:general-page-quality-findings",
      "quality-findings-summary.md",
      "plan:general-page-quality-followups",
      "quality-followups-plan.md",
      "cluster:general-page-quality-followups",
      "quality-followups-clusters.md",
      "fixture_candidate",
      "heuristic_review",
      "needs_private_review",
      "covered_by_existing_fixture",
      "check:general-page:synthetic",
      "not as the main proof of product quality",
      "auto-overconfident good suggestions",
      "target ids",
      "git fetch origin main",
      "npm run check:merge-readiness",
      "`origin/main` is an ancestor",
      "uploadable `cws:package` gate",
      "Mainline:",
      "general-page-ui-readiness-review.md",
      "P25 `article-root-utility-dense-ready-trap`",
      "P26 `multi-article-teaser-hub`",
      "Teaser hub overview",
      "page-teaser-hub-overview.png",
      "--progress-every 10",
      "review-2026-07-03T17-54-47-256Z",
      "199/200 extracted",
    ],
  },
  {
    path: "docs/plans/general-page-reader-fable5-validation.md",
    snippets: [
      "430px Page/Web responsive",
      "Page/Web design restraint audit",
      "Page/Web interaction accessibility audit",
      "smoke:general-page-current -- --all-open",
      "--min-page-count",
      "--max-error-count",
      "--max-ready-count 0",
      "current-browser-smoke-summary.md",
      "without exposing real URLs",
      "summarize:general-page-quality-findings",
      "quality-findings-summary.md",
      "plan:general-page-quality-followups",
      "quality-followups-plan.md",
      "cluster:general-page-quality-followups",
      "quality-followups-clusters.md",
      "P24 `semantic-main-dashboard-table` / `semantic-main-short-leaderboard`",
      "--source cdp",
      "Do not attach or commit real URLs",
      "P25 `article-root-utility-dense-ready-trap`",
      "P26 `multi-article-teaser-hub`",
      "Teaser hub overview",
      "general-page-ui-readiness-review.md",
    ],
  },
  {
    path: "docs/plans/general-page-ui-readiness-review.md",
    snippets: [
      "Page/Web should stay close to the existing Facebook Feed experience",
      "Ready pages keep analysis readiness compact and diagnostics collapsed",
      "caution/recovery",
      "page-teaser-hub-overview.png",
      "Do not add decorative visual polish",
    ],
  },
  {
    path: "docs/release/cws-reviewer-notes.md",
    snippets: [
      "Page/Web",
      "toolbar activation",
      "General Page all-sites access",
      "Screenshot-assisted recovery is offered only after a user-triggered Page/Web",
      "not written to extension storage or logs",
    ],
  },
  {
    path: "docs/release/privacy-policy.md",
    snippets: [
      "screenshot-assisted recovery",
      "confirm the preview",
      "not written to Chrome extension storage, logs",
      "durable page history",
    ],
  },
  {
    path: "docs/release/permission-justification.md",
    snippets: [
      "`activeTab`",
      "`scripting`",
      "`http://*/*`",
      "`https://*/*`",
      "General Page all-sites access",
      "Page/Web screenshot-assisted recovery uses the same user-gesture boundary",
      "does not add a separate screenshot permission",
    ],
  },
  {
    path: "docs/release/preview-command-contract.md",
    snippets: [
      "Page/Web current-page reading",
      "optional all-sites access",
      "screenshot-assisted recovery",
      "session-only page-content handling",
      "user confirmation",
      "public privacy claims",
      "caught up with `origin/main`",
      "mainline state",
    ],
  },
  {
    path: "docs/release/cws-submission-checklist.md",
    snippets: [
      "`origin/main` is `caught_up`",
    ],
  },
  {
    path: "docs/release/cws-reviewer-notes.md",
    snippets: [
      "`origin/main` caught-up checks",
    ],
  },
];

const errors = [];

for (const entry of REQUIRED_SNIPPETS) {
  const text = readFileSync(entry.path, "utf8");
  for (const snippet of entry.snippets) {
    if (!text.includes(snippet)) {
      errors.push(`${entry.path} must mention: ${snippet}`);
    }
  }
}

if (errors.length > 0) {
  console.error("General Page readiness docs check failed:");
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

console.log("General Page readiness docs check passed.");
