# Chrome Web Store Asset Inventory

Status: CWS asset checklist; first Unlisted asset set selected
Last updated: 2026-06-23

This inventory lists assets already present in the public-bound repo and the
selected Chrome Web Store visual deliverables for the first Unlisted review.

Official image requirements:

- https://developer.chrome.com/docs/webstore/images

## Required Chrome Web Store Assets

| Asset | Required size | Current status | Notes |
|---|---:|---|---|
| Extension icon | 128x128 PNG | Available | Use `src/icons/icon-128.png` if final visual review passes. |
| Screenshot 1 | 1280x800 or 640x400 | Selected | Reading hint beside a supported post. |
| Screenshot 2 | 1280x800 or 640x400 | Selected | Expanded hint with summary and reading reminders. |
| Screenshot 3 | 1280x800 or 640x400 | Selected | Side panel with context, claim signals, and handoff actions. |
| Small promotional tile | 440x280 PNG/JPEG | Selected | Native 440x280 tile aligned with the GitHub repository social preview / OG image typography; rendered with 2x supersampling. |

## Optional / Later Assets

| Asset | Size | Current status | Notes |
|---|---:|---|---|
| Marquee promotional tile | 1400x560 | Defer | Useful for a more polished public launch, not needed for the first review pass unless the dashboard requires it. |
| Additional screenshots | 1280x800 or 640x400 | Defer | Add only if they clarify model setup or privacy boundaries. |

## Available In Seed

| Asset | Path | Notes |
|---|---|---|
| Extension icon 16 | `src/icons/icon-16.png` | Manifest icon. |
| Extension icon 32 | `src/icons/icon-32.png` | Manifest/action icon. |
| Extension icon 48 | `src/icons/icon-48.png` | Manifest/action icon. |
| Extension icon 128 | `src/icons/icon-128.png` | Chrome Web Store icon candidate. |
| Heads-up feed mockup | `docs/assets/mockups/heads-up-feed.png` | README mockup. Not CWS-ready size. |
| Heads-up expanded mockup | `docs/assets/mockups/heads-up-expanded.png` | README mockup. Not CWS-ready size. |
| Side panel mockup | `docs/assets/mockups/side-panel-reading.png` | README mockup. Not CWS-ready size. |
| GitHub social preview, English | `docs/assets/social/truly-github-social-en.png` | GitHub social card. Not CWS promo size. |
| GitHub social preview, bilingual | `docs/assets/social/truly-github-social-bilingual.png` | GitHub social card. Not CWS promo size. |
| GitHub social preview, zh-TW | `docs/assets/social/truly-github-social-zh-tw.png` | GitHub social card. Not CWS promo size. |

## Selected CWS Assets

Review gallery:

- `docs/assets/cws/truly-cws-assets.html`

Screenshots:

- `docs/assets/cws/truly-cws-professional-screenshot-01-feed-signal.png`
- `docs/assets/cws/truly-cws-professional-screenshot-02-expanded-context.png`
- `docs/assets/cws/truly-cws-professional-screenshot-03-side-panel-handoff.png`

Small promotional tile:

- `docs/assets/cws/truly-cws-promo-og-image.png`

## Visual Direction

- Use synthetic or de-identified content only.
- Keep the product story concrete: reading hint, context expansion, side panel,
  then handoff by choice.
- Do not publish logged-in Facebook screenshots, private account names, raw
  user posts, or private browser state.
- Prefer dark UI screenshots if they match the current public README and
  website tone, but include enough contrast for small CWS thumbnails.
- Keep text sparse in promotional tiles. The screenshot should show product
  behavior; the promotional tile should establish brand and category.
- The first Unlisted review uses the selected asset set above.

## Selected Screenshot Set

1. **Heads-up before you read**: a supported post with a compact reading hint
   before the reader reacts.
2. **Expand for context**: the expanded hint showing a short explanation and
   reading risk reminders.
3. **Read deeper in the side panel**: the side panel with context, claims to
   verify, follow-up questions, and manual handoff actions.

## Production Notes

- Build polished synthetic screenshots from the same source frames used to
  produce `docs/assets/demo/truly-demo-balanced.gif` instead of publishing raw
  logged-in platform screenshots.
- Use the three stable source segments from the same balanced demo material:
  feed signal, expanded context, and side panel handoff.
- Recompose the small promotional tile from the GitHub repository social
  preview / OG image direction, cropped and simplified for 440x280 rather than
  reused directly.
- Regenerate assets with `npm run render:cws-assets`.
- Model setup screenshots are deferred for the first listing. They may clarify
  privacy boundaries, but they distract from the initial product story.
