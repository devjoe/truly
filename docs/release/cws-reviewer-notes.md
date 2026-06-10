# Chrome Web Store Reviewer Notes

Last updated: 2026-06-10

## Product Summary

Truly is a Chrome MV3 extension for Facebook reading assistance. It adds a
compact reading hint near supported Facebook posts and a user-opened reading
side panel with summary, context, follow-up questions, language-convention
checks, and manual external-tool handoff.

Truly is not an ad blocker, automatic fact-checker, moderation bot, account
automation tool, or scraping service. The extension helps the reader notice
context and decide what to verify.

## How To Review

1. Install the packaged extension build or load the unpacked `dist/` folder.
2. Open the extension Options page.
3. Choose model sources for reading-before-post hints and summary/deep reading.
4. Use Chrome built-in Gemini Nano when available, or configure a local/private
   model endpoint. Remote/private endpoints may ask for Chrome host permission
   when saved.
5. Open a supported Facebook feed, profile, group, or post page.
6. Confirm that a compact reading hint appears near supported posts.
7. Open the reading side panel from the extension UI to inspect summary,
   context, follow-up questions, and external-tool actions.

Alpha limitations are expected: Facebook layouts change, local/private model
quality varies, and some posts may not produce a reading brief. The UI should
surface failures instead of silently claiming analysis is complete.

## Data Flow Summary

Truly does not send feed content to a project-owned server and does not include
product analytics or telemetry.

Content can leave the browser only through user-selected or user-triggered
paths:

- Model analysis: content is sent to the model environment selected by the
  user, such as Chrome built-in Gemini Nano, a local endpoint, or a private
  endpoint.
- Google / Gemini search: the user explicitly clicks a follow-up question; a
  search query opens in a browser page/tab.
- Meta AI handoff: the user explicitly clicks the handoff action; Truly copies
  a prepared prompt and opens Meta AI for the user to paste or use.
- Markdown copy/download: the user explicitly clicks copy or download; the
  generated note is placed on the clipboard or saved through browser/local file
  APIs.

## Permission Summary

Truly requests only the Chrome extension permissions needed for the supported
surfaces:

- `storage`: save user settings, readiness state, and extension preferences.
- `activeTab`: interact with the current tab after user action.
- `sidePanel`: provide the user-opened reading side panel.
- Facebook / FB CDN hosts: inject the reading UI and read post/image context on
  supported Facebook pages.
- `localhost` / `127.0.0.1`: support local model endpoints.
- Optional broad `http://*/*` and `https://*/*`: requested only when the user
  configures a non-default model endpoint that requires that origin.

See `docs/release/permission-justification.md` for the detailed table.

## Remote Code And AI Output Boundary

The extension logic is bundled with the extension. Model responses are treated
as data used to render reading assistance; they are not remote executable code.

The zhtw-mcp language-convention checker is bundled as a local WASM asset. Its
license is preserved in `THIRD_PARTY_NOTICES.md` and
`src/vendor/zhtw-mcp/LICENSE`.
