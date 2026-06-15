# Preview Command Contract

Status: implemented for Preview staging

This is the short release-facing contract for the Preview package command.
It is intentionally smaller than the private migration plan.

## Command

```bash
npm run release:alpha
```

The command should create a reviewable Chrome MV3 Preview artifact from a clean
checkout. It should not publish to Chrome Web Store automatically.

## Public Preview Naming

Chrome extension metadata and GitHub release names use different constraints:

- `manifest.version` and `package.json` use Chrome-compatible numeric versions,
  for example `0.1.0`.
- `manifest.version_name` uses the human preview label, for example
  `0.1.0 Preview 1`.
- Git tags use the public preview label, for example `v0.1.0-preview.1`.
- GitHub Release titles use `Truly 0.1.0 Preview 1` and should be marked as
  pre-release.

The command must run `npm run check:release-metadata` through `check:public`.
That check blocks releases when `manifest.version`, `package.json`, and
`manifest.version_name` drift.

## Expected Outputs

- extension zip;
- source zip;
- build report;
- reviewer notes pointer;
- terminal summary with version, version name, recommended tag, commit,
  artifact paths, checks, and warnings.

## Required Gates

The first implementation should run:

```bash
npm run check:ollama-cloud-capabilities
npm run check:public
npm run build
```

The command must not require private fixtures, logged-in Facebook state, Chrome
profiles, local screenshots, or live CDP access.

`check:ollama-cloud-capabilities` is a release-time freshness reminder for the
small static Ollama Cloud model capability registry. It blocks a Preview build
when the registry is stale enough that visible model capability warnings may be
misleading.

## Artifact Rules

The extension zip must contain only the built extension. It must not include:

- source maps unless explicitly approved;
- dependency install output;
- generated test or audit output;
- private fixtures;
- screenshots;
- local profiles;
- environment files.

The source zip must contain the public source package used to build the Preview.
It must not include private lab material or generated output.

Generated demo experiments are excluded from the source zip. The README preview
asset `docs/assets/demo/truly-demo-balanced.gif` is the only tracked demo GIF
included in the public source package.

## Confidence Passes

Live Facebook checks and private regression packs are separate human release
confidence passes. They can block a release decision, but they should not make
the public package command unusable from a clean checkout.

Endpoint-specific model probes are also opt-in confidence passes. For example,
`npm run smoke:ollama-vision` can verify that a configured Ollama-compatible
endpoint accepts an OpenAI-compatible image message and returns a vision-aware
answer. It is intentionally not part of `check:public` or `release:alpha`
because it depends on live model availability, endpoint permissions, and the
operator's current local or cloud model setup.

## GitHub Release Boundary

The first Preview keeps release publishing manual. The workflow can build and
upload artifacts for review, but the human release step is still to create the
GitHub Release from the Preview tag and attach the generated extension zip,
source zip, and build report.

## Dev Shortcut Boundary

Preview release artifacts must not include development-only commands. Local
development can use `npm run build:dev` to patch the built manifest with the
reload shortcut, but `release:alpha` verifies that the packaged manifest does
not contain that command.
