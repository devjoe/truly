import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const endpoint = process.env.CDP_ENDPOINT || "http://127.0.0.1:9222";
const htmlPath = path.resolve(process.argv[2] ?? "tmp/evidence-first-investigation-prototype.html");
const screenshotPath = path.resolve(process.argv[3] ?? "tmp/evidence-first-investigation-prototype.png");
if (!htmlPath.startsWith(`${path.resolve("tmp")}${path.sep}`) || !screenshotPath.startsWith(`${path.resolve("tmp")}${path.sep}`)) {
  throw new Error("Prototype and screenshot paths must stay under tmp/");
}

function client(webSocketDebuggerUrl) {
  const socket = new WebSocket(webSocketDebuggerUrl);
  let sequence = 0;
  const pending = new Map();
  const events = new Map();
  socket.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    if (message.id && pending.has(message.id)) {
      const handler = pending.get(message.id);
      pending.delete(message.id);
      message.error ? handler.reject(new Error(message.error.message)) : handler.resolve(message.result);
      return;
    }
    const waiters = events.get(message.method);
    if (waiters?.length) waiters.shift()(message.params);
  });
  const opened = new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve, { once: true });
    socket.addEventListener("error", reject, { once: true });
  });
  return {
    opened,
    send(method, params = {}) {
      const id = ++sequence;
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
        socket.send(JSON.stringify({ id, method, params }));
      });
    },
    event(method) {
      return new Promise((resolve) => {
        const waiters = events.get(method) ?? [];
        waiters.push(resolve);
        events.set(method, waiters);
      });
    },
    close() { socket.close(); },
  };
}

const version = await fetch(`${endpoint}/json/version`).then((response) => response.json());
const browser = client(version.webSocketDebuggerUrl);
await browser.opened;
const created = await browser.send("Target.createTarget", { url: "about:blank", background: true });
const targets = await fetch(`${endpoint}/json/list`).then((response) => response.json());
const target = targets.find((item) => item.id === created.targetId);
if (!target?.webSocketDebuggerUrl) throw new Error("Background CDP target was not available");
const page = client(target.webSocketDebuggerUrl);
await page.opened;
await page.send("Page.enable");
await page.send("Emulation.setDeviceMetricsOverride", { width: 430, height: 1000, deviceScaleFactor: 1, mobile: false });
const loaded = page.event("Page.loadEventFired");
await page.send("Page.navigate", { url: pathToFileURL(htmlPath).href });
await loaded;
await page.send("Runtime.evaluate", { expression: "document.fonts && document.fonts.ready", awaitPromise: true });
const metrics = await page.send("Page.getLayoutMetrics");
const width = Math.ceil(metrics.cssContentSize.width);
const height = Math.ceil(metrics.cssContentSize.height);
const screenshot = await page.send("Page.captureScreenshot", {
  format: "png",
  captureBeyondViewport: true,
  clip: { x: 0, y: 0, width, height, scale: 1 },
});
const audit = await page.send("Runtime.evaluate", {
  expression: `(() => ({
    title: document.title,
    evidenceCards: document.querySelectorAll('.investigation-evidence-card').length,
    emptyStates: document.querySelectorAll('.investigation-evidence-empty').length,
    hasSufficiency: Boolean(document.querySelector('.investigation-sufficiency')),
    hasFinding: Boolean(document.querySelector('.investigation-finding')),
    firstEvidenceTop: document.querySelector('.investigation-evidence-card')?.getBoundingClientRect().top ?? null,
    sufficiencyTop: document.querySelector('.investigation-sufficiency')?.getBoundingClientRect().top ?? null,
    findingTop: document.querySelector('.investigation-finding')?.getBoundingClientRect().top ?? null,
  }))()`,
  returnByValue: true,
});
fs.writeFileSync(screenshotPath, Buffer.from(screenshot.data, "base64"));
page.close();
await browser.send("Target.closeTarget", { targetId: created.targetId });
browser.close();
console.log(JSON.stringify({
  result: "pass",
  noFocusTarget: true,
  screenshot: screenshotPath,
  viewport: { width: 430, height: 1000 },
  document: { width, height },
  audit: audit.result?.value,
}, null, 2));
