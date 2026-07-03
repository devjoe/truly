# Privacy Policy

Last updated: 2026-07-03

Canonical URL: https://trulyreader.org/privacy/

Truly is a privacy-conscious reading assistant for social feeds and web pages.
Reading analysis runs in the model environment you choose, such as Chrome
built-in Gemini Nano, a local model endpoint, or a private endpoint you
configure. Content is sent to external tools only when you explicitly use those
tools.

Truly does not operate a project-owned backend for feed content and does not
include product analytics or telemetry.

## Information Processed

When you use Truly on supported pages, the extension may process:

- visible post text, shared-post text, link previews, and image/video context;
- visible current-page text and page metadata when you explicitly use Page/Web
  reading;
- a visible-tab screenshot only when Page/Web offers screenshot-assisted
  recovery, the configured model source supports vision input, and you confirm
  the preview;
- page-hosted media URLs or image alt text when needed for reading
  assistance;
- model analysis generated from the selected model source;
- extension settings such as language, theme, model endpoint configuration,
  readiness state, and download preference.

## Where Processing Happens

Processing depends on your selected model source:

- Chrome built-in Gemini Nano: handled by Chrome's browser-managed local AI
  capability when available.
- Local model endpoint: sent to the local endpoint you configure, such as
  localhost Ollama.
- Private or remote endpoint: sent to the endpoint you configure and authorize
  in Chrome when permission is required.

Truly does not send feed or page content to a Truly-owned server.

Page/Web screenshot-assisted recovery is off by default and not automatic. If
Truly cannot build enough reading context from visible page text, it may offer a
screenshot preview only when the selected model source has passed a vision
capability check. The screenshot is sent to that selected model source only
after you confirm the preview. Screenshot data is kept in the current in-memory
Page/Web session only; it is not written to Chrome extension storage, logs, or
durable page history.

## User-Triggered External Tools

External actions are manual. They happen only after you click the relevant
button or link:

- Google or Gemini search opens a browser page or tab with the selected
  follow-up query.
- Meta AI handoff copies a prepared prompt and opens Meta AI for your manual
  use.
- Markdown copy places a structured note on your clipboard.
- Markdown download saves a structured note through browser or local file APIs.

Manual external-tool use is governed by the receiving service's own terms and
privacy policy.

## Stored Data

Truly stores extension settings and readiness state in Chrome extension storage.
Depending on your settings, this can include model endpoint URLs and model
names. Chrome extension storage is not a secret vault. Do not store API keys,
bearer tokens, or other secrets in model endpoint URLs.

Page/Web reading sessions are session-only by default. Truly does not store a
durable full-page reading history unless a future privacy-reviewed feature
explicitly changes that behavior.

Confirmed Page/Web screenshots are also session-only. They are cleared with the
current Page/Web session and are not persisted to `chrome.storage`.

Markdown notes are saved only when you explicitly download them. Clipboard
content is written only when you explicitly use a copy action.

## AI Output And User Judgment

Truly provides reading assistance, not authoritative truth. Model output can be
wrong, incomplete, or biased. Treat summaries, labels, and follow-up questions
as prompts for your own reading and verification.

If you use Chrome built-in Gemini Nano, Truly will follow Google's Generative
AI Prohibited Use Policy:
https://policies.google.com/terms/generative-ai/use-policy

## Sensitive Uses

Truly is not designed for high-stakes decisions, automated moderation, legal,
medical, financial, or safety-critical advice. Do not rely on model output as
the sole basis for such decisions.

## Contact

For privacy or Chrome Web Store questions, contact cws@trulyreader.org.
