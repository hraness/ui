import assert from "node:assert/strict";
import { constants, type BigIntStats } from "node:fs";
import { lstat, mkdir, open, readdir, realpath, chmod } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { canonicalJson, normalizeLogicalPath, sha256 } from "./compiler.js";
import { consumeStylexNextExportCollection, type StylexNextExportCollection } from "./next-process.js";

const MAX_FILES = 100_000;
const MAX_DIRECTORIES = 100_000;
const MAX_FILE_BYTES = 128 * 1024 * 1024;
const MAX_TOTAL_BYTES = 4 * 1024 * 1024 * 1024;
const CAPTURE_MILLISECONDS = 120_000;

type FileRecord = Readonly<{ path: string; bytes: number; sha256: string; mode: number }>;
type DirectoryRecord = Readonly<{ path: string; mode: number }>;
type Identity = Readonly<{ device: bigint; inode: bigint; mode: bigint; size: bigint; modified: bigint; changed: bigint }>;
type Snapshot = Readonly<{
  directories: readonly (DirectoryRecord & { identity: Identity })[];
  files: readonly (FileRecord & { identity: Identity })[];
}>;

/** Canonical bytes contain logical origins and content/mode identities, never
 * host inodes or a claim that the copied files retain their source inodes. */
export type StylexNextExportRetentionV1 = Readonly<{
  kind: "hraness-next-export-retention";
  schemaVersion: 1;
  attemptId: string;
  planSha256: string;
  mode: "discovery";
  nativeDirectory: ".next";
  retainedDirectory: string;
  directories: readonly DirectoryRecord[];
  files: readonly FileRecord[];
}>;

function identity(stat: BigIntStats): Identity {
  return { device: stat.dev, inode: stat.ino, mode: stat.mode, size: stat.size, modified: stat.mtimeNs, changed: stat.ctimeNs };
}

function ordinaryMode(stat: BigIntStats): number {
  assert.equal(Number(stat.mode & 0o7000n), 0, "Next output has unsupported special permission bits");
  return Number(stat.mode & 0o777n);
}

async function directory(path: string): Promise<BigIntStats> {
  const stat = await lstat(path, { bigint: true });
  assert.ok(stat.isDirectory() && !stat.isSymbolicLink(), "Next retention directory must be ordinary");
  assert.equal(await realpath(path), resolve(path), "Next retention directory must not traverse a symlink");
  return stat;
}

async function readOrdinary(path: string): Promise<Readonly<{ source: Buffer; stat: BigIntStats }>> {
  const before = await lstat(path, { bigint: true });
  assert.ok(before.isFile() && !before.isSymbolicLink(), "Next retained input must be an ordinary file");
  assert.equal(before.nlink, 1n, "Next retained input must not share a hard-link identity");
  assert.ok(before.size >= 0n && before.size <= BigInt(MAX_FILE_BYTES), "Next retained input exceeds its byte bound");
  assert.equal(await realpath(path), resolve(path), "Next retained input must not traverse a symlink");
  // A nonordinary replacement between lstat and open must never block open
  // before the capture deadline can be observed again.
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  let failure: unknown;
  try {
    const opened = await handle.stat({ bigint: true });
    assert.ok(opened.isFile(), "Next opened retained input must be an ordinary file");
    assert.deepEqual(identity(opened), identity(before));
    const source = Buffer.alloc(Number(before.size));
    let offset = 0;
    while (offset < source.byteLength) {
      const result = await handle.read(source, offset, source.byteLength - offset, offset);
      assert.ok(result.bytesRead > 0, "Next retained input shrank during reading");
      offset += result.bytesRead;
    }
    assert.equal((await handle.read(Buffer.alloc(1), 0, 1, offset)).bytesRead, 0, "Next retained input grew during reading");
    assert.deepEqual(identity(await handle.stat({ bigint: true })), identity(before));
    assert.deepEqual(identity(await lstat(path, { bigint: true })), identity(before));
    return { source, stat: before };
  } catch (error) { failure = error; throw error; }
  finally {
    try { await handle.close(); }
    catch (error) { throw failure === undefined ? error : new AggregateError([failure, error], "Next input read and close failed"); }
  }
}

function sortPaths<T extends { path: string }>(items: T[]): T[] {
  return items.sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0);
}

async function snapshot(root: string, check: () => void): Promise<Snapshot> {
  const directories: (DirectoryRecord & { identity: Identity })[] = [];
  const files: (FileRecord & { identity: Identity })[] = [];
  let total = 0;
  const device = (await directory(root)).dev;
  const pending = ["."];
  while (pending.length > 0) {
    check();
    const path = pending.pop()!;
    const physical = path === "." ? root : join(root, path);
    const before = await directory(physical);
    assert.equal(before.dev, device, "Next output crosses a filesystem boundary");
    directories.push({ path, mode: ordinaryMode(before), identity: identity(before) });
    assert.ok(directories.length <= MAX_DIRECTORIES, "Next retention directory census exceeds its bound");
    const entries = await readdir(physical, { withFileTypes: true });
    assert.ok(entries.length <= MAX_FILES + MAX_DIRECTORIES, "Next retention directory exceeds its entry bound");
    for (const entry of entries) {
      check();
      const logical = normalizeLogicalPath(path === "." ? entry.name : `${path}/${entry.name}`, "Next retained path");
      assert.ok(!entry.isSymbolicLink(), "Next output contains a symbolic link");
      if (entry.isDirectory()) {
        pending.push(logical);
        assert.ok(pending.length + directories.length <= MAX_DIRECTORIES, "Next retention pending directory census exceeds its bound");
        continue;
      }
      assert.ok(entry.isFile(), "Next output contains a nonordinary entry");
      const { source, stat } = await readOrdinary(join(root, logical));
      assert.equal(stat.dev, device, "Next output file crosses a filesystem boundary");
      total += source.byteLength;
      assert.ok(total <= MAX_TOTAL_BYTES, "Next retention exceeds its total byte bound");
      files.push({ path: logical, bytes: source.byteLength, sha256: sha256(source), mode: ordinaryMode(stat), identity: identity(stat) });
      assert.ok(files.length <= MAX_FILES, "Next retention file census exceeds its bound");
    }
    assert.deepEqual(identity(await directory(physical)), identity(before), "Next directory changed during its census");
  }
  return { directories: sortPaths(directories), files: sortPaths(files) };
}

function records(value: Snapshot): Pick<StylexNextExportRetentionV1, "directories" | "files"> {
  return {
    directories: value.directories.map(({ path, mode }) => ({ path, mode })),
    files: value.files.map(({ path, bytes, sha256, mode }) => ({ path, bytes, sha256, mode })),
  };
}

function object(value: unknown): Record<string, unknown> {
  assert.ok(value !== null && typeof value === "object" && !Array.isArray(value), "Next retention record must be an object");
  assert.ok(Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
  return value as Record<string, unknown>;
}

function mode(value: unknown): number {
  assert.ok(typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && value <= 0o777, "Next retained mode is invalid");
  return value;
}

export function validateStylexNextExportRetention(value: unknown): StylexNextExportRetentionV1 {
  const item = object(value);
  assert.deepEqual(Object.keys(item).sort(), ["attemptId", "directories", "files", "kind", "mode", "nativeDirectory", "planSha256", "retainedDirectory", "schemaVersion"]);
  assert.equal(item.kind, "hraness-next-export-retention");
  assert.equal(item.schemaVersion, 1);
  assert.equal(item.mode, "discovery");
  assert.equal(item.nativeDirectory, ".next");
  assert.ok(typeof item.attemptId === "string" && /^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(item.attemptId));
  assert.ok(typeof item.planSha256 === "string" && /^[a-f0-9]{64}$/u.test(item.planSha256));
  const retainedDirectory = normalizeLogicalPath(item.retainedDirectory, "Next retained directory");
  assert.ok(retainedDirectory.endsWith(`/${item.attemptId}/next-discovery`), "Next retention escaped its attempt");
  assert.ok(!retainedDirectory.startsWith(".next/"), "Next retention overlaps its native origin");
  assert.ok(Array.isArray(item.directories) && item.directories.length > 0 && item.directories.length <= MAX_DIRECTORIES);
  const directories = item.directories.map((value: unknown) => {
    const entry = object(value);
    assert.deepEqual(Object.keys(entry).sort(), ["mode", "path"]);
    return { path: entry.path === "." ? "." : normalizeLogicalPath(entry.path, "Next retained directory entry"), mode: mode(entry.mode) };
  });
  assert.equal(directories[0]?.path, ".");
  assert.deepEqual(directories.map(({ path }) => path), [...new Set(directories.map(({ path }) => path))].sort());
  const parents = new Set(directories.map(({ path }) => path));
  for (const entry of directories) if (entry.path !== ".") assert.ok(parents.has(dirname(entry.path)), "Next retained directory has no parent");
  assert.ok(Array.isArray(item.files) && item.files.length > 0 && item.files.length <= MAX_FILES, "Next retention must contain a bounded complete file census");
  let total = 0;
  const files = item.files.map((value: unknown) => {
    const entry = object(value);
    assert.deepEqual(Object.keys(entry).sort(), ["bytes", "mode", "path", "sha256"]);
    const path = normalizeLogicalPath(entry.path, "Next retained file");
    assert.ok(parents.has(dirname(path)) && !parents.has(path), "Next retained file has invalid directory ownership");
    assert.ok(typeof entry.bytes === "number" && Number.isSafeInteger(entry.bytes) && entry.bytes >= 0 && entry.bytes <= MAX_FILE_BYTES);
    assert.ok(typeof entry.sha256 === "string" && /^[a-f0-9]{64}$/u.test(entry.sha256));
    total += entry.bytes;
    return { path, bytes: entry.bytes, sha256: entry.sha256, mode: mode(entry.mode) };
  });
  assert.ok(total <= MAX_TOTAL_BYTES);
  assert.deepEqual(files.map(({ path }) => path), [...new Set(files.map(({ path }) => path))].sort());
  return { kind: "hraness-next-export-retention", schemaVersion: 1, attemptId: item.attemptId, planSha256: item.planSha256,
    mode: "discovery", nativeDirectory: ".next", retainedDirectory, directories, files };
}

/** Copy evidence only after genuine child collection. No rename, replacement,
 * link, source deletion, or recovery of an existing/partial archive is allowed.
 * The caller must still validate the native graph and export before acceptance. */
export async function retainStylexNextExportDiscovery(options: Readonly<{
  root: string;
  stateDirectory: string;
  attemptId: string;
  planSha256: string;
  collection: StylexNextExportCollection;
  signal?: AbortSignal;
}>): Promise<StylexNextExportRetentionV1> {
  const root = resolve(options.root);
  assert.equal(root, options.root);
  const state = normalizeLogicalPath(options.stateDirectory, "Next retention state directory");
  assert.ok(state !== ".next" && !state.startsWith(".next/"));
  assert.match(options.attemptId, /^[a-z0-9]+(?:-[a-z0-9]+)*$/u);
  assert.match(options.planSha256, /^[a-f0-9]{64}$/u);
  consumeStylexNextExportCollection(options.collection, { root, attemptId: options.attemptId, planSha256: options.planSha256 });
  const deadline = Date.now() + CAPTURE_MILLISECONDS;
  const check = (): void => {
    assert.notEqual(options.signal?.aborted, true, "Next retention was cancelled");
    assert.ok(Date.now() < deadline, "Next retention exceeded its bounded capture deadline");
  };
  check();
  const native = join(root, ".next");
  const parent = join(root, state, options.attemptId);
  const parentBefore = await directory(parent);
  const retainedDirectory = `${state}/${options.attemptId}/next-discovery`;
  const retained = join(root, retainedDirectory);
  const before = await snapshot(native, check);
  assert.ok(before.files.length > 0, "Next retention refuses an empty native output");
  assert.equal(before.directories[0]!.identity.device, parentBefore.dev, "Next retention must remain on the native filesystem");
  // mkdir is exclusive. A partial archive deliberately remains after failure.
  await mkdir(retained, { mode: 0o700 });
  const createdRoot = await directory(retained);
  assert.equal(createdRoot.dev, parentBefore.dev);
  const createdDirectories = new Map<string, Identity>([[".", identity(createdRoot)]]);
  for (const entry of before.directories.filter(({ path }) => path !== ".")) {
    check();
    await mkdir(join(retained, entry.path), { mode: 0o700 });
    createdDirectories.set(entry.path, identity(await directory(join(retained, entry.path))));
  }
  for (const file of before.files) {
    check();
    const copied = await readOrdinary(join(native, file.path));
    assert.deepEqual(identity(copied.stat), file.identity, "Next source identity changed before copying");
    assert.equal(sha256(copied.source), file.sha256, "Next source bytes changed before copying");
    const destination = join(retained, file.path);
    const parentPath = dirname(file.path);
    const parentNow = await directory(dirname(destination));
    const parentIdentity = createdDirectories.get(parentPath)!;
    assert.equal(parentNow.dev, parentIdentity.device);
    assert.equal(parentNow.ino, parentIdentity.inode, "Next archive parent identity changed");
    const handle = await open(destination, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, file.mode);
    let failure: unknown;
    try {
      await handle.writeFile(copied.source);
      await handle.chmod(file.mode);
      await handle.sync();
      const created = await handle.stat({ bigint: true });
      assert.equal(created.nlink, 1n);
      assert.equal(created.dev, file.identity.device);
      assert.notEqual(created.ino, file.identity.inode, "Next archive must have its own file identity");
      assert.deepEqual(identity(await lstat(destination, { bigint: true })), identity(created));
    } catch (error) { failure = error; throw error; }
    finally {
      try { await handle.close(); }
      catch (error) { throw failure === undefined ? error : new AggregateError([failure, error], "Next archive copy and close failed"); }
    }
  }
  for (const entry of [...before.directories].reverse()) {
    const path = entry.path === "." ? retained : join(retained, entry.path);
    const current = await directory(path);
    const created = createdDirectories.get(entry.path)!;
    assert.equal(current.dev, created.device);
    assert.equal(current.ino, created.inode, "Next archive directory was replaced");
    await chmod(path, entry.mode);
  }
  check();
  assert.deepEqual(await snapshot(native, check), before, "Next native tree changed while retaining evidence");
  const copied = await snapshot(retained, check);
  assert.deepEqual(records(copied), records(before), "Next retained tree differs from its complete native source");
  const parentAfter = await directory(parent);
  assert.equal(parentAfter.dev, parentBefore.dev);
  assert.equal(parentAfter.ino, parentBefore.ino);
  check();
  return validateStylexNextExportRetention({ kind: "hraness-next-export-retention", schemaVersion: 1,
    attemptId: options.attemptId, planSha256: options.planSha256, mode: "discovery", nativeDirectory: ".next", retainedDirectory, ...records(copied) });
}

/** Completion re-reads this physical archive. The native origin may now hold
 * delivery's independent output; it is never substituted for this evidence. */
export async function verifyStylexNextExportRetention(options: Readonly<{
  root: string; stateDirectory: string; attemptId: string; planSha256: string;
}>, value: unknown): Promise<StylexNextExportRetentionV1> {
  const receipt = validateStylexNextExportRetention(value);
  const { root } = options;
  assert.equal(receipt.attemptId, options.attemptId, "Next retention belongs to another attempt");
  assert.equal(receipt.planSha256, options.planSha256, "Next retention belongs to another plan");
  const state = normalizeLogicalPath(options.stateDirectory, "Next retention verification state");
  assert.equal(receipt.retainedDirectory, `${state}/${options.attemptId}/next-discovery`, "Next retention storage differs from its plan");
  assert.equal(await realpath(root), resolve(root));
  const deadline = Date.now() + CAPTURE_MILLISECONDS;
  const actual = records(await snapshot(join(root, receipt.retainedDirectory), () => assert.ok(Date.now() < deadline, "Next archive verification exceeded its deadline")));
  assert.equal(canonicalJson(actual), canonicalJson({ directories: receipt.directories, files: receipt.files }), "Next retained output changed after capture");
  return receipt;
}
