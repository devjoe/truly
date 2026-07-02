#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import ts from "typescript";
import { JSDOM } from "jsdom";
import { loadRuntimeGeneralPageExtractor } from "./lib/load-runtime-general-page-extractor.mjs";

const FIXTURE_DIR = "tests/fixtures/general-pages";
const MANIFEST_PATH = path.join(FIXTURE_DIR, "manifest.json");
const OUTPUT_DIR = "tmp/parser-advisor-spikes";
const REPORT_DATE = process.env.TRULY_PARSER_ADVISOR_SPIKE_DATE ?? new Date().toISOString().slice(0, 10);
const REPORT_PATH = path.join(OUTPUT_DIR, `general-page-parser-advisor-spike-${REPORT_DATE}.json`);
const CANDIDATE_SELECTOR = [
  "article",
  "main",
  "[role='main']",
  "[role=\"main\"]",
  "section",
  "div[class*=article i]",
  "div[class*=body i]",
  "div[class*=content i]",
  "div[class*=feature i]",
  "div[class*=story i]",
  "div[id*=article i]",
  "div[id*=body i]",
  "div[id*=content i]",
  "div[id*=story i]",
].join(",");

const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, "utf8"));
const fixtures = manifest.fixtures.map(normalizeFixture);

async function main() {
  const { extractGeneralPageSurface } = await loadRuntimeGeneralPageExtractor();
  const {
    buildGeneralPageModelContext,
  } = await importTsModule("src/lib/general-page-model-context.ts");
  const {
    buildGeneralPageParserAdvisorRequest,
    buildRuleBasedGeneralPageParserAdvice,
    parseGeneralPageParserAdvisorAdvice,
  } = await importTsModule("src/lib/general-page-parser-advisor.ts");

  const results = [];
  for (const fixture of fixtures) {
    const html = fs.readFileSync(path.join(FIXTURE_DIR, fixture.file), "utf8");
    const dom = new JSDOM(html, { url: fixture.url });
    const surface = extractGeneralPageSurface({
      document: dom.window.document,
      url: fixture.url,
    });
    const context = buildGeneralPageModelContext(surface);
    const document = documentSignals(dom.window.document);
    const candidateBlocks = collectCandidateBlocks(dom.window.document);
    const request = buildGeneralPageParserAdvisorRequest(context, {
      document,
      candidateBlocks,
      allowScreenshot: false,
    });
    const advice = buildRuleBasedGeneralPageParserAdvice(request);
    const parsed = parseGeneralPageParserAdvisorAdvice(JSON.stringify(advice), request);
    const policy = evaluateAdvicePolicy(fixture, request, parsed.ok ? parsed.value : undefined);

    results.push({
      id: fixture.id,
      file: fixture.file,
      pageType: fixture.pageType,
      patterns: fixture.patterns,
      extraction: surface.extraction,
      modelReadiness: context.modelReadiness,
      qualityIssues: context.qualityIssues,
      escalation: request.escalation,
      candidateBlockCount: request.candidateBlocks.length,
      advice: parsed.ok ? parsed.value : undefined,
      parseError: parsed.ok ? undefined : parsed.error,
      policy,
    });
  }

  const report = {
    generatedAt: new Date().toISOString(),
    privacyBoundary: "Synthetic fixture parser-advisor spike. No real URLs, screenshots, or copied website text are committed.",
    fixtureCount: fixtures.length,
    summary: summarize(results),
    results,
  };

  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  fs.writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`);
  printSummary(report);
  if (!report.summary.pass)
    process.exitCode = 1;
}

function normalizeFixture(fixture) {
  if (!fixture.id || !fixture.file || !fixture.url)
    throw new Error(`Invalid fixture entry: ${JSON.stringify(fixture)}`);
  if (fixture.synthetic !== true)
    throw new Error(`Fixture ${fixture.id} must be synthetic.`);
  return fixture;
}

async function importTsModule(sourcePath) {
  const absolutePath = path.resolve(process.cwd(), sourcePath);
  return import(compileTsModuleDataUrl(absolutePath));
}

const tsModuleCache = new Map();

function compileTsModuleDataUrl(absolutePath) {
  if (tsModuleCache.has(absolutePath))
    return tsModuleCache.get(absolutePath);
  const source = fs.readFileSync(absolutePath, "utf8");
  const transpiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ES2022,
      target: ts.ScriptTarget.ES2022,
      importsNotUsedAsValues: ts.ImportsNotUsedAsValues.Remove,
      verbatimModuleSyntax: false,
    },
    fileName: absolutePath,
  });
  const output = transpiled.outputText.replace(
    /from\s+["'](\.[^"']+)["']/g,
    (match, specifier) => {
      const resolved = resolveTsImport(absolutePath, specifier);
      if (!resolved)
        return match;
      return `from "${compileTsModuleDataUrl(resolved)}"`;
    },
  );
  const encoded = Buffer.from(output, "utf8").toString("base64");
  const dataUrl = `data:text/javascript;base64,${encoded}`;
  tsModuleCache.set(absolutePath, dataUrl);
  return dataUrl;
}

function resolveTsImport(fromPath, specifier) {
  const basePath = path.resolve(path.dirname(fromPath), specifier);
  const candidates = [
    basePath,
    `${basePath}.ts`,
    path.join(basePath, "index.ts"),
  ];
  return candidates.find((candidate) => fs.existsSync(candidate)) ?? undefined;
}

function documentSignals(document) {
  return {
    articleCount: count(document, "article"),
    mainCount: count(document, "main"),
    roleMainCount: count(document, "[role='main'], [role=\"main\"]"),
    paragraphCount: count(document, "p"),
    linkCount: count(document, "a[href]"),
    imageCount: count(document, "img"),
    formCount: count(document, "form"),
    hasArticleMeta: Boolean(document.querySelector("meta[property^='article:']")),
    hasOpenGraph: Boolean(document.querySelector("meta[property^='og:']")),
  };
}

function collectCandidateBlocks(document) {
  const candidates = [];
  const seenText = new Set();
  let index = 0;
  for (const element of Array.from(document.body?.querySelectorAll(CANDIDATE_SELECTOR) ?? [])) {
    const text = cleanText(element.textContent ?? "");
    if (text.length < 120)
      continue;
    const textKey = text.slice(0, 160);
    if (seenText.has(textKey))
      continue;
    seenText.add(textKey);
    candidates.push({
      id: `block-${index + 1}`,
      label: candidateLabel(element),
      role: candidateRole(element),
      textPreview: text.slice(0, 1200),
      textLength: text.length,
      linkCount: element.querySelectorAll("a[href]").length,
      imageCount: element.querySelectorAll("img").length,
    });
    index += 1;
    if (candidates.length >= 8)
      break;
  }
  return candidates;
}

function candidateRole(element) {
  const tag = element.tagName.toLowerCase();
  if (tag === "article" || tag === "main" || element.getAttribute("role") === "main")
    return "semantic-root";
  return "fallback-block";
}

function candidateLabel(element) {
  const tag = element.tagName.toLowerCase();
  const id = element.getAttribute("id");
  const className = element.getAttribute("class");
  return [tag, id ? `#${id}` : undefined, className ? `.${className.replace(/\s+/g, ".")}` : undefined]
    .filter(Boolean)
    .join("");
}

function evaluateAdvicePolicy(fixture, request, advice) {
  if (!advice) {
    return { pass: false, reason: "advisor_response_did_not_parse" };
  }

  if (fixture.pageType === "list-index") {
    const pass = advice.pageType === "index_or_feed" && advice.decision === "downgrade_to_index_or_feed";
    return { pass, reason: pass ? "list-index downgraded" : "list-index must be downgraded" };
  }

  if (fixture.pageType === "blocked" || fixture.pageType === "bad-page") {
    const pass = ["mark_blocked_or_empty", "request_user_selection"].includes(advice.decision);
    return { pass, reason: pass ? "blocked/bad page stays fail-closed" : "blocked/bad page must fail closed" };
  }

  if (["article", "news", "blog", "documentation", "official-announcement", "media-article"].includes(fixture.pageType)) {
    const pass = ["accept_current", "prefer_candidate_block", "request_user_selection"].includes(advice.decision) && advice.pageType !== "index_or_feed";
    return { pass, reason: pass ? "content page remains usable or asks for user target" : "content page should not be downgraded" };
  }

  const pass = advice.decision !== "mark_blocked_or_empty" || request.modelReadiness === "blocked";
  return { pass, reason: pass ? "neutral policy accepted" : "neutral page should not be blocked" };
}

function summarize(results) {
  const failures = results.filter((item) => !item.policy.pass);
  const byDecision = countValues(results.map((item) => item.advice?.decision ?? "parse-error"));
  const byPageType = countValues(results.map((item) => item.advice?.pageType ?? "parse-error"));
  const escalationCount = results.filter((item) => item.escalation.shouldAskModel).length;
  return {
    pass: failures.length === 0,
    failureCount: failures.length,
    escalationCount,
    byDecision,
    byPageType,
    failures: failures.map((item) => ({
      id: item.id,
      pageType: item.pageType,
      decision: item.advice?.decision ?? "parse-error",
      advisorPageType: item.advice?.pageType ?? "parse-error",
      reason: item.policy.reason,
    })),
  };
}

function printSummary(report) {
  console.log(`Wrote ${REPORT_PATH}`);
  console.log(`fixtures ${report.fixtureCount}; escalations ${report.summary.escalationCount}; failures ${report.summary.failureCount}`);
  console.log(`decisions ${JSON.stringify(report.summary.byDecision)}`);
  console.log(`advisorPageTypes ${JSON.stringify(report.summary.byPageType)}`);
  if (!report.summary.pass) {
    console.error("parser-advisor threshold: fail");
    for (const failure of report.summary.failures) {
      console.error(`${failure.id}: ${failure.reason} (${failure.advisorPageType}/${failure.decision})`);
    }
  } else {
    console.log("parser-advisor threshold: pass");
  }
}

function count(root, selector) {
  return root.querySelectorAll(selector).length;
}

function cleanText(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function countValues(values) {
  return values.reduce((counts, value) => {
    counts[value] = (counts[value] ?? 0) + 1;
    return counts;
  }, {});
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
