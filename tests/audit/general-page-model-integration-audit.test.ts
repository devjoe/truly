import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { afterEach, describe, expect, it } from "vitest";

import type { GeneralPageModelContext } from "@src/lib/general-page-model-context";
import { callTierBGeneralPageBrief } from "@src/lib/tier-b-client";

interface CapturedRequest {
  url: string | undefined;
  body: Record<string, unknown>;
}

const servers: Array<{ close(): Promise<void> }> = [];

afterEach(async () => {
  const pending = servers.splice(0, servers.length);
  await Promise.all(pending.map((server) => server.close()));
});

describe("General Page model integration audit", () => {
  it("sends only the effective selected-text context to the mock OpenAI-compatible endpoint", async () => {
    const selectedText = "Selected synthetic paragraph that the user explicitly asked Truly to analyze.";
    const forbiddenWholePageText = "DO NOT SEND WHOLE PAGE BODY";
    const captured: CapturedRequest[] = [];
    const endpoint = await startMockEndpoint(captured, {
      schemaVersion: 1,
      summary: "Selection-only synthetic summary.",
      bg: [{ t: "Scope", why: "Only the selected paragraph was supplied." }],
      claims: [{ c: "Selected claim", why: "It appears in the selected text.", need: "Check source." }],
      qs: [{ q: "What source supports the selected claim?", kind: "source" }],
    });

    const result = await callTierBGeneralPageBrief({
      endpoint,
      model: "audit-brief-model",
      context: modelContext({
        targetKind: "selection",
        mainText: selectedText,
        selectedText,
        surroundingText: "Synthetic surrounding context for disambiguation.",
      }),
      allowedUse: "article_or_selection_analysis",
      outputLang: "en",
      timeoutMs: 5_000,
    });

    expect(result.ok).toBe(true);
    expect(captured).toHaveLength(1);
    const userContent = messageContent(captured[0].body, "user");
    expect(userContent).toContain(selectedText);
    expect(userContent).toContain("Synthetic surrounding context");
    expect(userContent).not.toContain(forbiddenWholePageText);
  });

  it("keeps page overview deterministic by removing claims from model output", async () => {
    const captured: CapturedRequest[] = [];
    const endpoint = await startMockEndpoint(captured, {
      schemaVersion: 1,
      summary: "Overview-only synthetic summary.",
      claims: [{ c: "Model should not return overview claims.", why: "Injected by mock.", need: "Guard removes it." }],
      qs: [{ q: "Which section should the reader open next?", kind: "understand" }],
    });

    const result = await callTierBGeneralPageBrief({
      endpoint,
      model: "audit-brief-model",
      context: modelContext({
        targetKind: "page",
        mainText: "Synthetic index page with many cards and navigation links.",
      }),
      allowedUse: "page_overview_only",
      outputLang: "en",
      timeoutMs: 5_000,
    });

    expect(result.ok).toBe(true);
    expect(result.brief?.claims).toBeUndefined();
    expect(result.brief?.outputReview?.findings.some((finding) => finding.ruleId === "general-page-overview-no-claims")).toBe(true);
    expect(messageContent(captured[0].body, "system")).toContain("page overview only");
  });
});

function modelContext(overrides: Partial<GeneralPageModelContext>): GeneralPageModelContext {
  return {
    surfaceKind: "web-page",
    surfaceSource: "general",
    targetKind: "page",
    title: "Synthetic Audit Fixture",
    url: "https://example.test/audit",
    canonicalUrl: "https://example.test/audit",
    domain: "example.test",
    sourceName: "Synthetic Source",
    authorName: "Synthetic Author",
    publishedAt: "2026-01-01",
    mainText: [
      "Synthetic page body for General Page model integration audit.",
      "DO NOT SEND WHOLE PAGE BODY",
    ].join(" "),
    links: [{ href: "https://example.test/source", text: "Synthetic source" }],
    imageAltText: ["Synthetic image alt"],
    extractionWarnings: [],
    modelEligible: true,
    modelReadiness: "ready",
    qualityIssues: [],
    ...overrides,
  };
}

async function startMockEndpoint(
  captured: CapturedRequest[],
  responseContent: Record<string, unknown>,
): Promise<string> {
  const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    const rawBody = Buffer.concat(chunks).toString("utf8");
    captured.push({
      url: req.url,
      body: JSON.parse(rawBody) as Record<string, unknown>,
    });
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({
      choices: [{
        message: {
          content: JSON.stringify(responseContent),
        },
      }],
    }));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  servers.push({
    close: () => new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())),
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("mock_endpoint_bind_failed");
  return `http://127.0.0.1:${address.port}/v1`;
}

function messageContent(body: Record<string, unknown>, role: "system" | "user"): string {
  const messages = body.messages;
  if (!Array.isArray(messages)) return "";
  const message = messages.find((item) => {
    const record = item as { role?: unknown };
    return record.role === role;
  }) as { content?: unknown } | undefined;
  return typeof message?.content === "string" ? message.content : "";
}
