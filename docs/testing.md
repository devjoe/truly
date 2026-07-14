# Testing

Truly's public test suite uses synthetic fixtures only.
Synthetic fixtures protect public-safe invariants and known regressions; they
are not representative product-quality evidence because real pages rarely look
like minimized fixtures. Use private live-DOM review, screenshots, and manual
labels to judge extraction quality.

## Public Gate

```bash
npm run check:public
```

The public gate runs:

- public-boundary check;
- typecheck;
- public contract tests;
- public pure unit tests;
- production build.

Pure unit tests also cover small UI policy decisions that can be represented
without DOM or private feed captures, such as Heads-up chip deduplication.

## General Page Reader Fast Gate

Use the focused General Page Reader gate during implementation:

```bash
make gpr-check
```

The target runs the General Page Reader contract, runtime, model-integration,
permission, URL-identity, readability, screenshot-boundary, and UI/i18n tests,
followed by the TypeScript typecheck. The test list has one owner in the
`test:gpr` package script; the Make target is intentionally only a thin alias.

This is a fast development check, not a release or merge gate. It intentionally
does not run the production build, release metadata and bundle audits, readiness
documentation checks, the full parser corpus, or live CDP review. Before a
checkpoint, push, merge, or release, still run:

```bash
make verify
```

### Private grounding evaluation runner

The public repository owns the runtime-equivalent context builder, prompt,
normalization, and post-guard runner, but never owns the real corpus. A private
control plane may invoke it with absolute paths outside this checkout:

```bash
npm run eval:gpr:private -- \
  --input /absolute/private/input.jsonl \
  --output /absolute/private/results.jsonl \
  --meta-output /absolute/private/run-manifest.json \
  --endpoint https://approved-model-endpoint.example/v1 \
  --model approved-model \
  --split dev \
  --dataset-version gpr-grounding-v1 \
  --run-id gpr-dev-example \
  --sample-count 40 \
  --data-categories facebook-original,news-original \
  --confirm-private-data-send
```

The runner fails closed unless the caller declares the dataset version, exact
record count, and data categories. Its private run manifest records both the
dataset version and each present language variant's system-prompt hash, so a
mixed-language dev batch is not confused with a single-language holdout. It
prints aggregate status only. Original text and per-sample
model output must remain in the private control plane (or under this repo's
gitignored `tmp/` for local-only debugging).

Candidate v1's one-time 20-sample holdout passed grounding but failed the
predeclared atomic-claim, aligned-query, useful-action, and automated
unsafe-action gates. See the Phase 3.5b section of
`docs/plans/general-page-reader.md`. Do not use that holdout to tune the next
candidate; reserve a new final evaluation slice.

Candidate v2's fresh 30-sample holdout also remained fully grounded, and the
blind-gold unsafe-action rate fell to 7.1%. It still failed the frozen release
gates: claim precision was 88.2% against 90%, and manual useful/aligned eligible
action rates were 50%/70% against 90%/95%. Do not tune v2 or reuse its holdout.

Candidate v3 is intentionally limited to the existing 40-sample v1 development
split. The private runner opts into `investigation_v3` and a single compact
format-repair request; normal Page/Focus runtime requests use the `standard`
contract and never perform that repair. The best v3 run needed repair for 29/40
responses, and the final fail-closed guard retained only one of 22 emitted
claims as action-eligible. Treat this as guard-design evidence, not a release
candidate. Do not create or unseal another holdout until structured-output
stability and development action coverage improve.

### Private investigation-plan development audit

The model-neutral investigation planner has a separate development-only runner:

```bash
npm run eval:gpr:investigation-plan:private -- \
  --input /absolute/private/input.jsonl \
  --output /absolute/private/output.jsonl \
  --meta-output /absolute/private/manifest.json \
  --endpoint http://approved-local-endpoint/v1 \
  --model approved-model \
  --split dev \
  --run-id investigation-plan-example \
  --dataset-version gpr-investigation-plan-v1 \
  --sample-count 30 \
  --data-categories facebook-original,news-original \
  --response-format json_schema \
  --thinking disabled \
  --confirm-private-data-send
```

The caller must declare the exact endpoint, model, count, categories, response
format, and thinking mode. The runner writes raw output only to an external
private path and prints aggregate status. Development audit results and the
12-claim route-pilot decision are documented in
`docs/plans/claim-investigation-development-audit-2026-07-14.md`.

The private control plane also supports an authorized manual review of the
30-row plan worksheet and the 12-row real-web retrieval pilot. The latter
compares single normalized-claim search, question decomposition, and
authority/document-first retrieval. Raw queries, URLs, excerpts, and per-row
decisions remain under gitignored `private-data/`; only anonymized aggregate
rates are tracked. ClaimReview lookup is not required.

Public-safe synthetic verification is available through:

```bash
npm run test:gpr:investigation
npm run prototype:gpr:investigation
npm run audit:gpr:investigation-prototype
```

The prototype audit uses a background CDP target at 430 px and does not call
`bringToFront`. Its HTML and screenshot stay under gitignored `tmp/`.

## General Page Reader UI Gate

After changing the Web or Focus information architecture, build the development
extension and run the deterministic background-CDP gate:

```bash
make build-dev
make gpr-ui-check
```

`gpr-ui-check` first rejects a dist build when an extension input under `src/`,
`public/`, or the build configuration is newer than `dist/build-id.txt`. It then
uses the existing Chrome remote debugger, reloads a stale Truly runtime when
needed, and exercises synthetic local pages with deterministic model responses.
It does not call `bringToFront` or intentionally focus Chrome.

GPR, Facebook, and dev-check scripts share the timeout-safe transport in
`scripts/lib/cdp-client.mjs`. Target selection and permission to focus a page
remain caller-owned policies; ordinary evaluate, screenshot, and viewport
operations never activate a Chrome window.

The gate checks the 430px layout, accessible controls, the Focus single-card
information architecture, Web/Focus analysis preservation, distinct scope
results, Focus caption typography, and localized action copy. Screenshots,
audit JSON, and a short summary are written under
`tmp/general-page-ui-check-*` and must not be committed.

The Web/Focus continuity flow is a scenario-owned tracer slice under
`scripts/lib/general-page-audit-scenarios/`: it owns its actions, observations,
artifact names, assertions, and summary projection. The top-level audit owns
only browser lifecycle, shared timeouts, and aggregate reporting; migrate other
flows to this shape when they need substantive changes rather than rewriting
the whole audit at once.

Meaningful Navigation uses the same scenario shape. Its timeline verifies that
hash and tracking changes preserve the Page Reading Session, while a meaningful
change invalidates the old request identity and scrubs the prior Reading Surface
before a debounced auto-read begins. Assertions use canonical runtime state;
quiet or intentionally absent success labels are not treated as failures.

Page rereads are transactional. While a fresh extraction and analysis are in
flight, the Side Panel keeps the previous completed result visible, marks the
reload control busy, and suppresses duplicate read actions. A successful
request replaces the previous result only after the new analysis settles; a
failed request restores the previous result and exposes a compact failure
message. Unit coverage must also reject stale completion messages whose request
identity no longer matches the active session.

Feed, Web, and Focus external-tool actions share one compact button treatment
and short action labels. Their status footer stays out of layout until an action
produces feedback, so an empty live region cannot create mode-specific card
padding. Keep this behavior covered by DOM-level unit tests when changing the
shared action renderer or its localized labels.

`npm run dev:check` now also verifies source freshness before comparing dist,
reload-server, service-worker, and Facebook content-script build IDs. Use
`npm run dev:check:source` when only the local source-to-dist freshness check is
needed.

Sponsored detection regressions must prefer precision over recall. The public
suite uses synthetic GraphQL-style post records to verify that a sponsored
signal does not create author-level memory and collapse unrelated posts from
the same author. Live feed checks can be used as a private confidence pass, but
only their counts and local `tmp/` artifact paths should be recorded.

## Review Hardening Gate

Before publishing a public preview, code-review hardening changes should pass
`npm run check:public`. This gate covers deterministic regressions for the
public package without requiring private feed captures, live browser sessions,
or local model endpoints.

## Fixture Policy

Public tests must not include:

- real post text, account names, group names, or profile URLs;
- Facebook tracking URLs, GraphQL captures, DOM dumps, or screenshots;
- private model endpoints, LAN hosts, local machine paths, or browser profiles;
- live CDP or logged-in browser state.

When a private regression is useful, convert it into a small synthetic fixture
before adding it to the public suite, but only after repeated private examples
show a stable DOM shape worth preserving.

Run the full General Page synthetic parser/advisor gate only when parser or
fixture behavior changes:

```bash
npm run check:general-page:synthetic
```

## Private Confidence Passes

Live Facebook checks, page-matrix audits, CDP screenshots, and private
regression packs are release confidence passes. They are not required for public
CI and must stay outside the public repository.

### Current Facebook Page Audit

Use this when a visible Facebook page may have layout drift, missing Heads-up
rows, stale extension code, or locale-specific UI issues:

```bash
npm run dev:check
npm run audit:facebook-current
```

For locale-specific passes:

```bash
npm run audit:facebook-current:zh
npm run audit:facebook-current:en
```

For a small manual page matrix, open the Facebook scenarios you want to cover
in the same debug Chrome session, then run:

```bash
npm run audit:facebook-open-tabs
```

Locale-specific open-tab matrix passes:

```bash
npm run audit:facebook-open-tabs:zh
npm run audit:facebook-open-tabs:en
```

The audit attaches to the existing Chrome DevTools session on `127.0.0.1:9222`
and checks the currently loaded Facebook tab. It verifies:

- `dist/build-id.txt`, the service worker, and the Facebook content script are
  aligned;
- Heads-up hosts are mounted on real post containers, not page-level wrappers;
- low-risk collapsed Heads-up rows may remain intentionally quiet;
- the row can expand/collapse;
- selector health is reported as healthy when available;
- screenshots and a short report are saved under `tmp/facebook-current-audit-*`.

`audit:facebook-open-tabs*` runs the same current-page audit once per open
Facebook tab and writes a matrix summary under `tmp/facebook-open-tabs-audit-*`.
This is the public-safe version of a page matrix: the repo stores the runner,
not private target URLs.

Recommended manual matrix:

- home feed or chronological feed;
- a group discussion page;
- a group discussion page with an expanded or long thread, when available;
- a profile, page, or single-post view when the touched code affects those
  surfaces.

The group discussion page is especially important for Heads-up placement. It
catches cases where Facebook exposes a page-level wrapper, composer area, or
nested feed surface that is large enough to look like a post container. The
expected result is that Heads-up rows attach to actual post containers, not the
outer group page or feed wrapper.

Public repository boundary:

- Keep the script public and generic.
- Keep all generated screenshots, JSON, summaries, and live-page text under
  `tmp/`.
- Do not commit audit artifacts, real post text, group names, profile URLs,
  Facebook captures, private endpoints, or local browser state.
- If a live issue needs a permanent regression test, convert it into a small
  synthetic fixture first.

The command intentionally gates only Truly-owned failures. It does not fail on
Facebook's own offscreen DOM, hidden accessibility mirrors, or the deliberately
minimal low-risk Heads-up collapsed state.
