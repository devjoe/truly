# General Page Reader Merge Readiness

Status: ready for focused reviewer validation, not yet merged
Date: 2026-07-03

This document is the current public-safe readiness index for the General Page Reader branch. It intentionally summarizes private real-site review work without committing target URLs, screenshots, copied page text, labels, or review HTML.

## Accepted Runtime Scope

- Page/Web reads are explicitly user-triggered through toolbar popup activation or optional all-sites access enabled from Settings.
- Whole-page, selected-text, and current-region reading paths share the same Page/Web session model and remain session-only.
- Page/Web model integration uses a single Tier B `GeneralPageBrief` request over the effective reading context, not the raw full DOM or hidden private artifacts.
- Screenshot-assisted recovery is user-confirmed only, vision-gated, session-only, and never stored in `chrome.storage` or logs.
- Multi-tab Page/Web sessions can be viewed and activated without implicitly switching the active Chrome tab.
- Diagnostics remain inspectable for early users; ordinary ready pages keep model context as a compact one-line inspection row while caution/recovery states keep expanded diagnostics.

## Accepted Evaluation Scope

- Public fixtures stay synthetic and anonymous.
- Real-web observation and 200-target live-DOM product-quality reviews stay under `tmp/` or private repos.
- `audit:general-page-reader` is the runtime acceptance harness for popup activation, ordinary reads, model brief generation, 430px Page/Web responsive overflow, Page/Web design restraint, Page/Web interaction accessibility, session switching, selection, current-region, URL stale handling, noisy fallback, candidate recovery, teaser-hub overview downgrade, and no-grant guidance.
- `general-page-ui-readiness-review.md` records the current Page/Web component decisions: keep ready pages quiet, expand diagnostics only for caution/recovery, preserve the compact Feed-aligned side-panel style, and avoid decorative reader-mode UI.
- Long-running `audit:general-page-reader` phases are bounded by phase-level timeouts and write `audit-progress.json` plus `audit-phase-log.json`, so a CDP/browser hang fails with a diagnosable artifact instead of blocking reviewer validation indefinitely. Individual CDP commands also have client-side timeouts so an unresponsive `Runtime.evaluate` cannot bypass the phase's inner diagnostic screenshots and JSON state capture.
- `check:merge-readiness` verifies that the feature branch is clean, synced with
  its upstream, and caught up with `origin/main`, so reviewer validation does
  not depend on a stale local `main` checkout or a visually inspected
  ahead/behind count.
- The uploadable `cws:package` gate also requires the package commit to be
  caught up with `origin/main`; `cws:package:local-smoke` records the same
  mainline state for reviewer context but remains explicitly non-uploadable.
- `audit:general-page-model-integration` is included in `check:general-page` and verifies model payload scoping plus deterministic overview guards with a local mock endpoint. Session-only storage behavior is covered by code review and runtime privacy checks, not by that audit alone.
- The live-DOM 200-target review proved the harness is useful for finding false-ready page patterns; public follow-up is represented only as aggregate findings plus synthetic fixtures.
- `smoke:general-page-current` writes a public-safe `current-browser-smoke-summary.json` and `current-browser-smoke-summary.md` next to the private review artifacts. These summaries omit real URLs, titles, extracted text, screenshots, copied page content, and per-target notes while preserving readiness counts, issue tags, threshold results, and sanitized host-level evidence. Localhost and private/internal hosts are reduced to `localhost` or `private-host`. The smoke script rejects unsafe summary fields such as `url`, `title`, `mainText`, `textContent`, raw HTML, screenshots, data URLs, and `http(s)` strings before writing the public-safe summary.
- Current-browser smoke can now fail on reviewer-shaped thresholds without manual JSON inspection: minimum page count, maximum ready count, maximum fetch/runtime errors, maximum empty-or-blocked pages, and selected public-safe issue tags.
- `summarize:general-page-quality-findings` converts a private 200-target `review.json` plus optional `manual-labels.jsonl` into `quality-findings-summary.json` and `.md` aggregate follow-up candidates. It groups bad labels, auto-overconfident good suggestions, auto-underconfident blocked suggestions, caution clusters, and issue-tag clusters while omitting real URLs, titles, excerpts, previews, notes, screenshots, target ids, seed ids, and source content.
- `plan:general-page-quality-followups` converts `quality-findings-summary.json` into `quality-followups-plan.json` and `quality-followups-plan.md`. It validates existing synthetic fixture coverage against `tests/fixtures/general-pages/manifest.json`, marks covered clusters such as source-link noise and index-like semantic-main traps, and keeps broad symptoms such as partial/fallback extraction in `needs_private_review` until repeated private DOM shapes can be rewritten as synthetic fixtures.
- `cluster:general-page-quality-followups` reads the private review, labels, and `quality-followups-plan.json`, then writes `quality-followups-clusters.json` and `quality-followups-clusters.md`. It clusters only structural signals such as document-shape buckets, extraction/readiness state, issue tags, and count medians, so reviewer handoff can name `fixture_candidate`, `heuristic_review`, or `private_review_only` work without exposing targets or copied page content.

## Security Review Follow-Up State

- F1 privileged background message sender hardening: explicitly out of scope for this pass per product direction.
- F2 Facebook MAIN to isolated bridge nonce: explicitly out of scope for this pass per product direction.
- F3 screenshot data URL format assertion: accepted in runtime. The Page/Web screenshot flow rejects non-image data URLs before preview and before sending.
- F4 link scheme allowlist at normalization boundary: accepted in runtime. `normalizeHref` returns only `http:` and `https:` links for extracted page links and images, with contract coverage for `javascript:`, `data:`, `mailto:`, and `tel:` inputs.
- F5 GitHub Actions SHA pinning: completed as repository supply-chain
  hardening. CI and artifact workflows pin third-party actions to commit SHAs,
  Dependabot is configured for `npm` and `github-actions`, and
  `check:public-boundary` rejects external workflow actions that are not pinned
  to a 40-character commit SHA.

## Reviewer Gate Checklist

Before merging this branch back to Truly, rerun these from a clean worktree:

```bash
git fetch origin main
npm run check:merge-readiness
npm run check:public
npm run cws:preflight
TRULY_EXTENSION_ID=<loaded-extension-id> TRULY_AUDIT_AUTO_RELOAD=1 npm run audit:general-page-reader
```

`check:merge-readiness` verifies that `origin/main` is an ancestor of the
feature branch, that the branch is synced with its upstream, and that the
worktree is clean. A nonzero right-side count is expected until the branch is
merged; a nonzero left-side count means the worktree needs to catch up with the
remote mainline first.

If packaging is the next action, run this only after the branch is pushed and release metadata is final:

```bash
npm run cws:package
```

Before push, use only the non-uploadable local package smoke:

```bash
npm run cws:package:local-smoke
```

## Advisory Review And Packaging State

- `release:review:local-limited-context -- --dry-run`: passed on 2026-07-03 and generated ignored `artifacts/review/...` prompt/schema artifacts only.
- `cws:review:local-limited-context -- --dry-run`: passed on 2026-07-03 and generated ignored `artifacts/review/...` prompt/schema artifacts only.
- Live `TRULY_ENABLE_CLAUDE_REVIEW=1 npm run release:review:local-limited-context`: not accepted as evidence in this environment. The 2026-07-04 attempt was rejected by the execution policy because it would send repo-local release context and diffs to an external Claude service.
- Live `TRULY_ENABLE_CLAUDE_REVIEW=1 npm run cws:review:local-limited-context`: not accepted as evidence in this environment for the same external-context reason. Do not treat dry-run artifacts as advisory pass results. The remaining advisory item is still an operational pre-upload check: confirm the Chrome Web Store dashboard disposition of the older `0.1.1 Preview 9` submission before uploading `0.1.2`.
- CWS preview metadata was bumped from `0.1.1 Preview 11` to `0.1.2 Preview 12` after advisory review flagged that reusing the numeric `0.1.1` package version would risk a dashboard collision with the earlier Preview 9 submission.
- `docs/release/cws-submission-checklist.md` now includes a manual dashboard gate for already published, in-review, or otherwise occupied packages for the current numeric `manifest.version`.
- `docs/release/cws-listing-copy.md`, `docs/release/cws-reviewer-notes.md`, `docs/release/permission-justification.md`, and `docs/release/privacy-policy.md` now all disclose Page/Web screenshot-assisted recovery as user-confirmed, vision-gated, session-only, and not stored in `chrome.storage`.
- The hosted privacy policy source in the `trulyreader.org` repository has been updated with the same Page/Web screenshot-assisted recovery disclosure and pushed at commit `ee84ac5`. The canonical live URL `https://trulyreader.org/privacy/` was verified on 2026-07-04 with `curl` and contained the 2026-07-04 Page/Web screenshot-assisted recovery, vision-input, confirmation, session-only, and `chrome.storage` disclosure text.
- `codex/general-page-reader-contract` is pushed and tracks
  `origin/codex/general-page-reader-contract`. A formal uploadable
  `npm run cws:package` still requires the release tag
  `v0.1.2-preview.12` to exist locally and point at HEAD, and the Chrome Web
  Store dashboard state for the earlier `0.1.1 Preview 9` submission must be
  confirmed before uploading.
- `npm run cws:package:local-smoke`: available for pre-push ZIP creation, package-boundary audit, and `cws:preflight`. Its artifacts live under `artifacts/cws-local-smoke/`, are explicitly non-uploadable, and do not satisfy the upstream-sync or release-tag upload gates.
- Formal `npm run cws:package` now also refuses to build an uploadable package
  unless the package commit is caught up with `origin/main`. Local-smoke reports
  include `Mainline:` evidence but still mark mainline freshness as an omitted
  upload gate.
- Human-owned release review for `3ab9984` returned
  `approve_with_conditions`. The blocking findings were fixed in `4c8d517`:
  Page/Web screenshot data URLs are redacted from debug snapshot DOM exports,
  and the readiness doc no longer claims storage behavior is verified by
  `audit:general-page-model-integration`. The same commit also added service
  worker screenshot data URL validation, removed unsafe canonical URL fallback,
  and marked formal CWS packages as non-uploadable when dirty/unpushed escape
  hatches are used.

## Recent Local Verification Evidence

Representative recent clean-HEAD runs from this worktree on 2026-07-04:

- `check:public`: passed from clean release-review-fix HEAD `4c8d517`. This
  included public-boundary, release metadata, General Page corpus/parser/model
  gates, typecheck, public contract tests, public unit tests, production build,
  and release bundle audit. The production build recorded build ID
  `1783142895748-4c8d517`, with no dirty suffix.
- `cws:preflight`: passed from clean release-review-fix HEAD `4c8d517` for
  `0.1.2 Preview 12` / `v0.1.2-preview.12`.
- `audit:general-page-reader`: passed from clean release-review-fix HEAD
  `4c8d517`. Expected and live build IDs matched
  `1783142895748-4c8d517`; QA matrix rows passed for popup activation,
  ordinary article read, model brief generation, 430px responsive layout,
  Page/Web design restraint, interaction accessibility, saved-session
  switching, selection target, current-region shortcut, URL identity/stale
  scrub, noisy fallback caution, candidate block recovery, teaser-hub overview,
  and no-grant guidance. Bencium-guided visual checks of
  `page-analysis-ready.png` and `page-responsive-430.png` confirmed the compact
  Feed-aligned layout and no narrow side-panel overflow. Private CDP artifact:
  `tmp/general-page-reader-audit-2026-07-04T05-28-44-544Z`.
- `smoke:general-page-current --all-open --min-page-count 4 --max-error-count
  0`: passed from clean release-review-fix HEAD against four currently open
  HTTP(S) tabs through live CDP. Sanitized aggregate: 3 extracted caution pages,
  1 blocked/empty page, 0 fetch/runtime errors, threshold `pass`, and no pages
  marked ready; public-safe summary:
  `tmp/general-page-product-quality/current-browser-review-2026-07-04T05-30-07-602Z/current-browser-smoke-summary.md`.
- `check:merge-readiness`: passed from clean, pushed documentation HEAD `8c3e31e`. It reported `origin/main` behind=0 / ahead=122 / ancestor=true and `origin/codex/general-page-reader-contract` ahead=0 / behind=0.
- `check:merge-readiness`: also passed from clean, pushed implementation HEAD `c505333` before the documentation-only evidence clarification. It reported `origin/main` behind=0 / ahead=121 / ancestor=true and `origin/codex/general-page-reader-contract` ahead=0 / behind=0.
- Formal `cws:package`: reached the release-tag upload gate from clean, pushed, mainline-caught-up HEAD `c505333` and refused to package because `v0.1.2-preview.12` does not yet exist locally. This is the expected remaining upload gate before any Chrome Web Store ZIP can be produced.
- `cws:package:local-smoke`: passed from clean HEAD `c505333`. It wrote an explicitly non-uploadable local package report at `artifacts/cws-local-smoke/0.1.2-c5053339adce-2026-07-04T04-39-30-809Z/cws-local-smoke-report.md`, recorded build ID `1783139969912-c505333`, kept `Uploadable: no`, recorded `Mainline: origin/main (caught_up; ahead=121, behind=0, ancestor=true)`, and listed all selected CWS screenshots and promo tile as `status=ok`.
- `audit:general-page-reader`: passed from clean HEAD `c505333` with expected and live build IDs matched at `1783139969912-c505333`. QA matrix rows passed for popup activation, ordinary article read, model brief generation, 430px responsive layout, Page/Web design restraint, interaction accessibility, saved-session switching, selection target, current-region shortcut, URL identity/stale scrub, noisy fallback caution, candidate block recovery, teaser-hub overview, and no-grant guidance. A Bencium-guided visual check of `page-analysis-ready.png` and `page-responsive-430.png` confirmed the compact Feed-aligned layout and no narrow side-panel overflow. Private CDP artifact: `tmp/general-page-reader-audit-2026-07-04T04-40-00-152Z`.
- `smoke:general-page-current --all-open --min-page-count 4 --max-error-count 0`: passed from clean HEAD against four currently open HTTP(S) tabs through live CDP. Sanitized aggregate: 3 extracted caution pages, 1 blocked/empty page, 0 fetch/runtime errors, threshold `pass`, and no pages marked ready; public-safe summary: `tmp/general-page-product-quality/current-browser-review-2026-07-04T04-41-17-503Z/current-browser-smoke-summary.md`.

Representative runs from this worktree on 2026-07-03, after the non-uploadable local-smoke package path was added. Re-run the Reviewer Gate Checklist from the current HEAD before merge or upload:

```bash
npm run check:public
npm run cws:preflight
npm run cws:package:local-smoke
TRULY_EXTENSION_ID=idcjllbajkejmljompodofmmdmlbendl TRULY_AUDIT_AUTO_RELOAD=1 npm run audit:general-page-reader
npm run smoke:general-page-current -- --url-pattern 'tw\.news\.yahoo\.com' --category current-browser-smoke --page-type news-article
npm run smoke:general-page-current -- --all-open --limit 4 --category current-browser-open-tabs --page-type open-tab --timeout-ms 25000 --concurrency 2 --max-ready-count 0
npm run smoke:general-page-current -- --all-open --limit 6 --min-page-count 4 --max-error-count 0 --category current-browser-open-tabs --page-type open-tab --timeout-ms 25000 --concurrency 2
npm run review:general-page-product-quality -- --input tmp/general-page-product-quality/targets-200-balanced-v2.json --allow-network --source cdp --limit 200 --concurrency 2 --timeout-ms 25000 --progress-every 10
npm run summarize:general-page-quality-findings -- --review tmp/general-page-product-quality/review-.../review.json --labels tmp/general-page-product-quality/review-.../manual-labels.jsonl
npm run plan:general-page-quality-followups -- --summary tmp/general-page-product-quality/review-.../quality-findings-summary.json
npm run cluster:general-page-quality-followups -- --review tmp/general-page-product-quality/review-.../review.json --labels tmp/general-page-product-quality/review-.../manual-labels.jsonl --plan tmp/general-page-product-quality/review-.../quality-followups-plan.json
```

Results:

- `check:merge-readiness`: added and passed from clean HEAD `94eae34` after the
  branch was pushed. It reported `origin/main` behind=0 / ahead=118 /
  ancestor=true, and `origin/codex/general-page-reader-contract` ahead=0 /
  behind=0. A pre-push strict run correctly failed on one unpushed commit,
  proving the gate catches local-only reviewer state before merge validation.
- Uploadable CWS package mainline gate: added after the merge-readiness gate so
  formal `cws:package` cannot produce a Chrome Web Store ZIP from a feature
  branch that is synced to its own upstream but stale relative to `origin/main`.
  The non-uploadable local-smoke report records the same `Mainline:` state while
  continuing to list mainline freshness under omitted upload gates.
- `check:public`: passed from clean HEAD `94eae34`. This included
  public-boundary, release metadata, General Page readiness-docs check, General
  Page corpus, parser spikes, parser-advisor spike, model integration audit,
  typecheck, public contract tests, public unit tests, production build, and
  release bundle audit. The production build recorded build ID
  `1783110226179-94eae34`, with no dirty suffix.
- `audit:general-page-reader`: passed from clean HEAD `94eae34`. Expected and
  live build IDs matched `1783110226179-94eae34`; QA matrix rows passed for
  popup activation, ordinary article read, model brief generation, 430px
  responsive layout, Page/Web design restraint, interaction accessibility,
  saved-session switching, selection target, current-region shortcut, URL
  identity/stale scrub, noisy fallback caution, candidate block recovery,
  teaser-hub overview, and no-grant guidance. A Bencium-guided visual check of
  `page-analysis-ready.png` and `page-responsive-430.png` confirmed the ready
  path remains compact, diagnostic-collapsed, Feed-aligned, and free of narrow
  side-panel overflow or clipped controls. Private CDP artifact:
  `tmp/general-page-reader-audit-2026-07-03T20-23-55-663Z`.
- `smoke:general-page-current --all-open --min-page-count 4 --max-error-count
  0`: passed from clean HEAD against four currently open HTTP(S) tabs through
  live CDP. Sanitized aggregate: 3 extracted caution pages, 1 blocked/empty
  page, 0 fetch/runtime errors, threshold `pass`, and no pages marked ready;
  public-safe summary:
  `tmp/general-page-product-quality/current-browser-review-2026-07-03T20-25-25-388Z/current-browser-smoke-summary.md`.
- `cws:package:local-smoke`: passed from clean HEAD `94eae34`. It wrote an
  explicitly non-uploadable local package report at
  `artifacts/cws-local-smoke/0.1.2-94eae34b9f71-2026-07-03T20-25-57-134Z/cws-local-smoke-report.md`,
  audited the generated ZIP, ran `check:public`, ran `cws:preflight`, recorded
  build ID `1783110356289-94eae34`, confirmed branch upstream was synced, kept
  `Uploadable: no`, and listed all selected CWS screenshots and promo tile as
  `status=ok` with expected/actual dimensions.
- Branch-base sanity check from clean HEAD `dc2497b` after `git fetch origin
  main`: `origin/main` is an ancestor of the feature branch and
  `origin/main...HEAD` reported `0 116`, so reviewer validation is not blocked
  by the feature worktree lagging behind the remote mainline.
- `check:public`: passed from clean HEAD `9df983b`. This included
  public-boundary, release metadata, General Page readiness-docs check, General
  Page corpus, parser spikes, parser-advisor spike, model integration audit,
  typecheck, public contract tests, public unit tests, production build, and
  release bundle audit. The production build recorded build ID
  `1783109614050-9df983b`, with no dirty suffix.
- `audit:general-page-reader`: passed from clean HEAD `9df983b`. Expected and
  live build IDs matched `1783109614050-9df983b`; QA matrix rows passed for
  popup activation, ordinary article read, model brief generation, 430px
  responsive layout, Page/Web design restraint, interaction accessibility,
  saved-session switching, selection target, current-region shortcut, URL
  identity/stale scrub, noisy fallback caution, candidate block recovery,
  teaser-hub overview, and no-grant guidance. A Bencium-guided visual check of
  `page-analysis-ready.png` and `page-responsive-430.png` confirmed the ready
  path remains compact, diagnostic-collapsed, Feed-aligned, and free of narrow
  side-panel overflow or clipped controls. Private CDP artifact:
  `tmp/general-page-reader-audit-2026-07-03T20-13-45-765Z`.
- `smoke:general-page-current --all-open --min-page-count 4 --max-error-count
  0`: passed from clean HEAD against four currently open HTTP(S) tabs through
  live CDP. Sanitized aggregate: 3 extracted caution pages, 1 blocked/empty
  page, 0 fetch/runtime errors, threshold `pass`, and no pages marked ready;
  public-safe summary:
  `tmp/general-page-product-quality/current-browser-review-2026-07-03T20-14-59-383Z/current-browser-smoke-summary.md`.
- `cws:package:local-smoke`: passed from clean HEAD `9df983b`. It wrote an
  explicitly non-uploadable local package report at
  `artifacts/cws-local-smoke/0.1.2-9df983b451e2-2026-07-03T20-15-28-763Z/cws-local-smoke-report.md`,
  audited the generated ZIP, ran `check:public`, ran `cws:preflight`, recorded
  build ID `1783109727874-9df983b`, confirmed branch upstream was synced, kept
  `Uploadable: no`, and listed all selected CWS screenshots and promo tile as
  `status=ok` with expected/actual dimensions.
- `check:public`: passed. This included public-boundary, release metadata, General Page readiness-docs check, General Page corpus, parser spikes, parser-advisor spike, model integration audit, typecheck, public contract tests, public unit tests, production build, and release bundle audit.
- `check:public`: passed again from clean HEAD after the advisory-review and
  supply-chain hardening commits. The production build recorded build ID
  `1783103572127-f5bb5e8`, with no dirty suffix.
- `check:public`: passed for clean HEAD `80a0e9a` after
  the CWS preview bump, privacy disclosure alignment, CWS checklist gate, and
  preflight guard update. The production build recorded build ID
  `1783105704368-80a0e9a`, with no dirty suffix.
- `cws:preflight`: passed for `0.1.2 Preview 12` / `v0.1.2-preview.12`.
- `cws:package:local-smoke`: passed from clean HEAD `80a0e9a`. It wrote an explicitly non-uploadable local package report at `artifacts/cws-local-smoke/0.1.2-80a0e9a45df2-2026-07-03T19-08-43-110Z/cws-local-smoke-report.md`, audited the generated ZIP, ran `cws:preflight`, and recorded `Uploadable: no`.
- `audit:general-page-reader`: passed after adding the 430px Page/Web responsive overflow gate. The QA matrix also records Page/Web design restraint and interaction accessibility: ready-path diagnostics stay collapsed, model context remains compact, source links stay capped, caution diagnostics expand, the 430px layout remains clean, and visible controls keep accessible names without undersized primary buttons/tabs. The no-grant guidance path now verifies that toolbar/all-sites guidance appears in the primary status detail without generic retry text or a duplicate error block. Clean-HEAD private CDP artifact: `tmp/general-page-reader-audit-2026-07-03T15-31-42-943Z` (`1783092670025-fe854b6`).
- `smoke:general-page-current`: passed against the currently open Yahoo Taiwan news page through live CDP. Sanitized result: extracted, semantic HTML, partial/caution, model eligible, 6 model-context links after filtering; private artifact: `tmp/general-page-product-quality/current-browser-review-2026-07-03T13-58-47-423Z`.
- `smoke:general-page-current --all-open --max-ready-count 0`: passed against four open HTTP(S) tabs through live CDP after adding P24 dashboard/data-surface coverage. Sanitized result: 3 extracted / 1 blocked-or-empty, readiness `caution: 3`, `blocked: 1`, threshold `readyCount: 0`, and no dashboard or leaderboard data surface marked ready/good; private artifact: `tmp/general-page-product-quality/current-browser-review-2026-07-03T15-16-22-109Z`.
- `smoke:general-page-current --all-open --min-page-count 4 --max-error-count 0`: passed against five open HTTP(S) tabs through live CDP after adding thresholded current-browser smoke. Sanitized result: 4 extracted / 1 blocked-or-empty, readiness `caution: 4`, `blocked: 1`, threshold `pass`, `pageCount: 5`, `readyCount: 0`, `errorCount: 0`; private artifact: `tmp/general-page-product-quality/current-browser-review-2026-07-03T16-32-23-495Z`.
- `smoke:general-page-current --all-open --min-page-count 4 --max-error-count 0`: passed again after host redaction. Sanitized result kept public hosts visible but reduced local/private tabs to `localhost` and `private-host`; private artifact: `tmp/general-page-product-quality/current-browser-review-2026-07-03T16-44-58-708Z`.
- New smoke runs also persist `current-browser-smoke-summary.md` and `.json` inside the same ignored output directory so reviewers can cite sanitized live-CDP evidence without copying terminal output or exposing private target data.
- Thresholded smoke summaries include `pass`, `failures`, thresholds, and counts in the public-safe summary so reviewers can distinguish "ran and passed" from "ran and still needs manual triage."
- Product-quality finding summaries are intended for reviewer handoff after manual labeling: copy only aggregate clusters and recommendations from `quality-findings-summary.md`; keep the source `review.json`, labels, review HTML, screenshots, URLs, copied page text, and per-target notes private.
- `summarize:general-page-quality-findings`: passed against an existing 200-target labeled private review as a tooling validation. It wrote `quality-findings-summary.json` and `.md`, reported `193/200` reviewed and 20 follow-up candidates, and an automated check found no URL-like strings, raw HTML markers, or target ids in the JSON. Treat those candidate counts as historical validation data, not the current runtime quality baseline.
- `plan:general-page-quality-followups`: passed against the same existing 200-target labeled private review after the findings summary. It wrote `quality-followups-plan.json` and `quality-followups-plan.md`, verified referenced fixture ids against the public synthetic corpus, and produced 20 public-safe follow-up items: 11 `needs_private_review`, 8 `covered_by_existing_fixture`, and 1 `harness_condition`.
- `cluster:general-page-quality-followups`: passed against the same existing 200-target labeled private review after the follow-up plan. It wrote `quality-followups-clusters.json` and `quality-followups-clusters.md`, reported 284 key-row matches from 63 unique rows across 11 follow-up keys, and separated cluster next actions into 22 `fixture_candidate`, 24 `heuristic_review`, and 7 `private_review_only` clusters. The output passed a URL/raw-HTML/target-id scan.
- `smoke:general-page-current --all-open --min-page-count 4 --max-error-count 0`: passed after adding the follow-up planner. Sanitized result: 5 pages, 4 caution, 1 blocked, 0 errors, threshold `pass`; source-link host redaction still reduced local/private tabs to `localhost` and `private-host`; private artifact: `tmp/general-page-product-quality/current-browser-review-2026-07-03T16-56-56-594Z`.
- Cluster-to-fixture conversion started with P25 `article-root-utility-dense-ready-trap`, derived from repeated false-ready article roots in the cluster report. Runtime heuristic now marks article roots with dense utility links plus form/control UI as `large-navigation-noise`, keeping the model path eligible but caution instead of clean-ready. Parser spike passed at 53/53 runtime fixtures; Readability leaking one P25 utility/ticker item is retained as a non-blocking candidate-parser warning.
- Parser-advisor routing now separates noisy article roots from true index/feed pages: P25 stays in article analysis/candidate-block recovery instead of page-overview downgrade, while synthetic list-index/dashboard fixtures still downgrade to `index_or_feed`. `smoke:general-page-current --all-open --min-page-count 4 --max-error-count 0` passed after the P25 change with 5 pages, 0 errors, 4 caution, 1 blocked, threshold `pass`; private artifact: `tmp/general-page-product-quality/current-browser-review-2026-07-03T17-16-14-544Z`.
- Cluster-to-fixture conversion continued with P26 `multi-article-teaser-hub`, derived from repeated private review clusters where several short `article` teaser cards were mistaken for an article-like context. Runtime extraction now marks short repeated article cards without article metadata as `large-navigation-noise`, parser-advisor downgrades the effective context to `page_overview_only`, and the public corpus covers 54 fixtures / 26 patterns.
- `audit:general-page-reader`: passed after adding the teaser-hub runtime case. The QA matrix now includes `Teaser hub overview` and asserts `downgrade_to_index_or_feed`, `page_overview_only`, expanded caution diagnostics, and no header/sidebar utility source links. Private CDP artifact: `tmp/general-page-reader-audit-2026-07-03T17-34-50-496Z` (`1783099966448-a74a0f3-dirty`).
- `smoke:general-page-current --all-open --min-page-count 4 --max-error-count 0`: passed after the P26 change against six open HTTP(S) tabs. Sanitized result: 5 extracted / 1 empty-or-blocked, 5 caution / 1 blocked, 0 fetch/runtime errors, threshold `pass`, and no pages marked ready; private artifact: `tmp/general-page-product-quality/current-browser-review-2026-07-03T17-36-10-587Z`.
- `general-page-ui-readiness-review.md`: added after visual inspection of clean CDP screenshots. It records that ready pages stay quiet, caution/recovery pages expand diagnostics, source links remain capped, and Page/Web keeps the compact Feed-aligned side-panel style. The CDP screenshot set now includes `page-teaser-hub-overview.png` for the P26 overview-only path.
- `review:general-page-product-quality --source cdp --limit 200`: reran against the balanced v2 private target list after the P25/P26 fixes. Sanitized aggregate: 199/200 extracted, 1 empty-or-blocked, 0 fetch errors, readiness `ready: 100`, `caution: 99`, `blocked: 1`; private artifact: `tmp/general-page-product-quality/review-2026-07-03T17-54-47-256Z`. The public-safe follow-up plan for that run reported 13 items: 4 `covered_by_existing_fixture` and 9 `needs_private_review`; it did not produce a new automatic fixture candidate without manual labels.
- `review:general-page-product-quality --progress-every`: added after the 200-target CDP refresh exposed that long live-DOM runs were too quiet. Progress output is public-safe aggregate only (`completed/total`, extracted, empty-or-blocked, fetch errors, elapsed seconds, readiness counts) and was smoke-tested against synthetic local fixtures with `--progress-every 1`.
- `release:review:local-limited-context -- --dry-run` and
  `cws:review:local-limited-context -- --dry-run`: passed again after the
  advisory-review focus update. The generated ignored prompts now explicitly
  ask reviewers to inspect Page/Web current-page reading, optional all-sites
  access, screenshot-assisted recovery, user confirmation, visible preview,
  vision-gated use, session-only handling, and absence from storage/logs.
- `cws:review:local-limited-context` and the security half of
  `release:review:local-limited-context` now include narrowly scoped runtime
  source/test evidence for Page/Web screenshot handling, General Page all-sites
  permission handling, model payload scoping, and session-only behavior. The CWS
  prompt also includes the latest formal CWS package report when available, or
  the latest explicitly non-uploadable local-smoke package report otherwise.
  This lets advisory review validate release/privacy claims without requiring a
  full repository read or exposing private `tmp/` review artifacts.
- CWS package and local-smoke package reports now include explicit CWS asset
  dimension evidence for the selected 1280x800 screenshots and 440x280 promo
  tile. `cws:preflight` uses the same shared asset evidence, so binary CWS
  assets can stay out of advisory-review prompt context while their required
  dimensions remain reviewable from the text report.
- `cws:package:local-smoke`: passed from clean HEAD `234582f` after CWS asset
  evidence was added to package reports. It wrote an explicitly non-uploadable
  local package report at
  `artifacts/cws-local-smoke/0.1.2-234582f2df0c-2026-07-03T20-05-51-672Z/cws-local-smoke-report.md`,
  audited the generated ZIP, ran `check:public`, ran `cws:preflight`, recorded
  build ID `1783109150798-234582f`, and listed all selected CWS screenshots and
  promo tile as `status=ok` with expected/actual dimensions.
- `audit:general-page-reader`: passed from clean HEAD `234582f`. Expected and
  live build IDs matched `1783109150798-234582f`; QA matrix rows passed for
  popup activation, ordinary article read, model brief generation, 430px
  responsive layout, Page/Web design restraint, interaction accessibility,
  saved-session switching, selection target, current-region shortcut, URL
  identity/stale scrub, noisy fallback caution, candidate block recovery,
  teaser-hub overview, and no-grant guidance. A Bencium-guided visual check of
  `page-analysis-ready.png` confirmed the ready path remains compact,
  low-noise, diagnostic-collapsed, and aligned with the existing Feed side-panel
  style. Private CDP artifact:
  `tmp/general-page-reader-audit-2026-07-03T20-06-29-787Z`.
- `smoke:general-page-current --all-open --min-page-count 4 --max-error-count
  0`: passed from clean HEAD against four currently open HTTP(S) tabs through
  live CDP. Sanitized aggregate: 3 extracted caution pages, 1 blocked/empty
  page, 0 fetch/runtime errors, threshold `pass`, and no pages marked ready;
  public-safe summary:
  `tmp/general-page-product-quality/current-browser-review-2026-07-03T20-03-11-542Z/current-browser-smoke-summary.md`.
- `audit:general-page-reader`: passed from clean HEAD after the supply-chain
  hardening commit. Expected and live build IDs matched
  `1783103572127-f5bb5e8`; QA matrix rows passed for popup activation,
  ordinary read, model brief, 430px responsive layout, design restraint,
  interaction accessibility, saved-session switching, selection,
  current-region, URL stale handling, noisy fallback, candidate recovery,
  teaser-hub overview, and no-grant guidance. Private CDP artifact:
  `tmp/general-page-reader-audit-2026-07-03T18-33-55-219Z`.
- `audit:general-page-reader`: passed again from Preview 12 clean HEAD
  `80a0e9a`. Expected and live build IDs matched
  `1783105722071-80a0e9a`; QA matrix rows passed for popup activation,
  ordinary article read, model brief generation, 430px responsive layout,
  Page/Web design restraint, interaction accessibility, saved-session
  switching, selection target, current-region shortcut, URL identity/stale
  scrub, noisy fallback caution, candidate block recovery, teaser-hub overview,
  and no-grant guidance. Private CDP artifact:
  `tmp/general-page-reader-audit-2026-07-03T19-12-16-973Z`.
- `smoke:general-page-current --all-open --min-page-count 4 --max-error-count
  0`: passed from clean HEAD against four currently open HTTP(S) tabs through
  live CDP. Sanitized aggregate: 3 extracted caution pages, 1 blocked/empty
  page, 0 fetch/runtime errors, threshold `pass`, and no pages marked ready;
  public-safe summary:
  `tmp/general-page-product-quality/current-browser-review-2026-07-03T18-35-20-959Z/current-browser-smoke-summary.md`.
- `smoke:general-page-current --all-open --min-page-count 4 --max-error-count
  0`: passed again from Preview 12 against four currently open HTTP(S) tabs
  through live CDP. Sanitized aggregate: 3 extracted caution pages, 1
  blocked/empty page, 0 fetch/runtime errors, threshold `pass`, and no pages
  marked ready; public-safe summary:
  `tmp/general-page-product-quality/current-browser-review-2026-07-03T19-13-43-648Z/current-browser-smoke-summary.md`.
- `review:general-page-product-quality --source cdp --limit 200`: reran
  against the balanced v2 private target list from Preview 12. Sanitized
  aggregate: 199/200 extracted, 1 empty-or-blocked, 0 fetch errors, readiness
  `ready: 100`, `caution: 98`, `blocked: 2`; private artifact:
  `tmp/general-page-product-quality/review-2026-07-03T19-14-56-810Z`. The
  public-safe follow-up plan reported 12 items: 8 `needs_private_review` and 4
  `covered_by_existing_fixture`. No new synthetic fixture was added because the
  unlabelled run did not prove a repeated public-safe DOM pattern.
- `review:general-page-product-quality`: now uses a quiet jsdom virtual
  console for product-quality HTML parsing so malformed real-site CSS does not
  flood long CDP review output with `Could not parse CSS stylesheet` noise.
  A synthetic bad-CSS smoke under `/private/tmp` verified that the harness still
  prints normal aggregate progress and summary lines without jsdom CSS parser
  noise.

## Non-Blocking Follow-Ups

- Durable Page/Web history remains deferred to a separate privacy and storage review.
- In-page selected-text buttons, context-menu entries, and click-hold current-region gestures remain separate UI and permission decisions.
- Third-party parser runtime adoption remains gated by bundle size, MV3 CSP behavior, execution context, license notices, sanitized rendering, and release-bundle audits.

## Current Conclusion

The branch has moved from exploratory scaffolding to an integrated Page/Web preview candidate. The remaining merge work is reviewer validation and final packaging discipline, not another broad product slice.
