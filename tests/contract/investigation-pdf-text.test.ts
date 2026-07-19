import { describe, expect, it } from "vitest";

import { BoundedPdfTextError, extractBoundedPdfText } from "../../scripts/lib/investigation-pdf-text";

function loader(pages: string[]) {
  return async () => ({
    numPages: pages.length,
    async getPage(pageNumber: number) {
      return { async getTextContent() { return { items: [{ str: pages[pageNumber - 1] }] }; } };
    },
  });
}

describe("bounded PDF text adapter", () => {
  it("extracts text incrementally without rendering or OCR", async () => {
    const text = await extractBoundedPdfText(Buffer.from("fixture"), {
      maxPages: 3, maxCharacters: 1_000, timeoutMs: 1_000,
      loadDocument: loader(["An official record with enough text to answer the first question.", "A second page supplies the effective date and quantity."]),
    });
    expect(text).toContain("official record");
    expect(text).toContain("effective date");
  });

  it("fails closed on page, character, and text-layer limits", async () => {
    await expect(extractBoundedPdfText(Buffer.from("fixture"), {
      maxPages: 1, maxCharacters: 1_000, timeoutMs: 1_000, loadDocument: loader(["page one", "page two"]),
    })).rejects.toMatchObject<Partial<BoundedPdfTextError>>({ code: "page_limit" });
    await expect(extractBoundedPdfText(Buffer.from("fixture"), {
      maxPages: 2, maxCharacters: 1_000, timeoutMs: 1_000, loadDocument: loader(["x".repeat(1_001)]),
    })).rejects.toMatchObject<Partial<BoundedPdfTextError>>({ code: "character_limit" });
    await expect(extractBoundedPdfText(Buffer.from("fixture"), {
      maxPages: 1, maxCharacters: 1_000, timeoutMs: 1_000, loadDocument: loader([""]),
    })).rejects.toMatchObject<Partial<BoundedPdfTextError>>({ code: "text_unavailable" });
  });
});
