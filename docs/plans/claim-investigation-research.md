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

- enable a Truly Agent investigation action for release;
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

#### Case-level discovery correction (2026-07-15)

The adaptive pilot exposed a category error in the graph above: an atomic
verification question is the unit used to judge evidence, but it is often too
narrow to be the unit used to discover a document. Searching each atomic
question independently produced pages with lexical overlap while missing the
announcement, record, dataset, ruling, event result, or product document that
could answer several sibling questions together.

The development-only architecture now separates:

1. `InvestigationCase`: the shared event frame and question set;
2. `InvestigationDiscoveryPlan`: document-family targets, authority hints, and
   a query portfolio; one target may cover multiple questions;
3. `InvestigationVerificationRequirement`: the actor, predicate, object,
   attribution, time, place, and quantity facets an answering passage needs;
4. `EvidencePassageAssessment`: a fetched excerpt plus an exact answer span and
   covered/missing facets;
5. `EvidenceSufficiency`: conservative aggregation after shared-origin
   deduplication, with no finding or truth verdict.

The case route searches once per document target, fetches a selected document
once, and only then fans out into per-question passage extraction and
sufficiency assessment. A fallback target cannot be the only path for a
question. Verdict-seeking queries, unresolved relative-date placeholders,
private-record requests, and generic use of legal rulings fail closed.

`claim_origin` is permitted only when a question asks what the source said,
attributed, or characterized. It can establish the source wording but cannot
independently establish the underlying real-world proposition.

The first 12-row development audit used 6 Facebook and 6 news subjects. Eight
model-generated case plans passed the current local guards; four needed human
overrides and were preserved as reviewed private fixtures. A discovery-only
search of the first non-fallback target found an evidence-bearing document
candidate for 9/12 cases and a preferred primary-document candidate for 6/12.
Three cases had only a secondary-document candidate and three cases had no
useful result. These are search-stage observations, not answering-passage or
sufficiency results, and are not directly comparable to the previous
full-document passage-candidate metric. Raw inputs, queries, URLs, and row-level
decisions remain in the private evaluation control plane.

This result authorizes a bounded full-document replay over the reviewed
development fixtures. It does not authorize a product action, Extension UI,
new holdout, verdict, or persistence.

#### Bounded full-document replay (2026-07-15)

The 12 reviewed development cases were replayed with nine manually selected
document candidates. Eight documents were fetched and one secondary legal
database candidate rejected the Node audit client with HTTP 403. Fetching once
per document target produced nine passage candidates across six cases.

Manual facet-level assessment admitted only two passages as qualifying evidence:
one primary public-health rule and one primary agricultural data passage. None
of the 12 cases reached `sufficient`, because every case still had unanswered
sibling questions or an unmet source requirement. Six cases were
`insufficient`; six were `not_yet_verifiable`. Search snippets admitted as
evidence and truth verdicts produced both remained zero.

The replay confirms that document discovery and atomic verification must remain
separate. It also exposes the next retrieval bottleneck: a fetched official
document can contain the requested fact while a lexical passage selector picks
a nearby generic sentence instead. Improving passage proposal should therefore
use the question's required facets and a bounded local context window before
any model-based evidence assessment. It must not relax sufficiency guards or
convert search snippets into evidence.

A bounded v2 passage proposal added a hard numeric-signal requirement for
quantity questions and a limited neighboring-paragraph window. On the same
documents it increased passage candidates from 9 to 11 and qualifying evidence
from 2 to 3, recovering the official postal-service quantity passage. The case
states did not become more optimistic: 6 remained `insufficient`, 6 remained
`not_yet_verifiable`, and 0 were `sufficient`. A secondary Dynaudio passage that
answered one question still failed the primary-source requirement, while a
different-arrest timeline passage remained incomplete after timeline and
quantity questions were locally required to bind actor, predicate, object, and
time or quantity. This is the intended separation between recall improvement
and evidence admission.

#### Candidate-depth and typed-obligation replay (2026-07-15)

Round 1 tested ranked candidate depth rather than immediately shipping an
adaptive scheduler. The same 12 reviewed development cases (6 Facebook and 6
news) received 49 human-reviewed public-document candidates, capped at three
candidates per target and twelve per case. Forty-three documents were fetched;
the explicit failures were four PDFs that exceeded or lacked the bounded PDF
capability and two access-denied pages. Search-result snippets remained outside
the evidence ledger.

The current-code replay produced 62 passage candidates. Complete manual review
admitted 15 evidence artifacts across 5/12 cases, compared with 3 artifacts
across 3/12 in v2. Rank-one documents contributed eight qualifying artifacts,
rank two contributed five, and rank three contributed two. No case depended
exclusively on rank-two or rank-three evidence. Deeper candidates therefore
improved corroboration but did not expand case coverage; broader target and
document-family discovery mattered more than a deeper generic scheduler.

The conservative `EvidenceSufficiency` state remained non-releaseable: 11 cases
were `insufficient`, one was `not_yet_verifiable`, and none was `sufficient`.
The parallel typed-obligation prototype marked all 12 cases `collecting`; only
10/54 mandatory obligations were satisfied. Remaining blockers were 14 missing
answering-evidence obligations, 19 independent-origin shortfalls, and 12
counterevidence searches without a coverage receipt. A receipt can close a
bounded search obligation but cannot create evidence, prove absence, or produce
a verdict.

The replay also hardened the audit infrastructure before scoring: origin
fallback now uses confirmed origin groups or publisher/domain rather than
content fingerprints; subset cases create obligations only for their own
questions; acquisition capability failures remain visible in progress;
response bodies stop at the byte bound; reused URLs survive case-budget
exhaustion; and review parts must cover the exact sample and artifact set.

Round 1 did not clear the development gate. The next round must start from the
observed blockers, not relax evidence admission or reuse a holdout. Its design
questions are whether to repair temporally invalid investigation questions,
which PDF or rendered-document capability is justified, how bounded
counterevidence search earns an auditable receipt, and when a canonical primary
record should replace rather than multiply a generic independent-origin
minimum.

#### Proof responsibility and coverage replay (2026-07-15)

Round 2 replaced the broad per-case risk profile with record-scoped proof
responsibilities. Canonical records may now answer only record-content or
record-existence questions and only when the source is primary; they do not
silently waive unrelated independent-origin requirements. A bounded coverage
receipt records hypotheses, source families, languages, time scope, aliases,
attempted documents, actions, and blind spots. A partial receipt remains
pending and can never create evidence or prove absence.

The private evaluator also gained a text-layer-only PDF adapter with explicit
page, character, byte, and time bounds. It does not render pages or run OCR.
Across the same 12 development cases, 49 documents produced 64 manually
reviewed passage artifacts, including four PDF passages. Fifteen artifacts
qualified across five cases. Mandatory obligations improved from 10/54 to
15/45 because proof responsibilities removed invalid generic minima and six
bounded coverage receipts were complete. The remaining blockers were 14
missing-answer obligations, 11 origin shortfalls, and six incomplete searches.
All 12 cases remained `collecting`; no finding, verdict, product action, or
holdout authorization was produced.

#### Immutable block-pointer recovery replay (2026-07-15)

Round 3 tested whether gx10 could recover answering text missed by the lexical
passage selector without allowing the model to quote, rewrite, or admit
evidence. Each fetched document was split into locally fingerprinted contiguous
blocks. The model could only return a question ID, a bounded block range,
covered facets, or an abstention. The evaluator reconstructed the exact source
text locally and retained human admission as a separate step.

The first transport attempt exposed an unsupported `uniqueItems` grammar key;
the transport schema removed that redundant keyword while the local guard
continued rejecting duplicate facets. A second issue came from constrained
grammars filling candidate-only fields on abstentions. The parser now discards
those fields when `status=abstain`; question-ID mismatches, stale fingerprints,
invalid block windows, invented facets, and candidate pointer errors still fail
closed.

On 33 document/question groups, 27 completed, four failed the pointer contract,
and two documents exceeded the bounded input. The model proposed one exact
span and abstained on 34 question/document pairs. Human review found the span
relevant to an identity question, but its independent-secondary source could
not satisfy the question's primary-source responsibility. Mandatory obligation
rescue was therefore zero. The round preserved all safety invariants but did
not clear the causal development gate. The main bottleneck is no longer finding
missed text inside the current documents; it is acquiring answerable source
families under fair, auditable budgets.

#### Equal-budget source-first paired replay (2026-07-15)

Round 4 compared the existing atomic-query route with a source-first route on
24 unresolved answer or origin obligations from the same private development
cases. Both routes were frozen before search and received at most two queries
and three opened documents per trial. Search snippets remained discovery-only.
Candidate passages were stripped of route labels and reviewed independently by
two reviewers before route outcomes were compiled.

The replay produced 48 scored route executions. After question-scoped review,
the two routes shared three rescued answer obligations; neither route had an
exclusive rescued obligation. Twenty-one trials remained unresolved. No origin
shortfall was rescued. The source-first candidate therefore had zero
candidate-preferred cases and did not establish a causal gain over the atomic
baseline.

The audit compiler also found three contract problems that the pre-review
aggregate had hidden:

- one route proposal had no corresponding blind-review packet;
- two candidate occurrences were reused for a different question than the one
  independently reviewed;
- multi-passage and origin claims had only passage-level review, not a blind
  review of the complete proof obligation.

Two trials contained candidate-admission disagreement, affecting two cases,
and one case had an explicitly excluded post-budget query deviation. The frozen
development gate result was therefore `safetyPass=true`,
`evidenceUtilityPass=false`, `processCapabilityPass=false`, and `pass=false`.
The three accepted rescues covered Facebook and news, but only the
`missing_answering_evidence` blocker; the gate requires multiple blocker types,
at least two candidate-preferred cases, and zero reviewer disagreement.

This round demonstrates bounded retrieval capability and confirms that
source-first discovery can reach useful documents. It does not establish an
incremental route advantage. The next round must not add more generic search
depth. It must decide how a question-scoped evidence set, shared-origin
lineage, temporal entailment, and review adjudication become one inspectable
proof object without relaxing evidence admission.

#### Proof-certificate and proof-slot acquisition replay (2026-07-15)

Round 5A first isolated the proof compiler from retrieval. Five real private
development fixtures covered Facebook and news, answer and independent-origin
proofs, one shared-origin negative, and five witness-withholding checks. All
expected admissions and rejections matched: false closure and false rejection
were both zero. This contract-only gate authorized the matched acquisition
experiment, not development promotion, holdout use, product UI, or a verdict.

Round 5B then froze six unresolved obligations before search: three Facebook
and three news trials, including the only independent-origin target. Generic
atomic search and proof-slot source-family acquisition received equal limits of
two queries and three opened documents per route. The audit retained exact
spans, measured document access within the frozen byte/time ceilings, and used
two route-blind reviewers. The reviewers agreed on all five submitted
certificate decisions; incomplete but relevant official text stayed rejected.

The causal acquisition-only analysis gave both arms the same proof-certificate
compiler. It found one candidate-only rescue, one candidate-preferred case, one
rescued blocker type, and improvement on news only. A second diagnostic compared
the older passage-only stack with the certificate-plus-targeted stack. It found
two rescues and two candidate-preferred cases, but both improvements were still
news answer obligations; there was no Facebook or independent-origin rescue.
The diagnostic is not promotion-eligible because it combines compiler and
acquisition changes.

Both analyses preserved the safety and process gates: no search snippet became
evidence, no verdict was produced, false closures and regressions were zero,
and reviewer disagreement was zero. Both failed the unchanged evidence-utility
gate. Round 5 therefore does not authorize a product action, a release
candidate, or a new holdout. It establishes two narrower results: a complete
proof may legitimately require multiple exact spans from one origin, and a
source-family query can find a canonical record missed by generic search. It
does not show that proof-slot search reliably handles Facebook claims or
independent-origin requirements.

The next design phase should treat a search query as a document-discovery
instrument rather than a serialized claim. It should model discovery context
(subject, event, date/place, source family, language and aliases) separately
from proof obligations, and explicitly plan lineage-diverse origin acquisition.
That work requires a fresh development design and gate; it must not retune this
frozen Round 5 result or open the holdout.

#### Investigation Constitution and Discovery Planner v2 (2026-07-15)

The next development slice formalized the discovery/proof boundary in
ADR 0002. `InvestigationCase` v2 now carries retrieval-only discovery context;
proof obligations compile into conditional canonical, contextual, or
lineage-diverse route families; every route has a bounded budget and a stopping
receipt that is permanently non-evidentiary. Source lineage is explicit, and
Proof Compiler v2 permits multiple exact spans from one lineage to jointly
cover a proposition while requiring every counted lineage to independently
cover all required facets. Syndicated or derived artifacts cannot increase the
origin count.

A Grill-based architecture review rejected a universal three-route template.
The accepted policy is obligation-driven: canonical routes appear only for
canonical-record responsibilities, lineage-diverse routes only for independent
origin responsibilities, and contextual routes only when required or declared
as a genuine fallback. Search completion never satisfies a proof obligation.

The development cohort and paired-audit rule were preregistered before Planner
v2 output was inspected. All 30 private dev rows were accounted for; 14 had no
materialized checkworthy claim, and all 16 applicable rows produced valid
cases and route plans. Five bounded iterations corrected a lexical false
positive around Google as a product subject, removed ungrounded discovery
context, deduplicated obligation routes, aligned canonical responsibilities,
and made fallback and lineage paths explicit. On the frozen final iteration,
both independent reviewers accepted discovery-context grounding for all 16
cases. Route fit passed 13/16 and 14/16 respectively; two cases were rejected by
both reviewers, so planner semantics are improved but not yet release quality.
No unsafe action, evidence admission, verdict, product action, holdout use, or
persistent content history was added.

The preregistered matched audit then used 12 development cases, 23 answer or
origin obligations, 46 equal-budget route executions, one public-search query
and at most two opened documents per arm. It considered 276 search candidates,
fetched 84 documents, and extracted 63 exact passage candidates. The atomic
baseline produced 35 passage candidates and the SourceFamilyPlan candidate 28.
At the raw-passage level, 16 trials had candidates in both arms, four were
baseline-only, one candidate-only, and two in neither arm. After applying each
obligation's frozen minimum passage threshold (one for answering evidence and
the declared independent-origin minimum for origin trials), the conservative
proof-admission ceiling was 14 both, five baseline-only, two candidate-only,
and two neither. Search snippets remained excluded.

The frozen gate required at least three candidate-only rescues. Because proof
review can reject a passage but cannot create a route-only rescue where no
exact passage exists, the candidate-only proof ceiling was two: one answering
trial and one independent-origin trial. The gate was
therefore mathematically unreachable before evidence admission. The evaluator
stopped without sending the 63 excerpts to another model, issuing a proof
certificate, running a route-preference review, or producing a verdict. This is
a failed candidate, not an inconclusive proof review: the obligation-driven
contract is sound, but the current one-query SourceFamilyPlan does not beat the
atomic baseline on this frozen real-data cohort.

The immutable matched-search log was upgraded locally, without another public
search request, into 46 typed route receipts. Every receipt is validated against
its acquisition route, records non-exhausted candidates as a budget stop rather
than false family exhaustion, and fixes `evidenceProduced` and
`verdictProduced` to false. The final two-reviewer Planner v2 decisions are also
retained in a gitignored per-row ledger bound to the planner-output hash.

The next candidate must not retune these 30 rows or open the holdout. It should
focus on the two jointly rejected planner cases and on acquisition recall:
question-specific document-family selection, authoritative-site or registry
locators before open-web search, and lineage-diverse acquisition that finds a
second origin rather than appending generic independent-report wording. A new
development cohort or preregistered forward slice is required before another
causal comparison.

#### Source-aware Acquisition Candidate v1 (2026-07-15)

A new forward-development slice was preregistered before candidate output was
inspected. It excludes the v1 development rows and both existing holdouts. The
remaining private corpus supplied 16 new Facebook rows but no unused news rows,
so cross-surface acquisition remains explicitly unevaluated. The gx10 run used
the declared `qwen3.6-35b` model on those 16 Facebook originals; raw inputs,
model outputs and per-row review stayed under gitignored `private-data`, while
only anonymous aggregates were retained.

All 16 rows were accounted for: 12 had no materialized checkworthy claim and
four produced valid Investigation Case v2 plans. Three cases materialized
directly; one required an explicit local coverage repair that reused only the
frozen verification question and source-role contract. The repair exposed and
fixed a contract mismatch: the upstream `fact_check` role now maps to
`independent_secondary` at the narrower discovery-draft boundary instead of
leaking an unsupported enum or widening that boundary.

The candidate compiles every mandatory proof obligation into a distinct source
responsibility: canonical record, first-party answer, independent
corroboration or counterevidence discovery. A reviewed-locator catalog is the
only mechanism that may select a registry, authoritative domain index or direct
URL. Exact authority, source-family, document-kind, language and jurisdiction
matching is required. Missing coverage remains an explicit open-web fallback;
model output cannot create a trusted locator.

Human review found two important design errors before the final replay. First,
a primary press release or product page had been receiving canonical-record
entitlement merely because the question asked for an identity, date or number.
The conservative compiler now grants canonical status only when a primary
target explicitly asks for an `official_record` or `ruling`; ordinary company
material produces a first-party answer plus an independent-corroboration
responsibility. Second, independent routes could inherit first-party discovery
terms such as `official announcement` or `press release`. A narrow local guard
now removes those source-intent terms only for independent corroboration while
preserving grounded entities, events, products, numbers and dates.

The final private planning replay had four planned rows, zero invalid rows and
23 responsibility routes: 11 first-party answers, 11 independent-corroboration
routes and one counterevidence route. Human review accepted responsibility
coverage and document-discovery query alignment for all four planned rows.
None of the 11 independent routes retained first-party discovery intent, and
no trusted locator was invented. Because the catalog was intentionally empty,
all 23 routes remained explicit open-web fallbacks. No private-derived query
was sent to a public search service.

This is a positive architecture and planning result, not evidence of retrieval
lift. Synthetic catalog fixtures confirm that a reviewed registry can serve a
canonical responsibility while independent-origin discovery remains separate,
but synthetic execution cannot measure real-world recall. No evidence, proof
certificate, verdict, product action or holdout was produced. The next eligible
experiment requires a human-reviewed locator catalog and a new source-covered
development slice, including news, followed by a matched acquisition audit
against the frozen baseline. Until then the UI remains disabled.

#### Source-aware News Local Snapshot v1 (2026-07-15)

A second forward-development slice was preregistered after collecting 15 fresh
news pages through background CDP targets; 14 were new and 12 were selected by
the frozen stable-ranking rule. The reviewed locator catalog and its query-free
official-site snapshot were frozen first. Raw pages, catalog records, model
outputs, queries, documents and per-trial reviews remained gitignored; only an
anonymous aggregate report was retained in the private evaluation repository.

The investigation-plan contract exposed one real schema drift: `timeCutoff`
allowed any short string in constrained JSON while the local parser required a
parseable date. The schema and prompt now require `YYYY-MM-DD`. An atomic-only
development retry was also added without weakening grounding or compound-claim
guards. Final accounting was 11 valid claim plans from 12 rows and 10 valid
cases from 11 plans; the preregistered zero-invalid planning gate therefore did
not pass.

The reviewed catalog matched five responsibilities across three cases. The
paired audit used the same frozen 23-document snapshot for both arms, one local
query and at most two documents per arm. Baseline ranked the whole snapshot;
candidate ranked only documents bound to the matched catalog entry. No query
was sent externally, and neither arm produced evidence or a verdict.

Automated passage ranking proposed eight candidates per arm, but single-reviewer
question-answerability review admitted none. Generic ranking produced unrelated
numeric matches; source-aware routing found the intended authority but only a
shallow index or homepage, not an answer-bearing announcement or record. The
result was zero candidate-only answer rescues and zero false closures. Both the
planning gate and matched-acquisition gate remain failed; no holdout was opened
and no product action is authorized.

The next development slice should preserve the reviewed authority boundary but
replace shallow seed-page snapshots with bounded, authority-local document
discovery: dated announcement lists, record detail pages, datasets and PDFs.
The experiment must continue to freeze acquisition infrastructure before model
output, compare equal budgets, review exact passages rather than snippets, and
keep absence claims unproven unless the searched record scope is demonstrably
exhaustive.

#### Query-free Authority-local Sequential v1 (2026-07-15)

The follow-up candidate froze a generic traversal contract, three reviewed
authority profiles and a 138-document snapshot before opening a new 48-row
news-only development pool. Direct HTTP and background rendered-page adapters
shared the same page, depth, byte and host budgets. They accepted no claim or
private-derived query, never brought a browser page to the foreground, and
could not infer absence from budget exhaustion.

Claim representation improved materially. A constrained selector chose only
from locally enumerated exact, non-compound spans; the second-stage planner was
not permitted to rewrite that span. Across four sequential batches, 47/48
plans were valid and all 47 materialized. The one failure was a recorded
constrained-decoding length stop, not a grounding or compound-claim bypass.

The downstream system did not qualify for promotion. Investigation Case
materialization was 36/47, below the frozen 90% gate. Only six valid cases
produced 11 matched-catalog routes, and the equal-budget offline audit produced
12 automated passage candidates in each arm. Two independent reviewers agreed
on all 11 trials: baseline and candidate each admitted one answerable result,
with zero candidate-only rescues, zero net lift, two wrong-authority matches and
zero false closures. No query left the private process and no evidence or
verdict was produced.

The 48-row pool is now closed for tuning. Claim selection, Case compilation,
authority matching and canonical-document acquisition must be treated as four
separate stages. The downstream zero-lift result does not independently isolate
traversal quality because upstream coverage stopped at six matched cases and
two reviewed agencies. A future candidate requires a new preregistered
development slice; each stage advances only after its upstream gate passes,
including 12 matched cases and four reviewed agencies before answer-rescue
scoring. Confirmatory data and holdout remain closed. The full architectural
decision is recorded in
[ADR 0004](../adr/0004-query-free-authority-local-discovery.md).

#### Product action split and semantic Case compiler v3 (2026-07-16)

The user-triggered surface now treats three actions as different contracts
rather than one generic investigation query. Standard Google Search receives a
short claim-and-source keyword string. Google AI Mode receives a bounded
natural-language request containing the exact claim, verification question,
evidence need, source context, and instructions to distinguish evidence from
uncertainty. `查核選項` only reveals these explicit external actions; it is not
the name or trigger for the unreleased Truly Agent.

The non-runtime Agent compiler also adds a semantic v3 draft while retaining
the v2 draft for historical replay. The model no longer emits question IDs,
verification requirements, discovery queries, target IDs, or stopping
conditions. It chooses event/discovery context, document kinds, authority
hints, source roles, and zero-based question coverage. Local code maps those
indexes to the frozen plan, derives mandatory facets and acceptable roles,
reuses frozen query candidates, fills missing coverage without inventing an
authority, assigns stable IDs, and runs the existing deterministic validators.
The private Case-plan runner is prepared for this v3 contract, but no closed
development pool or holdout was reopened and no Agent runtime action is
authorized by this implementation.

#### Product semantic-action development baseline (2026-07-16)

The product-equivalent private runner now evaluates the Standard Reading Brief,
the Investigation Adapter, the unchanged local claim guard, and typed follow-up
actions as one pipeline. A frozen 30-row development replay completed 30/30
reading calls and 15/15 requested Adapter calls without parser or transport
failure. Fifteen rows emitted no claim; four became action-ready and eleven
prepared Adapter outputs were rejected by the local guard. No public search or
external action was opened.

Private review showed that the rejected rows were not constrained-decoding
failures. The Adapter usually preserved the candidate claim and added fields
instead of rebuilding one source-grounded proposition. Failures included atom
span paraphrases, compound claims, vague or generic subjects, and invalid
attribution. The Adapter prompt now treats the candidate as a clue, requires
verbatim ordered atom parts, selects only one consequential proposition, and
adds explicit low-risk abstention guidance. The local guard remains strict and
now exposes precise structure reason codes for private development audits.

An evaluation-only bounded semantic repair was then tested against the same old
30-row development slice. Eight repair requests produced zero accepted actions:
seven remained rejected by the unchanged guard and one ended in a format
failure. The apparent four-to-seven increase between separate runs came from
first-pass model variance, not from repair recovery. Product runtime therefore
returns to one Adapter attempt. `semantic_once` remains available only as an
explicit private diagnostic mode; the preregistered fresh audit requires
`repairMode=none` so its execution path matches runtime.

Independent review of the seven first-pass actions found five usable or
usable-with-tightening results, one underspecified comparison, and one false
action derived from a truncated related-link headline at the extraction tail.
The candidate now rejects labeled navigation sections and incomplete
tail-boundary fragments, rejects comparisons without a time, market or region,
and metric, and requires a named evidence family rather than generic
`evidence`. Regular Google search uses bounded claim/evidence anchors instead
of copying the whole claim or publisher name. Self-contained follow-up
questions no longer inherit an unrelated model summary; AI Mode alone may
receive sanitized page metadata and URL.

The private runner also verifies that each source hash is derived from the
actual input text, refuses to overwrite an evaluation path, and records exact
input and result digests. These changes improve evaluation integrity; they do
not authorize the Agent action or establish release-level coverage. The
updated old-development replay is the final tuning check before opening a
preregistered fresh cohort; fresh rows cannot be used for further tuning.

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

- Whether an Investigation Subject requires explicit user confirmation before
  a future `交給 Truly 查核` action starts the Agent; expanding `查核選項` is not
  sufficient and remains side-effect free.
- Which source roles and minimum independence rules vary by consequence domain.
- Whether the first companion is macOS-only, cross-platform desktop, or a
  shared core embedded in both desktop and mobile Apps.
- Whether durable workspaces default to local encrypted storage or require
  per-investigation retention consent.
- Which web-search and full-document retrieval adapters can run without paid
  APIs and without centralizing raw browsing data.
- How corrections propagate from a changed source or user-edited claim while
  retaining an auditable prior snapshot.
