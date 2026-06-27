# Chrome Web Store Submission Checklist

Status: Preview 9 submission checklist
Last updated: 2026-06-27

Use this checklist when submitting the Preview 9 build to Chrome Web
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

- [ ] Run `npm run cws:package` from a clean, pushed branch.
- [ ] Confirm the package report says the current Preview release tag points at
  the package commit.
- [ ] Upload the extension ZIP recorded in the generated
  `artifacts/cws/0.1.0-<commit>-<timestamp>/cws-package-report.md`.
- [ ] Keep the CWS package report open while filling the dashboard.
- [ ] Confirm package metadata:
  - Version: `0.1.0`
  - Version name: `0.1.0 Preview 9`
  - Recommended tag: `v0.1.0-preview.9`
  - Commit: use the commit recorded in the CWS package report.
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

- [ ] Review the package diff and the latest release notes for behavior that
  should be reflected in the CWS listing, privacy fields, or reviewer notes.
- [ ] Confirm the latest security review findings are either fixed, documented,
  or intentionally accepted before uploading the package.
- [ ] Dashboard package upload succeeds.
- [ ] Dashboard warnings are understood and either resolved or documented.
- [ ] Listing text matches the current README, website, and manifest purpose.
- [ ] Reviewer notes do not promise functionality beyond the Preview build.
- [ ] Privacy practices do not imply a Truly backend, analytics pipeline, or
  automatic external sharing.
- [ ] Screenshots and promo tile match the selected CWS asset set.
- [ ] Submit as `Unlisted`.

## After Submission

- [x] Record the previous submission date and time in release notes or a short
  follow-up comment.
  - Submitted for Chrome Web Store review: 2026-06-24 14:48 CST
  - Submitted package: `truly-extension-0.1.0-37029fbf2def.zip`
  - Package commit: `37029fbf2def`
  - GitHub Release: `v0.1.0-preview.8`
- [x] Record Chrome Web Store publication result.
  - Published notification received: 2026-06-25
  - Published version: Preview 8 of version `0.1.0`
  - Published visibility: `Unlisted`
  - Published item link:
    <https://chromewebstore.google.com/detail/truly/kdgkgifmdflocjockbfnhkkncbdihpoj>
- [x] Record Chrome Web Store installed smoke test.
  - Smoke test completed: 2026-06-25
  - Result: CWS-installed extension starts and runs successfully.
  - Note: Chrome Enhanced Safe Browsing may show an extra trust warning for the
    new Unlisted preview, but it does not limit extension functionality after
    installation.
- [ ] Save any Chrome Web Store warning or reviewer feedback before changing the
  listing.
- [ ] If the item is rejected, update the relevant release docs before
  resubmitting.
