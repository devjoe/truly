# General Page Reader Review Handoff

Status: superseded by later runtime slices
Date: 2026-06-30

This handoff records the contract/evaluation state before Page/Web runtime UI,
model integration, current-region targeting, screenshot confirmation, and
live-DOM review mode landed. Keep it for historical review context only. The
current branch state is tracked in `general-page-reader.md`,
`general-page-model-integration.md`,
`general-page-6b-screenshot-livedom-handoff.md`, and the live-DOM quality
finding summaries.

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

## Runtime Non-Goals At This Earlier Slice

At this earlier slice, before Page/Web runtime/model integration, the branch was
still avoiding:

- importing `@mozilla/readability` or `defuddle` into `src/`;
- adding broad install-time host permissions;
- adding inline current-region UI;
- adding Threads-specific DOM support.

The parser dependency, broad install-time host-permission, inline UI, and
Threads boundaries remain in force. Page/Web model routing is no longer a
non-goal; it is implemented as session-only Slice 4 behavior through
`effectiveModelContext`.

## Runtime Slice 1 Status

Runtime slice 1 now creates a manually triggered content-script seam:

1. `src/content_scripts/page-reader.ts` extracts the current page into a
   `ReadingSurface` with the existing Truly heuristic extractor.
2. `PAGE_READING_REQUEST` can be forwarded by the service worker to a target
   tab and answered by a page-reader content script.
3. `PAGE_READING_RESULT` and `PAGE_READING_ERROR` are typed runtime responses.
4. `page-reader.ts` is built as an IIFE bundle for future manual/runtime
   loading.

This slice deliberately does not add broad manifest content-script injection.
The next product step should decide how the side panel manually activates page
reading under the current `activeTab` / optional host permission boundary.

## Next Runtime Slice

The next implementation slice should connect a side-panel command to this seam:

1. Identify the active tab from the side panel.
2. Ensure the page-reader content script is available for that tab under the
   accepted permission/loading strategy.
3. Send `PAGE_READING_REQUEST` through the service worker.
4. Render title, source, extraction status, warnings, and text preview.
5. Do not route page surfaces into model prompts until the page-mode UI state is
   reviewed.

Original acceptance criteria for the content-script seam:

- no third-party parser runtime imports;
- no permission expansion beyond the current `activeTab`/optional host boundary;
- Facebook content script behavior remains unchanged;
- the page-reader message seam is covered by contract/unit tests;
- `npm run check:public` passes.

The original planned seam was:

1. Add `src/content_scripts/page-reader.ts`.
2. Extract the current page into a `ReadingSurface` with the existing Truly
   heuristic extractor.
3. Add or activate typed runtime messages for page-reading request/result/error.
4. Keep the trigger manual and side-panel driven.
5. Do not render new user-facing page-mode UI until this message seam is tested.
