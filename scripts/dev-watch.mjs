import { spawn } from "node:child_process";
import { existsSync, watchFile, unwatchFile } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BUILD_ID_FILE = path.join(ROOT, "dist", "build-id.txt");
const PATCH_SCRIPT = path.join(ROOT, "scripts", "patch-dev-manifest.mjs");
const RELEASE_LOCK_FILE = path.join(ROOT, "tmp", "release-preview.lock");
const VITE_BIN = path.join(
  ROOT,
  "node_modules",
  ".bin",
  process.platform === "win32" ? "vite.cmd" : "vite",
);

if (existsSync(RELEASE_LOCK_FILE)) {
  console.error("[dev-watch] refusing to start while release:preview is running.");
  console.error("[dev-watch] wait for the release command to finish before starting dev mode.");
  process.exit(1);
}

let patchInFlight = false;
let patchQueued = false;

function runPatch(reason) {
  if (patchInFlight) {
    patchQueued = true;
    return;
  }
  if (!existsSync(BUILD_ID_FILE)) return;

  patchInFlight = true;
  const child = spawn(process.execPath, [PATCH_SCRIPT], {
    cwd: ROOT,
    stdio: "inherit",
    env: process.env,
  });
  child.on("exit", (code) => {
    patchInFlight = false;
    if (code === 0) {
      console.log(`[dev-watch] dev manifest patched (${reason})`);
    } else {
      console.error(`[dev-watch] manifest patch failed (${reason})`);
    }
    if (patchQueued) {
      patchQueued = false;
      runPatch("queued rebuild");
    }
  });
}

const vite = spawn(VITE_BIN, ["build", "--watch", "--mode", "development"], {
  cwd: ROOT,
  stdio: "inherit",
  env: { ...process.env, TRULY_DEV_BUILD: "1" },
});

watchFile(BUILD_ID_FILE, { interval: 500 }, (current, previous) => {
  if (current.mtimeMs > 0 && current.mtimeMs !== previous.mtimeMs) {
    runPatch("build-id changed");
  }
});

setTimeout(() => runPatch("startup"), 1000);

function shutdown(signal) {
  unwatchFile(BUILD_ID_FILE);
  if (vite.pid) {
    try {
      vite.kill("SIGTERM");
    } catch {
      // Already stopped.
    }
  }
  if (signal) console.log(`\n[dev-watch] stopped (${signal})`);
}

process.on("SIGINT", () => {
  shutdown("SIGINT");
  process.exit(130);
});
process.on("SIGTERM", () => {
  shutdown("SIGTERM");
  process.exit(143);
});

vite.on("exit", (code) => {
  unwatchFile(BUILD_ID_FILE);
  process.exit(code ?? 0);
});
