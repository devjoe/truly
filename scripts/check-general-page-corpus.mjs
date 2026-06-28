#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const FIXTURE_DIR = "tests/fixtures/general-pages";
const MANIFEST_PATH = path.join(FIXTURE_DIR, "manifest.json");
const CORPUS_DOC_PATH = "docs/plans/general-page-reader-corpus-v2.md";
const MIN_SYNTHETIC_FIXTURES = 25;
const MAX_SYNTHETIC_FIXTURES = 35;
const EXPECTED_OBSERVATION_TARGETS = 72;

const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, "utf8"));
const corpusDoc = fs.readFileSync(CORPUS_DOC_PATH, "utf8");
const failures = [];

if (manifest.schemaVersion !== 1)
  failures.push(`Unsupported manifest schemaVersion: ${manifest.schemaVersion}`);
if (!Array.isArray(manifest.fixtures))
  failures.push("Manifest fixtures must be an array.");

const fixtures = manifest.fixtures ?? [];
if (fixtures.length < MIN_SYNTHETIC_FIXTURES || fixtures.length > MAX_SYNTHETIC_FIXTURES) {
  failures.push(
    `Expected ${MIN_SYNTHETIC_FIXTURES}-${MAX_SYNTHETIC_FIXTURES} synthetic fixtures, found ${fixtures.length}.`,
  );
}

const patternIds = patternIdsFromDoc(corpusDoc);
const coveredPatterns = new Set();
const fixtureIds = new Set();

for (const fixture of fixtures) {
  if (!fixture.id)
    failures.push(`Fixture is missing id: ${JSON.stringify(fixture)}`);
  if (fixture.id && fixtureIds.has(fixture.id))
    failures.push(`Duplicate fixture id: ${fixture.id}`);
  if (fixture.id)
    fixtureIds.add(fixture.id);

  if (fixture.synthetic !== true)
    failures.push(`Fixture ${fixture.id} must be explicitly synthetic.`);
  if (!fixture.file)
    failures.push(`Fixture ${fixture.id} is missing file.`);
  if (fixture.file && !fs.existsSync(path.join(FIXTURE_DIR, fixture.file)))
    failures.push(`Fixture file is missing: ${fixture.file}`);

  if (!isAllowedExampleUrl(fixture.url))
    failures.push(`Fixture ${fixture.id} uses a non-example URL: ${fixture.url}`);

  const html = fixture.file
    ? fs.readFileSync(path.join(FIXTURE_DIR, fixture.file), "utf8")
    : "";
  for (const url of html.matchAll(/https?:\/\/([^/"'\s<>]+)/g)) {
    if (!isAllowedExampleHost(url[1]))
      failures.push(`Fixture ${fixture.id} contains a non-example URL host: ${url[1]}`);
  }

  if (!Array.isArray(fixture.patterns) || fixture.patterns.length === 0) {
    failures.push(`Fixture ${fixture.id} must declare at least one pattern.`);
  } else {
    for (const patternId of fixture.patterns) {
      coveredPatterns.add(patternId);
      if (!patternIds.has(patternId))
        failures.push(`Fixture ${fixture.id} references unknown pattern: ${patternId}`);
    }
  }

  const expected = fixture.expected ?? {};
  if (!Array.isArray(expected.contains) || expected.contains.length === 0)
    failures.push(`Fixture ${fixture.id} must declare expected.contains.`);
  if (!Array.isArray(expected.excludes))
    failures.push(`Fixture ${fixture.id} must declare expected.excludes.`);
}

for (const patternId of patternIds) {
  if (!coveredPatterns.has(patternId))
    failures.push(`Pattern has no synthetic fixture coverage: ${patternId}`);
}

const observationTargetCount = observationTargetsFromDoc(corpusDoc).length;
if (observationTargetCount !== EXPECTED_OBSERVATION_TARGETS) {
  failures.push(
    `Expected ${EXPECTED_OBSERVATION_TARGETS} observation targets, found ${observationTargetCount}.`,
  );
}

if (failures.length > 0) {
  console.error("General Page corpus check failed:");
  for (const failure of failures)
    console.error(`- ${failure}`);
  process.exitCode = 1;
} else {
  console.log(
    `General Page corpus check passed (${fixtures.length} fixtures, ` +
    `${patternIds.size} patterns covered, ${observationTargetCount} observation targets).`,
  );
}

function patternIdsFromDoc(doc) {
  return new Set(
    [...doc.matchAll(/^\| (P\d{2}-[a-z0-9-]+) \|/gm)]
      .map((match) => match[1]),
  );
}

function observationTargetsFromDoc(doc) {
  const categoryPattern = [
    "International news",
    "Taiwan news",
    "Government/official/NGO/company",
    "Technical docs/knowledge base",
    "Blog/Substack/Medium/personal",
    "Forum/social discussion",
    "Feed-like/social public pages",
    "Paywall/login/bad pages",
  ].map(escapeRegex).join("|");
  const pattern = new RegExp(`^\\| (${categoryPattern}) \\|`, "gm");
  return [...doc.matchAll(pattern)];
}

function isAllowedExampleUrl(value) {
  if (typeof value !== "string")
    return false;
  try {
    const parsed = new URL(value);
    return isAllowedExampleHost(parsed.hostname);
  } catch {
    return false;
  }
}

function isAllowedExampleHost(hostname) {
  return hostname === "example.test" || hostname.endsWith(".example.test");
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
