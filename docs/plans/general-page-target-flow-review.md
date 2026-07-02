# General Page Target Flow Design Review

Status: design recommendation; Slice 6a accepted and implemented in this branch;
open questions resolved by maintainer (see Resolved Decisions)
Date: 2026-07-02

## Scope

This review covers the three follow-up questions raised after the parser
advisor runtime wiring (`Wire General Page parser advisor runtime`):

1. the paragraph / selected-text target flow;
2. user-confirmed screenshots and the automatic-screenshot setting;
3. whether page overview needs its own `targetKind`.

It also records one pre-Slice-4 fix discovered during the wiring review.

Implementation note: this branch implements Slice 6a, the explicit selected
text target flow. Paragraph / point targeting, screenshots, and a possible
overview action remain deferred as described below.

## Question 1: Paragraph / Selected-Text Target Flow

### Current State

The contract layer is already in place and fail-closed:

- `src/lib/reading-target-types.ts` defines `ReadingTarget` with kinds
  `selection | paragraph | visible-region | element`.
- `READING_TARGET_REQUEST/RESULT/ERROR` messages exist in
  `src/lib/messages.ts`; the service worker answers every request with
  `reading_target_unsupported`.
- `page-reader.ts` rejects any activation other than
  `targetKind: "page"` + `action: "read"` with
  `page_reading_action_unsupported`.
- `extractGeneralPageSurface` already prioritizes `selectedText` when it is
  meaningful and marks the extraction method as `selection`.
- `buildGeneralPageModelContext` already maps a `ReadingTarget` into
  `targetKind: "selection"` or `"current-region"`.
- The advisor can already answer `request_user_selection`, which the runtime
  renders as `requires_user_target` with `modelEligible: false`.

What is missing is purely the runtime seam: nothing captures a selection
snapshot, and the side panel has no affordance to act on
`requires_user_target`.

### Recommendation

Split Slice 6 into two sub-slices and ship selection first.

**Slice 6a: selection flow (recommended next).** Selection is the low-risk
half: no mouse tracking, no Shadow DOM traversal, no nearest-block resolution,
and the extraction path for selected text already exists and is tested.

Proposed flow:

1. The side panel shows a "使用我選取的文字 / Use my selection" action in two
   places: as a recovery action when `Reading context` is
   `requires_user_target`, and as a secondary action next to re-read.
2. The action sends `READING_TARGET_REQUEST` with `trigger: "selection"`.
3. `page-reader.ts` resolves `window.getSelection()` into a `ReadingTarget`
   snapshot (`kind: "selection"`, `method: "selection"`) at request time. An
   empty or trivial selection returns `READING_TARGET_ERROR` with a
   `no_meaningful_selection` error, and the panel shows guidance instead of
   failing silently.
4. The runtime builds a model context from the existing surface plus the
   target (`buildGeneralPageModelContext` with `options.target`) and re-runs
   the advisor with `targetKind: "selection"`.
5. Target sessions follow the same rules as page sessions: session-only, no
   `chrome.storage`, scrubbed on meaningful navigation, and bound to the
   originating surface via `surfaceId` plus the existing
   `isMeaningfullySamePage` check.

Explicit-trigger rule is preserved: the selection is read only when the user
presses the action, never on ambient selection change.

Permission note: the side-panel action reuses the content script that is
already injected for the current read session. If the page grant is gone, the
panel must show the existing toolbar-activation guidance, same as re-read.

**Slice 6b: paragraph / point targeting (defer).** Mouse-point tracking,
observed-node resolution, hotkeys, click-hold gestures, and in-page anchors
stay in the later spike. They need live-page instrumentation that has real
volatility cost, and Slice 6a will validate the target message loop first.
Hotkeys via `chrome.commands` need no new host permission but should still
land with 6b, not 6a. A context-menu entry would add a `contextMenus`
permission and should be treated as a separate permission decision.

### Contract Adjustments Needed For 6a

- Add a `ReadingTargetErrorReason` union (at minimum
  `no_meaningful_selection`, `page_grant_missing`, `target_stale`) instead of
  free-form strings.
- Decide the minimum meaningful selection length once, shared between
  extractor and target resolver (the extractor already has
  `minSelectedTextLength`).
- Add a contract test `tests/contract/current-region-targeting-contract.test.ts`
  as planned, covering: selection snapshot shape, empty-selection error,
  surface binding, and advisor request with `targetKind: "selection"`.

## Question 2: User-Confirmed Screenshot And Auto-Screenshot Setting

### Current State

- Policy contract already encodes the decision:
  `screenshot.defaultRequiresConfirmation: true` and
  `autoScreenshotAllowed` only via an explicit option
  (`resolveGeneralPageParserAdvisorRuntimePolicy`).
- The runtime passes `allowScreenshot: false` today, so
  `request_screenshot_region` is never an allowed advisor decision in the
  shipped path.
- There is no settings key, no capture code, and no confirmation UI for
  general pages. The only capture precedent is the debug snapshot exporter,
  which relies on the Facebook host permission that general pages do not have.
- A Tier B vision probe already exists (`callTierBVisionProbe` in
  `src/lib/tier-b-client.ts`), so vision capability can be checked before
  offering the screenshot path at all.

### Recommendation

Keep the flow fail-closed and ship it in this order:

1. **Do not add the settings key yet.** A visible "automatic screenshot"
   toggle without a working screenshot path is a dead setting and a privacy
   copy hazard. Add `generalPageAutoScreenshot` (default `false`) only in the
   same change that ships the capture path.
2. **Confirmation-first, in-panel.** When the advisor (or a future 6b flow)
   wants visual grounding, the side panel shows an inline confirmation card:
   what will be captured (visible tab region), where it goes (the user's
   configured model endpoint), and a preview of the captured image before
   sending. Confirmation happens per read flow, not per install.
3. **Gate on vision capability.** Only offer the screenshot recovery when the
   configured Tier B provider passes the vision probe. Otherwise the advisor
   request must keep `allowScreenshot: false` so the decision never appears.
4. **Auto mode stays bounded even when enabled.** With the future setting on:
   only within a user-initiated read flow, only the visible tab, never
   background tabs, and the `Reading context` UI must state that a screenshot
   was included. No screenshot data may enter `chrome.storage`, log buffers,
   or the snapshot exporter.
5. **Permission reality check.** `chrome.tabs.captureVisibleTab` on a general
   page works only while the `activeTab` grant is alive. The capture must
   happen inside the same user-initiated flow; if the grant is gone, show the
   toolbar-activation guidance rather than requesting new host permissions.
6. **Release surface.** Shipping any screenshot path requires updating
   `docs/release/permission-justification.md`, reviewer notes, and the privacy
   policy to name screenshots explicitly as user-confirmed model input.

Suggested sequencing: user-confirmed capture ships with or after Slice 6b
(it depends on region targeting to be useful); the auto setting ships last,
and only if confirmed demand exists.

## Question 3: Should Page Overview Get Its Own `targetKind`?

### Current State

- `ReadingActivationTargetKind` is `"page" | "selection" | "current-region"`.
- Page overview currently exists only as a use restriction:
  `GeneralPageEffectiveModelContextUse = "page_overview_only"`, produced by the
  advisor's `downgrade_to_index_or_feed` decision and enforced by the CDP
  audit for noisy fallback pages.

### Recommendation: No New `targetKind`

Overview does not change *what* is being read — the target is still the whole
page. It changes *how deep* the model is allowed to go. Encoding it as a
`targetKind` would duplicate state that `allowedUse` already owns and would
create contradictory combinations (`targetKind: "page-overview"` with
`allowedUse: "article_or_selection_analysis"`). Keep a single source of truth:
`targetKind` says what the target is; `allowedUse` says what may be done with
it.

If Slice 4 model integration shows that overview needs to be a user-selectable
product action (for example, the user explicitly asks for an overview of an
index page), extend the *action* vocabulary instead: add `"overview"` to
`READING_ACTIONS`. The action list is already the designed extension point for
"what the user asked for", and adding an action does not disturb any target or
message shape. Defer even that until a real prompt difference exists.

## Pre-Slice-4 Fix Carried Over From The Wiring Review

`buildGeneralPageEffectiveModelContext` uses `selectedBlock.textPreview` as
`mainText` for `prefer_candidate_block`. The preview is clamped by
`candidateBlockPreviewChars`, so the effective context may hold a truncated
body. Before Slice 4 sends this context to a model, the runtime should
re-extract the full text of the chosen block from the live page (by candidate
block id) instead of reusing the advisor payload preview. Track this as a
Slice 4 precondition.

Implementation note: the branch now collects candidate block previews during
the page read, keeps the advisor payload preview-limited, and asks the live
page for the chosen block's full text only after the advisor returns
`prefer_candidate_block`.

## Suggested Review / Implementation Order

1. Slice 6a selection flow (contracts + runtime + CDP audit case).
2. Candidate-block full-text re-extraction (Slice 4 precondition).
3. Slice 4 model integration for `page` and `selection` targets.
4. Slice 6b paragraph / point targeting spike.
5. Screenshot confirmation flow, then the auto-screenshot setting.

## Resolved Decisions (Maintainer, 2026-07-02)

- **All-sites optional host permission: ratified.** General Page Reader may
  offer all-sites access as a user-facing option. It stays an optional runtime
  permission with an explicit user action, default off, with grant/revoke in
  Options. It must never become an install-time static host permission.
- **Selection action placement: always available plus recovery.** The
  "use my selection" action stays visible whenever a read surface exists
  (scope-narrowing tool) and doubles as the recovery path for
  `requires_user_target`. Current implementation is correct as shipped.
- **Empty selection: error-message path.** No `selectionchange` listening or
  polling. Pressing the action with no meaningful selection returns
  `no_meaningful_selection` and the panel shows guidance. This keeps the
  explicit-trigger principle intact.
- **Overview action: defer to Slice 4.** Do not add `"overview"` to
  `READING_ACTIONS` now. `allowedUse: "page_overview_only"` remains the single
  source of truth. Revisit only if Slice 4 prompt work shows an index/feed
  overview prompt differs materially from a page summary prompt.
- **Page/Web history: session-only.** No durable history. Sessions clear on
  meaningful navigation and tab close; nothing analysis-related enters
  `chrome.storage`. Users keep results via Markdown copy/export. Any future
  history feature requires its own privacy review.
