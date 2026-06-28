# General Page Reader Pattern Evidence Matrix

This matrix is the public-safe bridge from private Observation Corpus work to
the committed synthetic fixtures. It intentionally avoids one record per real
website or page URL. Per-target observation notes remain private working
material; public commits keep only derived pattern evidence and synthetic test
artifacts.

## Decision

The public repository should not commit per-target Observation Corpus records.
Do not commit one record per observed target.
The decision was pressure-tested with `$grill-your-sub-agents` on 2026-06-29.
The accepted route is:

- keep raw per-target observations private;
- commit target categories and pattern-level findings;
- commit synthetic fixtures only;
- require automated checks that committed fixtures are synthetic and use
  example-only hosts.

Decision report:

```text
tmp/grill-reports/general-page-observation-corpus-2026-06-29.html
```

## Public Evidence Rules

Allowed in this file:

- pattern IDs and pattern-level risk summaries;
- observation target categories and page-family descriptions;
- aggregate confidence, such as `seeded`, `observed-category`, or
  `needs-more-observation`;
- synthetic fixture IDs that model the pattern.

Not allowed in this file:

- real page HTML or DOM snapshots;
- copied article text, headlines, comments, or captions;
- screenshots;
- account-only or private content;
- one record per observed URL;
- claims that a named real page behaved a certain way unless backed by a
  public, stable, high-level source and phrased without copied content.

## Evidence Status

| Status | Meaning |
| --- | --- |
| `seeded` | Modeled by synthetic fixtures and target-category planning, but not yet backed by completed private observations. |
| `observed-category` | Backed by private structural observation across at least two target categories. Public notes stay aggregate-only. |
| `needs-more-observation` | Fixture exists or target category exists, but the pattern needs more private observation before parser selection. |

## Pattern Matrix

| Pattern | Public Evidence Status | Target Categories To Observe | Synthetic Fixture Coverage | Next Evidence Need |
| --- | --- | --- | --- | --- |
| P01-semantic-article | observed-category | International news, Taiwan news, blog/personal, company announcements | `clean-article`, `news-related-sidebar`, `consent-banner`, `jsonld-og-metadata`, `media-first-card` | Confirm parser behavior on individual article URLs, not only category/home pages. |
| P02-main-role-without-article | observed-category | Government/official, NGO, municipal pages | `government-no-article` | Add more official-page article-detail observations before runtime selection. |
| P03-navigation-sidebar-noise | observed-category | News, blogs, docs, list/index pages | `nav-sidebar-noise`, `news-related-sidebar`, `zhtw-news-layout`, `category-list-page`, `search-results-index`, `newsletter-capture-blog` | Compare parser leakage against the synthetic noise fixtures. |
| P04-related-content-recirc | observed-category | News, media, blog, topic pages | `nav-sidebar-noise`, `news-related-sidebar` | Add a dedicated synthetic recirculation-heavy fixture if parser leakage appears. |
| P05-list-or-index-page | observed-category | Search results, topic pages, release feeds, category archives | `category-list-page`, `search-results-index` | Decide product warning for index/list pages. |
| P06-nested-documentation-layout | needs-more-observation | Technical docs, knowledge bases, official guidance | `documentation-page`, `docs-nested-layout`, `api-reference-long` | Observed only in the docs category; compare more docs detail pages. |
| P07-api-reference-multipanel | needs-more-observation | API docs, SDK docs, developer portals | `docs-nested-layout`, `api-reference-long` | Observed only in the docs category; inspect API reference detail pages. |
| P08-forum-thread | observed-category | Discourse, Reddit-like threads, local forums | `forum-thread` | Add thread-detail observations rather than category/front pages. |
| P09-q-and-a-page | needs-more-observation | Stack Overflow-like Q&A, help communities | `qa-accepted-answer` | Observed only in the forum/social category; inspect accepted-answer detail pages. |
| P10-feed-like-social-page | needs-more-observation | Threads, public social posts, release feeds, product pages | `public-social-feed` | Observed only in feed-like/social targets; inspect post detail pages. |
| P11-paywall-or-membership | observed-category | Paywalled news, member posts, subscription blogs | `blocked-like`, `paid-teaser-long` | Separate paywall, login wall, and generic subscription CTA in the next pass. |
| P12-login-wall | needs-more-observation | Social public pages, paywalled pages, login-required apps | `blocked-like`, `paid-teaser-long` | Full pass found login/paywall-like risk but did not separate login wall from paywall. |
| P13-consent-and-overlay | needs-more-observation | News, blogs, newsletter sites, consent-heavy pages | `consent-banner`, `newsletter-capture-blog` | Low observation count; run consent-heavy targets directly. |
| P14-client-rendered-empty-shell | needs-more-observation | SPA article shells, social apps, video-first apps | `js-shell-bad-page` | Full pass did not produce enough script-heavy low-text shell evidence. |
| P15-rich-metadata | observed-category | News, company blogs, syndicated articles, docs | `clean-article`, `jsonld-og-metadata`, `canonical-conflict-page`, `amp-syndicated-copy` | Compare canonical/OpenGraph/JSON-LD disagreement. |
| P16-missing-or-conflicting-metadata | observed-category | Personal blogs, official pages, older templates | `government-no-article`, `missing-metadata-blog` | Add more sparse-metadata private observations. |
| P17-traditional-chinese-layout | observed-category | Taiwan news, official pages, forums | `zh-tw-article`, `zhtw-news-layout` | Add mixed-language and official zh-TW patterns. |
| P18-media-and-caption | observed-category | News with media, social posts, media-first cards | `clean-article`, `public-social-feed`, `media-first-card` | Decide how captions contribute to source context. |
| P19-comments-heavy-page | needs-more-observation | Forums, Q&A, social replies, comment-heavy news | `forum-thread`, `qa-accepted-answer` | Observed only in forum/social category; inspect comment-heavy article pages. |
| P20-canonical-amp-syndication | needs-more-observation | Syndicated news, AMP copies, canonical variants | `jsonld-og-metadata`, `canonical-conflict-page`, `amp-syndicated-copy` | Full pass did not produce canonical/AMP variant evidence. |

## Evaluation V2 Exit Criteria

Evaluation v2 is complete enough for parser-candidate comparison when:

- the target list contains 60-80 public observation targets;
- the pattern catalog has 15-25 patterns;
- the synthetic fixture corpus contains 25-35 public-safe fixtures;
- every pattern has at least one synthetic fixture;
- every fixture is explicitly `synthetic: true`;
- every committed fixture URL and embedded URL uses `example.test` or a
  subdomain;
- parser spike threshold passes across all committed fixtures;
- no third-party parser is connected to extension runtime code.

Evaluation v2 is not enough to choose a runtime parser until private
observations move the key patterns from `seeded` to `observed-category`.

## Private Observation Runner

Use this dev-only command to produce private structural summaries:

```bash
npm run observe:general-page-structure -- --input tmp/general-page-observation-targets.json
```

The report is written under `tmp/general-page-observations/` and must not be
committed. It records element counts, metadata presence, noise ratios, risk
labels, and pattern hints. It does not write HTML, text excerpts, screenshots,
or DOM snapshots.

Convert a private report into a public-safe aggregate with:

```bash
npm run summarize:general-page-observations -- \
  tmp/general-page-observations/structure-observations-YYYY-MM-DD.json \
  tmp/general-page-observations/aggregate-YYYY-MM-DD.json
```

Only the aggregate conclusions should be folded back into this document. The
aggregate omits target URLs, labels, HTML, text excerpts, screenshots, and DOM
snapshots.

### Full Private Pass, 2026-06-29

A private 72-target pass completed with 63 successful fetches and 9 fetch
errors. The sanitized aggregate contained no per-target URLs, labels, HTML,
text excerpts, screenshots, or DOM snapshots.

Aggregate pattern evidence:

- `observed-category`: `P01`, `P02`, `P03`, `P04`, `P05`, `P08`, `P11`,
  `P15`, `P16`, `P17`, `P18`;
- `needs-more-observation`: `P06`, `P07`, `P09`, `P10`, `P13`, `P19`;
- not observed by this runner pass: `P12`, `P14`, `P20`.

The pass is broad enough for Evaluation v2 parser-candidate comparison. It is
not enough to choose a runtime parser, because several specialized patterns
still need targeted detail-page observations.

### Runner Smoke, 2026-06-29

A private 8-target smoke run completed with 7 successful fetches and 1 fetch
error. The aggregate structural hints covered:

- `P01-semantic-article`: 1;
- `P02-main-role-without-article`: 3;
- `P03-navigation-sidebar-noise`: 2;
- `P04-related-content-recirc`: 1;
- `P11-paywall-or-membership`: 2;
- `P15-rich-metadata`: 5;
- `P16-missing-or-conflicting-metadata`: 2;
- `P17-traditional-chinese-layout`: 2;
- `P18-media-and-caption`: 4.

The smoke run proves the private runner path works, but it does not move any
pattern from `seeded` to `observed-category`. That upgrade requires the broader
60-80 target private observation pass.
