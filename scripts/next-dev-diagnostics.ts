import assert from "node:assert/strict";
import { constants } from "node:fs";
import { open } from "node:fs/promises";

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
