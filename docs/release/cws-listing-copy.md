# Chrome Web Store Listing Copy

Status: CWS preparation draft for review
Last updated: 2026-06-22

This draft is meant to be copied into the Chrome Web Store dashboard after
final review. It should stay aligned with `README.md`,
`src/manifest.json`, `src/_locales/*/messages.json`, and
https://trulyreader.org/.

Official requirements used for this draft:

- Listing details and localization:
  https://developer.chrome.com/docs/webstore/cws-dashboard-listing
- Graphic asset requirements:
  https://developer.chrome.com/docs/webstore/images
- Privacy fields:
  https://developer.chrome.com/docs/webstore/cws-dashboard-privacy

## Name

Truly

## Category

Productivity

## Visibility

Unlisted. Anyone with the Chrome Web Store URL can install the item, but it is
not intended to appear as a public searchable launch yet.

## Version Label

Keep the visible Preview label in `manifest.version_name` for the first
Unlisted submission. This keeps the Chrome Web Store item aligned with the
GitHub Preview release cadence and sets the right expectation for early users.

## Default Locale

English

## Default / English Listing

### Short Description

Privacy-conscious reading assistance for social feeds and web pages.

### Full Description

Truly is a privacy-conscious Chrome extension that helps readers improve
information quality in social feeds and web pages.

It starts beside the post you are reading. Truly can show a compact reading
hint, expand into a short explanation, and open a side panel with summary,
context, follow-up questions, claim signals, and manual handoff actions.

Truly currently focuses on supported Facebook reading surfaces. The longer
roadmap is to support more social feeds, normal web pages, mobile apps, desktop
apps, and community features.

Reading analysis runs in the model environment selected by the user: Chrome
built-in Gemini Nano when available, a local model endpoint such as Ollama, or a
private endpoint the user configures. Truly does not operate a project-owned
backend for feed content and does not include product analytics or telemetry.

External tool use is manual. Search, Meta AI handoff, Markdown copy, and
Markdown download happen only when the user chooses the relevant action.

Preview limitations:

- Supported social feed surfaces may change as websites update their layout.
- Model quality and speed depend on the selected model source.
- Truly provides reading assistance, not authoritative truth.

## zh-TW Localized Listing

### Short Description

重視隱私、協助梳理脈絡的閱讀小幫手。

### Full Description

Truly 是一個重視隱私、提高閱讀資訊品質的 Chrome 擴充功能。它協助你在資訊亂流中，從提醒、摘要，到釐清脈絡與快速查證。

Truly 目前以瀏覽器擴充功能做為起點，作用於支援的社群貼文旁。閱讀時，它可以顯示簡短的閱讀前提示；需要更深入時，你可以展開提示，查看貼文摘要、閱讀提醒、脈絡分析、需查證的主張，以及手動交給外部工具的操作。

Truly 的分析會送到你選擇的模型環境：可用時使用 Chrome 內建的 Gemini Nano，也可以使用本機模型端點，例如 Ollama，或你自行設定的私有端點。Truly 不經營接收資訊流內容的專案後端，也不包含產品分析或遙測。

外部工具使用皆由使用者主動觸發。Google 查詢、Meta AI handoff、Markdown 複製與 Markdown 下載，都只會在你選擇相應動作後發生。

預覽版限制：

- 支援的社群頁面可能隨網站版面調整而變動。
- 模型品質與速度取決於你選擇的模型來源。
- Truly 提供的是閱讀輔助，不是權威事實判定。

## Support Notes

- Use the public README for setup instructions.
- Use https://trulyreader.org/privacy/ as the submitted privacy policy URL.
- Use cws@trulyreader.org for Chrome Web Store contact.
- Collect early preview feedback through `https://trulyreader.org/feedback/`;
  keep GitHub Issues for reproducible technical problems.

## Localization Plan

Submit the zh-TW localized listing with the first Unlisted review. Truly's
initial audience and product language already include Traditional Chinese, and
the public website has a zh-TW version.

## Submission Asset Set

Use the selected first Unlisted review assets in
`docs/release/store-assets.md`.
