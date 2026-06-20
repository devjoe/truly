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
