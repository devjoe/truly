# General Page Reader Review Evidence - 2026-07-04

This is a public-safe handoff summary for strict review. Private live-page
screenshots, copied page text, target URLs, raw CDP payloads, and browser
storage values remain under `tmp/` and must not be committed.

## Scope

- Branch: `codex/general-page-reader-contract`
- Final audited runtime/tooling commit: `640f540`
- Branch HEAD after adding this public-safe evidence summary is docs-only
  beyond the audited runtime/tooling commit.
- Final audited build ID: `1783171675094-640f540`
- Release metadata: `0.1.2 Preview 12` / `v0.1.2-preview.12`
- Chrome Web Store baseline already published by the user: `0.1.1 Preview 9`

## Commits Added Before Review

- `623637d Show general page read elapsed time`
  - Adds `elapsedMs` to Page/Web read result/error messages.
  - Shows `讀取中 · N 秒` only after a read exceeds 2 seconds.
  - Keeps completed reads visually calm (`已讀取`) while exposing elapsed time
    through hover title and `aria-label`.
- `640f540 Stabilize Facebook current audit reruns`
  - Makes the Chinese locale audit robust to narrow/current Facebook layouts
    that expose only one Facebook chrome token.
  - Treats an already-expanded heads-up card as a valid repeat-audit state.

## Automated Checks

All commands below passed on final HEAD unless noted.

- `rtk npm run check:public`
  - Public-boundary check passed.
  - Release metadata passed.
  - General Page readiness docs passed.
  - General Page corpus passed: 55 fixtures, 26 patterns, 72 observation
    targets.
  - Parser spike passed runtime baseline: `truly-heuristic` threshold 55/55.
  - Parser advisor spike passed: 55 fixtures, 33 escalations, 0 failures.
  - Model integration audit passed.
  - Typecheck passed.
  - Public contract tests passed: 104 tests.
  - Public unit tests passed: 124 tests.
  - Build passed.
  - Release bundle audit passed.
- `rtk npm run audit:general-page-reader`
  - PASS on build `1783171675094-640f540`.
  - Artifact: `tmp/general-page-reader-audit-2026-07-04T13-28-31-641Z`.
- `rtk npm run audit:facebook-current:zh`
  - PASS on build `1783171675094-640f540`.
  - Artifact: `tmp/facebook-current-audit-2026-07-04T13-31-37-149Z`.
- `rtk npm run smoke:general-page-current -- --url-pattern tw.news.yahoo.com --min-page-count 1 --max-error-count 0 --max-empty-or-blocked-count 0 --fail-on-issue-tag jsonld-leak --fail-on-issue-tag recirc-leak`
  - PASS with one current-browser CDP page.
  - Sanitized host: `tw.news.yahoo.com`.
  - Extraction: `semantic-html`, `complete`, text length 816.
  - Model readiness: `ready`; suggested verdict: `good`.
  - `jsonld-leak`: 0; `recirc-leak`: 0.
  - Artifact: `tmp/general-page-product-quality/current-browser-review-2026-07-04T13-32-03-312Z`.
- `rtk npm run cws:preflight`
  - PASS for `0.1.2 Preview 12` / `v0.1.2-preview.12`.

## CDP UX Evidence

General Page Reader audit PASS covered:

- Popup activation for general pages.
- Ordinary article read.
- Page brief generation.
- 430px Page/Web responsive layout.
- Page/Web design restraint.
- Interaction accessibility.
- Saved-session switching across two page sessions.
- Selection target.
- Current-region shortcut.
- Hash/tracking URL changes ignored and meaningful URL changes marked stale.
- Noisy fallback caution.
- Candidate block recovery.
- Teaser hub overview.
- No-grant toolbar/all-sites guidance.

Facebook current-page audit PASS covered:

- Service worker and content script both fresh on build
  `1783171675094-640f540`.
- Facebook page locale `zh-Hant`.
- Truly Chinese UI tokens present.
- Heads-up rendered and bounded correctly.
- Selector health `healthy`.
- Heads-up expand state valid.
- Side panel opened from `建議查核`.
- Side panel visual health: no raw debug text, no overflow.

## Privacy And Debug Boundary

- Release bundle audit passed.
- `snapshot-redaction.test.ts` is included in `test:unit:public` and passed.
- A live CDP storage probe was run after Page/Web and Facebook checks. It
  printed only key names and boolean scan results, not stored values.
  - `chrome.storage.local`: no screenshot data URL, no current Yahoo article
    text, no raw HTML.
  - `chrome.storage.session`: no screenshot data URL, no current Yahoo article
    text, no raw HTML.
- Private audit artifacts remain in `tmp/`.

## Review Caveats

- `audit:facebook-current:zh` is live-feed dependent. Immediately after an
  extension or Facebook reload, the first visible heads-up card may still be in
  a loading state and not expose an action button. The final recorded run waited
  for a completed heads-up and passed.
- Current real-page smoke used one currently open Yahoo page, not a fresh
  15-25 site sample. The heavier 55-fixture corpus and CDP synthetic matrix
  passed; broader private real-site review remains a separate product-quality
  pass.
- The final branch is ahead of origin by four commits.
