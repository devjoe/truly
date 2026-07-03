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
- `audit:general-page-reader` is the runtime acceptance harness for popup activation, ordinary reads, model brief generation, 430px Page/Web responsive overflow, session switching, selection, current-region, URL stale handling, noisy fallback, candidate recovery, and no-grant guidance.
- `audit:general-page-model-integration` is included in `check:general-page` and verifies model payload scoping, overview guards, and session-only storage behavior with a local mock endpoint.
- The live-DOM 200-target review proved the harness is useful for finding false-ready page patterns; public follow-up is represented only as aggregate findings plus synthetic fixtures.

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

## Latest Local Verification

Run on 2026-07-03 from this worktree after the readiness-document update:

```bash
npm run check:public
npm run cws:preflight
TRULY_EXTENSION_ID=idcjllbajkejmljompodofmmdmlbendl TRULY_AUDIT_AUTO_RELOAD=1 npm run audit:general-page-reader
npm run smoke:general-page-current -- --url-pattern 'tw\.news\.yahoo\.com' --category current-browser-smoke --page-type news-article
npm run smoke:general-page-current -- --all-open --limit 4 --category current-browser-open-tabs --page-type open-tab --timeout-ms 25000 --concurrency 2
```

Results:

- `check:public`: passed. This included public-boundary, release metadata, General Page readiness-docs check, General Page corpus, parser spikes, parser-advisor spike, model integration audit, typecheck, public contract tests, public unit tests, production build, and release bundle audit.
- `cws:preflight`: passed for `0.1.1 Preview 11` / `v0.1.1-preview.11`.
- `audit:general-page-reader`: passed after adding the 430px Page/Web responsive overflow gate. Private CDP artifact: `tmp/general-page-reader-audit-2026-07-03T14-21-10-883Z`.
- `smoke:general-page-current`: passed against the currently open Yahoo Taiwan news page through live CDP. Sanitized result: extracted, semantic HTML, partial/caution, model eligible, 6 model-context links after filtering; private artifact: `tmp/general-page-product-quality/current-browser-review-2026-07-03T13-58-47-423Z`.
- `smoke:general-page-current --all-open`: passed against four open HTTP(S) tabs through live CDP after adding P24 dashboard/data-surface coverage. Sanitized result: 3 extracted / 1 blocked-or-empty, readiness `caution: 3`, `blocked: 1`, and no dashboard or leaderboard data surface marked ready/good; private artifact: `tmp/general-page-product-quality/current-browser-review-2026-07-03T14-27-21-492Z`.

## Non-Blocking Follow-Ups

- Durable Page/Web history remains deferred to a separate privacy and storage review.
- In-page selected-text buttons, context-menu entries, and click-hold current-region gestures remain separate UI and permission decisions.
- Third-party parser runtime adoption remains gated by bundle size, MV3 CSP behavior, execution context, license notices, sanitized rendering, and release-bundle audits.
- GitHub Actions SHA pinning remains a repository-level hardening task, not a General Page Reader runtime blocker.

## Current Conclusion

The branch has moved from exploratory scaffolding to an integrated Page/Web preview candidate. The remaining merge work is reviewer validation and final packaging discipline, not another broad product slice.
