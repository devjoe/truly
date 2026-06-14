# README Demo GIF Spec

This directory contains synthetic README demo GIFs for the public Truly repo.
The assets must not use real posts, real accounts, private screenshots, or
platform-captured user data.

## Current Asset

- `truly-demo-balanced.gif` is the README default and the only tracked demo GIF.
  It shows a 1:1 split between feed-side behavior and the deeper reading side
  panel.
- The tracked README GIF should render at `1200 × 760` to preserve UI text
  clarity while staying lightweight enough for GitHub README use.
- `truly-demo.html` is a local review page for the tracked default asset.
- Earlier exploration candidates should stay untracked unless a future decision
  explicitly promotes them.

## Story Requirements

The default `balanced` asset should communicate three ideas in about 5.5
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
- The upper-left signal has a subtle glow so the reader sees the core product
  cue without a heavy spotlight overlay.
- The lower-left detail expansion should push the post content down instead of
  fading the post away.
- The lower-left expanded card has a subtle glow, clips the underlying post
  cleanly, and keeps the post footer visible rather than letting it overflow.
- The lower-left and right-side Heads-up strips should share the same visual
  language.
- The right-side flow should read as a browser page opening a side panel: the
  selected post is pushed left, the panel appears inside the browser frame, and
  panel sections reveal from top to bottom.
- The right-side selected-post preview should include a synthetic avatar,
  enough text to feel like a post, two constrained image placeholders, and a
  compact Like / Comment / Share footer.
- `Ask Gemini`, `Copy`, `Download`, and `Ask Meta AI` are shown as external
  handoff examples only.
- The final frame should hold slightly longer than the animation, so README
  readers can inspect the side-panel end state.

## Regeneration

Regenerate the GIFs with:

```bash
rtk node scripts/render-readme-demo.mjs
```

The default renderer writes only `truly-demo-balanced.gif`. To regenerate every
exploration variant during design review, run:

```bash
TRULY_DEMO_VARIANTS=all rtk node scripts/render-readme-demo.mjs
```

Those exploration GIFs are intentionally not tracked by default. The renderer
writes temporary frames under `tmp/readme-demo-frames/` and final assets under
`docs/assets/demo/`.

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
- Confirm the right-side Open button stays inside the Heads-up strip.
- Confirm the last frame holds long enough to read the side-panel layout.
