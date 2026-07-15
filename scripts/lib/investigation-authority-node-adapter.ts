import crypto from "node:crypto";

import { JSDOM, VirtualConsole } from "jsdom";

import type { AuthorityDiscoveryRequest } from "../../src/lib/investigation-authority-discovery";
import type {
  AuthorityDiscoveryAdapter,
  AuthorityDiscoveryAcquiredPage,
  AuthorityDiscoveryAcquisitionFailure,
} from "../../src/lib/investigation-authority-discovery-executor";
import { parseDocumentText, readBoundedResponseBody } from "./investigation-document-fetch";
import { extractBoundedPdfText } from "./investigation-pdf-text";

export interface AuthorityDiscoveryNodeAdapterOptions {
  timeoutMs: number;
  maxBytesPerDocument: number;
  maxLinksPerPage: number;
  maxPdfPages: number;
  maxDocumentCharacters: number;
}

export function extractAuthorityDiscoveryLinks(
  html: string,
  baseUrl: string,
  maximum: number,
): Array<{ url: string; label: string }> {
  if (!Number.isInteger(maximum) || maximum < 0 || maximum > 2_000) throw new TypeError("invalid maximum link count");
  const dom = new JSDOM(html, { url: baseUrl, virtualConsole: new VirtualConsole() });
  const links: Array<{ url: string; label: string }> = [];
  for (const anchor of dom.window.document.querySelectorAll<HTMLAnchorElement>("a[href]")) {
    if (links.length >= maximum) break;
    const label = (anchor.textContent ?? anchor.getAttribute("aria-label") ?? anchor.getAttribute("title") ?? "")
      .replace(/\s+/gu, " ").trim().slice(0, 500);
    links.push({ url: anchor.href, label });
  }
  dom.window.close();
  return links;
}

function failure(reason: AuthorityDiscoveryAcquisitionFailure["reason"]): AuthorityDiscoveryAcquisitionFailure {
  return { ok: false, reason };
}

/** Node development adapter. It receives no claim or query and stores nothing. */
export function createAuthorityDiscoveryNodeAdapter(
  request: AuthorityDiscoveryRequest,
  options: AuthorityDiscoveryNodeAdapterOptions,
): AuthorityDiscoveryAdapter {
  const allowedHosts = new Set(request.allowedHosts.map((host) => host.toLocaleLowerCase()));
  return {
    async acquire(value): Promise<AuthorityDiscoveryAcquiredPage | AuthorityDiscoveryAcquisitionFailure> {
      let requested: URL;
      try { requested = new URL(value); } catch { return failure("unsupported_format"); }
      if ((requested.protocol !== "http:" && requested.protocol !== "https:") ||
        !allowedHosts.has(requested.hostname.toLocaleLowerCase())) return failure("access_denied");
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), options.timeoutMs);
      try {
        const response = await fetch(requested, {
          redirect: "follow",
          signal: controller.signal,
          headers: {
            accept: "text/html,application/xhtml+xml,application/pdf,text/plain;q=0.9,*/*;q=0.1",
            "user-agent": "Truly authority-local discovery development audit/1.0",
          },
        });
        if (!response.ok) return failure(response.status === 401 || response.status === 403 ? "access_denied" : "network_error");
        let finalUrl: URL;
        try { finalUrl = new URL(response.url); } catch { return failure("access_denied"); }
        if (!allowedHosts.has(finalUrl.hostname.toLocaleLowerCase())) return failure("access_denied");
        const contentType = response.headers.get("content-type") ?? "";
        const buffer = await readBoundedResponseBody(response, options.maxBytesPerDocument);
        if (!buffer) return failure("document_too_large");
        const isPdf = /application\/pdf/iu.test(contentType) || finalUrl.pathname.toLocaleLowerCase().endsWith(".pdf");
        const isText = /text\/plain/iu.test(contentType);
        const isHtml = /(?:text\/html|application\/xhtml\+xml)/iu.test(contentType);
        if (!isPdf && !isText && !isHtml) return failure("unsupported_format");
        let title: string | undefined;
        let text: string;
        let links: Array<{ url: string; label: string }> = [];
        if (isPdf) {
          try {
            text = (await extractBoundedPdfText(buffer, {
              maxPages: options.maxPdfPages,
              maxCharacters: options.maxDocumentCharacters,
              timeoutMs: options.timeoutMs,
            })).trim();
          } catch { return failure("parse_failed"); }
        } else if (isText) {
          text = buffer.toString("utf8").trim().slice(0, options.maxDocumentCharacters);
        } else {
          const html = buffer.toString("utf8");
          const parsed = parseDocumentText(html, finalUrl.toString());
          title = parsed.title;
          text = parsed.text.slice(0, options.maxDocumentCharacters);
          links = extractAuthorityDiscoveryLinks(html, finalUrl.toString(), options.maxLinksPerPage);
        }
        if (text.length < 40) return failure("parse_failed");
        return {
          ok: true,
          finalUrl: finalUrl.toString(),
          contentType,
          bytes: buffer.byteLength,
          title,
          text,
          fingerprint: crypto.createHash("sha256").update(text).digest("hex"),
          links,
        };
      } catch (error) {
        return failure(error instanceof Error && error.name === "AbortError" ? "timeout" : "network_error");
      } finally {
        clearTimeout(timer);
      }
    },
  };
}
