# General Page Reader Live-DOM Quality Findings, 2026-07-03

This is a public-safe summary of a 200-target live-DOM product-quality review
run through the local Chrome CDP harness. The private target list, URLs, review
HTML, screenshots, extracted text, and copied page content remain under `tmp/`
and must not be committed.

## Review Shape

- Review size: 200 public web targets.
- Source mode: live DOM through CDP, not static HTML fetch.
- Successful extraction: 200 targets.
- Fetch/runtime errors: 0 targets.
- Readiness distribution: 115 ready, 82 caution, 3 blocked.
- Extraction status distribution: 115 complete, 83 partial, 2 blocked.
- Extraction method distribution: 159 semantic HTML, 41 fallback.

## Category Findings

- Technical documentation, international news, Taiwan news, and
  government/official pages remained the strongest ordinary reading categories.
  Live DOM removed much of the static-fetch undercount from JavaScript-heavy
  layouts.
- Blog, personal-site, forum, and social-public pages still produce many
  caution states. That is acceptable for v1 when the panel clearly shows
  partial extraction and avoids presenting thread/feed chrome as a clean
  article.
- Paywall, login, bad-page, and blocked-page categories exposed the highest
  false-confidence risk. Some pages render enough semantic `main` or `article`
  text to look complete while the visible product state is actually a
  JavaScript-disabled instruction, access-checking preview, app shell, or
  subscription/login interstitial.
- The most useful next quality work is not broadening parser confidence. It is
  demoting false-ready surfaces before the model brief uses them as ordinary
  article context.

## Regression Patterns Converted To Fixtures

| Pattern | Product Risk | Synthetic Coverage |
| --- | --- | --- |
| JavaScript-disabled semantic main | Browser/app instruction pages can exceed the text threshold and look like complete articles. | `javascript-disabled-instruction` |
| Access-checking article preview | Pages with article metadata and preview paragraphs can pass as ready while full content is gated. | `access-checking-preview` |

## Current Conclusion

The live-DOM harness is now useful as a product-quality loop: it finds runtime
false-confidence patterns that static fetches cannot represent well. The public
repo should keep receiving only aggregate summaries and synthetic regressions;
private target manifests, labels, screenshots, and copied page text should stay
outside git.
