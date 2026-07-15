# ADR 0003: Compile source-aware acquisition from proof responsibilities

- Status: accepted for development evaluation
- Date: 2026-07-15
- Scope: non-runtime Claim Investigation acquisition candidate

## Context

Discovery Planner v2 separated search from proof and produced grounded route
plans, but its one-query open-web candidate did not beat the atomic baseline on
the frozen development cohort. Naming an authority in a query is not the same
as knowing which registry, official index, filing system or source family can
answer a verification question.

## Decision

1. Every mandatory proof obligation compiles into a question-specific
   `SourceResponsibility`. Canonical answers, first-party answers, independent
   corroboration and counterevidence remain distinct responsibilities even when
   they belong to the same verification question.
2. A `TrustedLocatorCatalog` is the only path that may upgrade a route from
   open-web fallback to a registry, authoritative domain index or direct URL.
   Catalog entries require human-reviewed provenance, a review timestamp and a
   source reference. Model output cannot add trusted domains or registries.
3. Catalog matching requires an exact normalized authority name already present
   in the case, compatible language and jurisdiction, compatible document kind,
   and the source family required by the responsibility.
4. Query portfolios are selected per responsibility from grounded case targets.
   Independent-origin responsibilities prefer independent-report targets and
   never reuse an official registry as proof of independent corroboration.
5. Missing or mismatched catalog coverage fails closed to an explicitly marked
   open-web fallback. The planner does not guess an authority domain.
6. The plan and its routes remain discovery artifacts with
   `evidenceProduced=false` and `verdictProduced=false`. Evidence admission,
   proof certificates and findings retain their existing boundaries.
7. This candidate remains outside extension runtime and UI. Private-derived
   queries are not sent to public search services by the evaluation workflow.

## Evaluation boundary

- Use a newly preregistered forward-development cohort that excludes all prior
  v1 dev, v1 holdout, v2 holdout and Investigation Planner v2 rows.
- The first forward slice provided 16 Facebook rows and no unused news rows.
  A later, separately preregistered news-only slice closed that surface gap
  without reusing either holdout.
- Synthetic local fixtures may verify registry/domain execution semantics, but
  cannot establish real-world acquisition lift.
- Do not open another holdout or expose a product action until a safe local or
  user-mediated matched acquisition audit passes a frozen gate.

## Consequences

The system can now explain whether a route is based on a reviewed locator or is
still generic open-web discovery. This makes missing infrastructure visible and
prevents model confidence from masquerading as source knowledge. The cost is a
reviewed catalog lifecycle and separate cross-surface acquisition evidence.

## Development evaluation update (2026-07-15)

A human-reviewed Taiwan public-authority catalog and a query-free, frozen HTML
snapshot were created before model output was inspected. A fresh 12-row news
slice then produced 11 valid claim plans, 10 valid Investigation Case plans,
and five matched catalog routes across three cases. One claim plan and one case
plan failed the preregistered zero-invalid gate.

The matched audit gave baseline and candidate the same frozen 23-document pool,
one local query and at most two documents per arm. The candidate could restrict
its pool to the reviewed authority; no private-derived query left the process.
Automated passage selection returned eight candidates per arm. Single-reviewer
answerability review rejected all of them: the baseline contained unrelated
numeric matches, while the candidate reached the correct authority index but
not a passage that answered the claim. There were zero candidate-only answer
rescues and zero false closures.

This result keeps the ADR accepted as an architectural boundary, but fails the
candidate's development promotion gate. The next candidate must deepen
authority-local acquisition from index pages to dated announcements, records,
datasets or PDFs. It must not widen the reviewed catalog, relax passage
admission, open a holdout or enable a product action merely because authority
routing improved.
