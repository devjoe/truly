# ADR 0004: Keep authority-local discovery query-free and capability-bounded

- Status: accepted architecture; development candidate not promoted
- Date: 2026-07-15
- Scope: non-runtime Claim Investigation discovery and evaluation

## Context

ADR 0003 introduced reviewed locator catalogs, but the first shallow local
snapshot reached authority indexes rather than the dated announcement, record,
dataset or PDF needed to answer a verification question. A later candidate had
to test deeper authority-local traversal without leaking private-derived search
queries, hard-coding one agency into the domain model, or treating a generic
crawl failure as evidence that a record does not exist.

Chrome Extension and future native App execution also have different
capabilities. A development process may use direct HTTP, rendered browser pages
or local files; an MV3 extension is constrained by host permissions, service
worker lifetime and browser fetch behavior; a native companion may support
durable jobs and local indexing. Those differences should not change the
Investigation contract or proof standard.

## Decision

1. Authority-local discovery receives only reviewed public seed URLs, a
   bounded traversal budget and executor capabilities. It does not receive the
   private claim, model-generated query or page text.
2. The generic executor follows and ranks same-authority links by structural
   document signals. Agency-specific seeds, domains and known index shapes are
   data in a reviewed profile, not branches in the executor.
3. Every run emits a receipt with executor kind, budgets, observed counts,
   stop reason and safety flags. `queryUsed` and
   `privateDerivedQuerySentExternally` must remain false.
4. Discovery produces neither evidence nor a verdict. A fetched document is a
   candidate source until a later question-specific passage is admitted.
5. A bounded generic crawl can never prove absence. Stop reasons such as page,
   depth or byte exhaustion must remain visible and
   `absenceInferenceAllowed=false`.
6. Capability adapters are explicit:
   - Node development may fetch bounded HTML, text and PDF documents directly.
   - Rendered-page development may use background CDP targets without bringing
     a page to the foreground.
   - Browser Extension execution must remain permission-aware and ephemeral.
   - A future native companion may add durable queues or local indexes, but
     must preserve the same receipts, consent and proof boundary.
7. Claim selection is separated from plan generation. A constrained selector
   may choose only an exact, locally enumerated, non-compound source span. The
   second-stage planner cannot rewrite that span.
8. Model syntax success is not promotion. Claim planning, Investigation Case
   materialization, authority matching and answer admission have independent
   gates.

## Development evidence

A frozen, query-free snapshot collected 138 public documents across six
domains using three reviewed authority profiles. Direct and rendered
capability adapters found dated announcements and record-detail pages while
keeping external private-query count, evidence production and verdict
production at zero.

A separately preregistered sequential development pool then evaluated 48 fresh
news rows in four batches. Raw inputs, URLs, model outputs, snapshots and
per-trial reviews remain in the private repository; only anonymous aggregates
are reported here.

- The exact-span claim planner passed: 47/48 valid and materialized plans.
- Investigation Case materialization failed its gate: 36/47 (76.6%, required
  90%).
- Source-aware planning produced 11 matched routes across six cases, below the
  required 12 matched cases.
- Under equal budgets, baseline and candidate each produced 12 automated
  passage candidates across 11 paired trials.
- Two independent reviewers agreed on every trial: each arm had one answerable
  admission, with zero candidate-only rescues and zero net lift.
- Review found two wrong-authority matches. External queries and false closure
  remained zero.

The candidate therefore fails the development promotion gate. Because Case
compilation and authority coverage reduced the audit to six matched cases and
two reviewed agencies, the equal-budget result does not isolate traversal
efficacy by itself. No confirmatory slice or holdout is opened, and no
Extension UI or product action is authorized.

## Consequences

The query-free executor, profiles, receipts and capability boundary are kept:
they are useful infrastructure and passed their safety tests. The evaluated
candidate is not promoted as product-quality evidence, and the traversal
strategy is not described as independently disproven.

The next candidate must use a new preregistered development slice and advance
through separate stage gates:

1. compile a valid Investigation Case without asking the model to reproduce
   redundant identifiers or unsafe discovery-query forms; downstream routing
   is not scored until the Case materialization gate passes;
2. match the authority from question-specific responsibility and jurisdiction,
   not entity overlap alone; downstream answer rescue is not scored until the
   frozen minimum of 12 matched cases and four reviewed agencies is reached;
3. acquire the canonical dated document or record and admit an exact answering
   passage before any sufficiency statement, then compare equal budgets.

The closed 48-row pool may be used for regression tests and postmortem analysis,
but not for further prompt tuning or candidate selection.
