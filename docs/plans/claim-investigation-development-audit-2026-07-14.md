# Claim Investigation Development Audit — 2026-07-14

Status: development review complete; product-quality and fresh-holdout gates remain closed

## Outcome

The model-neutral Investigation contract, planner schema, three retrieval-route
shapes, evidence-first presentation model, and synthetic native-companion
protocol now exist as public-safe contracts and fixtures. None is wired as a
release investigation runtime.

The gx10 experiment confirms that constrained JSON schema is necessary but not
sufficient:

| Development run | Parse/contract result | Grounded plans | Correct abstentions | Main finding |
|---|---:|---:|---:|---|
| `json_object`, default thinking | 0/30 | 0 | 0 | 25 responses exhausted the budget in reasoning; 24 had no final content. |
| `json_object`, thinking disabled | 0/30 | 0 | 0 | All 30 produced JSON-like output, but all drifted from the nested contract or its enums. |
| constrained schema v1 | 15/30 | 0 | 15 | Syntax was stable; all attempted plans failed exact source grounding. |
| exact-span schema v2 | 23/30 | 8 | 15 | Exact-span descriptions recovered 8 grounded plans with no false-positive action against the existing dev labels. |
| question-axis schema v3 | 21/30 | 7 | 14 | Separating literal/contextual basis from question purpose restored 100% literal coverage, but plan coverage remained low. |
| atomic-span schema v4 | 28/30 | 13 | 15 | Exact atomic clause spans removed language-specific S/P/O brittleness and retained fail-closed grounding. |

The v4 aggregate was:

- eligibility precision: 100%;
- eligibility recall: 72.2%;
- literal-question coverage: 100%;
- query hygiene: 100%;
- primary-source lane coverage: 100%;
- counter-evidence lane coverage: 38.5%;
- retained plans by surface: 1 Facebook and 12 news in the original 15 + 15
  auto-selection subset.

The lexical `strictQueryGroundingRate` was 0% because it requires every atomic
subject, predicate, and object to appear verbatim in a search query. That is a
diagnostic upper bound, not a release gate: useful retrieval queries often omit
function words or use a source's official naming. Human answerability review
remains required.

## Contract Decisions From the Audit

1. `EvidenceSourceRole` and `EvidenceRelation` remain separate. A primary
   source can support, refute, or merely contextualize a proposition.
2. `EvidenceSufficiency` remains separate from `InvestigationFinding`.
   Search failure cannot silently become refutation.
3. Question `basis` (`literal` or `contextual`) is separate from `purpose`
   (`proposition`, identity, timeline, quantity, context, or counter-evidence).
   The previous single enum made a literal numeric question look non-literal.
4. Constrained grammar is a syntax boundary only. Exact source spans and
   proposition parts still pass through deterministic post-validation.
5. The UI presentation deduplicates shared-origin evidence before reporting
   independent-source counts and renders excerpts before sufficiency or a
   bounded synthesis.

## Private Evaluation Boundary

The 30 original inputs, per-sample model output, and draft manual worksheet are
kept under the private repository's gitignored `private-data/` tree. Tracked
private artifacts contain opaque sample IDs, manifests, rubric/tooling, and
anonymous aggregates only.

A separate retrieval-only development manifest contains six existing
human-labeled positive Facebook samples and six positive news samples. This is
allowed for route comparison because it does not measure claim detection. It
must not be reported as representative precision or recall.

On that preselected set, atomic-span v4 produced 11/12 grounded plans on the
first run. The bounded path produced 12/12: one row required one grounding-only
repair and then one deterministic human-atomic segmentation fallback. The
fallback replaced unstable model segmentation with the exact reviewed atomic
span; it did not change the selected claim, eligibility, or source text.

## Gates

| Gate | Result |
|---|---|
| Model-neutral domain validation | Pass |
| Constrained JSON syntax stability | Pass |
| Exact-span semantic grounding coverage | Improved: 13/30 retained in v4 |
| 30-sample human plan-quality review | Complete: 83.3% check-worthiness accuracy; 53.8% atomicity pass rate |
| 6 Facebook + 6 news grounded retrieval plans | Pass: 12/12, with one recorded fallback |
| Real three-route evidence retrieval | Complete: sufficient evidence 2/12 single, 5/12 decomposed, 3/12 authority/document-first |
| Evidence-first synthetic UI | Pass at 430 px; evidence precedes sufficiency and synthesis |
| Synthetic companion boundary | Pass for consent, capabilities, idempotency, resume status, cancel, delete, and bounded envelopes |
| New release candidate and fresh holdout | Correctly not created: atomicity and evidence-sufficiency gates failed |

## Next Candidate

The next development iteration should keep the atomic-span and question-axis
contracts. The runtime-neutral Investigation contract is now v2: each subject
contains exactly one proposition, with attribution, time, place, and quantity
modeled as attributes rather than additional proposition slots. Automatic
Facebook check-worthiness selection remains the main
coverage weakness; the retrieval-only preselected result must not be used to
hide it. First-response, repaired, and human-atomic-fallback results must remain
separate in every report.

The completed 6 + 6 route pilot compared:

1. one normalized-claim search;
2. decomposed question searches;
3. authority/document-first retrieval: identify the institution that can answer
   the atomic question, locate its announcement, report, dataset, or official
   record, then extract an exact answering passage.

No route may produce a finding from snippets alone. A fresh candidate and
independently labeled holdout remain forbidden. An inspectable, runtime-neutral
adaptive cascade now represents the recommended sequence rather than exposing
these routes as product alternatives: decompose first, locate the authority and
canonical document, fetch it, extract an exact passage, assess sufficiency, then
explicitly downgrade to an independent-secondary document path only when primary
evidence is unavailable or insufficient. The extension does not execute this
graph yet.
