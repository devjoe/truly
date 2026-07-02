# General Page Parser Advisor Plan

Truly's General Page Reader should not treat deterministic DOM parsing as the
only recovery path. Because Truly can connect to user-selected language models,
weak parser results can eventually escalate to a short-output model advisor.
This document defines the first, non-runtime slice of that direction.

## Current Boundary

The committed implementation is policy-first and non-runtime:

- No extension runtime model call is added.
- No screenshot or viewport capture path is added.
- No third-party parser is promoted into runtime.
- No real URL, copied page text, screenshot, or private review artifact is
  committed.
- The public contract is a short JSON advisor schema plus deterministic offline
  evaluation over synthetic fixtures.

The goal is to make parser recovery reviewable before implementing provider
calls. Product decisions from the July 2 grill-me session are now encoded as
contract-level policy below.

## Recovery Stack

The intended stack is layered and fail-closed:

1. Deterministic extractor builds `ReadingSurface`.
2. Model context maps extraction diagnostics into `modelReadiness` and
   `qualityIssues`.
3. Parser recovery policy decides whether an advisor would be useful and what
   decisions are allowed.
4. Parser advisor returns short JSON only.
5. Runtime integration may use the advisor automatically only inside a
   user-initiated `read page` action.
6. Screenshot recovery is suggested by the advisor but defaults to user
   confirmation unless the user explicitly enables automatic screenshot
   permission for this flow.

The policy consumes existing diagnostics rather than inventing a parallel
vocabulary: fallback extraction, partial extraction, large navigation noise,
missing main content, dynamic partial content, short text, and login/paywall
signals.


## Product Decisions

These decisions are now part of the contract layer:

- **Trigger:** After the user presses `讀取此頁`, Parser Advisor may run
  automatically as part of that user-initiated task. It must not run for passive
  browsing, background tabs, or URL changes without a fresh user action or a
  future explicit auto-update setting.
- **Provider lane:** General Page Advisor is an independent product lane named
  `general-page-advisor`, but it should preferentially reuse the Tier B provider
  connection settings. It must not reuse Facebook Tier A prompt semantics or
  cache schema.
- **Payload:** The advisor request uses a measured recovery packet. Short page
  text may be sent in full; long text is clipped by a payload budget. The
  current contract records estimated payload size, full-text threshold, max
  candidate blocks, and whether the payload is within budget.
- **Effective context:** Deterministic `ReadingSurface` is preserved. Advisor
  output may create `effectiveModelContext`, which is what later model calls or
  UI should treat as the usable reading context. The user-facing label is
  `Reading context`.
- **Index/list/feed pages:** These are not single articles. They may support
  page overview, but article-grade tasks such as summary, claim extraction, or
  fact-checking require a selected target, card, paragraph, or current region.
- **Screenshot:** `request_screenshot_region` is a valid advisor decision only
  when the caller allows it. Runtime screenshot sending defaults to confirmation;
  an advanced user setting may authorize automatic screenshot use within the
  same user-initiated read flow.
- **Persistence:** Advisor result state is session-only. Do not persist raw
  model payloads, screenshots, full page text, or advisor history to local
  storage by default.

## Advisor Output

The advisor must return JSON only. The current contract lives in
`src/lib/general-page-parser-advisor.ts` and allows these decisions:

- `accept_current`: the current extraction is good enough.
- `prefer_candidate_block`: a named candidate block is probably the better body.
- `downgrade_to_index_or_feed`: do not treat the page as one clean article.
- `mark_blocked_or_empty`: keep the result fail-closed.
- `request_user_selection`: ask the user for an explicit text/region target.
- `request_screenshot_region`: reserved for a future visual-grounding decision.

Screenshot recovery is intentionally opt-in at the policy level. The default
advisor request does not allow `request_screenshot_region`.

## Spike Runner

`npm run spike:general-page-parser-advisor` evaluates the offline rule baseline
against the public synthetic corpus and writes a private tmp report under
`tmp/parser-advisor-spikes/`.

This spike does not claim model quality. It verifies that the recovery policy
has the right shape before model-provider integration:

- list/index fixtures should downgrade rather than become model-ready articles;
- blocked/paywall fixtures should stay fail-closed;
- content fixtures should remain usable or request a user-selected target when
  the text is too short;
- documentation and normal article fixtures should not be downgraded because of
  dense links alone.

## Remaining Runtime Work

The contract still does not implement provider calls. The next runtime design
needs to specify:

- how to map the independent `general-page-advisor` lane onto Tier B provider
  settings in service-worker or side-panel runtime code;
- how to measure real prompt size, latency, and cost on the private 200-page
  corpus before finalizing payload thresholds;
- how to represent `effectiveModelContext` in side-panel state without
  overwriting the deterministic `ReadingSurface`;
- how the side panel lets the user confirm screenshot use, select a target, or
  inspect advisor uncertainty;
- whether page-overview actions need a new `targetKind` value before runtime
  model calls are enabled.
