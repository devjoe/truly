# General Page Reader OSS Research

Status: research draft
Last updated: 2026-06-28

## Purpose

Before implementing the General Page Reader extractor, learn from open-source
reader-mode and article-extraction projects. The goal is not to copy a full
parser immediately. The goal is to identify proven extraction contracts,
heuristics, test patterns, and dependency risks that should shape Truly's first
fixture-first implementation slice.

## Short Recommendation

Start with a small Truly-owned extraction contract and fixture suite, but design
it so `@mozilla/readability` can be evaluated as the first serious extraction
engine.

Do not start by importing a large parser directly into the extension runtime.
First prove the required output shape, failure states, and side-panel behavior
with synthetic fixtures. Then compare the hand-rolled extractor against
Readability on the same fixtures.

## Projects Reviewed

### Mozilla Readability

Repository: <https://github.com/mozilla/readability>

Readability is the strongest baseline for Truly because it is the standalone
library used by Firefox Reader View and is available as `@mozilla/readability`.
Its API accepts a DOM document and returns article fields that map closely to
Truly's proposed `ReadingSurface`: title, content, textContent, length, excerpt,
byline, siteName, language direction, language, and published time.

Important lessons:

- Parse a cloned document. Readability mutates the DOM during parsing, so Truly
  should never run a destructive parser against the live page document.
- Gate expensive parsing. `isProbablyReaderable()` exists because full parsing
  can be too expensive for time-sensitive page load paths.
- Keep extraction confidence explicit. Readability uses `charThreshold`,
  `minContentLength`, `minScore`, link density, class/id weights, and visibility
  checks; Truly should expose warnings/status instead of treating every page as
  successfully extracted.
- Treat output HTML as untrusted. Readability explicitly recommends sanitizing
  output before rendering it. Truly should prefer text-first display and only
  render sanitized excerpts or internally generated UI.
- Use metadata. Readability extracts JSON-LD and page metadata before removing
  scripts, which is useful for title, author, site, and published time.

Implementation implications for Truly:

- Define `ReadingSurface` independently of Readability's return type.
- Add a thin adapter later:
  `ReadabilityArticle -> ReadingSurface`.
- Keep a no-dependency heuristic extractor for fallback and for tests that
  verify Truly's own warning/status behavior.
- If the package is added, audit bundle size and MV3 CSP behavior before using
  it in the content script.

### Postlight Parser / Mercury Parser

Repository: <https://github.com/postlight/parser>

Postlight Parser extracts article content, title, author, publish date, excerpt,
lead image, domain, word count, direction, page count, and more. It also supports
custom parsers using JavaScript and CSS selectors, pre-fetched HTML, output as
HTML/Markdown/text, and runtime extractor extension.

Important lessons:

- Generic extraction will not cover every important site. A custom-extractor
  escape hatch is valuable.
- The output contract includes operational fields beyond text, such as word
  count, domain, total pages, and rendered pages. Truly should keep room for
  extraction diagnostics even if the MVP does not display them all.
- Browser use is possible, but this project is more server/URL-parser shaped
  than Truly's current active-tab MV3 flow.
- The project shows the value of a fixture corpus and site-specific parser
  examples.

Implementation implications for Truly:

- Do not build site-specific parsers for the MVP, but reserve an adapter slot:
  `GeneralExtractorRule`.
- Keep extractor behavior deterministic and testable with static HTML fixtures.
- Do not add network fetching to the parser path. Truly should extract from the
  user-visible current tab, not refetch URLs in the background.

### Omnivore

Repository: <https://github.com/omnivore-app/omnivore>

Omnivore is an open-source read-it-later product that includes a vendored
Readability package and parser utilities. The relevant lesson is architectural:
reading products commonly wrap Readability rather than relying only on ad hoc
DOM selectors.

Implementation implications for Truly:

- Readability should be treated as the default library candidate, not as an
  exotic dependency.
- Truly still needs its own `ReadingSurface` boundary because the product is not
  a reader-mode renderer; it is a reading-assistance and handoff tool.

## Design Principles For Truly

### 1. Extraction Is A Contract, Not A UI Detail

The extractor should return a structured object with status and warnings. It
should not return only a string.

Minimum useful fields:

- URL and canonical URL;
- title;
- site/domain;
- author when detectable;
- published time when detectable;
- main text;
- excerpt;
- selected text;
- links and image alt/caption context;
- extraction method;
- extraction status;
- warnings.

### 2. Start Text-First

Reader-mode projects often preserve article HTML for display. Truly does not
need that in the MVP. Rendering third-party article HTML inside the side panel
adds sanitizer, style, and CSP concerns. The first version should render
Truly-generated UI over extracted text and metadata.

### 3. Clone Before Parsing

Any parser that mutates nodes must run on `document.cloneNode(true)`. This is
important even for user-triggered analysis because content scripts share the
page DOM with the site.

### 4. Use A Readerability Gate

Before model calls, run a cheap page-quality check:

- visible main text length;
- paragraph-like text blocks;
- low enough link density;
- not mostly navigation;
- not mostly form/login/paywall text.

If the gate fails, show extraction status and do not spend model calls.

### 5. Keep Site-Specific Overrides Out Of The MVP

Mercury's custom extractor model is useful, but starting there would create a
maintenance treadmill. The MVP should rely on semantic HTML, generic heuristics,
and clear failure states. Site-specific overrides can be added later only for
high-value targets.

### 6. Treat Parser Output As Untrusted

Even if extraction happens from the current tab, the content is still page-owned
input. Do not render parser HTML directly without sanitization. Prefer plain
text and extension-owned markup.

## Proposed Evaluation Matrix

After Slice 1 exists, evaluate candidate extraction engines against the fixture
suite:

| Candidate | Role | What To Measure |
| --- | --- | --- |
| Truly heuristic extractor | Baseline/fallback | Simplicity, warning quality, fixture stability |
| Mozilla Readability | Main candidate | Text quality, metadata quality, false positives, bundle cost |
| Postlight Parser concepts | Design reference | Custom extractor pattern, output contract breadth |

Metrics:

- title detected;
- canonical URL detected;
- author/date detected where present;
- main text precision against fixture expected text;
- nav/footer/sidebar exclusion;
- useful warning status on bad pages;
- extraction time on large fixture;
- bundled size impact;
- CSP/MV3 compatibility.

## Changes To The Implementation Plan

Update the first implementation slice:

1. Define `ReadingSurface`.
2. Build fixture corpus.
3. Implement a small heuristic extractor.
4. Add test expectations that are independent of any one parser library.
5. Add a follow-up spike to run `@mozilla/readability` against the same
   fixtures and compare outputs.

Do not add `@mozilla/readability` in the first code commit unless the team
explicitly accepts the dependency and bundle-size tradeoff.

## Sources

- Mozilla Readability README:
  <https://github.com/mozilla/readability/blob/main/README.md>
- Mozilla Readability source:
  <https://raw.githubusercontent.com/mozilla/readability/main/Readability.js>
- Mozilla readerability gate:
  <https://raw.githubusercontent.com/mozilla/readability/main/Readability-readerable.js>
- Postlight Parser:
  <https://github.com/postlight/parser>
- Omnivore:
  <https://github.com/omnivore-app/omnivore>
