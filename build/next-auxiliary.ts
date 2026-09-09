import assert from "node:assert/strict";
import { constants } from "node:fs";
import { lstat, open, realpath } from "node:fs/promises";
import { dirname, isAbsolute, resolve, win32 } from "node:path";

import type { StylexArtifactV1 } from "./contracts.js";
import { normalizeLogicalPath, sha256 } from "./compiler.js";
import {
  STYLEX_NEXT_AUXILIARY_TRACE_CREATOR,
  STYLEX_NEXT_PROXY_RENAME_CREATOR,
  validateStylexNextAuxiliaryTraceAsset,
  validateStylexNextAuxiliaryTraceSnapshot,
  validateStylexNextGraphReceipt,
  type StylexNextAuxiliaryTraceAssetV1,
  type StylexNextAuxiliaryTraceSnapshotV1,
  type StylexNextGraphReceiptV1,
  type StylexNextProxyRenameV1,
} from "./next-contracts.js";

const MAX_BYTES = 16 * 1024 * 1024;
const MAX_FILES = 100_000;
const MAX_PATH_LENGTH = 4096;

function sourceBytes(value: string | Uint8Array): Buffer {
  assert.ok(typeof value === "string" || value instanceof Uint8Array, "Next auxiliary trace source must be text or bytes");
  const size = typeof value === "string" ? Buffer.byteLength(value, "utf8") : value.byteLength;
  assert.ok(size <= MAX_BYTES, "Next auxiliary trace source exceeds its byte bound");
  const bytes = typeof value === "string" ? Buffer.from(value, "utf8") : Buffer.from(value);
  assert.ok(Buffer.from(bytes.toString("utf8"), "utf8").equals(bytes), "Next auxiliary trace source must be valid UTF-8");
  return bytes;
}

/** Check metadata syntax only. Referenced filenames are never resolved or read. */
export function validateStylexNextAuxiliaryTraceSource(value: string | Uint8Array): void {
  const source = sourceBytes(value).toString("utf8");
  const parsed: unknown = JSON.parse(source);
  assert.ok(parsed !== null && typeof parsed === "object" && !Array.isArray(parsed), "Next auxiliary trace must contain an object");
  const record = parsed as Record<string, unknown>;
  assert.deepEqual(Object.keys(record).sort(), ["files", "version"], "Next auxiliary trace contains unknown or missing fields");
  assert.equal(record.version, 1, "Next auxiliary trace version is unsupported");
  assert.ok(Array.isArray(record.files) && record.files.length <= MAX_FILES, "Next auxiliary trace file list exceeds its bound or is invalid");
  for (const value of record.files) {
    assert.ok(typeof value === "string" && value.length > 0 && value.length <= MAX_PATH_LENGTH && !/[\u0000-\u001f\u007f]/u.test(value), "Next auxiliary trace filenames must be bounded relative strings without controls");
    assert.ok(!isAbsolute(value) && !win32.isAbsolute(value) && !/^[A-Za-z][A-Za-z0-9+.-]*:/u.test(value) && !value.includes("\\"), "Next auxiliary trace filenames must be relative paths");
  }
  // Both pinned native writers use JSON.stringify. Keep their array order,
  // including unsorted includes, while rejecting duplicate keys or extra text.
  assert.equal(source, JSON.stringify(parsed), "Next auxiliary trace JSON differs from the native compact format");
}

async function readOrdinary(root: string, logical: string, role: "installed-creator" | "generated-output"): Promise<Readonly<{ artifact: StylexArtifactV1; bytes: Buffer }>> {
  assert.ok(isAbsolute(root) && resolve(root) === root, "Next auxiliary trace root must be an absolute normalized path");
  assert.equal(await realpath(root), root, "Next auxiliary trace root traverses a symlink");
  assert.ok((await lstat(root)).isDirectory(), "Next auxiliary trace root must be a directory");
  const path = normalizeLogicalPath(logical, "Next auxiliary trace artifact path");
  const creator = [STYLEX_NEXT_AUXILIARY_TRACE_CREATOR, STYLEX_NEXT_PROXY_RENAME_CREATOR]
    .find(([logical]) => path === `node_modules/next/${logical}`);
  if (role === "installed-creator") {
    assert.ok(creator !== undefined, "Next auxiliary trace installed creator path differs from its pinned owner");
  }
  const absolute = resolve(root, ...path.split("/"));
  assert.equal(await realpath(absolute), absolute, "Next auxiliary trace artifact traverses a symlink");
  const beforeOpen = await lstat(absolute);
  const regular = (stat: typeof beforeOpen) => {
    // Linux package installations may hardlink immutable installed bytes. Only
    // this exact hash-pinned creator has that policy; generated outputs do not.
    const validLinks = role === "installed-creator" ? Number.isSafeInteger(stat.nlink) && stat.nlink >= 1 : stat.nlink === 1;
    assert.ok(stat.isFile() && validLinks && stat.size <= MAX_BYTES, role === "installed-creator"
      ? "Next auxiliary trace installed creator must be a bounded ordinary file"
      : "Next auxiliary trace artifact must be a bounded ordinary single-link file");
  };
  const identity = (stat: typeof beforeOpen) => [stat.dev, stat.ino, stat.mode, stat.nlink, stat.size, stat.mtimeMs, stat.ctimeMs];
  regular(beforeOpen);
  // NONBLOCK prevents a concurrently substituted FIFO from blocking open.
  const handle = await open(absolute, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const before = await handle.stat();
    regular(before);
    assert.deepEqual(identity(before), identity(beforeOpen), "Next auxiliary trace artifact changed before open");
    const buffer = Buffer.alloc(before.size + 1);
    let length = 0;
    while (length < buffer.length) {
      const { bytesRead } = await handle.read(buffer, length, buffer.length - length, length);
      if (bytesRead === 0) break;
      length += bytesRead;
    }
    assert.equal(length, before.size, "Next auxiliary trace artifact changed while reading");
    assert.deepEqual(identity(await handle.stat()), identity(before), "Next auxiliary trace artifact changed while reading");
    assert.deepEqual(identity(await lstat(absolute)), identity(before), "Next auxiliary trace artifact was replaced while reading");
    assert.equal(await realpath(absolute), absolute, "Next auxiliary trace artifact path changed while reading");
    const bytes = buffer.subarray(0, length);
    const artifact = { bytes: length, path, sha256: sha256(bytes) };
    if (role === "installed-creator") {
      assert.equal(artifact.sha256, creator![1], "Next auxiliary trace creator differs from its pinned source bytes");
    }
    return { artifact, bytes };
  } finally {
    await handle.close();
  }
}

async function readCreator(root: string): Promise<StylexArtifactV1> {
  const [path] = STYLEX_NEXT_AUXILIARY_TRACE_CREATOR;
  const creator = await readOrdinary(root, `node_modules/next/${path}`, "installed-creator");
  return creator.artifact;
}

async function absentProxyPaths(outputRoot: string): Promise<void> {
  for (const path of ["server/proxy.js", "server/proxy.js.nft.json"]) {
    const absolute = resolve(outputRoot, path);
    assert.equal(await realpath(dirname(absolute)), dirname(absolute), "Next proxy old path parent traverses a symlink");
    try { await lstat(absolute); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
      throw error;
    }
    assert.fail(`Next proxy original path must be absent after its native rename: ${path}`);
  }
}

async function proveProxyRename(root: string, outputRoot: string, asset: StylexNextAuxiliaryTraceAssetV1, value: StylexNextGraphReceiptV1 | undefined): Promise<StylexNextProxyRenameV1> {
  assert.ok(value !== undefined, "Next proxy rename requires its immutable graph proof");
  const graph = validateStylexNextGraphReceipt(value);
  assert.equal(graph.target, "node-rsc", "Next proxy rename requires the Node graph");
  assert.deepEqual(graph.auxiliaryTraceAssets.find(({ entrypoint }) => entrypoint === "proxy"), asset, "Next proxy rename trace differs from its graph");
  for (const path of ["server/middleware.js", "server/middleware.js.nft.json"]) {
    assert.ok(!graph.outputs.some((output) => output.path === path), "Next proxy native rename destination has a compiled owner");
  }
  const initial = graph.outputs.find(({ path }) => path === "server/proxy.js");
  const sourceMap = graph.sourceMaps.find(({ path }) => path === "server/proxy.js.map");
  assert.ok(initial !== undefined && sourceMap !== undefined, "Next proxy rename must retain its compiled JavaScript and map");
  const creatorPath = `node_modules/next/${STYLEX_NEXT_PROXY_RENAME_CREATOR[0]}`;
  const creator = (await readOrdinary(root, creatorPath, "installed-creator")).artifact;
  await absentProxyPaths(outputRoot);
  const output = (await readOrdinary(outputRoot, "server/middleware.js", "generated-output")).artifact;
  assert.deepEqual(output, { ...initial, path: "server/middleware.js" }, "Next proxy native rename changed JavaScript bytes");
  assert.deepEqual((await readOrdinary(outputRoot, sourceMap.path, "generated-output")).artifact, sourceMap, "Next proxy native rename changed its original map");
  assert.deepEqual((await readOrdinary(root, creatorPath, "installed-creator")).artifact, creator, "Next proxy native rename creator changed");
  await absentProxyPaths(outputRoot);
  return { absent: ["server/proxy.js", "server/proxy.js.nft.json"], creator, initial, output, sourceMap };
}

/** Bind the initial native asset. Graph validation separately proves entry linkage. */
export async function captureStylexNextAuxiliaryTraceAsset(
  rootDirectory: string,
  entrypoint: string,
  initialArtifact: StylexArtifactV1,
  source: string | Uint8Array,
): Promise<StylexNextAuxiliaryTraceAssetV1> {
  const bytes = sourceBytes(source);
  validateStylexNextAuxiliaryTraceSource(bytes);
  const initial = { bytes: bytes.byteLength, path: `server/${entrypoint}.js.nft.json`, sha256: sha256(bytes) };
  assert.deepEqual(initialArtifact, initial, "Next auxiliary trace initial artifact differs from its source bytes or entrypoint");
  const creator = await readCreator(rootDirectory);
  return validateStylexNextAuxiliaryTraceAsset({ creator, entrypoint, initial, kind: "next-node-dependency-trace" });
}

/**
 * Record final framework metadata without tracing, copying, or certifying any
 * referenced dependency. Callers seal this observation and revalidate it before
 * completion; a fresh observation alone cannot authorize publication.
 */
export async function observeStylexNextAuxiliaryTraceSnapshot(
  rootDirectory: string,
  outputRoot: string,
  value: StylexNextAuxiliaryTraceAssetV1,
  proxyGraph?: StylexNextGraphReceiptV1,
): Promise<StylexNextAuxiliaryTraceSnapshotV1> {
  const asset = validateStylexNextAuxiliaryTraceAsset(value);
  assert.deepEqual(await readCreator(rootDirectory), asset.creator, "Next auxiliary trace captured creator changed");
  const proxyRename = asset.entrypoint === "proxy" ? await proveProxyRename(rootDirectory, outputRoot, asset, proxyGraph) : undefined;
  const output = await readOrdinary(outputRoot, proxyRename === undefined ? asset.initial.path : "server/middleware.js.nft.json", "generated-output");
  validateStylexNextAuxiliaryTraceSource(output.bytes);
  assert.deepEqual(await readCreator(rootDirectory), asset.creator, "Next auxiliary trace creator changed during observation");
  if (proxyRename !== undefined) assert.deepEqual(await proveProxyRename(rootDirectory, outputRoot, asset, proxyGraph), proxyRename, "Next proxy rename changed during observation");
  return validateStylexNextAuxiliaryTraceSnapshot({ asset, output: output.artifact, ...(proxyRename === undefined ? {} : { proxyRename }), semantics: "observation-only" });
}
