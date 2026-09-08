import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { constants, type Stats } from "node:fs";
import { link, lstat, mkdtemp, open, realpath, unlink } from "node:fs/promises";
import { join, relative } from "node:path";

const MAX_LOG_BYTES = 64 * 1024 * 1024;
export const STABLE_NEXT_DEV_REJECTION = "Next development cannot hot-update stable StyleX defineVars/createTheme declarations; restart next dev";
const sha256 = (bytes: string | Uint8Array): string => createHash("sha256").update(bytes).digest("hex");

export async function syncNextEvidenceDirectory(path: string): Promise<void> {
  assert.equal(await realpath(path), path);
  const directory = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try { assert((await directory.stat()).isDirectory()); await directory.sync(); }
  finally { await directory.close(); }
}

async function writeDurableIdentity(path: string, value: unknown): Promise<void> {
  const file = await open(path, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, 0o600);
  try { await file.writeFile(JSON.stringify(value, null, 2) + "\n"); await file.sync(); }
  finally { await file.close(); }
}

export function stableRejectionProof(origin: string, url: string, status: number, body: string) {
  const base = new URL(origin);
  assert(base.protocol === "http:" && base.hostname === "127.0.0.1" && base.origin === origin);
  const response = new URL(url);
  assert(Buffer.byteLength(body) <= 8 * 1024 * 1024, "Stable rejection body exceeds its bound");
  if (response.origin !== origin || response.href !== url || response.username !== "" || response.password !== "" || response.hash !== ""
    || status !== 500 || !body.includes(STABLE_NEXT_DEV_REJECTION)) return null;
  return { url, status: 500 as const, bodySha256: sha256(body), bodyBytes: Buffer.byteLength(body), error: STABLE_NEXT_DEV_REJECTION };
}

export type StableRejectionProof = NonNullable<ReturnType<typeof stableRejectionProof>>;
export type RestartDiagnostic = Readonly<{ kind: "console" | "pageerror"; text: string; url: string }>;

/** Expected failures are authorized only by an observed exact rejection response. */
export function expectedStableRestartDiagnostic(
  phase: "rejection" | "healthy", diagnostic: RestartDiagnostic, proofs: readonly StableRejectionProof[],
): boolean {
  if (phase !== "rejection" || proofs.length === 0) return false;
  if (diagnostic.text.includes(STABLE_NEXT_DEV_REJECTION)) return true;
  return diagnostic.kind === "console"
    && /^Failed to load resource: the server responded with a status of 500 \([^\r\n]*\)$/u.test(diagnostic.text)
    && proofs.some((proof) => proof.url === diagnostic.url && proof.status === 500 && proof.error === STABLE_NEXT_DEV_REJECTION);
}

export function validateNextDevelopmentLog(bytes: Uint8Array): number {
  assert(bytes.byteLength <= MAX_LOG_BYTES, "Retained Next development log exceeds its byte bound");
  const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  assert(text === "" || text.endsWith("\n"), "Stopped Next log must contain complete NDJSON records");
  const lines = text === "" ? [] : text.slice(0, -1).split("\n");
  assert(lines.length <= 100_000, "Retained Next development log exceeds its record bound");
  for (const line of lines) {
    assert(Buffer.byteLength(line) <= 1024 * 1024, "Retained Next log record exceeds its byte bound");
    const record: unknown = JSON.parse(line);
    assert(typeof record === "object" && record !== null && !Array.isArray(record));
    const entry = record as Record<string, unknown>;
    assert.deepEqual(Object.keys(entry).sort(), ["level", "message", "source", "timestamp"]);
    assert(typeof entry.timestamp === "string" && /^\d{2}:\d{2}:\d{2}\.\d{3}$/u.test(entry.timestamp));
    assert(entry.source === "Server" || entry.source === "Browser");
    assert(typeof entry.level === "string" && /^(?:LOG|INFO|WARN|ERROR|DEBUG|TRACE)$/u.test(entry.level));
    assert(typeof entry.message === "string");
  }
  return lines.length;
}

function identity(info: Stats) {
  return { dev: info.dev, ino: info.ino, size: info.size, mode: info.mode, uid: info.uid, gid: info.gid, mtimeMs: info.mtimeMs };
}

function ordinary(info: Stats, links: number): void {
  assert(info.isFile() && info.nlink === links && (info.mode & 0o7000) === 0, "Next log must remain an ordinary file with the expected link count");
  assert(info.size >= 0 && info.size <= MAX_LOG_BYTES);
}

/** Called only after the exact owned process group and listener have stopped. */
export async function retainStoppedNextLog(consumer: string, evidenceRoot: string, assertStopped: () => void) {
  assertStopped();
  assert.equal(await realpath(consumer), consumer);
  assert.equal(await realpath(evidenceRoot), evidenceRoot);
  assert((await lstat(consumer)).isDirectory() && (await lstat(evidenceRoot)).isDirectory());
  let directory = consumer;
  for (const part of [".next", "dev", "logs"]) {
    directory = join(directory, part);
    try { assert((await lstat(directory)).isDirectory()); }
    catch (error) {
      if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") return { kind: "absent" as const };
      throw error;
    }
    assert.equal(await realpath(directory), directory, "Next log parent must not traverse a symlink");
  }
  const source = join(directory, "next-development.log");
  let before: Stats;
  try { before = await lstat(source); }
  catch (error) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") return { kind: "absent" as const };
    throw error;
  }
  ordinary(before, 1);
  const handle = await open(source, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    assert.deepEqual(identity(await handle.stat()), identity(before));
    const bytes = await handle.readFile();
    const records = validateNextDevelopmentLog(bytes);
    assert.deepEqual(identity(await handle.stat()), identity(before), "Stopped Next log changed while hashing");
    const retainedDirectory = await mkdtemp(join(evidenceRoot, "restart-"));
    assert.equal(await realpath(retainedDirectory), retainedDirectory);
    const destination = join(retainedDirectory, "next-development.log");
    assertStopped();
    assert.equal(await realpath(source), source);
    ordinary(await lstat(source), 1);
    assert.deepEqual(identity(await lstat(source)), identity(before));
    // link() is no-replace, unlike POSIX rename(). Recheck both identities before
    // unlinking only the original name; an interrupted move retains both copies.
    await link(source, destination);
    ordinary(await lstat(destination), 2);
    assert.deepEqual(identity(await lstat(destination)), identity(before));
    await handle.sync();
    await writeDurableIdentity(join(retainedDirectory, "retention.json"), {
      state: "retained-before-source-removal", source: relative(consumer, source),
      retained: relative(evidenceRoot, destination), sha256: sha256(bytes), records, ...identity(before),
    });
    await syncNextEvidenceDirectory(retainedDirectory);
    await syncNextEvidenceDirectory(evidenceRoot);
    assertStopped();
    ordinary(await lstat(source), 2);
    assert.deepEqual(identity(await lstat(source)), identity(before));
    await unlink(source);
    await syncNextEvidenceDirectory(directory);
    const after = await lstat(destination);
    ordinary(after, 1);
    assert.deepEqual(identity(after), identity(before));
    const retained = await open(destination, constants.O_RDONLY | constants.O_NOFOLLOW);
    try { assert.equal(sha256(await retained.readFile()), sha256(bytes), "Retained log bytes changed during rotation"); }
    finally { await retained.close(); }
    const receipt = { kind: "retained" as const, source: relative(consumer, source), retained: relative(evidenceRoot, destination),
      sha256: sha256(bytes), records, ...identity(before), linksBefore: 1, linksAfter: 1 };
    await writeDurableIdentity(join(retainedDirectory, "identity.json"), receipt);
    await syncNextEvidenceDirectory(retainedDirectory);
    return receipt;
  } finally { await handle.close(); }
}
