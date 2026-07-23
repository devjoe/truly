import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export const PRIVATE_EVAL_SURFACES = ["facebook", "news"];
const SOURCE_CONTEXT_LIMITS = {
  title: 100,
  sourceName: 60,
  publishedAt: 32,
};
const SOURCE_CONTEXT_ARTIFACT_RE = /https?:\/\/|\[[^\]]+\]\([^\)]+\)|(?:^|\s)(?:curl|wget|npm|pnpm|brew|git)\s/i;

export function parsePrivateEvalJsonl(text) {
  return String(text)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line, index) => {
      try {
        return JSON.parse(line);
      } catch {
        throw new Error(`Invalid JSONL at line ${index + 1}`);
      }
    });
}

export function privateEvalInputErrors(rows, expectedCount, declaredCategories) {
  const errors = [];
  if (!Number.isInteger(expectedCount) || expectedCount < 1) errors.push("--sample-count must be a positive integer");
  if (rows.length !== expectedCount) errors.push(`sample count mismatch: expected ${expectedCount}, found ${rows.length}`);
  const declared = new Set(String(declaredCategories).split(",").map((value) => value.trim()).filter(Boolean));
  const seenIds = new Set();
  const actual = new Set();
  for (const [index, row] of rows.entries()) {
    const label = `line ${index + 1}`;
    if (!row || typeof row !== "object" || Array.isArray(row)) {
      errors.push(`${label}: record must be an object`);
      continue;
    }
    if (typeof row.sampleId !== "string" || !/^(?:fb|news)_[a-f0-9]{32}$/.test(row.sampleId)) errors.push(`${label}: invalid opaque sampleId`);
    if (seenIds.has(row.sampleId)) errors.push(`${label}: duplicate sampleId`);
    seenIds.add(row.sampleId);
    if (!PRIVATE_EVAL_SURFACES.includes(row.surface)) errors.push(`${label}: invalid surface`);
    else {
      const category = typeof row.dataCategory === "string" && row.dataCategory.trim()
        ? row.dataCategory.trim()
        : `${row.surface}-original`;
      if (!new RegExp(`^${row.surface}-(?:original|human-preselected-claim)$`).test(category)) {
        errors.push(`${label}: invalid dataCategory`);
      } else actual.add(category);
    }
    if (!['zh-TW', 'en'].includes(row.language)) errors.push(`${label}: invalid language`);
    if (typeof row.text !== "string" || row.text.trim().length < 80 || row.text.length > 12000) errors.push(`${label}: text must be 80-12000 characters`);
    if (typeof row.sourceSha256 !== "string" || !/^[a-f0-9]{64}$/.test(row.sourceSha256)) errors.push(`${label}: invalid sourceSha256`);
    else if (typeof row.text === "string" && row.sourceSha256 !== crypto.createHash("sha256").update(row.text, "utf8").digest("hex")) {
      errors.push(`${label}: sourceSha256 does not match text`);
    }
    if (row.sourceContext !== undefined) {
      if (!row.sourceContext || typeof row.sourceContext !== "object" || Array.isArray(row.sourceContext)) {
        errors.push(`${label}: sourceContext must be an object`);
      } else {
        for (const [key, limit] of Object.entries(SOURCE_CONTEXT_LIMITS)) {
          const value = row.sourceContext[key];
          if (value === undefined) continue;
          if (typeof value !== "string" || !value.trim() || value.length > limit || SOURCE_CONTEXT_ARTIFACT_RE.test(value)) {
            errors.push(`${label}: invalid sourceContext.${key}`);
          }
        }
        if (row.sourceContext.url !== undefined) {
          try {
            const url = new URL(row.sourceContext.url);
            if (!/^https?:$/.test(url.protocol) || url.username || url.password || row.sourceContext.url.length > 320) {
              errors.push(`${label}: invalid sourceContext.url`);
            }
          } catch {
            errors.push(`${label}: invalid sourceContext.url`);
          }
        }
        const unknownKeys = Object.keys(row.sourceContext).filter((key) => !(key in SOURCE_CONTEXT_LIMITS) && key !== "url");
        if (unknownKeys.length > 0) errors.push(`${label}: unsupported sourceContext fields`);
      }
    }
  }
  if ([...actual].some((category) => !declared.has(category)) || [...declared].some((category) => !actual.has(category))) {
    errors.push(`data categories mismatch: declared ${[...declared].sort().join(",")}; actual ${[...actual].sort().join(",")}`);
  }
  return errors;
}

const RUNTIME_ENVELOPE_SOURCE_CLASSES = new Set([
  "news_article",
  "general_web",
  "facebook",
]);

export function privateRuntimeEnvelopeInputErrors(rows, expectedCount, declaredCategories) {
  const errors = [];
  if (!Number.isInteger(expectedCount) || expectedCount < 1) errors.push("--sample-count must be a positive integer");
  if (rows.length !== expectedCount) errors.push(`sample count mismatch: expected ${expectedCount}, found ${rows.length}`);
  const declared = new Set(String(declaredCategories).split(",").map((value) => value.trim()).filter(Boolean));
  const actual = new Set();
  const seenIds = new Set();
  for (const [index, row] of rows.entries()) {
    const label = `line ${index + 1}`;
    if (!row || typeof row !== "object" || Array.isArray(row)) {
      errors.push(`${label}: record must be an object`);
      continue;
    }
    if (row.schemaVersion !== 2) errors.push(`${label}: invalid runtime-envelope schemaVersion`);
    if (typeof row.sampleId !== "string" || !/^rt_[a-f0-9]{32}$/.test(row.sampleId)) errors.push(`${label}: invalid opaque sampleId`);
    if (seenIds.has(row.sampleId)) errors.push(`${label}: duplicate sampleId`);
    seenIds.add(row.sampleId);
    if (!RUNTIME_ENVELOPE_SOURCE_CLASSES.has(row.sourceClass)) errors.push(`${label}: invalid sourceClass`);
    if (typeof row.captureSha256 !== "string" || !/^[a-f0-9]{64}$/.test(row.captureSha256)) errors.push(`${label}: invalid captureSha256`);
    const capture = row.capture;
    if (!capture || typeof capture !== "object" || Array.isArray(capture) || capture.schemaVersion !== 1) {
      errors.push(`${label}: invalid capture envelope`);
      continue;
    }
    const analysis = capture.analysis;
    const adapter = capture.adapter;
    if (!analysis || !adapter || !["page", "focus"].includes(analysis.scope)) {
      errors.push(`${label}: invalid captured analysis scope`);
      continue;
    }
    if (analysis.scope !== "page") {
      errors.push(`${label}: Focus selector envelopes are not eligible for the Page-only release audit`);
    }
    actual.add(`${analysis.scope}-${row.sourceClass}`);
    if (analysis.allowedUse !== "article_or_selection_analysis" || analysis.hasScreenshot !== false) {
      errors.push(`${label}: capture is outside the investigation runtime boundary`);
    }
    const text = analysis.context?.mainText;
    if (typeof text !== "string" || text.trim().length < 80 || text.length > 8192) {
      errors.push(`${label}: captured mainText must be 80-8192 characters`);
    }
    if (analysis.scope === "focus" && analysis.context?.targetKind !== "selection") {
      errors.push(`${label}: Focus capture must use targetKind=selection`);
    }
    if (analysis.scope === "page" && analysis.context?.targetKind !== "page") {
      errors.push(`${label}: Page capture must use targetKind=page`);
    }
    if (adapter.targetKind !== analysis.context?.targetKind || adapter.outputLang !== analysis.outputLang ||
        !["zh-TW", "en"].includes(adapter.sourceLang) || !["zh-TW", "en"].includes(adapter.outputLang)) {
      errors.push(`${label}: adapter metadata drifted from captured analysis`);
    }
    if (adapter.authorizedSourceContext !== text) {
      errors.push(`${label}: authorized Page context drifted from captured mainText`);
    }
    if (!Array.isArray(adapter.candidates) || adapter.candidates.length < 1 || adapter.candidates.length > 48) {
      errors.push(`${label}: invalid captured candidates`);
    } else if (typeof text === "string") {
      const ids = new Set();
      for (const candidate of adapter.candidates) {
        if (!candidate || typeof candidate.id !== "string" || !/^span:\d+$/.test(candidate.id) || ids.has(candidate.id) ||
            !Number.isInteger(candidate.start) || !Number.isInteger(candidate.end) || candidate.start < 0 ||
            candidate.end <= candidate.start || candidate.end > text.length ||
            candidate.exactText !== text.slice(candidate.start, candidate.end)) {
          errors.push(`${label}: invalid exact captured candidate`);
          break;
        }
        ids.add(candidate.id);
      }
    }
    if (row.captureSha256 !== crypto.createHash("sha256").update(JSON.stringify(capture), "utf8").digest("hex")) {
      errors.push(`${label}: captureSha256 does not match capture`);
    }
  }
  if ([...actual].some((category) => !declared.has(category)) || [...declared].some((category) => !actual.has(category))) {
    errors.push(`data categories mismatch: declared ${[...declared].sort().join(",")}; actual ${[...actual].sort().join(",")}`);
  }
  return errors;
}

export function assertPrivateEvalPaths(inputPath, outputPath, metaOutputPath, cwd) {
  const resolved = [inputPath, outputPath, metaOutputPath].map((value) => path.resolve(value));
  if (new Set(resolved).size !== resolved.length) throw new Error("Input, output, and meta output paths must differ");
  const repoRoot = `${path.resolve(cwd)}${path.sep}`;
  const tmpRoot = `${path.resolve(cwd, "tmp")}${path.sep}`;
  for (const [index, value] of resolved.entries()) {
    if (index === 0 && !fs.existsSync(value)) throw new Error("Private eval input does not exist");
    if (value.startsWith(repoRoot) && !value.startsWith(tmpRoot)) throw new Error("Private eval files must stay outside the public repo or under tmp/");
  }
  return { input: resolved[0], output: resolved[1], metaOutput: resolved[2] };
}

export function outputLanguageForPrivateEval(language) {
  return language === "en" ? "en" : "zh-TW";
}

export function privateSpanAuditNoCandidateResult(base) {
  return {
    ...base,
    ok: true,
    status: "abstain",
    reason: "no_candidates",
    actions: [],
  };
}
