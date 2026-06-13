# README Demo GIF Spec

This directory contains synthetic README demo GIFs for the public Truly repo.
The assets must not use real posts, real accounts, private screenshots, or
platform-captured user data.

## Current Variants

- `truly-demo-balanced.gif` is the README default. It shows a 1:1 split between
  feed-side behavior and the deeper reading side panel.
- `truly-demo-calm.gif` keeps the same story with softer pacing and contrast.
- `truly-demo-compact.gif` keeps the same story in a denser presentation.
- `truly-demo.html` is a local review page for comparing the three variants.

## Story Requirements

The default `balanced` variant should communicate three ideas in about five
seconds:

1. Truly adds compact reading hints inside a social feed.
2. The user can expand a hint to read a short, inline explanation without
   losing the surrounding post.
3. The user can open deeper reading, where the selected post is handed off to a
   side panel with context, follow-up questions, and external-tool actions.

## Visual Requirements

- Use English UI copy for public README assets.
- Keep all feed content synthetic and generic.
- Preserve a 1:1 horizontal balance between the left feed concepts and the right
  side-panel concept.
- The upper-left feed should show natural vertical scrolling, with no empty
  trailing scroll area.
- The lower-left detail expansion should push the post content down instead of
  fading the post away.
- The lower-left and right-side Heads-up strips should share the same visual
  language.
- The right-side `Selected post` preview should include an avatar placeholder,
  text, and two constrained image placeholders.
- `Ask Gemini`, `Copy`, `Download`, and `Ask Meta AI` are shown as external
  handoff examples only.

## Regeneration

Regenerate the GIFs with:

```bash
rtk node scripts/render-readme-demo.mjs
```

The renderer writes temporary frames under `tmp/readme-demo-frames/` and final
tracked assets under `docs/assets/demo/`.

When Playwright is unavailable, the renderer falls back to local Chrome CDP. In
that case it may need to run outside the sandbox because it launches Chrome and
connects to a localhost debugging port.

## Review Checklist

- Open `docs/assets/demo/truly-demo.html`.
- Check `truly-demo-balanced.gif` first.
- Confirm the first frame has:
  - no feed header collision,
  - three synthetic feed posts available in the upper-left scroll,
  - a visible avatar placeholder in the right-side selected-post preview,
  - no overflowing right-side image mockups.
- Confirm the expanded phase keeps the post visible and clips the bottom cleanly.
