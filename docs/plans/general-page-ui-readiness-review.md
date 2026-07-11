# General Page Reader UI Readiness Review

Status: current Page/Web UI is ready for focused reviewer validation
Date: 2026-07-04
Last refreshed: 2026-07-11

This review records the current UI/UX decision for the General Page Reader
branch. It is based on the Page/Web CDP audit screenshots under `tmp/`; those
screenshots remain private artifacts and must not be committed.

## Design Direction

Page/Web should stay close to the existing Facebook Feed experience: compact,
quiet, status-first, and diagnostic only when the extraction is uncertain. This
is intentionally not a marketing-style reader view or a rich document app. The
panel's job is to show what Truly read, whether that context is safe to use,
and what the next model-facing context would be.

## Component Decisions

| Component | Keep / Change | Rationale |
| --- | --- | --- |
| Feed / Page-Web tabs | Keep | They preserve the existing side panel navigation model and make Page/Web an extension of Truly rather than a separate product. |
| Page/Web header actions | Keep | `讀取此頁` and `使用選取文字` are the minimum explicit actions needed for activeTab and target intent. |
| Status banner | Keep for actionable top-level states | Stale, no-grant, read failure, and other states that require action remain easy to scan. Successful internal pipeline states stay silent. |
| Extracted page card | Keep | Early users need title/source plus copy/download affordances. Parser text lives under a nested, collapsed `Page text` disclosure instead of taking over the card. |
| Extraction diagnostics | Keep collapsed under Technical details | Uncertain pages summarize their user impact before Page text; raw parser, advisor, and budget values remain available without becoming default UI. |
| Analysis readiness card | Fold into Page context presentation and diagnostics | Separate ready/caution cards repeated the same meaning as parser warnings and advisor decisions. The presentation layer now emits at most one user-facing summary. |
| Analysis scope card | Fold into Page context presentation and Focus scope | Page overview, blocked, and target-required decisions become a concise Page context summary. Explicit selections and current regions use the dedicated Focus `Analysis scope`. |
| Page brief card | Keep | It proves the model-facing context is usable without storing the full page body. Overview pages suppress claims through deterministic guards. |
| Source links | Keep capped inside Page context | External and same-site related links stay available for inspection, while the cap prevents navigation/sidebar links from taking over the panel. |
| Web history switcher | Hide from primary UI | Multi-tab Page/Web sessions remain internal for current-tab lifecycle, stale detection, and result isolation. A visible history strip made Web feel busier than Feed and competed with the page brief. Multi-page recall should return later only as a deliberate workspace, not default chrome. |

## Visual Review Notes

- A follow-up Bencium impact review on 2026-07-04 reaffirmed the current
  direction: Page/Web should remain an industrial/utilitarian inspection
  surface, not a decorative reader mode. The memorable product choice is
  restraint: quiet ready pages, explicit user-triggered actions, and visible
  uncertainty only when extraction quality needs review.
- Ready pages keep analysis readiness compact and diagnostics collapsed. This is
  the main evidence that Page/Web has not become a developer console by
  default.
- Caution, noisy fallback, and teaser-hub overview pages show one concise Page
  context summary. Technical details remain collapsed but available for early
  reviewers who need to inspect why the context changed. Successful
  candidate-block recovery stays quiet.
- The `caution/recovery` reviewer gate remains explicit: user impact is visible
  in the synthesized summary, while raw diagnostics stay opt-in under Technical
  details instead of expanding another pipeline card.
- The dark, low-contrast surfaces, 6-8px radius, restrained blue accent, and
  compact typography remain aligned with the current Feed overlay/side-panel
  style.
- The current layout avoids card nesting: sections are stacked in one column,
  and repeated diagnostic rows use compact grid cells rather than separate
  cards.
- The no-grant path is intentionally sparse: one primary status block and one
  short detail block. It avoids duplicate retry panels.
- Latest screenshot review checked the 430px ready path, selected-text path,
  teaser-hub overview path, and no-grant path from
  `tmp/general-page-reader-audit-2026-07-03T19-12-16-973Z`. The visual
  conclusion stayed unchanged: all visible components have a current product
  job, and the side-panel language remains aligned with the existing Feed tab.
- A 2026-07-04 debug-vs-end-user copy pass renamed visible Page/Web cards from
  engineering terms to user-facing labels: `Analysis readiness`, `Analysis
  scope`, `Page brief`, and `Page context`. Internal routing values such as
  advisor decisions and allowed-use enums remain available only as
  `data-raw-value` diagnostics for automated audit assertions.

### UI convergence checkpoint (2026-07-10)

The latest reviewer-driven pass aligned Web more closely with Feed while
preserving the product rule that ordinary ready states stay quiet and caution
states explain themselves:

- Feed is unavailable on ordinary web pages and Web is unavailable on
  Facebook; disabled tabs use a quiet borderless treatment and expose the
  reason through their accessible tooltip. Focus remains available wherever a
  user can explicitly select text for analysis.
- Completed Heads-up cards use a 14px neutral check control, matching the
  collapse-label scale instead of introducing a competing success badge.
- Web cards replace the green `Captured` pill with compact source and
  `Last read HH:MM` metadata. The reread action sits next to that timestamp and
  briefly changes to a neutral check only after a user-triggered reread.
- Domain-scoped permission is requested through an in-card
  `Allow reading on this domain` action only when that grant is actually
  missing. Permission checking does not flash a disabled action.
- Page-overview analysis names its scope in the section heading instead of a
  separate chip. Reading context, items to verify, and follow-up questions use
  one typographic hierarchy; content-specific caveats and model attribution
  form a quiet right-aligned closing cluster.
- A new-page read renders the final Web card structure immediately: known page
  title and source, a disabled Page context position, a Reading context heading,
  and two static reserve lines. Ready content fades in over 150ms, with motion
  disabled under `prefers-reduced-motion`, so the top-level structure no longer
  flashes from a standalone status into a different card.

Private no-focus CDP evidence remains under
`tmp/web-loading-continuity-audit-2026-07-10T15-14-11-875Z`. The temporary
side-panel target reported `visibilityState: hidden` and `hasFocus: false`;
loading and ready card/header/context positions differed by about 1.7px. The
430px loading and ready screenshots were inspected locally and are intentionally
not committed. The verified build was
`1783696183145-bed0fe4-dirty`.

### Page context presentation checkpoint (2026-07-11)

The reviewer-driven Page context and Focus pass replaced duplicated pipeline
cards with one user-impact presentation layer:

- Clean article reads do not render a success summary, `Page status`, `Usable`,
  or `Organized`. The Page context summary and its information icon exist only
  when the reader needs guidance.
- Parser warnings and advisor decisions resolve through one priority order.
  Explicit advisor outcomes such as page-overview-only or requires-user-target
  take precedence over lower-level parser readiness. Overview pages therefore
  render one sentence explaining that navigation-heavy pages are suitable for
  topic browsing and that full reports should be opened from their headlines.
- Blocked and target-required states add a concrete status such as
  `Not analyzing` or `Select a passage`; warning and overview states do not add
  generic labels such as `Needs review`.
- Model notes that repeat index, feed, aggregation, navigation-noise, or source-
  link guidance are suppressed when Page context already communicates the same
  user impact. Content-specific caveats remain in the analysis closing area.
- Page context opens with the synthesized summary, followed by a nested,
  collapsed `Page text`, source links, and collapsed Technical details. The
  summary uses a low-contrast tinted surface rather than the solid source-header
  surface.
- Focus never renders whole-page Page context. It shows `Analysis scope`, the
  target kind and character count, a two-line preview, and a collapsed selected
  text or paragraph disclosure.
- Feed and Web analysis typography now share 12px body text with an 18px line
  height, 11px muted subsection labels, aligned question indentation, and the
  same compact, right-aligned model-attribution role.

The focused gate is `make gpr-check`; it owns the General Page Reader contract,
runtime, permission, i18n, and typecheck matrix through the `test:gpr` package
script. The final local build for this checkpoint was
`1783757269974-651a62e-dirty`. Private no-focus CDP screenshots were inspected
locally as `truly-gpr-context-presentation-overview-ready-2026-07-11.png` and
`truly-gpr-context-presentation-focus-2026-07-11.png`; neither artifact is
committed. Runtime probes reported `document.hasFocus() === false`.

### Web and Focus continuity checkpoint (2026-07-11)

Web and Focus now keep independent, session-only analysis scopes. Switching
between them no longer discards the other result, and a later asynchronous
response is applied only to the scope that requested it. A same-page Web
reread preserves Focus, while meaningful navigation still clears both scopes
to prevent stale context from crossing page boundaries. Failed Focus updates
leave the previous successful Focus result available and show the new error in
that scope.

The Focus action is named `Apply selected content` (`套用選取內容`) to describe
the immediate effect without implying that the selection is stored. `Selected
content overview` uses the same quiet caption hierarchy as `Items to verify`,
so it introduces the generated summary without competing with the analysis
content. Copy, Markdown download, retry, and audit state all resolve against
the active scope.

Regression coverage includes Web-to-Focus and Focus-to-Web restoration,
scope-specific copy output, repeated Focus selection, same-page Web reread,
failed Focus replacement, and concurrently resolving Web/Focus model calls.
`make gpr-check` passed 19 files and 219 tests plus TypeScript checking. Private
background-CDP evidence is under
`tmp/focus-ia-cdp-2026-07-11T10-58-51-335Z`; it verified preserved Web and
Focus summaries, aligned 11px/600 caption typography, the updated action copy,
and `document.hasFocus() === false` throughout. The inspected development build
was `1783767511170-810a603-dirty`. The private screenshots and audit JSON remain
uncommitted.

The repeatable UI gate for this contract is now `make gpr-ui-check`. It runs
against synthetic local pages and deterministic scope-specific model responses,
auto-recovers a stale loaded extension, and keeps all evidence under
`tmp/general-page-ui-check-*`. Before attaching to Chrome it rejects a dist
build whose marker predates the extension source, preventing a mutually
consistent but stale dist/reload/runtime build from passing review.

### Cold-open command handoff checkpoint (2026-07-11)

Popup-triggered Web reads no longer depend on repeated result broadcasts while
the Side Panel starts. The popup queues a consume-once Reading Command Envelope
with request, tab, activation, URL, and timestamp metadata; the Side Panel
removes it before starting extraction. Page text, model input, screenshots, and
analysis results never cross this storage seam. Page-read request identities
also prevent a late response from replacing a newer read on the same tab.

The service worker now delegates page, target, and candidate-block delivery to
one Page Reader tab transport. It probes the installed content-script build,
injects only when absent or stale, and normalizes restricted-page and invalid-
response failures. Chrome event listeners remain synchronously registered at
service-worker module load; the transport does not keep the worker alive.

### Canonical Analysis Scope checkpoint (2026-07-11)

`src/sidepanel/page-reading-session.ts` is now the single owner of Page Reading
Session state and its Web/Focus Analysis Scopes. The canonical session no longer
contains legacy `target`, `advisor`, `analysis`, or `screenshot` fields beside
`pageScope` and `focusScope`; a flat view exists only when the active scope is
materialized for presentation.

Pure transitions cover scope replacement, same-page reread preservation,
meaningful-navigation clearing, page completion, Reading Target application,
and read failure. The Side Panel runtime orchestrates browser effects but no
longer reconstructs those invariants in each asynchronous response path.

## Current Non-Changes

- Do not remove diagnostics globally. The feature is still in early product
  validation, and the maintainer needs opt-in evidence to judge extraction
  quality; keep that evidence collapsed under Technical details.
- Do not add decorative visual polish, gradients, or large reader-mode
  typography. Page/Web is an operational inspection surface, not an immersive
  reading destination.
- Do not split analysis readiness and analysis scope into separate tabs yet.
  The contrast between raw extraction eligibility and advisor-derived effective
  context is important for debugging parser quality.
- Do not add context menu or in-page selected-text buttons in this UI pass.
  Those remain separate permission and interaction decisions.

## Evidence Gates

The current CDP audit includes Page/Web design restraint and interaction
accessibility rows. It verifies:

- ready-path diagnostics are collapsed;
- ready-path analysis readiness is compact;
- source links are capped;
- caution diagnostics expand;
- the 430px Page/Web layout has no horizontal overflow, clipped interactive
  elements, or offscreen cards;
- visible controls have accessible names and no undersized primary buttons or
  tabs.
- repeated Web reads keep internal session state without rendering a visible
  history strip or `切到此分頁` activation control.

Before merge, rerun:

```bash
TRULY_EXTENSION_ID=<loaded-extension-id> TRULY_AUDIT_AUTO_RELOAD=1 npm run audit:general-page-reader
```

Then visually inspect the generated screenshots for:

- `page-analysis-ready.png`;
- `page-noisy-caution.png`;
- `page-candidate-block.png`;
- `page-teaser-hub-overview.png`;
- `page-no-grant.png`;
- `page-web-history-hidden.png`.
