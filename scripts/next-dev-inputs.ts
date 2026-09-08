import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { constants, type BigIntStats } from "node:fs";
import { lstat, open, readdir, realpath } from "node:fs/promises";
import { join, resolve } from "node:path";

const hash = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const identity = (stat: BigIntStats) => [stat.dev, stat.ino, stat.mode, stat.nlink, stat.size, stat.mtimeNs, stat.ctimeNs].map(String);
export async function snapshotNextFile(path: string, maxBytes = 32 * 1024 * 1024) {
  assert.equal(await realpath(path), path, "Next input must not traverse a symlink");
  const before = await lstat(path, { bigint: true });
  assert.ok(before.isFile() && !before.isSymbolicLink() && before.size >= 0n && before.size <= BigInt(maxBytes));
  const descriptor = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    assert.deepEqual(identity(await descriptor.stat({ bigint: true })), identity(before));
    const bytes = Buffer.alloc(Number(before.size) + 1);
    let count = 0;
    while (count < bytes.length) {
      const chunk = await descriptor.read(bytes, count, bytes.length - count, count);
      if (chunk.bytesRead === 0) break;
      count += chunk.bytesRead;
    }
    assert.equal(count, Number(before.size));
    assert.deepEqual(identity(await descriptor.stat({ bigint: true })), identity(before));
    assert.deepEqual(identity(await lstat(path, { bigint: true })), identity(before));
    return { bytes: bytes.subarray(0, count), seal: { bytes: count, sha256: hash(bytes.subarray(0, count)), identity: identity(before) } };
  } finally { await descriptor.close(); }
}

export async function snapshotNextPackage(root: string) {
  assert.equal(await realpath(root), root);
  const packageBytes = (await snapshotNextFile(join(root, "package.json"))).bytes;
  const manifest: unknown = JSON.parse(packageBytes.toString());
  assert.ok(typeof manifest === "object" && manifest !== null && "files" in manifest && Array.isArray(manifest.files));
  const paths = new Set<string>();
  let directories = 0;
  const visit = async (logical: string): Promise<void> => {
    assert.ok(/^[A-Za-z0-9_.\/-]+$/u.test(logical) && !logical.split("/").some(part => part === "" || part === "." || part === ".."));
    assert.ok(logical.split("/").length <= 32, "Packed source depth exceeded its bound");
    const path = join(root, logical);
    assert.equal(await realpath(path), path);
    const stat = await lstat(path);
    assert.ok(!stat.isSymbolicLink());
    if (stat.isDirectory()) {
      directories += 1; assert.ok(directories <= 2048);
      for (const entry of (await readdir(path)).sort()) await visit(`${logical}/${entry}`);
    } else {
      assert.ok(stat.isFile()); paths.add(logical);
      assert.ok(paths.size <= 1024, "Packed source inventory exceeded its bound");
    }
  };
  for (const entry of ["package.json", ...manifest.files]) {
    assert.ok(typeof entry === "string"); await visit(entry);
  }
  const rows = [];
  let total = 0;
  for (const path of [...paths].sort()) {
    const { seal } = await snapshotNextFile(resolve(root, path));
    total += seal.bytes; assert.ok(total <= 256 * 1024 * 1024);
    rows.push({ path, bytes: seal.bytes, sha256: seal.sha256 });
  }
  // Every emitted compiler artifact must agree with the exact manifest bytes,
  // not merely with a manifest hash that can outlive altered dist files.
  const compiler: unknown = JSON.parse((await snapshotNextFile(join(root, "dist/stylex-manifest.json"))).bytes.toString());
  assert.ok(typeof compiler === "object" && compiler !== null);
  const record = compiler as Record<string, unknown>;
  assert.ok(Array.isArray(record.runtime) && Array.isArray(record.buildTools) && Array.isArray(record.stylesheets));
  for (const artifact of [...record.runtime, ...record.buildTools, ...record.stylesheets, record.standaloneCss] as unknown[]) {
    assert.ok(typeof artifact === "object" && artifact !== null);
    const item = artifact as Record<string, unknown>;
    const row = rows.find(row => row.path === item.path);
    assert.ok(row !== undefined, "Declared compiler artifact is outside the packed inventory");
    assert.equal(row.bytes, item.bytes); assert.equal(row.sha256, item.sha256);
  }
  return rows;
}
