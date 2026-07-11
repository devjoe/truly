# Truly Reading Context

Truly helps people inspect information quality in social feeds and ordinary web
pages. This language keeps extraction, analysis scope, and Side Panel behavior
consistent across product, runtime, tests, and review artifacts.

## Language

**Reading Surface**:
The page- or post-level content Truly can inspect, together with its source,
identity, extraction status, and warnings.
_Avoid_: Document payload, scraped page

**Page Reading Session**:
The session-only state for one browser tab and one meaningful page identity. It
owns the Reading Surface plus independent Web and Focus analysis scopes.
_Avoid_: Page history, saved article

**Web Workspace**:
The Side Panel view that explains the current Reading Surface as a whole page.
_Avoid_: Page mode, reader mode

**Focus Workspace**:
The Side Panel view that explains an explicitly selected Reading Target without
showing whole-page context as if it were the analysis subject.
_Avoid_: Selection mode, local mode

**Reading Target**:
An explicitly selected passage or current-region paragraph analyzed inside a
Page Reading Session.
_Avoid_: Highlight, snippet

**Page Context**:
The collapsible evidence Truly extracted from the whole Reading Surface,
including user-impact guidance, page text, source links, and technical details.
_Avoid_: Details, diagnostics card

**Reading Context**:
The concise model-assisted overview, checks, and follow-up questions presented
for the active Web or Focus analysis scope.
_Avoid_: AI summary, page brief

**Analysis Scope**:
The Web or Focus slot that owns advisor, analysis, screenshot, and target state
for a Page Reading Session.
_Avoid_: Mode state, active result

**Meaningful Navigation**:
A URL or document-identity change that makes the prior Reading Surface unsafe to
reuse. Hash-only and tracking-only changes are not meaningful navigation.
_Avoid_: Any URL change, refresh

**Reading Command Envelope**:
A consume-once, session-only instruction that identifies the tab, requested
reading action, request identity, and creation time without storing page text or
analysis output.
_Avoid_: Reading result cache, event queue

**Reading Analysis Coordinator**:
The Side Panel Module that plans model analysis for an Analysis Scope, including
eligibility, request identity, provider command, stale-result acceptance, and
success or error settlement. Ordinary text analysis and confirmed screenshot
analysis use the same Interface.
_Avoid_: Model helper, request wrapper
