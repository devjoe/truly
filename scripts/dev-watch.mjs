import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
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

const vite = spawn(VITE_BIN, ["build", "--watch", "--mode", "development"], {
  cwd: ROOT,
  stdio: "inherit",
  env: { ...process.env, TRULY_DEV_BUILD: "1" },
});

function shutdown(signal) {
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
  process.exit(code ?? 0);
});
