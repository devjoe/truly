#!/usr/bin/env node

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { extname, join, relative, resolve, sep } from "node:path";
import { inflateRawSync } from "node:zlib";

const root = resolve(new URL("..", import.meta.url).pathname);
const args = process.argv.slice(2);

const FORBIDDEN_RUNTIME_MARKERS = [
  "http://localhost:9012/",
  "[dev-reload]",
  "devReloadPendingTabRefresh",
  "reload-extension",
];
const FORBIDDEN_TEXT_MARKERS = [
  ...FORBIDDEN_RUNTIME_MARKERS,
  "sourceMappingURL=",
];
const FORBIDDEN_ENTRY_PATTERNS = [
  /^\.env(?:\.|$)/,
  /^\.git(?:\/|$)/,
  /^AGENTS\.md$/,
  /^artifacts\//,
  /^data\//,
  /^docs\//,
  /^node_modules\//,
  /^scripts\//,
  /^src\//,
  /^test-results\//,
  /^tests\//,
  /^tmp\//,
];
const TEXT_EXTENSIONS = new Set([
  ".css",
  ".html",
  ".js",
  ".json",
  ".mjs",
  ".svg",
  ".txt",
  ".wasm.map",
]);
const EXECUTABLE_REMOTE_PATTERNS = [
  /<script\b[^>]*\bsrc=["']https?:\/\//i,
  /\bimportScripts\s*\(\s*["']https?:\/\//,
  /\bimport\s*\(\s*["']https?:\/\//,
  /\bnew\s+(?:Shared)?Worker\s*\(\s*["']https?:\/\//,
];
const EXPECTED_REQUIRED_PERMISSIONS = ["activeTab", "sidePanel", "storage"];
const EXPECTED_HOST_PERMISSIONS = [
  "*://*.facebook.com/*",
  "*://*.fbcdn.net/*",
  "http://127.0.0.1/*",
  "http://localhost/*",
];
const EXPECTED_OPTIONAL_HOST_PERMISSIONS = [
  "http://*/*",
  "https://*/*",
];

const options = parseArgs(args);
const entries = options.zip
  ? readZipEntries(options.zip)
  : readDirectoryEntries(options.dist);
const errors = [];

auditEntryNames(entries, errors, { failOnSourceMaps: Boolean(options.zip) });
auditManifest(entries, errors);
auditTextContents(entries, errors, { failOnSourceMapComments: Boolean(options.zip) });

if (errors.length > 0) {
  console.error("Release bundle audit failed:");
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

const target = options.zip ? relative(root, options.zip) : relative(root, options.dist);
console.log(`Release bundle audit passed (${target}, ${entries.length} files).`);

function parseArgs(values) {
  const out = {};
  for (let i = 0; i < values.length; i += 1) {
    const value = values[i];
    if (value === "--dist") {
      out.dist = resolve(root, values[++i] ?? "");
    } else if (value === "--zip") {
      out.zip = resolve(root, values[++i] ?? "");
    } else {
      usage(`unknown argument: ${value}`);
    }
  }
  if ((out.dist ? 1 : 0) + (out.zip ? 1 : 0) !== 1) {
    usage("pass exactly one of --dist <directory> or --zip <file>");
  }
  return out;
}

function usage(message) {
  console.error(`Error: ${message}`);
  console.error("Usage: node scripts/audit-release-bundle.mjs --dist dist");
  console.error("   or: node scripts/audit-release-bundle.mjs --zip artifacts/alpha/.../truly-extension.zip");
  process.exit(2);
}

function normalizePath(path) {
  return path.split(sep).join("/").replace(/^\/+/, "");
}

function readDirectoryEntries(directory) {
  if (!existsSync(directory) || !statSync(directory).isDirectory()) {
    throw new Error(`dist directory not found: ${directory}`);
  }
  const entries = [];
  walk(directory);
  return entries.sort((a, b) => a.name.localeCompare(b.name));

  function walk(current) {
    const stat = statSync(current);
    if (stat.isDirectory()) {
      for (const child of readdirSync(current).sort()) walk(join(current, child));
      return;
    }
    if (!stat.isFile()) return;
    const name = normalizePath(relative(directory, current));
    entries.push({ name, data: readFileSync(current) });
  }
}

function readZipEntries(file) {
  if (!existsSync(file) || !statSync(file).isFile()) {
    throw new Error(`zip file not found: ${file}`);
  }
  const buffer = readFileSync(file);
  const entries = [];
  let offset = 0;
  while (offset + 30 <= buffer.length) {
    const signature = buffer.readUInt32LE(offset);
    if (signature === 0x02014b50 || signature === 0x06054b50) break;
    if (signature !== 0x04034b50) {
      throw new Error(`unsupported zip structure at offset ${offset}`);
    }
    const flags = buffer.readUInt16LE(offset + 6);
    const method = buffer.readUInt16LE(offset + 8);
    const compressedSize = buffer.readUInt32LE(offset + 18);
    const uncompressedSize = buffer.readUInt32LE(offset + 22);
    const nameLength = buffer.readUInt16LE(offset + 26);
    const extraLength = buffer.readUInt16LE(offset + 28);
    const nameStart = offset + 30;
    const dataStart = nameStart + nameLength + extraLength;
    const dataEnd = dataStart + compressedSize;
    if ((flags & 0x08) !== 0) {
      throw new Error("zip entries with data descriptors are not supported by this audit");
    }
    if (dataEnd > buffer.length) throw new Error(`truncated zip entry at offset ${offset}`);
    const name = normalizePath(buffer.slice(nameStart, nameStart + nameLength).toString("utf8"));
    if (name.endsWith("/")) {
      offset = dataEnd;
      continue;
    }
    const compressed = buffer.slice(dataStart, dataEnd);
    const data = method === 0
      ? compressed
      : method === 8
        ? inflateRawSync(compressed)
        : null;
    if (!data) throw new Error(`unsupported zip compression method ${method} for ${name}`);
    if (data.length !== uncompressedSize) {
      throw new Error(`zip size mismatch for ${name}`);
    }
    entries.push({ name, data });
    offset = dataEnd;
  }
  return entries.sort((a, b) => a.name.localeCompare(b.name));
}

function auditEntryNames(entries, out, { failOnSourceMaps }) {
  const names = new Set(entries.map((entry) => entry.name));
  for (const required of ["manifest.json", "background/service-worker.js"]) {
    if (!names.has(required)) out.push(`missing required extension file: ${required}`);
  }
  for (const entry of entries) {
    for (const pattern of FORBIDDEN_ENTRY_PATTERNS) {
      if (pattern.test(entry.name)) {
        out.push(`forbidden extension entry: ${entry.name}`);
        break;
      }
    }
    if (failOnSourceMaps && entry.name.endsWith(".map")) {
      out.push(`source map must not be packaged: ${entry.name}`);
    }
  }
}

function auditManifest(entries, out) {
  const manifestEntry = entries.find((entry) => entry.name === "manifest.json");
  if (!manifestEntry) return;
  let manifest;
  try {
    manifest = JSON.parse(manifestEntry.data.toString("utf8"));
  } catch (error) {
    out.push(`manifest.json is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
    return;
  }
  if (manifest.manifest_version !== 3) out.push("manifest_version must be 3");
  if (manifest.background?.service_worker !== "background/service-worker.js") {
    out.push("background.service_worker must be background/service-worker.js");
  }
  if (manifest.commands?.["reload-extension"]) {
    out.push("manifest must not include commands.reload-extension");
  }
  if (manifest.externally_connectable) {
    out.push("manifest must not expose externally_connectable");
  }
  if (Array.isArray(manifest.web_accessible_resources) && manifest.web_accessible_resources.length > 0) {
    out.push("manifest must not expose web_accessible_resources");
  }
  assertStringArrayEquals(
    manifest.permissions,
    EXPECTED_REQUIRED_PERMISSIONS,
    "permissions",
    out,
  );
  assertStringArrayEquals(
    manifest.host_permissions,
    EXPECTED_HOST_PERMISSIONS,
    "host_permissions",
    out,
  );
  assertStringArrayEquals(
    manifest.optional_host_permissions,
    EXPECTED_OPTIONAL_HOST_PERMISSIONS,
    "optional_host_permissions",
    out,
  );
  const csp = manifest.content_security_policy?.extension_pages;
  if (typeof csp !== "string") {
    out.push("content_security_policy.extension_pages must be present");
  } else {
    if (/\bunsafe-inline\b/.test(csp)) out.push("CSP must not allow unsafe-inline");
    if (/\bhttps?:\/\//i.test(csp)) out.push("CSP must not allow remote script URLs");
  }
}

function assertStringArrayEquals(actual, expected, label, out) {
  if (!Array.isArray(actual)) {
    out.push(`${label} must be an array`);
    return;
  }
  const actualSorted = [...actual].sort();
  const expectedSorted = [...expected].sort();
  if (JSON.stringify(actualSorted) !== JSON.stringify(expectedSorted)) {
    out.push(`${label} changed: expected ${JSON.stringify(expectedSorted)}, got ${JSON.stringify(actualSorted)}`);
  }
}

function auditTextContents(entries, out, { failOnSourceMapComments }) {
  for (const entry of entries) {
    if (!isTextEntry(entry.name)) continue;
    const text = entry.data.toString("utf8");
    const markers = failOnSourceMapComments ? FORBIDDEN_TEXT_MARKERS : FORBIDDEN_RUNTIME_MARKERS;
    for (const marker of markers) {
      if (text.includes(marker)) out.push(`${entry.name} contains forbidden marker: ${marker}`);
    }
    for (const pattern of EXECUTABLE_REMOTE_PATTERNS) {
      if (pattern.test(text)) {
        out.push(`${entry.name} appears to load executable code from a remote URL (${pattern})`);
      }
    }
  }
}

function isTextEntry(name) {
  if (name.endsWith(".wasm.map")) return true;
  const ext = extname(name);
  return TEXT_EXTENSIONS.has(ext);
}
