# General Page Reader UI Readiness Review

Status: current Page/Web UI is ready for focused reviewer validation
Date: 2026-07-04

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
| Status banner | Keep | It is the fastest scan point for read, stale, no-grant, and failure states. |
| Extracted page card | Keep | Early users need title/source/excerpt plus copy/download affordances to judge extraction quality. |
| Extraction diagnostics | Keep collapsed for ready, expanded for caution/recovery | This matches the product need: ordinary pages stay quiet; uncertain pages expose enough detail for review. |
| Model context card | Keep compact for ready, expanded for blocked/caution | It separates raw extraction eligibility from the later `Reading context` advisor result. This is necessary while the parser-advisor path is still being validated. |
| Reading context card | Keep | It is the single place that explains whether the next model-facing context is article analysis, page overview only, a candidate block, or requires a user target. |
| Page brief card | Keep | It proves the model-facing context is usable without storing the full page body. Overview pages suppress claims through deterministic guards. |
| Source links | Keep capped and bottom-aligned | Source links are useful for early inspection, but the cap prevents navigation/sidebar links from taking over the panel. |
| Saved page switcher | Keep | Multi-tab Page/Web sessions need a visible way to review and reactivate prior readings without hiding Facebook sessions. |

## Visual Review Notes

- A follow-up Bencium impact review on 2026-07-04 reaffirmed the current
  direction: Page/Web should remain an industrial/utilitarian inspection
  surface, not a decorative reader mode. The memorable product choice is
  restraint: quiet ready pages, explicit user-triggered actions, and visible
  uncertainty only when extraction quality needs review.
- Ready pages keep the model context compact and diagnostics collapsed. This is
  the main evidence that Page/Web has not become a developer console by
  default.
- Caution, noisy fallback, candidate-block recovery, and teaser-hub overview
  pages expand diagnostics. The extra density is justified because those states
  are precisely where early reviewers must inspect why the context changed.
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

## Current Non-Changes

- Do not hide diagnostics globally. The feature is still in early product
  validation, and the maintainer needs visible evidence to judge extraction
  quality.
- Do not add decorative visual polish, gradients, or large reader-mode
  typography. Page/Web is an operational inspection surface, not an immersive
  reading destination.
- Do not split `Model context` and `Reading context` into separate tabs yet.
  The contrast between raw extraction eligibility and advisor-derived effective
  context is important for debugging parser quality.
- Do not add context menu or in-page selected-text buttons in this UI pass.
  Those remain separate permission and interaction decisions.

## Evidence Gates

The current CDP audit includes Page/Web design restraint and interaction
accessibility rows. It verifies:

- ready-path diagnostics are collapsed;
- ready-path model context is compact;
- source links are capped;
- caution diagnostics expand;
- the 430px Page/Web layout has no horizontal overflow, clipped interactive
  elements, or offscreen cards;
- visible controls have accessible names and no undersized primary buttons or
  tabs.

Before merge, rerun:

```bash
TRULY_EXTENSION_ID=<loaded-extension-id> TRULY_AUDIT_AUTO_RELOAD=1 npm run audit:general-page-reader
```

Then visually inspect the generated screenshots for:

- `page-analysis-ready.png`;
- `page-noisy-caution.png`;
- `page-candidate-block.png`;
- `page-teaser-hub-overview.png`;
- `page-no-grant.png`.
