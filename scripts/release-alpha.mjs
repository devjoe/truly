#!/usr/bin/env node

import {
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const packageJson = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"));
const version = packageJson.version ?? "0.0.0";
const commit = git(["rev-parse", "--short=12", "HEAD"], "unknown").trim();
const dirtyFiles = git(["status", "--porcelain", "--", "."], "").split("\n").filter(Boolean);
const dirty = dirtyFiles.length > 0;
const allowDirty = process.env.TRULY_ALLOW_DIRTY_RELEASE === "1";
const crcTable = Array.from({ length: 256 }, (_, index) => {
  let crc = index;
  for (let bit = 0; bit < 8; bit += 1) {
    crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
  }
  return crc >>> 0;
});

if (dirty && !allowDirty) {
  console.error("Refusing to create an Alpha artifact from a dirty tree.");
  console.error("Commit or stash changes first, or run with TRULY_ALLOW_DIRTY_RELEASE=1 for a local smoke artifact.");
  for (const file of dirtyFiles) console.error(`- ${file}`);
  process.exit(1);
}

run("npm", ["run", "check:public"]);
run("npm", ["run", "build"]);
verifyReleaseManifest();

const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const suffix = dirty ? `${version}-${commit}-dirty-${stamp}` : `${version}-${commit}-${stamp}`;
const outDir = resolve(root, "artifacts/alpha", suffix);
rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });

const extensionZip = join(outDir, `truly-extension-${version}-${commit}${dirty ? "-dirty" : ""}.zip`);
const sourceZip = join(outDir, `truly-source-${version}-${commit}${dirty ? "-dirty" : ""}.zip`);
writeZipFromDirectory(resolve(root, "dist"), extensionZip, {
  rootPrefix: "",
  exclude: shouldExcludeExtensionPath,
});
writeZipFromDirectory(root, sourceZip, {
  rootPrefix: "",
  exclude: shouldExcludeSourcePath,
});

const report = {
  name: packageJson.name,
  version,
  commit,
  dirty,
  dirtyFiles,
  builtAt: new Date().toISOString(),
  checks: [
    "npm run check:public",
    "npm run build",
    "verify dist/manifest.json excludes commands.reload-extension",
  ],
  artifacts: {
    extensionZip: relative(root, extensionZip),
    sourceZip: relative(root, sourceZip),
  },
  reviewerDocs: [
    "docs/release/privacy-policy.md",
    "docs/release/permission-justification.md",
    "docs/release/cws-reviewer-notes.md",
    "THIRD_PARTY_NOTICES.md",
  ],
};

writeFileSync(join(outDir, "build-report.json"), `${JSON.stringify(report, null, 2)}\n`);
writeFileSync(join(outDir, "build-report.md"), renderReport(report));

console.log(`Alpha artifacts written to ${relative(root, outDir)}`);

function git(args, fallback) {
  try {
    return execFileSync("git", args, { cwd: root, encoding: "utf8" });
  } catch {
    return fallback;
  }
}

function run(command, args) {
  execFileSync(command, args, { cwd: root, stdio: "inherit" });
}

function verifyReleaseManifest() {
  const manifest = JSON.parse(readFileSync(resolve(root, "dist/manifest.json"), "utf8"));
  if (manifest.commands?.["reload-extension"]) {
    throw new Error("Release build must not include commands.reload-extension.");
  }
}

function shouldExcludeSourcePath(path) {
  const normalized = path.split(sep).join("/");
  return (
    normalized === ".git" ||
    normalized.startsWith(".git/") ||
    normalized === "node_modules" ||
    normalized.startsWith("node_modules/") ||
    normalized === "dist" ||
    normalized.startsWith("dist/") ||
    normalized.startsWith("dist-") ||
    normalized === "artifacts" ||
    normalized.startsWith("artifacts/") ||
    normalized === "tmp" ||
    normalized.startsWith("tmp/") ||
    normalized === "data" ||
    normalized.startsWith("data/") ||
    normalized === "test-results" ||
    normalized.startsWith("test-results/") ||
    normalized === ".env" ||
    normalized.startsWith(".env.")
  );
}

function shouldExcludeExtensionPath(path) {
  return path.endsWith(".map");
}

function renderReport(report) {
  const dirtyLine = report.dirty ? "yes" : "no";
  return [
    "# Truly Alpha Build Report",
    "",
    `- Version: ${report.version}`,
    `- Commit: ${report.commit}`,
    `- Built at: ${report.builtAt}`,
    `- Dirty tree: ${dirtyLine}`,
    "",
    "## Checks",
    "",
    ...report.checks.map((check) => `- ${check}`),
    "",
    "## Artifacts",
    "",
    `- Extension zip: \`${report.artifacts.extensionZip}\``,
    `- Source zip: \`${report.artifacts.sourceZip}\``,
    "",
    "## Reviewer Docs",
    "",
    ...report.reviewerDocs.map((doc) => `- \`${doc}\``),
    "",
  ].join("\n");
}

function writeZipFromDirectory(directory, outputPath, options) {
  const entries = collectFiles(directory, options);
  writeZip(entries, outputPath);
}

function collectFiles(directory, options) {
  const files = [];
  walk(directory);
  return files;

  function walk(current) {
    const relativePath = relative(directory, current).split(sep).join("/");
    if (relativePath && options.exclude(relativePath)) return;
    const stat = statSync(current);
    if (stat.isDirectory()) {
      for (const child of readdirSync(current).sort()) {
        walk(join(current, child));
      }
      return;
    }
    if (!stat.isFile()) return;
    files.push({
      name: [options.rootPrefix, relativePath].filter(Boolean).join("/"),
      data: readFileSync(current),
      date: stat.mtime,
    });
  }
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function dosDateTime(date) {
  const year = Math.max(date.getFullYear(), 1980);
  const dosTime =
    (date.getHours() << 11) |
    (date.getMinutes() << 5) |
    Math.floor(date.getSeconds() / 2);
  const dosDate =
    ((year - 1980) << 9) |
    ((date.getMonth() + 1) << 5) |
    date.getDate();
  return { dosTime, dosDate };
}

function writeZip(entries, outputPath) {
  mkdirSync(dirname(outputPath), { recursive: true });
  const chunks = [];
  const central = [];
  let offset = 0;

  for (const entry of entries) {
    const name = Buffer.from(entry.name, "utf8");
    const data = entry.data;
    const crc = crc32(data);
    const { dosTime, dosDate } = dosDateTime(entry.date);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(0, 8);
    local.writeUInt16LE(dosTime, 10);
    local.writeUInt16LE(dosDate, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    chunks.push(local, name, data);

    const header = Buffer.alloc(46);
    header.writeUInt32LE(0x02014b50, 0);
    header.writeUInt16LE(20, 4);
    header.writeUInt16LE(20, 6);
    header.writeUInt16LE(0x0800, 8);
    header.writeUInt16LE(0, 10);
    header.writeUInt16LE(dosTime, 12);
    header.writeUInt16LE(dosDate, 14);
    header.writeUInt32LE(crc, 16);
    header.writeUInt32LE(data.length, 20);
    header.writeUInt32LE(data.length, 24);
    header.writeUInt16LE(name.length, 28);
    header.writeUInt16LE(0, 30);
    header.writeUInt16LE(0, 32);
    header.writeUInt16LE(0, 34);
    header.writeUInt16LE(0, 36);
    header.writeUInt32LE(0, 38);
    header.writeUInt32LE(offset, 42);
    central.push(header, name);

    offset += local.length + name.length + data.length;
  }

  const centralOffset = offset;
  const centralSize = central.reduce((sum, chunk) => sum + chunk.length, 0);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralSize, 12);
  eocd.writeUInt32LE(centralOffset, 16);
  eocd.writeUInt16LE(0, 20);

  writeFileSync(outputPath, Buffer.concat([...chunks, ...central, eocd]));
}
