import http from "node:http";
import { readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";

const PORT = Number(process.env.TRULY_DEV_RELOAD_PORT || 9012);
const BUILD_ID_FILE = resolve(process.cwd(), "dist", "build-id.txt");
const POLL_INTERVAL_MS = 500;

function readBuildId() {
  try {
    const id = readFileSync(BUILD_ID_FILE, "utf8").trim();
    return id.length > 0 ? id : null;
  } catch {
    return null;
  }
}

function readMtime() {
  try {
    return statSync(BUILD_ID_FILE).mtimeMs;
  } catch {
    return 0;
  }
}

let lastMtime = readMtime();
let buildId = readBuildId() ?? String(Date.now());

setInterval(() => {
  const currentMtime = readMtime();
  if (currentMtime > 0 && currentMtime !== lastMtime) {
    lastMtime = currentMtime;
    buildId = readBuildId() ?? buildId;
    console.log(`[dev-reload] build-id changed: ${buildId}`);
  }
}, POLL_INTERVAL_MS);

http
  .createServer((_req, res) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ buildId, ts: new Date().toISOString() }));
  })
  .listen(PORT, () => {
    console.log(`[dev-reload] watching ${BUILD_ID_FILE}`);
    console.log(`[dev-reload] listening on http://localhost:${PORT}`);
  });
