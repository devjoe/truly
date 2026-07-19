# General Page Reader Quality Findings, 2026-07-02

This is a public-safe summary of the first broad product-quality review after
the Slice 4 model-brief runtime landed. The underlying target list, URLs,
review HTML, manual labels, screenshots, extracted text, and copied page
content remain private under `tmp/` and must not be committed.

## Review Shape

- Review size: 200 public web targets.
- Successful extraction: 193 targets.
- Fetch errors: 7 targets, mostly forum or Q&A pages with rate limits or
  unavailable pages.
- Readiness distribution: 146 ready, 41 caution, 6 blocked, 7 error.
- Extraction status distribution: 146 complete, 47 partial, 7 error.
- Extraction method distribution: 165 semantic HTML, 28 fallback, 7 error.

## Category Findings

- International news, technical documentation, and government/official pages
  were the strongest categories. Existing semantic markup and long coherent
  bodies usually gave the runtime baseline enough signal.
- Taiwan news improved materially after the browser-download noise and
  advertising-root regressions were fixed, but homepage/list pages still need
  explicit index/feed downgrade pressure.
- Blog, newsletter, Medium-like, and personal sites were the weakest ordinary
  content category. They often contain readable article bodies, but the body
  lives in generic `content`, `prose`, `post`, or `entry` containers, so fallback
  extraction should remain conservative while scoring body-like blocks better.
- Forum, social, and paywall/login pages mostly behaved as caution, blocked, or
  error. That is acceptable for v1 as long as the UI is honest about ambiguity
  and does not present auth, app-shell, or thread chrome as a clean article.

## Regression Patterns Converted To V5 Fixtures

| Pattern | Product Risk | Synthetic Coverage |
| --- | --- | --- |
| Blog prose without article landmarks | Good essays can be extracted only through fallback and may be over-demoted. | `blog-prose-with-nav-shell` |
| Short semantic article | Concise briefs can fall below the default model threshold despite good markup and metadata. | `short-semantic-news-brief` |
| Semantic main card collection | A dense `main` landmark can be a homepage, topic hub, or feed-like index rather than a single article. | `semantic-main-card-index-dense` |
| Source-link utility noise | Model context can include share, comments, newsletter, latest, recommended, or most-read links if filtering is too narrow. | `article-source-link-noise` |

## Current Conclusion

The heuristic baseline is better than expected for ordinary articles because
many real pages expose stable semantic roots, metadata, or body-like containers.
The next gains should come from reducing false confidence, not from pretending
every page is article-shaped. Keep third-party parsers and model/screenshot
escalation as development spikes until the runtime contract clearly decides
when to escalate beyond deterministic extraction.
