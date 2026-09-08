import assert from "node:assert/strict";
import { constants } from "node:fs";
import { open } from "node:fs/promises";

const HMR_FRAME_BYTES = 16 * 1024;
const outboundEvents = new Set(["client-full-reload", "client-reload-page", "server-component-reload-page", "client-success", "client-error", "client-warning", "client-hmr-latency", "ping"]);

function diagnosticModule(value: unknown): string {
  if (typeof value !== "string" || value.length > HMR_FRAME_BYTES) return "<unrecorded-module>";
  // Keep only a public module-relative name, never its absolute checkout,
  // loader query, URL credentials, source text, or arbitrary error payload.
  const match = /(?:^|[\/!])((?:app|node_modules)\/[A-Za-z0-9_@./-]+\.(?:[cm]?[jt]sx?|css))(?:[?#\s)!]|$)/u.exec(value);
  const path = match?.[1];
  return path !== undefined && path.length <= 512 && !path.split("/").some(part => part === "." || part === "..")
    ? path : "<unrecorded-module>";
}

/** New outbound diagnostics record an allowlisted summary, not raw browser
 * payloads. Headers, query values, source text and arbitrary messages stay out. */
export function nextDevOutboundHmrFrame(payload: string | Uint8Array): string {
  if (Buffer.byteLength(payload) > HMR_FRAME_BYTES) return '{"event":"oversize-frame"}';
  let value: unknown;
  try { value = JSON.parse(typeof payload === "string" ? payload : Buffer.from(payload).toString("utf8")); }
  catch { return '{"event":"non-json-frame"}'; }
  if (typeof value !== "object" || value === null || Array.isArray(value)) return '{"event":"unrecorded-frame"}';
  const record = value as Record<string, unknown>;
  const event = typeof record.event === "string" && outboundEvents.has(record.event) ? record.event : "other-event";
  if (event !== "client-full-reload") return JSON.stringify({ event });
  const stack = typeof record.stackTrace === "string" ? record.stackTrace : "";
  const cause = /Aborted because .+ is not accepted/u.test(stack) ? "unaccepted-module"
    : /Loading (?:CSS )?chunk .+ failed|ChunkLoadError/u.test(stack) ? "chunk-load-failed"
    : /Failed to fetch|NetworkError/u.test(stack) ? "fetch-failed" : stack.length === 0 ? "no-error-stack" : "other-error";
  const dependencyChain = Array.isArray(record.dependencyChain)
    ? record.dependencyChain.slice(0, 16).map(diagnosticModule) : [];
  return JSON.stringify({ event, cause, hadRuntimeError: record.hadRuntimeError === true,
    unacceptedModule: cause === "unaccepted-module" ? diagnosticModule(stack.split("\n", 1)[0]) : null,
    dependencyChain, dependencyChainTruncated: Array.isArray(record.dependencyChain) && record.dependencyChain.length > 16 });
}

export type NextDevRequestFailurePhase = "fetch" | "redirect-abort" | "fulfill" | "dispose" | "browser";
export type NextDevRequestFailure = Readonly<{
  phase: NextDevRequestFailurePhase; method: string; resourceType: string; path: string; hasQuery: boolean; failure: string;
}>;

/** Describe the response branch used by Next's RSC fetch without recording
 * cookie values, router state, query values, bodies, or deployment identities. */
export function nextDevResponseSummary(
  request: Readonly<{ url: string; method: string; resourceType: string; headers: Readonly<Record<string, string>> }>,
  origin: string, response: Readonly<{ status: number; headers: Readonly<Record<string, string>> }>,
) {
  const { method, resourceType, path, hasQuery } = nextDevRequestFailure(request, origin, "browser", null);
  const contentType = response.headers["content-type"]?.split(";", 1)[0]?.trim().toLowerCase();
  return Object.freeze({ method, resourceType, path, hasQuery,
    status: Number.isInteger(response.status) && response.status >= 100 && response.status <= 599 ? response.status : null,
    contentType: contentType !== undefined && ["text/x-component", "text/html", "text/javascript", "application/javascript", "application/json", "text/css"].includes(contentType) ? contentType : "other",
    rsc: request.headers.rsc === "1",
    routerState: Object.hasOwn(request.headers, "next-router-state-tree"),
    hmrRefresh: request.headers["next-hmr-refresh"] === "1",
    deploymentIdentity: Object.hasOwn(response.headers, "x-nextjs-deployment-id"),
  });
}

/** Request diagnostics never read or retain headers, bodies, query values,
 * credentials or an arbitrary exception message. */
export function nextDevRequestFailure(
  request: Readonly<{ url: string; method: string; resourceType: string }>, origin: string,
  phase: NextDevRequestFailurePhase, error: unknown,
): NextDevRequestFailure {
  let path = "<unrecorded-url>", hasQuery = false;
  try {
    if (request.url.length > HMR_FRAME_BYTES) throw new Error("Oversize diagnostic URL");
    const url = new URL(request.url);
    hasQuery = url.search !== "";
    if (url.origin === origin && url.username === "" && url.password === "") {
      if (["/", "/unvisited", "/favicon.ico", "/icon.svg"].includes(url.pathname)
        || /^\/_next\/(?:static|webpack-hmr)(?:\/[A-Za-z0-9_.\/-]+)?$/u.test(url.pathname) && url.pathname.length <= 512) path = url.pathname;
    }
  } catch { /* A malformed URL is diagnostic data, never a new failure. */ }
  const message = (error instanceof Error ? error.message : typeof error === "string" ? error : "").slice(0, HMR_FRAME_BYTES);
  const native = /^net::ERR_[A-Z_]+$/u.test(message) ? message : null;
  const failure = native ?? (/timeout|timed out/iu.test(message) ? "timeout"
    : /closed|disposed/iu.test(message) ? "target-closed"
    : /ECONNREFUSED/iu.test(message) ? "connection-refused"
    : /ECONNRESET/iu.test(message) ? "connection-reset"
    : /aborted|cancelled|canceled/iu.test(message) ? "aborted" : "other-error");
  return Object.freeze({ phase,
    method: ["GET", "HEAD", "POST", "PUT", "DELETE", "OPTIONS", "PATCH"].includes(request.method) ? request.method : "other",
    resourceType: ["document", "stylesheet", "image", "media", "font", "script", "texttrack", "xhr", "fetch", "eventsource", "websocket", "manifest", "other"].includes(request.resourceType) ? request.resourceType : "other",
    path, hasQuery, failure });
}

/** Drain every byte, retain a nonoverlapping head/tail, and report once. */
export function createNextDevDiagnostics(limit = 8 * 1024) {
  assert.ok(Number.isSafeInteger(limit) && limit >= 2 && limit <= 64 * 1024);
  const headLimit = Math.ceil(limit / 2);
  const tailLimit = Math.floor(limit / 2);
  let head = Buffer.alloc(0);
  let tail = Buffer.alloc(0);
  let total = 0n;
  let reported = false;
  return {
    append(chunk: Buffer): void {
      total += BigInt(chunk.byteLength);
      const prefix = Math.min(headLimit - head.byteLength, chunk.byteLength);
      if (prefix > 0) head = Buffer.concat([head, chunk.subarray(0, prefix)]);
      if (prefix < chunk.byteLength) tail = Buffer.concat([tail, chunk.subarray(Math.max(prefix, chunk.byteLength - tailLimit))]).subarray(-tailLimit);
    },
    take(): string {
      if (reported) return "";
      reported = true;
      const omitted = total - BigInt(head.byteLength + tail.byteLength);
      return head.toString("utf8")
        + (omitted === 0n ? "" : `\n[${String(omitted)} diagnostic bytes omitted; first/last bytes retained]\n`)
        + tail.toString("utf8");
    },
    get retainedBytes(): number { return head.byteLength + tail.byteLength; },
  };
}

const LOG_READ_BYTES = 16 * 1024;

/** Only complete pinned Next NDJSON server errors are startup-failure evidence. */
export function nextStartupServerError(line: string): string | null {
  if (Buffer.byteLength(line) > LOG_READ_BYTES) return null;
  let value: unknown;
  try { value = JSON.parse(line); } catch { return null; }
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (record.source !== "Server" || record.level !== "ERROR"
    || typeof record.timestamp !== "string" || !/^\d{2}:\d{2}:\d{2}\.\d{3}$/u.test(record.timestamp)
    || typeof record.message !== "string" || record.message.length === 0) return null;
  return record.message.length > 1024 ? `${record.message.slice(0, 1024)} [truncated]` : record.message;
}

/** Used only before first readiness, never during expected HMR-error probes. */
export function createNextStartupErrorReader(path: string) {
  let offset = 0;
  let pending = Buffer.alloc(0);
  let droppingOversizeLine = false;
  return async (): Promise<string | null> => {
    let handle;
    try { handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW); }
    catch (error) {
      if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") return null;
      throw error;
    }
    try {
      const info = await handle.stat();
      assert.ok(info.isFile() && info.nlink === 1, "Next startup log must remain an ordinary single-link file");
      assert.ok(info.size >= offset, "Next startup log was truncated before readiness");
      const bytes = Buffer.alloc(LOG_READ_BYTES);
      const { bytesRead } = await handle.read(bytes, 0, bytes.length, offset);
      offset += bytesRead;
      const input = Buffer.concat([pending, bytes.subarray(0, bytesRead)]);
      let start = 0;
      for (let end = input.indexOf(10); end >= 0; end = input.indexOf(10, start)) {
        const line = input.subarray(start, end);
        start = end + 1;
        if (droppingOversizeLine) { droppingOversizeLine = false; continue; }
        const error = nextStartupServerError(line.toString("utf8"));
        if (error !== null) return error;
      }
      pending = input.subarray(start);
      if (pending.length > LOG_READ_BYTES) { pending = Buffer.alloc(0); droppingOversizeLine = true; }
      return null;
    } finally { await handle.close(); }
  };
}
