# General Page Reader Corpus V2/V3

This plan keeps the parser evaluation useful without committing real website
HTML, copyrighted article text, private snapshots, screenshots, or account-only
content into the open-source repository.

## Three-Layer Method

### 1. Observation Corpus

The observation corpus is a private research activity, not a committed dataset.
For each target page, record only structural facts:

- page category and URL family;
- content container shape, such as `article`, `main`, nested docs layout, thread,
  or app shell;
- metadata availability, such as canonical URL, OpenGraph, JSON-LD, author, and
  date;
- noise sources, such as navigation, related articles, ads, consent banners,
  login walls, paywalls, comments, and app-install prompts;
- parser risk, such as false-positive body text, missing body text, or social
  thread ambiguity.

Do not commit real page HTML, copied article paragraphs, screenshots, private
notes, or full DOM snapshots. Observation notes should be abstract enough that a
synthetic fixture can be authored from the pattern rather than from the original
source.

Public commits should use
`docs/plans/general-page-reader-pattern-evidence.md` for derived pattern-level
evidence. Do not commit one record per observed target.

### 2. Pattern Catalog

The pattern catalog is the reusable bridge between observations and fixtures.
Each pattern describes one extraction problem that can appear across many sites.
Synthetic fixtures can combine multiple patterns.

| ID | Pattern | Extraction Risk | Current Fixture Coverage |
| --- | --- | --- | --- |
| P01-semantic-article | Clean article with useful `article` markup | Baseline parser behavior may hide metadata regressions | `clean-article`, `news-related-sidebar` |
| P02-main-role-without-article | Official page uses `main` or `role=main` but no article | Heuristics that only trust `article` miss valid content | `government-no-article`, `zh-tw-official-index` |
| P03-navigation-sidebar-noise | Header, nav, sidebar, footer surround content | Parser leaks menu or promo text into main body | `nav-sidebar-noise`, `news-related-sidebar`, `zhtw-news-layout`, `search-results-with-answer-box`, `category-hub-mixed-cards`, `news-homepage-card-grid`, `zh-tw-official-index` |
| P04-related-content-recirc | Related stories and most-viewed modules near article | Parser chooses recirculation over the story | `news-related-sidebar`, `category-hub-mixed-cards`, `news-homepage-card-grid` |
| P05-list-or-index-page | Category page or search results masquerades as content | Parser extracts a feed/list as if it were one article | `category-list-page`, `search-results-index`, `search-results-with-answer-box`, `category-hub-mixed-cards`, `news-homepage-card-grid` |
| P06-nested-documentation-layout | Docs content buried inside nested app layout | Parser chooses side rail or table of contents | `documentation-page`, `docs-nested-layout` |
| P07-api-reference-multipanel | Docs include code panes, SDK status, copy buttons | Parser mixes chrome with explanatory content | `docs-nested-layout` |
| P08-forum-thread | Multiple posts form a discussion | No single author/body; summarization target is ambiguous | `forum-thread`, `dense-forum-thread` |
| P09-q-and-a-page | Question, accepted answer, comments, votes | Parser may ignore the accepted answer or include chrome | `qa-accepted-answer` |
| P10-feed-like-social-page | Public social post with replies and app prompts | Needs post/context separation, not article-only extraction | `public-social-feed`, `multi-post-social-feed`, `empty-social-shell` |
| P11-paywall-or-membership | Page has teaser or paywall copy | Parser treats blocked content as a complete article | `blocked-like`, `newsletter-paywall-hybrid` |
| P12-login-wall | Login prompt replaces content | Parser extracts auth copy as source content | `blocked-like`, `newsletter-paywall-hybrid`, `empty-social-shell` |
| P13-consent-and-overlay | Consent banner appears before content | Parser leaks banner controls | `consent-banner`, `newsletter-paywall-hybrid` |
| P14-client-rendered-empty-shell | Static HTML has app shell or noscript text only | Parser returns a false article from empty shell copy | `js-shell-bad-page`, `js-app-shell-with-json-state`, `empty-social-shell` |
| P15-rich-metadata | Canonical, OpenGraph, JSON-LD, author/date exist | Parser fields may disagree or mutate metadata | `clean-article`, `jsonld-og-metadata` |
| P16-missing-or-conflicting-metadata | Sparse or conflicting metadata | Product must fall back without overclaiming | `government-no-article`, `missing-metadata-blog`, `malformed-mixed-language-page` |
| P17-traditional-chinese-layout | Traditional Chinese typography and site chrome | Text normalization or segmentation damages content | `zh-tw-article`, `zhtw-news-layout`, `zh-tw-official-index`, `malformed-mixed-language-page` |
| P18-media-and-caption | Images, figures, captions, cards | Caption/media text may dominate or disappear | `clean-article`, `public-social-feed`, `multi-post-social-feed`, `news-homepage-card-grid` |
| P19-comments-heavy-page | Comments or replies are meaningful but noisy | Parser must distinguish body from discussion context | `forum-thread`, `dense-forum-thread` |
| P20-canonical-amp-syndication | Canonical/AMP/syndicated variants exist | URL identity and source attribution can drift | `jsonld-og-metadata` |

### 3. Synthetic Fixtures

Synthetic fixtures are the only corpus layer committed to the repository. They
must use fake authors, fake URLs, fake source names, and newly written body text.
The DOM structure should preserve the observed extraction problem, but content
must not be copied from the observed source.

The v2 parser spike reads `tests/fixtures/general-pages/manifest.json`. Each
fixture declares:

- `patterns`: pattern IDs from this catalog;
- `pageType` and `locale`;
- `expected.contains` and `expected.excludes`;
- optional per-fixture `thresholds`.

Thresholds are baseline gates for the pattern each fixture is meant to isolate.
They should fail on the fixture's primary extraction risk, but they should not
turn every fixture into a test for every possible page problem. Secondary issues
remain visible in the JSON report and can become dedicated fixtures later.

Evaluation v3 keeps this public synthetic fixture layer as the committed
regression corpus, and adds a separate private real-world evaluation runner for
local HTML or explicitly approved live fetches. The private runner produces only
sanitized metrics under `tmp/`; it is not a source fixture layer and must not be
committed.

## Observation Target List V1

These 72 targets define the first observation pass. The goal is structural
observation only; do not archive or commit source content.

| Category | Target | Page Family To Observe | Primary Patterns |
| --- | --- | --- | --- |
| International news | BBC News | Standard article and live article pages | P01, P03, P04, P15 |
| International news | Reuters | News story with related links and media | P01, P03, P15 |
| International news | Associated Press | Article pages and topic pages | P01, P04, P15 |
| International news | The Guardian | Article with rich recirculation and comments | P01, P03, P04, P19 |
| International news | Al Jazeera | News article and feature layout | P01, P03, P18 |
| International news | Deutsche Welle | Multilingual article layout | P01, P03, P15 |
| International news | Nikkei Asia | Article with subscription or teaser behavior | P01, P11, P15 |
| International news | South China Morning Post | Article with paywall/related modules | P01, P04, P11 |
| International news | CNN | Article with video and recirculation modules | P01, P03, P04, P18 |
| Taiwan news | Central News Agency | Chinese and English article pages | P01, P15, P17 |
| Taiwan news | Public Television Service | News article with media modules | P01, P17, P18 |
| Taiwan news | Radio Taiwan International | Article and audio transcript pages | P01, P17, P18 |
| Taiwan news | TaiwanPlus | English Taiwan news article pages | P01, P03, P18 |
| Taiwan news | Taipei Times | Article and archive pages | P01, P03, P15 |
| Taiwan news | United Daily News | Article with heavy related modules | P01, P03, P04, P17 |
| Taiwan news | Liberty Times | Article with sidebars and rankings | P01, P03, P04, P17 |
| Taiwan news | TVBS News | Article and video article pages | P01, P03, P18 |
| Taiwan news | ETtoday News | Article with dense related links | P01, P03, P04, P17 |
| Government/official/NGO/company | Taiwan Ministry of Digital Affairs | Official announcement page | P02, P15, P17 |
| Government/official/NGO/company | Taiwan Executive Yuan | Press release and policy page | P02, P03, P17 |
| Government/official/NGO/company | Taiwan CDC | News release and advisory page | P02, P15, P17 |
| Government/official/NGO/company | Taipei City Government | Municipal news page | P02, P03, P17 |
| Government/official/NGO/company | GOV.UK | Guidance and news pages | P02, P06, P15 |
| Government/official/NGO/company | European Commission | Press corner page | P02, P03, P15 |
| Government/official/NGO/company | United Nations News | Article and topic pages | P01, P03, P15 |
| Government/official/NGO/company | Amnesty International | Report/news page | P01, P03, P18 |
| Government/official/NGO/company | Google Blog | Company announcement page | P01, P15, P18 |
| Technical docs/knowledge base | MDN Web Docs | Reference and guide pages | P06, P07, P15 |
| Technical docs/knowledge base | Chrome Developers | Documentation and blog pages | P06, P07, P15 |
| Technical docs/knowledge base | React Docs | Nested docs app layout | P06, P07 |
| Technical docs/knowledge base | Vite Docs | Guide page with side navigation | P06, P07 |
| Technical docs/knowledge base | TypeScript Handbook | Long docs page with navigation | P06, P07 |
| Technical docs/knowledge base | OpenAI Docs | Docs app page and API reference | P06, P07 |
| Technical docs/knowledge base | GitHub Docs | Guide and reference pages | P06, P07, P15 |
| Technical docs/knowledge base | Cloudflare Docs | Product docs and reference pages | P06, P07 |
| Technical docs/knowledge base | Microsoft Learn | Docs article with app chrome | P06, P07, P15 |
| Blog/Substack/Medium/personal | Medium | Public article and member-gated article | P01, P11, P13 |
| Blog/Substack/Medium/personal | Substack | Free post and paid teaser | P01, P11, P15 |
| Blog/Substack/Medium/personal | Ghost-powered publication | Blog post with newsletter chrome | P01, P03, P13 |
| Blog/Substack/Medium/personal | WordPress.com blog | Personal post with archive widgets | P01, P03, P16 |
| Blog/Substack/Medium/personal | Blogger blog | Older personal post template | P01, P03, P16 |
| Blog/Substack/Medium/personal | Simon Willison's Weblog | Long technical personal post | P01, P16 |
| Blog/Substack/Medium/personal | Martin Fowler | Article and bliki page | P01, P16 |
| Blog/Substack/Medium/personal | Julia Evans | Personal technical blog page | P01, P16, P18 |
| Blog/Substack/Medium/personal | Independent static-site blog | Minimal metadata post | P01, P16 |
| Forum/social discussion | Reddit | Public post with comment thread | P08, P19 |
| Forum/social discussion | Hacker News | Story comments page | P08, P19 |
| Forum/social discussion | Stack Overflow | Question and accepted answer | P09, P19 |
| Forum/social discussion | GitHub Discussions | Discussion thread | P08, P19 |
| Forum/social discussion | Discourse Meta | Topic thread | P08, P19 |
| Forum/social discussion | Mastodon public status | Post with replies | P10, P19 |
| Forum/social discussion | Bluesky public post | Post with replies | P10, P19 |
| Forum/social discussion | PTT web | Board article and comments | P08, P17, P19 |
| Forum/social discussion | Dcard | Public discussion page | P08, P17, P19 |
| Feed-like/social public pages | Threads | Public post and profile page | P10, P12, P19 |
| Feed-like/social public pages | Facebook public page | Public post page and page feed | P10, P12, P19 |
| Feed-like/social public pages | Instagram public post | Media-first post page | P10, P12, P18 |
| Feed-like/social public pages | LinkedIn public post | Login-gated public post shell | P10, P12 |
| Feed-like/social public pages | YouTube Community | Community post with comments | P10, P18, P19 |
| Feed-like/social public pages | TikTok public post | Media-first app shell | P10, P12, P14, P18 |
| Feed-like/social public pages | X public post | Public post with login/app prompts | P10, P12, P19 |
| Feed-like/social public pages | Product Hunt | Launch page with comments | P10, P19 |
| Feed-like/social public pages | GitHub Releases | Release feed and release notes | P10, P15 |
| Paywall/login/bad pages | The New York Times | Metered article or login prompt | P11, P12, P13 |
| Paywall/login/bad pages | Wall Street Journal | Subscription article teaser | P11, P12 |
| Paywall/login/bad pages | Financial Times | Paywall and account prompt | P11, P12 |
| Paywall/login/bad pages | Medium member-only post | Member gate and teaser | P11, P12 |
| Paywall/login/bad pages | Substack paid post | Paid teaser and email capture | P11, P13 |
| Paywall/login/bad pages | LinkedIn login wall | Public shell without content | P12, P14 |
| Paywall/login/bad pages | Facebook login wall | Public shell and auth prompt | P12, P14 |
| Paywall/login/bad pages | Generic consent-heavy news site | Consent overlay before article | P13 |
| Paywall/login/bad pages | Client-rendered SPA article | Empty shell or noscript copy | P14 |

## Fixture Roadmap

The current v4 fixture corpus contains 35 public-safe synthetic HTML fixtures.
It covers every pattern in this catalog at least once and stays within the
planned 25-35 fixture range.

The first v2 fixture batch added coverage for:

- news article with heavy related/sidebar modules;
- official announcement without `article`;
- nested technical documentation;
- forum thread;
- consent banner;
- rich metadata;
- missing metadata;
- Traditional Chinese news layout;
- public social/feed-like page;
- client-rendered empty shell;
- list/index pages;
- Q&A pages;
- AMP/canonical conflict pages;
- media-first cards;
- paid teaser pages;
- newsletter capture overlays;
- longer API reference pages.

The v3 fixture batch added focused regression pressure for:

- dense forum threads with several post cards;
- multi-post social pages with quoted context and reply cards;
- search results with an answer box;
- category hubs with mixed article cards;
- client app shells with JSON/template state;
- newsletter/paywall hybrid teaser pages.

The v4 fixture batch added focused regression pressure for:

- news homepage/card grids that look article-like but are list/index pages;
- Traditional Chinese official index pages with `main` containers;
- empty social shells with login/app prompts and JSON state;
- malformed mixed-language pages with uneven markup.

The corpus moved beyond the original 35-fixture upper bound after the first
200-target private product-quality reviews. The checker now allows up to 48
fixtures so high-signal manual-review findings can be converted into public
synthetic regressions without removing still-useful earlier coverage.

The v5 fixture batch added focused regression pressure for:

- blog and personal-site prose containers that lack `article` or `main`
  landmarks but contain a clear body block;
- short semantic articles that are complete enough for model context but should
  remain visually marked as caution;
- dense semantic `main` card collections that should be treated as index/feed
  pages rather than trusted as complete articles;
- article footer links where source context should filter utility navigation,
  sharing, comment, newsletter, and recirculation links.

## Private Real-World Evaluation Runner

Use this dev-only command for private real-world evaluation:

```bash
npm run eval:general-page-real-world -- --input tmp/private-general-page-targets.json
```

By default the runner only reads private local HTML paths under `tmp/` or the
system temp directory. Live fetches require an explicit `--allow-network` flag.
Use `--timeout-ms` to tune live-fetch timeout for a batch:

```bash
npm run eval:general-page-real-world -- \
  --input tmp/private-general-page-targets.json \
  --allow-network \
  --timeout-ms 10000
```

Input targets may include `url`, `htmlPath`, `category`, `pageType`, and private
`expected.contains` / `expected.excludes` snippets. The output is written under
`tmp/general-page-real-world-evals/` and records only sanitized metrics:

- anonymous target id/hash, category, and page type;
- document structure counts;
- per-engine text length, metadata presence, duration, status, and warnings;
- private expected hit/leak counts without copying the snippets;
- suitability pass/fail booleans;
- aggregate failure buckets for target failures, engine failures, and
  runtime-baseline suitability failures.

The output must not contain target URLs, raw HTML, extracted text, text previews,
excerpts, screenshots, DOM snapshots, or copied source content.

Private repo trigger: do not create a separate private repository only to run
one-off batches. Create a data-and-results-only private repository when private
target manifests, manual labels, or longitudinal reports need durable
cross-session history or multi-person collaboration. Keep reusable runner code
in this public repo so public/private tooling does not fork.

## Private Product-Quality Review Runner

The sanitized real-world eval runner is appropriate for aggregate comparison
and future CI, but it is intentionally too redacted for product judgment. Use
the private product-quality review flow when the goal is manual inspection of
whether the General Page Reader feels good enough on real pages.

Discovery starts from a private seed manifest and writes real URLs only under
`tmp/`:

```bash
npm run collect:general-page-review-targets -- \
  --input tmp/general-page-review-seeds.json \
  --allow-network \
  --limit 200 \
  --output tmp/general-page-product-quality/targets-200.json
```

Manual product-quality review then fetches those targets and writes a private
HTML/JSONL packet:

```bash
npm run review:general-page-product-quality -- \
  --input tmp/general-page-product-quality/targets-200.json \
  --allow-network \
  --limit 200 \
  --concurrency 8 \
  --timeout-ms 12000
```

This runner deliberately writes real URLs and extracted text previews because
the reviewer needs to compare product output against the live page. The output
must stay private under `tmp/` or a future private data-and-results repository.
Do not commit the target manifest, review HTML, JSONL labels, screenshots, raw
HTML, copied source text, or derived per-target findings into the public repo.

Use the 200-target first pass to answer product questions:

- Does the extracted preview contain the main readable content?
- Does Page/Web honestly downgrade fallback, partial, blocked, index, and
  social/feed-like pages?
- Do source links look useful for evidence inspection, or are they navigation?
- Which noise families recur often enough to justify new synthetic fixtures?
- Where do `@mozilla/readability`, `defuddle`, or a future hybrid route need a
  focused parser spike before runtime adoption?

### Parser Spike Threshold Gate

`npm run spike:general-page-parsers` evaluates multiple parser candidates, but
only the `runtime-baseline` candidate is a blocking threshold gate for public
checks. `@mozilla/readability`, `defuddle`, and `defuddle-markdown` remain dev
spike comparison candidates until a separate runtime-adoption decision is made.

This matters for fixtures that intentionally expose parser differences. For
example, recirculation-heavy magazine fixtures may pass the Truly heuristic while
a third-party candidate leaks teaser text. The report should keep those misses
visible as non-blocking candidate misses, but `npm run check:general-page` should
fail only when the committed runtime baseline misses the fixture threshold or
when the runtime suitability policy fails.
