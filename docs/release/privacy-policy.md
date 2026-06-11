# Privacy Policy

Last updated: 2026-06-10

Truly is a local-first reading assistant for social feeds and web pages.
Reading analysis runs in the model environment you choose. Content is sent to
external tools only when you explicitly use those tools.

Truly does not operate a project-owned backend for feed content and does not
include product analytics or telemetry.

## Information Processed

When you use Truly on supported pages, the extension may process:

- visible post text, shared-post text, link previews, and image/video context;
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

Truly does not send feed content to a Truly-owned server.

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
names. Do not store secrets in model endpoint URLs.

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
