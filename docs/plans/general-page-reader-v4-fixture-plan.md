# General Page Reader Fixture V4 Plan

Status: implemented and follow-up verified
Date: 2026-06-30

## Boundary

This document is public-safe. It summarizes aggregate findings from a private
real-world eval batch without listing target URLs, site names, copied text,
screenshots, raw HTML, DOM snapshots, or per-target private notes.

Raw private target manifests and reports stay under `tmp/` unless a future
data-and-results-only private repository is triggered by durable label/report
needs.

## Private Eval Batch 1 Aggregate

Batch shape:

- private targets: 22
- successful evaluated targets: 20
- failed or empty targets: 2
- live fetch mode: enabled with `--allow-network`
- timeout used for diagnostic rerun: `10000` ms

Runtime baseline aggregate:

- `truly-heuristic` ok count: 20
- average text length: 11249
- average extraction time: 62.31 ms
- status distribution: `complete` 9, `partial` 11
- warning distribution: `no-main-content` 7, `very-short-content` 3,
  `large-navigation-noise` 6, `login-or-paywall-like` 5

Failure buckets from the sanitized report:

- target failures:
  - `low-text-or-empty-shell`: 1
  - `all-engines-empty`: 1
- engine failures:
  - every parser candidate produced 2 empty results on the same failed/empty
    targets
- runtime suitability failures:
  - `status:list-index`: 4
  - `warnings:list-index`: 4
  - `badPage:list-index`: 4

## Interpretation

The highest-value v4 fixture pressure is not another clean article. The private
batch points at three public-safe synthetic patterns:

1. Index/list pages with enough readable text to look article-like.
   These caused the strongest suitability gap: `list-index` pages can still be
   marked `complete` when the DOM contains a large `main` or article-like card.
2. Empty or low-text public shells.
   Two targets produced no usable text across all candidates. These should stay
   `empty` or `partial`, not become a false article.
3. Locale/layout coverage gaps.
   The existing roadmap still calls for more Traditional Chinese official pages,
   mixed-language pages, malformed HTML, and social reply chains.

## V4 Fixture Candidates

Keep the committed corpus inside the current 25-35 fixture range unless the
corpus checker is deliberately updated. With 31 committed fixtures, v4 has room
for four new public-safe fixtures before reaching the current upper bound.

Implemented v4 fixtures:

| Fixture ID | Page Type | Primary Patterns | Purpose |
| --- | --- | --- | --- |
| `news-homepage-card-grid` | `list-index` | `P05`, `P03`, `P04`, `P18` | Models a news/index page with one large lead story, many cards, and enough readable text to tempt `complete`. |
| `zh-tw-official-index` | `list-index` | `P02`, `P03`, `P17` | Models a Traditional Chinese official/news index with a `main` container but no single article. |
| `empty-social-shell` | `bad-page` | `P10`, `P12`, `P14` | Models a public social shell with app prompts, low text, and no readable post body. |
| `malformed-mixed-language-page` | `blog` | `P16`, `P17` | Models malformed/nested markup with mixed English and Traditional Chinese content to test text normalization without real copied text. |

Implementation result:

- committed fixture count: 35
- `npm run check:general-page-corpus`: pass
- `npm run spike:general-page-parsers`: threshold pass and suitability pass
- `truly-heuristic`: 35/35 threshold, 35/35 status suitability, 16/16 warning
  suitability, 16/16 bad-page suitability
- private real-world follow-up after structural list/index classifier
  hardening: 20/22 evaluated, 2 target failures where every parser returned
  empty output, and no runtime-baseline suitability failures

## Acceptance Criteria For V4

- All new fixtures are synthetic and use only `example.test` hosts.
- `npm run check:general-page-corpus` still passes.
- `npm run spike:general-page-parsers` passes both text threshold and
  runtime-baseline suitability gates.
- `truly-heuristic` keeps `list-index` and `bad-page` v4 fixtures out of
  `complete` status.
- No private target URL, site label, copied paragraph, screenshot, raw HTML, or
  DOM snapshot is committed.

## Follow-Up

After v4 fixtures pass, rerun a private batch with the same target list and a
short timeout. If failure buckets still show concentrated `list-index`
suitability gaps, harden the classifier before adding more fixtures. If runtime
diagnostics are stable but reruns remain slow enough to discourage iteration,
add a conservative `--concurrency` option as a separate decision.

Follow-up result on 2026-06-30:

- the first v4 private rerun still showed concentrated `list-index` suitability
  gaps;
- the runtime heuristic was hardened with structural dense homepage/card-grid
  detection using only public code and synthetic contract tests;
- the second private rerun cleared all runtime suitability failures;
- remaining target failures are empty/low-text pages where all parser
  candidates returned empty output, so they do not justify adding more public
  fixtures yet.
