import fs from "node:fs";
import { describe, expect, it } from "vitest";

import { parseCompactScores } from "@src/lib/ollama-client";
import {
  buildTierBGeneralPageBriefChatBody,
  buildTierBGeneralPageParserAdvisorChatBody,
  parseTierBDeepContent,
  parseTierBReadingBriefContent,
  readingBriefSystemPrompt,
} from "@src/lib/tier-b-client";
import type { GeneralPageModelContext } from "@src/lib/general-page-model-context";
import {
  isGeneralPageParserAdvisorAdviceCompatible,
  parseGeneralPageParserAdvisorAdvice,
  type GeneralPageParserAdvisorRequest,
} from "@src/lib/general-page-parser-advisor";
import type { ReadingBrief } from "@src/lib/types";

interface TierACompactFixture {
  id: string;
  description: string;
  raw: string;
  customRules?: { id: string }[];
  expected: ReturnType<typeof parseCompactScores>;
}

interface TierBCompactFixture {
  id: string;
  description: string;
  model: string;
  raw: string;
  expected?: Record<string, unknown>;
  expectedError?: string;
}

interface ReadingBriefFixture {
  id: string;
  description: string;
  model: string;
  raw: string;
  expected?: Partial<ReadingBrief>;
  expectedError?: string;
}

const tierACompactFixtures = JSON.parse(
  fs.readFileSync("tests/fixtures/tier-a/compact-digits-contract.json", "utf8"),
) as TierACompactFixture[];

const tierBCompactFixtures = JSON.parse(
  fs.readFileSync("tests/fixtures/tier-b/compact-json-contract.json", "utf8"),
) as TierBCompactFixture[];

const readingBriefFixtures = JSON.parse(
  fs.readFileSync("tests/fixtures/tier-b/reading-brief-contract.json", "utf8"),
) as ReadingBriefFixture[];

const parserAdvisorRequest: GeneralPageParserAdvisorRequest = {
  schemaVersion: 1,
  lane: "general-page-advisor",
  providerConfigSource: "tier-b-provider",
  trigger: "user_read_action",
  url: "https://example.test/runtime-fixture",
  title: "Synthetic Runtime Fixture",
  targetKind: "page",
  extraction: {
    method: "fallback",
    status: "partial",
    warnings: ["large-navigation-noise", "no-main-content"],
  },
  modelReadiness: "caution",
  qualityIssues: ["fallback_extraction", "large_navigation_noise", "no_main_content"],
  currentTextPreview: "Synthetic navigation and card-grid text that should be downgraded to page overview.",
  currentTextLength: 280,
  candidateBlocks: [],
  escalation: {
    shouldAskModel: true,
    reasons: ["fallback_extraction", "large_navigation_noise", "index_or_feed", "no_main_content"],
    allowedDecisions: ["accept_current", "downgrade_to_index_or_feed", "mark_blocked_or_empty", "request_user_selection"],
  },
  payloadBudget: {
    fullTextMaxChars: 8000,
    maxPayloadChars: 12000,
    candidateBlockPreviewChars: 1200,
    maxCandidateBlocks: 8,
    currentTextMode: "full",
    estimatedPayloadChars: 1600,
    withinBudget: true,
  },
};

const generalPageContext: GeneralPageModelContext = {
  surfaceKind: "web-page",
  surfaceSource: "general",
  targetKind: "selection",
  title: "Synthetic Selection Page",
  url: "https://example.test/page",
  domain: "example.test",
  selectedText: "Selected passage about a fictional public notice.",
  mainText: "Selected passage about a fictional public notice.",
  surroundingText: "Surrounding page text is context only.",
  links: [{ href: "https://example.test/source", text: "Source link" }],
  imageAltText: [],
  extractionWarnings: [],
  modelEligible: true,
  modelReadiness: "ready",
  qualityIssues: [],
};

describe("Tier A compact-digits public contract", () => {
  it.each(tierACompactFixtures)("$id", (fixture) => {
    expect(parseCompactScores(fixture.raw, fixture.customRules)).toEqual(fixture.expected);
  });
});

describe("Tier B compact JSON public contract", () => {
  it.each(tierBCompactFixtures)("$id", (fixture) => {
    const parsed = parseTierBDeepContent(fixture.raw, fixture.model);
    if (fixture.expectedError) {
      expect(parsed).toMatchObject({ ok: false, error: fixture.expectedError });
      return;
    }
    expect(parsed.ok).toBe(true);
    expect(parsed.value).toEqual(expect.objectContaining(fixture.expected ?? {}));
  });
});

describe("Tier B-2 reading brief public contract", () => {
  it.each(readingBriefFixtures)("$id", (fixture) => {
    const parsed = parseTierBReadingBriefContent(fixture.raw, fixture.model);
    if (fixture.expectedError) {
      expect(parsed).toMatchObject({ ok: false, error: fixture.expectedError });
      return;
    }
    expect(parsed.ok).toBe(true);
    expect(parsed.value).toEqual(expect.objectContaining(fixture.expected ?? {}));
  });

  it("keeps verification tasks out of follow-up questions", () => {
    const parsed = parseTierBReadingBriefContent(JSON.stringify({
      bg: [],
      claims: [{
        c: "Enzo 稱梅西最後一次參加世界盃",
        why: "貼文的核心時序主張",
        need: "梅西 2026 世界盃參賽狀態",
        q: "梅西是否參加 2026 世界盃？",
      }],
      qs: [
        { q: "Lionel Messi 2026 World Cup participation", kind: "context" },
        { q: "梅西是否參加 2026 世界盃？", kind: "verify" },
        { q: "這項說法的來源在哪裡？", kind: "source" },
        { q: "Enzo Fernández 在 2016 年是否真的寫信給梅西？", kind: "context" },
        { q: "2026 世界盃四強賽的實際比分與進球者為何？", kind: "understand" },
        { q: "2026 世界盃四強賽的實際賽況為何？", kind: "context" },
        { q: "梅西是否已宣布退役或確定參加 2026 世界盃？", kind: "context" },
        { q: "Enzo 對梅西的公開信內容為何？", kind: "context" },
        { q: "Enzo 與梅西在阿根廷國家隊的合作歷程為何？", kind: "context" },
      ],
      checks: [],
    }), "brief-contract-model", "zh-TW");

    expect(parsed.ok).toBe(true);
    expect(parsed.value?.qs).toEqual([{
      q: "Enzo 與梅西在阿根廷國家隊的合作歷程為何？",
      kind: "context",
    }]);
  });

  it("defines follow-up questions as natural understanding prompts, not search tasks", () => {
    const zhPrompt = readingBriefSystemPrompt("zh-TW");
    const enPrompt = readingBriefSystemPrompt("en");

    expect(zhPrompt).toContain('"kind":"understand|context|counter|image"');
    expect(zhPrompt).toContain("不得重述 claims 或 checks");
    expect(zhPrompt).toContain("不得寫成搜尋關鍵字");
    expect(enPrompt).toContain('"kind":"understand|context|counter|image"');
    expect(enPrompt).toContain("must not duplicate claims or checks");
    expect(enPrompt).toContain("must not be a keyword list");
  });
});

describe("Tier B General Page parser advisor public contract", () => {
  it("builds a short JSON-only advisor chat body", () => {
    const body = buildTierBGeneralPageParserAdvisorChatBody({
      endpoint: "http://localhost:11434",
      model: "gemma4:e4b",
      request: parserAdvisorRequest,
    });

    expect(body.response_format).toEqual({ type: "json_object" });
    expect(body.max_tokens).toBeLessThanOrEqual(420);
    expect(body.messages[0]?.content).toContain("web-page parser recovery classifier");
    expect(body.messages[1]?.content).toContain("allowedDecisions");
    expect(body.messages[1]?.content).not.toContain("request_screenshot_region");
  });

  it("accepts valid short advisor JSON and rejects disallowed decisions", () => {
    const valid = parseGeneralPageParserAdvisorAdvice(JSON.stringify({
      schemaVersion: 1,
      pageType: "index_or_feed",
      decision: "downgrade_to_index_or_feed",
      confidence: "high",
      needsUserSelection: false,
      needsScreenshot: false,
      riskTags: ["fallback_extraction", "index_or_feed"],
      rationale: "The page is a synthetic index and should not be treated as one article.",
    }), parserAdvisorRequest);
    expect(valid).toEqual(expect.objectContaining({ ok: true }));

    const invalid = parseGeneralPageParserAdvisorAdvice(JSON.stringify({
      schemaVersion: 1,
      pageType: "unknown",
      decision: "request_screenshot_region",
      confidence: "medium",
      needsUserSelection: false,
      needsScreenshot: true,
      riskTags: ["needs_visual_grounding"],
      rationale: "Screenshot is not allowed for this request.",
    }), parserAdvisorRequest);
    expect(invalid).toEqual({ ok: false, error: "decision_not_allowed" });
  });

  it("rejects model advice that overrides deterministic index/feed risk", () => {
    const parsed = parseGeneralPageParserAdvisorAdvice(JSON.stringify({
      schemaVersion: 1,
      pageType: "article",
      decision: "accept_current",
      confidence: "high",
      needsUserSelection: false,
      needsScreenshot: false,
      riskTags: ["fallback_extraction"],
      rationale: "The model believes the current extraction is usable.",
    }), parserAdvisorRequest);

    expect(parsed.ok).toBe(true);
    expect(parsed.ok && isGeneralPageParserAdvisorAdviceCompatible(parserAdvisorRequest, parsed.value)).toBe(false);
  });
});

describe("Tier B General Page brief public contract", () => {
  it("builds a JSON-only page brief chat body for selection analysis", () => {
    const body = buildTierBGeneralPageBriefChatBody({
      endpoint: "http://localhost:11434",
      model: "gemma4:e4b",
      context: generalPageContext,
      allowedUse: "article_or_selection_analysis",
      outputLang: "en",
      structuredOutputMode: "json_object",
    });

    expect(body.response_format).toEqual({ type: "json_object" });
    expect(body.temperature).toBe(0);
    expect(body.max_tokens).toBeLessThanOrEqual(1400);
    expect(body.messages[0]?.content).toContain("General Page reading assistant");
    expect(body.messages[0]?.content).toContain("targetKind is selection");
    expect(body.messages[1]?.content).toContain("targetKind: selection");
    expect(body.messages[1]?.content).toContain("Selected passage about a fictional public notice.");
  });

  it("maps the provider-neutral schema capability to a strict OpenAI-compatible response format", () => {
    const body = buildTierBGeneralPageBriefChatBody({
      endpoint: "http://model-runtime.example/v1",
      model: "schema-capable-model",
      context: generalPageContext,
      allowedUse: "article_or_selection_analysis",
      outputLang: "en",
      structuredOutputMode: "json_schema",
    });

    expect(body.response_format).toMatchObject({
      type: "json_schema",
      json_schema: {
        name: "truly_general_page_brief_v1",
        strict: true,
        schema: {
          type: "object",
          additionalProperties: false,
          required: ["schemaVersion", "summary", "bg", "claims", "qs", "note"],
        },
      },
    });
  });

  it("uses the overview system variant for page overview only contexts", () => {
    const body = buildTierBGeneralPageBriefChatBody({
      endpoint: "http://localhost:11434",
      model: "gemma4:e4b",
      context: { ...generalPageContext, targetKind: "page" },
      allowedUse: "page_overview_only",
      outputLang: "en",
      structuredOutputMode: "json_object",
    });

    expect(body.messages[0]?.content).toContain("page overview only");
    expect(body.messages[0]?.content).toContain("Return claims as an empty array");
  });
});
