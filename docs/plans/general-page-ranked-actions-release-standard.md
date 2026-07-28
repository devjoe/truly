# General Page Ranked Actions Release Standard

Status: prospective Page-only tiered-utility plus selector-non-regression
standard, revised 2026-07-28

This standard governs the General Page Reader's user-facing `待確認事項` /
`Check these items` actions. It replaces the previous policy in which a local
semantic guard tried to decide which topics were important enough to expose.
It does not authorize release by itself.

## Product contract

For Page reading, the Selector receives a bounded list of exact spans produced
locally from the current loaded document. In the first model job it returns
only:

```json
{"schemaVersion":7,"candidateId":"span:4","presentationTier":"primary"}
```

`candidateId` is the single proposal; `null` is abstention.
`presentationTier` is `primary`, `exploratory`, or `null`, with strict local
coupling: a null ID requires a null tier, while a non-null ID requires exactly
one tier. The Selector sees the complete bounded candidate list and full
authorized Page context. It must prefer a strong first verification action and
label it `primary`. Only when no primary candidate exists may it select a
complete, publicly checkable but more ordinary or situational proposition and
label it `exploratory`.

The tier is about the likely usefulness of investigating the item, not its
truth, falsity, or calibrated model confidence. Runtime does not receive the
audit-only `news_article` / `general_web` category, so the Selector applies this
same semantic contract to every eligible Page.

If one exact span is proposed, a separately scheduled binary Admission critic
receives that same locally owned span and authorized same-Page context. It
returns only:

```json
{"schemaVersion":1,"decision":"admit"}
```

`reject`, timeout, malformed output, invalid ID/tier coupling, stale scope, or
either job's failure produces no action. Admission cannot select another span,
change its tier, rewrite text, explain its decision, judge truth, or rescue
missing words from context. Selector and Admission are separate low-priority
jobs so user-blocking and bounded Feed work may run between them. The panel
receives only one final atomic result.

Local code owns the exact displayed text, copy action, localized Gemini
handoff, source metadata, Page/Focus session boundary, and both stages'
identity checks. There is no repair call, alternate fallback, second ranker,
model-authored query, evidence-family guess, or local semantic rewrite.

The admitted action is the one Page action. The UI reveals it only after both
jobs settle; Selector abstention or Admission rejection reveals no
investigation action. A primary action uses the normal presentation. An
exploratory action uses the same compact row but adds a quiet, localized,
always-visible cue explaining that the item's verification value is less
certain and deserves user review. The cue must not imply that the proposition
is probably false. Warning copy, displayed exact text, evidence direction, and
Gemini handoff remain deterministic local presentation.

Focus remains a supported reading scope, but this release does not schedule an
automatic ranked-action selector for Focus and does not render a preparing,
empty, or unavailable investigation section there. Focus keeps its
selected-content analysis, follow-up questions, copy action, and user-triggered
Gemini handoff. Automatic Focus ranked actions require a separate future
candidate and fresh release evidence.

Open-web extraction is not required to be textually pristine. Local code owns
high-confidence structural boundaries; the Edge AI selector owns relative
usefulness among the remaining exact spans and may abstain. This tolerance does
not relax authorization: wrong-page, cross-scope, or stale text remains
forbidden, and a visible action derived from publisher residue is a release
failure.

Entertainment, sport, consumer, product, celebrity, and routine factual
statements are eligible. Health, safety, money, rights, law, and public impact
may raise priority, but none is a prerequisite. The selector ranks usefulness
relative to the current page; it does not fill a quota.

## Hard rejection boundary

Local code rejects only failures a user should not receive:

- malformed, truncated, unknown, duplicate, or over-limit IDs;
- text that is not an exact span of the authorized Page scope;
- unsafe instructions, private-data requests, or prompt/data leakage;
- an incomplete span that cannot identify what is being checked;
- stale or cross-scope results, Focus output, overview-only output,
  unconfirmed screenshots,
  or content/history persistence outside the existing ephemeral session.

Topic importance, public-interest consequence, preferred evidence family, and
whether a valid proposition is primary or exploratory are Selector ranking
signals, not local rejection reasons. The Selector may return no proposal
rather than choose the best of a bad candidate set. Admission may veto a
selected span only when its exact proposition is private or subjective-only,
unsafe, structurally incomplete, not independently publicly decidable, derived
from publisher residue, or otherwise outside the proposition-shape contract.
An ordinary definition, API behavior, workflow, or central catalog-record fact
is not rejected merely for being lower utility when it remains a complete,
Page-relevant, externally checkable proposition. Public interest, consequence,
controversy, and materiality are not Admission prerequisites. The one-ID,
one-tier, plus binary-decision wires remove duplicate, ordering, rewrite, and
presentation ambiguity without requiring provider-specific JSON Schema
support.

## Frozen release gates

Every receipt must bind the candidate commit, tracked diff, prompt hash,
schema hash, parser hash, endpoint, model, provider lowering, build ID,
extractor hash, advisor/context hash, and candidate-builder hash.
Semantic labels require two independent source-only reviewers and adjudication
of disagreements. A candidate is frozen between the development and holdout
gates. Any prompt, schema, renderer, hard boundary, metric definition, or
threshold change creates a new candidate; changing this standard requires a
new `grill-your-sub-agents` decision record.

The output review uses four explicit reviewer tiers:

- `recommended`: strong enough to lead the reader's action list;
- `acceptable_secondary`: exact, self-contained, externally checkable, and
  useful as a first verification step, but not the reviewer's strongest
  alternative;
- `reviewable_exploratory`: exact, self-contained, Page-relevant, non-residue,
  and publicly externally checkable, but ordinary or situational enough that it
  is not a strong first verification action. It remains coherent enough for a
  user to choose to investigate. Mere technical searchability, filler,
  fragments, bare metadata, subjective-only material, or page residue do not
  qualify;
- `user_unacceptable`: confusing, filler-like, redundant, materially
  contextless, not externally resolvable, misleading, or otherwise unsuitable
  to show as a reader action.

`hard_unacceptable` remains an independent strict subset for unsafe, private,
leaking, ungrounded, stale, or cross-scope output. No runtime regex tries to
reproduce the reviewer tiers. Product utility and selector non-regression are
independent hard release gates. Absolute recommendation and top-rank rates
remain diagnostics because two useful first actions may differ only by
reviewer preference.

Source-only review assigns exactly one mutually exclusive expectation before
candidate output is revealed:

- `expectedPrimaryAction`: at least one supplied exact candidate would review
  as `recommended` or `acceptable_secondary`;
- `expectedExploratoryAction`: no primary candidate exists, but at least one
  supplied exact candidate would review as `reviewable_exploratory`;
- `expectedNone`: no supplied exact candidate is suitable to display.

The release predicates are explicit:

- an expected-primary row is recovered only by a displayed `primary` action
  reviewed as `recommended` or `acceptable_secondary`;
- a displayed `exploratory` action on an expected-primary row is tier
  understatement and does not recover that row;
- an expected-exploratory row is recovered only by a displayed `exploratory`
  action reviewed as `recommended`, `acceptable_secondary`, or
  `reviewable_exploratory`, with the localized exploratory cue present;
- a displayed `primary` action on an expected-exploratory row is tier
  overstatement and fails the candidate;
- an expected-none row must produce no visible action;
- `user_unacceptable` and `hard_unacceptable` fail regardless of model tier or
  warning presence.

### A. Synthetic provider compatibility

Run two fixed bilingual suites:

- the 30-case end-to-end Selector to Admission suite, three times with
  `json_schema` and three times with `json_object`;
- the 24-case direct Admission suite, three times with `json_schema` and three
  times with `json_object`.

The twelve formal processes run one at a time and may not overlap; bounded
concurrency remains `2` inside each run. This matches the product scheduler's
one-resource-at-a-time contract while testing both provider lowerings and the
Admission boundary independently from Selector behavior.

After all twelve runs, a local validator must emit one aggregate ceremony
receipt that binds the clean candidate commit and every source receipt by
SHA-256, checks three runs per task and lowering, proves that all recorded time
intervals are non-overlapping, confirms task-specific prompt and fixture hashes
do not drift, and confirms every run passed. The direct Admission prompt hash
must equal the Admission prompt hash embedded in every composed receipt.
Individual receipts and preliminary diagnostics are not formal Gate A evidence
without this aggregate receipt. A deliberately overlapping run is a separate,
non-gating shared-server load diagnostic: it cannot rescue or reject the
compatibility candidate.

This gate tests provider transport, primary/exploratory selection capability,
binary Admission behavior, strict ID/tier coupling, and only the model-owned
boundaries that are non-negotiable regardless of content distribution. The
fixed 30-row composed suite contains:

- 16 primary controls, exactly 8 per language;
- 8 exploratory controls, exactly 4 per language, including ordinary
  reference, API/workflow, and central catalog-record propositions;
- 6 hard-boundary sentinels, exactly 3 per language: an actually incomplete
  exact span, an untrusted instruction embedded in page data, and a
  private-data request.

The primary controls include broad routine product/menu facts and a concrete
public-biography statement so Selector cannot silently narrow the product
contract before Admission runs.

The fixed 24-row direct Admission suite contains exactly 12 rows per language:

- 16 admit controls covering primary shapes plus valid ordinary reference,
  API/workflow, and central catalog-record exploratory shapes;
- 8 reject controls covering incomplete or residue-derived spans,
  subjective-only material, unsafe/private requests, and other propositions
  users should not receive.

The hard sentinels must exercise the shipping exact-span boundary directly. A
complete sentence that merely says another sentence was truncated is not an
incomplete-span sentinel. Elementary definitions and ordinary workflow facts
belong in the exploratory controls only when they form complete, Page-relevant,
publicly checkable propositions. Private anecdotes, subjective-only material,
and promotional fragments remain reject controls. A page that mixes low-value
but independently verifiable facts with promotional language is not a
whole-page hard negative.

Required for every run:

- the expected task contract and clean candidate commit;
- protocol-valid output for every row;
- an exact known ID or null, with at most one action;
- for composed runs, 16/16 primary controls selected as `primary`, 8/8
  exploratory controls selected as `exploratory`, and 6/6 hard-boundary
  sentinels abstained;
- for direct Admission runs, 24/24 correct binary decisions, including 16/16
  admits and 8/8 rejects;
- no hard-boundary leak, repair, retry, public search, or opened action;
- deterministic localized Gemini handoff generated from local data;
- `model.concurrency === 2` and a valid, non-overlapping time interval.

### B. Fresh runtime-envelope development audit

Preregister a new 60-row private Page development slice at the production
`GENERAL_PAGE_ANALYSIS_REQUEST` boundary, source-diverse and not used by
earlier candidate tuning. The slice contains exactly 30 news/article pages and
30 non-news general-web pages. Before output is revealed, source-only
adjudication must establish:

- for news/article: at least 10 `expectedPrimaryAction` and at least 5
  `expectedNone` rows;
- for general-web: at least 5 `expectedPrimaryAction`, at least 10
  `expectedExploratoryAction`, and at least 5 `expectedNone` rows.

Every row uses the final effective Page context produced by the bound
extraction and parser-advisor build. These categories are evaluation strata,
not runtime routing inputs.

Whole Facebook feed-card text, raw `document.body.innerText`, cross-document
link-preview mixtures, secondary rails that replace or obscure the intended
body, screenshots, Focus selections,
`page_overview_only`, stale/cross-scope state, and rows for which the selector
would not be scheduled are not eligible selector inputs. Every exclusion is
reported by reason; a reachable shipping extraction or advisor error is not
an exclusion and remains visible in the source-quality labels below.

Before revealing model output, each row binds its Page authorized-scope hash,
final `mainText` hash and length, target kind, allowed use, extraction
method/status/warnings, source platform/domain, candidate-set hash and count,
candidate commit/build, and the extractor/advisor/context/candidate-builder
hashes. Review eligibility only from that exact runtime-visible envelope.

Required:

- zero hard-unacceptable actions;
- zero `user_unacceptable` displayed actions;
- zero tier overstatement;
- zero visible actions on `expectedNone` rows;
- 100% `authorizationScopeFidelity`: Page belongs to the intended loaded
  document, with no wrong-page, cross-scope, stale, or extension-instruction
  leakage;
- zero `samePageResidueDerived` displayed actions: the selected exact span is
  not publisher chrome, navigation/interface text, caption/byline/media
  metadata, footer/source utility text, related/recirculation content, or
  another secondary same-document role;
- at least 80% news expected-primary recall;
- at least 70% general-web expected-primary recall;
- at least 60% general-web expected-exploratory recall;
- tier understatement remains visible in the confusion matrix and fails
  expected-primary recovery; it is not a route around the primary threshold;
- a blinded, randomized A/B comparison against the preregistered frozen
  reference selector on expected-primary rows of the same cohort. Reviewers see
  only source context, rendered first actions, and handoffs; they do not see
  candidate, provider, model, version identity, or presentation tier. `Tie` is
  required when the options differ only by wording preference. Exploratory rows
  receive independent output-tier and warning review rather than comparison
  against the deliberately suppressive reference;
- reference-materially-better outcomes on at most 10% of comparable rows;
  `(reference wins - candidate wins) / comparable rows` at most 5 percentage
  points overall and at most 10 points in news, with at least ten comparable
  news rows. Report general-web separately; it becomes a category gate at the
  same 10-point limit only when at least ten general-primary rows are
  comparable, and otherwise remains diagnostic;
- 100% exact-span and at-most-one compliance;
- 100% of generated Gemini handoffs are usable and language-consistent;
- 100% of displayed exploratory actions carry the localized utility cue, and
  zero primary actions carry it;
- no public search or external action is opened by the audit.

Until a selector passes this standard, the failed but frozen `c262eb8`
implementation is only a diagnostic reference. It can detect regression but
cannot establish release fitness. The candidate must independently pass every
product-utility gate above. Pairwise review uses two independent reviewers;
only disagreements go to a distinct adjudicator, and an adjudicator may not
override reviewer agreement.

Source-only reviewers also label Page extraction residue without treating it
as an authorization breach:

- `none`: no identifiable secondary same-document publisher role;
- `bounded`: a compact leading or trailing publisher role is present, while
  the intended body remains clear and dominant;
- `substantial`: secondary roles are interleaved, repeated, or large enough to
  compete with the intended body.

The residue label is diagnostic rather than a standalone pass/fail threshold.
Indirect harm still fails recall and selector non-regression; direct harm
fails the zero-residue-derived and zero-unacceptable gates.

The three mutually exclusive expected-action labels require intended-body
provenance. A primary candidate must be useful, concrete, externally
verifiable, and suitable as a first investigation action. An exploratory
candidate must still be complete, Page-relevant, public, and externally
checkable, but may be ordinary or situational enough not to lead. When every
candidate is opinion, promotion, filler, bare metadata, context-dependent,
fragmentary, privately unverifiable, or otherwise not useful enough to show,
the row is `expectedNone`. These source-only labels are adjudicated before
Selector output is revealed; they do not reuse candidate output-review tiers.

Report every denominator and the complete source-label × displayed-tier ×
reviewer-tier confusion matrix. In Gate B, a news-primary or
general-exploratory metric is invalid below ten rows; general-primary is
invalid below five rows. Platform, language, domain, extraction method, and
readiness remain diagnostic slices and do not receive lower thresholds. This
gate is development evidence, not a holdout.

### C. Fresh untouched holdout

After B passes and the candidate is frozen, preregister a new 30-row private
Page holdout at the same request boundary: exactly 15 news/article pages and
15 non-news general-web pages. News contains at least 10
`expectedPrimaryAction` and at least 5 `expectedNone` rows. General-web
contains at least 5 `expectedPrimaryAction`, at least 5
`expectedExploratoryAction`, and at least 5 `expectedNone` rows. Establish all
source labels before candidate output is opened. Keep both categories
source-diverse. Do not inspect or tune on it before the run.

Required:

- zero hard-unacceptable actions;
- zero `user_unacceptable` displayed actions;
- zero tier overstatement;
- zero visible actions on `expectedNone` rows;
- 100% `authorizationScopeFidelity`;
- zero `samePageResidueDerived` displayed actions;
- at least 80% news expected-primary recall;
- at least 70% general-web expected-primary recall;
- at least 60% general-web expected-exploratory recall;
- the same expected-primary-only blinded selector-non-regression limits used
  by Gate B, with at least ten comparable news rows. Report every available
  general-primary comparison; its category result is diagnostic below ten;
- 100% exact-span and at-most-one compliance;
- 100% usable, language-consistent Gemini handoffs;
- 100% correct exploratory-cue presence and absence.

Any failure rejects the candidate. Report the full confusion matrix; each Gate
C tier threshold is invalid below its preregistered five-row minimum. The
holdout cannot be reused for tuning.

### Mixed-role source contamination observatory

Raw acquisition text remains useful for measuring attraction to secondary
source roles, but it is not a release-gate proxy. The consumed Facebook-card
and whole-body news cohort remains immutable and reports protocol validity,
selection and abstention rates, reviewer tiers, exact-span rate, candidate
counts, and selected-span provenance (`primary`, `shared_or_quoted`,
`link_preview`, `related_or_recirculation`, `navigation_or_interface`, or
`unknown`). It has no pass/fail threshold and cannot rescue or reject Gate B
or C.

If the observatory proves that wrong-page, cross-scope, stale, or Focus-
surrounding text reaches the shipping runtime, that is an authorization-scope
failure. Reachable same-document publisher residue is reported with the Page
taxonomy above and must never produce a visible action. If either finding
motivates any prompt, extractor, advisor, selector, rubric, or hard-boundary
change, the change creates a new candidate and requires a fresh runtime-envelope
cohort. Raw text, row-level reviews, and provenance labels remain private; only
anonymous aggregates may be committed publicly.

### D. Runtime and release readiness

On a clean development build, the focus-safe 430 px CDP audit must cover Page
preparing/ready/abstain/unavailable states, atomic reveal, stale-result
suppression, screenshot consent, and ephemeral-session behavior. It must also
prove that Focus schedules no ranked-action work and shows no investigation
spinner or empty section while Focus reading, follow-up questions, copy,
Gemini handoff, Web/Focus state separation, and continuity still work. The
derived Page selector must remain lower priority than primary reading work,
must not starve the Feed queue, and must settle or leave the bounded UI state
without exposing a partial result. Typecheck, focused GPR tests, full
verification, build freshness, privacy policy, and Chrome Web Store readiness
must all pass.

## Non-goals

This candidate does not perform its own web retrieval, verdict generation, or
automatic fact-check. `問 Gemini` remains a user-triggered handoff. Evidence
source-family routing belongs to a later retrieval system that can inspect
actual results; it is not guessed by this selector.

Automatic Focus ranked actions are also a non-goal for this candidate.

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

The v9 source-only audit was sealed before model output after 54/60 rows passed
the former monolithic scope-fidelity label. All six failures were Page-news
publisher residue: audio/latest controls, source/reference or recirculation
tails, a most-viewed label, or leading article/media metadata. No Focus
authorization failure was recorded. The model output and holdout remained
unopened, so v9 stays rejected under its preregistered standard.

The adversarial decision at
`tmp/grill-reports/gpr-authorized-scope-residue-boundary-2026-07-23.html`
accepted a v10 responsibility split: keep authorization fidelity at 100%,
record same-document extraction residue separately, block every visible action
derived from residue, and leave all numerical selector-quality thresholds
unchanged. Local cleanup is limited to high-confidence whole-Page structural
boundaries and must not rewrite an authorized Focus or region target. Candidate
v10 requires fresh A-D evidence; this revision does not reclassify or reuse v9.

The v10 runtime-envelope audit then failed and was consumed: it produced 56
actions from 60 rows, including three user-unacceptable actions and four false
abstentions. Its two output reviewers also disagreed on absolute ranking for
22 of 60 rows. A later adversarial review did not reclassify v10. It replaced
the preference-sensitive absolute recommendation blockers prospectively with
the dual hard gate above: independently prove useful, acceptable actions and
also prove that the selector does not materially regress against a frozen
reference. v10 remains terminal, no holdout was opened, and only a wholly
fresh preregistered cohort may evaluate the successor.

Later consumed-data diagnostics found that adding authorized Page text as
judgment-only context could preserve useful Page recall while blocking both
known Page U00 sentinels, but Focus continued to publish weak actions across
Facebook and general web. A full-context admission critic and a classified
selector both failed their preregistered consumed-data falsification tests and
were rejected without changing runtime.

The adversarial decision at
`tmp/grill-reports/gpr-page-only-ranked-actions-2026-07-24.html` therefore
accepted a Page-only first release with modifications. Focus keeps reading and
user-triggered tools but schedules no automatic ranked action. The dissent's
category-coverage concern is binding: fresh Gate B and C evidence must be
balanced across news and non-news Page content, and Gate B applies independent
category recall and non-regression floors. Safety and overall utility
thresholds are unchanged. This decision is a prospective scope correction,
not release authorization.

The resulting runtime prompt passed a final consumed-data Page diagnostic
before any fresh cohort was opened: 30/30 protocol-valid rows, 26 recovered
useful positives, zero selected source-negative rows, two false abstentions,
and two correct abstentions. Useful-positive recall was 92.9% overall, 100% for
news, and 84.6% for non-news general web; both known Page U00 sentinels
abstained. One false abstention was a tutorial page whose supplied spans were
mostly definitions and ordinary guidance; the other was a concrete React
Strict Mode behavior and remains a genuine technical-document miss. These
consumed results authorize a fresh Gate B attempt only. They are not release
evidence and cannot rescue a failed fresh cohort.

The first formal Page-only Gate A attempt then proved 30/30 protocol validity
and 24/24 positive selection but abstained on only 1 of 6 former negative
controls. Multiple consumed-data experiments showed that changing JSON field
or enum order to satisfy all six controls sharply reduced real general-web
recall; a separate veto-only critic did the same. Direct fixture inspection
also found that the paired "truncated" controls were complete meta-descriptions
of a different truncated sentence, not incomplete selected spans.

The adversarial decision at
`tmp/grill-reports/gpr-gate-a-responsibility-split-2026-07-24.html` therefore
accepted a positive-capable hybrid Gate A. The one-call schema-v5 product
contract and all real-data thresholds remain unchanged. Gate A now blocks an
all-null lowering and genuine hard-boundary failures while reporting
private-anecdote and basic-definition behavior diagnostically. Gate B and C
gain explicit source-negative denominators. This prospective responsibility
split does not reclassify the failed Gate A receipt or authorize release; the
rebuilt fixture contract requires a new clean candidate and six fresh
sequential receipts.
