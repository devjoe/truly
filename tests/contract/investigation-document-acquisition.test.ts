import { afterEach, describe, expect, it, vi } from "vitest";
import {
  INVESTIGATION_DOCUMENT_ACQUISITION_VERSION,
  acquisitionFailure,
  validateInvestigationDocumentAcquisitionRequest,
} from "../../src/lib/investigation-document-acquisition";
import { acquireInvestigationDocument } from "../../scripts/lib/investigation-document-fetch";

afterEach(() => vi.unstubAllGlobals());

describe("investigation document acquisition contract", () => {
  const request = {
    version: INVESTIGATION_DOCUMENT_ACQUISITION_VERSION,
    requestId: "acquire:public-document",
    source: { kind: "url" as const, url: "https://agency.example.test/notice.pdf" },
    consentClass: "public_document" as const,
    allowedCapabilities: ["direct_html", "direct_text", "direct_pdf"] as const,
    maxBytes: 2_000_000,
    timeoutMs: 12_000,
  };

  it("accepts a bounded public-document request without page content", () => {
    expect(validateInvestigationDocumentAcquisitionRequest(request)).toBe(true);
  });

  it("rejects local file URLs and unbounded requests", () => {
    expect(validateInvestigationDocumentAcquisitionRequest({
      ...request,
      source: { kind: "url", url: "file:///private/claim.pdf" },
    })).toBe(false);
    expect(validateInvestigationDocumentAcquisitionRequest({ ...request, maxBytes: 50_000_000 })).toBe(false);
  });

  it("represents unavailable PDF acquisition explicitly", () => {
    expect(acquisitionFailure(request.requestId, "capability_unavailable", "No PDF adapter is configured.", {
      retryable: false,
      attemptedCapability: "direct_pdf",
      requiredCapability: "direct_pdf",
      contentType: "application/pdf",
    })).toMatchObject({
      ok: false,
      code: "capability_unavailable",
      requiredCapability: "direct_pdf",
      retryable: false,
    });
  });

  it("fails an invalid adapter request before network acquisition", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const result = await acquireInvestigationDocument({ ...request, maxBytes: 5 } as typeof request, {
      timeoutMs: 12_000,
      maxBytes: 2_000_000,
    });
    expect(result).toMatchObject({ ok: false, code: "invalid_request" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("distinguishes PDF parser failure from a transport failure", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(new Uint8Array([1, 2, 3]), {
      status: 200,
      headers: { "content-type": "application/pdf" },
    })));
    const result = await acquireInvestigationDocument(request, {
      timeoutMs: 12_000,
      maxBytes: 2_000_000,
      pdfTextExtractor: async () => { throw new Error("invalid PDF"); },
    });
    expect(result).toMatchObject({
      ok: false,
      code: "parse_failed",
      attemptedCapability: "direct_pdf",
    });
  });

  it("rejects a declared oversized response before buffering its body", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("small placeholder", {
      status: 200,
      headers: {
        "content-type": "text/plain",
        "content-length": "3000000",
      },
    })));
    const result = await acquireInvestigationDocument(request, {
      timeoutMs: 12_000,
      maxBytes: 2_000_000,
    });
    expect(result).toMatchObject({ ok: false, code: "document_too_large" });
  });
});
