# Preview Command Contract

Status: implemented for Preview staging

This is the short release-facing contract for the Preview package command.
It is intentionally smaller than the private migration plan.

## Command

```bash
npm run release:preview
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
- Chrome Web Store upload validation requires `manifest.version` to be greater
  than the already published package version. A CWS update cannot rely on
  changing only `manifest.version_name`.

In the source tree, `manifest.version_name` represents the **next unreleased
Preview**. After publishing `v0.1.0-preview.4`, the repo should be bumped to
`0.1.0 Preview 5` before new development continues. This keeps dev builds and
the next release candidate from reusing an already-shared label.

The command must run `npm run check:release-metadata` through `check:public`.
That check blocks releases when `manifest.version`, `package.json`, and
`manifest.version_name` drift, or when the corresponding local release tag
already exists.

Use this helper after publishing a Preview, or before preparing a new Preview
when the current label has already been tagged:

```bash
npm run release:bump-preview
```

## Preview Closeout Checklist

After a Preview is published and shared:

1. Confirm the GitHub Release tag exists, for example `v0.1.0-preview.4`.
2. Run `npm run release:bump-preview`.
3. Commit and push the resulting `manifest.version_name` bump before starting
   the next development cycle.

This closeout keeps regular development builds on the next unreleased Preview
label. If the closeout was missed, `npm run check:release-metadata` should fail
with a tag-collision message before another release is prepared.

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

Public-safe development scripts and the Makefile can be included in the GitHub
source package. They are source-level conveniences, not packaged extension
runtime files.

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
answer. It is intentionally not part of `check:public` or `release:preview`
because it depends on live model availability, endpoint permissions, and the
operator's current local or cloud model setup.

## GitHub Release Boundary

The first Preview keeps release publishing manual. The workflow can build and
upload artifacts for review, but the human release step is still to create the
GitHub Release from the Preview tag and attach the generated extension zip,
source zip, and build report.

The extension zip strips JavaScript `sourceMappingURL` comments while excluding
the `.map` files themselves. Local `dist` builds may keep sourcemaps for
debugging, but the CWS-facing artifact should not point reviewers or browsers
at missing maps.

## Dev Shortcut Boundary

Preview release artifacts must not include development-only commands. Local
development can use `npm run build:dev` to generate a manifest with the reload
shortcut, but `release:preview` verifies that the packaged manifest does not
contain that command. Preview release artifacts also must not include the
dev-reload localhost probe; `release:preview` verifies the packaged service
worker excludes `http://localhost:9012/` and the dev-reload reload markers.

`npm run audit:release-bundle` is the shared artifact boundary check used by
`check:public`, release-tag CI, and `release:preview`. It audits the built
extension for CWS-sensitive drift that manifest-only checks do not catch:
unexpected required permissions, unexpected host permissions, exposed
`externally_connectable` / `web_accessible_resources`, remote executable code
loaders, development reload markers, and forbidden packaged paths. The
`release:preview` command runs the same audit twice: once against `dist`, and
again against the final extension zip that will be uploaded.

`release:preview` refuses to run while repo-local dev processes are active,
including `make dev-all`, `scripts/dev-singleton.mjs`, `scripts/dev-watch.mjs`,
and `scripts/dev-reload-server.mjs`. It also writes a short-lived
`tmp/release-preview.lock` while producing the Preview artifact. The dev watcher
treats that lock as authoritative and will not start while a release is in
progress.

Local development builds also enable routine debug logs automatically.
Production and Preview release builds keep `log` / `info` / `debug` output
quiet by default, while `warn` / `error` remain visible. For one-off production
debugging, set `globalThis.__TRULY_DEBUG_LOGS = true` or
`localStorage.trulyDebugLogs = "1"` in the relevant extension context.

## CWS Package Boundary

`release:preview` remains the Preview release artifact builder. It produces the
extension ZIP, source ZIP, and build report that can later become a GitHub
Release, but it does not itself create the GitHub Release.

`npm run cws:package` is the Chrome Web Store upload-package entrypoint. It
requires a clean tree, a branch that is not behind its upstream, no repo-local
dev processes, the current Preview release tag pointing at `HEAD`,
`check:public`, a packaged ZIP audit, and `cws:preflight`. Since CWS packaging
happens after the GitHub Release tag exists, it allows the release metadata tag
collision only after verifying that the tag is the current commit. It writes a
CWS-specific package report under `artifacts/cws/` with the extension ZIP path,
SHA-256, commit, build ID, and submission input paths.

`npm run cws:preflight` is intentionally deterministic and local. It verifies
that the CWS docs mention the current version, version name, and recommended
Preview tag, and that the selected CWS screenshots and promo tile exist at the
required dimensions. Manual code review and security review remain human gates;
the package report records the deterministic checks that support that review
instead of claiming an automated reviewer approved the release.
