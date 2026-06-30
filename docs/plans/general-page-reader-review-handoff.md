# General Page Reader Review Handoff

Status: ready for branch review before runtime UI work
Date: 2026-06-30

## Branch Scope

This branch prepares the General Page Reader contract and evaluation layer for
Truly. It does not connect third-party parser dependencies to extension runtime
code.

Runtime-owned code added or hardened:

- `src/lib/reading-surface-types.ts`
- `src/lib/reading-target-types.ts`
- `src/lib/general-page-extraction.ts`
- message contract seams for page and target reading requests/results

Dev/evaluation-only code added or hardened:

- synthetic fixture corpus and manifest under `tests/fixtures/general-pages/`
- parser candidate spike in `scripts/spike-general-page-parsers.mjs`
- parser suitability and threshold contract in
  `scripts/lib/general-page-parser-contract.mjs`
- private real-world eval runner in
  `scripts/evaluate-general-page-real-world.mjs`
- private observation tooling in `scripts/observe-general-page-structure.mjs`

## Review Findings Already Addressed

Claude review found no merge blockers, but flagged several items to handle
before runtime work. The branch now addresses the high-value items:

- `check:general-page` runs both `check:general-page-corpus` and
  `spike:general-page-parsers`.
- `check:general-page` is part of `check:public` and
  `check:public:release-tag`.
- Real-world eval sanitizer has a no-leak unit test for URL, raw text,
  excerpt, preview, expected snippets, title, author, and site labels.
- Newsletter CTA text no longer marks a normal readable article as paywall-like.
- Rich media/link-dense article coverage now guards against over-demoting valid
  articles to `partial`.
- Fixture-level `expected.status` can require stricter runtime-baseline status
  checks for selected fixtures.
- Observation reports now state that they still contain target URLs/final
  URLs/labels and must remain private.
- `targetHash` is documented as a private diffing aid, not a publishable
  anonymized identifier.

## Current Verification Baseline

After bumping branch preview metadata to `0.1.1 Preview 11`, the full public
gate passes:

```bash
npm run check:public
```

The public gate includes:

- public boundary check;
- release metadata check;
- general-page corpus check;
- parser spike threshold and runtime-baseline suitability gates;
- TypeScript check;
- public contract tests;
- public unit tests;
- production build;
- release bundle audit.

Private real-world eval batch 1 also reran after the heuristic changes:

```text
evaluated 20/22; errors 2
runtimeSuitabilityFailures: {}
```

The remaining two private target failures are pages where all parser candidates
returned empty output. They do not justify adding more public fixtures yet.

## Runtime Non-Goals Still In Force

Before a separate parser-runtime adoption decision, the branch must continue to
avoid:

- importing `@mozilla/readability` or `defuddle` into `src/`;
- changing model prompts or model routing for page reading;
- adding broad install-time host permissions;
- adding inline current-region UI;
- adding Threads-specific DOM support.

## Next Runtime Slice

The next implementation slice is a manually triggered content-script seam:

1. Add `src/content_scripts/page-reader.ts`.
2. Extract the current page into a `ReadingSurface` with the existing Truly
   heuristic extractor.
3. Add or activate typed runtime messages for page-reading request/result/error.
4. Keep the trigger manual and side-panel driven.
5. Do not render new user-facing page-mode UI until this message seam is tested.

Acceptance criteria for that slice:

- no third-party parser runtime imports;
- no permission expansion beyond the current `activeTab`/optional host boundary;
- Facebook content script behavior remains unchanged;
- the page-reader message seam is covered by contract/unit tests;
- `npm run check:public` passes.
