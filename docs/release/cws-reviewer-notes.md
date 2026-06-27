# Chrome Web Store Reviewer Notes

Last updated: 2026-06-27

Status: Preview 9 reviewer-notes reference

## Submission Build

- Version: `0.1.1`
- Version name: `0.1.1 Preview 9`
- Recommended tag: `v0.1.1-preview.9`
- Commit: use the commit recorded in the latest `npm run cws:package`
  report.
- Extension ZIP: use the `truly-cws-extension-0.1.1-<commit>.zip` path from the
  latest `npm run cws:package` report.
- Package report: use the latest
  `artifacts/cws/0.1.1-<commit>-<timestamp>/cws-package-report.md`.

The CWS package checks pass through `npm run cws:package`, including clean-tree
and upstream checks, release-tag-to-commit verification, public-boundary checks,
release metadata, typecheck, public contract tests, public unit tests,
production build, packaged ZIP audit, and CWS preflight.

Preview 9 fixes model endpoint settings behavior and hardens release packaging
so development-only reload hooks are excluded from the submitted package.

## Product Summary

Truly is a Chrome MV3 extension for privacy-conscious reading assistance in
social feeds and web pages. The first release starts with supported Facebook
reading surfaces. It adds a compact reading hint near supported posts and a
user-opened reading side panel with summary, context, follow-up questions,
language-convention checks, claim signals, and manual external-tool handoff.

Truly is not an ad blocker, automatic fact-checker, moderation bot, account
automation tool, or scraping service. The extension helps the reader notice
context and decide what to verify.

## How To Review

1. Install the packaged extension build or load the unpacked `dist/` folder.
2. Open the extension Options page.
3. Choose model sources for reading-before-post hints and summary/deep reading.
4. Use Chrome built-in Gemini Nano when available. If it is unavailable in the
   review environment, configure a local/private model endpoint that implements
   the supported API shape. Remote/private endpoints may ask for Chrome host
   permission when saved.
5. Open a supported Facebook feed, profile, group, or post page.
6. Confirm that a compact reading hint appears near supported posts after model
   readiness and page support checks pass.
7. Expand the hint to inspect the one-sentence summary and reading reminders.
8. Open the reading side panel from the extension UI to inspect summary,
   context, follow-up questions, and external-tool actions.

Preview limitations are expected: Facebook layouts change, local/private model
quality varies, and some posts may not produce a reading brief. The UI should
surface failures instead of silently claiming analysis is complete.

## Reviewer Test Environment Notes

- The extension does not require a Truly account.
- The extension does not require a Truly-operated backend.
- The submission does not provide a dedicated Facebook test account or hosted
  model endpoint for reviewers.
- A supported Facebook page state is required to review the full in-page reading
  UI. If the reviewer does not have an available Facebook test account, the
  Options page, Popup, and Side Panel shell can still be inspected, but the
  post-adjacent reading flow may not fully activate.
- Chrome built-in Gemini Nano availability depends on the review browser,
  platform, model availability, Chrome AI feature status, model download state,
  and device capability. First-run setup can be slow because Chrome may need to
  make the built-in model available before analysis starts. If Gemini Nano is
  unavailable or too slow in the review environment, use a local/private
  endpoint for functional review.
- Gemini Nano speed is expected to vary substantially across reviewer devices.
  Slow first-run analysis is not a network failure or server dependency; it
  usually means Chrome is preparing, downloading, or running the browser-managed
  model locally.
- The extension may request optional host permission only when the reviewer
  saves or tests a non-default model endpoint that requires that origin.

## Single Purpose Boundary

Truly's single purpose is to help the user read information more carefully by
showing reading signals, summaries, contextual notes, questions, and
user-triggered handoff actions near the content being read.

The extension does not automate posting, liking, commenting, messaging,
following, moderation, ad blocking, or scraping.

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

For Preview, zhtw-mcp is used only for language-convention hints such as wording
and punctuation. Truly does not expose a zhtw-mcp AI-detection verdict.

## Expected Review Questions

### Why does Truly request Facebook host permissions?

The first supported reading surface is Facebook. Truly injects its reading UI
and reads visible post context only on supported Facebook surfaces.

### Why does Truly request FB CDN host permission?

Some supported posts include Facebook-hosted media or image context. Truly uses
that context for reading assistance when image-aware analysis is available.

### Why are localhost and 127.0.0.1 static host permissions?

Truly supports local model endpoints such as local Ollama-compatible servers.
These origins let users run reading analysis without sending feed content to a
Truly-owned backend.

### Why are broad HTTP/HTTPS host permissions optional?

Some users configure their own private model endpoint outside localhost. Truly
should request access only when a configured endpoint requires that origin.

### Does model output count as remote code?

No. Model output is treated as data. It may populate summaries, labels,
questions, and handoff prompts, but it is not executed as extension code.

### Why might built-in Gemini Nano be unavailable or slow during review?

Chrome built-in AI availability depends on the review browser, platform,
device capability, feature status, and whether the built-in model is already
available. Initial analysis can be slow when the browser needs to prepare or
download the model. Truly surfaces readiness and failure states instead of
silently claiming analysis is complete.

## Reviewer Guidance Included

These notes include fallback guidance for reviewers without an available
Facebook page state or Chrome built-in Gemini Nano availability.
