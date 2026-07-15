import type { InvestigationDocumentAcquisitionCapability } from "./investigation-document-acquisition";

export const INVESTIGATION_AUTHORITY_DISCOVERY_VERSION = 1 as const;

export type AuthorityDiscoveryExecutorKind =
  | "node_development"
  | "browser_extension"
  | "native_companion";

export interface AuthorityDiscoveryBudget {
  maxDepth: number;
  maxPages: number;
  maxDocuments: number;
  maxBytes: number;
  maxDurationMs: number;
}

export interface AuthorityDiscoveryRequest {
  version: typeof INVESTIGATION_AUTHORITY_DISCOVERY_VERSION;
  discoveryId: string;
  catalogEntryIds: string[];
  seedUrls: string[];
  allowedHosts: string[];
  allowedCapabilities: InvestigationDocumentAcquisitionCapability[];
  budget: AuthorityDiscoveryBudget;
  executor: {
    kind: AuthorityDiscoveryExecutorKind;
    durability: "ephemeral" | "resumable";
    retention: "none" | "local_workspace";
  };
  queryUsed: false;
  privateDerivedQuerySentExternally: false;
}

export type AuthorityDiscoveryLinkKind =
  | "attachment"
  | "dataset"
  | "detail"
  | "list"
  | "page";

export interface AuthorityDiscoveryLinkInput {
  url: string;
  label?: string;
  parentUrl: string;
  depth: number;
}

export interface RankedAuthorityDiscoveryLink extends AuthorityDiscoveryLinkInput {
  kind: AuthorityDiscoveryLinkKind;
}

export type AuthorityDiscoveryStopReason =
  | "frontier_exhausted"
  | "page_budget"
  | "document_budget"
  | "byte_budget"
  | "time_budget"
  | "capability_unavailable"
  | "access_denied"
  | "acquisition_failure";

export interface AuthorityDiscoveryRunObservation {
  startedAt: string;
  completedAt: string;
  stopReason: AuthorityDiscoveryStopReason;
  pagesVisited: number;
  documentsCaptured: number;
  bytesRead: number;
  failures: number;
  observedHosts: string[];
  /** Reserved for a future reviewed registry adapter; generic crawling cannot assert it. */
  registryExhaustive: false;
}

export interface AuthorityDiscoveryReceipt extends AuthorityDiscoveryRunObservation {
  version: typeof INVESTIGATION_AUTHORITY_DISCOVERY_VERSION;
  discoveryId: string;
  coverage: "bounded_complete" | "bounded_partial";
  absenceInferenceAllowed: false;
  queryUsed: false;
  privateDerivedQuerySentExternally: false;
}

const ID_RE = /^[a-z0-9][a-z0-9._:-]{0,127}$/iu;
const HOST_RE = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/iu;
const DISCOVERY_CAPABILITIES = new Set<InvestigationDocumentAcquisitionCapability>([
  "direct_html", "direct_text", "direct_pdf", "rendered_browser", "native_app",
]);
const STATIC_ASSET_RE = /\.(?:avif|bmp|css|eot|gif|ico|jpe?g|js|map|mjs|mp[34]|ogg|png|svg|tiff?|ttf|wav|webm|webp|woff2?)(?:$|[?#])/iu;
const ATTACHMENT_RE = /\.pdf(?:$|[?#])/iu;
const DATASET_RE = /\.(?:csv|json|ods|tsv|xlsx?|xml)(?:$|[?#])/iu;
const DETAIL_HINT_RE = /(?:content|detail|article|press[-_]?release|news[-_]?(?:content|detail)|[?&](?:dataserno|dtable|mcustomize)=|\b\d{4}[-/]\d{1,2}[-/]\d{1,2}\b|內容|全文|詳情)/iu;
const LIST_HINT_RE = /(?:news|notice|announcement|press|bulletin|latest|list|search|公告|新聞|最新消息|裁罰|統計|資料集)/iu;

function uniqueStrings(values: unknown, minimum: number, maximum: number, validator: (value: string) => boolean): values is string[] {
  return Array.isArray(values) && values.length >= minimum && values.length <= maximum &&
    values.every((value) => typeof value === "string" && validator(value)) &&
    new Set(values.map((value) => value.toLocaleLowerCase())).size === values.length;
}

function safePublicSeed(value: string, allowedHosts: Set<string>): boolean {
  try {
    const url = new URL(value);
    return (url.protocol === "https:" || url.protocol === "http:") &&
      allowedHosts.has(url.hostname.toLocaleLowerCase()) && HOST_RE.test(url.hostname);
  } catch {
    return false;
  }
}

/** Transport-neutral boundary. It authorizes no host and performs no crawl. */
export function validateAuthorityDiscoveryRequest(value: unknown): value is AuthorityDiscoveryRequest {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const request = value as Record<string, any>;
  if (request.version !== INVESTIGATION_AUTHORITY_DISCOVERY_VERSION ||
    typeof request.discoveryId !== "string" || !ID_RE.test(request.discoveryId) ||
    request.queryUsed !== false || request.privateDerivedQuerySentExternally !== false ||
    !uniqueStrings(request.catalogEntryIds, 1, 16, (item) => ID_RE.test(item)) ||
    !uniqueStrings(request.allowedHosts, 1, 16, (item) => HOST_RE.test(item)) ||
    !uniqueStrings(request.seedUrls, 1, 32, (item) => item.length <= 2_048) ||
    !Array.isArray(request.allowedCapabilities) || request.allowedCapabilities.length < 1 ||
    new Set(request.allowedCapabilities).size !== request.allowedCapabilities.length ||
    request.allowedCapabilities.some((item: InvestigationDocumentAcquisitionCapability) => !DISCOVERY_CAPABILITIES.has(item))) {
    return false;
  }
  const allowedHosts = new Set(request.allowedHosts.map((host: string) => host.toLocaleLowerCase()));
  if (request.seedUrls.some((url: string) => !safePublicSeed(url, allowedHosts))) return false;
  const budget = request.budget as Record<string, unknown> | undefined;
  if (!budget || !Number.isInteger(budget.maxDepth) || Number(budget.maxDepth) < 0 || Number(budget.maxDepth) > 3 ||
    !Number.isInteger(budget.maxPages) || Number(budget.maxPages) < 1 || Number(budget.maxPages) > 500 ||
    !Number.isInteger(budget.maxDocuments) || Number(budget.maxDocuments) < 1 || Number(budget.maxDocuments) > 1_000 ||
    !Number.isInteger(budget.maxBytes) || Number(budget.maxBytes) < 100_000 || Number(budget.maxBytes) > 200_000_000 ||
    !Number.isInteger(budget.maxDurationMs) || Number(budget.maxDurationMs) < 1_000 || Number(budget.maxDurationMs) > 900_000) {
    return false;
  }
  const executor = request.executor as Record<string, unknown> | undefined;
  if (!executor || typeof executor.kind !== "string" || typeof executor.durability !== "string" ||
    typeof executor.retention !== "string" ||
    !new Set<string>(["node_development", "browser_extension", "native_companion"]).has(executor.kind) ||
    !new Set<string>(["ephemeral", "resumable"]).has(executor.durability) ||
    !new Set<string>(["none", "local_workspace"]).has(executor.retention)) return false;
  if (executor.kind === "browser_extension" &&
    (executor.durability !== "ephemeral" || executor.retention !== "none" || Number(budget.maxDurationMs) > 60_000)) return false;
  if (executor.kind === "node_development" && (executor.durability !== "ephemeral" || executor.retention !== "none")) return false;
  if (executor.kind === "native_companion" && executor.durability === "resumable" && executor.retention !== "local_workspace") return false;
  return true;
}

function classifyDiscoveryLink(url: URL, label: string): AuthorityDiscoveryLinkKind {
  const candidate = `${url.pathname}${url.search} ${label}`;
  if (ATTACHMENT_RE.test(url.pathname)) return "attachment";
  if (DATASET_RE.test(url.pathname)) return "dataset";
  if (DETAIL_HINT_RE.test(candidate)) return "detail";
  if (LIST_HINT_RE.test(candidate)) return "list";
  return "page";
}

export function authorityDiscoveryLinkPriority(kind: AuthorityDiscoveryLinkKind): number {
  return ({ attachment: 50, dataset: 45, detail: 40, list: 30, page: 10 })[kind];
}

/**
 * Orders a pre-fetched page's links without accepting a claim, search query, or
 * unreviewed host. The executor remains responsible for network I/O and budget
 * enforcement; this function only normalizes, filters, classifies, and ranks.
 */
export function rankAuthorityDiscoveryLinks(
  request: AuthorityDiscoveryRequest,
  inputs: AuthorityDiscoveryLinkInput[],
  maximum: number,
): RankedAuthorityDiscoveryLink[] {
  if (!validateAuthorityDiscoveryRequest(request) || !Number.isInteger(maximum) || maximum < 1 || maximum > 500) return [];
  const allowedHosts = new Set(request.allowedHosts.map((host) => host.toLocaleLowerCase()));
  const seen = new Set<string>();
  return inputs.flatMap((input, index) => {
    if (!Number.isInteger(input.depth) || input.depth < 0 || input.depth > request.budget.maxDepth) return [];
    try {
      const url = new URL(input.url, input.parentUrl);
      if ((url.protocol !== "https:" && url.protocol !== "http:") ||
        !allowedHosts.has(url.hostname.toLocaleLowerCase()) || STATIC_ASSET_RE.test(url.pathname)) return [];
      url.hash = "";
      const normalized = url.toString();
      if (seen.has(normalized)) return [];
      seen.add(normalized);
      const label = typeof input.label === "string" ? input.label.trim().slice(0, 500) : "";
      const kind = classifyDiscoveryLink(url, label);
      return [{ url: normalized, label, parentUrl: input.parentUrl, depth: input.depth, kind, index }];
    } catch {
      return [];
    }
  }).sort((left, right) => authorityDiscoveryLinkPriority(right.kind) - authorityDiscoveryLinkPriority(left.kind) || left.index - right.index)
    .slice(0, maximum)
    .map(({ index: _index, ...link }) => link);
}

function isIsoTimestamp(value: string): boolean {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === value;
}

/**
 * Produces an audit receipt, never an evidence verdict. Even an exhausted
 * generic frontier is only complete relative to its reviewed seeds and budget;
 * it cannot prove that an authority has never published a record.
 */
export function buildAuthorityDiscoveryReceipt(
  request: AuthorityDiscoveryRequest,
  observation: AuthorityDiscoveryRunObservation,
): AuthorityDiscoveryReceipt {
  if (!validateAuthorityDiscoveryRequest(request) ||
    !isIsoTimestamp(observation.startedAt) || !isIsoTimestamp(observation.completedAt) ||
    Date.parse(observation.completedAt) < Date.parse(observation.startedAt) ||
    !new Set<AuthorityDiscoveryStopReason>([
      "frontier_exhausted", "page_budget", "document_budget", "byte_budget",
      "time_budget", "capability_unavailable", "access_denied", "acquisition_failure",
    ]).has(observation.stopReason) ||
    !Number.isInteger(observation.pagesVisited) || observation.pagesVisited < 0 || observation.pagesVisited > request.budget.maxPages ||
    !Number.isInteger(observation.documentsCaptured) || observation.documentsCaptured < 0 || observation.documentsCaptured > request.budget.maxDocuments ||
    !Number.isInteger(observation.bytesRead) || observation.bytesRead < 0 || observation.bytesRead > request.budget.maxBytes ||
    !Number.isInteger(observation.failures) || observation.failures < 0 ||
    observation.registryExhaustive !== false ||
    !uniqueStrings(observation.observedHosts, 0, request.allowedHosts.length, (host) => HOST_RE.test(host)) ||
    observation.observedHosts.some((host) => !request.allowedHosts.map((item) => item.toLocaleLowerCase()).includes(host.toLocaleLowerCase()))) {
    throw new TypeError("Invalid authority discovery observation");
  }

  return {
    ...observation,
    version: INVESTIGATION_AUTHORITY_DISCOVERY_VERSION,
    discoveryId: request.discoveryId,
    coverage: observation.stopReason === "frontier_exhausted" ? "bounded_complete" : "bounded_partial",
    absenceInferenceAllowed: false,
    queryUsed: false,
    privateDerivedQuerySentExternally: false,
  };
}
