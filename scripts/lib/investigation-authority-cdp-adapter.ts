import crypto from "node:crypto";

import type { AuthorityDiscoveryRequest } from "../../src/lib/investigation-authority-discovery";
import type {
  AuthorityDiscoveryAdapter,
  AuthorityDiscoveryAcquisitionFailure,
} from "../../src/lib/investigation-authority-discovery-executor";

interface CdpClient {
  call(method: string, params?: Record<string, unknown>): Promise<any>;
  close(): void;
}

function connectCdp(url: string, timeoutMs: number): CdpClient {
  const socket = new WebSocket(url);
  let sequence = 0;
  const pending = new Map<number, { resolve(value: unknown): void; reject(error: Error): void; timer: ReturnType<typeof setTimeout> }>();
  const opened = new Promise<void>((resolve, reject) => {
    socket.addEventListener("open", () => resolve(), { once: true });
    socket.addEventListener("error", () => reject(new Error("CDP connection failed")), { once: true });
  });
  socket.addEventListener("message", (event) => {
    const message = JSON.parse(String(event.data));
    const item = pending.get(message.id);
    if (!item) return;
    clearTimeout(item.timer);
    pending.delete(message.id);
    if (message.error) item.reject(new Error(message.error.message));
    else item.resolve(message.result);
  });
  return {
    async call(method, params = {}) {
      await opened;
      const id = ++sequence;
      const result = new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          pending.delete(id);
          reject(new Error(`${method} timed out`));
        }, timeoutMs);
        pending.set(id, { resolve, reject, timer });
      });
      socket.send(JSON.stringify({ id, method, params }));
      return result;
    },
    close() { socket.close(); },
  };
}

function failure(reason: AuthorityDiscoveryAcquisitionFailure["reason"]): AuthorityDiscoveryAcquisitionFailure {
  return { ok: false, reason };
}

/** Development-only raw CDP adapter. Every target is background-only and closed after acquisition. */
export function createAuthorityDiscoveryCdpAdapter(
  request: AuthorityDiscoveryRequest,
  options: { endpoint: string; timeoutMs: number; maxLinksPerPage: number; maxDocumentCharacters: number },
): AuthorityDiscoveryAdapter {
  const allowedHosts = new Set(request.allowedHosts.map((host) => host.toLocaleLowerCase()));
  return {
    async acquire(value) {
      let requested: URL;
      try { requested = new URL(value); } catch { return failure("unsupported_format"); }
      if (!allowedHosts.has(requested.hostname.toLocaleLowerCase())) return failure("access_denied");
      let browser: CdpClient | undefined;
      let page: CdpClient | undefined;
      let targetId: string | undefined;
      try {
        const version = await fetch(`${options.endpoint}/json/version`).then((response) => response.json()) as { webSocketDebuggerUrl?: string };
        if (!version.webSocketDebuggerUrl) return failure("capability_unavailable");
        browser = connectCdp(version.webSocketDebuggerUrl, options.timeoutMs);
        ({ targetId } = await browser.call("Target.createTarget", { url: value, background: true, newWindow: false }));
        let target: { webSocketDebuggerUrl?: string } | undefined;
        for (let attempt = 0; attempt < 30; attempt += 1) {
          const targets = await fetch(`${options.endpoint}/json`).then((response) => response.json()) as Array<{ id: string; webSocketDebuggerUrl?: string }>;
          target = targets.find((candidate) => candidate.id === targetId);
          if (target?.webSocketDebuggerUrl) break;
          await new Promise((resolve) => setTimeout(resolve, 100));
        }
        if (!target?.webSocketDebuggerUrl) return failure("capability_unavailable");
        page = connectCdp(target.webSocketDebuggerUrl, options.timeoutMs);
        await page.call("Page.enable");
        let snapshot: any;
        const deadline = Date.now() + options.timeoutMs;
        while (Date.now() < deadline) {
          const evaluated = await page.call("Runtime.evaluate", {
            expression: `(() => {
              const root = document.querySelector("main, [role=main], #content, .main-content") || document.body;
              return {
                ready: document.readyState,
                url: location.href,
                title: document.title,
                text: (root?.innerText || "").replace(/\\s+/g, " ").trim().slice(0, ${options.maxDocumentCharacters}),
                links: [...document.querySelectorAll("a[href]")].slice(0, ${options.maxLinksPerPage}).map(a => ({
                  url: a.href,
                  label: (a.innerText || a.textContent || a.getAttribute("aria-label") || "").replace(/\\s+/g, " ").trim().slice(0, 500)
                }))
              };
            })()`,
            returnByValue: true,
          });
          snapshot = evaluated.result.value;
          if (snapshot?.ready === "complete" && snapshot.text?.length >= 40) break;
          await new Promise((resolve) => setTimeout(resolve, 250));
        }
        if (!snapshot?.text || snapshot.text.length < 40) return failure("parse_failed");
        const finalUrl = new URL(snapshot.url);
        if (!allowedHosts.has(finalUrl.hostname.toLocaleLowerCase())) return failure("access_denied");
        const serializedLinks = JSON.stringify(snapshot.links ?? []);
        return {
          ok: true,
          finalUrl: finalUrl.toString(),
          contentType: "text/html; rendered=cdp",
          bytes: Buffer.byteLength(snapshot.text) + Buffer.byteLength(serializedLinks),
          title: snapshot.title,
          text: snapshot.text,
          fingerprint: crypto.createHash("sha256").update(snapshot.text).digest("hex"),
          links: snapshot.links ?? [],
        };
      } catch (error) {
        return failure(error instanceof Error && /timed out/iu.test(error.message) ? "timeout" : "network_error");
      } finally {
        page?.close();
        if (targetId && browser) {
          try { await browser.call("Target.closeTarget", { targetId }); } catch { /* best effort */ }
        }
        browser?.close();
      }
    },
  };
}
