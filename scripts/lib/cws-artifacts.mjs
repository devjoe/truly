import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

export const root = fileURLToPath(new URL("../..", import.meta.url));
export const releaseLockPath = resolve(root, "tmp/release-preview.lock");
export const devStatePath = resolve(root, "tmp/dev-singleton.json");

const crcTable = Array.from({ length: 256 }, (_, index) => {
  let crc = index;
  for (let bit = 0; bit < 8; bit += 1) {
    crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
  }
  return crc >>> 0;
});

export function readProjectMetadata() {
  const packageJson = readJson("package.json");
  const manifest = readJson("src/manifest.json");
  const version = packageJson.version ?? "0.0.0";
  const previewNumber = parsePreviewNumber(manifest.version_name, version);
  return {
    packageJson,
    manifest,
    version,
    versionName: manifest.version_name,
    previewNumber,
    recommendedTag: previewNumber ? `v${version}-preview.${previewNumber}` : `v${version}`,
    commit: git(["rev-parse", "--short=12", "HEAD"], "unknown").trim(),
    branch: git(["rev-parse", "--abbrev-ref", "HEAD"], "unknown").trim(),
  };
}

export function readJson(path) {
  return JSON.parse(readFileSync(resolve(root, path), "utf8"));
}

export function git(args, fallback = "") {
  try {
    return execFileSync("git", args, { cwd: root, encoding: "utf8" });
  } catch {
    return fallback;
  }
}

export function run(command, args) {
  execFileSync(command, args, { cwd: root, stdio: "inherit" });
}

export function assertCleanTree({ allowDirtyEnv, label }) {
  const dirtyFiles = git(["status", "--porcelain", "--", "."], "").split("\n").filter(Boolean);
  if (dirtyFiles.length === 0 || process.env[allowDirtyEnv] === "1") return dirtyFiles;

  console.error(`Refusing to create a ${label} artifact from a dirty tree.`);
  console.error(`Commit or stash changes first, or run with ${allowDirtyEnv}=1 for a local smoke artifact.`);
  for (const file of dirtyFiles) console.error(`- ${file}`);
  process.exit(1);
}

export function assertUpstreamSynced({ allowUnpushedEnv }) {
  const upstream = git(["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"], "").trim();
  if (!upstream) {
    console.error("Refusing to package for CWS because the current branch has no configured upstream.");
    console.error("Push the branch first, or configure an upstream remote branch.");
    process.exit(1);
  }

  const [aheadRaw, behindRaw] = git(["rev-list", "--left-right", "--count", "HEAD...@{u}"], "0\t0")
    .trim()
    .split(/\s+/);
  const ahead = Number(aheadRaw);
  const behind = Number(behindRaw);
  if (behind > 0) {
    console.error(`Refusing to package for CWS because the branch is behind ${upstream} by ${behind} commit(s).`);
    process.exit(1);
  }
  if (ahead > 0 && process.env[allowUnpushedEnv] !== "1") {
    console.error(`Refusing to package for CWS because the branch has ${ahead} unpushed commit(s).`);
    console.error(`Push first, or run with ${allowUnpushedEnv}=1 for a local smoke artifact.`);
    process.exit(1);
  }

  return { upstream, ahead, behind };
}

export function createReleaseLock(command) {
  if (existsSync(releaseLockPath)) {
    throw new Error(`Release lock already exists: ${relative(root, releaseLockPath)}`);
  }
  mkdirSync(dirname(releaseLockPath), { recursive: true });
  writeFileSync(releaseLockPath, `${JSON.stringify({
    pid: process.pid,
    startedAt: new Date().toISOString(),
    command,
  }, null, 2)}\n`);
}

export function clearReleaseLock() {
  rmSync(releaseLockPath, { force: true });
}

export function assertNoDevProcesses() {
  const devProcesses = repoDevProcesses();
  const devState = readDevState();
  const managedPids = [
    devState?.managerPid,
    devState?.watchPid,
    devState?.reloadPid,
  ].filter((pid) => Number.isInteger(pid) && pid > 0);
  const liveManaged = managedPids.filter(isAlive);
  if (devProcesses.length === 0 && liveManaged.length === 0) return;

  console.error("Refusing to create a CWS artifact while Truly dev processes are running.");
  console.error("Stop them first with `npm run dev:stop` or by stopping `make dev-all`.");
  for (const processInfo of devProcesses) {
    console.error(`- pid ${processInfo.pid}: ${processInfo.command}`);
  }
  for (const pid of liveManaged) {
    if (devProcesses.some((processInfo) => processInfo.pid === pid)) continue;
    console.error(`- managed dev pid ${pid}`);
  }
  process.exit(1);
}

export function writeExtensionZipFromDist(outputPath) {
  writeZipFromDirectory(resolve(root, "dist"), outputPath, {
    rootPrefix: "",
    exclude: shouldExcludeExtensionPath,
    transform: transformExtensionEntry,
  });
}

export function writeSourceZipFromGitTrackedFiles(outputPath) {
  writeZipFromGitTrackedFiles(outputPath, {
    rootPrefix: "",
    exclude: shouldExcludeSourcePath,
  });
}

export function sha256File(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

export function readDistBuildId() {
  try {
    return readFileSync(resolve(root, "dist/build-id.txt"), "utf8").trim();
  } catch {
    return null;
  }
}

export function parsePreviewNumber(versionName, version) {
  const match = new RegExp(`^${escapeRegExp(version)} Preview ([1-9]\\d*)$`).exec(versionName ?? "");
  return match?.[1] ?? null;
}

function readDevState() {
  try {
    const state = JSON.parse(readFileSync(devStatePath, "utf8"));
    return state?.root === root ? state : null;
  } catch {
    return null;
  }
}

function isAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function repoDevProcesses() {
  const out = spawnSync("ps", ["-ax", "-ww", "-o", "pid=", "-o", "command="], {
    encoding: "utf8",
  });
  if (out.error || out.status !== 0) {
    const reason = out.error ? String(out.error) : `status ${out.status}${out.signal ? ` signal ${out.signal}` : ""}`;
    const stderr = (out.stderr ?? "").trim();
    console.warn(
      `Warning: unable to inspect repo dev processes before packaging (${reason}${stderr ? `: ${stderr}` : ""}).`,
    );
    console.warn("Falling back to managed dev state only.");
    return [];
  }
  const processes = [];
  for (const line of (out.stdout ?? "").split("\n")) {
    const match = line.match(/^\s*(\d+)\s+(.+)$/);
    if (!match) continue;
    const pid = Number(match[1]);
    const command = match[2];
    if (pid === process.pid) continue;
    if (!command.includes(root)) continue;
    if (
      command.includes("scripts/dev-singleton.mjs") ||
      command.includes("scripts/dev-watch.mjs") ||
      command.includes("scripts/dev-reload-server.mjs") ||
      command.includes("make dev-all")
    ) {
      processes.push({ pid, command });
    }
  }
  return processes;
}

function shouldExcludeExtensionPath(path) {
  return path.endsWith(".map");
}

function shouldExcludeSourcePath(path) {
  const normalized = path.split(sep).join("/");
  return (
    normalized === ".DS_Store" ||
    normalized.endsWith("/.DS_Store") ||
    normalized.includes("/node_modules/") ||
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
    (normalized.startsWith("docs/assets/demo/truly-demo-") &&
      normalized !== "docs/assets/demo/truly-demo-balanced.gif") ||
    normalized === ".env" ||
    normalized.startsWith(".env.")
  );
}

function transformExtensionEntry(path, data) {
  if (!path.endsWith(".js")) return data;
  return Buffer.from(
    data.toString("utf8").replace(/\n?\/\/# sourceMappingURL=.*$/gm, ""),
    "utf8",
  );
}

function writeZipFromDirectory(directory, outputPath, options) {
  const entries = collectFiles(directory, options);
  writeZip(entries, outputPath);
}

function writeZipFromGitTrackedFiles(outputPath, options) {
  const trackedFiles = git(["ls-files", "-z"], "")
    .split("\0")
    .filter(Boolean)
    .sort();
  const entries = [];
  for (const relativePath of trackedFiles) {
    const normalized = relativePath.split(sep).join("/");
    if (options.exclude(normalized)) continue;
    const absolutePath = resolve(root, relativePath);
    const stat = statSync(absolutePath);
    if (!stat.isFile()) continue;
    entries.push({
      name: [options.rootPrefix, normalized].filter(Boolean).join("/"),
      data: readFileSync(absolutePath),
      date: stat.mtime,
    });
  }
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
    const data = readFileSync(current);
    files.push({
      name: [options.rootPrefix, relativePath].filter(Boolean).join("/"),
      data: options.transform ? options.transform(relativePath, data) : data,
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

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
