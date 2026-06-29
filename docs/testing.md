# Testing

Truly's public test suite uses synthetic fixtures only.

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
before adding it to the public suite.

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
