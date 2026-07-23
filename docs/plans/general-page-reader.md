# General Page Reader Plan

Status: implementation in progress; Slices 1-4, 6a selection, 6b
current-region targeting, screenshot confirmation, live-DOM review mode, and
session-only multi-page switching are implemented on this branch. The
200-target product-quality gate passed its first external validation run (see
`general-page-reader-fable5-validation.md`), and a follow-up 200-target
live-DOM review has been summarized in
`general-page-reader-quality-findings-2026-07-03-live-dom.md`. Merge-readiness evidence is indexed in
`general-page-reader-merge-readiness.md`.
Last updated: 2026-07-17

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

Candidate v2 added structured atomic propositions, compound-claim and
attribution guards, and a separate 30-sample holdout (15 Facebook + 15 news)
collected after the v2 work began. Commit `e9a81b3` was frozen before candidate
output was generated; all holdout labels were completed without that output,
and the holdout was evaluated exactly once with `qwen3.6-35b`.

The v2 holdout achieved 100% run success, 88.2% blind-gold claim precision,
93.8% recall, 85.7% abstention accuracy, 7.1% blind-gold unsafe-action rate,
and 100% manually reviewed grounding precision. It still failed the frozen
action boundary: only 50% of exposed actions were both consequential and
aligned, versus the 90% threshold, and 70% preserved an aligned eligible-action
question, versus 95%. Low-consequence opinions and generic controversy still
entered claims; one fallback dropped an expert-analysis attribution; two
compound claims reached action eligibility. Candidate v2 is frozen as failed
evidence and was not tuned after the holdout.

Candidate v3 is a development-only probe over the existing v1 development
split (20 Facebook + 20 news), not a new frozen candidate and not a holdout
evaluation. It adds typed claim policy and attribution, exact effective-text
grounding, generic-subject rejection, trailing-attribution preservation, and
compound relative-clause guards. The normal Page/Focus reading runtime remains
on the stable standard contract; only the private runner opts into the v3
contract and its format-repair retry.

The best v3 development run completed all 40 analyses and produced 90.9% claim
precision, 83.3% recall, 87.5% abstention accuracy, and no blind-gold unsafe
action. That success depended on format repair for 29/40 responses (72.5%),
which is too costly and unstable for the normal runtime. The model emitted 22
claims. Before the final local guards, six would have exposed an investigation
action and manual review found only one clearly useful. Replaying the final
fail-closed guards retained that one action and rejected the other 21 claims,
mostly as compound structures, missing attribution, generic subjects, or text
grounding failures. This demonstrates a safer boundary but unusably low action
coverage; no new holdout was unsealed or collected for v3.

The development work has now adopted the domain and evidence boundaries in
[`claim-investigation-research.md`](claim-investigation-research.md) and tested
server-side constrained JSON schema against that contract. Grammar fixed syntax
but did not establish check-worthiness, atomicity, source independence, temporal
fit, or evidence sufficiency. Manual review and retrieval results below keep the
next candidate gate closed; no fresh holdout should be created yet.

### Phase 3.75: Claim Investigation Research

- Status: research, model-neutral domain contract, constrained-output audit,
  synthetic evidence-first UI, and synthetic native-companion boundary are
  implemented; no release runtime or verdict behavior was added.
- Research supports a staged workflow of claim selection, decomposition,
  question-driven retrieval, evidence-ledger construction, sufficiency review,
  and a bounded finding that can remain insufficient or conflicting.
- The current Chrome Extension is the consented capture and session-preview
  surface. A future desktop companion is the preferred owner of resumable
  multi-source work and durable evidence, while a standalone App can add
  share/import surfaces without replacing browser-fidelity extraction.
- A 30-sample development audit compared `json_object` with gx10 constrained
  `json_schema`. Constrained output eliminated syntax drift. Replacing brittle
  English-style subject/predicate/object segmentation with exact atomic clause
  spans raised the best candidate to 13 grounded plans, 100% action precision,
  72.2% recall, and 100% literal-question coverage on existing dev labels.
- A retrieval-only 6 Facebook + 6 news positive-development set now has 12/12
  grounded plans. Eleven passed directly; one used one grounding repair and an
  explicitly recorded human-atomic segmentation fallback. This result measures
  plan representation only, not check-worthiness detection.
- The authorized 30-row manual review is complete. Check-worthiness accuracy was
  83.3%, atomicity pass rate 53.8%, attribution fidelity 87.5%, temporal and
  quantity fidelity 91.7%, literal-question coverage 100%, and query
  answerability 92.3%, with no unsafe action.
- The 12-row real-web retrieval pilot is also complete. Single-claim search
  found relevant results for 9/12 but sufficient evidence for only 2/12.
  Question decomposition found relevant results for 12/12 and sufficient
  evidence for 5/12. Authority/document-first found primary documents for 8/12
  but sufficient evidence for only 3/12.
- The pilot therefore rejects both a single-search product flow and an
  authority-only flow. The runtime-neutral v2 contract now represents an
  adaptive evidence cascade: one atomic subject, question decomposition,
  responsible-authority and canonical-document discovery, full-document fetch,
  exact answering passage, separate sufficiency assessment, and an explicitly
  downgraded independent-secondary fallback when primary evidence is unavailable
  or insufficient. Search snippets remain discovery-only. The extension does
  not execute this graph yet, and ClaimReview lookup is not a required dependency.
- Synthetic public tests cover the three comparison routes plus the adaptive
  cascade, evidence
  deduplication and sufficiency ordering, and a native companion protocol with
  capability negotiation, idempotent restart, resumable status, cancellation,
  deletion, consent, and a 256 KiB product envelope limit.
- Development evidence and gate decisions are summarized in
  [`claim-investigation-development-audit-2026-07-14.md`](claim-investigation-development-audit-2026-07-14.md).
- Full rationale, proposed domain language, platform matrix, and execution
  sequence: [`claim-investigation-research.md`](claim-investigation-research.md).

### Phase 4: Session-only Claim Investigation

- Status: the session-only prepared-action vertical slice and its fail-closed
  contract are implemented on the feature branch. Candidates v1 and v2 did not
  clear their private holdout gates, the v3 development probe did not clear the
  coverage/runtime-stability boundary, and the fresh v4 forward-development
  audit materialized no eligible actions. This remains unreleased.
- A grounded `claims.q` is preferred; a bounded natural-question fallback from
  `claim.c + claim.need` is used only when the model question is missing or
  locally rejected. URLs, domains, search-engine instructions, vague references,
  and likely compound claims fail closed instead of bypassing the guard.
- A completed Page or Focus reading may return up to three ranked provisional
  claims. The service worker schedules one lower-priority `derived` Adapter
  batch, not one request per claim. Each indexed candidate settles independently
  to prepared, ineligible, or unavailable, so one rejected candidate cannot
  hide another valid future-Agent task. Adapter state reaches the current
  reading UI through one fail-closed projection. While the batch is
  pending, the section heading shows one quiet loading indicator rather than
  per-row placeholders. The whole bounded batch stays withheld until every item
  reaches a terminal state; then only Adapter-prepared candidates that also pass
  the existing local guard enter the compact bulleted renderer and Page/Focus
  exports together. Ineligible, unavailable, malformed, stale, or raw
  reading-model candidates remain invisible. Preparation remains ephemeral and
  never creates durable history.
- Model work shares one resource-aware scheduler: explicit user work is
  `user_blocking`, current reading is `foreground`, prepared actions are
  `derived`, and speculative work is `prefetch`. Each model resource executes
  one request at a time; deduplication, supersession, and a bounded foreground
  burst keep Page preparation from starving Feed work without increasing the
  number of model calls.
- Every approved Reading Brief claim exposes two compact actions: Google AI Mode
  (`問 Gemini`) and icon-only copy. AI Mode receives UI-language instructions
  and the display question together with the Reading Brief claim, rationale,
  evidence need, and optional current HTTP(S) URL metadata. Copy uses the
  localized display question. Evidence need is progressive disclosure with the
  same `i` behavior on every row: hover and keyboard focus reveal it visually,
  while click/touch toggles an accessible expanded state and closes any other
  open row. The icon does not also open the generic singleton tooltip.
  Standard Google Search is intentionally absent from this product surface;
  its keyword helper remains an internal evaluation primitive. The URL is never
  treated as evidence or copied into model output.
  The former original-source action is intentionally absent because it
  duplicated the page the user is already on.
- The adapter requires an exact `sourceQuote` grounding span, preserves source
  language for the atomic claim and canonical `q`, and produces `displayQ`,
  `why`, and `need` in the requested UI language. The local display guard
  rejects translated questions that introduce a number or date absent from the
  exact claim. The parser tolerates harmless schema-version and
  optional-attribution drift, then applies the existing deterministic
  eligibility guard. Page navigation, reread, a new analysis key, and a new
  Focus target clear stale task state; Page and Focus keep separate slots.
  Strict Adapter output is reserved for the future Truly Agent boundary;
  source-language claim, atom, quote, and canonical question do not gate or
  replace the current Gemini/copy handoff UI.
- The Adapter owns the complete prepared-claim semantics: `c`, `why`, `need`,
  `q`, `displayQ`, `atom`, `policy`, and `sourceQuote`. The background runtime
  may associate the indexed result with a Page or Focus session, but must not
  restore Reading Brief fields over the rebuilt result. The prompt treats a
  signed first-person article as sufficient evidence that its author expressed
  an opinion, so those candidates abstain; an explicitly attributed external
  proposition inside the same article may still be rebuilt into one checkable
  atom. `need` names a concise evidence family instead of asking a second
  verification question. A narrow local guard rejects only clearly procedural
  evidence text such as `需查核是否...` / `verify whether...`; it does not try
  to reproduce this semantic judgment in regexes.
- Reading-context `bg` items keep one visual grammar at every cardinality: one
  item is still rendered as a real unordered-list item instead of changing to
  an indented paragraph. The bilingual model prompt requires one background
  concept per item and permits author identity only when it materially changes
  interpretation; author identity must not be merged with another person,
  concept, or event merely to fill the two-item budget.
- The future Truly Agent uses a separate non-runtime semantic Case draft. The
  model selects document families, source roles, authority hints, and numbered
  question coverage; local code owns IDs, question linkage, verification
  requirements, frozen query candidates, and stopping conditions.
- Overview-only output remains ineligible because its deterministic guard
  removes claims.

### Phase 5: Runtime and UX Gate

- Status: implementation and live UX verification completed; product-quality
  holdout gates failed for candidates v1 and v2, v3 remains a development-only
  probe, and the fresh v4 forward-development gate failed. The investigation
  action remains unreleased.
- Focused unit coverage validates scheduler priority/fairness, single-call
  three-candidate batch parsing and index continuity, adapter grounding
  and grounding, query sanitization, deterministic fallback, fail-closed
  eligibility, Page/Focus race isolation, and the separation between
  provisional reading output and approved reading-handoff rows.
- Side Panel bootstrap waits for stored or auto language settings before the
  Page runtime can issue its first analysis request. Presentation applies the
  same UI-language guard again, so a stale or malformed `displayQ` cannot put a
  source-language verification question into an otherwise localized panel.
- Preparing state shows only one quiet section-level indicator. A ready outcome
  enters the stable compact bullet renderer with localized question,
  progressive evidence disclosure, Copy, and Gemini only after the complete
  batch settles. Ineligible and unavailable outcomes do not enter the
  user-facing card or exports. This same atomic projection applies to Page and
  Focus, so a raw or partially settled candidate cannot leak through another
  product surface.
- A 2026-07-16 no-focus CDP check used dev build
  `1784200373031-0ae1017-dirty` on a real Financial Times page. It observed an
  automatic `preparing -> ready` transition with no manual click, no redundant
  label, and the then-current Google Search / Gemini / Copy actions at 430 px.
  The later compact action refinement is covered by a deterministic three-row
  audit and exposes Gemini / Copy only. Its then-current fallback presentation
  was superseded by the approved-only projection described above.
- A 2026-07-18 final no-focus CDP check used dev build
  `1784391028750-5fa9f41-dirty`. It verified the previous immediate-row behavior,
  which is retained only as historical evidence and is no longer the product
  contract. It also forced `:hover` through the CDP CSS domain rather
  than dispatching user input: each of the three `i` controls revealed only its
  own evidence need directly between the question and action row, showed no
  duplicate singleton tooltip, and left all four Web/Focus continuity
  observations with `document.hasFocus() === false`. The collapsed
  question-to-action gap measured 2 px for all three rows. A deliberately long
  question plus long evidence fixture wrapped without clipping; expanded
  question-to-evidence and evidence-to-action gaps both measured 2 px. The
  progressive disclosure shows the evidence requirement directly without a
  redundant `需要：` / `Needed:` prefix. Shared Feed/Web/Focus follow-up rows
  now keep their question above the right-aligned actions at both 360 px and
  430 px. Their action row is visually raised 4 px toward the question; the
  control boxes overlap only 2 px of the question line box without touching
  text, clipping, or causing horizontal overflow.
- A 2026-07-19 no-focus CDP check used dev build
  `1784474958682-4b1be23-dirty` and the approved-only projection. During the
  derived batch it showed one section-level loading dot, zero provisional rows,
  and zero premature Gemini/Copy actions. The deterministic mixed state showed
  only the two prepared rows; the all-ineligible/unavailable state removed the
  whole section. The 360 px and 430 px captures had no horizontal or interactive
  clipping, Page/Focus continuity stayed intact, and all four recorded Side
  Panel focus observations remained `false`. Screenshots and audit JSON remain
  gitignored under `tmp/general-page-ui-check-2026-07-19T15-30-06-879Z`.
- A 2026-07-20 atomic-batch follow-up used dev build
  `1784486510828-a1f9926-dirty`. The no-focus CDP matrix again showed one quiet
  indicator with zero rows/actions while the batch was pending, two rows only
  after the mixed batch reached terminal states, and no section after an
  all-ineligible/unavailable batch. The Page/Focus continuity and 430 px layout
  gates remained green, with all four Side Panel focus observations `false`.
  The otherwise transient one-ready/two-preparing state is locked separately by
  the canonical projection and runtime DOM regressions, which require zero rows
  and actions until the whole batch settles. Artifacts remain gitignored under
  `tmp/general-page-ui-check-2026-07-19T18-42-23-451Z`.
- The clean-commit proof for the same atomic contract used build
  `1784487314020-f67a79b`. The no-focus CDP matrix passed Page/Focus continuity,
  430 px layout, pending / mixed-terminal / all-rejected claim states, and four
  Side Panel focus observations that all remained `false`. Private artifacts
  remain under
  `tmp/general-page-ui-check-2026-07-19T18-55-28-607Z`.
- A stalled background preparation now fails closed after a 120-second UI
  deadline. The entire batch becomes unavailable, the quiet pending section
  disappears, and late results for the expired analysis cannot revive a
  partial row. Page and Focus deadlines remain session-only, are cancelled by
  terminal settlement, navigation, a replacement analysis, or tab removal,
  and do not add retries or persistence. A fake-timer runtime regression locks
  the partial-ready then stalled case.
- A 30-row observational product gate reused an already-consumed development
  cohort (15 Facebook and 15 news); it is not a fresh benchmark or release
  claim. The production-compatible JSON-object reading path completed only
  2/30 rows (26 format failures and two truncations). A diagnostic structural
  schema comparison completed 14/30 and truncated 16/30. Every completed
  Adapter batch abstained, so 30/30 pages had no approved action section. This
  produced zero false actions on 12 existing negative controls, but also zero
  materialized actions on 18 existing checkworthy-likely rows. Diagnostic
  Adapter latency was p50 6.5 seconds, p90 12.3 seconds, and max 16.4 seconds;
  no call approached the 120-second recovery deadline. Raw rows, outputs, and
  manual review remain only in the private evaluation repository.
- Product gate decision: accept the approved-only, atomic, fail-closed UI/state
  mechanics, but keep claim-action release authority false. The current
  default reading wire is not reliable on the evaluated endpoint/model and
  approved-action coverage is not useful. Do not enter evidence-first Phase 4
  until a provider-neutral, capability-receipted bounded transport passes a
  fresh preflight and a separately preregistered real-data slice can measure
  Adapter precision, recall, locale consistency, and Gemini handoff quality.
- A later 2026-07-18 no-focus CDP pass used dev build
  `1784398754095-5fa9f41-dirty` and confirmed that a single `bg` item has a
  visible bullet at both 360 px and 430 px. Web/Focus continuity, typography,
  and all four `document.hasFocus()` observations remained unchanged; the
  audit stayed fully no-focus.
- Review screenshots remain local-only:
  `/private/tmp/truly-auto-investigation-preparing-430-2026-07-16.png` and
  `/private/tmp/truly-auto-investigation-ready-430-2026-07-16.png`.
- Real-content paired audit artifacts remain private under `tmp/`; only
  anonymized aggregate findings may be copied into tracked documentation.

### 2026-07-16 Reading Brief and Loading Follow-up

- The initial Page/Web loading card now exposes exactly one polite live status.
  Its visual skeleton is hidden from assistive technology, so the user no
  longer hears both the page-read status and a nested analysis status while the
  first request is still running.
- Facebook Reading Brief `qs` is now reserved for understanding, context,
  counter-perspectives, and image interpretation. The prompt schema no longer
  offers `verify` or `source`; normalization rejects verification-shaped,
  search-shaped, wrong-locale, non-question, and claim-duplicating rows. The
  same policy is applied when rendering older session events so legacy output
  cannot reappear under the `延伸問題` heading.
- The General Page Reader CDP audit now observes and captures the initial
  loading skeleton, analysis-running state, background claim preparation, and
  ready state. Delayed local mock responses keep those transitions observable
  without relying on a live provider, and the audit fails on duplicate live
  loading statuses or a manual investigation-start control returning.
- A private 90-event Facebook runtime audit and a 30-row serial replay against
  `qwen3.6-35b` completed with 30/30 parse success and no model request errors.
  Raw post text, per-row output, and screenshots remain gitignored under
  `tmp/`. Manual review found one remaining semantic blind spot: a
  source-seeking question phrased as `counter` passed the earlier policy.
- That blind spot is now closed by a phrase-level semantic guard. Questions
  that ask where quoted figures, cited material, or the post's sources came
  from are rejected regardless of their model-authored kind. Ordinary
  source-literacy questions remain allowed when they ask how to judge source
  quality instead of requesting evidence for the current claim.
- Question actions now have a versioned typed projection with separate
  `modelText`, concise `displayText`, portable `copyText`, compact
  `googleQuery`, context-enriched `aiModePrompt`, and a non-runtime
  `agentTask`. Rendering, Page/Focus export, copy, and Google AI Mode consume
  that shared contract instead of rebuilding meaning independently. HTTP(S)
  source URLs are sanitized and appear only as optional AI Mode metadata.
- Feed Reading Brief loading now reserves 148-164 px with a static,
  `aria-hidden` skeleton and exactly one polite live status. The swap to ready
  content does not animate the whole section, avoiding a transient compositor
  frame in which surrounding UI layers disappeared. Secondary tool actions may
  still use their existing staged reveal. Reduced motion removes the remaining
  pulse/reveal animations.
- A background-only 430 px CDP audit observed the same 162 px loading section
  at start and after four seconds, no overflow, one live status, zero
  interactive skeleton elements, no scroll movement, and a complete ready
  first frame. Generated screenshots and measurements remain gitignored under
  `tmp/`.
- An old-30 product-semantic replay showed that eight reason-specific Adapter
  retries yielded no accepted actions. Runtime now performs one low-priority
  Adapter attempt only; the private runner exposes repair solely through an
  explicit diagnostic flag and records `repairMode` in run metadata. Local
  action guards also reject incomplete navigation-tail quotes,
  under-specified comparisons, and generic evidence requirements. Regular
  Google search receives bounded source-language claim and attribution anchors,
  while localized evidence need, page metadata, and URL remain AI-Mode-only
  context.
- The final old-development candidate adds a deterministic preparation stage,
  but it remains a development contract rather than a release claim. It may
  only infer a uniquely grounded typed attribution or project an already
  ordered atom to its exact single-proposition source span. It cannot rewrite
  lexical content, resolve pronouns, join spans across a sentence, or bypass
  exact-quote, bounded-gap, navigation, legal-stage, or comparison guards.
- A model- and network-free replay of the 13 saved v4 Adapter candidates
  prepared four and rejected nine; the previously ready but underspecified
  market comparison is among the rejects. This count is a deterministic
  regression expectation, not a coverage result or shipping gate.
- The permitted old-30 v5 gx10 parity run was executed exactly once and frozen
  as a technical-preflight partial result. All 30 reading calls succeeded: 16
  rows emitted no claim, 14 requested the Adapter, two Adapter calls failed at
  the response protocol boundary, eight outputs were rejected by the unchanged
  local guard, and four became action-ready. The run opened no public search
  and no external action.
- The old 30-row slice is now retired and must not be rerun or used to tune a
  prompt, schema, guard, regex, or threshold. Fresh-audit preregistration stayed
  closed because its technical prerequisite requires zero Adapter failures;
  the v5 result did not satisfy that boundary.
- The replacement candidate is protocol-only. A trusted provider must opt in
  through an explicit `responseFormat`; hostname inference and silent fallback
  are forbidden. Schema mode uses a strict fixed four-key root
  (`schemaVersion`, `decision`, `reason`, and `claim`), represents abstention as
  `claim: null`, and requires the `attribution` key on a claim while allowing
  its value to be `null`. It receives an 1800-token budget; the historical
  `json_object` path remains at 480 tokens. Neither path performs automatic JSON
  repair. Protocol errors distinguish truncation, invalid JSON, invalid schema,
  and source-quote grounding failure in addition to transport failures.
- The protocol-only candidate subsequently completed its fixed 30-case
  synthetic smoke with 30/30 protocol success. Runtime and audit were bound to
  the same schema digest; the run used a clean worktree, refused overwrite,
  called one declared endpoint, kept raw payloads untracked, and opened zero
  public searches or external actions. This established transport/schema
  stability only and allowed a new semantic audit to proceed.

### 2026-07-17 Fresh Semantic Action Audit

- The v4 ceremony collected 122 technically eligible private rows from 14
  sources, formed a source-diverse 60-row blind review pool, and froze a 30-row
  cohort with 15 Facebook and 15 news rows. Independent source review and third
  adjudication happened before candidate output; raw content and per-row labels
  remain gitignored in the private evaluation repository.
- The one-shot `qwen3.6-35b` run completed 30/30 readings. Nineteen rows
  requested the Investigation Adapter, 18 cleared its protocol boundary, one
  failed, one valid response abstained, and the local guard rejected 17. No
  investigation action became eligible; no public search or external action was
  opened.
- The adjudicated C3 gate failed: positive task materialization was 0/18 and
  0/9 per surface, while negative false actions were 0/12 and unsafe/leaky
  outputs were zero. Four follow-up rows leaked verification or sourcing intent.
  Portable copy and AI Mode questions were self-contained for 18/23 and 21/23
  rows respectively. Zero eligible actions caused the action-quality gates to
  fail closed rather than report vacuous precision.
- Two audit-harness contract mismatches were fixed with regression tests: the
  production-optional `agentTask.context` is accepted, and run prompt-language
  hashes are checked against languages in the immutable exported input. These
  fixes made no model request and did not change the frozen input, output, or
  candidate behavior.
- The final no-focus CDP gate passed on dev build
  `1784273697679-6735eba-dirty`, with Web/Focus continuity, 430 px layout, and
  all observed Side Panel focus states intact. A preceding run exposed an audit
  polling race when the preparing state completed before the 1.4-second poll.
  The audit now accepts MutationObserver timeline evidence only when preparing
  is present, the original claim remains visible, and the ready card is absent.
  A red-green regression and a real CDP rerun both passed; no product transition
  or timing was weakened.
- This v4 cohort is frozen failed development evidence and cannot be used for
  tuning. `releaseAuthority` remains false. Any successor must be separately
  versioned and developed on synthetic fixtures or a newly preregistered slice
  before another one-shot semantic audit is allowed.
- The first post-v4 successor remains synthetic-only and keeps the one-pass
  Adapter plus the existing wire shape. It presents the untrusted candidate
  clue first and ends on the exact-grounding copying boundary, requires one
  source-language atom to occur in order in the
  claim, question and exact quote, rejects incomplete prepared text at the
  Adapter boundary, keeps routine commercial venue events context-only, and
  adds bounded source context to portable questions that refer to an unnamed
  event. It opens no action, search, holdout or release authority.

### 2026-07-20 Narrow Investigation Selector Preflight

- The first evaluation-only exact-span Adapter still asked the model to write
  `why`, `need`, a source-language question, and a localized display question.
  A one-repair v6 run passed its automatic 30-row synthetic gate, but human
  review rejected it: several selected actions depended on vague references or
  context added by model-authored wording. Passing JSON and locale checks was
  therefore not sufficient semantic evidence.
- The replacement v2 wire is deliberately narrower. One request may return only
  `candidateId`, `evidenceFamily`, and the small `claimKind` / `consequence`
  policy enums. Local code materializes the exact source text and offsets, the
  localized evidence hint, and the self-contained Gemini handoff. The request
  uses a 400-token budget, has no repair or silent fallback, and retains an
  explicit `json_schema` versus `json_object` provider lowering.
- Candidate enumeration now rejects obvious context-dependent fragments and
  does not expose a shorter nested span when an accepted atomic span contains
  it. This is a structural source-boundary rule, not a language-specific claim
  classifier; the model remains responsible for check-worthiness and may
  abstain.
- Three repeated v8 synthetic passes completed 90/90 one-shot protocol calls.
  Positive preparation was 18/18, 17/18, and 18/18; every pass abstained on all
  12/12 negative controls. After deterministic nested-span removal, v9 again
  completed 30/30 one-shot calls, prepared 17/18 positives, and abstained on
  12/12 negatives. Human review found no remaining nested duplicates,
  vague-reference fragments, or compound selected actions. Raw prompts and
  per-row outputs remain gitignored under `tmp/private-data/runs/`.
- This establishes a technical preflight candidate only. It does not change
  runtime rendering, consume a fresh private Page/Feed cohort, or authorize a
  release. Runtime promotion requires a reviewed product decision to separate
  Reading context from investigation actions, independent provider capability
  evidence for the new wire, and the already-preregistered fresh dual-surface
  semantic gate. The adversarial record is rendered locally at
  `tmp/grill-reports/gpr-release-pipeline-2026-07-20.html`.

### 2026-07-21 Single Recommendation Contract

- The successor candidate uses a compact v5 wire:
  `{"schemaVersion":5,"candidateId":...}`. It returns one local exact-span ID
  or `null` for abstention. The model does not write a claim, question, reason,
  consequence, or evidence family.
- The hard local boundary now rejects only user-unacceptable failures such as
  malformed or non-grounded IDs, incomplete spans, unsafe/private tasks,
  cross-scope results, and privacy violations. Public-interest consequence and
  topic category are ranking signals, not admission requirements.
  Entertainment, sport, consumer, product, celebrity, and routine facts may
  therefore appear when they are concrete, externally verifiable, and useful
  for understanding the page.
- This does not mean that the best of every weak set is published. The selector
  is instructed to choose only a strong sole recommendation and can abstain.
  Exact display text and a generic localized Gemini evidence handoff remain
  deterministic local projections of the selected span.
- The frozen A-D release ceremony, thresholds, reviewer requirements, and rule
  for changing the standard are defined in
  `docs/plans/general-page-ranked-actions-release-standard.md`. The previous
  v2-v4 evidence is historical and does not authorize the v5 runtime. The v4
  primary-plus-secondary candidate failed its fresh development gate; v5 was
  admitted to evaluation only after an adversarial `grill-your-sub-agents`
  decision.

### 2026-07-23 Candidate v9 boundary and rank refinement

- The preceding runtime-envelope development cohort passed scope fidelity,
  recall, exact-span ownership, protocol, network, and overall handoff gates,
  but failed the frozen visible-action quality and top-rank gates. Gate C stayed
  sealed and every numerical threshold remains unchanged.
- The successor keeps the schema-v5 one-ID wire and deterministic local
  presentation. Candidate enumeration now rejects only two additional generic
  incomplete-boundary classes: an unmatched leading wrapper/code closer, and a
  demonstrative-led sentence that cannot name its referent by itself.
- Ranking remains prompt-first. The selector must prefer a specific bounded
  action, constraint, date, count, decision, measurement, or named event over a
  broad overview or definition; it must reject weak unnamed speculative
  attribution and abstain when the survivors would only be secondary context.
  No new local topic classifier or semantic scoring regex was added.
- This is a new candidate, not release authorization. It requires the unchanged
  synthetic Gate A and a wholly fresh runtime-envelope Gate B cohort; the
  consumed v8 rows cannot be replayed as candidate evidence.

### 2026-07-23 Prospective utility and non-regression gate

- Runtime-envelope v10 remains a consumed failure. It is not rescored under the
  successor standard and its unopened holdout remains sealed.
- A `grill-your-sub-agents` decision found that absolute-best ranking is too
  preference-sensitive to be the sole release blocker, while an
  acceptable-only gate could conceal gradual selector degradation.
- The successor therefore has two independent hard gates. Product utility
  requires zero unsafe or user-unacceptable actions, exact Page/Focus scope,
  complete handoffs, and useful positive-row recall. Selector non-regression
  requires a blinded randomized A/B comparison against a preregistered frozen
  reference on the same fresh cohort.
- Primary recommendation rate, top-rank rate, and reviewer ranking disagreement
  remain reported diagnostics. They do not rescue a utility or non-regression
  failure.
- The failed but frozen `c262eb8` selector is the initial diagnostic reference
  only. It cannot establish release fitness. The new candidate must pass the
  absolute product-utility gate and the relative non-regression gate before a
  holdout can be opened.

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
