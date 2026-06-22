# Chrome Web Store Submission Checklist

Status: first Unlisted submission checklist
Last updated: 2026-06-23

Use this checklist when submitting the first Truly Preview build to Chrome Web
Store. The dashboard copy should still come from
`docs/release/cws-listing-copy.md`; this file is the operational checklist.

## Submission Target

- Visibility: `Unlisted`
- Category: `Productivity`
- Default locale: `English`
- Localized listing: `zh-TW`
- Privacy policy URL: `https://trulyreader.org/privacy/`
- Support / Chrome Web Store contact: `cws@trulyreader.org`
- Feedback URL: `https://trulyreader.org/feedback/`

## Package

- [ ] Use the latest clean `npm run release:alpha` artifact.
- [ ] Confirm `npm run dev:status` reports `state: not running` and
  `repo dev processes: none` before uploading.
- [ ] Upload extension ZIP:
  `artifacts/alpha/0.1.0-ac9c68535675-2026-06-22T19-02-03-728Z/truly-extension-0.1.0-ac9c68535675.zip`
- [ ] Keep build report open while filling the dashboard:
  `artifacts/alpha/0.1.0-ac9c68535675-2026-06-22T19-02-03-728Z/build-report.md`
- [ ] Confirm package metadata:
  - Version: `0.1.0`
  - Version name: `0.1.0 Preview 7`
  - Recommended tag: `v0.1.0-preview.7`
  - Commit: `ac9c68535675`
- [ ] Confirm the packaged manifest does not include
  `commands.reload-extension`.

## Store Listing

- [ ] Copy the English short description from
  `docs/release/cws-listing-copy.md`.
- [ ] Copy the English full description from
  `docs/release/cws-listing-copy.md`.
- [ ] Add the `zh-TW` localized short description.
- [ ] Add the `zh-TW` localized full description.
- [ ] Keep the wording within the product boundary:
  - reading assistance;
  - reading signals;
  - context and summary;
  - user-triggered handoff.
- [ ] Avoid unsupported claims:
  - authoritative truth;
  - automatic fact-checking;
  - moderation;
  - account automation;
  - scraping.

## Graphics

- [ ] Icon: `src/icons/icon-128.png`
- [ ] Screenshot 1:
  `docs/assets/cws/truly-cws-professional-screenshot-01-feed-signal.png`
- [ ] Screenshot 2:
  `docs/assets/cws/truly-cws-professional-screenshot-02-expanded-context.png`
- [ ] Screenshot 3:
  `docs/assets/cws/truly-cws-professional-screenshot-03-side-panel-handoff.png`
- [ ] Small promotional tile:
  `docs/assets/cws/truly-cws-promo-og-image.png`
- [ ] Confirm all screenshots are 1280 x 800.
- [ ] Confirm the small promotional tile is 440 x 280.
- [ ] Confirm screenshots are synthetic or anonymized and do not show a logged-in
  real Facebook account.

## Privacy And Permissions

- [ ] Fill Chrome Web Store privacy fields using the basis in
  `docs/release/cws-listing-copy.md`.
- [ ] Confirm the privacy form stays aligned with these facts:
  - Truly does not sell user data.
  - Truly does not include product analytics or telemetry.
  - Truly does not operate a project-owned backend for feed content.
  - Feed/page content is processed only for reading assistance.
  - Model analysis uses the environment selected by the user.
  - External handoff actions are manual and user-triggered.
- [ ] Use `docs/release/permission-justification.md` for permission
  justifications.
- [ ] Confirm optional broad host permissions are described as endpoint-driven
  and user-triggered.

## Reviewer Notes

- [ ] Paste reviewer notes from `docs/release/cws-reviewer-notes.md`.
- [ ] Confirm the notes explicitly state:
  - no Truly account is required;
  - no Truly-operated backend is required;
  - no dedicated Facebook test account or hosted model endpoint is provided;
  - a supported Facebook page state is required for the full in-page flow;
  - Gemini Nano availability and speed depend on Chrome, device capability,
    model availability, feature status, and first-run model setup;
  - reviewers can use a local/private model endpoint if Gemini Nano is
    unavailable or too slow.

## Final Manual Review

- [ ] Dashboard package upload succeeds.
- [ ] Dashboard warnings are understood and either resolved or documented.
- [ ] Listing text matches the current README, website, and manifest purpose.
- [ ] Reviewer notes do not promise functionality beyond the Preview build.
- [ ] Privacy practices do not imply a Truly backend, analytics pipeline, or
  automatic external sharing.
- [ ] Screenshots and promo tile match the selected CWS asset set.
- [ ] Submit as `Unlisted`.

## After Submission

- [ ] Record submission date and time in release notes or a short follow-up
  comment.
- [ ] Save any Chrome Web Store warning or reviewer feedback before changing the
  listing.
- [ ] If the item is rejected, update the relevant release docs before
  resubmitting.
