# ADR 0002: Separate discovery from proof

- Status: accepted for development evaluation
- Date: 2026-07-15
- Scope: General Page Reader claim investigation contracts only

## Context

Small, precise verification questions are useful for proof, but poor search
queries. Search must recover documents using entities, aliases, institutions,
time and jurisdiction, while proof must remain bound to the exact proposition.
Conflating the two creates two unsafe shortcuts: treating a good query as an
answer, or treating search exhaustion as evidence that a claim is false.

## Decision

1. `InvestigationCase` owns a separate `DiscoveryContext` alongside the event
   frame and verification requirements. Discovery terms may locate documents;
   they never satisfy a proof obligation.
2. Acquisition is planned as an obligation-driven `SourceFamilyPlan`. Every
   mandatory obligation has a bounded non-fallback route. Canonical-record
   obligations require a canonical route; independent-origin obligations
   require lineage-diverse routes. Contextual routes are optional.
3. No case is forced to use all route families. A plan may use at most three
   families, with explicit fallback relationships and budgets.
4. Every executed route produces an acquisition receipt. A receipt records the
   attempted scope, covered source families and remaining blind spots, and is
   permanently marked `evidenceProduced: false` and `verdictProduced: false`.
5. Only immutable fetched artifacts with exact answer spans can become proof
   witnesses. Search snippets, result titles, route hypotheses and receipts are
   not evidence.
6. Independent-origin proof is counted by lineage, not by URL, host or number of
   excerpts. Multiple exact spans from the same lineage may jointly cover one
   proposition; syndicated, translated or quoted derivatives still count as the
   same origin. Every counted lineage must independently cover every required
   facet, including modifiers, quantities, time and attribution.
7. Missing facets, ambiguous lineage, conflicting relations or insufficient
   independent origins fail closed. The compiler withholds a certificate; it
   does not infer a verdict.
8. This slice remains model-, transport- and UI-neutral. It adds no runtime
   action, verdict, page-content persistence or analysis history.

## Evaluation boundary

- Planner development uses only the frozen 30-row private development split.
- Cohort and selection rules are preregistered before inspecting Planner v2
  output.
- A matched paired audit uses the same cases, budgets and Proof Compiler for
  baseline and candidate routes.
- Raw inputs, URLs, queries, documents and per-sample outputs stay under the
  gitignored private-data boundary. Only anonymous aggregates may be tracked.
- Holdout data remains unopened until a candidate and gate are frozen.

## Consequences

Discovery may improve recall without weakening proof. The cost is more explicit
contracts: discovery context, source-family plans, lineage graphs, route
receipts and proof certificates must be validated independently. A completed
search can legitimately end in `insufficient_evidence`; that is a safe product
state, not a failed investigation and not a negative verdict.
