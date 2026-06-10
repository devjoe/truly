/**
 * Per-context console ring buffer for debug snapshots.
 *
 * Wraps `console.log/info/warn/error` once per context (CS, SW, sidepanel).
 * The originals still fire (DevTools sees everything as before); we just
 * also retain the last N records in memory so the sidepanel's "📦 匯出狀態"
 * button can ship them to disk for offline inspection.
 *
 * The buffer captures `args` lossily — `String()` on each arg, joined with
 * spaces. Objects are JSON-serialised when possible. Cyclic / non-serialisable
 * values fall back to `String(v)`. We accept the loss because the alternative
 * (structured-clone every console call) would burn cycles in hot paths
 * (every CS classification logs ~3 lines).
 *
 * Idempotent within a module lifetime: calling installLogBuffer() twice
 * is a no-op (guards against accidental double-init from a re-init path).
 * MV3 SW wakeups reload the module entirely, so a fresh wrap is correct
 * there.
 */

export interface LogEntry {
  ts: number;
  level: "log" | "info" | "warn" | "error";
  text: string;
}

const BUFFER_SIZE = 500;

let buffer: LogEntry[] = [];
let installed = false;

function formatArg(v: unknown): string {
  if (typeof v === "string") return v;
  if (v instanceof Error) return v.stack || `${v.name}: ${v.message}`;
  if (typeof v === "object" && v !== null) {
    try {
      return JSON.stringify(v);
    } catch {
      return String(v);
    }
  }
  return String(v);
}

function record(level: LogEntry["level"], args: unknown[]): void {
  const text = args.map(formatArg).join(" ");
  buffer.push({ ts: Date.now(), level, text });
  if (buffer.length > BUFFER_SIZE) {
    buffer.splice(0, buffer.length - BUFFER_SIZE);
  }
}

export function installLogBuffer(): void {
  if (installed) return;
  installed = true;

  const orig = {
    log: console.log.bind(console),
    info: console.info.bind(console),
    warn: console.warn.bind(console),
    error: console.error.bind(console),
  };

  console.log = (...args: unknown[]) => {
    record("log", args);
    orig.log(...args);
  };
  console.info = (...args: unknown[]) => {
    record("info", args);
    orig.info(...args);
  };
  console.warn = (...args: unknown[]) => {
    record("warn", args);
    orig.warn(...args);
  };
  console.error = (...args: unknown[]) => {
    record("error", args);
    orig.error(...args);
  };
}

export function snapshotLogBuffer(): LogEntry[] {
  return buffer.slice();
}

export function clearLogBuffer(): void {
  buffer = [];
}
