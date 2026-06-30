# General Page Reader OSS Research

Status: research draft
Last updated: 2026-06-30

## Purpose

Before implementing the General Page Reader extractor, learn from open-source
reader-mode and article-extraction projects. The goal is not to copy a full
parser immediately. The goal is to identify proven extraction contracts,
heuristics, test patterns, and dependency risks that should shape Truly's first
fixture-first implementation slice.

## Short Recommendation

Start with a small Truly-owned extraction contract and fixture suite, but design
it so `@mozilla/readability` and `defuddle` can be evaluated as the first serious
extraction engine candidates.

Do not start by importing a large parser directly into the extension runtime.
First prove the required output shape, failure states, and side-panel behavior
with synthetic fixtures. Then compare the hand-rolled extractor against
Readability and Defuddle on the same fixtures.

For current-mouse-region actions, do not rely on article extraction alone.
Reader and translation extensions that feel fast use live DOM observation,
selection snapshots, and point-based element targeting. Truly should model this
as a second target type that can share context with the whole-page extractor.

## Projects Reviewed

### Mozilla Readability

Repository: <https://github.com/mozilla/readability>
Package: `@mozilla/readability`
License: Apache-2.0
Checked npm latest: 0.6.0 on 2026-06-28

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
- Preserve Apache-2.0 license and notice requirements in the release artifact
  if the package is adopted.

### Defuddle

Repository: <https://github.com/kepano/defuddle>
Package: `defuddle`
License: MIT
Checked npm latest: 0.19.1 on 2026-06-28

Defuddle extracts article content and metadata from web pages. It is relevant
because Read Frog uses `defuddle/full` as its page-context extraction layer for
LLM prompts, separate from live DOM paragraph targeting.

Important lessons:

- Treat Defuddle as a context and article-extraction candidate, not as a
  substitute for live DOM target detection.
- Evaluate both default extraction and `defuddle/full` if the package exposes
  materially different output or bundle behavior.
- Measure whether the output shape maps cleanly to `ReadingSurface` and whether
  Markdown/context output is useful for model prompts.
- Check bundle size and MV3 CSP behavior before content-script use.
- Treat extracted HTML or Markdown as page-owned input. Render text-first unless
  sanitizer requirements are explicitly handled.

Implementation implications for Truly:

- Add a thin adapter later:
  `DefuddleResult -> ReadingSurface`.
- Compare Defuddle against Readability on the same fixtures before choosing a
  default parser.
- Preserve MIT copyright/license notice requirements in the release artifact if
  the package is adopted.

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

## Interaction Pattern Projects Reviewed

### Read Frog

Repository: <https://github.com/mengxi-ream/read-frog>

Read Frog is an open-source AI language-learning extension. It supports
full-page translation, selected-text translation, current hovered paragraph
translation, context-aware LLM translation, TTS, subtitle translation, and
multiple providers. The inspected revision was
`c62cf6d2694db9f1425edbb2f60860d3c633ca65`.

The most relevant architectural lesson is that it uses two separate extraction
layers:

- live DOM walking for paragraph/node translation;
- Defuddle-based article extraction for compact page context sent to the model.

Important patterns:

- Full-page translation walks the live DOM, labels nodes with data attributes,
  classifies block/inline/paragraph nodes, and processes paragraph-like nodes
  when they enter an `IntersectionObserver` preload region.
- Current-node translation tracks mouse position, resolves the nearest block
  ancestor at the trigger point, and toggles work for that node only.
- Selection actions snapshot ranges and surrounding paragraphs before opening
  the toolbar, so the action remains stable after focus moves.
- Expensive translation work, queues, cache, and context menus are coordinated
  through background messages.
- The page-context helper clones the document and uses `defuddle/full` to
  produce Markdown context, capped before prompt use.

Implications for Truly:

- Separate "whole page context" from "current visible/selected region".
- Use article extraction as supporting context, not as the only way to find the
  paragraph under the mouse.
- Track mouse point and modifier/click-hold state in a small tested state
  machine.
- Resolve the nearest valid reading block from `elementFromPoint`, including
  Shadow DOM where possible.
- Keep the current-region action user-triggered and scoped. Avoid translation-
  style "process everything" fan-out for analysis actions.
- Avoid replacing page content for Truly's trust/reading workflow; source
  fidelity matters more than bilingual replacement.

License note: Read Frog is GPLv3 with a commercial-license path. Treat it as an
architectural reference only unless license review says otherwise.

### Kiss Translator

Repository: <https://github.com/fishjar/kiss-translator>

Kiss Translator is a bilingual translation extension and userscript. It
supports whole-page bilingual translation, selection translation, input-box
translation, mouse-hover paragraph translation, subtitle translation, multiple
providers, rule subscriptions, rich-text preservation, and custom trigger
events. The inspected revision was
`d37c97eb818e916805ecb4ee3876ca24bcdf53b9`.

The most relevant architectural lesson is that it is rule-driven first and
heuristic second. It defines root/block/ignore/keep selector rules, observes the
matched translation nodes, and lazily processes nodes near the viewport.

Important patterns:

- Page scanning merges personal, subscription, and global rules. The global
  defaults target headings, list items, paragraphs, blockquotes, captions,
  labels, and legends.
- Heuristic fallback scans block-like DOM nodes when a rule is not enough.
- `IntersectionObserver` drives lazy translation for visible/near-visible
  nodes, while `MutationObserver` queues dirty containers for rescan.
- Mouse-hover translation is off by default and can require a modifier key.
  "Current paragraph" means the currently hovered observed translation node.
- UI is mostly injected into the page through isolated Shadow DOM surfaces:
  inline translation, floating action button, popup, and selection translator.
- It also exposes a custom window event surface for commands such as page
  translation, popup, selection box, hover-node, and input translation.

Implications for Truly:

- Keep a rule/heuristic split in the General Page Reader. A generic article
  extractor will not be enough for all pages, and social feeds will need
  platform adapters later.
- Represent current-region targets as observed DOM units with stable state, not
  as an ad hoc string from the current mouse event.
- Use lazy viewport processing for automatic refresh. This is more appropriate
  than analyzing the entire page immediately.
- Keep Shadow DOM UI isolation for any in-page mini surface.
- Do not expose Kiss-style low-level rule subscriptions in the primary Truly UX.
  They are powerful but would distract from the reading assistant promise.
- Avoid making ambient hover the primary interaction. It is efficient for
  translation, but Truly analysis should remain explicit because it may trigger
  model calls and produce trust-sensitive output.

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

### 2. Current Region Is A Target, Not A Parser Mode

The one-key paragraph interaction should not mutate the whole-page extractor.
Model it as a smaller `ReadingTarget` that can be derived from selection,
current mouse point, or a known observed DOM node.

Minimum useful fields:

- target id;
- target kind: selection, paragraph, visible-region, or element;
- stable element reference while the page is alive;
- text;
- surrounding text;
- page metadata;
- source rect for optional in-page anchoring;
- extraction warnings.

The current target can then be analyzed in the side panel, shown in a small
in-page popover, or both without changing the detection layer.

### 3. Start Text-First

Reader-mode projects often preserve article HTML for display. Truly does not
need that in the MVP. Rendering third-party article HTML inside the side panel
adds sanitizer, style, and CSP concerns. The first version should render
Truly-generated UI over extracted text and metadata.

### 4. Clone Before Parsing

Any parser that mutates nodes must run on `document.cloneNode(true)`. This is
important even for user-triggered analysis because content scripts share the
page DOM with the site.

### 5. Use A Readerability Gate

Before model calls, run a cheap page-quality check:

- visible main text length;
- paragraph-like text blocks;
- low enough link density;
- not mostly navigation;
- not mostly form/login/paywall text.

If the gate fails, show extraction status and do not spend model calls.

### 6. Keep Site-Specific Overrides Out Of The MVP

Mercury's custom extractor model is useful, but starting there would create a
maintenance treadmill. The MVP should rely on semantic HTML, generic heuristics,
and clear failure states. Site-specific overrides can be added later only for
high-value targets.

### 7. Treat Parser Output As Untrusted

Even if extraction happens from the current tab, the content is still page-owned
input. Do not render parser HTML directly without sanitization. Prefer plain
text and extension-owned markup.

## Side Panel Versus In-Page Output

The current recommendation is a hybrid policy:

- Side panel remains the durable workspace for whole-page analysis, history,
  model status, copy/export, and external-tool handoff.
- In-page UI should be a small, user-triggered anchor for selected/current
  paragraph actions. It can show progress, the chosen target, and a short
  result, then hand off to the side panel for the full analysis.
- Inline replacement should remain out of scope for trust/credibility workflows.
  Translation extensions can replace text because the task is bilingual reading;
  Truly should preserve source fidelity.

This leaves room to decide later whether current-region results render mostly
in the side panel or as an anchored popover without changing extraction.

## Proposed Evaluation Matrix

After Slice 1 exists, evaluate candidate extraction engines against the fixture
suite:

| Candidate | Role | What To Measure |
| --- | --- | --- |
| Truly heuristic extractor | Baseline/fallback | Simplicity, warning quality, fixture stability |
| Mozilla Readability | Parser candidate | Text quality, metadata quality, false positives, bundle cost, Apache-2.0 notice |
| Defuddle | Parser/context candidate | Text quality, metadata quality, Markdown/context quality, bundle cost, MIT notice |
| Postlight Parser concepts | Design reference | Custom extractor pattern, output contract breadth |
| Read Frog patterns | Interaction reference | Current-node targeting, selection snapshots, Defuddle context |
| Kiss Translator patterns | Interaction reference | Observed nodes, lazy viewport processing, rule/heuristic split |

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

## Parser Spike Harness

The first reproducible parser spike is implemented as:

```bash
npm run spike:general-page-parsers
```

It reads the public synthetic fixture manifest in
`tests/fixtures/general-pages/manifest.json`, runs:

- Truly's runtime heuristic extractor as `truly-heuristic`;
- `@mozilla/readability`;
- `defuddle`;
- `defuddle` with Markdown output;

through the dev-only parser-neutral candidate contract in
`scripts/lib/general-page-parser-contract.mjs`, then writes a JSON report with
per-fixture threshold results to:

```text
tmp/parser-spikes/general-page-parser-spike-YYYY-MM-DD.json
```

The report records each candidate's stable id, label, role, package, version,
license, normalized result metadata, threshold status, and candidate-specific
diagnostics. It also records metadata completeness, extraction-status
suitability, warning-family suitability, and bad-page false-positive
suitability for candidates that expose Truly extraction status. The
`truly-heuristic` candidate loads the actual runtime TypeScript extractor
through a dev-only transpile loader; no third-party parser dependency moves into
extension runtime code.

The spike exits non-zero if either the parser text threshold fails or the
runtime-baseline suitability gate fails. Suitability gating is intentionally
limited to `runtime-baseline` candidates because third-party parsers do not own
Truly's extraction status/warning contract.

V3 comparison run on 2026-06-30:

| Candidate | Parsed fixtures | Contains score | Leaks | Metadata | Status suitability | Warning suitability | Bad-page suitability | Average time | Threshold |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `truly-heuristic` | 35/35 | 1.000 | 0 | 0.543 | 35/35 | 16/16 | 16/16 | 1.32 ms | 35/35 |
| `@mozilla/readability` | 35/35 | 1.000 | 0 | 0.357 | 0/0 | 0/0 | 0/0 | 1.62 ms | 35/35 |
| `defuddle` | 35/35 | 1.000 | 0 | 0.543 | 0/0 | 0/0 | 0/0 | 18.36 ms | 35/35 |
| `defuddle` Markdown | 35/35 | 1.000 | 0 | 0.543 | 0/0 | 0/0 | 0/0 | 17.01 ms | 35/35 |

Interpretation:

- Truly's heuristic baseline now passes the same text threshold as the parser
  candidates and is fast enough to remain the runtime fallback. Evaluation v3
  also hardens readable text extraction so script, style, noscript, template,
  and SVG nodes do not become article text.
- The v2 suitability gap for forum threads, social public pages, list/search
  indexes, blocked pages, and client-shell bad pages is now represented as an
  explicit classifier gate. The heuristic keeps useful text but marks those
  surfaces `partial` or `blocked` instead of `complete`.
- Both packages remain viable parser-spike candidates on the expanded synthetic
  fixtures.
- Readability is faster on this fixture corpus and maps directly to article
  fields, but the JSON report should still be inspected for secondary noise
  patterns that are not the primary threshold target for a fixture.
- Defuddle's Markdown mode is worth keeping in the spike because Truly may use
  Markdown/context output for model prompts rather than rendering third-party
  HTML.
- The fixture corpus now has 35 public-safe synthetic fixtures. This is enough
  to keep parser-candidate regression pressure high, but it is still not enough
  to choose a default runtime parser. Private real-world eval reports should
  guide the next synthetic fixture additions before adopting either dependency
  in runtime code.
- Neither candidate removes the need for a separate live DOM `ReadingTarget`
  layer for selected/current-region actions.

The public v2 evidence boundary is documented in
`docs/plans/general-page-reader-pattern-evidence.md`: raw per-target
observations stay private, while the repository commits only pattern-level
evidence, synthetic fixtures, and automated corpus checks.

The post-v2 parser route decision is documented in
`docs/plans/general-page-reader-parser-route.md`: keep Readability and Defuddle
as dev-only benchmark engines, harden the parser-neutral adapter contract first,
and do not move third-party parser code into runtime until a separate
offscreen/bundle/CSP adoption decision passes.

## Changes To The Implementation Plan

Update the first implementation slice:

1. Define `ReadingSurface`.
2. Build fixture corpus.
3. Implement a small heuristic extractor.
4. Add test expectations that are independent of any one parser library.
5. Add a follow-up spike to run `@mozilla/readability` and `defuddle` against
   the same fixtures and compare outputs.
6. Add a later current-region spike for point/selection targeting and surface
   placement.

Do not add `@mozilla/readability` or `defuddle` in the first code commit unless
the team explicitly accepts the dependency and bundle-size tradeoff.

## Sources

- Mozilla Readability README:
  <https://github.com/mozilla/readability/blob/main/README.md>
- Mozilla Readability source:
  <https://raw.githubusercontent.com/mozilla/readability/main/Readability.js>
- Mozilla readerability gate:
  <https://raw.githubusercontent.com/mozilla/readability/main/Readability-readerable.js>
- Mozilla Readability npm metadata:
  `npm view @mozilla/readability version license repository.url`
- Defuddle:
  <https://github.com/kepano/defuddle>
- Defuddle npm metadata:
  `npm view defuddle version license repository.url`
- Postlight Parser:
  <https://github.com/postlight/parser>
- Omnivore:
  <https://github.com/omnivore-app/omnivore>
- Read Frog:
  <https://github.com/mengxi-ream/read-frog>
- Read Frog node trigger:
  <https://github.com/mengxi-ream/read-frog/blob/c62cf6d2694db9f1425edbb2f60860d3c633ca65/src/entrypoints/host.content/translation-control/node-translation-trigger.ts>
- Read Frog page context:
  <https://github.com/mengxi-ream/read-frog/blob/c62cf6d2694db9f1425edbb2f60860d3c633ca65/src/utils/host/translate/webpage-context.ts>
- Kiss Translator:
  <https://github.com/fishjar/kiss-translator>
- Kiss Translator settings:
  <https://github.com/fishjar/kiss-translator/blob/d37c97eb818e916805ecb4ee3876ca24bcdf53b9/src/config/setting.js>
