# Facebook Live Audit

This document records the supported live-audit workflow for Facebook surfaces.
Audit artifacts may include logged-in Facebook page screenshots or live-page
text, so generated outputs must stay under `tmp/` and must not be committed.

## Current Page Audit

Run the current visible Facebook tab audit through the existing Chrome CDP
session:

```bash
npm run audit:facebook-current
```

Locale-specific wrappers are available:

```bash
npm run audit:facebook-current:zh
npm run audit:facebook-current:en
```

The current-page audit verifies:

- Chrome CDP reachability;
- Truly service worker presence and build freshness;
- Facebook content-script build freshness;
- expected Facebook locale signals;
- heads-up host rendering and post boundary geometry;
- selector health from the content script;
- heads-up expand/collapse behavior;
- Side Panel opening from the heads-up action button;
- Side Panel text presence, horizontal overflow, and raw-debug visibility.

## Stale Build Remediation

If the audit detects a stale service worker or Facebook content script, the
summary includes remediation hints. To let the audit reload the extension and
Facebook tabs before continuing, run:

```bash
TRULY_AUDIT_AUTO_RELOAD=1 npm run audit:facebook-current:zh
```

The auto-reload path reloads the Truly extension from the live service worker,
reloads open `facebook.com` tabs, then reselects the target before running the
normal audit checks.

## Side Panel Fallback

The audit opens the Side Panel through the visible heads-up action. It first
uses a CDP mouse click, then falls back to a Shadow DOM click if Chrome does not
surface a side-panel target. If local Chrome requires a focused tab for
`chrome.sidePanel.open()`, run:

```bash
CDP_ALLOW_FOCUS=1 npm run audit:facebook-current:zh
```

The summary records every click attempt, for example `cdp-mouse:0,
dom-click:1`, so side-panel user-gesture failures are visible instead of being
mistaken for parser or selector failures.

## Open Tabs Audit

Run the current-page audit against every open Facebook tab:

```bash
npm run audit:facebook-open-tabs:zh
```

Use this after opening the scenarios to cover, such as feed, group, profile, and
single-post pages. The repo does not commit a URL matrix because logged-in
Facebook pages and screenshots are private browser artifacts.

## 2026-06-29 Chinese Facebook Audit

The zh audit was upgraded after switching Facebook back to Traditional Chinese.
The implementation run verified:

- build id: `1782721951193-89b07be-dirty`;
- locale: `zh-Hant`;
- Facebook zh tokens: `首頁`, `查看更多`, `展開`;
- Truly zh tokens: `分析完成`, `深入閱讀`, `詳細`, `收合`, `建議查核`;
- heads-up hosts: 2;
- tagged posts: 3;
- Side Panel action: `建議查核`;
- Side Panel click attempts: `cdp-mouse:0`, `dom-click:1`;
- Side Panel visual health: text present, overflow 0, raw debug hidden.

Reference artifact from that run:

```text
tmp/facebook-current-audit-2026-06-29T10-07-22-177Z/summary.md
```
