# Ranked Actions Gate Decision — 2026-07-21

## Question

Should General Page Ranked Actions keep requiring every returned item to meet
one recommendation-quality threshold, or use a rank-first contract whose local
hard guard rejects only output users should never receive?

## Evidence

Two consumed, independently reviewed development cohorts produced no
hard-unacceptable action and acceptable positive-row recall, but repeatedly
missed the former all-action usefulness and ranking gates. The second cohort
reached 80% positive-row recall while all-action usefulness was 77.6% and the
first item was best or tied-best on 68% of positive rows. The untouched holdout
remained unopened.

The product contract already says returned order is ranking, permits up to
three actions, reveals the batch atomically, and reserves local rejection for
malformed, ungrounded, unsafe, incomplete, stale, cross-scope, or privacy-invalid
output. Treating every lower-ranked action as an equally strong recommendation
therefore mixed ranking quality with the hard boundary.

## Adversarial review

- Accept: rank-first measurement matches the documented product and the user's
  guard boundary.
- Reject: visible secondary actions are still clickable; without an auditable
  secondary quality rule, the change could merely rename noise as optional.
- Alternative: conceded to accept because max-one output, progressive reveal,
  or a second ranker would add a materially different product or architecture
  cost without resolving the core metric mismatch.

Forced binary: **accept over reject**.

Decision: **accept with modifications**.

## Adopted contract

Reviewers classify each displayed action as `recommended`,
`acceptable_secondary`, or `user_unacceptable`. Rank one carries the strict
recommendation threshold. Later actions may be useful alternatives rather than
equal-strength recommendations, but every one must remain exact,
self-contained, distinct, externally checkable, and handoff-usable. A
`user_unacceptable` or hard-unacceptable action still fails the candidate.

The UI gives rank one a quiet localized priority cue and preserves the agreed
atomic batch reveal. No second model call, semantic regex ranker, provider-only
schema feature, or progressive disclosure is introduced.

Consumed cohorts are diagnostic evidence only. The revised standard must be
preregistered and passed on a fresh development slice before the untouched
holdout may be opened.
