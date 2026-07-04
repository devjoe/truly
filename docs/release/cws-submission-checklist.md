# Chrome Web Store Submission Checklist

Status: Preview 12 submission checklist
Last updated: 2026-07-04

Use this checklist when submitting the Preview 12 build to Chrome Web
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

- [ ] If starting a new CWS-bound Preview, run
  `npm run release:bump-cws-preview` instead of only bumping
  `manifest.version_name`.
- [ ] Before dashboard upload, confirm the Chrome Web Store dashboard has no
  already published, in-review, or otherwise occupied package for the current
  numeric `manifest.version`.
- [x] Record the outcome of Preview 9's numeric `0.1.1` submission before
  dashboard upload.
  - Result: `0.1.1 Preview 9` was published to Chrome Web Store as `Unlisted`.
  - Publication notification received: 2026-07-04
  - Item ID: `kdgkgifmdflocjockbfnhkkncbdihpoj`
  - Item link:
    <https://chrome.google.com/webstore/detail/kdgkgifmdflocjockbfnhkkncbdihpoj>
  - Preview 12 can proceed as an update to the existing item after final human
    review and release tagging.
- [ ] Run `npm run cws:package` from a clean, pushed branch.
- [ ] Confirm the package report says `Uploadable: yes`.
- [ ] Confirm the package report says `Dirty tree: no`.
- [ ] Confirm the package report says `origin/main` is `caught_up` for the
  package commit.
- [ ] Confirm the package report says the current Preview release tag points at
  the package commit.
- [ ] Upload the extension ZIP recorded in the generated
  `artifacts/cws/0.1.2-<commit>-<timestamp>/cws-package-report.md`.
- [ ] Do not upload any ZIP from `artifacts/cws-local-smoke/`; those artifacts
  are local packaging smoke evidence only and are explicitly non-uploadable.
- [ ] Keep the CWS package report open while filling the dashboard.
- [ ] Confirm package metadata:
  - Version: `0.1.2`
  - Version name: `0.1.2 Preview 12`
  - Recommended tag: `v0.1.2-preview.12`
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
  - user-triggered Page/Web reading;
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
  and user-triggered. If General Page all-sites access is mentioned, it must be
  described as a separate Settings opt-in for reading the current page only
  after a user action.

## Reviewer Notes

- [ ] Paste reviewer notes from `docs/release/cws-reviewer-notes.md`.
- [ ] Confirm the notes explicitly state:
  - no Truly account is required;
  - no Truly-operated backend is required;
  - no dedicated Facebook test account or hosted model endpoint is provided;
  - a supported Facebook page state is required for the full in-page flow;
  - Page/Web review can be tested on ordinary public pages through explicit
    toolbar/popup activation or the Settings all-sites opt-in;
  - Gemini Nano availability and speed depend on Chrome, device capability,
    model availability, feature status, and first-run model setup;
  - reviewers can use a local/private model endpoint if Gemini Nano is
    unavailable or too slow.

## Final Manual Review

- [ ] Review the package diff and the latest release notes for behavior that
  should be reflected in the CWS listing, privacy fields, or reviewer notes.
- [ ] Confirm the latest security review findings are either fixed, documented,
  or intentionally accepted before uploading the package.
- [ ] Run `npm run cws:review:github` against the pushed release candidate
  when Claude review is available, or document why the advisory review was
  skipped. Use `npm run cws:review:local-limited-context` when the review must
  include bounded local-only package reports or unpushed diffs. Use
  `npm run cws:review:local-repo-read` only when the reviewer should inspect
  the repo root for public/private boundary, architecture, or cross-file
  security risks.
- [ ] Open the generated `artifacts/review/.../review-disposition.md` and record
  the human decision for each finding.
- [ ] Confirm any blocking Claude review findings are fixed or explicitly
  dispositioned before upload.
- [ ] Dashboard package upload succeeds.
- [ ] Dashboard warnings are understood and either resolved or documented.
- [ ] Listing text matches the current README, website, and manifest purpose.
- [ ] Reviewer notes do not promise functionality beyond the Preview build.
- [ ] Privacy practices do not imply a Truly backend, analytics pipeline, or
  automatic external sharing.
- [ ] Screenshots and promo tile match the selected CWS asset set.
- [ ] Submit as `Unlisted`.

## After Submission

- [x] Record previous CWS submission date and time.
  - Submitted for Chrome Web Store review: 2026-06-27 19:13 CST
  - Submitted package:
    `truly-cws-extension-0.1.1-7bdb3a06170c.zip`
  - Package commit: `7bdb3a06170c`
  - GitHub Release: `v0.1.1-preview.9`
  - Submitted version: previous Preview 9 submission for numeric version `0.1.1`
  - Submitted visibility: `Unlisted`
- [x] Record previous CWS publication result.
  - Published notification received: 2026-07-04
  - Published version: Preview 9 of version `0.1.1`
  - Published visibility: `Unlisted`
  - Published item link:
    <https://chrome.google.com/webstore/detail/kdgkgifmdflocjockbfnhkkncbdihpoj>
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
- [ ] After successful publication, update
  `docs/release/cws-published-version.json` to the newly published numeric
  version and visible Preview label.
- [ ] If the item is rejected, update the relevant release docs before
  resubmitting.
