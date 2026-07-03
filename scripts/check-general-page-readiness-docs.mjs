#!/usr/bin/env node

import { readFileSync } from "node:fs";

const REQUIRED_SNIPPETS = [
  {
    path: "docs/plans/general-page-reader-merge-readiness.md",
    snippets: [
      "430px Page/Web responsive overflow",
      "Page/Web design restraint",
      "smoke:general-page-current -- --all-open",
      "P24 dashboard/data-surface",
      "Real-web observation and 200-target live-DOM product-quality reviews stay under `tmp/` or private repos.",
    ],
  },
  {
    path: "docs/plans/general-page-reader-fable5-validation.md",
    snippets: [
      "430px Page/Web responsive",
      "Page/Web design restraint audit",
      "smoke:general-page-current -- --all-open",
      "P24 `semantic-main-dashboard-table` / `semantic-main-short-leaderboard`",
      "--source cdp",
      "Do not attach or commit real URLs",
    ],
  },
  {
    path: "docs/release/cws-reviewer-notes.md",
    snippets: [
      "Page/Web",
      "toolbar activation",
      "General Page all-sites access",
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
