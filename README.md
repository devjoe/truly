# Truly

梳理

Truly is a local-first Chrome extension for improving reading clarity in social
feeds and web pages.

Truly is in Alpha. The current build focuses on Facebook reading surfaces, while
the product direction is broader than any single platform.

## Preview

<p>
  <img src="docs/assets/mockups/heads-up-feed.png" alt="Reading hint inside a synthetic feed" width="31%">
  <img src="docs/assets/mockups/heads-up-expanded.png" alt="Expanded reading summary" width="31%">
  <img src="docs/assets/mockups/side-panel-reading.png" alt="Deep reading side panel" width="31%">
</p>

## What It Does

- Shows compact reading hints before supported posts.
- Expands into a short summary and reading signals when you ask for more.
- Opens a side panel for deeper context, follow-up questions, and manual
  external-tool handoff.
- Checks Traditional Chinese language conventions when enabled and applicable.

## Privacy Model

- Truly does not operate a project-owned backend for feed content.
- Reading analysis runs in the model environment you choose.
- External tools receive content only when you explicitly click an external
  action.

See `docs/release/privacy-policy.md` for the release-facing privacy policy.

## Current Alpha Scope

- Chrome Manifest V3 extension.
- Browser-local, local endpoint, or private endpoint model sources.
- Current UI support is focused on Facebook reading surfaces.
- Public tests use synthetic fixtures only.

## Development

```bash
npm ci
npm run check:public
npm run build
```

For local extension reload shortcuts during development:

```bash
npm run build:dev
```

Create a local Alpha artifact:

```bash
npm run release:alpha
```

`release:alpha` writes ignored artifacts under `artifacts/alpha/`.

## License And Notices

Truly is licensed under Apache-2.0.

Truly bundles zhtw-mcp for Traditional Chinese language-convention checks. See
`THIRD_PARTY_NOTICES.md`.
