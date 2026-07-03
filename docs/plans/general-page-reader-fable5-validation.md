# General Page Reader Fable 5 Validation Handoff

Status: validation run completed 2026-07-02 (see Validation Run Record)

This checklist is for an external product/design review after the Page/Web
parser advisor and model-brief path are implemented.

## What To Validate

- A clean article page should show a readable extracted preview, source links,
  `Reading context`, and an auto-generated page brief when Tier B is configured.
- A noisy fallback page should show caution, run the parser advisor, and either
  produce `page_overview_only` or ask for a user target instead of pretending it
  found a clean article.
- A short but semantic article should remain eligible for model context, but be
  visibly marked as caution.
- A selected paragraph should analyze the selected text, not the whole page.
- Candidate-block recovery should replace weak fallback text with the full
  selected block before the model brief is sent.
- The panel should expose enough context for early users to judge quality
  without feeling like a developer console.

## Suggested Review Flow

1. Run `npm run check:public` to verify the committed public gates.
2. Run the CDP audit against the loaded unpacked extension. The audit now
   verifies popup activation, model brief generation, saved-session switching,
   selection, current-region, no-grant guidance, candidate recovery, and the
   430px Page/Web responsive layout gate:

   ```bash
   TRULY_EXTENSION_ID=... TRULY_AUDIT_AUTO_RELOAD=1 npm run audit:general-page-reader
   ```

3. Smoke currently open real browser tabs through live CDP before sending the
   branch to a reviewer. This catches dashboard, leaderboard, and app/list
   false-ready patterns that synthetic pages may miss:

   Canonical command: `npm run smoke:general-page-current -- --all-open`.
   When the open-tab set is intentionally composed of caution/block pages such
   as dashboards, search pages, and leaderboards, add `--max-ready-count 0` so
   false-ready regressions fail the smoke instead of relying on manual summary
   inspection.

   ```bash
   npm run smoke:general-page-current -- \
     --all-open \
     --limit 4 \
     --category current-browser-open-tabs \
     --page-type open-tab \
     --timeout-ms 25000 \
     --concurrency 2 \
     --max-ready-count 0
   ```

   The smoke command writes `current-browser-smoke-summary.md` and
   `current-browser-smoke-summary.json` inside the ignored review output
   directory. Use those summaries for reviewer handoff because they preserve
   host-level readiness and issue-tag evidence without exposing real URLs,
   titles, extracted text, screenshots, or copied page content.

4. Run a private 200-target review and label it in `review.html`. Prefer the
   live-DOM mode when Chrome CDP has the target pages available:

   ```bash
   npm run review:general-page-product-quality -- \
     --input tmp/general-page-product-quality/targets-200.json \
     --allow-network \
     --source cdp \
     --cdp-port 9222 \
     --limit 200
   ```

5. Export `manual-labels.jsonl`.
6. Run:

   ```bash
   npm run score:general-page-product-quality -- \
     --review tmp/general-page-product-quality/review-.../review.json \
     --labels tmp/general-page-product-quality/review-.../manual-labels.jsonl \
     --output tmp/general-page-product-quality/review-.../quality-gate.json
   ```

7. Inspect failures by category and issue tag, then decide whether they become
   new synthetic fixtures, parser heuristic changes, or model-advisor prompt
   changes.

## Privacy Boundary

Do not attach or commit real URLs, screenshots, review HTML, JSONL labels,
source HTML, copied page text, or per-target findings to the public repo. Public
follow-up should be aggregate-only or converted into synthetic fixtures.

## Validation Run Record (2026-07-02, Claude Fable 5)

Reviewer: Claude Fable 5, acting as external product reviewer at the
maintainer's request. Private artifacts (labels, gate JSON) live under the
private review run directory in `tmp/general-page-product-quality/` and must
not be committed. Everything below is sanitized aggregate.

### Gate Result: PASS

- 200 targets; 193 reviewed (96.5%), 7 left unreviewed because the harness
  fetch was rate-limited (HTTP 429) — a harness condition, not a product
  extraction result.
- Acceptable rate 100% of reviewed; bad rate 0%.
- Final verdicts: 130 good, 56 usable_with_caution, 7 blocked_or_empty_ok.
- Reviewer was stricter than the auto-suggestion on 15 targets (auto-good
  downgraded to usable_with_caution) and resolved all 6 blocked-review
  targets plus 1 auto-caution target as blocked_or_empty_ok.

### Review Method

- All 200 target records were read at extraction-preview level (title,
  diagnostics, main-text preview, readiness).
- Suspicious clusters were expanded to full previews and URLs.
- CDP browser spot checks confirmed: a JS-rendered government homepage
  (static fetch yields title-only; live DOM renders ~1.6k chars of index
  text), a publisher special-topic teaser hub that is genuinely thin in the
  live browser, and a wire-service article whose live body matches the
  harness extraction.

### Findings Worth Acting On (aggregate only)

1. **Leading ticker noise (8 targets, one TW news portal family).** Article
   extraction leads with the site's breaking-news ticker and audio-player
   boilerplate before the real body. The body is present, so results stay
   usable, but the noise would contaminate model briefs. Candidate fix:
   strip repeated leading link-dense/timestamp-dense blocks; convert to a
   synthetic fixture.
2. **Index-like pages rated `ready` (3 targets, one intergovernmental
   site).** List/landing pages passed as clean ready articles with nav
   vocabulary in the text. `likely-index-or-feed` heuristics could weigh
   menu-word density near the text head.
3. **Member-gated teasers rated good (3 targets).** Very short bodies that
   end at a member wall were auto-suggested good. A "very short body +
   member-zone markers" demotion to caution would be more honest.
4. **Harness vs live-DOM divergence.** The review harness fetches static
   HTML, but the extension reads the live DOM. JS-heavy sites therefore look
   worse in the harness than in the product. Aggregate-level implication:
   blocked/empty counts here are an upper bound. A future live-DOM review
   mode (CDP-driven) would remove this bias.

None of these block the gate; items 1-3 are candidates for synthetic
fixtures and heuristic follow-ups.

### Follow-Up Implementation (2026-07-02, Claude Fable 5)

Findings 1-3 are implemented on this branch as corpus patterns P21-P23 with
matching synthetic fixtures and heuristics:

- **P21 `ticker-lead-article`**: `NOISY_BLOCK_TEXT_PATTERNS` now strips short
  leading blocks that start with a breaking-news marker and carry two or more
  clock stamps, plus HTML5-audio player shells. The fixture asserts the body
  survives and the ticker/player text never enters `mainText`.
- **P22 `dated-list-hub-ready-trap`**: `nonArticlePageWarnings` adds a
  dated-report-list rule — five or more date stamps in the text head plus six
  or more list items and links, few paragraphs, no article metadata, and a
  non-`article` root now yield `large-navigation-noise` (status `partial`).
- **P23 `member-teaser-short`**: `looksBlockedOrPaywalled` adds a member-zone
  teaser rule — bodies under 620 chars with explicit member-zone markers
  (會員專區, members-only, etc.) are flagged `login-or-paywall-like`
  (status `partial`).

Verified in a clean Linux environment (fresh `npm ci`): typecheck, corpus
check, both parser spikes (runtime-baseline threshold 47/47), full public
contract suite (80 tests), full public unit suite (93 tests), production
build, and the release-bundle audit all pass. `check:public-boundary`
(requires git) and the CDP extension audit (requires the loaded extension)
still need a run on the maintainer's machine before commit.

Finding 4 is now implemented as a tooling follow-up: the product-quality
review harness accepts `--source cdp [--cdp-port 9222]`, rendering each
target in the existing Chrome CDP session and scoring the post-JS DOM through
the same extractor pipeline. Live-DOM runs default to concurrency 2 and
record `input.sourceMode` in the private report so static and live runs are
never conflated.

### Validation Refresh (2026-07-03)

Follow-up live-tab and runtime validation added two reviewer-facing gates:

- **P24 `semantic-main-dashboard-table` / `semantic-main-short-leaderboard`**:
  live CDP smoke against open browser tabs exposed dashboard and leaderboard
  data surfaces that used semantic `main` but were not complete articles. They
  are now represented as public synthetic fixtures and downgraded to
  caution/partial through the runtime baseline.
- **430px Page/Web responsive audit**: `audit:general-page-reader` now captures
  a narrow side-panel screenshot and fails when the Page/Web pane has
  horizontal overflow, clipped interactive controls, or cards outside the
  viewport.
- **Page/Web design restraint audit**: `audit:general-page-reader` now reports
  a QA Matrix row for low-distraction UI behavior: ordinary ready pages keep
  diagnostics collapsed and model context compact, source links stay capped,
  caution pages expand diagnostics, and the 430px layout stays clean.

The latest sanitized live-tab smoke showed 3 extracted caution pages and 1
blocked/empty page across four open HTTP(S) tabs, with no dashboard or
leaderboard data surface marked ready/good.
