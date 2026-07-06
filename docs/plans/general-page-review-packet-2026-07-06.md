# General Page Reader Review Packet

Date: 2026-07-07
Branch: `codex/general-page-reader-contract`

This packet is the public-safe technical index for the human review pass before
the next release decision. It intentionally avoids real target URLs, copied page
text, screenshots, private labels, and review HTML contents.

## Review Scope

This branch adds the General Page Reader runtime path beside the existing
Facebook Feed reader. The current review should focus on whether Page/Web is
usable, bounded, and privacy-consistent while preserving the existing Facebook
heads-up, deep-read, and fact-check entry points.

In scope:

- Popup and Side Panel Page/Web read flow.
- Side Panel auto-read only while the panel is open and all-sites access is
  granted.
- Automatic General Page quick brief when the page is eligible and Tier B model
  settings are available.
- Selection and current-region target seams for future paragraph summary and
  check workflows.
- User-confirmed screenshot-assisted recovery.
- CDP audit coverage, public boundary checks, release disclosure text, and
  storage/snapshot redaction.

Out of scope for this review:

- Durable Page/Web reading history.
- Cross-page reasoning workspace.
- Automatic screenshot sending.
- Replacing the runtime heuristic parser with a third-party parser.
- Publicly committing real-site HTML, URLs, copied text, screenshots, or manual
  labels.

## Runtime Architecture

The implementation is deliberately layered so future target types reuse the same
contracts instead of bypassing privacy and audit gates.

| Layer | Role | Review focus |
|---|---|---|
| Popup | Captures a one-time user read intent and opens Page/Web. | One click should be enough for manual reads. |
| Side Panel runtime | Holds session-only Page/Web state, tab sessions, stale markers, target state, and model analysis state. | UI should explain what has been read, what is stale, and what is model-ready. |
| Service worker | Mediates extension messages, content-script reads, permission boundaries, and model calls. | Privileged model runtime must use trusted stored settings, not content-script supplied endpoints. |
| Content scripts | Extract live page surfaces and target snapshots. | Page extraction should not mutate live pages or leak private data into storage. |
| Reading contracts | `ReadingSurface`, `ReadingTarget`, and General Page context types. | Page, selection, current-region, and screenshot recovery should converge through the same model-context boundary. |
| Tier B model client | Builds compact or full JSON-only prompts and parses bounded output. | Automatic Page/Web analysis should use quick mode; screenshot-confirmed recovery may use full mode. |
| Audit tooling | Uses synthetic local pages and live CDP to verify behavior. | Artifacts stay under `tmp/` and remain private. |

## Main Flows

### Manual Page/Web Read

1. User clicks the toolbar popup read action on an HTTP/HTTPS page.
2. The popup path grants activeTab for the current page and opens the Side
   Panel.
3. The Side Panel sends the read request and renders Page/Web once extraction
   returns.
4. The in-panel read button remains available for retry/refresh, but should not
   be required as a second step.

### Auto-Read With All-Sites Access

1. User has granted all-sites host access in settings.
2. The Side Panel is open.
3. Navigating to a new readable HTTP/HTTPS page triggers automatic Page/Web
   extraction for the current tab.
4. If the page is eligible and Tier B settings are available, Page/Web requests
   a quick brief automatically.
5. Blocked pages and pages requiring an explicit user target remain fail-closed.

This boundary is intentional: all-sites access does not mean background crawling;
it means Truly may read the currently viewed page while the user is actively
using the Side Panel.

### Quick Brief Versus Full Brief

Automatic Page/Web analysis uses quick mode:

- lower output token cap;
- one-sentence summary target;
- at most two background items;
- at most one claim and one follow-up question;
- UI copy says the model produced a quick brief.

Full mode is reserved for explicit recovery flows such as user-confirmed
screenshot-assisted analysis.

### Targeted Reading

Selection and current-region reading are modeled as `ReadingTarget`s. The v1
goal is to keep the contract and fail-closed behavior correct so future
paragraph summary and check features can reuse the same target boundary.

Selection requires an explicit in-panel action. Current-region shortcut support
uses a session marker and only works when the page has already been granted to
Truly.

### Screenshot Recovery

Screenshot-assisted analysis is offered only when text extraction is too weak,
the page is not blocked, and the model provider supports vision. The user sees a
preview and must confirm before the data URL is sent to the configured model
endpoint. Screenshot data must remain session-only and must not enter
`chrome.storage`, debug snapshot DOM export, logs, release artifacts, or public
fixtures.

## Evidence Commands

Run from the General Page Reader worktree root.

```bash
rtk npm run check:public
TRULY_EXTENSION_ID=<loaded extension id> TRULY_AUDIT_AUTO_RELOAD=1 rtk npm run audit:general-page-reader
TRULY_EXTENSION_ID=<loaded extension id> TRULY_AUDIT_AUTO_RELOAD=1 rtk npm run audit:facebook-current:zh
rtk npm run cws:preflight
```

Expected evidence:

- `check:public` passes typecheck, contract tests, unit tests, build, parser
  spikes, public-boundary checks, model-integration audit, and release bundle
  audit.
- `audit:general-page-reader` passes synthetic Page/Web flows, quick brief
  detection, saved-session switching, target flows, no-grant guidance, and
  storage privacy scanning.
- `audit:facebook-current:zh` passes against the currently opened Chinese
  Facebook flow before release review.
- `cws:preflight` confirms release disclosure strings remain aligned with
  permissions and screenshot behavior.

## Current Validation Snapshot

The current parser and Page/Web runtime have three layers of validation. Private
artifacts contain real URLs and extracted previews; only aggregate evidence is
safe to copy into public review material.

| Area | Evidence | Current result |
|---|---|---|
| Public synthetic corpus | `check:general-page-corpus` and `spike:general-page-parsers` | 68 public-safe fixtures, 30 covered patterns, runtime baseline 68/68. |
| Chinese live-DOM news validation | Private Google News publisher-URL reviews under `/private/tmp/truly-google-news-100` | 100/100 `good` after fixture-driven fixes, plus a fresh 50/50 `good` validation set. |
| English live-DOM validation | Private balanced review under `/private/tmp/truly-english-validation-v1` | Primary readable pages: 78/78 extracted, 70 `good`, 7 `partial`, 1 expected blocked/empty; edge pages mostly partial/blocked/error as expected. |
| CDP review harness | `tests/unit/cdp-page-source.test.mjs` | Stuck CDP target now becomes a recorded timeout and closes the target instead of leaving review output missing. |
| Page/Web CDP product audit | `TRULY_EXTENSION_ID=<id> TRULY_AUDIT_AUTO_RELOAD=1 rtk npm run audit:general-page-reader` | Passed on 2026-07-07 with popup read included. A later post-build rerun used `TRULY_AUDIT_SKIP_POPUP_READ=1` because Chrome reported an inactive native window for `chrome.action.openPopup`; the non-popup Page/Web flows still passed. The combined evidence covers popup read, Side Panel auto-read, quick brief dispatch, tab switching, selection/current-region targets, unsupported-page guidance, screenshot recovery, storage privacy, and responsive UI checks. |
| Facebook live smoke | `TRULY_EXTENSION_ID=<id> rtk npm run audit:facebook-current:zh` | Passed on 2026-07-07 against a logged-in Chinese Facebook home feed. Verified clean service-worker/content-script build `1783366275821-4bb7a2a`, `zh-Hant` locale, heads-up rendering, post tagging, valid boundaries, selector health, heads-up expand/collapse, and deep-read Side Panel handoff from the `深入閱讀` action button. |
| Runtime auto-read and model dispatch | `tests/unit/page-reading-runtime.test.ts` | all-sites auto-read is gated on Side Panel use, auto quick brief uses Tier B settings, and weak/target-required pages fail closed. |
| Screenshot recovery | `tests/unit/page-reading-runtime.test.ts`, `tests/unit/screenshot-data-url.test.ts`, `tests/unit/snapshot-redaction.test.ts` | Vision recovery is user-confirmed, data URL format-checked, session-only, and snapshot-redacted. |

Facebook live audit is intentionally separate from Page/Web synthetic audit. It
requires an already opened, logged-in `facebook.com` page in the CDP session.

## Reviewer Flow Notes

For the human review pass, treat Page/Web pages as one of three classes:

- **Article-grade pages**: news, blog posts, company posts, government/NGO detail
  pages, and technical docs should usually be `ready` or at least readable.
- **Overview-grade pages**: index/feed/search/forum/social pages may be useful
  as page overviews, but should not be judged as clean single-article reads.
- **Blocked or unsuitable pages**: login walls, paywalls, `chrome://`,
  extension pages, PDFs without a readable DOM, and pages requiring a selected
  target should fail closed with clear guidance.

This distinction is important during review: a forum index or paywall homepage
being `partial`, `blocked`, or `error` is often the correct product behavior,
not a parser regression.

## Human Review Checklist

- Manual read: toolbar popup read action should be enough; Side Panel read is a
  refresh/retry control.
- Auto-read: with all-sites access, Page/Web should read only while the Side
  Panel is open.
- Model output: automatic briefs should feel compact and not like a debug dump.
- Timing copy: extraction elapsed and model elapsed should be distinguishable.
- Parser quality: preview should not start with JSON-LD, navigation, related
  links, browser-download prompts, or other obvious page chrome.
- Multi-tab state: switching saved Page/Web sessions should not imply the Chrome
  active tab changed unless the user chooses that action.
- Facebook: Feed should remain activated on Facebook pages, and existing heads-
  up, deep-read, and check actions should still work.
- Privacy: screenshots, full page text, raw HTML, and real-site evidence should
  not appear in storage, public docs, release artifacts, or committed fixtures.
- CWS wording: all-sites access, model sending, and screenshot-assisted recovery
  should match reviewer notes and privacy policy language.
- Review packet: compare the temporary HTML at
  `/private/tmp/truly-general-page-reader-feature-summary.html` with this file
  before release review; the HTML is for human scanning only and should not be
  treated as a public evidence artifact.

## Known Review Risks

- Real-site parser quality still needs human judgment beyond synthetic audit
  pages.
- Quick brief reduces output length but does not eliminate model latency; slow
  providers can still take noticeable time.
- Current-region targeting is a v1 seam; it is intentionally conservative and
  should not be judged as the final paragraph UX.
- Vision fallback exists as a confirmed recovery path, not as automatic visual
  parsing.
