import assert from "node:assert/strict";

/** Retain exact first/last bytes while continuing to drain the entire pipe. */
export function createBoundedDiagnostics(limit = 512 * 1024) {
  assert.ok(Number.isSafeInteger(limit) && limit >= 2 && limit <= 1024 * 1024);
  const head = Buffer.alloc(Math.ceil(limit / 2));
  const tail = Buffer.alloc(Math.floor(limit / 2));
  let headLength = 0;
  let tailLength = 0;
  let cursor = 0;
  let omitted = 0n;
  return {
    append(bytes: Buffer): void {
      const prefix = Math.min(head.length - headLength, bytes.length);
      bytes.copy(head, headLength, 0, prefix);
      headLength += prefix;
      const remaining = bytes.length - prefix;
      omitted += BigInt(Math.max(0, tailLength + remaining - tail.length));
      if (remaining >= tail.length) {
        bytes.copy(tail, 0, bytes.length - tail.length);
        tailLength = tail.length;
        cursor = 0;
      } else if (remaining > 0) {
        const first = Math.min(remaining, tail.length - cursor);
        bytes.copy(tail, cursor, prefix, prefix + first);
        bytes.copy(tail, 0, prefix + first);
        cursor = (cursor + remaining) % tail.length;
        tailLength = Math.min(tail.length, tailLength + remaining);
      }
    },
    render(stream: "stdout" | "stderr"): Buffer {
      const retainedTail = tailLength < tail.length
        ? tail.subarray(0, tailLength)
        : Buffer.concat([tail.subarray(cursor), tail.subarray(0, cursor)]);
      const notice = omitted === 0n ? Buffer.alloc(0)
        : Buffer.from(`\n[${stream}: ${String(omitted)} bytes omitted; first and last diagnostics retained]\n`);
      return Buffer.concat([head.subarray(0, headLength), notice, retainedTail]);
    },
    get retainedBytes(): number { return headLength + tailLength; },
  };
}
