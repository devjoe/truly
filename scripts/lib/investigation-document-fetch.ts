import crypto from "node:crypto";

import { Readability } from "@mozilla/readability";
import { JSDOM, VirtualConsole } from "jsdom";
import {
  INVESTIGATION_DOCUMENT_ACQUISITION_VERSION,
  acquisitionFailure,
  validateInvestigationDocumentAcquisitionRequest,
  type InvestigationDocumentAcquisitionRequest,
  type InvestigationDocumentAcquisitionResult,
} from "../../src/lib/investigation-document-acquisition";

export interface InvestigationDocumentFetchOptions {
  timeoutMs: number;
  maxBytes: number;
  titleHint?: string;
}

export interface InvestigationNodeAcquisitionOptions extends InvestigationDocumentFetchOptions {
  pdfTextExtractor?: (buffer: Buffer) => Promise<string>;
}

export function parseDocumentText(html: string, url: string): { title?: string; text: string; parser: string } {
  const virtualConsole = new VirtualConsole();
  const dom = new JSDOM(html, { url, virtualConsole });
  const clone = dom.window.document.cloneNode(true) as Document;
  const article = new Readability(clone, { charThreshold: 40 }).parse();
  const readabilityText = article?.textContent?.replace(/\s*\n\s*/gu, "\n\n").trim() ?? "";
  if (readabilityText.length >= 80) return { title: article?.title ?? undefined, text: readabilityText, parser: "readability" };
  const fallback = dom.window.document.body?.textContent?.replace(/\s*\n\s*/gu, "\n\n").replace(/[ \t]+/gu, " ").trim() ?? "";
  return { title: dom.window.document.title || undefined, text: fallback, parser: "body_text" };
}

export async function readBoundedResponseBody(response: Response, maxBytes: number): Promise<Buffer | undefined> {
  const declaredLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) return undefined;
  if (!response.body) {
    const buffer = Buffer.from(await response.arrayBuffer());
    return buffer.byteLength <= maxBytes ? buffer : undefined;
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel("document_too_large");
      return undefined;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)), total);
}

/** Node-only private-evaluation adapter. Search-result snippets never enter. */
export async function acquireInvestigationDocument(
  request: InvestigationDocumentAcquisitionRequest,
  options: InvestigationNodeAcquisitionOptions,
): Promise<InvestigationDocumentAcquisitionResult> {
  if (!validateInvestigationDocumentAcquisitionRequest(request)) {
    return acquisitionFailure(typeof request?.requestId === "string" ? request.requestId : "acquire:invalid-request", "invalid_request", "The acquisition request failed contract validation.", {
      retryable: false,
    });
  }
  if (request.source.kind !== "url" || request.consentClass !== "public_document") {
    return acquisitionFailure(request.requestId, "capability_unavailable", "The Node development adapter only acquires public URLs.", {
      retryable: false,
      requiredCapability: request.source.kind === "user_supplied" ? "user_supplied" : "authenticated_browser",
    });
  }
  const url = request.source.url;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), request.timeoutMs);
  try {
    const response = await fetch(url, {
      redirect: "follow",
      signal: controller.signal,
      headers: {
        accept: "text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.1",
        "user-agent": "Truly development evidence retrieval audit/1.0",
      },
    });
    if (!response.ok) {
      return acquisitionFailure(request.requestId, response.status === 401 || response.status === 403 ? "access_denied" : "http_error", `HTTP ${response.status}`, {
        retryable: response.status === 408 || response.status === 429 || response.status >= 500,
        attemptedCapability: "direct_html",
        httpStatus: response.status,
      });
    }
    const contentType = response.headers.get("content-type") ?? "";
    const buffer = await readBoundedResponseBody(response, request.maxBytes);
    if (!buffer) {
      return acquisitionFailure(request.requestId, "document_too_large", "The acquired document exceeds the byte limit.", {
        retryable: false,
        contentType,
      });
    }
    const isPdf = /application\/pdf/iu.test(contentType) || response.url.toLocaleLowerCase().endsWith(".pdf");
    const isText = /text\/plain/iu.test(contentType);
    const isHtml = /(?:text\/html|application\/xhtml\+xml)/iu.test(contentType);
    if (isPdf && !request.allowedCapabilities.includes("direct_pdf")) {
      return acquisitionFailure(request.requestId, "capability_unavailable", "PDF acquisition was not allowed for this request.", {
        retryable: false, requiredCapability: "direct_pdf", contentType,
      });
    }
    if (isPdf && !options.pdfTextExtractor) {
      return acquisitionFailure(request.requestId, "capability_unavailable", "No bounded PDF text extractor is configured.", {
        retryable: false, requiredCapability: "direct_pdf", attemptedCapability: "direct_pdf", contentType,
      });
    }
    if (!isPdf && !isText && !isHtml) {
      return acquisitionFailure(request.requestId, "unsupported_format", "The acquired content type is not supported.", {
        retryable: false, contentType,
      });
    }
    const capability = isPdf ? "direct_pdf" : isText ? "direct_text" : "direct_html";
    if (!request.allowedCapabilities.includes(capability)) {
      return acquisitionFailure(request.requestId, "capability_unavailable", `${capability} was not allowed for this request.`, {
        retryable: false, requiredCapability: capability, contentType,
      });
    }
    const raw = buffer.toString("utf8");
    let parsed: { text: string; parser: string; title?: string };
    if (isPdf) {
      try {
        parsed = { text: (await options.pdfTextExtractor!(buffer)).trim(), parser: "pdf_text", title: options.titleHint };
      } catch {
        return acquisitionFailure(request.requestId, "parse_failed", "The bounded PDF extractor could not parse this document.", {
          retryable: false,
          attemptedCapability: "direct_pdf",
          contentType,
        });
      }
    } else if (isText) {
      parsed = { text: raw.trim(), parser: "plain_text", title: options.titleHint };
    } else {
      parsed = parseDocumentText(raw, response.url);
    }
    if (parsed.text.length < 40) {
      return acquisitionFailure(request.requestId, "empty_document", "The acquired document did not contain enough readable text.", {
        retryable: false, attemptedCapability: capability, contentType,
      });
    }
    return {
      version: INVESTIGATION_DOCUMENT_ACQUISITION_VERSION,
      requestId: request.requestId,
      ok: true,
      capability,
      contentKind: isPdf ? "pdf" : isText ? "text" : "html",
      finalUrl: response.url,
      contentType,
      contentFingerprint: crypto.createHash("sha256").update(parsed.text).digest("hex"),
      text: parsed.text,
      title: parsed.title,
      provenance: {
        adapter: `node_${parsed.parser}`,
        consentClass: request.consentClass,
        acquiredAt: new Date().toISOString(),
      },
    };
  } catch (error) {
    const name = error instanceof Error ? error.name : "Error";
    return acquisitionFailure(request.requestId, name === "AbortError" ? "timeout" : "network_error", name === "AbortError" ? "Document acquisition timed out." : "Document acquisition failed.", {
      retryable: true,
    });
  } finally {
    clearTimeout(timeout);
  }
}

/** Compatibility wrapper for the earlier private retrieval pilot. */
export async function fetchInvestigationDocument(url: string, options: InvestigationNodeAcquisitionOptions) {
  const result = await acquireInvestigationDocument({
    version: INVESTIGATION_DOCUMENT_ACQUISITION_VERSION,
    requestId: `acquire:${crypto.createHash("sha256").update(url).digest("hex").slice(0, 24)}`,
    source: { kind: "url", url },
    consentClass: "public_document",
    allowedCapabilities: ["direct_html", "direct_text", "direct_pdf"],
    maxBytes: options.maxBytes,
    timeoutMs: options.timeoutMs,
  }, options);
  if (!result.ok) {
    return {
      ok: false as const,
      error: result.code === "document_too_large" ? "document_too_large" :
        result.code === "empty_document" ? "empty_document" :
          result.code === "timeout" ? "timeout" :
            result.code === "network_error" ? "network_error" :
              result.httpStatus ? `http_${result.httpStatus}` : result.code,
      contentType: result.contentType,
      acquisitionFailure: result,
    };
  }
  return {
    ok: true as const,
    finalUrl: result.finalUrl!,
    contentType: result.contentType,
    documentSha256: result.contentFingerprint,
    text: result.text,
    parser: result.provenance.adapter,
    title: result.title,
    acquisition: result,
  };
}
