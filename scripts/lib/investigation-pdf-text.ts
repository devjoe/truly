export type BoundedPdfFailureCode = "page_limit" | "character_limit" | "timeout" | "text_unavailable";

export class BoundedPdfTextError extends Error {
  constructor(readonly code: BoundedPdfFailureCode, message: string) {
    super(message);
    this.name = "BoundedPdfTextError";
  }
}

interface PdfTextItemLike { str?: string }
interface PdfPageLike {
  getTextContent(): Promise<{ items: PdfTextItemLike[] }>;
  cleanup?(): void;
}
interface PdfDocumentLike {
  numPages: number;
  getPage(pageNumber: number): Promise<PdfPageLike>;
  cleanup?(): void;
  destroy?(): Promise<void>;
}

export interface BoundedPdfTextOptions {
  maxPages: number;
  maxCharacters: number;
  timeoutMs: number;
  loadDocument?: (data: Uint8Array) => Promise<PdfDocumentLike>;
}

async function defaultLoadDocument(data: Uint8Array): Promise<PdfDocumentLike> {
  const { getDocumentProxy } = await import("unpdf");
  return getDocumentProxy(data) as Promise<PdfDocumentLike>;
}

/** Private-evaluator text-only PDF adapter. It never renders pages or performs OCR. */
export async function extractBoundedPdfText(buffer: Buffer, options: BoundedPdfTextOptions): Promise<string> {
  if (!Number.isInteger(options.maxPages) || options.maxPages < 1 || options.maxPages > 200 ||
    !Number.isInteger(options.maxCharacters) || options.maxCharacters < 1_000 || options.maxCharacters > 500_000 ||
    !Number.isInteger(options.timeoutMs) || options.timeoutMs < 1_000 || options.timeoutMs > 30_000) {
    throw new Error("Invalid bounded PDF options");
  }
  const deadline = Date.now() + options.timeoutMs;
  const withinDeadline = async <T>(promise: Promise<T>): Promise<T> => {
    const remaining = deadline - Date.now();
    if (remaining <= 0) throw new BoundedPdfTextError("timeout", "PDF extraction timed out");
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        promise,
        new Promise<never>((_, reject) => {
          timeout = setTimeout(() => reject(new BoundedPdfTextError("timeout", "PDF extraction timed out")), remaining);
        }),
      ]);
    } finally {
      if (timeout) clearTimeout(timeout);
    }
  };

  const document = await withinDeadline((options.loadDocument ?? defaultLoadDocument)(new Uint8Array(buffer)));
  try {
    if (!Number.isInteger(document.numPages) || document.numPages < 1) {
      throw new BoundedPdfTextError("text_unavailable", "PDF has no readable pages");
    }
    if (document.numPages > options.maxPages) {
      throw new BoundedPdfTextError("page_limit", `PDF exceeds ${options.maxPages} pages`);
    }
    const pages: string[] = [];
    let characters = 0;
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      const page = await withinDeadline(document.getPage(pageNumber));
      try {
        const content = await withinDeadline(page.getTextContent());
        const text = content.items.map((item) => typeof item.str === "string" ? item.str : "").join(" ").replace(/\s+/gu, " ").trim();
        characters += text.length;
        if (characters > options.maxCharacters) {
          throw new BoundedPdfTextError("character_limit", `PDF exceeds ${options.maxCharacters} extracted characters`);
        }
        if (text) pages.push(text);
      } finally {
        page.cleanup?.();
      }
    }
    const text = pages.join("\n\n").trim();
    if (text.length < 40) throw new BoundedPdfTextError("text_unavailable", "PDF contains no usable text layer");
    return text;
  } finally {
    document.cleanup?.();
    await document.destroy?.();
  }
}
