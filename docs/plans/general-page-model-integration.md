# General Page Model Integration (Slice 4) Design

Status: implemented in the first Slice 4 runtime pass
Date: 2026-07-02

## Goal

Send the Page/Web `Reading context` (`effectiveModelContext`) through the
user-configured Tier B provider and render a page summary and reading brief in
the side panel. This is the step that turns "可送模型(尚未送出)" into a real
product outcome.

Maintainer decisions that bound this slice (see
`general-page-target-flow-review.md`, Resolved Decisions):

- Sessions stay session-only. No analysis content enters `chrome.storage`.
- No `"overview"` action is added now. `allowedUse` remains the single source
  of truth; revisit only if overview prompts turn out to differ materially.
- Selection targets use a narrower prompt scope than whole pages.
- No screenshots, no vision payloads in this slice.

## What Exists And Is Reused

- `GeneralPageEffectiveModelContext` with `allowedUse`
  (`article_or_selection_analysis | page_overview_only | requires_user_target |
  blocked`) is already produced per session, including candidate-block
  full-text recovery and selection targets.
- `buildGeneralPageModelUserPrompt(context)` in
  `src/lib/general-page-model-context.ts` already serializes surface kind,
  target kind, extraction diagnostics, main text, source links, image alt
  text, and surrounding text.
- Tier B client machinery in `src/lib/tier-b-client.ts`: endpoint URL
  building, `TierBChatBody`, no-thinking compat handling,
  `buildPromptTemporalContext`, JSON response parsing patterns, timeout and
  error-code conventions from `callTierBReadingBrief` and
  `callTierBGeneralPageParserAdvisor`.
- Provider gating: `providerCanRunTierBFeature` in
  `src/lib/feature-readiness.ts`; API key resolution via the existing
  service-worker helpers.
- Deterministic output review: `src/lib/model-output-review.ts`
  (`ModelOutputReviewScope` currently `tier_b_deep | tier_b2_reading_brief`).
- Side panel session state, stale scrubbing, and `isMeaningfullySamePage`
  identity checks in `src/sidepanel/page-reading-runtime.ts`.
- Copy/export: `buildCopyText` in the page runtime plus the existing
  `markdownDownloadMode` setting.

## Analysis Call Shape

One model call per analysis, not the Facebook two-stage pipeline. General
pages have no Tier A classification and no dashboard event, so a single
"page brief" call returns everything the panel renders.

### Output Schema (`GeneralPageBriefV1`)

New file `src/lib/general-page-analysis.ts`:

```ts
export interface GeneralPageBrief {
  schemaVersion: 1;
  /** 2-4 sentence neutral summary of the page or target. */
  summary: string;
  /** Reuses ReadingBrief field shapes so renderers can be shared. */
  bg?: ReadingBriefBackground[];
  claims?: ReadingBriefClaim[];
  qs?: ReadingBriefQuestion[];
  note?: string;
  model: string;
  outputLang?: Lang;
  elapsedMs?: number;
  outputReview?: ModelOutputReview;
}
```

Reusing `ReadingBriefBackground/Claim/Question` from `src/lib/types.ts` keeps
the existing brief renderers usable. `checks` is intentionally omitted in v1;
page surfaces have no Tier A/B risk scores to anchor deterministic checks.

### Prompt Contract

- System prompt: new `generalPageBriefSystemPrompt(outputLang)` in
  `tier-b-client.ts` with EN and zh-TW variants, JSON-only output, same
  temporal-context and anti-hallucination conventions as the reading-brief
  system prompt. Two variants by allowed use:
  - **article/selection variant**: summary + background + checkable claims +
    follow-up questions.
  - **overview variant** (`page_overview_only`): summary of what the page
    *is* (index, feed, list), what topics it links to, and follow-up
    questions. It must instruct the model to produce **no claims** and no
    article-grade analysis.
- User prompt: `buildGeneralPageModelUserPrompt(effectiveModelContext-derived
  context)`. The effective context's `mainText` (candidate-block recovered or
  selection text) is what gets sent — never the raw `ReadingSurface` when the
  advisor replaced it.
- Selection targets: the user prompt already carries
  `targetKind: "selection"` and `surroundingText`. The system prompt must
  scope analysis to the target text and treat surrounding text as context
  only, not as content to summarize.
- Chat body: `temperature: 0`, `response_format: json_object`, bounded
  `max_tokens`, `truncate_prompt_tokens`, and the existing
  no-thinking/compat switches — mirror `buildTierBReadingBriefChatBody`.

### Eligibility Gate (Deterministic, Fail-Closed)

The runtime may send an analysis request only when all hold:

1. session `status === "ready"` and surface identity still matches the tab;
2. `effectiveModelContext.modelEligible === true`;
3. `allowedUse` is `article_or_selection_analysis` or `page_overview_only`;
4. provider passes `providerCanRunTierBFeature` and endpoint/model resolve.

`requires_user_target` and `blocked` never send. This is enforced in runtime
code, not only in UI state.

### Deterministic Output Guard

Prompt instructions are not trusted alone. After parsing:

- If `allowedUse === "page_overview_only"`, strip `claims` from the parsed
  output before storing/rendering, and record the strip as an output-review
  finding. The CDP audit asserts no claims render for the noisy fallback page.
- Run `model-output-review` over model-authored text fields. Add
  `"general_page_brief"` to `ModelOutputReviewScope`.
- Parse failures, timeouts, and HTTP errors map to typed error codes following
  the advisor's convention, and render as a retryable error state.

## Message Contract

Add to `src/lib/messages.ts` (new messages; do not overload the
Facebook-shaped `READING_BRIEF_REQUEST`):

```ts
export interface GeneralPageAnalysisRequestMsg {
  type: "GENERAL_PAGE_ANALYSIS_REQUEST";
  tabId: number;
  /** Serialized effective context the SW should treat as opaque input. */
  context: GeneralPageModelContext;      // effective-context derived
  allowedUse: GeneralPageEffectiveModelContextUse;
  providerRuntime: GeneralPageParserAdvisorProviderRuntime; // reuse shape
  outputLang?: Lang;
}

export interface GeneralPageAnalysisResultMsg {
  type: "GENERAL_PAGE_ANALYSIS_RESULT";
  tabId: number;
  ok: boolean;
  brief?: GeneralPageBrief;
  error?: string;
}
```

Service worker handles the request exactly like the advisor request: resolve
API key, call `callTierBGeneralPageBrief` (new function in
`tier-b-client.ts`), answer with the result message. No caching, no
persistence, no background retry.

## Side Panel Runtime

Extend `PageReadingSession` in `page-reading-runtime.ts` with an
`analysis` sub-session (`idle | running | ready | error`, plus the brief and
a typed error). Rules:

- Auto-run once per fresh `ready` session when the eligibility gate passes,
  consistent with the advisor's "may run automatically inside a
  user-initiated read action" policy. Re-read, selection target, and
  candidate-block recovery each invalidate the previous analysis and may
  trigger one new run.
- A result is dropped (not rendered) if the session became stale or the
  surface identity changed while the call was in flight — same guard the
  advisor result path uses.
- Manual retry button on error; no automatic retry loops.
- Render order in the panel: Summary, Reading context (existing advisor
  block), brief sections (background / claims / questions), source links,
  actions. Overview results must be visually labeled as overview
  (i18n key, not hardcoded).
- All new strings go through `src/lib/i18n.ts` (zh-TW + EN), keeping the
  hardcoded-strings test green.

## Export

- Extend `buildCopyText` to append `Summary:` and brief sections when an
  analysis is ready.
- Add a Markdown export for Page/Web sessions honoring
  `markdownDownloadMode`, containing: title, URL, extraction status, summary,
  brief sections, and source links. Reuse the existing download conventions
  (no `downloads` permission).
- Session-only stands: export is user-initiated output, not persistence.

## Explicit Non-Goals For This Slice

- No streaming output, no partial rendering.
- No durable history (maintainer decision).
- No `"overview"` user action; overview stays an `allowedUse` consequence.
- No zhtw evidence in the page prompt (zh-TW output still gets deterministic
  output review; prompt-level zhtw evidence can be a later slice).
- No screenshots or image payloads; `allowScreenshot` stays `false`.
- No changes to Facebook reading-brief paths.

## Tests

Contract (`tests/contract/general-page-analysis-contract.test.ts`):

- schema parse/normalize round-trip, including rejection of wrong
  `schemaVersion` and non-JSON content;
- overview guard strips `claims` when `allowedUse === "page_overview_only"`;
- eligibility gate truth table over `modelEligible × allowedUse × provider`;
- selection-target prompt contains the selection text and
  `targetKind: selection`, and does not contain the full page text;
- chat body shape (json_object, temperature 0, bounded max_tokens).

Unit:

- runtime state transitions (idle → running → ready/error, stale drop,
  re-read invalidation) in `page-reading-runtime.test.ts` style;
- copy/markdown export includes summary and brief;
- i18n keys exist for all new strings.

## CDP Audit Additions (`scripts/audit-general-page-reader.mjs`)

Run against a local mock OpenAI-compatible endpoint started by the audit
script (pattern: the mock in `tests/unit/openai-api-key-mock.test.ts`), which
records request payloads:

- clean article page: analysis auto-runs, summary and brief render, status
  reaches a "已產生" state;
- noisy fallback page (`page_overview_only`): a request is sent with the
  overview variant, and **no claims section renders**;
- `requires_user_target` page: the mock endpoint receives **no** analysis
  request;
- selection flow: after `使用我選取的文字`, the recorded payload contains the
  selection text and `targetKind: selection`, not the whole page text;
- meaningful navigation mid-flight: late result is not rendered into the new
  page's session;
- copy output contains the summary;
- `chrome.storage` contains no analysis content after the run.

Existing checks (Reading context, candidate block recovery, stale scrubbing,
no-grant guidance) must keep passing.

## Verification Gates

Per repo convention:

```bash
npm run check:type
npm run test:contract:public
npm run test:unit:public
npm run check:public
TRULY_EXTENSION_ID=... TRULY_AUDIT_AUTO_RELOAD=1 npm run audit:general-page-reader
```

Add the new contract/unit files to `test:contract:public` /
`test:unit:public` script lists in `package.json`.

## Implementation Order

1. `general-page-analysis.ts`: schema, parse/normalize, overview guard,
   eligibility gate (pure functions + contract tests).
2. `tier-b-client.ts`: system prompts, chat body builder,
   `callTierBGeneralPageBrief`.
3. Messages + service-worker handler.
4. Side panel runtime + rendering + i18n.
5. Copy/Markdown export.
6. Audit script mock endpoint + new checks.
7. Update `general-page-reader.md` Slice 4 status when done.
