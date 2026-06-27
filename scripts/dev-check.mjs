import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const DIST_BUILD_ID = resolve(ROOT, "dist", "build-id.txt");
const RELOAD_PORT = Number(process.env.TRULY_DEV_RELOAD_PORT || 9012);
const RELOAD_URL = `http://127.0.0.1:${RELOAD_PORT}/`;
const CDP_PORT = Number(process.env.CDP_PORT || 9222);
const CDP_BASE = `http://127.0.0.1:${CDP_PORT}`;

const checks = [];

function record(name, ok, detail) {
  checks.push({ name, ok, detail });
  console.log(`[${ok ? "OK" : "FAIL"}] ${name}: ${detail}`);
}

function warn(name, detail) {
  console.log(`[WARN] ${name}: ${detail}`);
}

function readDistBuildId() {
  try {
    const buildId = readFileSync(DIST_BUILD_ID, "utf8").trim();
    if (!buildId) throw new Error("empty build id");
    record("dist build id", true, buildId);
    return buildId;
  } catch (error) {
    record("dist build id", false, `${DIST_BUILD_ID}: ${error.message}`);
    return null;
  }
}

async function fetchJson(url, timeoutMs = 1500) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const response = await fetch(url, { cache: "no-store", signal: ctrl.signal });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

async function readReloadServerBuildId() {
  try {
    const json = await fetchJson(RELOAD_URL);
    const buildId = typeof json.buildId === "string" ? json.buildId : "";
    if (!buildId) throw new Error("missing buildId");
    record("reload server", true, `${RELOAD_URL} buildId=${buildId}`);
    return buildId;
  } catch (error) {
    record("reload server", false, `${RELOAD_URL}: ${error.message}`);
    return null;
  }
}

function checkReloadPortOwner() {
  const pids = spawnSync("lsof", ["-nP", `-iTCP:${RELOAD_PORT}`, "-sTCP:LISTEN", "-t"], {
    encoding: "utf8",
  }).stdout
    .split(/\s+/)
    .filter(Boolean);
  if (pids.length === 0) {
    warn("reload port owner", `no lsof listener found for ${RELOAD_PORT}`);
    return;
  }

  const commands = pids.map((pid) => {
    const command = spawnSync("ps", ["-p", pid, "-ww", "-o", "command="], {
      encoding: "utf8",
    }).stdout.trim();
    return { pid, command };
  });
  const owned = commands.some(({ command }) => command.includes("scripts/dev-reload-server.mjs"));
  const detail = commands.map(({ pid, command }) => `${pid}: ${command}`).join(" | ");
  record("reload port owner", owned, detail);
}

function assertWebSocketAvailable() {
  if (typeof WebSocket !== "function") {
    throw new Error("global WebSocket is unavailable in this Node runtime");
  }
}

function connectCdp(webSocketDebuggerUrl) {
  assertWebSocketAvailable();
  const ws = new WebSocket(webSocketDebuggerUrl);
  let nextId = 1;
  const pending = new Map();

  const opened = new Promise((resolveOpen, rejectOpen) => {
    ws.addEventListener("open", () => resolveOpen());
    ws.addEventListener("error", () => rejectOpen(new Error("CDP websocket connection failed")), { once: true });
  });

  ws.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    if (!message.id || !pending.has(message.id)) return;
    const { resolve, reject } = pending.get(message.id);
    pending.delete(message.id);
    if (message.error) reject(new Error(message.error.message ?? JSON.stringify(message.error)));
    else resolve(message.result);
  });

  async function send(method, params = {}) {
    await opened;
    const id = nextId++;
    const response = new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
    });
    ws.send(JSON.stringify({ id, method, params }));
    return response;
  }

  return {
    async evaluate(expression) {
      const result = await send("Runtime.evaluate", {
        expression,
        awaitPromise: true,
        returnByValue: true,
      });
      if (result.exceptionDetails) {
        throw new Error(result.exceptionDetails.text ?? "Runtime.evaluate failed");
      }
      return result.result?.value ?? null;
    },
    close() {
      ws.close();
    },
  };
}

async function readCdpTargets() {
  try {
    const targets = await fetchJson(`${CDP_BASE}/json/list`, 1500);
    if (!Array.isArray(targets)) throw new Error("target list was not an array");
    return targets;
  } catch (error) {
    record("chrome cdp", false, `${CDP_BASE}/json/list: ${error.message}`);
    return null;
  }
}

async function evaluateTarget(target, expression) {
  const cdp = connectCdp(target.webSocketDebuggerUrl);
  try {
    return await cdp.evaluate(expression);
  } finally {
    cdp.close();
  }
}

async function readTrulyServiceWorkers(targets) {
  const serviceWorkers = targets.filter((target) =>
    target.type === "service_worker" &&
    typeof target.url === "string" &&
    target.url.startsWith("chrome-extension://") &&
    target.webSocketDebuggerUrl
  );
  const found = [];
  for (const target of serviceWorkers) {
    try {
      const value = await evaluateTarget(target, `(() => {
        const manifest = chrome.runtime.getManifest();
        return {
          id: chrome.runtime.id,
          name: manifest.name,
          version: manifest.version,
          versionName: manifest.version_name || "",
          buildId: globalThis.__TRULY_BUILD_ID || null,
          url: globalThis.location?.href || ""
        };
      })()`);
      if (value?.name === "Truly") found.push(value);
    } catch {
      // Ignore unrelated or sleeping extension targets.
    }
  }
  if (found.length === 0) {
    record("chrome service worker", false, "no loaded Truly service worker found via CDP");
  } else if (found.length > 1) {
    record("chrome service worker", false, `multiple Truly service workers loaded: ${found.map((x) => x.id).join(", ")}`);
  } else {
    const sw = found[0];
    record("chrome service worker", true, `${sw.id} buildId=${sw.buildId}`);
  }
  return found;
}

async function checkFacebookContentScripts(targets, expectedBuildId) {
  const facebookPages = targets.filter((target) =>
    target.type === "page" &&
    typeof target.url === "string" &&
    /^https?:\/\/([^/]+\.)?facebook\.com\//.test(target.url) &&
    target.webSocketDebuggerUrl
  );
  if (facebookPages.length === 0) {
    warn("facebook content scripts", "no Facebook tabs found; skipping content-script build-id check");
    return;
  }

  for (const target of facebookPages) {
    try {
      const buildId = await evaluateTarget(target, "document.documentElement.dataset.trulyBuildId || null");
      const ok = buildId === expectedBuildId;
      record("facebook content script", ok, `${target.url} buildId=${buildId ?? "(missing)"}`);
    } catch (error) {
      record("facebook content script", false, `${target.url}: ${error.message}`);
    }
  }
}

function compareBuildIds(label, leftName, left, rightName, right) {
  if (!left || !right) return;
  record(label, left === right, `${leftName}=${left} ${left === right ? "==" : "!="} ${rightName}=${right}`);
}

const distBuildId = readDistBuildId();
const reloadBuildId = await readReloadServerBuildId();
checkReloadPortOwner();
compareBuildIds("dist vs reload", "dist", distBuildId, "reload", reloadBuildId);

const targets = await readCdpTargets();
if (targets) {
  record("chrome cdp", true, `${CDP_BASE} targets=${targets.length}`);
  const serviceWorkers = await readTrulyServiceWorkers(targets);
  if (serviceWorkers.length === 1) {
    const swBuildId = serviceWorkers[0].buildId;
    compareBuildIds("dist vs service worker", "dist", distBuildId, "serviceWorker", swBuildId);
    await checkFacebookContentScripts(targets, swBuildId);
  }
}

const failed = checks.filter((check) => !check.ok);
if (failed.length > 0) {
  console.error(`dev-check failed: ${failed.length} failed check(s)`);
  process.exit(1);
}
console.log("dev-check ok");
