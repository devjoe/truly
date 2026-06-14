# MV3 Remote-Code And CSP Compliance Note

Status: Alpha readiness note
Last updated: 2026-06-14

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
`declarativeNetRequest`. Optional host permissions are reserved for
user-configured model endpoints and should be requested only when the user saves
or tests an endpoint that needs that origin.

## Page Bridge Boundary

The page-context GraphQL interceptor and isolated content script communicate
through `window.postMessage`. The bridge is same-page only:

- messages are posted to `window.location.origin`, not `"*"`;
- listeners require `event.source === window`;
- listeners require `event.origin === window.location.origin`.

This keeps the bridge usable for the page/content-script split while rejecting
cross-origin window messages.
