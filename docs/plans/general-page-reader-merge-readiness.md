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
- `audit:general-page-reader` is the runtime acceptance harness for popup activation, ordinary reads, model brief generation, 430px Page/Web responsive overflow, Page/Web design restraint, Page/Web interaction accessibility, session switching, selection, current-region, URL stale handling, noisy fallback, candidate recovery, and no-grant guidance.
- Long-running `audit:general-page-reader` phases are bounded by phase-level timeouts and write `audit-progress.json` plus `audit-phase-log.json`, so a CDP/browser hang fails with a diagnosable artifact instead of blocking reviewer validation indefinitely.
- `audit:general-page-model-integration` is included in `check:general-page` and verifies model payload scoping, overview guards, and session-only storage behavior with a local mock endpoint.
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
- F5 GitHub Actions SHA pinning: not required for Page/Web merge readiness. Treat as repository supply-chain hardening that needs a separate maintenance decision because it changes workflow-update operations and should be paired with Dependabot or an equivalent update path.

## Reviewer Gate Checklist

Before merging this branch back to Truly, rerun these from a clean worktree:

```bash
npm run check:public
npm run cws:preflight
TRULY_EXTENSION_ID=<loaded-extension-id> TRULY_AUDIT_AUTO_RELOAD=1 npm run audit:general-page-reader
```

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
- Live `TRULY_ENABLE_CLAUDE_REVIEW=1 npm run release:review:local-limited-context`: not run in this session because the environment review rejected sending local repository context to an external Claude service without explicit approval.
- `npm run cws:package`: currently stops before packaging because `codex/general-page-reader-contract` has no configured upstream. This is expected until the branch is pushed or an upstream remote branch is configured; no uploadable package artifact was produced by this attempt.
- `npm run cws:package:local-smoke`: available for pre-push ZIP creation, package-boundary audit, and `cws:preflight`. Its artifacts live under `artifacts/cws-local-smoke/`, are explicitly non-uploadable, and do not satisfy the upstream-sync or release-tag upload gates.

## Recent Local Verification Evidence

Representative runs from this worktree on 2026-07-03, after the non-uploadable local-smoke package path was added. Re-run the Reviewer Gate Checklist from the current HEAD before merge or upload:

```bash
npm run check:public
npm run cws:preflight
npm run cws:package:local-smoke
TRULY_EXTENSION_ID=idcjllbajkejmljompodofmmdmlbendl TRULY_AUDIT_AUTO_RELOAD=1 npm run audit:general-page-reader
npm run smoke:general-page-current -- --url-pattern 'tw\.news\.yahoo\.com' --category current-browser-smoke --page-type news-article
npm run smoke:general-page-current -- --all-open --limit 4 --category current-browser-open-tabs --page-type open-tab --timeout-ms 25000 --concurrency 2 --max-ready-count 0
npm run smoke:general-page-current -- --all-open --limit 6 --min-page-count 4 --max-error-count 0 --category current-browser-open-tabs --page-type open-tab --timeout-ms 25000 --concurrency 2
npm run summarize:general-page-quality-findings -- --review tmp/general-page-product-quality/review-.../review.json --labels tmp/general-page-product-quality/review-.../manual-labels.jsonl
npm run plan:general-page-quality-followups -- --summary tmp/general-page-product-quality/review-.../quality-findings-summary.json
npm run cluster:general-page-quality-followups -- --review tmp/general-page-product-quality/review-.../review.json --labels tmp/general-page-product-quality/review-.../manual-labels.jsonl --plan tmp/general-page-product-quality/review-.../quality-followups-plan.json
```

Results:

- `check:public`: passed. This included public-boundary, release metadata, General Page readiness-docs check, General Page corpus, parser spikes, parser-advisor spike, model integration audit, typecheck, public contract tests, public unit tests, production build, and release bundle audit.
- `cws:preflight`: passed for `0.1.1 Preview 11` / `v0.1.1-preview.11`.
- `cws:package:local-smoke`: passed from a clean tree. It wrote an explicitly non-uploadable local package report under `artifacts/cws-local-smoke/`, audited the generated ZIP, ran `cws:preflight`, and recorded `Uploadable: no`.
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

## Non-Blocking Follow-Ups

- Durable Page/Web history remains deferred to a separate privacy and storage review.
- In-page selected-text buttons, context-menu entries, and click-hold current-region gestures remain separate UI and permission decisions.
- Third-party parser runtime adoption remains gated by bundle size, MV3 CSP behavior, execution context, license notices, sanitized rendering, and release-bundle audits.
- GitHub Actions SHA pinning remains a repository-level hardening task, not a General Page Reader runtime blocker.

## Current Conclusion

The branch has moved from exploratory scaffolding to an integrated Page/Web preview candidate. The remaining merge work is reviewer validation and final packaging discipline, not another broad product slice.
