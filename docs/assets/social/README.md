# Truly Social Preview Assets

This directory holds source and generated raster assets for public preview cards.

## Current Priority

The first release path is:

1. GitHub repository social preview
2. Chrome Web Store assets
3. Website Open Graph images

GitHub supports only one repository social preview image, so the English image
is the default candidate. Keep the bilingual image second and the Mandarin image
third for manual selection on social platforms that expose alternate preview
images, and for later website-language pages.

## Files

| File | Purpose |
| --- | --- |
| `truly-github-social.html` | Local review page for all GitHub preview variants. |
| `truly-github-social-en.svg` / `.png` | Default GitHub candidate. |
| `truly-github-social-bilingual.svg` / `.png` | Second candidate for manual social-preview selection. |
| `truly-github-social-zh-tw.svg` / `.png` | Third candidate for manual social-preview selection and future localized pages. |

## Regeneration

```bash
npm run render:social-preview
```

## Constraints

- GitHub social preview target: `1280 × 640`.
- Keep the selected GitHub PNG under `1 MB`.
- Use synthetic UI only. Do not include real posts, accounts, private
  screenshots, or platform-captured user data.
- Keep important text and the brand inside the center safe area.
- Do not use the README GIF as the social preview image.
