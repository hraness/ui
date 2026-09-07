import assert from "node:assert/strict";
import { mkdtemp, readFile, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "bun:test";

import { collectStylexNextProcessGroup, runOwnedStylexNextProcess, UncollectedNextProcessError } from "./next-process.js";

test("collection proves absence, collects survivors, and fails closed on every unknown operation", async () => {
  assert.equal(await collectStylexNextProcessGroup({
    probe: () => false, signal: () => assert.fail("No signal for an absent group"), wait: async () => assert.fail("No wait for an absent group"),
  }), false);
  let alive = true;
  const signals: NodeJS.Signals[] = [];
  assert.equal(await collectStylexNextProcessGroup({
    probe: () => alive,
    signal: (signal) => { signals.push(signal); if (signal === "SIGKILL") alive = false; },
    wait: async () => undefined,
  }), true);
  assert.deepEqual(signals, ["SIGTERM", "SIGKILL"]);
  for (const failure of ["probe", "signal", "wait", "survivor"] as const) {
    await assert.rejects(collectStylexNextProcessGroup({
      probe: () => { if (failure === "probe") throw Object.assign(new Error("probe denied"), { code: "EPERM" }); return true; },
      signal: () => { if (failure === "signal") throw Object.assign(new Error("signal denied"), { code: "EPERM" }); },
      wait: async () => { if (failure === "wait") throw new Error("wait failed"); },
    }), UncollectedNextProcessError);
  }
});

function missingProcess(pid: number): boolean {
  try { process.kill(pid, 0); return false; }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ESRCH") return true; throw error; }
}

async function readReadyPids(path: string): Promise<readonly number[]> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    try {
      const parsed: unknown = JSON.parse(await readFile(path, "utf8"));
      assert.ok(Array.isArray(parsed) && parsed.length === 2);
      assert.ok(parsed.every((pid) => typeof pid === "number" && Number.isSafeInteger(pid) && pid > 1));
      return parsed as number[];
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      await new Promise<void>((done) => setTimeout(done, 25));
    }
  }
  throw new Error("Native child did not publish its bounded readiness receipt");
}

test("native leader exit collects its live descendant before returning an ordinary failure", async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "stylex-next-process-exit-")));
  let collected = false;
  try {
    const receipt = join(root, "pids.json");
    const source = `const {spawn}=require('node:child_process'); const {writeFileSync}=require('node:fs');
      const worker=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'});
      worker.unref(); writeFileSync(${JSON.stringify(receipt)}, JSON.stringify([process.pid,worker.pid]));
      setTimeout(()=>process.exit(0),100);`;
    await assert.rejects(runOwnedStylexNextProcess({ command: "node", args: ["-e", source], cwd: root, env: process.env }), (error: unknown) => {
      assert.ok(error instanceof AggregateError && !(error instanceof UncollectedNextProcessError));
      assert.ok(error.errors.some((item: unknown) => item instanceof Error && item.message.includes("descendant")));
      return true;
    });
    for (const pid of await readReadyPids(receipt)) assert.equal(missingProcess(pid), true);
    collected = true;
  } finally { if (collected) await rm(root, { recursive: true, force: true }); }
}, 15_000);

test("native cancellation escalates ignored TERM, collects parent and descendant, and removes signal listeners", async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "stylex-next-process-cancel-")));
  const controller = new AbortController();
  let collected = false;
  const initial = [process.listenerCount("SIGINT"), process.listenerCount("SIGTERM")];
  try {
    const receipt = join(root, "pids.json");
    const source = `const {spawn}=require('node:child_process'); const {writeFileSync}=require('node:fs');
      process.on('SIGTERM',()=>{});
      const worker=spawn(process.execPath,['-e',"process.on('SIGTERM',()=>{});setInterval(()=>{},1000)"],{stdio:'ignore'});
      setTimeout(()=>writeFileSync(${JSON.stringify(receipt)},JSON.stringify([process.pid,worker.pid])),100);
      setInterval(()=>{},1000);`;
    const run = runOwnedStylexNextProcess({ command: "node", args: ["-e", source], cwd: root, env: process.env, signal: controller.signal });
    const rejected = assert.rejects(run, (error: unknown) => {
      assert.ok(error instanceof AggregateError && !(error instanceof UncollectedNextProcessError));
      assert.ok(error.errors.some((item: unknown) => item instanceof Error && item.message.includes("cancelled")));
      return true;
    });
    const pids = await readReadyPids(receipt);
    controller.abort();
    await rejected;
    for (const pid of pids) assert.equal(missingProcess(pid), true);
    collected = true;
    assert.deepEqual([process.listenerCount("SIGINT"), process.listenerCount("SIGTERM")], initial);
  } finally { controller.abort(); if (collected) await rm(root, { recursive: true, force: true }); }
}, 25_000);

test("spawn failure has no group, while pre-spawn cancellation creates no child", async () => {
  const initial = [process.listenerCount("SIGINT"), process.listenerCount("SIGTERM")];
  await assert.rejects(runOwnedStylexNextProcess({
    command: join(process.cwd(), "missing-stylex-next-executable"), args: [], cwd: process.cwd(), env: process.env,
  }), (error: unknown) => error instanceof AggregateError && !(error instanceof UncollectedNextProcessError));
  await assert.rejects(runOwnedStylexNextProcess({
    command: "node", args: ["-e", "process.exit(99)"], cwd: process.cwd(), env: process.env, signal: AbortSignal.abort(),
  }), /cancelled before spawn/u);
  assert.deepEqual([process.listenerCount("SIGINT"), process.listenerCount("SIGTERM")], initial);
});
