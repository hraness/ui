import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { constants, existsSync, writeFileSync, type BigIntStats } from "node:fs";
import { chmod, link, lstat, mkdir, mkdtemp, open, readFile, realpath, rm, symlink, unlink, writeFile, type FileHandle } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, test } from "bun:test";
import { canonicalJson, sha256 } from "./compiler.js";
import { retainStylexNextExportDiscovery, validateStylexNextExportRetention, verifyStylexNextExportRetention } from "./next-export-custody.js";
import { runOwnedStylexNextExportDiscoveryProcess, type StylexNextExportCollection } from "./next-process.js";

const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });
const planSha256 = sha256("one exact export attempt plan");

async function fixture() {
  const root = await realpath(await mkdtemp(join(tmpdir(), "stylex-export-retention-")));
  roots.push(root);
  const stateDirectory = ".stylex-next";
  const attemptId = "export-a";
  await mkdir(join(root, stateDirectory, attemptId), { recursive: true });
  await mkdir(join(root, ".next/server/app"), { recursive: true });
  await mkdir(join(root, ".next/types"));
  await writeFile(join(root, ".next/server/app/page.html"), "<h1>Static fixture</h1>");
  await writeFile(join(root, ".next/server/app/page.js.map"), '{"sources":["app/page.tsx"],"sourcesContent":["export default 1"]}');
  await writeFile(join(root, ".next/types/validator.ts"), 'import type Page from "../../app/page.js";');
  await chmod(join(root, ".next/server/app/page.html"), 0o640);
  const binding = { root, stateDirectory, attemptId, planSha256 };
  return { ...binding, native: join(root, ".next"), retained: join(root, stateDirectory, attemptId, "next-discovery") };
}

async function collected(value: Awaited<ReturnType<typeof fixture>>): Promise<StylexNextExportCollection> {
  return runOwnedStylexNextExportDiscoveryProcess({ cwd: value.root, command: "node", args: ["-e", ""],
    env: process.env, attemptId: value.attemptId, planSha256: value.planSha256 });
}

test("collected discovery retention copies all bytes and modes without moving or relabeling native output", async () => {
  const value = await fixture();
  const sourceBefore = await lstat(join(value.native, "server/app/page.html"));
  const receipt = await retainStylexNextExportDiscovery({ ...value, collection: await collected(value) });
  assert.equal(receipt.nativeDirectory, ".next");
  assert.equal(receipt.retainedDirectory, ".stylex-next/export-a/next-discovery");
  assert.deepEqual(receipt.files.map(({ path }) => path), ["server/app/page.html", "server/app/page.js.map", "types/validator.ts"]);
  assert.equal(receipt.files[0]?.mode, 0o640);
  const sourceAfter = await lstat(join(value.native, "server/app/page.html"));
  const copied = await lstat(join(value.retained, "server/app/page.html"));
  assert.equal(sourceAfter.ino, sourceBefore.ino);
  assert.equal(copied.dev, sourceAfter.dev);
  assert.notEqual(copied.ino, sourceAfter.ino);
  assert.equal(copied.nlink, 1);
  assert.equal(await readFile(join(value.retained, "types/validator.ts"), "utf8"), 'import type Page from "../../app/page.js";');
  assert.equal(canonicalJson(receipt).includes(value.root), false);
  assert.equal(canonicalJson(receipt).includes('"inode"'), false);
  assert.deepEqual(await verifyStylexNextExportRetention(value, receipt), receipt);
  // Delivery is an independent native writer. Its output cannot stand in for
  // discovery, even when the same native origin path is used again.
  await rm(value.native, { recursive: true });
  await mkdir(value.native);
  await writeFile(join(value.native, "delivery.js"), "new delivery output");
  assert.deepEqual(await verifyStylexNextExportRetention(value, receipt), receipt);
  assert.equal(existsSync(join(value.retained, "delivery.js")), false);
});

test("retention requires one real successful collection token with the exact root, attempt and plan", async () => {
  const value = await fixture();
  await assert.rejects(retainStylexNextExportDiscovery({ ...value, collection: {} as StylexNextExportCollection }), /collected-child token/u);
  for (const change of [{ attemptId: "another" }, { planSha256: sha256("other") }]) {
    await assert.rejects(retainStylexNextExportDiscovery({ ...value, ...change, collection: await collected(value) }), /another/u);
  }
  const other = await fixture();
  await assert.rejects(retainStylexNextExportDiscovery({ ...other, collection: await collected(value) }), /another root/u);
  const token = await collected(value);
  await retainStylexNextExportDiscovery({ ...value, collection: token });
  await assert.rejects(retainStylexNextExportDiscovery({ ...value, collection: token }), /collected-child token/u);
  await assert.rejects(runOwnedStylexNextExportDiscoveryProcess({ cwd: value.root, command: "node", args: ["-e", "process.exit(7)"],
    env: process.env, attemptId: value.attemptId, planSha256 }), /failed/u);
  await assert.rejects(runOwnedStylexNextExportDiscoveryProcess({ cwd: value.root, command: "node", args: ["-e", ""],
    env: process.env, attemptId: value.attemptId, planSha256, signal: AbortSignal.abort() }), /cancelled/u);
});

test("an existing directory, file or symlink is never overwritten or adopted", async () => {
  for (const kind of ["directory", "file", "symlink"] as const) {
    const value = await fixture();
    if (kind === "directory") await mkdir(value.retained);
    else if (kind === "file") await writeFile(value.retained, "preserved");
    else await symlink(value.native, value.retained, "dir");
    const before = await lstat(value.retained);
    await assert.rejects(retainStylexNextExportDiscovery({ ...value, collection: await collected(value) }), /EEXIST/u);
    const after = await lstat(value.retained);
    assert.equal(after.ino, before.ino);
    assert.equal(after.mode, before.mode);
    if (kind === "file") assert.equal(await readFile(value.retained, "utf8"), "preserved");
  }
});

test("symlinks and shared source inodes cannot enter the native retention census", async () => {
  for (const kind of ["file-link", "directory-link", "hard-link"] as const) {
    const value = await fixture();
    if (kind === "file-link") await symlink(join(value.native, "types/validator.ts"), join(value.native, "alias.ts"));
    else if (kind === "directory-link") await symlink(join(value.native, "types"), join(value.native, "alias"), "dir");
    else await link(join(value.native, "types/validator.ts"), join(value.native, "alias.ts"));
    await assert.rejects(retainStylexNextExportDiscovery({ ...value, collection: await collected(value) }), /link/u);
    assert.equal(existsSync(value.retained), false);
  }
});

test("a stale regular-file stat cannot make an opened FIFO block or enter retained evidence", async () => {
  const value = await fixture();
  const hostile = join(value.native, "types/validator.ts");
  const stale = await lstat(hostile, { bigint: true });
  await unlink(hostile);
  const made = spawnSync("/usr/bin/mkfifo", [hostile], { timeout: 5_000, maxBuffer: 4_096, killSignal: "SIGKILL", env: {} });
  assert.ifError(made.error);
  assert.equal(made.status, 0);
  assert.equal(made.signal, null);
  assert.equal((await lstat(hostile)).isFIFO(), true);

  // Execute the actual private reader body with only its pre-open lstat made
  // stale. The native FIFO is already present, so there is no timing race or
  // concurrent helper. Inspect flags before the real open: a regression fails
  // immediately instead of hanging the test itself on a blocking FIFO open.
  const source = await readFile(new URL("./next-export-custody.ts", import.meta.url), "utf8");
  const match = /async function readOrdinary\(path: string\)[\s\S]*?\n\}\n(?=\nfunction sortPaths)/u.exec(source);
  assert.ok(match, "The exact private ordinary reader must remain observable");
  const compiled = new Bun.Transpiler({ loader: "ts" }).transformSync(match[0]);
  let acquired: FileHandle | undefined;
  const guardedOpen = async (path: string, flags: number): Promise<FileHandle> => {
    assert.equal(flags & constants.O_NONBLOCK, constants.O_NONBLOCK);
    assert.equal(flags & constants.O_NOFOLLOW, constants.O_NOFOLLOW);
    acquired = await open(path, flags);
    return acquired;
  };
  const fileIdentity = (stat: BigIntStats) => ({ device: stat.dev, inode: stat.ino, mode: stat.mode,
    size: stat.size, modified: stat.mtimeNs, changed: stat.ctimeNs });
  const read = new Function("lstat", "open", "realpath", "resolve", "constants", "identity", "assert", "Buffer", "MAX_FILE_BYTES",
    `${compiled}\nreturn readOrdinary;`)(async () => stale, guardedOpen, realpath, resolve, constants, fileIdentity, assert, Buffer, 128 * 1024 * 1024) as
    (path: string) => Promise<unknown>;
  await assert.rejects(read(hostile), /opened retained input must be an ordinary file/u);
  assert.ok(acquired, "The rejection must inspect the actual opened FIFO");
  await assert.rejects(acquired.stat(), { code: "EBADF" });
  assert.equal(existsSync(value.retained), false);
});

test("cancellation and source drift leave a nonaccepting partial archive, never a resumable receipt", async () => {
  for (const stage of ["cancel", "before-copy", "after-copy"] as const) {
    const value = await fixture();
    const token = await collected(value);
    const signal = new AbortController().signal;
    let changed = false;
    // A deterministic signal observation exercises the exact capture frontier;
    // no filesystem watcher or timing race is needed to inject the mutation.
    Object.defineProperty(signal, "aborted", { get() {
      if (!existsSync(value.retained)) return false;
      if (stage === "cancel") return true;
      if (!changed && (stage === "before-copy" || existsSync(join(value.retained, "types/validator.ts")))) {
        changed = true;
        writeFileSync(join(value.native, "types/validator.ts"), "changed native type source");
      }
      return false;
    } });
    await assert.rejects(retainStylexNextExportDiscovery({ ...value, collection: token, signal }));
    assert.equal(existsSync(value.retained), true);
    await assert.rejects(retainStylexNextExportDiscovery({ ...value, collection: token }), /collected-child token/u);
    await assert.rejects(retainStylexNextExportDiscovery({ ...value, collection: await collected(value) }), /EEXIST/u);
  }
});

test("final verification rejects changed, missing, additional, misbound and relabeled retained evidence", async () => {
  const value = await fixture();
  const receipt = await retainStylexNextExportDiscovery({ ...value, collection: await collected(value) });
  for (const change of [{ attemptId: "other" }, { planSha256: sha256("other") }, { stateDirectory: "other-state" }]) {
    await assert.rejects(verifyStylexNextExportRetention({ ...value, ...change }, receipt));
  }
  const file = join(value.retained, "types/validator.ts");
  const original = await readFile(file);
  await writeFile(file, "wrong types");
  await assert.rejects(verifyStylexNextExportRetention(value, receipt), /changed after capture/u);
  await unlink(file);
  await assert.rejects(verifyStylexNextExportRetention(value, receipt), /changed after capture/u);
  await writeFile(file, original);
  await chmod(file, receipt.files.find(({ path }) => path === "types/validator.ts")!.mode);
  await writeFile(join(value.retained, "unowned.js"), "extra");
  await assert.rejects(verifyStylexNextExportRetention(value, receipt), /changed after capture/u);
  await unlink(join(value.retained, "unowned.js"));
  for (const changed of [
    { ...receipt, nativeDirectory: receipt.retainedDirectory }, { ...receipt, mode: "delivery" },
    { ...receipt, schemaVersion: 2 }, { ...receipt, inode: 1 },
    { ...receipt, retainedDirectory: "../foreign/export-a/next-discovery" },
    { ...receipt, files: [...receipt.files, receipt.files[0]] },
    { ...receipt, files: [{ ...receipt.files[0], path: "orphan/no-parent.js" }] },
    { ...receipt, files: [{ ...receipt.files[0], mode: 0o4755 }] },
  ]) assert.throws(() => validateStylexNextExportRetention(changed));
  assert.deepEqual(await verifyStylexNextExportRetention(value, receipt), receipt);
});
