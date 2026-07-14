# Claim Investigation Research and Platform Boundary

Status: research synthesis; no release contract or runtime implementation
Last updated: 2026-07-14

## Decision Summary

Truly should define claim investigation as a user-guided, evidence-bearing
process, not as a search shortcut and not as an automatic true/false verdict.
The product should preserve four distinct stages:

1. identify and freeze the exact claim in its source and time context;
2. decompose the claim into answerable investigation questions;
3. collect, classify, and compare evidence, including counter-evidence;
4. decide whether the collected evidence is sufficient before presenting a
   bounded finding.

The Chrome Extension can reliably own current-page extraction, user consent,
session-only planning, and evidence handoff. It should not be the long-running
or durable investigation engine. A future desktop companion App is the most
direct way to add resumable work, a local evidence ledger, credentials, local
models, and cross-browser continuity. A later standalone mobile or desktop App
can add share-sheet intake and persistent investigation workspaces, but it is
still subject to operating-system background limits and must use resumable
jobs rather than assume an immortal process.

This research changes the order of work after candidate v3: define and test the
investigation domain contract first, then test constrained JSON/schema support
against that contract. Grammar can improve output syntax, but it cannot decide
whether a claim is check-worthy, atomic, temporally scoped, or supported by
sufficient independent evidence.

## Scope and Non-goals

This document answers:

- What professional and research fact-checking workflows imply for Truly's
  product and data model.
- Which responsibilities fit the current Chrome MV3 Extension.
- Which responsibilities become safer or more reliable in a native companion
  or standalone App.
- What should be measured before exposing investigation as a release feature.

This document does not:

- enable the existing `開始查核` UI for release;
- add automated browsing, crawling, or a verdict generator;
- authorize persistent storage of page text or model output;
- choose a search vendor or paid API;
- change candidate v3, reuse a frozen holdout, or create a new holdout;
- assume that an App can bypass website terms, authentication, robots rules,
  or operating-system privacy and background-work constraints.

## What the Research Says

### 1. Check-worthiness is a separate decision

ClaimBuster treats detection of check-worthy factual claims as a distinct
component rather than assuming every factual-looking sentence deserves a fact
check. This supports Truly's current fail-closed direction: a Reading Context
claim can remain useful without automatically becoming an investigation
action.

Product implication: preserve a visible reading claim and a stricter,
machine-checkable `InvestigationSubject` as separate concepts. Consequence,
specificity, verifiability, attribution, and temporal scope belong to an action
eligibility policy; they are not merely presentation fields.

Source: [ClaimBuster, KDD 2017](https://www.kdd.org/kdd2017/papers/view/toward-automated-fact-checking-detecting-check-worthy-factual-claims-by-cla)

### 2. Real claims need decomposition and intermediate questions

ProgramFC decomposes complex claims into simpler executable subtasks.
ClaimDecomp distinguishes literal questions about explicit propositions from
implied questions needed to understand or verify the whole claim. AVeriTeC
represents real-world verification with evidence-backed question-answer pairs
and textual justification. A realistic open-web pipeline separately performs
claim decomposition, document retrieval, fine-grained evidence retrieval,
claim-focused summarization, and judgment.

Product implication: one model-authored search query is not an investigation
plan. Truly should represent atomic subclaims and multiple question purposes,
then let retrieval proceed iteratively as answers reveal missing evidence.

Sources:

- [ProgramFC, ACL 2023](https://aclanthology.org/2023.acl-long.386/)
- [ClaimDecomp, EMNLP 2022](https://aclanthology.org/2022.emnlp-main.229/)
- [AVeriTeC, NeurIPS 2023](https://papers.nips.cc/paper_files/paper/2023/hash/cd86a30526cd1aff61d6f89f107634e4-Abstract-Datasets_and_Benchmarks.html)
- [Complex Claim Verification with Evidence Retrieved in the Wild, NAACL 2024](https://aclanthology.org/2024.naacl-long.196/)

### 3. Atomicity is necessary but not sufficient

FActScore and SAFE demonstrate the value of decomposing long text into atomic
facts before retrieval and evaluation. Truly's v2/v3 experience confirms this:
compound claims make retrieval and action alignment unreliable. However,
atomicity alone does not establish consequence, source attribution, temporal
scope, evidence quality, or whether a query can retrieve a decisive answer.

Product implication: `subject + predicate + object` remains useful as a local
guard, but the future contract also needs qualifiers and provenance. The
system must be able to say that an atomic proposition is well formed but still
not suitable for investigation.

Sources:

- [FActScore, EMNLP 2023](https://aclanthology.org/2023.emnlp-main.741/)
- [SAFE / Long-form factuality, NeurIPS 2024](https://papers.neurips.cc/paper_files/paper/2024/file/937ae0e83eb08d2cb8627fe1def8c751-Paper-Conference.pdf)

### 4. Retrieval is not proof, and absence is not refutation

Evidence sufficiency must be evaluated explicitly. Research on insufficient
evidence shows that fact-checking systems should abstain instead of predicting
from incomplete evidence. Work on missing counter-evidence shows that many
benchmarks unrealistically contain refuting evidence copied or leaked from
fact-check articles; emerging misinformation may not yet have decisive
counter-evidence. AVeriTeC explicitly addresses temporal leakage by restricting
evidence to information available at the relevant time.

Product implication: `no supporting result found` must never become `false`,
and a previously published fact-check is a discoverable review, not independent
primary evidence. Truly needs explicit `insufficient`, `conflicting`,
`outdated`, and `not_yet_verifiable` outcomes.

Sources:

- [Fact Checking with Insufficient Evidence, TACL 2022](https://aclanthology.org/2022.tacl-1.43/)
- [Missing Counter-Evidence Renders NLP Fact-Checking Unrealistic, EMNLP 2022](https://aclanthology.org/2022.emnlp-main.397/)

### 5. Human-facing explanations can create over-reliance

In a controlled study, LLM explanations helped people work faster but users
over-relied on convincingly wrong explanations. Contrastive explanations
reduced that over-reliance but did not replace reading retrieved passages.
FACTS&EVIDENCE argues for a user-driven interface that exposes individual
claims, model reasoning, and multiple diverse evidence sources rather than a
single opaque score.

Product implication: the default result surface should foreground quoted
evidence, source identity, date, and unresolved conflicts. A concise synthesis
may orient the user, but it must not visually dominate the underlying passages
or imply more certainty than the evidence ledger supports.

Sources:

- [Large Language Models Help Humans Verify Truthfulness - Except When They Are Convincingly Wrong, NAACL 2024](https://aclanthology.org/2024.naacl-long.81/)
- [FACTS&EVIDENCE, NAACL 2025](https://aclanthology.org/2025.naacl-demo.35/)

### 6. Existing fact checks are optional evidence, not a required retrieval lane

`ClaimReview` records a reviewed claim, the claim's origin, the reviewer, and a
rating. Google's Fact Check Tools API can search existing fact-checked claims
by text or image. Google also requires a traceable claim origin, transparent
methods, citations, references to primary sources, and a corrections
mechanism. Google Search is phasing out `ClaimReview` rich-result display, but
the format remains supported by Fact Check Explorer.

Product implication: Truly may accept a discovered existing review as a
`fact_check` source, but should not depend on ClaimReview lookup or query it
before ordinary evidence retrieval. Atomic investigation subjects rarely match
the wording of an existing review, and the development pilot found more value
in locating the responsible authority, canonical document, and exact answering
passage. The internal model can remain export-compatible with ClaimReview
without making that service an execution dependency or adopting a fixed
true/false scale as its only outcome.

Sources:

- [Schema.org ClaimReview](https://schema.org/ClaimReview)
- [Google ClaimReview guidance](https://developers.google.com/search/docs/appearance/structured-data/factcheck)
- [Google Fact Check Tools API](https://developers.google.com/fact-check/tools/api/)

## Proposed Domain Language

The following language is a research contract, not yet a runtime TypeScript
contract.

**Reading Claim**:
A concise statement in Reading Context that may deserve user attention. It can
be displayed without being action-eligible.

**Investigation Subject**:
A self-contained, check-worthy claim snapshot approved by deterministic policy.
It retains the exact original span, source, scope, attribution, and observed
time alongside exactly one normalized atomic proposition. Time, place,
quantity, and attribution are properties of that proposition, not additional
claims bundled into the same action.

**Investigation Plan**:
A versioned set of literal and contextual questions, evidence requirements,
source preferences, time cutoff, and stopping conditions. Generated queries
are candidates inside the plan, never trusted commands.

**Evidence Artifact**:
A source passage, dataset row, image, document, or prior fact-check captured
with URL or local identity, publisher, publication and retrieval times, exact
excerpt, acquisition method, and content fingerprint.

**Evidence Relation**:
How one Evidence Artifact relates to one atomic proposition: supports, refutes,
contextualizes, or is irrelevant. This is distinct from source quality.

**Evidence Ledger**:
The append-only, inspectable set of Evidence Artifacts and assessments for an
Investigation. Duplicate syndication and shared-origin evidence remain linked
so ten copies of one report do not appear as ten independent sources.

**Evidence Sufficiency**:
A reasoned assessment of whether the available evidence answers every required
question with adequate relevance, authority, independence, and temporal fit.

**Investigation Finding**:
A bounded synthesis derived from the ledger. Recommended states are
`supported_by_available_evidence`, `contradicted_by_available_evidence`,
`mixed`, `insufficient`, `conflicting`, `outdated`, and
`not_yet_verifiable`. A finding always carries missing-evidence and uncertainty
information and is not equivalent to an objective timeless verdict.

**Investigation Workspace**:
The user-owned, durable App surface for one or more Investigation Subjects,
their plans, evidence ledger, notes, corrections, and exports. This does not
belong in the current session-only Page Reading Session.

## Research Contract Shape

The next schema experiment should target the concepts below. Field names and
limits remain provisional until a development audit validates them.

```ts
interface InvestigationSubject {
  version: 2;
  id: string;
  scope: "page" | "focus";
  originalSpan: string;
  normalizedClaim: string;
  source: {
    title?: string;
    publisher?: string;
    url?: string;
    publishedAt?: string;
    observedAt: string;
  };
  attribution?: {
    actor: string;
    relation: string;
    modality: "statement" | "report" | "estimate" | "allegation" | "forecast" | "analysis";
  };
  proposition: {
    originalSpan: string;
    normalizedText: string;
    time?: string;
    place?: string;
    quantity?: string;
  };
  consequence: "health" | "safety" | "money" | "rights" | "law" | "public_interest";
}

interface InvestigationPlan {
  version: 2;
  subjectId: string;
  questions: Array<{
    id: string;
    basis: "literal" | "contextual";
    purpose: "proposition" | "identity" | "timeline" | "quantity" | "context" | "counterevidence";
    question: string;
    queryCandidates: string[];
    preferredSourceRoles: Array<"primary" | "independent_secondary" | "fact_check">;
  }>;
  timeCutoff?: string;
  minimumIndependentSources?: number;
  stoppingConditions: string[];
}

interface EvidenceArtifact {
  version: 2;
  id: string;
  questionId: string;
  sourceRole: "primary" | "independent_secondary" | "fact_check" | "claim_origin" | "user_supplied";
  url?: string;
  publisher?: string;
  publishedAt?: string;
  retrievedAt: string;
  exactExcerpt: string;
  contentFingerprint?: string;
  sharedOriginGroup?: string;
  relation: "supports" | "refutes" | "context" | "irrelevant";
}
```

Important boundaries:

- `queryCandidates` are data, not executable instructions.
- Each subject contains one proposition and every question investigates that
  proposition. There is no proposition index or multi-claim action bundle.
- Atomicity is represented by one exact clause span plus a normalized reading,
  not an English-specific subject/predicate/object grammar. Obvious multi-
  sentence and coordinated-clause output fails closed locally; prompt and
  constrained schema remain the first line of control. Question basis and
  question purpose are separate axes.
- Source role and evidence relation are orthogonal.
- A prior fact-check is not silently counted as independent primary evidence.
- Retrieval time and publication time are separate.
- A finding cannot be emitted until a separate sufficiency evaluator records
  which questions remain unanswered.

## Current Chrome Extension Constraints

The current manifest uses MV3 with `storage`, `activeTab`, `sidePanel`, and
`scripting`; Facebook and local model hosts are required host permissions, while
ordinary HTTP(S) pages are optional host permissions requested at runtime.
Page and Focus analysis remains in Side Panel memory, and the accepted cold-open
ADR permits only a short-lived, consume-once command envelope in
`chrome.storage.session`.

These choices align with the platform:

- An MV3 service worker normally terminates after 30 seconds of inactivity; a
  single request may be terminated after five minutes, and a `fetch()` that
  takes more than 30 seconds can fail. Chrome explicitly requires resilience to
  unexpected termination.
- `activeTab` is temporary, requires a qualifying user gesture, and is revoked
  on cross-origin navigation or tab close.
- Cross-origin requests require matching host permissions. Optional host
  permissions preserve contextual consent but make unattended multi-source
  collection unreliable.
- `storage.session` is memory-backed and clears on browser restart, extension
  reload/update/disable. It is appropriate for commands and short recovery, not
  durable evidence history.
- The Side Panel can stay open across tabs, but programmatic opening requires a
  user action. Its lifetime is a useful UI affordance, not a durable job queue.
- An offscreen document provides selected DOM capabilities and only the
  `chrome.runtime` extension API. It is not a general persistent worker and
  should not be used to disguise a long-running investigation daemon.
- Native messaging is available only from extension pages or the service
  worker, requires an installed and explicitly registered host plus the
  `nativeMessaging` permission, and exchanges framed JSON. A native-host
  message back to Chrome is capped at 1 MB, so the bridge must exchange bounded
  envelopes and artifact references rather than entire evidence archives.

Official sources:

- [Extension service worker lifecycle](https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle)
- [`activeTab` permission](https://developer.chrome.com/docs/extensions/develop/concepts/activeTab)
- [Cross-origin network requests](https://developer.chrome.com/docs/extensions/develop/concepts/network-requests)
- [`chrome.permissions`](https://developer.chrome.com/docs/extensions/reference/api/permissions)
- [`chrome.storage`](https://developer.chrome.com/docs/extensions/reference/api/storage)
- [`chrome.sidePanel`](https://developer.chrome.com/docs/extensions/reference/api/sidePanel)
- [`chrome.offscreen`](https://developer.chrome.com/docs/extensions/reference/api/offscreen)
- [Native messaging](https://developer.chrome.com/docs/extensions/develop/concepts/native-messaging)

## Responsibility Matrix

| Responsibility | Chrome Extension now | Desktop companion App | Standalone mobile/desktop App |
|---|---|---|---|
| Read the visible page or explicit selection | Primary owner, under current-tab permission | Receives only an approved bounded snapshot | Receives URL/text/image through share or import |
| Explain permission and privacy boundary | Primary owner at capture time | Confirms App handoff and storage choice | Primary owner for imported material |
| Build a session-only Investigation Subject/Plan | Appropriate after contract clears gates | Can validate or enrich the plan | Appropriate |
| Open one user-selected search/review link | Appropriate after a second user action | Appropriate | Appropriate |
| Collect evidence across many domains | Fragile; each domain may need permission and navigation changes invalidate `activeTab` | Appropriate with explicit user scope, retry, and policy controls | Appropriate within OS and site constraints |
| Run multi-hop or long model/retrieval jobs | Poor lifecycle fit | Primary owner with resumable local queue | Appropriate with resumable background/foreground work |
| Keep a durable evidence ledger/history | Conflicts with the current no-storage decision | Primary owner after a separate privacy/storage decision | Primary owner after consent |
| Store API credentials or local-model configuration | Avoid bundled secrets; user config only | Primary owner using OS-protected storage | Primary owner using OS-protected storage |
| Compare evidence, detect duplicates, preserve citations | Small session preview only | Primary owner | Primary owner |
| Notifications and return-to-task workflow | Limited browser notifications; not adopted | Appropriate | Appropriate, subject to OS policy |
| Offline/local model execution | Small model only if bundle/runtime permits; not current direction | Strong fit | Device-dependent fit |
| Team sync or web-scale indexing | Not appropriate | Optional client of a separately consented service | Optional client of a separately consented service |

An App expands capability but does not create unlimited background execution.
Apple background processing can be interrupted and may run only under system
conditions. Android recommends WorkManager for persistent jobs, but timing is
still scheduled and long-running workers carry foreground-service and quota
constraints. Therefore the shared job contract must be checkpointed,
idempotent, observable, cancellable, and safe to resume on every platform.

Sources:

- [Apple `BGProcessingTask`](https://developer.apple.com/documentation/backgroundtasks/bgprocessingtask)
- [Apple App Groups](https://developer.apple.com/documentation/BundleResources/Entitlements/com.apple.security.application-groups)
- [Android persistent work](https://developer.android.com/develop/background-work/background-tasks/persistent)
- [Android receiving shared data](https://developer.android.com/training/sharing/receive)

## Architecture Options

### Option A: Extension-only investigation

The Extension keeps the current session-only task and adds user-triggered links
or a small evidence preview.

Advantages:

- no companion installation;
- smallest privacy and deployment change;
- useful for validating language and user intent.

Limits:

- service-worker, permission, navigation, and restart boundaries make a
  reliable multi-source workflow difficult;
- durable history would reverse the current no-storage decision inside a
  high-privilege browser component;
- secret management, large artifacts, and resumable jobs are a poor fit.

Recommendation: use only for a Phase 4A session prototype, not as the final
investigation architecture.

### Option B: Extension plus desktop native companion

The Extension acts as consented sensor and browser UI. After explicit approval,
it sends a bounded, versioned Investigation Request to an installed App through
native messaging. The App owns the job queue, evidence ledger, model calls,
credentials, deduplication, and durable results. The Extension receives compact
progress and result summaries or opens the corresponding App workspace.

Advantages:

- directly addresses MV3 lifetime and storage constraints;
- keeps browser extraction close to the source while moving durable work out of
  the extension security boundary;
- supports local/Edge AI, including the existing self-hosted model direction;
- can become a shared engine for Chrome, Safari, Firefox, and desktop imports.

Costs and risks:

- installer, native-host registration, updates, and cross-platform packaging;
- a new IPC security boundary that needs extension-ID allowlisting, schema
  validation, message-size limits, authentication, cancellation, and logging;
- direct App fetching does not inherit the browser's authenticated page state
  and must not silently bypass user consent or site policy.

Recommendation: preferred next architecture after the investigation plan proves
useful, starting with a synthetic native-messaging spike rather than raw page
data.

### Option C: Standalone App with share/import surfaces

The App accepts URLs, selected text, screenshots, PDFs, or images through share
extensions and system intents, then runs the same Investigation domain.

Advantages:

- durable workspaces, cross-source comparison, notifications, camera/PDF input,
  and mobile workflows;
- independent of one browser's extension APIs;
- cleanest home for history, corrections, exports, and multi-device features.

Limits:

- shared URLs often omit the live DOM, authenticated state, or exact selection;
- iOS and Android background work remains scheduled and interruptible;
- not a replacement for the browser Extension when fidelity to the current
  rendered page matters.

Recommendation: share the domain and runner interfaces with Option B. Treat the
Extension and App as complementary capture surfaces, not competing products.

### Option D: Cloud-first investigation service

A remote service performs retrieval, indexing, and synthesis.

Advantages:

- easiest web-scale retrieval and shared infrastructure;
- consistent runtime independent of client shutdown.

Limits:

- largest privacy, retention, abuse, cost, and compliance surface;
- raw browsing content leaves the device;
- creates a central service dependency before product usefulness is proven.

Recommendation: not the default. Add only as an explicit, separately consented
runner behind the same contract if local/native execution cannot meet a proven
need.

## Recommended Architecture

Use one domain with multiple capture surfaces and runners:

```text
Browser page / selection / shared URL / image
                    |
             consented capture
                    v
        Investigation Subject + Plan
                    |
          versioned Runner interface
           /          |           \
  session runner   native runner   optional cloud runner
     (preview)       (preferred)       (explicit opt-in)
           \          |           /
                    v
       Evidence Ledger + Sufficiency
                    |
       user-reviewable Finding / Export
```

The Extension does not send raw whole-page content merely because the native
App is installed. Handoff must be explicit and disclose what will be sent and
whether the App will retain it. Prefer the smallest useful payload: exact claim
span, required nearby context, source metadata, and a content fingerprint.
Screenshots, full page text, authenticated content, and attached files require
separate confirmation.

The Runner interface should be transport-agnostic and support:

- schema version and capability negotiation;
- idempotency key and source snapshot fingerprint;
- bounded inputs and artifact references;
- progress checkpoints rather than an open promise;
- cancellation, expiry, retry, and resumable status;
- explicit privacy/storage mode;
- evidence and finding provenance;
- deletion and correction events.

## Evaluation Before Another Holdout

Do not use candidate v1/v2 holdouts or create a new release holdout for this
research iteration. Use development-only material and public synthetic fixtures
to settle the contract first.

### A. Investigation-plan audit

Start with 30 development samples: 15 original Facebook examples and 15 news
pages, balanced across zh-TW and English where available. Keep raw inputs and
per-sample outputs in the private evaluation control plane.

Human-review dimensions:

- check-worthy precision;
- atomic and self-contained proposition rate;
- attribution and modality fidelity;
- temporal and quantity scope fidelity;
- literal-question coverage;
- contextual/counter-evidence question usefulness;
- query answerability and absence of vague pronouns;
- unsafe action rate and correct abstention.

### B. Manual evidence-retrieval pilot

After the plan contract stabilizes, choose 12 development claims (6 Facebook,
6 news). Compare three routes:

1. the current single search query;
2. decomposed question-driven retrieval;
3. authority/document-first retrieval: identify the institution that can answer
   the atomic question, locate its announcement, report, dataset, or official
   record, then extract an exact answering passage.

Review:

- relevant-evidence recall;
- primary-source and independent-source rate;
- counter-evidence coverage;
- temporal leakage;
- syndicated-source deduplication;
- questions left unanswered;
- time to a useful, inspectable evidence set.

No route may emit a verdict from search snippets alone.

The completed runtime-neutral v2 contract keeps the three pilot routes for
comparison and adds `adaptive_evidence_cascade` as an inspectable step graph:

1. decompose the subject into answerable investigation questions and sanitize
   candidate queries;
2. use search results only to discover the responsible authority;
3. locate and fetch the canonical announcement, report, dataset, law, or other
   primary document;
4. extract an exact answering passage from the fetched document;
5. assess evidence sufficiency separately;
6. only when primary evidence is unavailable or insufficient, run a secondary
   document path marked `evidenceQualityDowngrade=true`.

Both paths require a fetched document before an exact passage can become
evidence. Search snippets are explicitly `discovery_only` and cannot become an
Evidence Artifact or support a finding. This is a contract and fixture boundary;
the Chrome Extension does not execute the graph yet.

### C. Sufficiency and UX audit

Using the collected development evidence, test whether the system correctly
chooses `insufficient`, `conflicting`, or `not_yet_verifiable` and whether each
synthesis sentence is traceable to an exact excerpt. Compare an evidence-first
UI against an AI-summary-first UI for user time, source opening, correction,
and over-reliance.

### D. Platform resilience audit

With synthetic data only, test both a session runner and a native-runner spike
across:

- service-worker suspension;
- Side Panel close/reopen;
- tab navigation and tab close;
- browser restart and extension update;
- native App restart or crash;
- duplicate submission and retry;
- cancellation and deletion;
- oversized-message rejection;
- permission denial or revocation.

Only after the domain contract, structured-output stability, useful-action
coverage, evidence sufficiency, and platform-resume behavior clear development
gates should a fresh, independently labeled holdout be frozen.

## Execution Sequence

1. Keep the release UI disabled and preserve the current fail-closed v3 guard.
2. Add model-neutral `InvestigationSubject`, `InvestigationPlan`,
   `EvidenceArtifact`, and `EvidenceSufficiency` contract fixtures without
   wiring runtime UI.
3. Run the 30-sample investigation-plan audit and revise the contract using only
   development data.
4. Test gx10 constrained JSON schema/grammar against the settled plan schema;
   measure valid-first-response rate separately from semantic quality.
5. Run the 12-claim manual retrieval pilot and define source-role,
   deduplication, temporal, and counter-evidence policy.
6. Prototype an evidence-first result surface with synthetic fixtures; do not
   add an automatic verdict.
7. Build a synthetic native-messaging spike that demonstrates capability
   negotiation, resumable status, cancellation, and bounded envelopes.
8. Decide whether the first product slice remains Extension-only Phase 4A or
   requires the companion App before release.
9. Freeze a release candidate and new rubric only after those decisions.
10. Collect and evaluate a fresh holdout once, preserving the existing private
    data and anonymized-report boundary.

## Open Decisions

- Whether an Investigation Subject requires explicit user confirmation after
  the model/local guard selects it, or whether clicking `開始查核` is sufficient.
- Which source roles and minimum independence rules vary by consequence domain.
- Whether the first companion is macOS-only, cross-platform desktop, or a
  shared core embedded in both desktop and mobile Apps.
- Whether durable workspaces default to local encrypted storage or require
  per-investigation retention consent.
- Which web-search and full-document retrieval adapters can run without paid
  APIs and without centralizing raw browsing data.
- How corrections propagate from a changed source or user-edited claim while
  retaining an auditable prior snapshot.
