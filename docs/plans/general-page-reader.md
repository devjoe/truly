# General Page Reader Plan

Status: implementation in progress
Last updated: 2026-07-01

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

Planned follow-up:

- current mouse-region or selected-text action;
- one-key trigger for the paragraph or element under the mouse;
- optional small in-page progress/result anchor;
- side-panel handoff for durable analysis and export.

### Non-goals

Do not include these in the first version:

- automatic injection into all web pages;
- always-on background page scanning;
- in-page floating widgets;
- current-region hotkeys;
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
If a future in-page overlay needs persistent page access, that should be a
separate permission decision with updated reviewer notes and privacy docs.

Optional endpoint host permissions remain only for user-configured model
endpoints.

### Activation Semantics

Toolbar popup activation is the primary MVP entry point for reading a new
general web page. Clicking the extension action gives Truly the temporary
`activeTab` grant that allows one-shot `scripting.executeScript()` on the
current page.

The Side Panel `讀取此頁` / `Read this page` button should remain long term, but
its product meaning is re-read / retry, not first-time permission grant. It can
re-read when the content script or page access is already available. If Chrome
does not grant access, the panel must show a clear toolbar-activation guidance
message instead of failing silently.

Do not add broad static host permissions to make the Side Panel button work as
a first-time activation path. If a future version wants direct Side Panel reads
without toolbar activation, that should be a separate permission decision.

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
3. Popup opens the side panel and sends a current-page reading request.
4. Service worker injects or messages `page-reader.ts` into the active tab via
   `activeTab`.
5. Page reader extracts a `ReadingSurface`.
6. Service worker stores the current page reading event in the same replayable
   runtime state used by the side panel.
7. Side panel renders the page-reading workspace.
8. Existing model pipeline generates summary and reading brief.
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
- copy metadata includes title, URL, and excerpt but not full body text;
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

### Slice 4: Model Integration

- Route page surfaces through Tier B summary and reading brief.
- Make prompts surface-aware.
- Add copy/export output format for web pages.

### Slice 5: Product Hardening

- Update popup activation wording.
- Update CWS reviewer notes and permission justification.
- Add browser QA against a small manually selected page matrix.
- Decide whether selected-text mini-actions belong in the next preview.

### Slice 6: Current Region Interaction Spike

- Add `ReadingTarget` contract tests.
- Track mouse point and selection snapshots in a content script.
- Resolve current target via selection, observed node, then nearest block at the
  mouse point.
- Ignore editable controls, extension UI, hidden content, and document surface
  clicks.
- Prototype hotkey and click-hold triggers.
- Compare side-panel-only, in-page-anchor-only, and hybrid result surfaces.

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
```

This audit attaches to the existing Chrome CDP session, uses synthetic local
HTML only, and writes screenshots/JSON under `tmp/`. Do not commit those
artifacts.

## Open Questions

- Should selected text become the default input when selected text exists, or
  should the user choose "Analyze selection" explicitly?
- How much of source-link extraction should be shown to users versus kept only
  as model context?
- What minimum content length should be required before model calls are allowed?

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
