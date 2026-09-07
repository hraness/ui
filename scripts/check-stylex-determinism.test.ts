import assert from "node:assert/strict";
import { lstat, mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "bun:test";

import { copyDeterminismInputs, runDeterminismChild } from "./check-stylex-determinism";

test("determinism copies relocate authored inputs and resolve emitted-module peers through the same installed toolchain", async () => {
  const directory = await mkdtemp(join(tmpdir(), "hraness-determinism-inputs-"));
  const repository = resolve(directory, "repository");
  const first = resolve(directory, "first");
  const second = resolve(directory, "nested", "second");
  try {
    await Promise.all([
      mkdir(resolve(repository, "src"), { recursive: true }),
      mkdir(resolve(repository, "build"), { recursive: true }),
      mkdir(resolve(repository, "node_modules", "fixture-compiler-peer"), { recursive: true }),
    ]);
    await Promise.all([
      writeFile(resolve(repository, "package.json"), '{"name":"determinism-fixture","type":"module","devDependencies":{"fixture-compiler-peer":"1.0.0"}}'),
      writeFile(resolve(repository, "bun.lock"), "frozen-fixture-lock\n"),
      writeFile(resolve(repository, "src", "input.ts"), 'export const value = "authored";\n'),
      writeFile(resolve(repository, "build", "input.ts"), 'export const value = "compiler";\n'),
      writeFile(resolve(repository, "node_modules", "fixture-compiler-peer", "package.json"), '{"name":"fixture-compiler-peer","version":"1.0.0","type":"module","exports":"./index.js"}'),
      writeFile(resolve(repository, "node_modules", "fixture-compiler-peer", "index.js"), 'export const value = "pinned peer";\n'),
    ]);
    for (const destination of [first, second]) {
      await copyDeterminismInputs(repository, destination);
      for (const path of ["src/input.ts", "build/input.ts", "package.json", "bun.lock"]) {
        assert.equal((await lstat(resolve(destination, path))).isSymbolicLink(), false);
        assert.deepEqual(await readFile(resolve(destination, path)), await readFile(resolve(repository, path)));
      }
      assert.equal((await lstat(resolve(destination, "node_modules"))).isSymbolicLink(), true);
      assert.equal(await realpath(resolve(destination, "node_modules")), await realpath(resolve(repository, "node_modules")));
      const stagedBuild = resolve(destination, ".dist-build-fixture", "build");
      await mkdir(stagedBuild, { recursive: true });
      await writeFile(resolve(stagedBuild, "bun.js"), 'import assert from "node:assert/strict"; import { value } from "fixture-compiler-peer"; assert.equal(value, "pinned peer");\n');
      await runDeterminismChild([process.execPath, resolve(stagedBuild, "bun.js")], destination, "emitted peer import", { echo: false });
    }
    await writeFile(resolve(first, "src", "input.ts"), 'export const value = "changed copy";\n');
    assert.equal(await readFile(resolve(repository, "src", "input.ts"), "utf8"), 'export const value = "authored";\n');
    assert.equal(await readFile(resolve(second, "src", "input.ts"), "utf8"), 'export const value = "authored";\n');
    await rm(resolve(first, "node_modules"));
    await assert.rejects(
      runDeterminismChild([process.execPath, resolve(first, ".dist-build-fixture", "build", "bun.js")], first, "missing peer import", { echo: false }),
      /missing peer import failed/u,
    );
    assert.equal(await readFile(resolve(repository, "node_modules", "fixture-compiler-peer", "index.js"), "utf8"), 'export const value = "pinned peer";\n');
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
});

test("determinism input copying rejects missing or redirected dependency installations", async () => {
  const directory = await mkdtemp(join(tmpdir(), "hraness-determinism-dependencies-"));
  try {
    const repository = resolve(directory, "repository");
    await mkdir(repository);
    await assert.rejects(copyDeterminismInputs(repository, resolve(directory, "copy")), /ENOENT/u);
    await mkdir(resolve(directory, "other-install"));
    await symlink(resolve(directory, "other-install"), resolve(repository, "node_modules"), "dir");
    await assert.rejects(copyDeterminismInputs(repository, resolve(directory, "copy")), /ordinary installed node_modules/u);
    await assert.rejects(lstat(resolve(directory, "copy")), /ENOENT/u);
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
});

function processExists(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ESRCH") return false;
    throw error;
  }
}

test("the determinism runner times out and reaps a child after its artifact is written", async () => {
  const directory = await mkdtemp(join(tmpdir(), "hraness-determinism-child-"));
  const artifact = resolve(directory, "artifact.json");
  let childPid: number | undefined;

  try {
    const childSource = `
      import { writeFileSync } from "node:fs";
      writeFileSync(${JSON.stringify(artifact)}, JSON.stringify({ pid: process.pid, value: "ready" }));
      process.on("SIGTERM", () => {});
      setInterval(() => {}, 1_000);
    `;
    await assert.rejects(
      runDeterminismChild(
        [process.execPath, "-e", childSource],
        directory,
        "retained-handle fixture",
        { echo: false, terminationGraceMs: 100, timeoutMs: 2_000 },
      ),
      /retained-handle fixture timed out after 2000ms/u,
    );

    const receipt = JSON.parse(await readFile(artifact, "utf8")) as {
      pid?: unknown;
      value?: unknown;
    };
    assert.equal(receipt.value, "ready");
    assert.equal(typeof receipt.pid, "number");
    childPid = receipt.pid as number;
    assert.equal(processExists(childPid), false, "timed-out child must not survive");
  } finally {
    if (childPid !== undefined && processExists(childPid)) {
      process.kill(childPid, "SIGKILL");
    }
    await rm(directory, { force: true, recursive: true });
  }
});
