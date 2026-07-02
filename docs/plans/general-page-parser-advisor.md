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

The goal is to make parser recovery reviewable before deciding provider UX,
privacy consent, screenshot behavior, or automatic escalation.

## Recovery Stack

The intended stack is layered and fail-closed:

1. Deterministic extractor builds `ReadingSurface`.
2. Model context maps extraction diagnostics into `modelReadiness` and
   `qualityIssues`.
3. Parser recovery policy decides whether an advisor would be useful and what
   decisions are allowed.
4. Parser advisor returns short JSON only.
5. Runtime integration, user confirmation, and screenshot recovery require later
   product decisions.

The policy consumes existing diagnostics rather than inventing a parallel
vocabulary: fallback extraction, partial extraction, large navigation noise,
missing main content, dynamic partial content, short text, and login/paywall
signals.

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

## Deferred Decisions

These still need product review before runtime integration:

- Should model-assisted parser recovery run automatically or only after the user
  presses an explicit action?
- Which provider lane should it use: Tier A-like compact classifier, Tier B
  structured JSON, or a dedicated General Page lane?
- When, if ever, may Truly send viewport or region screenshots to a model?
- Should an index/list page remain `modelEligible` with caution, or should the
  advisor block model use until the user picks a target?
- How should the side panel explain advisor uncertainty and let the user correct
  the selected block?
