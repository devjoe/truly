# General Page Ranked Actions Release Standard

Status: frozen rank-first candidate standard, revised 2026-07-21

This standard governs the General Page Reader's user-facing `待確認事項` /
`Check these items` actions. It replaces the previous policy in which a local
semantic guard tried to decide which topics were important enough to expose.
It does not authorize release by itself.

## Product contract

The selector receives a bounded list of exact spans produced locally from the
current Page or Focus text. In one model call it returns only:

```json
{"schemaVersion":3,"selectedCandidateIds":["span:4","span:1"]}
```

The ordered IDs are the ranking. An empty array is a valid abstention. Local
code owns the exact displayed text, copy action, localized Gemini handoff,
source metadata, and Page/Focus session boundary. There is no repair call,
second ranker, model-authored query, evidence-family guess, or local semantic
rewrite.

The first returned action is the product recommendation. Later actions are
optional alternatives, not equal-strength endorsements. The UI reveals the
bounded batch atomically, marks the first action with a quiet localized
priority cue, and keeps later actions visually secondary without hiding them.

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
Duplicate rejection remains a local parser invariant because the portable
JSON Schema subset does not assume provider support for `uniqueItems`.

## Frozen release gates

Every receipt must bind the candidate commit, tracked diff, prompt hash,
schema hash, parser hash, endpoint, model, provider lowering, and build ID.
Semantic labels require two independent source-only reviewers and adjudication
of disagreements. A candidate is frozen between the development and holdout
gates. Any prompt, schema, renderer, hard boundary, metric definition, or
threshold change creates a new candidate; changing this standard requires a
new `grill-your-sub-agents` decision record.

The 2026-07-21 decision review replaced one all-action usefulness label with
three explicit reviewer tiers:

- `recommended`: strong enough to lead the reader's action list;
- `acceptable_secondary`: not the best first suggestion, but exact,
  self-contained, non-duplicative, externally checkable, and reasonably useful
  when shown as a secondary option;
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
- exact known IDs, preserved order, uniqueness, and at most three actions;
- every positive control selected and every negative control abstained;
- no hard-boundary leak, repair, retry, public search, or opened action;
- deterministic localized Gemini handoff generated from local data.

### B. Fresh development audit

Preregister a new 60-row private development slice: 30 Facebook and 30 news
rows, source-diverse, not used by earlier candidate tuning. Review eligibility
from source text before revealing model output.

Required:

- zero hard-unacceptable actions;
- zero `user_unacceptable` displayed actions;
- at least 85% of returned first actions are `recommended` overall and at
  least 80% on each surface, with at least ten returned first actions per
  surface;
- at least 75% recall of positive rows overall and at least 65% on each surface;
- the first action is best or tied-best on at least 75% of rows with any
  reviewer-acceptable action; this denominator excludes abstentions instead of
  counting recall failure twice;
- 100% exact-span, unique-ID, and at-most-three compliance;
- at least 95% of generated Gemini handoffs are usable and language-consistent;
- no public search or external action is opened by the audit.

Report every denominator. A surface metric is invalid when its denominator is
smaller than ten. This gate is development evidence, not a holdout.

### C. Fresh untouched holdout

After B passes and the candidate is frozen, preregister a new 30-row private
holdout: 15 Facebook and 15 news rows. Do not inspect or tune on it before the
run.

Required:

- zero hard-unacceptable actions;
- zero `user_unacceptable` displayed actions;
- at least 85% of returned first actions are `recommended` overall and at
  least 75% on each surface, with at least eight returned first actions per
  surface;
- at least 70% positive-row recall overall and at least 60% on each surface;
- first action best or tied-best on at least 70% of eligible rows;
- 100% exact-span, unique-ID, and at-most-three compliance;
- at least 95% usable, language-consistent Gemini handoffs.

Any failure rejects the candidate. The holdout cannot be reused for tuning.

### D. Runtime and release readiness

On a clean development build, the focus-safe 430 px CDP audit must cover Page
and Focus continuity, preparing/ready/abstain/unavailable states, atomic batch
reveal, stale-result suppression, screenshot consent, and ephemeral-session
behavior. The derived selector must remain lower priority than primary reading
work, must not starve the Feed queue, and must settle or leave the bounded UI
state without exposing a partial batch. Typecheck, focused GPR tests, full
verification, build freshness, privacy policy, and Chrome Web Store readiness
must all pass.

## Non-goals

This candidate does not perform its own web retrieval, verdict generation, or
automatic fact-check. `問 Gemini` remains a user-triggered handoff. Evidence
source-family routing belongs to a later retrieval system that can inspect
actual results; it is not guessed by this selector.
