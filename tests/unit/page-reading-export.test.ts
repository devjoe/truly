import { describe, expect, it } from "vitest";

import {
  formatCompactPageReadingExport,
  formatFullPageReadingMarkdown,
  type PageReadingExportPacket,
} from "@src/sidepanel/page-reading-export";

function packet(overrides: Partial<PageReadingExportPacket> = {}): PageReadingExportPacket {
  return {
    lang: "zh-TW",
    title: "測試新聞頁",
    url: "https://example.test/article",
    sourceName: "測試媒體",
    authorName: "測試作者",
    publishedAt: "2026-07-13",
    caution: "讀到的內容可能不完整，請以原文為準。",
    excerpt: "這是供下載閱讀包使用的頁面文字預覽。",
    links: [
      { href: "https://source.test/report#part", text: "原始報告" },
      { href: "https://source.test/report", text: "重複來源" },
      { href: "https://related.test/context", text: "補充脈絡" },
    ],
    brief: {
      schemaVersion: 1,
      summary: "這是頁面內容的閱讀脈絡。",
      bg: [{ t: "背景主題", why: "有助於理解內容。", q: "背景從何而來？" }],
      claims: [{ c: "一項待確認主張", why: "影響判斷。", need: "原始資料" }],
      qs: [{ q: "有哪些公開證據？", kind: "source" }],
      note: "內容包含仍待確認的資訊。",
      model: "gemma4:e4b-it-qat:latest",
      elapsedMs: 2_400,
    },
    allowedUse: "article_or_selection_analysis",
    ...overrides,
  };
}

describe("page reading exports", () => {
  it("copies a compact localized reading result without raw or bulky page data", () => {
    const text = formatCompactPageReadingExport(packet());

    expect(text).toContain("測試新聞頁");
    expect(text).toContain("來源：測試媒體");
    expect(text).toContain("原始頁面：https://example.test/article");
    expect(text).toContain("閱讀脈絡\n這是頁面內容的閱讀脈絡。");
    expect(text).toContain("待確認事項");
    expect(text).toContain("延伸問題");
    expect(text).toContain("Gemma 4 E4B (QAT) 協助整理");
    expect(text).not.toContain("頁面文字預覽");
    expect(text).not.toContain("source.test");
    expect(text).not.toContain("Extraction:");
    expect(text).not.toContain("2.4");
  });

  it("downloads a complete Markdown reading package with bounded deduplicated sources", () => {
    const markdown = formatFullPageReadingMarkdown(packet());

    expect(markdown).toContain("# 測試新聞頁");
    expect(markdown).toContain("## 閱讀脈絡");
    expect(markdown).toContain("### 背景脈絡");
    expect(markdown).toContain("### 待確認事項");
    expect(markdown).toContain("## 閱讀提示");
    expect(markdown).toContain("## 頁面文字");
    expect(markdown).toContain("這是供下載閱讀包使用的頁面文字預覽。");
    expect(markdown).toContain("## 來源連結");
    expect(markdown.match(/source\.test\/report/g)).toHaveLength(1);
    expect(markdown).toContain("related.test/context");
    expect(markdown).not.toContain("semantic-html");
    expect(markdown).not.toContain("large-navigation-noise");
  });

  it("uses English labels and identifies page-overview scope", () => {
    const text = formatCompactPageReadingExport(packet({
      lang: "en",
      allowedUse: "page_overview_only",
    }));

    expect(text).toContain("Source: 測試媒體");
    expect(text).toContain("Original page: https://example.test/article");
    expect(text).toContain("Page overview\n這是頁面內容的閱讀脈絡。");
    expect(text).toContain("Items to verify");
    expect(text).toContain("Follow-up questions");
  });

  it("uses the shared concise display projection for exported follow-up questions", () => {
    const text = formatCompactPageReadingExport(packet({
      brief: {
        schemaVersion: 1,
        summary: "這是頁面內容的閱讀脈絡。",
        qs: [{ q: "這篇文章有哪些不同觀點？", kind: "counter" }],
        model: "synthetic-model",
      },
    }));

    expect(text).toContain("延伸問題\n• 有哪些不同觀點？");
    expect(text).not.toContain("• 這篇文章有哪些不同觀點？");
  });
});
