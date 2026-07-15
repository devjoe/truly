import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import {
  INVESTIGATION_AUTHORITY_DISCOVERY_VERSION,
  validateAuthorityDiscoveryRequest,
  type AuthorityDiscoveryBudget,
  type AuthorityDiscoveryRequest,
} from "../src/lib/investigation-authority-discovery";
import { executeAuthorityDocumentDiscovery } from "../src/lib/investigation-authority-discovery-executor";
import { createAuthorityDiscoveryNodeAdapter } from "./lib/investigation-authority-node-adapter";
import { createAuthorityDiscoveryCdpAdapter } from "./lib/investigation-authority-cdp-adapter";

interface CatalogLocator { kind: "domain_index" | "direct_url"; domain?: string; url?: string }
interface CatalogEntry {
  id: string;
  status: string;
  sourceFamily: string;
  sourceRef: string;
  locators: CatalogLocator[];
}
interface Catalog { version: number; entries: CatalogEntry[] }
interface DiscoveryProfile {
  version: 1;
  groups: Array<{
    id: string;
    catalogEntryIds: string[];
    seedUrls?: string[];
    adapter?: "direct_node" | "rendered_cdp";
    budget?: Partial<AuthorityDiscoveryBudget>;
  }>;
}

function option(name: string): string | undefined { const index = process.argv.indexOf(name); return index >= 0 ? process.argv[index + 1] : undefined; }
function required(name: string): string { const value = option(name); if (!value) throw new Error(`Missing ${name}`); return value; }
function privatePath(value: string, mustExist: boolean): string {
  const resolved = path.resolve(value);
  if (!resolved.includes(`${path.sep}private-data${path.sep}`)) throw new Error("all snapshot paths must stay under private-data");
  if (mustExist && !fs.existsSync(resolved)) throw new Error(`missing ${resolved}`);
  return resolved;
}
function sha256(value: string | Buffer): string { return crypto.createHash("sha256").update(value).digest("hex"); }
function host(value: string): string | undefined { try { return new URL(value).hostname.toLocaleLowerCase(); } catch { return undefined; } }
function locatorHost(locator: CatalogLocator): string | undefined {
  if (locator.kind === "domain_index" && locator.domain) return locator.domain.toLocaleLowerCase();
  return locator.kind === "direct_url" && locator.url ? host(locator.url) : undefined;
}
function hostVariants(value: string): string[] {
  const normalized = value.toLocaleLowerCase();
  return normalized.startsWith("www.") ? [normalized, normalized.slice(4)] : [normalized, `www.${normalized}`];
}

const catalogPath = privatePath(required("--catalog"), true);
const profilePath = privatePath(required("--profile"), true);
const outputPath = privatePath(required("--output"), false);
const metaPath = privatePath(required("--meta-output"), false);
const cdpEndpoint = option("--cdp-endpoint") ?? "http://127.0.0.1:9222";
const catalog = JSON.parse(fs.readFileSync(catalogPath, "utf8")) as Catalog;
const profile = JSON.parse(fs.readFileSync(profilePath, "utf8")) as DiscoveryProfile;
if (catalog.version !== 1 || profile.version !== 1 || !Array.isArray(profile.groups) || profile.groups.length < 1) {
  throw new Error("invalid catalog or profile");
}

const defaults: AuthorityDiscoveryBudget = {
  maxDepth: 2,
  maxPages: 80,
  maxDocuments: 200,
  maxBytes: 40_000_000,
  maxDurationMs: 180_000,
};
const allDocuments: Array<Record<string, unknown>> = [];
const receipts: Array<Record<string, unknown>> = [];
const seenFingerprints = new Set<string>();

for (const group of profile.groups) {
  const selected = group.catalogEntryIds.map((id) => catalog.entries.find((entry) => entry.id === id && entry.status === "active"));
  if (selected.some((entry) => !entry)) throw new Error(`${group.id}: unknown or inactive catalog entry`);
  const entries = selected as CatalogEntry[];
  const seedUrls = [...new Set([...entries.flatMap((entry) => [
    entry.sourceRef,
    ...entry.locators.flatMap((locator) => locator.kind === "domain_index" && locator.domain ? [`https://${locator.domain}/`] : locator.url ? [locator.url] : []),
  ]), ...(group.seedUrls ?? [])])];
  const allowedHosts = [...new Set(entries.flatMap((entry) => [
    host(entry.sourceRef),
    ...entry.locators.map(locatorHost),
  ].filter((value): value is string => Boolean(value)).flatMap(hostVariants)))].sort();
  const request: AuthorityDiscoveryRequest = {
    version: INVESTIGATION_AUTHORITY_DISCOVERY_VERSION,
    discoveryId: `authority-discovery:${group.id}`,
    catalogEntryIds: group.catalogEntryIds,
    seedUrls,
    allowedHosts,
    allowedCapabilities: group.adapter === "rendered_cdp" ? ["rendered_browser"] : ["direct_html", "direct_text", "direct_pdf"],
    budget: { ...defaults, ...group.budget },
    executor: { kind: "node_development", durability: "ephemeral", retention: "none" },
    queryUsed: false,
    privateDerivedQuerySentExternally: false,
  };
  if (!validateAuthorityDiscoveryRequest(request)) throw new Error(`${group.id}: invalid discovery request`);
  const adapter = group.adapter === "rendered_cdp"
    ? createAuthorityDiscoveryCdpAdapter(request, {
      endpoint: cdpEndpoint,
      timeoutMs: 15_000,
      maxLinksPerPage: 500,
      maxDocumentCharacters: 160_000,
    })
    : createAuthorityDiscoveryNodeAdapter(request, {
      timeoutMs: 15_000,
      maxBytesPerDocument: Math.min(4_000_000, request.budget.maxBytes),
      maxLinksPerPage: 500,
      maxPdfPages: 80,
      maxDocumentCharacters: 160_000,
    });
  const result = await executeAuthorityDocumentDiscovery(request, adapter);
  receipts.push(result.receipt as unknown as Record<string, unknown>);
  for (const document of result.documents) {
    if (seenFingerprints.has(document.fingerprint)) continue;
    seenFingerprints.add(document.fingerprint);
    const documentHost = host(document.url) ?? "";
    const locatorMatches = entries.filter((entry) => entry.locators.some((locator) => locatorHost(locator) === documentHost));
    const matchedEntries = locatorMatches.length > 0 ? locatorMatches : entries.filter((entry) => host(entry.sourceRef) === documentHost);
    const catalogEntries = matchedEntries.length > 0 ? matchedEntries : entries;
    allDocuments.push({
      schemaVersion: 1,
      snapshotId: `document:${sha256(`${document.url}\0${document.fingerprint}`).slice(0, 24)}`,
      url: document.url,
      domain: documentHost.replace(/^www\./u, ""),
      title: document.title ?? "",
      text: document.text,
      contentSha256: document.fingerprint,
      bytes: document.bytes,
      contentType: document.contentType,
      catalogEntryIds: catalogEntries.map((entry) => entry.id),
      sourceFamilies: [...new Set(catalogEntries.map((entry) => entry.sourceFamily))],
      capturedAt: result.receipt.completedAt,
      acquisition: "authority_local_document_discovery_v1",
      depth: document.depth,
      queryUsed: false,
    });
  }
}

fs.mkdirSync(path.dirname(outputPath), { recursive: true, mode: 0o700 });
fs.writeFileSync(outputPath, `${allDocuments.map((document) => JSON.stringify(document)).join("\n")}\n`, { mode: 0o600 });
const meta = {
  schemaVersion: 1,
  task: "authority_local_document_snapshot_v1",
  catalogSha256: sha256(fs.readFileSync(catalogPath)),
  profileSha256: sha256(fs.readFileSync(profilePath)),
  groups: profile.groups.length,
  documents: allDocuments.length,
  domains: new Set(allDocuments.map((document) => document.domain)).size,
  receipts,
  queryUsed: false,
  privateDerivedQuerySentExternally: false,
  evidenceProduced: false,
  verdictProduced: false,
  completedAt: new Date().toISOString(),
};
fs.writeFileSync(metaPath, `${JSON.stringify(meta, null, 2)}\n`, { mode: 0o600 });
console.log(JSON.stringify({ result: allDocuments.length > 0 ? "pass" : "fail", ...meta, output: "private-data/<private>" }, null, 2));
if (allDocuments.length === 0) process.exitCode = 1;
