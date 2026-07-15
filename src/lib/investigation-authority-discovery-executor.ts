import {
  buildAuthorityDiscoveryReceipt,
  authorityDiscoveryLinkPriority,
  rankAuthorityDiscoveryLinks,
  type AuthorityDiscoveryReceipt,
  type AuthorityDiscoveryRequest,
  type AuthorityDiscoveryStopReason,
} from "./investigation-authority-discovery";

export type AuthorityDiscoveryAcquisitionFailureReason =
  | "access_denied"
  | "capability_unavailable"
  | "document_too_large"
  | "network_error"
  | "parse_failed"
  | "timeout"
  | "unsupported_format";

export interface AuthorityDiscoveryAcquiredPage {
  ok: true;
  finalUrl: string;
  contentType: string;
  bytes: number;
  title?: string;
  text: string;
  fingerprint: string;
  links: Array<{ url: string; label?: string }>;
}

export interface AuthorityDiscoveryAcquisitionFailure {
  ok: false;
  reason: AuthorityDiscoveryAcquisitionFailureReason;
}

export interface AuthorityDiscoveryAdapter {
  acquire(url: string): Promise<AuthorityDiscoveryAcquiredPage | AuthorityDiscoveryAcquisitionFailure>;
}

export interface AuthorityDiscoveryDocument {
  url: string;
  title?: string;
  text: string;
  contentType: string;
  bytes: number;
  fingerprint: string;
  catalogEntryIds: string[];
  depth: number;
}

export interface AuthorityDiscoveryExecutionResult {
  documents: AuthorityDiscoveryDocument[];
  receipt: AuthorityDiscoveryReceipt;
}

export interface AuthorityDiscoveryExecutionOptions {
  now?: () => Date;
}

function stopReasonForFailure(reason: AuthorityDiscoveryAcquisitionFailureReason): AuthorityDiscoveryStopReason {
  if (reason === "access_denied") return "access_denied";
  if (reason === "capability_unavailable" || reason === "unsupported_format") return "capability_unavailable";
  if (reason === "timeout") return "time_budget";
  return "acquisition_failure";
}

/**
 * Capability-injected, breadth-first executor shared by development, Extension,
 * and future App adapters. It never accepts a claim or query and retains no
 * state beyond the returned result.
 */
export async function executeAuthorityDocumentDiscovery(
  request: AuthorityDiscoveryRequest,
  adapter: AuthorityDiscoveryAdapter,
  options: AuthorityDiscoveryExecutionOptions = {},
): Promise<AuthorityDiscoveryExecutionResult> {
  const now = options.now ?? (() => new Date());
  const startedAt = now();
  let sequence = 0;
  const queue = request.seedUrls.map((url) => ({ url, depth: 0, priority: 100, sequence: sequence++ }));
  const queued = new Set(queue.map((item) => item.url));
  const visited = new Set<string>();
  const fingerprints = new Set<string>();
  const observedHosts = new Set<string>();
  const documents: AuthorityDiscoveryDocument[] = [];
  let pagesVisited = 0;
  let bytesRead = 0;
  let failures = 0;
  let failureStopReason: AuthorityDiscoveryStopReason | undefined;
  let stopReason: AuthorityDiscoveryStopReason = "frontier_exhausted";

  while (queue.length > 0) {
    if (now().getTime() - startedAt.getTime() >= request.budget.maxDurationMs) {
      stopReason = "time_budget";
      break;
    }
    if (pagesVisited >= request.budget.maxPages) {
      stopReason = "page_budget";
      break;
    }
    if (documents.length >= request.budget.maxDocuments) {
      stopReason = "document_budget";
      break;
    }
    const current = queue.shift()!;
    if (visited.has(current.url)) continue;
    visited.add(current.url);
    pagesVisited += 1;
    const acquired = await adapter.acquire(current.url);
    if (!acquired.ok) {
      failures += 1;
      failureStopReason ??= stopReasonForFailure(acquired.reason);
      continue;
    }
    bytesRead += acquired.bytes;
    if (bytesRead > request.budget.maxBytes) {
      bytesRead -= acquired.bytes;
      stopReason = "byte_budget";
      break;
    }
    try { observedHosts.add(new URL(acquired.finalUrl).hostname.toLocaleLowerCase()); } catch { /* adapter output is discarded below */ }
    if (acquired.text.trim().length >= 40 && !fingerprints.has(acquired.fingerprint)) {
      fingerprints.add(acquired.fingerprint);
      documents.push({
        url: acquired.finalUrl,
        title: acquired.title,
        text: acquired.text.trim(),
        contentType: acquired.contentType,
        bytes: acquired.bytes,
        fingerprint: acquired.fingerprint,
        catalogEntryIds: [...request.catalogEntryIds],
        depth: current.depth,
      });
    }
    if (current.depth >= request.budget.maxDepth) continue;
    const ranked = rankAuthorityDiscoveryLinks(request, acquired.links.map((link) => ({
      ...link,
      parentUrl: acquired.finalUrl,
      depth: current.depth + 1,
    })), Math.min(500, request.budget.maxPages));
    for (const link of ranked) {
      if (!queued.has(link.url) && !visited.has(link.url)) {
        queued.add(link.url);
        queue.push({
          url: link.url,
          depth: link.depth,
          priority: authorityDiscoveryLinkPriority(link.kind),
          sequence: sequence++,
        });
      }
    }
    queue.sort((left, right) => left.depth - right.depth || right.priority - left.priority || left.sequence - right.sequence);
  }

  if (queue.length === 0 && failureStopReason) stopReason = failureStopReason;
  const completedAt = now();
  const receipt = buildAuthorityDiscoveryReceipt(request, {
    startedAt: startedAt.toISOString(),
    completedAt: completedAt.toISOString(),
    stopReason,
    pagesVisited,
    documentsCaptured: documents.length,
    bytesRead,
    failures,
    observedHosts: [...observedHosts].sort(),
    registryExhaustive: false,
  });
  return { documents, receipt };
}
