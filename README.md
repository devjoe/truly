<p>
  <img src="docs/assets/brand/truly-readme-lockup.svg?v=20260615" alt="Truly" width="262">
</p>

Truly is a local-first Chrome extension for reading social feeds and web pages
with more context.

It prefers browser-local or user-chosen local AI before cloud services.

Truly · 梳理: to comb through and clarify.

> **Early Preview:** desktop Chrome first, still changing quickly.

## Preview

<p>
  <img src="docs/assets/demo/truly-demo-balanced.gif" alt="Truly reading hints, expanded view, and side panel" width="100%">
</p>

Reading hints, expanded view, and side panel.

## What It Does

- Shows compact reading signals.
- Expands signals into summaries and reading cues.
- Opens a side panel with context, follow-up questions, and handoff tools.
- Checks Traditional Chinese wording with bundled zhtw-mcp when
  enabled.

## Early Preview Quick Start

Download the extension zip from the latest Preview release:

<https://github.com/devjoe/truly/releases>

Unzip it. Then open `chrome://extensions`, enable Developer mode, choose **Load
unpacked**, and select the unzipped extension folder.

After installation:

1. Open Options.
2. Start with Chrome built-in Gemini Nano, or configure Ollama / an
   OpenAI-compatible endpoint.
3. Open a supported page in desktop Chrome.
4. Use the reading hint, expanded view, or side panel.
5. Send feedback through <https://trulyreader.org/feedback/>.

Chrome Web Store install links will be added later.

## Roadmap

**Now**

- Public early preview and feedback.
- Bug fixes and stability.

**Next**

- Comment analysis support.
- More social feed surfaces.
- A lightweight universal mode for regular web pages.

**Later**

- Mobile-friendly reading workflows.
- Social collaboration features, such as shared signals for suspicious accounts
  or posts.

## Current Scope

- Chrome Manifest V3.
- Browser-local, local, or private model sources.
- UI support currently focuses on Facebook reading surfaces.
- Public tests use synthetic fixtures.

## Model Sources

Start with Chrome built-in Gemini Nano. Use another model source when you want a
stronger local or private endpoint.

| Source | Best first use | Main caveat |
| --- | --- | --- |
| Chrome built-in Gemini Nano | Zero-configuration preview testing | Availability depends on Chrome-managed model requirements and downloads. |
| Ollama | Local model experiments | Requires local service setup and extension access to the endpoint. |
| OpenAI-compatible endpoint | Stronger private endpoints | Deep reading requires compatible model and response-format support. |

See [Model Setup](docs/model-setup.md).

## Current Limitations

- Truly is not a fact-checking authority.
- Model output can be wrong, incomplete, or biased.
- Site support is limited.
- Some features depend on model availability.

## Privacy At A Glance

| Question | Answer |
| --- | --- |
| Does Truly run its own backend? | No project-owned backend or telemetry for feed content. |
| When can content leave the browser? | When your selected model source or an external action requires it. |
| What does Truly store? | Chrome extension storage in your browser profile: settings, readiness state, configured model endpoint URLs, and model names. |
| Who receives external-tool content? | Only destinations you explicitly choose, such as search, Meta AI, clipboard, or downloads. |

See `docs/release/privacy-policy.md` for the release-facing privacy policy.

## Feedback And Contributions

For early preview feedback, use <https://trulyreader.org/feedback/>.

Use GitHub Issues for reproducible bugs, screenshots, logs, or visible technical
problems. Pull requests are welcome for small fixes, docs, and public tests.
Open an issue before large features or platform expansion work.

For security issues, follow `SECURITY.md`.

## Development

```bash
npm ci
npm run check:public
npm run build
```

To load a local build, open `chrome://extensions`, enable Developer mode, choose
**Load unpacked**, and select `dist/`.

For a watch workflow while developing:

```bash
make dev-all
```

This runs the Vite watch build and the local reload server. Load `dist/` once;
the dev service worker will reload the extension when `dist/build-id.txt`
changes.

For a one-off local build with the development reload shortcut patched into the
manifest, run `npm run build:dev`.

Use `npm run test:unit:watch` while working on focused tests. If you edit
`src/content_scripts/heads-up-styles.css`, run `npm run sync:headsup-css`
before building.

Create a local Alpha artifact:

```bash
npm run release:alpha
```

`release:alpha` writes ignored artifacts under `artifacts/alpha/`.
The extension zip is kept clean for Chrome Web Store review. Public-safe
development scripts and the Makefile can remain in the GitHub source package.

## License And Notices

Truly is licensed under Apache-2.0.

Truly bundles zhtw-mcp for Traditional Chinese language-convention checks. See
`THIRD_PARTY_NOTICES.md`.
