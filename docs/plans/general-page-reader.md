# General Page Reader Plan

Status: implementation in progress; Slices 1-4, 6a selection, 6b
current-region targeting, screenshot confirmation, live-DOM review mode, and
session-only multi-page switching are implemented on this branch. The
200-target product-quality gate passed its first external validation run (see
`general-page-reader-fable5-validation.md`), and a follow-up 200-target
live-DOM review has been summarized in
`general-page-reader-quality-findings-2026-07-03-live-dom.md`. Merge-readiness evidence is indexed in
`general-page-reader-merge-readiness.md`.
Last updated: 2026-07-03

## Decision

Build the General Page Reader before adding another social-feed platform such
as Threads.

The first version should be a side-panel-first reading mode for normal web
pages. It should not try to inject heads-up UI into every page. A user opens
Truly on the current tab, Truly extracts the main readable page content, and
the existing analysis pipeline produces a summary, reading brief, follow-up
questions, and manual handoff actions.

Future current-region actions should be planned now but implemented after the
whole-page contract is stable. The target experience is similar to immersive
translation shortcuts: a user can press a key while the mouse is over a
paragraph and ask Truly to analyze, summarize, explain, or hand off that
specific region. The output surface can remain a product experiment, but the
targeting contract should be designed up front.

Selection and current-region analysis must remain explicitly triggered. Selected
text should not automatically become the model input just because the user has a
selection on the page. A future version may show a small Truly action affordance
near the selection, but the user must still choose to analyze it.

This keeps the project loyal to the existing product promise: signals first,
context when needed, and handoff only by choice. It also advances the public
README promise of social feeds and web pages without taking on the live-DOM
volatility of a second feed platform too early.

## Why This Comes Before Threads

General web-page support has a better product-to-risk ratio than Threads.

- It broadens Truly beyond Facebook while staying inside the current reading
  assistant mission.
- It can start from a user gesture and `activeTab`, avoiding new broad host
  permissions for the MVP.
- It mostly reuses the current side panel, model readiness, Tier B, zhtw, and
  handoff surfaces.
- It forces the right abstraction first: reading surfaces, not platform clones.
- It creates reusable extraction and context contracts that will make Threads
  easier later.

Threads should still remain a future platform adapter, but it should consume the
same reading-surface contracts created here instead of driving those contracts.

## Product Scope

### MVP

The MVP handles one current browser tab after an explicit user action.

Supported first:

- article pages;
- blog posts;
- news pages;
- documentation pages;
- simple static content pages;
- pages where the main readable content is present in the DOM.

The side panel should show:

- page title;
- source domain;
- canonical/current URL;
- extraction status;
- concise summary;
- reading brief;
- claims or questions to check when useful;
- manual external-tool actions;
- Markdown copy/download.

Implemented on this branch:

- selected-text analysis action from the side panel;
- one-key trigger for the paragraph or element under the mouse after an
  existing Page/Web session is available;
- optional screenshot confirmation for user-targeted recovery;

Planned follow-up:

- optional small in-page progress/result anchor;
- side-panel handoff for durable analysis and export.

### Non-goals

Do not include these in the first version:

- automatic injection into all web pages;
- always-on background page scanning;
- in-page floating widgets;
- ambient current-region analysis without an explicit user trigger;
- comment-section analysis;
- account automation;
- automatic fact-check verdicts;
- paywall bypassing;
- login-gated content scraping beyond what is visible to the user;
- broad host permission prompts at install time;
- Threads-specific DOM support.

## Permission Boundary

The MVP should use the current permission model:

- `activeTab` for user-triggered current-page extraction;
- `scripting` for one-shot content script injection after the user action;
- `sidePanel` for the reading workspace;
- `storage` for settings and readiness state.

Avoid adding `<all_urls>` or broad static host permissions for page reading.
Truly may request the existing optional `http://*/*` and `https://*/*` host
permissions only after the user explicitly enables General Page all-sites access
from Settings. That opt-in lets the Page/Web tab read the current page directly
while the Side Panel is open; it does not enable background crawling, automatic
screenshot capture, or persistent article storage. Suitable pages may send
compact-reading context to the configured model endpoint.

Optional endpoint host permissions may also be requested for user-configured
model endpoints.

### Activation Semantics

Toolbar popup activation is the primary MVP entry point for reading a new
general web page. Clicking the extension action gives Truly the temporary
`activeTab` grant that allows one-shot `scripting.executeScript()` on the
current page.

The Side Panel `讀取此頁` / `Read this page` button should remain long term, but
its default product meaning is re-read / retry, not first-time permission grant.
It can re-read when the content script or page access is already available. If
Chrome does not grant access, the panel must show clear guidance: either click
the Truly toolbar icon for one-time access or enable General Page all-sites
access in Settings.

Do not add broad static host permissions to make the Side Panel button work as
a first-time activation path. Direct Side Panel reads without toolbar activation
must remain behind explicit optional host permission.

## Information Architecture

Introduce a platform-neutral reading-surface model.

```ts
export type ReadingSurfaceKind = "social-post" | "web-page";

export type ReadingSurfaceSource =
  | "facebook"
  | "general"
  | "threads";

export interface ReadingSurface {
  id: string;
  kind: ReadingSurfaceKind;
  source: ReadingSurfaceSource;
  url: string;
  canonicalUrl?: string;
  title?: string;
  authorName?: string;
  sourceName?: string;
  publishedAt?: string;
  mainText: string;
  selectedText?: string;
  excerpt?: string;
  links?: Array<{ href: string; text?: string }>;
  images?: Array<{ src: string; alt?: string; title?: string }>;
  extraction: {
    method: "semantic-html" | "readability-heuristic" | "selection" | "fallback";
    status: "complete" | "partial" | "empty" | "blocked";
    warnings: string[];
  };
}
```

Also reserve a smaller current-target model for selected or pointed-at page
regions. This should not replace `ReadingSurface`; it is the unit that a
shortcut, context menu, or selection toolbar acts on.

```ts
export type ReadingTargetKind = "selection" | "paragraph" | "visible-region" | "element";

export interface ReadingTarget {
  id: string;
  surfaceId: string;
  kind: ReadingTargetKind;
  text: string;
  surroundingText?: string;
  sourceRect?: { x: number; y: number; width: number; height: number };
  extraction: {
    method: "selection" | "point-target" | "observed-node" | "fallback";
    status: "complete" | "partial" | "empty" | "blocked";
    warnings: string[];
  };
}
```

Action vocabulary is shared across toolbar, popup, side panel, and future
hotkeys:

```ts
export type ReadingActivationSource = "toolbar" | "popup" | "sidepanel" | "hotkey";
export type ReadingActivationTargetKind = "page" | "selection" | "current-region";
export type ReadingAction = "read" | "summarize" | "explain" | "extract_claims" | "fact_check";
```

The first runtime slice only enables `targetKind: "page"` plus
`action: "read"`. Selection and current-region actions are contract-reserved so
future hotkeys can reuse the same message shape without changing Page/Web state.

Keep Facebook post data compatible by adapting it into this shape over time.
Do not replace `PostData` and `DashboardPostEvent` in one large migration.

## Architecture

### Research Prerequisite

Before writing runtime code, review existing open-source reader and article
extraction projects. The initial research is tracked in
`docs/plans/general-page-reader-oss-research.md`.

The main implementation consequence is that Truly should define its own
`ReadingSurface` contract and fixture suite first, then evaluate
`@mozilla/readability` and `defuddle` against the same fixtures before deciding
whether to vendor or depend on either package.

The interaction-pattern consequence from Read Frog and Kiss Translator is that
article extraction is not enough for one-key paragraph actions. Truly needs a
live-page target layer: observed text nodes, selection snapshots, mouse-point
resolution, Shadow DOM awareness, and lazy viewport processing.

### New Files

Planned additions:

- `src/lib/reading-surface-types.ts`
- `src/lib/reading-target-types.ts`
- `src/lib/general-page-extraction.ts`
- `src/lib/current-region-targeting.ts`
- `src/lib/general-page-context.ts`
- `src/content_scripts/page-reader.ts`
- `src/content_scripts/current-region-reader.ts`
- `tests/fixtures/general-pages/*.html`
- `tests/contract/general-page-extraction-contract.test.ts`
- `tests/contract/current-region-targeting-contract.test.ts`

### Existing Areas To Reuse

Reuse:

- service-worker model routing;
- Tier A/Tier B provider settings;
- readiness checks;
- side panel shell;
- reading brief request/response path;
- zhtw scanning;
- Markdown export and external-tool handoff;
- theme/language settings.

### Existing Areas To Untangle

These areas currently contain Facebook-shaped assumptions and should be
generalized incrementally:

- `src/lib/messages.ts`: add current-page reading messages without disturbing
  existing feed messages.
- `src/background/service-worker.ts`: support one current-page extraction path
  instead of querying only Facebook tabs for every action.
- `src/popup/popup.ts`: distinguish supported Facebook surface from manual
  general-page reading availability.
- `src/sidepanel/*`: add a page-reading view or state branch while preserving
  the current feed dashboard.
- `src/lib/tier-b-client.ts`: change prompts from "Facebook post" to a
  surface-aware label, for example "web page" or "social post".
- `src/lib/i18n.ts`: replace hard-coded Facebook strings in handoff text where
  the surface may be general.

## Runtime Flow

1. User opens a normal web page.
2. User clicks the Truly popup or side-panel action.
3. Popup queues a consume-once Reading Command Envelope containing request and
   tab metadata, then opens the Side Panel in the same user-gesture chain.
4. Side Panel cold-open consumes and removes the envelope, validates that the
   tab still represents the same meaningful page, and starts the read.
5. Service worker probes the page-reader content-script build, injecting
   `page-reader.ts` through `activeTab` only when the reader is absent or stale.
6. Page reader extracts a `ReadingSurface` and echoes the request identity.
7. Side Panel ignores stale request identities and renders the page-reading
   workspace. Extracted text and analysis output remain in memory only.
8. Existing model pipeline generates summary and Reading Context.
9. User may copy, download, search, or hand off manually.

## Current-Region Flow

This is not the first runtime slice, but the architecture should leave room for
it.

1. Content script tracks the last meaningful mouse point and optionally the
   active selection.
2. User triggers a configured hotkey, context-menu action, or click-hold
   gesture.
3. Targeting resolves a `ReadingTarget` from the selected text, observed node,
   or nearest valid block at the mouse point.
4. The target includes region text, surrounding text, page metadata, and source
   rect.
5. The service worker routes the target through the same model/readiness path
   as a whole page but with a smaller prompt scope.
6. UI shows progress and the result in the chosen surface: side panel, in-page
   anchor, or both.

Initial design rule: explicit trigger only. Do not analyze on ambient hover.

## Extraction Strategy

Start with deterministic DOM extraction before adding dependencies.

Preferred extraction order:

1. User selected text, when a meaningful selection exists.
2. Semantic article roots: `article`, `main`, `[role="main"]`.
3. Metadata: `document.title`, canonical link, Open Graph title/description,
   author meta tags, publish-time meta tags.
4. Readability-style heuristic: largest coherent text container after removing
   nav, header, footer, aside, form controls, scripts, styles, ads, and hidden
   content.
5. Fallback: visible body text with aggressive length and quality guards.

The extractor should return warnings instead of pretending confidence:

- `no-main-content`
- `selection-only`
- `very-short-content`
- `large-navigation-noise`
- `login-or-paywall-like`
- `dynamic-content-partial`

## Side Panel UX

General page mode should feel like a reading workspace, not a feed dashboard.

Header:

- title;
- domain;
- URL/canonical URL;
- extraction status chip;
- refresh / retry button.

Primary sections:

- Summary;
- Reading context;
- Claims or checks;
- Follow-up questions;
- Source links found on page;
- External tools;
- Markdown export.

Avoid an in-page overlay in the MVP. If a later version adds one, it should be
small and user-triggered, such as a selected-text mini action, not an always-on
badge on every paragraph.

For current-region actions, prefer a hybrid surface:

- side panel for durable result, history, model status, copy/export, and
  external-tool handoff;
- small in-page anchor for progress, target confirmation, and short result;
- no inline replacement of source text.

This keeps the first version clean while preserving the directness of
immersive-translation-style shortcuts.

## Prompt And Output Changes

Tier B prompts should receive a surface label and source context:

- `surfaceKind`: `web-page` or `social-post`;
- `surfaceSource`: `general`, `facebook`, or future platform id;
- `title`;
- `url`;
- `domain`;
- `selectedText`;
- `mainText`;
- `links`;
- `imageAltText`;
- extraction warnings.
- `targetKind` and `surroundingText` when analyzing a `ReadingTarget`.

The model instruction should say "web page" for General Page Reader and avoid
Facebook-specific assumptions such as "post", "share", or "repost" unless the
surface kind is social.

The next autonomous slice should add a non-runtime model adapter contract before
calling Tier B for Page/Web surfaces. The adapter should serialize
`ReadingSurface` into a bounded model context, expose source links as model
context, and keep those links visible in the early Page/Web UI so extraction
quality can be judged manually. This is not runtime Tier B integration yet.

Initial model-call eligibility should require a complete or partial web-page
surface with at least 240 characters of `mainText`. Empty, blocked, or shorter
surfaces should stay in extraction/preview mode and show warnings instead of
being sent to a model.

## Testing Plan

Use fixture-first tests. Do not rely on live websites in public tests.

Fixtures should cover:

- clean article page;
- blog post with nav/sidebar noise;
- documentation page;
- news-like page with author/date metadata;
- page with selected text;
- page with mostly comments/noise;
- login/paywall-like page;
- Traditional Chinese article;
- page with image alt text and captions;
- SPA-like content container.

Public tests should assert:

- extraction status;
- title/domain/canonical URL normalization;
- main text excludes navigation and footer text;
- selected text takes priority only when useful;
- warnings are emitted for partial extraction;
- no private URLs or local paths enter fixtures;
- reading-surface conversion is stable.

Runtime browser audit should use only synthetic local pages and private `tmp/`
artifacts. It should cover:

- live service-worker build id matches `dist/build-id.txt`;
- popup general-page and unsupported-page states;
- successful Page/Web read on a synthetic local page;
- hash-only and tracking-query URL changes do not mark stale;
- meaningful URL changes do mark stale;
- clipboard copy includes a compact, human-readable result without raw parser
  diagnostics, source lists, or page excerpts;
- Markdown download includes the complete reading package: metadata, reading
  result, bounded page excerpt, and de-duplicated source links, but not the full
  page body;
- Side Panel retry without page access shows toolbar activation guidance.

## Implementation Slices

### Slice 1: Contracts And Fixtures

- Add `ReadingSurface` types.
- Add fixture HTML files.
- Add pure extractor tests that are independent of any one parser library.
- Implement a small heuristic extractor baseline.
- Compare `@mozilla/readability` and `defuddle` against the same fixtures in a
  follow-up dependency spike before adopting either package.
- No extension runtime changes yet.

### Slice 2: Page Reader Content Script

- Add `page-reader.ts`.
- Extract current page into `ReadingSurface`.
- Add message types for page reading request/result.
- Keep this manually triggered.

### Slice 3: Side Panel Page Mode

- Add page-reading runtime state.
- Render extracted title, domain, status, and text preview.
- Reuse summary/brief/handoff UI where possible.
- Keep Side Panel `Read this page` as a re-read / retry action. It must not be
  presented as the first-time permission grant path.
- Keep Page/Web sessions ephemeral. Do not persist extracted page text,
  summaries, analysis inputs, or history to `chrome.storage` in this slice.
- Scrub stale in-memory page surfaces after meaningful navigation and clean up
  sessions when their tab closes.

### Slice 4: Model Integration

- Status: first runtime slice implemented on `codex/general-page-reader-contract`.
- Route Page/Web effective reading context through a single Tier B
  `GeneralPageBrief` call after the parser advisor has produced
  `effectiveModelContext`.
- Keep eligibility fail-closed: stale sessions, model-ineligible contexts,
  `requires_user_target`, `blocked`, and unavailable provider runtime do not
  send analysis requests.
- Make prompts surface-aware and target-aware. Selection requests send the
  selected/effective text plus bounded surrounding context, not the original
  whole-page body.
- Deterministically guard `page_overview_only` output by stripping model claims
  after parse.
- Render the resulting page brief in the Page/Web Side Panel and include it in
  copy/export text.
- Keep Page/Web analysis session-only. Revisit durable history only as a
  separate privacy/storage decision.

### Slice 5: Product Hardening

- Update popup activation wording.
- Update CWS reviewer notes and permission justification.
- Add browser QA against a small manually selected page matrix. The
  `audit:general-page-reader` CDP report now writes a QA Matrix section covering
  popup activation, ordinary article reads, model brief generation, saved-tab
  switching, 430px Page/Web responsive overflow, Page/Web design restraint,
  selection targeting, current-region targeting, URL stale handling, noisy
  fallback caution, candidate block recovery, and no-grant guidance.
- Keep Page/Web diagnostics visible but compact. Extraction metadata,
  model-context rows, and parser-advisor rows use progressive disclosure by
  default, expanding automatically for caution, blocked, error, overview-only,
  user-target-required, fallback, partial, or warning states. This preserves
  early quality inspection without making ordinary article reads feel like a
  developer console.
- Keep successful ready-path model context as a compact, one-line inspection row
  while preserving expanded diagnostics for caution, blocked, overview-only,
  fallback, and candidate-recovery states.
- Defer selected-text mini-actions for this preview. Selection analysis is
  available through the explicit Side Panel button; contextual in-page buttons
  or context-menu entries require a separate UI/permission decision.

### Slice 6: Current Region Interaction Spike

- Status: 6a selection flow shipped earlier; 6b point-target spike implemented
  (pointer tracking, paragraph resolution via `current-region-targeting.ts`,
  `truly-read-current-region` command, session-marker handoff to the panel).
  Hotkey point reads require an existing page-reader session because plain
  commands do not grant `activeTab`; without one the panel shows the
  toolbar-activation guidance. Click-hold gestures and in-page anchors remain
  future work.
- Add `ReadingTarget` contract tests.
- Reuse the shared `ReadingActivation` action vocabulary.
- Track mouse point and selection snapshots in a content script.
- Resolve current target via selection, observed node, then nearest block at the
  mouse point.
- Ignore editable controls, extension UI, hidden content, and document surface
  clicks.
- Prototype hotkey and click-hold triggers.
- Compare side-panel-only, in-page-anchor-only, and hybrid result surfaces.

### Phase 3.5: Private Paired Prompt Audit

Status: completed with a fixed 60-sample private corpus and manual review.

The audit compared the pre-contract baseline with the compact standard contract
using 30 Facebook-derived samples and 30 news-page samples. The Facebook set
contained 2 live-DOM extracts, 4 SSR-cache originals, and 24 de-duplicated
runtime summaries from earlier real-browser audits. The news set contained 30
real preview extracts. The mixed Facebook provenance makes this an abstention
and query-contract audit, not a definitive raw-post grounding benchmark.

On the final fixed-corpus comparison:

| Aggregate check | Baseline | Compact standard candidate |
|---|---:|---:|
| Output within 2 background / 1 claim / 1 question limits | 100% | 100% |
| Samples with no claim or a populated `q` for every emitted claim | 5% | 100% |
| Disallowed verify/source follow-up kind | 25% | 0% |
| Claim/question duplication detected | 0% | 0% |
| Facebook samples that emitted a claim | 90% | 66.7% |

The final candidate still produced one prompt-level query containing the name
of a search product (1/60). The session-only investigation guard rejects that
query and its deterministic fallback, so it cannot become an external action.
Manual review also found that runtime-summary inputs can contain earlier AI
assessment metadata; the prompt now explicitly excludes writing-style,
AI-generation, routine schedule, media-appearance, subjective product/course
effectiveness, and other low-consequence metadata from claims. Some residual
false positives remain in those contaminated summaries, so automated lexical
"grounding" was not used as a release gate. A future raw-post corpus should
measure claim precision separately from this contract audit.

Keep raw page/post content, model input, model output, URLs, and human review
notes under gitignored `tmp/`. Commit only anonymized aggregate findings and
public-safe synthetic regression fixtures. This phase evaluates prompt quality;
it does not ship claim links, external search actions, verdicts, or durable
investigation history.

### Phase 3.5b: Raw Grounding Corpus

Status: completed for candidate v1. The private corpus, blind development
labels, frozen candidate, and one-time holdout evaluation are complete.

- `devjoe/truly-private-evals` is a private control-plane repository for corpus
  schemas, rubrics, opaque manifests, deterministic splits, tooling, and
  aggregate reports. Truly does not depend on it at runtime.
- Complete source text, URLs, screenshots, HTML, per-sample annotations, and
  model runs remain outside Git under that checkout's gitignored
  `private-data/`. Private GitHub visibility is not authorization to commit raw
  browsing content.
- The v1 target is 30 original Facebook samples and 30 original news samples.
  `runtime_summary` is forbidden; eligible samples must pass authorization,
  provenance, contamination, content-hash, and duplicate checks.
- The fixed split is 20 Facebook + 20 news for development and 10 + 10 for a
  holdout that is evaluated only after prompt and guard contracts are frozen.
- Private model runs require explicit endpoint/model/data confirmation. Only
  reviewed anonymous aggregate results may return to this public repository.

Candidate v1 used 36 eligible original Facebook samples and 30 original news
samples; the fixed v1 evaluation set used 30 per surface. Development review
cleared the predeclared preview thresholds, so commit `7de9c5b` and prompt
SHA-256 `ae31fe692cc243ee5a9450a70148d0812d0bd7651e819b8f621feabb65c92ef0`
were frozen before the holdout was unsealed. The 20 holdout sources were labeled
without candidate output, then evaluated exactly once with `qwen3.6-35b`.

The holdout showed 100% run success, 86.7% blind-gold claim precision, 100%
recall, 71.4% abstention accuracy, and 100% manually reviewed grounding
precision. It did **not** clear the investigation-action gates: the automated
unsafe-action rate was 28.6% against a maximum 25%; manual atomic-claim rate was
46.7% against 80%; aligned atomic-query rate was 66.7% against 75%; and useful
eligible-action rate was 28.6% against 50%. Most failures combined multiple
supported propositions rather than inventing unsupported content. Candidate v1
therefore remains evidence for the compact reading contract, but is not cleared
as the source of a release investigation action. It was not retuned after the
holdout result.

### Phase 4: Session-only Claim Investigation

- Status: implementation and fail-closed contract completed on the feature
  branch, but candidate v1 did not clear the private holdout gate for release.
- A grounded `claims.q` is preferred; a bounded natural-question fallback from
  `claim.c + claim.need` is used only when the model question is missing or
  locally rejected. URLs, domains, search-engine instructions, vague references,
  and likely compound claims fail closed instead of bypassing the guard.
- The first `開始查核` action only prepares a bounded, session-only task in the
  current Page or Focus scope. It does not open a tab, send another model
  request, persist history, or assign a verdict.
- Evidence search, Gemini, copy, and original-source actions require a second
  explicit user action. Page navigation, reread, a new analysis key, and a new
  Focus target clear stale task state.
- Overview-only output remains ineligible because its deterministic guard
  removes claims.

### Phase 5: Runtime and UX Gate

- Status: implementation verification completed; product-quality holdout gate
  failed for candidate v1, so the investigation action remains unreleased.
- Focused unit coverage validates query sanitization, deterministic fallback,
  fail-closed eligibility, Page/Focus state isolation, and the two-step UI.
- The CDP UI audit validates that preparing a task opens no browser target and
  captures the expanded card at 430px alongside Page, Focus, screenshot
  recovery, loading, and ready states.
- Real-content paired audit artifacts remain private under `tmp/`; only
  anonymized aggregate findings may be copied into tracked documentation.

## Verification Gates

Each implementation slice should pass:

```bash
npm run check:type
npm run test:contract:public
npm run test:unit:public
```

Before a public preview:

```bash
npm run check:public
```

If runtime behavior changes, also verify in Chrome with a real browser session.
For local development, compare the dev reload build id with the active extension
runtime before declaring reload healthy.

General Page Reader runtime changes should additionally pass:

```bash
npm run audit:general-page-reader
npm run audit:general-page-model-integration
```

`audit:general-page-reader` attaches to the existing Chrome CDP session, uses
synthetic local HTML only, and writes screenshots/JSON under `tmp/`. Do not
commit those artifacts. `audit:general-page-model-integration` runs a local
OpenAI-compatible mock endpoint and verifies payload scoping plus overview
post-guards without storing page analysis content; it is included in
`check:general-page` and therefore in `check:public`.

Public synthetic parser regression is intentionally lower cadence than runtime
and live-DOM review. Use `npm run check:general-page:synthetic` when extraction
heuristics, fixture metadata, pattern coverage, or parser candidates change. Do
not treat synthetic fixture pass rates as representative product-quality
evidence; use private live-DOM review and screenshots for that judgment.

For a quick private smoke against the page currently open in Chrome, run:

```bash
npm run smoke:general-page-current -- --page-type news-article
```

Add `--url-pattern <regex>` when multiple HTTP(S) tabs are open and a specific
page should be selected. Add `--all-open --limit <n>` to smoke several open
HTTP(S) tabs in one run:

```bash
npm run smoke:general-page-current -- --all-open --limit 4 --page-type open-tab
```

The command writes a private target manifest under
`tmp/general-page-product-quality/`, runs the live-DOM review harness, and
prints only a sanitized summary. The full URL, extracted previews, and review
HTML remain in `tmp/` and must not be committed. For a deliberately
caution-heavy tab set such as dashboards, search pages, and leaderboards, add
`--max-ready-count 0` to fail the smoke when any open page is marked ready.

## Resolved Preview Decisions

- Selected-text analysis is explicit and side-panel-first for this preview. Do
  not add an in-page selection button or context-menu permission until a separate
  UI/permission decision is made.
- Page/Web source links stay visible for early inspection, but runtime model
  context and UI exposure are filtered and capped at six links. The CDP QA
  Matrix fails if ordinary, noisy, or candidate-recovery reads expose more than
  six source links.
- Page/Web analysis remains session-only. Durable Page/Web history is deferred
  to a future privacy/storage review.

## Open Questions

- Should a future privacy-reviewed version offer durable Page/Web history, and
  if so, which fields may be stored?

## Success Criteria

The first version is successful when:

- a user can open Truly on a normal article page and get useful reading context
  without configuring a new site permission;
- extraction failures are visible and understandable;
- no background scanning occurs;
- privacy copy remains accurate;
- existing Facebook reading surfaces keep working;
- the new reading-surface contract makes future Threads support easier rather
  than harder.
