# MV3 Remote-Code And CSP Compliance Note

Status: Alpha readiness note
Last updated: 2026-07-04

This note records the current Chrome MV3 compliance boundary for Alpha review.
It should stay aligned with `src/manifest.json`,
`docs/release/permission-justification.md`, and the packaged extension zip.

## Remote Code Boundary

Truly bundles extension logic with the extension package. The service worker,
content scripts, Options page, Popup, Side Panel, and shared runtime modules are
produced by the local Vite build and included in the release zip.

Model responses are treated as data. They can influence rendered reading
assistance, labels, summaries, questions, and external-tool prompts, but they are
not executed as JavaScript or loaded as remote extension code.

External web pages opened by user-triggered actions, such as Gemini search or
Meta AI, are normal browser tabs and not extension code.

## Content Security Policy

Current manifest CSP:

```json
{
  "extension_pages": "script-src 'self' 'wasm-unsafe-eval'; object-src 'self'"
}
```

`wasm-unsafe-eval` is retained for the bundled zhtw-mcp WASM
language-convention checker. The WASM asset is included under
`src/vendor/zhtw-mcp/` with its license preserved in `THIRD_PARTY_NOTICES.md`
and `src/vendor/zhtw-mcp/LICENSE`.

The vendored zhtw-mcp build may contain dormant `detect_ai` plumbing for future
evaluation, but Alpha uses the WASM only for local language-convention checks.
No zhtw-mcp AI-detection verdict is shown to users.

Remove `wasm-unsafe-eval` before release only if the bundled zhtw-mcp loader no
longer needs it.

## Permission Boundary

Truly does not request `downloads`, `history`, broad `tabs`, `webRequest`, or
`declarativeNetRequest`. `scripting` is limited to user-triggered current-page
reading under the `activeTab` boundary by default. Optional host permissions are
reserved for explicit user actions: user-configured model endpoints, or the
General Page all-sites Settings opt-in that lets the Side Panel read the current
page when the user presses a read/analyze action. This does not enable background
crawling, automatic model submission, or persistent full-article storage.

## Security Follow-ups

## CI Supply-Chain Boundary

GitHub Actions workflows pin third-party actions to commit SHA refs instead of
mutable version tags. The pinned refs keep CI and artifact generation
reproducible for review. Dependabot is configured for both `npm` and
`github-actions` updates so action updates happen through reviewable pull
requests instead of silent tag movement.

`npm run check:public-boundary` rejects external workflow actions that are not
pinned to a 40-character commit SHA.

### Endpoint URL credentials and cleartext HTTP

Current boundary: model endpoint URLs are user-configured settings. Users should
not put API keys, bearer tokens, or other secrets in endpoint URLs. Extension
storage is not a secret vault, and non-loopback `http://` endpoints can send
traffic in cleartext.

Follow-up: add stronger Options-page guidance and consider separating endpoint
URLs from credentials with a dedicated masked credential field. Also prefer or
warn toward `https://` for non-loopback endpoints while continuing to support
local HTTP endpoints such as `localhost` and `127.0.0.1`.

## Page Bridge Boundary

The page-context GraphQL interceptor and isolated content script communicate
through `window.postMessage`. The bridge is same-page only:

- messages are posted to `window.location.origin`, not `"*"`;
- listeners require `event.source === window`;
- listeners require `event.origin === window.location.origin`.

This keeps the bridge usable for the page/content-script split while rejecting
cross-origin window messages.
