import { spawn, spawnSync } from "node:child_process";
import {
  closeSync,
  mkdirSync,
  openSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const STATE_DIR = path.join(ROOT, "tmp");
const STATE_PATH = path.join(STATE_DIR, "dev-singleton.json");
const LOG_PATH = path.join(STATE_DIR, "dev-singleton.log");

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function readState() {
  try {
    return JSON.parse(readFileSync(STATE_PATH, "utf8"));
  } catch {
    return null;
  }
}

function writeState(state) {
  mkdirSync(STATE_DIR, { recursive: true });
  writeFileSync(STATE_PATH, `${JSON.stringify(state, null, 2)}\n`);
}

function clearState() {
  rmSync(STATE_PATH, { force: true });
}

function isAlive(pid) {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function psCommand(pid) {
  const out = spawnSync("ps", ["-p", String(pid), "-ww", "-o", "command="], {
    encoding: "utf8",
  });
  return (out.stdout ?? "").trim();
}

function childPids(pid) {
  const out = spawnSync("pgrep", ["-P", String(pid)], { encoding: "utf8" });
  return (out.stdout ?? "")
    .split(/\s+/)
    .map((x) => Number(x))
    .filter((x) => Number.isInteger(x) && x > 0);
}

function parentPid(pid) {
  const out = spawnSync("ps", ["-p", String(pid), "-o", "ppid="], {
    encoding: "utf8",
  });
  const ppid = Number((out.stdout ?? "").trim());
  return Number.isInteger(ppid) && ppid > 1 ? ppid : null;
}

function ancestorPids(pid) {
  const out = [];
  let current = pid;
  while (current) {
    const parent = parentPid(current);
    if (!parent || out.includes(parent)) break;
    out.push(parent);
    current = parent;
  }
  return out;
}

function processTree(pid) {
  const out = [];
  const visit = (current) => {
    for (const child of childPids(current)) visit(child);
    out.push(current);
  };
  visit(pid);
  return out;
}

async function terminatePid(pid, label) {
  if (!isAlive(pid)) return;
  const tree = processTree(pid);
  for (const current of tree) {
    try {
      process.kill(current, "SIGTERM");
    } catch {
      // Already gone.
    }
  }
  await sleep(800);
  for (const current of tree) {
    if (!isAlive(current)) continue;
    try {
      process.kill(current, "SIGKILL");
    } catch {
      // Already gone.
    }
  }
  console.log(`[dev-singleton] stopped ${label} pid=${pid}`);
}

function repoDevPids() {
  const out = spawnSync("ps", ["-ax", "-ww", "-o", "pid=", "-o", "command="], {
    encoding: "utf8",
  });
  const pids = [];
  for (const line of (out.stdout ?? "").split("\n")) {
    const match = line.match(/^\s*(\d+)\s+(.+)$/);
    if (!match) continue;
    const pid = Number(match[1]);
    const command = match[2];
    if (pid === process.pid) continue;
    if (!command.includes(ROOT)) continue;
    if (
      command.includes("scripts/dev-singleton.mjs") ||
      command.includes("scripts/dev-watch.mjs") ||
      command.includes("scripts/dev-reload-server.mjs")
    ) {
      pids.push(pid);
    }
  }
  return Array.from(new Set(pids));
}

async function stopExisting() {
  const state = readState();
  if (state?.root === ROOT && isAlive(state.managerPid)) {
    const command = psCommand(state.managerPid);
    if (command.includes("scripts/dev-singleton.mjs")) {
      await terminatePid(state.managerPid, "previous manager");
    }
  }

  const ancestors = ancestorPids(process.pid);
  const directChildren = childPids(process.pid);
  for (const pid of repoDevPids()) {
    if (pid === process.pid) continue;
    if (ancestors.includes(pid)) continue;
    if (directChildren.includes(pid)) continue;
    await terminatePid(pid, "orphan dev process");
  }
  clearState();
}

function spawnDevProcess(name, scriptName) {
  const child = spawn("npm", ["run", scriptName], {
    cwd: ROOT,
    stdio: "inherit",
    env: process.env,
  });
  console.log(`[dev-singleton] started ${name} pid=${child.pid}`);
  return child;
}

async function start() {
  await stopExisting();

  const state = {
    root: ROOT,
    managerPid: process.pid,
    startedAt: new Date().toISOString(),
  };
  writeState(state);

  const watch = spawnDevProcess("dev-watch", "dev");
  state.watchPid = watch.pid;
  writeState(state);

  await sleep(2000);

  const reload = spawnDevProcess("dev-reload", "dev:reload");
  state.reloadPid = reload.pid;
  writeState(state);

  let stopping = false;
  const shutdown = async (signal, code = 0) => {
    if (stopping) return;
    stopping = true;
    console.log(`\n[dev-singleton] stopping (${signal})`);
    if (reload.pid) await terminatePid(reload.pid, "dev-reload");
    if (watch.pid) await terminatePid(watch.pid, "dev-watch");
    clearState();
    process.exit(code);
  };

  process.on("SIGINT", () => void shutdown("SIGINT", 130));
  process.on("SIGTERM", () => void shutdown("SIGTERM", 143));

  watch.on("exit", (code) => {
    if (!stopping) void shutdown("child-exit", code ?? 1);
  });
  reload.on("exit", (code) => {
    if (!stopping) void shutdown("child-exit", code ?? 1);
  });
}

async function stop() {
  await stopExisting();
  console.log("[dev-singleton] stopped");
}

function daemon() {
  mkdirSync(STATE_DIR, { recursive: true });
  const out = openSync(LOG_PATH, "a");
  const err = openSync(LOG_PATH, "a");
  const child = spawn(process.execPath, [fileURLToPath(import.meta.url), "start"], {
    cwd: ROOT,
    detached: true,
    stdio: ["ignore", out, err],
    env: process.env,
  });
  closeSync(out);
  closeSync(err);
  child.unref();
  console.log(`[dev-singleton] daemon pid=${child.pid}; log=${LOG_PATH}`);
}

function status() {
  const state = readState();
  const managed = state?.root === ROOT && isAlive(state.managerPid);
  console.log(`state: ${managed ? "running" : "not running"}`);
  if (state) {
    console.log(`managerPid: ${state.managerPid} ${isAlive(state.managerPid) ? "alive" : "dead"}`);
    if (state.watchPid) {
      console.log(`watchPid:   ${state.watchPid} ${isAlive(state.watchPid) ? "alive" : "dead"}`);
    }
    if (state.reloadPid) {
      console.log(`reloadPid:  ${state.reloadPid} ${isAlive(state.reloadPid) ? "alive" : "dead"}`);
    }
    console.log(`startedAt:  ${state.startedAt}`);
  }
  const orphans = repoDevPids();
  console.log(`repo dev processes: ${orphans.length > 0 ? orphans.join(", ") : "none"}`);
}

const command = process.argv[2] || "start";
if (command === "start") {
  void start();
} else if (command === "daemon") {
  daemon();
} else if (command === "stop") {
  void stop();
} else if (command === "status") {
  status();
} else {
  console.error("Usage: node scripts/dev-singleton.mjs [start|daemon|stop|status]");
  process.exit(2);
}
