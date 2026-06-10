# Permission And Host Permission Justification

Last updated: 2026-06-10

This document explains why Truly requests each Chrome permission and host
permission. It should stay aligned with `src/manifest.json`.

## Chrome Permissions

| Permission | Why Truly needs it | User-facing behavior |
|---|---|---|
| `storage` | Persist extension settings, readiness state, theme/language choices, model configuration, and user preferences. | Options, Popup, Heads-up, and Side Panel stay in sync across sessions. |
| `activeTab` | Use temporary access after a user gesture when the extension needs to interact with the current tab. | Popup and user-triggered actions can operate on the active Facebook page without broad tab history permissions. |
| `sidePanel` | Render the reading side panel through Chrome's Side Panel API. | The user can open a dedicated reading panel for the current post. |

## Static Host Permissions

| Host permission | Why Truly needs it | Boundary |
|---|---|---|
| `*://*.facebook.com/*` | Inject the reading UI and read supported Facebook post/page structure. | Used only for supported Facebook reading surfaces. |
| `*://*.fbcdn.net/*` | Read Facebook-hosted media or asset context needed for image-aware analysis and display. | Used only as context for the current Facebook reading surface. |
| `http://localhost/*` | Support local model endpoints during local-first use and development. | User-configured model calls only. |
| `http://127.0.0.1/*` | Support local model endpoints exposed on loopback. | User-configured model calls only. |

## Optional Host Permissions

| Optional host permission | Why Truly may request it | Boundary |
|---|---|---|
| `http://*/*` | Support a user-configured HTTP model endpoint outside the default localhost hosts. | Requested only when the configured endpoint requires it. |
| `https://*/*` | Support a user-configured HTTPS model endpoint outside the default hosts. | Requested only when the configured endpoint requires it. |

Truly should request optional endpoint permissions at save/test time for the
specific user-configured endpoint. It should not request broad optional host
permission unless the configured provider path needs it.

## Content Security Policy

| CSP item | Why Truly needs it | Boundary |
|---|---|---|
| `script-src 'self' 'wasm-unsafe-eval'` | Allows the bundled zhtw-mcp WASM language-convention checker to run locally in the extension. | Extension logic remains bundled; model output is data, not executable code. |

If the zhtw-mcp WASM loader no longer requires `wasm-unsafe-eval`, remove it
before release.

## Permissions Intentionally Not Requested

Truly should not request these permissions unless a future decision record
changes the product boundary:

- `downloads`: Markdown download uses browser/local file APIs without the
  Chrome downloads permission.
- `history`: Truly does not read browsing history.
- `tabs`: Truly does not need broad tab enumeration for the current product.
- `webRequest` / `declarativeNetRequest`: Truly is not an ad blocker or request
  filtering extension.
- `clipboardRead`: Truly does not need to read clipboard contents.
