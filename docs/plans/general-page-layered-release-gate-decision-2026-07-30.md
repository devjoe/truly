# General Page layered release gate decision — 2026-07-30

Status: accepted successor contract for candidates frozen after this decision.

This record preserves the product decision produced by the required
`grill-your-sub-agents` accept, reject, and better-alternative review. The
24-row `gpr-ranked-actions-compact-prompt-dev-v47` slice was visible during the
review, so it remains consumed development evidence and cannot become Gate B.

## Decisions

### D1 — primary and exploratory presentation

Accepted with modifications:

- remove the visible `Priority` / `優先` badge;
- show a primary action as an ordinary original-claim row;
- retain a persistent localized lower-confidence cue on exploratory actions;
- keep original text, source identity, and model attribution visible.

Reason: tier is a presentation confidence cue, not a truth verdict or a second
semantic identity.

### D2 — tier-overstatement gate

Rejected as originally proposed. Relaxing the old zero-tolerance tier metric
without changing runtime ordering would preserve a hidden primary preference:
a later primary result could replace an earlier, more useful exploratory
result.

Better option adopted: measure acceptable reader utility and cue coverage
separately after tier stops changing selected identity.

### D3 — existing runtime ordering

Rejected as originally proposed. The existing schema may remain, but the old
primary-first publication policy cannot remain while tier is described as
presentation-only.

Better option adopted: the model ranks all eligible supplied IDs strongest
first, regardless of tier. Local code publishes the first returned candidate
that survives hard structural boundaries.

### D4 — layered Gate B and Gate C

Accepted with modifications:

- zero hard-unacceptable and user-unacceptable displayed actions;
- zero visible action on expected-none sources;
- 100% exact grounding and scope fidelity;
- zero stale, cross-scope, or residue-derived output;
- at most one atomic action with a complete local handoff;
- acceptable-action coverage of at least 80% on actionable news and 60% on
  actionable general-web sources;
- visible exploratory cue on at least 60% of exploratory-only sources;
- tier overstatement remains a confusion-matrix diagnostic rather than an
  independent zero-tolerance gate;
- blind non-regression, provider compatibility, and service-profile gates stay
  independent.

The denominator is the full authorized source context, not the candidate set.
Gate B remains 30 news plus 30 general-web rows and must be sealed before model
output is revealed, with at least 20 actionable news, 15 actionable general,
9 exploratory-only, 5 expected-none news, and 5 expected-none general rows.

### D5 — minimal implementation

Accepted with modifications:

- one model call returns zero to three known IDs in strongest-first order with
  `primary` or `exploratory`;
- local code scans that order once and publishes the first hard-boundary
  survivor;
- tier controls only the visible cue;
- local exact text, offsets, scope, source metadata, handoff generation,
  session identity, and stale-result suppression remain deterministic;
- no local semantic classifier, second ranker, repair request, or additional
  model call is added.

The full returned order is a development diagnostic. The actual rendered first
action and handoff remain subject to blind reference non-regression review.

### D6 — attributed stable propositions

Accepted with narrow safeguards after the first `7a47c40` Gate A receipt
produced one exploratory abstention:

- preserve the original `synthetic-zh-05` text, expectation, and unchanged
  8-of-8 exploratory-visibility threshold;
- clarify that an introductory attribution is not a pointer when the same
  exact span states a complete, standalone technical definition, behavior,
  workflow, or capability;
- continue rejecting text that only says what a document discusses or
  introduces, redirects the reader, uses unnamed hearsay, or relies on nearby
  text to repair its subject or payload;
- add no local semantic classifier, repair request, or extra model call;
- permanently reject the failed receipt and rerun the complete six-receipt
  Gate A on a new clean commit.

The rejected alternative was to rewrite the positive fixture after seeing the
failure. A larger 32-row synthetic contract with new matched negatives remains
available if the existing hard sentinels and fresh Gate B do not falsify the
narrow clarification; it is not required by this decision.

## Executable boundary

The aggregate contract lives in
`scripts/lib/general-page-investigation-layered-gate.mjs` and is covered by
`tests/unit/general-page-investigation-layered-gate.test.mjs`. A fresh Gate A,
fresh preregistered Gate B, and untouched Gate C are still required; this
decision does not retroactively rescue any failed or consumed cohort.

## Final v57 audit outcome — 2026-08-01

Candidate `f2a3007` was the final automatic Page ranked-action candidate in
this development sequence. It passed the six-receipt Gate A provider
compatibility ceremony and the deterministic portion of a fresh, sealed
60-row Gate B:

- news expected-primary recovery: 24/24;
- general-web expected-primary recovery: 21/25;
- exploratory cue recovery: 11/16;
- expected-none leaks, grounding failures, and scope failures: zero.

The independent semantic output review did not pass. Two blinded reviewers
reviewed all 45 displayed actions, and a distinct adjudicator resolved their
24 disagreements. The final review found six `user_unacceptable` actions,
including two `hard_unacceptable` actions, four actions derived from
same-page residue, and two unusable handoffs. Failure classes included
timestamp/byline text fused into a proposition, a contextless parenthetical,
document-header metadata, table-of-contents/caption fusion, and concatenated
parameter descriptions.

The candidate therefore failed Gate B. Blind selector comparison was not
opened, and the untouched Gate C holdout was not consumed. Automatic Page
ranked actions are not release-approved by this branch. This conclusion does
not revoke the separately verified General Page Reader core; shipping the core
without automatic ranked actions is a separate product-scope decision.

Canonical row-level evidence remains in the private evaluation repository.
This public record intentionally contains only aggregate counts and failure
classes.
