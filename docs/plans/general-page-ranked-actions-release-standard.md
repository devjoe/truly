# General Page Ranked Actions Release Standard

Status: frozen single-recommendation runtime-envelope candidate standard, revised 2026-07-21

This standard governs the General Page Reader's user-facing `待確認事項` /
`Check these items` actions. It replaces the previous policy in which a local
semantic guard tried to decide which topics were important enough to expose.
It does not authorize release by itself.

## Product contract

The selector receives a bounded list of exact spans produced locally from the
current Page or Focus text. In one model call it returns only:

```json
{"schemaVersion":5,"candidateId":"span:4"}
```

`candidateId` is the single recommendation; `null` is abstention. Local code
owns the exact displayed text, copy action, localized Gemini handoff, source
metadata, and Page/Focus session boundary. There is no repair call, second
ranker, model-authored query, evidence-family guess, or local semantic rewrite.

The selected action is the product recommendation. The UI reveals it only
after the one-shot selector settles; abstention reveals no investigation
action. This intentionally avoids publishing weaker alternatives merely to
increase visible coverage.

Entertainment, sport, consumer, product, celebrity, and routine factual
statements are eligible. Health, safety, money, rights, law, and public impact
may raise priority, but none is a prerequisite. The selector ranks usefulness
relative to the current page; it does not fill a quota.

## Hard rejection boundary

Local code rejects only failures a user should not receive:

- malformed, truncated, unknown, duplicate, or over-limit IDs;
- text that is not an exact span of the authorized Page or Focus scope;
- unsafe instructions, private-data requests, or prompt/data leakage;
- an incomplete span that cannot identify what is being checked;
- stale or cross-scope results, overview-only output, unconfirmed screenshots,
  or content/history persistence outside the existing ephemeral session.

Topic importance, public-interest consequence, preferred evidence family, and
stylistic atomicity are ranking signals, not local rejection reasons. The
model may return no actions rather than choose the best of a bad candidate set.
The one-ID wire also removes duplicate and ordering ambiguity without relying
on provider-specific JSON Schema features.

## Frozen release gates

Every receipt must bind the candidate commit, tracked diff, prompt hash,
schema hash, parser hash, endpoint, model, provider lowering, build ID,
extractor hash, advisor/context hash, and candidate-builder hash.
Semantic labels require two independent source-only reviewers and adjudication
of disagreements. A candidate is frozen between the development and holdout
gates. Any prompt, schema, renderer, hard boundary, metric definition, or
threshold change creates a new candidate; changing this standard requires a
new `grill-your-sub-agents` decision record.

The 2026-07-21 decision review retains three explicit reviewer tiers so the
single selected action can be distinguished from a merely tolerable but weak
recommendation:

- `recommended`: strong enough to lead the reader's action list;
- `acceptable_secondary`: exact, self-contained, externally checkable, and
  potentially useful, but not strong enough to be the sole visible
  recommendation;
- `user_unacceptable`: confusing, filler-like, redundant, materially
  contextless, not externally resolvable, misleading, or otherwise unsuitable
  to show as a reader action.

`hard_unacceptable` remains an independent strict subset for unsafe, private,
leaking, ungrounded, stale, or cross-scope output. No runtime regex tries to
reproduce the reviewer tiers. They are release measurements of model ranking
and visible product quality.

### A. Synthetic provider compatibility

Run the fixed 30-case bilingual suite three times with `json_schema` and three
times with `json_object` (180 one-shot calls total).

This gate tests provider transport plus unambiguous hard semantic boundaries.
A negative control must contain no reasonably actionable exact span: subjective
or promotional judgment, an unidentifiable vague statement, or another clear
abstention case. A page that mixes low-value but independently verifiable facts
with promotional language is not a whole-page hard negative. Whether those
facts deserve an action is measured by the fresh real-data precision and
top-rank gates below.

Required for every run:

- 30/30 protocol-valid outputs;
- an exact known ID or null, with at most one action;
- every positive control selected and every negative control abstained;
- no hard-boundary leak, repair, retry, public search, or opened action;
- deterministic localized Gemini handoff generated from local data.

### B. Fresh runtime-envelope development audit

Preregister a new 60-row private development slice at the production
`GENERAL_PAGE_ANALYSIS_REQUEST` boundary: 30 Page and 30 Focus rows,
source-diverse, not used by earlier candidate tuning. Page rows use the final
effective context produced by the bound extraction and parser-advisor build.
Focus rows use the exact authorized selection text. At least 15 Focus rows
must originate on Facebook and at least 15 on non-Facebook web pages. Page
rows include at least 15 news/article pages and at least 15 non-news general
web pages.

Whole Facebook feed-card text, raw `document.body.innerText`, link-preview
mixtures, unpruned related/recirculation rails, screenshots,
`page_overview_only`, stale/cross-scope state, and rows for which the selector
would not be scheduled are not eligible selector inputs. Every exclusion is
reported by reason; a reachable shipping extraction or advisor error is not
an exclusion and fails the separate scope-fidelity requirement.

Before revealing model output, each row binds its Page/Focus authorized-scope
hash, final `mainText` hash and length, target kind, allowed use, extraction
method/status/warnings, source platform/domain, candidate-set hash and count,
candidate commit/build, and the extractor/advisor/context/candidate-builder
hashes. Review eligibility only from that exact runtime-visible envelope.

Required:

- zero hard-unacceptable actions;
- zero `user_unacceptable` displayed actions;
- 100% scope fidelity: the bound effective context is the authorized Page body
  or Focus target that the shipping runtime was allowed to analyze;
- at least 85% of returned first actions are `recommended` overall and at
  least 80% in Page and Focus separately, with at least ten returned first
  actions in each scope;
- at least 75% recall of positive rows overall and at least 65% in Page and
  Focus separately;
- the first action is best or tied-best on at least 75% of rows with any
  reviewer-acceptable action; this denominator excludes abstentions instead of
  counting recall failure twice;
- 100% exact-span and at-most-one compliance;
- at least 95% of generated Gemini handoffs are usable and language-consistent;
- no public search or external action is opened by the audit.

Report every denominator. A scope metric is invalid when its denominator is
smaller than ten. Platform, language, content category, extraction method, and
readiness are diagnostic slices and do not receive lower thresholds. This gate
is development evidence, not a holdout.

### C. Fresh untouched holdout

After B passes and the candidate is frozen, preregister a new 30-row private
holdout at the same request boundary: 15 Page and 15 Focus rows. At least 8
Focus rows originate on Facebook; Page remains source-diverse across news and
non-news general web. Do not inspect or tune on it before the run.

Required:

- zero hard-unacceptable actions;
- zero `user_unacceptable` displayed actions;
- 100% scope fidelity;
- at least 85% of returned first actions are `recommended` overall and at
  least 75% in Page and Focus separately, with at least eight returned first
  actions in each scope;
- at least 70% positive-row recall overall and at least 60% in Page and Focus
  separately;
- first action best or tied-best on at least 70% of eligible rows;
- 100% exact-span and at-most-one compliance;
- at least 95% usable, language-consistent Gemini handoffs.

Any failure rejects the candidate. The holdout cannot be reused for tuning.

### Mixed-role source contamination observatory

Raw acquisition text remains useful for measuring attraction to secondary
source roles, but it is not a release-gate proxy. The consumed Facebook-card
and whole-body news cohort remains immutable and reports protocol validity,
selection and abstention rates, reviewer tiers, exact-span rate, candidate
counts, and selected-span provenance (`primary`, `shared_or_quoted`,
`link_preview`, `related_or_recirculation`, `navigation_or_interface`, or
`unknown`). It has no pass/fail threshold and cannot rescue or reject Gate B
or C.

If the observatory proves that the same contaminated input is reachable in the
shipping runtime, that is a scope-fidelity failure. If it motivates any prompt,
extractor, advisor, selector, or hard-boundary change, the change creates a new
candidate and requires a fresh runtime-envelope cohort. Raw text, row-level
reviews, and provenance labels remain private; only anonymous aggregates may
be committed publicly.

### D. Runtime and release readiness

On a clean development build, the focus-safe 430 px CDP audit must cover Page
and Focus continuity, preparing/ready/abstain/unavailable states, atomic batch
reveal, stale-result suppression, screenshot consent, and ephemeral-session
behavior. The derived selector must remain lower priority than primary reading
work, must not starve the Feed queue, and must settle or leave the bounded UI
state without exposing a partial result. Typecheck, focused GPR tests, full
verification, build freshness, privacy policy, and Chrome Web Store readiness
must all pass.

## Non-goals

This candidate does not perform its own web retrieval, verdict generation, or
automatic fact-check. `問 Gemini` remains a user-triggered handoff. Evidence
source-family routing belongs to a later retrieval system that can inspect
actual results; it is not guessed by this selector.

## Candidate history

The v4 primary-plus-secondary candidate failed its fresh development gate:
hard safety and news recall held, but recommendation precision, Facebook
recall, top-rank quality, and handoff usability did not. That consumed cohort
is sealed and is not used for row-level v5 tuning.

The adversarial decision at
`tmp/grill-reports/gpr-v5-single-action-contract-2026-07-21.html` accepted the
v5 single-recommendation wire as the next frozen candidate, not as a release.
The independent reject branch correctly noted that reducing cardinality alone
does not prove better ranking, so the numerical A-D gates above remain
unchanged and v5 must earn passage on fresh data.

The first v5 single-action development cohort also remains permanently
`failed_consumed`: it found zero hard-unacceptable actions but failed visible
recommendation quality, recall, and handoff requirements. A later pipeline
alignment audit established that its Facebook rows were whole feed-card text,
its news rows were whole document-body text, and its audit bypassed the
shipping extraction/advisor boundary. The adversarial decision recorded in
`tmp/grill-reports/gpr-runtime-envelope-gate-2026-07-21.html` therefore did not
reclassify that result or lower any threshold. It created the runtime-envelope
candidate standard above and retained the old data only as a non-gating
contamination observatory.

The first runtime-envelope Gate B run also failed and consumed its 60-row
development cohort. Its aggregate diagnosis found too many incomplete or
secondary-quality selections and weak Focus handoffs. The next candidate keeps
the schema-v5 one-ID wire and the frozen numeric gates, but simplifies the
upstream boundary: local enumeration now offers complete sentences or complete
list lines instead of manufacturing comma- or conjunction-split clauses, and
the selector uses one burden-of-proof eligibility pass followed by one best-item
comparison. This is candidate v6 behavior, not a release authorization; it must
pass fresh A-D evidence without reopening either consumed cohort.
