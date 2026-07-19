/**
 * Transport-neutral document acquisition boundary for Claim Investigation.
 *
 * This contract describes how a public or consent-bound document was acquired.
 * It does not grant permissions, perform retrieval, or turn discovery snippets
 * into evidence. Concrete Node, browser, and App adapters live outside it.
 */

export const INVESTIGATION_DOCUMENT_ACQUISITION_VERSION = 1 as const;

export type InvestigationDocumentAcquisitionCapability =
  | "direct_html"
  | "direct_text"
  | "direct_pdf"
  | "rendered_browser"
  | "authenticated_browser"
  | "user_supplied"
  | "native_app";

export type InvestigationDocumentConsentClass =
  | "public_document"
  | "active_tab"
  | "authenticated_session"
  | "user_selected_file"
  | "local_workspace";

export type InvestigationDocumentContentKind = "html" | "text" | "pdf";

export interface InvestigationDocumentAcquisitionRequest {
  version: typeof INVESTIGATION_DOCUMENT_ACQUISITION_VERSION;
  requestId: string;
  source: { kind: "url"; url: string } | { kind: "user_supplied"; label: string };
  consentClass: InvestigationDocumentConsentClass;
  allowedCapabilities: InvestigationDocumentAcquisitionCapability[];
  maxBytes: number;
  timeoutMs: number;
}

export interface InvestigationDocumentAcquisitionSuccess {
  version: typeof INVESTIGATION_DOCUMENT_ACQUISITION_VERSION;
  requestId: string;
  ok: true;
  capability: InvestigationDocumentAcquisitionCapability;
  contentKind: InvestigationDocumentContentKind;
  finalUrl?: string;
  title?: string;
  text: string;
  contentType: string;
  contentFingerprint: string;
  provenance: {
    adapter: string;
    consentClass: InvestigationDocumentConsentClass;
    acquiredAt: string;
  };
}

export type InvestigationDocumentAcquisitionFailureCode =
  | "invalid_request"
  | "capability_unavailable"
  | "access_denied"
  | "http_error"
  | "timeout"
  | "network_error"
  | "document_too_large"
  | "unsupported_format"
  | "parse_failed"
  | "empty_document";

export interface InvestigationDocumentAcquisitionFailure {
  version: typeof INVESTIGATION_DOCUMENT_ACQUISITION_VERSION;
  requestId: string;
  ok: false;
  code: InvestigationDocumentAcquisitionFailureCode;
  message: string;
  retryable: boolean;
  attemptedCapability?: InvestigationDocumentAcquisitionCapability;
  requiredCapability?: InvestigationDocumentAcquisitionCapability;
  httpStatus?: number;
  contentType?: string;
}

export type InvestigationDocumentAcquisitionResult =
  | InvestigationDocumentAcquisitionSuccess
  | InvestigationDocumentAcquisitionFailure;

const ID_RE = /^[a-z0-9][a-z0-9._:-]{0,127}$/i;
const CAPABILITIES = new Set<InvestigationDocumentAcquisitionCapability>([
  "direct_html", "direct_text", "direct_pdf", "rendered_browser",
  "authenticated_browser", "user_supplied", "native_app",
]);
const CONSENT_CLASSES = new Set<InvestigationDocumentConsentClass>([
  "public_document", "active_tab", "authenticated_session",
  "user_selected_file", "local_workspace",
]);

export function validateInvestigationDocumentAcquisitionRequest(
  value: unknown,
): value is InvestigationDocumentAcquisitionRequest {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const request = value as Record<string, unknown>;
  if (request.version !== INVESTIGATION_DOCUMENT_ACQUISITION_VERSION ||
    typeof request.requestId !== "string" || !ID_RE.test(request.requestId) ||
    !CONSENT_CLASSES.has(request.consentClass as InvestigationDocumentConsentClass) ||
    !Number.isInteger(request.maxBytes) || Number(request.maxBytes) < 100_000 || Number(request.maxBytes) > 4_000_000 ||
    !Number.isInteger(request.timeoutMs) || Number(request.timeoutMs) < 1_000 || Number(request.timeoutMs) > 30_000 ||
    !Array.isArray(request.allowedCapabilities) || request.allowedCapabilities.length < 1 ||
    request.allowedCapabilities.some((entry) => !CAPABILITIES.has(entry as InvestigationDocumentAcquisitionCapability))) {
    return false;
  }
  const source = request.source as Record<string, unknown> | undefined;
  if (!source || typeof source !== "object") return false;
  if (source.kind === "url") {
    if (typeof source.url !== "string") return false;
    try {
      const url = new URL(source.url);
      return url.protocol === "https:" || url.protocol === "http:";
    } catch {
      return false;
    }
  }
  return source.kind === "user_supplied" && typeof source.label === "string" && source.label.trim().length > 0;
}

export function acquisitionFailure(
  requestId: string,
  code: InvestigationDocumentAcquisitionFailureCode,
  message: string,
  options: Omit<InvestigationDocumentAcquisitionFailure, "version" | "requestId" | "ok" | "code" | "message">,
): InvestigationDocumentAcquisitionFailure {
  return {
    version: INVESTIGATION_DOCUMENT_ACQUISITION_VERSION,
    requestId,
    ok: false,
    code,
    message,
    ...options,
  };
}
