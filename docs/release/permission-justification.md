# Permission And Host Permission Justification

Last updated: 2026-07-24

This document explains why Truly requests each Chrome permission and host
permission. It should stay aligned with `src/manifest.json`.

## Chrome Permissions

| Permission | Why Truly needs it | User-facing behavior |
|---|---|---|
| `storage` | Persist extension settings, readiness state, theme/language choices, model configuration, and user preferences. | Options, Popup, Heads-up, and Side Panel stay in sync across sessions. |
| `activeTab` | Use temporary access after a user gesture when the extension needs to interact with the current tab. | Popup and user-triggered actions can operate on the active page without broad tab history permissions. |
| `scripting` | Inject the general page reader content script for the active tab after a user action, or while the Side Panel is open after the user enables optional all-sites access. | The user can explicitly read the current web page without broad install-time page injection; all-sites access remains a separate Settings opt-in. |
| `sidePanel` | Render the reading side panel through Chrome's Side Panel API. | The user can open a dedicated reading panel for the current post or current web page. |

## Static Host Permissions

| Host permission | Why Truly needs it | Boundary |
|---|---|---|
| `*://*.facebook.com/*` | Inject the reading UI and read supported Facebook post/page structure. On supported Facebook pages, Truly may also hook in-page Facebook GraphQL/network responses or read server-rendered page data in the page context to recover post context and sponsorship signals for the current feed surface. | Used only for supported Facebook reading surfaces. Does not enable background crawling or a Truly-owned collection service. |
| `*://*.fbcdn.net/*` | Read Facebook-hosted media or asset context needed for image-aware analysis and display. | Used only as context for the current Facebook reading surface. |
| `http://localhost/*` | Support local model endpoints when the user chooses a local model source. | User-configured model calls only. |
| `http://127.0.0.1/*` | Support local model endpoints exposed on loopback. | User-configured model calls only. |

## Optional Host Permissions

| Optional host permission | Why Truly may request it | Boundary |
|---|---|---|
| `http://*/*` | Support a user-configured HTTP model endpoint outside the default localhost hosts, and optionally let General Page Reader read HTTP pages directly from the Side Panel after the user enables all-sites access. | Requested only from an explicit user action. General Page access reads the current active page while the Side Panel is open; suitable pages may send compact-reading context to the configured model endpoint, which may also pick one page sentence as a verification suggestion. |
| `https://*/*` | Support a user-configured HTTPS model endpoint outside the default localhost hosts, and optionally let General Page Reader read HTTPS pages directly from the Side Panel after the user enables all-sites access. | Requested only from an explicit user action. General Page access reads the current active page while the Side Panel is open; suitable pages may send compact-reading context to the configured model endpoint, which may also pick one page sentence as a verification suggestion. |

Truly should request optional endpoint permissions at save/test time for the
specific user-configured endpoint. The Page/Web side panel can also request a
single-domain grant (`http://<host>/*` or `https://<host>/*`, a per-origin
subset of the same optional permission surface) when the user presses the
authorize-domain action; that grant gives persistent read access to that one
origin only, and reading still happens only while the user is using the Side
Panel. General Page all-sites access is a separate Settings opt-in for users
who want the Page/Web tab to work without clicking the toolbar popup or
authorizing each new site. None of these grants enable background crawling,
automatic screenshot capture, or persistent full-article storage.

Page/Web screenshot-assisted recovery uses the same user-gesture boundary. It
does not add a separate screenshot permission. When text extraction is not
enough, the Side Panel can offer a visible-tab screenshot preview only after a
user-triggered Page/Web read, only when the selected model source supports
vision input, and only after the user confirms the preview. Screenshot data is
session-only and is not written to Chrome extension storage or logs.

## Content Security Policy

| CSP item | Why Truly needs it | Boundary |
|---|---|---|
| `script-src 'self' 'wasm-unsafe-eval'` | Allows the bundled zhtw-mcp WASM language-convention checker to run locally in the extension. | Extension logic remains bundled; model output is data, not executable code. |

For Preview 12, `wasm-unsafe-eval` is intentionally retained because the bundled
zhtw-mcp WASM loader still requires it. Remove the directive only after the
bundled WASM loader no longer needs it and `docs/release/mv3-compliance.md` has
been updated to match.

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
