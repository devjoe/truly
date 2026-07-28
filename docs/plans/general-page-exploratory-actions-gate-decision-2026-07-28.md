# General Page Exploratory Actions Gate Decision — 2026-07-28

## User decision

Keep the current Page-only news and general-web product scope. Preserve the
strict treatment of strong news actions, but permit a lower utility threshold
for general-web material. Complete, publicly checkable reference, API,
workflow, and central record facts that were previously optional may be shown
when they remain useful enough for a reader to investigate. Show a low-key
warning so the user can review these lower-confidence results. Change the
product surface and scope semantics before relaxing any metric.

“Low confidence” here means uncertainty about the value of spending time on
the investigation. It is not a probability that the proposition is false.

## Adversarial review

The complete three-branch decision report is:

`tmp/grill-reports/general-page-exploratory-actions-2026-07-28.html`

The review resolved three dependent questions:

1. A primary/exploratory distinction is necessary, but Admission should not own
   it. Admission sees one selected span and bounded nearby context, while
   Selector sees the Page-wide candidate set.
2. Selector v7 therefore returns the one exact local candidate ID plus a
   strictly coupled `primary` or `exploratory` presentation tier. Binary
   Admission remains the final proposition-shape and hard-boundary veto.
3. A warning cannot rehabilitate filler. Release review adds a distinct
   `reviewable_exploratory` class while retaining zero tolerance for
   `user_unacceptable`, hard-unacceptable, scope, grounding, residue, stale,
   private, unsafe, or tier-overstated output.

Forced binary for every decision: **accept over reject**.

Final route:

- Decision 1: **new alternative** — move utility tier ownership from Admission
  to Selector.
- Decision 2: **accept as written** — Selector v7 plus binary Admission.
- Decision 3: **accept with modifications** — add the full tier-confusion
  matrix so an all-exploratory Selector cannot evade primary recall.

## Adopted runtime contract

Selector returns only:

```json
{"schemaVersion":7,"candidateId":"span:4","presentationTier":"primary"}
```

Null ID and null tier are coupled; a selected ID requires one valid tier.
Malformed coupling fails closed. Selector prefers primary and may return
exploratory only when no primary candidate exists.

Admission remains:

```json
{"schemaVersion":1,"decision":"admit"}
```

Admission may reject private, subjective-only, unsafe, structurally incomplete,
not publicly decidable, or residue-derived text. It does not reject a complete
ordinary reference or workflow fact merely because its utility is lower. It
cannot change the Selector tier.

Local code owns the exact displayed source text, warning, evidence direction,
copy action, Gemini handoff, source metadata, identity checks, and atomic
presentation. There is no third model call, local semantic tier classifier,
repair, rewrite, or provider-specific runtime branch.

## Adopted visual contract

Primary keeps the normal compact action row. Exploratory uses the same row and
adds a quiet, always-visible localized cue. The cue states that the item's
verification value is less certain and invites user judgment. It must not look
like an error, imply likely falsehood, or create a separate card.

## Adopted release contract

Source-only labels:

- `expectedPrimaryAction`
- `expectedExploratoryAction`
- `expectedNone`

Output-review tiers:

- `recommended`
- `acceptable_secondary`
- `reviewable_exploratory`
- `user_unacceptable`

Deterministic recovery:

- expected primary requires an accepted displayed `primary`;
- an expected-primary row displayed as exploratory is understatement and does
  not recover primary recall;
- expected exploratory requires an accepted displayed `exploratory` plus the
  localized cue;
- exploratory displayed as primary is zero-tolerance overstatement;
- expected none must remain absent;
- warnings never excuse unacceptable output.

Gate B keeps 30 news and 30 general-web runtime envelopes. News primary recall
remains at least 80%. General primary recall is at least 70%, and general
exploratory recall is at least 60%. The old suppressive selector remains an A/B
reference only for expected-primary rows. Gate C uses a fresh untouched
15-news plus 15-general holdout with explicit primary, exploratory, and none
denominators. Every safety, privacy, authorization, exact-span, same-Page
residue, handoff, and warning-consistency requirement remains hard.

No previous Gate A, B, or C result can authorize this product contract. The
prompt, schema, renderer, rubric, and thresholds define a new candidate and
require fresh evidence.

## Gate A capability tolerance follow-up

The first frozen v7 synthetic attempts passed primary, expected-none, protocol,
grounding, Admission, localization, and action-visibility controls. One
Traditional Chinese public-library workflow control was intermittently
promoted to `primary`, while the equivalent English control was
`exploratory`.

A second three-branch adversarial review accepted this bounded Gate A
provider-capability tolerance:

- all 8 exploratory controls must still produce a visible admitted action;
- at least 7/8 must carry `presentationTier=exploratory`;
- each language must achieve at least 3/4;
- the only permitted miss is promotion of that same usable control to
  `primary`;
- across all six formal composed receipts, misses may involve at most one
  preregistered fixture identity.

The validated decision report is:

`tmp/grill-reports/general-page-exploratory-gate-a-tolerance-2026-07-28.html`

This does not authorize release-tier ambiguity. Fresh real-data Gate B and
untouched Gate C retain zero exploratory-to-primary overstatement and require
the localized exploratory cue on every displayed exploratory action.
