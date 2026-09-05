import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "bun:test";

import { runDeterminismChild } from "./check-stylex-determinism";

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
