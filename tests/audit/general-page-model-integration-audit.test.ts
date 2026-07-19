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
  it("sends standard page briefs as effective text context without raw DOM or screenshots", async () => {
    const effectivePageText = "Effective synthetic article text that should be sent to the model as the readable page context.";
    const forbiddenRawDom = "<html><body><script>DO_NOT_SEND_RAW_DOM</script><article>Hidden raw document</article></body></html>";
    const forbiddenJsonLd = "{\"@context\":\"https://schema.org\",\"@type\":\"NewsArticle\",\"headline\":\"DO_NOT_SEND_JSON_LD\"}";
    const forbiddenScreenshot = "data:image/png;base64,DO_NOT_SEND_SCREENSHOT";
    const captured: CapturedRequest[] = [];
    const endpoint = await startMockEndpoint(captured, {
      schemaVersion: 1,
      summary: "Compact synthetic page summary.",
      bg: [{ t: "Context", why: "The effective page text was supplied." }],
      claims: [{ c: "Compact claim", why: "It appears in the effective text.", need: "Primary evidence.", q: "What primary evidence supports the compact claim?" }],
      qs: [{ q: "What background helps explain the article?", kind: "context" }],
    });

    const result = await callTierBGeneralPageBrief({
      endpoint,
      model: "audit-brief-model",
      context: modelContext({
        targetKind: "page",
        mainText: effectivePageText,
        links: [{ href: "https://example.test/source", text: "Effective source" }],
        imageAltText: ["Effective image alt text"],
      }),
      allowedUse: "article_or_selection_analysis",
      outputLang: "en",
      structuredOutputMode: "json_object",
      timeoutMs: 5_000,
    });

    expect(result.ok).toBe(true);
    expect(captured).toHaveLength(1);
    const rawBody = JSON.stringify(captured[0].body);
    const userContent = messageContent(captured[0].body, "user");
    expect(captured[0].body.max_tokens).toBe(1_100);
    expect(userContent).toContain(effectivePageText);
    expect(userContent).toContain("Effective source");
    expect(userContent).toContain("Effective image alt text");
    expect(userContent).not.toContain(forbiddenRawDom);
    expect(userContent).not.toContain(forbiddenJsonLd);
    expect(rawBody).not.toContain(forbiddenScreenshot);
    expect(rawBody).not.toContain("image_url");
  });

  it("sends only the effective selected-text context to the mock OpenAI-compatible endpoint", async () => {
    const selectedText = "Selected synthetic paragraph that the user explicitly asked Truly to analyze.";
    const forbiddenWholePageText = "DO NOT SEND WHOLE PAGE BODY";
    const captured: CapturedRequest[] = [];
    const endpoint = await startMockEndpoint(captured, {
      schemaVersion: 1,
      summary: "Selection-only synthetic summary.",
      bg: [{ t: "Scope", why: "Only the selected paragraph was supplied." }],
      claims: [{ c: "Selected claim", why: "It appears in the selected text.", need: "Check source." }],
      qs: [{ q: "What background helps explain the selected claim?", kind: "context" }],
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
      structuredOutputMode: "json_object",
      timeoutMs: 5_000,
    });

    expect(result.ok).toBe(true);
    expect(captured).toHaveLength(1);
    const rawBody = JSON.stringify(captured[0].body);
    const userContent = messageContent(captured[0].body, "user");
    expect(userContent).toContain(selectedText);
    expect(userContent).toContain("Synthetic surrounding context");
    expect(userContent).not.toContain(forbiddenWholePageText);
    expect(rawBody).not.toContain("image_url");
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
      structuredOutputMode: "json_object",
      timeoutMs: 5_000,
    });

    expect(result.ok).toBe(true);
    expect(result.brief?.claims).toBeUndefined();
    expect(result.brief?.outputReview?.findings.some((finding) => finding.ruleId === "general-page-overview-no-claims")).toBe(true);
    expect(messageContent(captured[0].body, "system")).toContain("page overview only");
  });

  it("retries one invalid contract with a compact repair prompt", async () => {
    const captured: CapturedRequest[] = [];
    const endpoint = await startMockEndpoint(captured, [
      { title: "Wrong model-owned schema", summary: "Usable prose in the wrong contract." },
      {
        schemaVersion: 1,
        summary: "Recovered compact summary.",
        bg: [],
        claims: [],
        qs: [],
      },
    ]);

    const result = await callTierBGeneralPageBrief({
      endpoint,
      model: "audit-brief-model",
      context: modelContext({}),
      allowedUse: "article_or_selection_analysis",
      outputLang: "en",
      contract: "investigation_v3",
      structuredOutputMode: "json_object",
      enableFormatRepair: true,
      timeoutMs: 5_000,
    });

    expect(result).toMatchObject({
      ok: true,
      attempts: 2,
      formatRecovered: true,
      brief: { summary: "Recovered compact summary." },
    });
    expect(captured).toHaveLength(2);
    expect(messageContent(captured[1].body, "system")).toContain("repairing a General Page reading response");
    expect(messageContent(captured[1].body, "system")).toContain("summary <=32 words");
    expect(captured[1].body.max_tokens).toBe(800);
  });

  it("does not repair an invalid standard runtime response", async () => {
    const captured: CapturedRequest[] = [];
    const endpoint = await startMockEndpoint(captured, [
      { title: "Wrong model-owned schema", summary: "Usable prose in the wrong contract." },
      { schemaVersion: 1, summary: "This response must not be requested." },
    ]);

    const result = await callTierBGeneralPageBrief({
      endpoint,
      model: "audit-brief-model",
      context: modelContext({}),
      allowedUse: "article_or_selection_analysis",
      outputLang: "en",
      structuredOutputMode: "json_object",
      timeoutMs: 5_000,
    });

    expect(result).toMatchObject({
      ok: false,
      attempts: 1,
      error: "general_page_brief_format_error",
    });
    expect(captured).toHaveLength(1);
  });

  it("reports provider truncation and normalized token telemetry without attempting JSON repair", async () => {
    const captured: CapturedRequest[] = [];
    const endpoint = await startMockEndpoint(captured, {
      schemaVersion: 1,
      summary: "Incomplete response",
    }, {
      finishReason: "length",
      usage: { prompt_tokens: 321, completion_tokens: 1_100, total_tokens: 1_421 },
    });

    const result = await callTierBGeneralPageBrief({
      endpoint,
      model: "audit-brief-model",
      context: modelContext({}),
      allowedUse: "article_or_selection_analysis",
      outputLang: "en",
      structuredOutputMode: "json_schema",
      timeoutMs: 5_000,
    });

    expect(result).toMatchObject({
      ok: false,
      attempts: 1,
      error: "general_page_brief_truncated",
      finishReason: "length",
      usage: { promptTokens: 321, completionTokens: 1_100, totalTokens: 1_421 },
    });
    expect(captured).toHaveLength(1);
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
  responseContent: Record<string, unknown> | Record<string, unknown>[],
  metadata: {
    finishReason?: string;
    usage?: Record<string, number>;
  } = {},
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
    const responseIndex = captured.length - 1;
    const selectedContent = Array.isArray(responseContent)
      ? responseContent[Math.min(responseIndex, responseContent.length - 1)]
      : responseContent;
    res.end(JSON.stringify({
      choices: [{
        finish_reason: metadata.finishReason ?? "stop",
        message: {
          content: JSON.stringify(selectedContent),
        },
      }],
      usage: metadata.usage,
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
