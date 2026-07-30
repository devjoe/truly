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

## Executable boundary

The aggregate contract lives in
`scripts/lib/general-page-investigation-layered-gate.mjs` and is covered by
`tests/unit/general-page-investigation-layered-gate.test.mjs`. A fresh Gate A,
fresh preregistered Gate B, and untouched Gate C are still required; this
decision does not retroactively rescue any failed or consumed cohort.
