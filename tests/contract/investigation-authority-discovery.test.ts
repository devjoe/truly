import { describe, expect, it } from "vitest";

import {
  buildAuthorityDiscoveryReceipt,
  INVESTIGATION_AUTHORITY_DISCOVERY_VERSION,
  rankAuthorityDiscoveryLinks,
  validateAuthorityDiscoveryRequest,
} from "@src/lib/investigation-authority-discovery";
import { executeAuthorityDocumentDiscovery } from "@src/lib/investigation-authority-discovery-executor";

describe("authority-local document discovery", () => {
  const request = {
    version: INVESTIGATION_AUTHORITY_DISCOVERY_VERSION,
    discoveryId: "authority-discovery:tfda-v1",
    catalogEntryIds: ["authority:tfda:first-party", "authority:tfda:record"],
    seedUrls: ["https://www.fda.gov.tw/TC/news.aspx"],
    allowedHosts: ["fda.gov.tw", "www.fda.gov.tw"],
    allowedCapabilities: ["direct_html", "direct_pdf"] as const,
    budget: {
      maxDepth: 2,
      maxPages: 80,
      maxDocuments: 200,
      maxBytes: 40_000_000,
      maxDurationMs: 180_000,
    },
    executor: {
      kind: "node_development" as const,
      durability: "ephemeral" as const,
      retention: "none" as const,
    },
    queryUsed: false as const,
    privateDerivedQuerySentExternally: false as const,
  };

  it("accepts a bounded query-free crawl over reviewed authority hosts", () => {
    expect(validateAuthorityDiscoveryRequest(request)).toBe(true);
  });

  it("rejects query leakage, unreviewed hosts, and durable Extension retention", () => {
    expect(validateAuthorityDiscoveryRequest({ ...request, queryUsed: true })).toBe(false);
    expect(validateAuthorityDiscoveryRequest({
      ...request,
      seedUrls: ["https://unreviewed.example.test/news"],
    })).toBe(false);
    expect(validateAuthorityDiscoveryRequest({
      ...request,
      executor: { kind: "browser_extension", durability: "resumable", retention: "local_workspace" },
    })).toBe(false);
  });

  it("ranks same-host lists, details, datasets, and attachments without using a claim query", () => {
    const links = rankAuthorityDiscoveryLinks(request, [
      { url: "https://www.fda.gov.tw/TC/news.aspx", label: "最新消息", parentUrl: request.seedUrls[0], depth: 1 },
      { url: "https://www.fda.gov.tw/TC/newsContent.aspx?id=123", label: "食藥署公布檢驗結果", parentUrl: request.seedUrls[0], depth: 1 },
      { url: "https://www.fda.gov.tw/files/result.pdf#page=1", label: "檢驗結果附件", parentUrl: request.seedUrls[0], depth: 1 },
      { url: "https://www.fda.gov.tw/files/result.pdf", label: "duplicate", parentUrl: request.seedUrls[0], depth: 1 },
      { url: "https://other.example.test/news", label: "external", parentUrl: request.seedUrls[0], depth: 1 },
      { url: "https://www.fda.gov.tw/images/logo.png", label: "logo", parentUrl: request.seedUrls[0], depth: 1 },
    ], 4);

    expect(links.map((link) => [link.kind, link.url])).toEqual([
      ["attachment", "https://www.fda.gov.tw/files/result.pdf"],
      ["detail", "https://www.fda.gov.tw/TC/newsContent.aspx?id=123"],
      ["list", "https://www.fda.gov.tw/TC/news.aspx"],
    ]);
    expect(links.every((link) => link.depth <= request.budget.maxDepth)).toBe(true);

    const fsc = rankAuthorityDiscoveryLinks({
      ...request,
      seedUrls: ["https://www.fda.gov.tw/ch/home.jsp"],
    }, [
      { url: "https://www.fda.gov.tw/ch/home.jsp?id=96&parentpath=0,2", label: "新聞稿", parentUrl: request.seedUrls[0], depth: 1 },
      { url: "https://www.fda.gov.tw/ch/home.jsp?id=96&dataserno=202607150001&dtable=News", label: "新聞內容", parentUrl: request.seedUrls[0], depth: 1 },
    ], 4);
    expect(fsc.map((link) => link.kind)).toEqual(["detail", "list"]);
  });

  it("records bounded crawl coverage without turning missing text into evidence of absence", () => {
    const partial = buildAuthorityDiscoveryReceipt(request, {
      startedAt: "2026-07-15T12:00:00.000Z",
      completedAt: "2026-07-15T12:01:00.000Z",
      stopReason: "page_budget",
      pagesVisited: 80,
      documentsCaptured: 23,
      bytesRead: 4_000_000,
      failures: 2,
      observedHosts: ["www.fda.gov.tw"],
      registryExhaustive: false,
    });

    expect(partial.coverage).toBe("bounded_partial");
    expect(partial.absenceInferenceAllowed).toBe(false);
    expect(partial.queryUsed).toBe(false);
    expect(partial.privateDerivedQuerySentExternally).toBe(false);

    const exhausted = buildAuthorityDiscoveryReceipt(request, {
      startedAt: "2026-07-15T12:00:00.000Z",
      completedAt: "2026-07-15T12:01:00.000Z",
      stopReason: "frontier_exhausted",
      pagesVisited: 8,
      documentsCaptured: 5,
      bytesRead: 500_000,
      failures: 0,
      observedHosts: ["www.fda.gov.tw"],
      registryExhaustive: false,
    });

    expect(exhausted.coverage).toBe("bounded_complete");
    expect(exhausted.absenceInferenceAllowed).toBe(false);
  });

  it("executes a query-free breadth-first crawl through an injected capability adapter", async () => {
    const pages = new Map([
      [request.seedUrls[0], {
        finalUrl: request.seedUrls[0], contentType: "text/html", bytes: 1_000,
        title: "食藥署最新消息", text: "最新消息".repeat(80), fingerprint: "seed",
        links: [
          { url: "https://www.fda.gov.tw/TC/newsContent.aspx?id=123", label: "檢驗結果" },
          { url: "https://www.fda.gov.tw/files/result.pdf", label: "附件" },
          { url: "https://external.example.test/leak", label: "external" },
        ],
      }],
      ["https://www.fda.gov.tw/files/result.pdf", {
        finalUrl: "https://www.fda.gov.tw/files/result.pdf", contentType: "application/pdf", bytes: 2_000,
        title: "附件", text: "檢驗結果".repeat(80), fingerprint: "pdf", links: [],
      }],
      ["https://www.fda.gov.tw/TC/newsContent.aspx?id=123", {
        finalUrl: "https://www.fda.gov.tw/TC/newsContent.aspx?id=123", contentType: "text/html", bytes: 1_500,
        title: "檢驗結果", text: "食藥署公布檢驗結果".repeat(50), fingerprint: "detail", links: [],
      }],
    ]);
    const requested: string[] = [];
    const result = await executeAuthorityDocumentDiscovery(request, {
      async acquire(url) {
        requested.push(url);
        const page = pages.get(url);
        return page ? { ok: true as const, ...page } : { ok: false as const, reason: "network_error" as const };
      },
    }, { now: (() => {
      let value = Date.parse("2026-07-15T12:00:00.000Z");
      return () => new Date(value += 1_000);
    })() });

    expect(requested).toEqual([
      request.seedUrls[0],
      "https://www.fda.gov.tw/files/result.pdf",
      "https://www.fda.gov.tw/TC/newsContent.aspx?id=123",
    ]);
    expect(result.documents).toHaveLength(3);
    expect(result.receipt.queryUsed).toBe(false);
    expect(result.receipt.privateDerivedQuerySentExternally).toBe(false);
    expect(result.receipt.absenceInferenceAllowed).toBe(false);
    expect(result.receipt.stopReason).toBe("frontier_exhausted");
  });

  it("prioritizes true details discovered by later seeds over generic navigation", async () => {
    const root = "https://www.fda.gov.tw/TC/";
    const list = "https://www.fda.gov.tw/TC/news.aspx?cid=4";
    const detail = "https://www.fda.gov.tw/TC/newsContent.aspx?cid=4&id=123";
    const constrained = {
      ...request,
      seedUrls: [root, list],
      budget: { ...request.budget, maxPages: 3 },
    };
    const requested: string[] = [];
    const result = await executeAuthorityDocumentDiscovery(constrained, {
      async acquire(url) {
        requested.push(url);
        const common = { ok: true as const, finalUrl: url, contentType: "text/html", bytes: 1_000, title: url, text: url.repeat(20), fingerprint: url };
        if (url === root) return { ...common, links: [
          { url: "https://www.fda.gov.tw/TC/site.aspx?sid=1", label: "業務專區" },
          { url: "https://www.fda.gov.tw/TC/site.aspx?sid=2", label: "網站導覽" },
        ] };
        if (url === list) return { ...common, links: [{ url: detail, label: "最新公告" }] };
        return { ...common, links: [] };
      },
    });

    expect(requested).toEqual([root, list, detail]);
    expect(result.receipt.stopReason).toBe("page_budget");
  });
});
