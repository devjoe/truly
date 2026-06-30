# General Page Reader Parser Route

Status: accepted planning decision
Date: 2026-06-29

## Decision

Adopt a parser-neutral contract-hardening route before runtime parser adoption.

This means:

- keep Truly's heuristic/status gate as the first runtime layer;
- keep `@mozilla/readability`, `defuddle`, and `defuddle` Markdown as dev-only
  benchmark engines for now;
- define a parser adapter output contract before choosing a default parser;
- do not connect any third-party parser directly to content scripts;
- require an offscreen/runtime execution design before any parser dependency
  moves from dev-only spike usage into extension runtime;
- require bundle size, MV3 CSP, license notice, and release-bundle audits before
  runtime adoption.

The rejected framing is "adopt a hybrid parser route" because it suggests a
premature commitment to both Readability and Defuddle in the product runtime.
Evaluation v2 proves candidate-comparison readiness, not parser-runtime
approval.

Decision report:

```text
tmp/grill-reports/general-page-parser-route-2026-06-29.html
```

## Why This Route

Evaluation v2 now gives enough evidence to compare parser candidates:

- 25 public-safe synthetic fixtures;
- 20 pattern catalog entries;
- every pattern covered by at least one fixture;
- every pattern moved to `observed-category` through aggregate-only private
  observation evidence;
- parser spike threshold passing for Readability, Defuddle, and Defuddle
  Markdown.

That evidence is still not enough to move third-party parser code into runtime.
The remaining risk is not whether parser libraries can parse synthetic pages;
the remaining risk is whether Truly can preserve its product contract in a
browser extension:

- extraction status and warnings must be Truly-owned;
- blocked/list/social/shell pages must not be treated as complete articles;
- selected/current-region targeting remains separate from whole-page article
  extraction;
- parser HTML or Markdown remains page-owned input;
- content-script bundle and CSP constraints must stay explicit.

## Next Implementation Slice

The next code slice should not import parser libraries into runtime. It should
continue hardening the testable adapter boundary started in
`scripts/lib/general-page-parser-contract.mjs`.

Completed in the dev/test spike layer:

- `GeneralPageParserCandidate` and `GeneralPageParserResult` are documented as
  JSDoc contracts in `scripts/lib/general-page-parser-contract.mjs`.
- Readability, Defuddle, and Defuddle Markdown are now registered as parser
  candidates with stable ids, labels, roles, package metadata, version, and
  license fields.
- Spike output now normalizes candidate result metadata and candidate-specific
  diagnostics before threshold evaluation.
- The spike now maps Truly's actual runtime heuristic extractor as the
  `truly-heuristic` `runtime-baseline` candidate through a dev-only TypeScript
  transpile loader. This compares the real project baseline without importing
  third-party parser dependencies into runtime code.
- Evaluator output now records metadata completeness, extraction-status
  suitability, warning-family suitability, and bad-page false-positive
  suitability in addition to text hit score, leak count, duration, and parser
  threshold status.
- Parser spike exit status now requires both text thresholds and
  `runtime-baseline` suitability gates to pass.
- Evaluation v3 hardens Truly's heuristic status/warning classifier for
  readable non-article pages, including forum threads, social public pages,
  list/search indexes, blocked pages, and client-shell bad pages.
- The public synthetic fixture corpus now has 35 fixtures, and the private
  real-world evaluation runner scaffold writes sanitized parser/runtime metrics
  under `tmp/` without committing target URLs, HTML, text, excerpts, screenshots,
  or DOM snapshots.
- V4 real-world follow-up hardens structural list/index detection for dense
  homepage/card-grid pages; the private batch rerun had no runtime-baseline
  suitability failures.
- Parser dependencies remain dev-only and are still not imported by extension
  runtime code.

Remaining adapter-boundary work:

1. Add bundle/CSP/offscreen TODO gates as explicit acceptance criteria before
   runtime adoption.
2. Keep `src/lib/general-page-extraction.ts` as the runtime baseline until a
   separate runtime-integration decision accepts a parser dependency.

## Runtime Non-Goals For This Decision

- No direct parser import in content scripts.
- No default parser selection.
- No model call changes.
- No inline current-region UI.
- No Threads adapter.
- No extension permission changes.

## Acceptance Gate For Future Runtime Adoption

A later parser-runtime decision must prove:

- parser adapter output maps cleanly to `ReadingSurface`;
- blocked/list/social/shell pages produce correct status/warnings;
- bundle delta is acceptable in release artifacts;
- MV3 CSP and execution context are verified;
- license notices are handled;
- fallback heuristic behavior remains available;
- parser result rendering is text-first or sanitized;
- current-region targeting remains independent.
