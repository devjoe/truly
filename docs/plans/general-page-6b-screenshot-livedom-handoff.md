# Slice 6b + Screenshot Flow + Live-DOM Harness: Acceptance Handoff

Status: accepted by Codex review on 2026-07-03; no branch-finalization action remains
Date: 2026-07-03

## Acceptance Resolution

Codex acceptance review has verified that the branch now points at the final commit chain and the worktree is clean. The earlier sandbox lock-file warning is historical only; do not run the old update-ref recovery procedure unless a future git status explicitly reports a lock problem.

Acceptance evidence is now tracked in `docs/plans/general-page-reader-merge-readiness.md`. Keep this file as the implementation handoff for Slice 6b, screenshot confirmation, and live-DOM harness mode.

## Item 1: Slice 6b Current-Region Point Target

What shipped:

- `src/lib/current-region-targeting.ts`: pure block resolution
  (preferred text blocks, bounded div/section fallback, never
  article/main/body), guards for editable, hidden, and extension-owned
  elements, pointer freshness (30 s).
- `page-reader.ts`: in-memory pointer tracking (never transmitted),
  `hotkey` + `current-region` handling with typed errors.
- SW command `truly-read-current-region` (Alt+Shift+R) → opens side panel +
  session marker `pendingCurrentRegionRead`; panel consumes it on bootstrap
  and via storage listener, then reuses the selection-target advisor path.
- Known bound: plain commands do not grant `activeTab`; hotkey reads work
  only when a page-reader session already exists, otherwise the panel shows
  toolbar-activation guidance. This is documented in the plan doc.

Accept by:

- `npm run check:public`
- `TRULY_EXTENSION_ID=... TRULY_AUDIT_AUTO_RELOAD=1 npm run audit:general-page-reader`
  → new checkpoint `Current-region target: 本地通過` + `page-point-target.png`
- Manual: read a page via toolbar, hover a paragraph, press Alt+Shift+R;
  Reading context should show `targetKind: current-region`. Hover a nav bar
  or an empty area and retry: panel should show the no-pointer-target
  guidance, not a broken state.

## Item 2: User-Confirmed Screenshot Analysis

What shipped:

- Advisor requests set `allowScreenshot` from the Tier B vision probe result
  (readiness `capabilities.vision === "supported"`); default stays false.
- Panel card: offer → `captureVisibleTab` preview → explicit confirm/cancel.
  The data URL is session-only, scrubbed with the session, never stored or
  logged; no auto-screenshot setting exists (per resolved decision).
- `GENERAL_PAGE_ANALYSIS_REQUEST.screenshotDataUrl` → Tier B brief chat body
  attaches an `image_url` part next to the unchanged text prompt.
- `generalPageBriefEligibility` allows `requires_user_target` only with
  `screenshotConfirmed: true`; `blocked` stays blocked.

Accept by:

- Contract/unit suites (included in `check:public`): eligibility gating,
  offer gating, chat-body image part, offer→preview→confirm runtime flow,
  and the no-vision-no-card guarantee.
- Manual (needs a vision-capable Tier B endpoint): open a JS-heavy/thin page
  where the advisor asks for a user target; the screenshot card should
  appear only then. Confirm the preview → brief renders. Check
  `chrome.storage` stays free of any data URL and the log export contains
  none.
- CDP audit note: the default audit runs without a Tier B endpoint, so the
  card intentionally does not appear there; no audit regression expected.

## Item 3: Live-DOM Review Harness Mode

What shipped:

- `scripts/lib/cdp-page-source.mjs` + `--source cdp [--cdp-port 9222]` on
  `review:general-page-product-quality`; live runs default to concurrency 2
  and record `input.sourceMode` in the private report.
- Closes validation finding 4 (static fetch understates JS-heavy sites).

Accept by:

- Static regression: run the harness on a small htmlPath target list without
  `--source`; behavior unchanged.
- Live smoke (host, Chrome with CDP): pick ~10 known JS-heavy targets from a
  private list and run with `--allow-network --source cdp`; JS-rendered
  sites that scored blocked/empty in the 2026-07-02 static run should now
  produce readable extractions or correct index downgrades.
- Privacy: rendered HTML stays in tmp/ private artifacts, same boundary as
  static runs.

## Suggested Follow-Ups (Not In Scope)

- Click-hold gesture and in-page anchor for 6b remain future work.
- Auto-screenshot setting stays unshipped pending demand.
- Consider a small live-DOM re-run of the 200-target review to re-baseline
  the blocked/empty upper bound noted in the validation record.
