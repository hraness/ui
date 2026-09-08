import { afterAll, test } from "bun:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, realpath, rm } from "node:fs/promises";
import { delimiter, join } from "node:path";
import {
  collectViteMatrixGroup, createViteMatrixCustody, matrixDeadline, ownViteMatrixCancellationOwner,
  viteMatrixGroup, waitForViteMatrixJson, writeViteMatrixSuccessReceipt,
} from "../fixtures/vite8-adopter/custody.ts";
import { cancellationSupervisorScript } from "../fixtures/vite8-adopter/cancellation-supervisor.ts";
import { createBoundedDiagnostics } from "../fixtures/vite8-adopter/diagnostics.ts";
import { resolveFirstBrowserExecutable } from "./browser-executable.ts";

const runnerCustody = createViteMatrixCustody();
afterAll(async () => { await runnerCustody.close(); runnerCustody.dispose(); }, 60_000);
const waitForJson = (path: string) => waitForViteMatrixJson(path, runnerCustody.signal);
const requestSignal = () => AbortSignal.any([runnerCustody.signal, AbortSignal.timeout(1_000)]);

function nodeExecutable(): string {
  for (const directory of (process.env.PATH ?? "").split(delimiter).filter(Boolean)) {
    const candidate = join(directory, "node");
    try {
      execFileSync(candidate, ["--eval", "if (process.versions.bun || !/^24\\.[0-9]+\\.[0-9]+$/.test(process.versions.node)) process.exit(1)"], { stdio: "ignore", timeout: 5_000 });
      return candidate;
    } catch { /* Keep the same genuine Node 24 requirement as the matrix. */ }
  }
  throw new Error("Browser cancellation regression requires genuine Node 24 on PATH");
}

function object(value: unknown): Record<string, unknown> {
  assert.ok(typeof value === "object" && value !== null && !Array.isArray(value));
  return value as Record<string, unknown>;
}

function positivePid(value: unknown): number {
  assert.ok(typeof value === "number" && Number.isSafeInteger(value) && value > 1);
  return value;
}

for (const [mode, signal, expectedCode] of [["command", "SIGTERM", 143], ["browser", "SIGINT", 130], ["browser-pending", "SIGTERM", 143]] as const) {
  test(`real ${signal} collects owned ${mode} descendants and server, retaining cancellation evidence`, async () => {
    assert.ok(process.platform === "darwin" || process.platform === "linux");
    const repository = await realpath(process.cwd());
    const directory = join(repository, ".stylex-fixtures");
    await mkdir(directory, { recursive: true });
    assert.equal(await realpath(directory), directory);
    const work = await mkdtemp(join(directory, "vite78-cancellation-"));
    let success = false;
    const executable = mode !== "command" ? await resolveFirstBrowserExecutable([
      ...(process.env.CHROMIUM_EXECUTABLE_PATH ? [process.env.CHROMIUM_EXECUTABLE_PATH] : []),
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/usr/bin/google-chrome",
      "/usr/bin/google-chrome-stable", "/usr/bin/chromium", "/usr/bin/chromium-browser",
    ], "Cancellation regression requires the matrix browser") : "";
    const owned = ownViteMatrixCancellationOwner([
      process.execPath, join(repository, "fixtures/vite8-adopter/cancellation-owner.ts"), work, mode, executable, mode === "command" ? "" : nodeExecutable(),
    ], work, runnerCustody);
    const { child: owner, closed, spawned, group: ownerGroup } = owned;
    const diagnostics = createBoundedDiagnostics();
    owner.stdout.on("data", (bytes: Buffer) => diagnostics.append(bytes));
    owner.stderr.on("data", (bytes: Buffer) => diagnostics.append(bytes));
    let resourcePid: number | undefined;
    try {
      await spawned;
      const ready = object(await waitForJson(join(work, "ready.json")));
      resourcePid = positivePid(ready.pid);
      const server = object(await waitForJson(join(work, "server.json")));
      assert.equal(server.owner, owner.pid);
      assert.ok(typeof server.port === "number" && Number.isSafeInteger(server.port) && server.port > 0 && server.port <= 65_535);
      const url = `http://127.0.0.1:${String(server.port)}`;
      assert.equal(await (await fetch(url, { signal: requestSignal() })).text(), "owned regression server");
      assert.equal(viteMatrixGroup(resourcePid).probe(), true);
      assert.equal(owner.kill(signal), true);
      const result = await matrixDeadline(closed, 20_000, "Cancellation owner did not close");
      runnerCustody.check();
      assert.equal(result.signal, null, diagnostics.render("stderr").toString("utf8"));
      assert.equal(result.code, expectedCode, diagnostics.render("stderr").toString("utf8"));
      assert.equal(ownerGroup.probe(), false);
      assert.equal(viteMatrixGroup(resourcePid).probe(), false);
      if (mode === "command") {
        const descendant = positivePid(ready.descendant);
        assert.throws(() => process.kill(descendant, 0), (error: unknown) => (error as NodeJS.ErrnoException).code === "ESRCH");
      } else {
        assert.equal(viteMatrixGroup(positivePid(ready.worker)).probe(), false);
        const worker = object(JSON.parse(await readFile(join(work, "browser-worker/browser-result.json"), "utf8")) as unknown);
        assert.equal(worker.state, "cancelled");
        assert.equal(worker.resources, 0);
        assert.match(String(worker.node), /^24\.[0-9]+\.[0-9]+$/u);
        assert.deepEqual(worker.browserPids, [resourcePid]);
        assert.equal(worker.evidence, null);
        assert.ok(typeof ready.browserPort === "number" && Number.isSafeInteger(ready.browserPort));
        await assert.rejects(fetch(`http://127.0.0.1:${String(ready.browserPort)}`, { signal: requestSignal() }));
      }
      await assert.rejects(fetch(url, { signal: requestSignal() }));
      const cancelled = object(JSON.parse(await readFile(join(work, "cancelled.json"), "utf8")) as unknown);
      assert.equal(cancelled.state, "cancelled");
      assert.equal(cancelled.resources, 0);
      assert.match(String(cancelled.cause), new RegExp(signal, "u"));
      await assert.rejects(readFile(join(work, "success.json")), (error: unknown) => (error as NodeJS.ErrnoException).code === "ENOENT");
      // The cancelled owner never removes evidence. Only this successfully
      // completed regression may remove its exact fixture afterwards.
      runnerCustody.check();
      success = true;
    } finally {
      await owned.close();
      if (resourcePid !== undefined) await collectViteMatrixGroup(viteMatrixGroup(resourcePid));
      await matrixDeadline(closed, 5_000, "Regression owner streams remain open");
      if (success && !runnerCustody.signal.aborted) await rm(work, { recursive: true, force: true });
      else console.error(`Vite cancellation regression evidence retained at ${work}\n${diagnostics.render("stderr").toString("utf8")}`);
    }
  }, 120_000);
}

test("cancelling the outer supervisor collects a nested owner tree while readiness is pending", async () => {
  const repository = await realpath(process.cwd());
  const directory = join(repository, ".stylex-fixtures");
  await mkdir(directory, { recursive: true });
  assert.equal(await realpath(directory), directory);
  const work = await mkdtemp(join(directory, "vite78-supervisor-cancellation-"));
  const owned = ownViteMatrixCancellationOwner([process.execPath, cancellationSupervisorScript, work], work, runnerCustody);
  const diagnostics = createBoundedDiagnostics();
  owned.child.stdout.on("data", (bytes: Buffer) => diagnostics.append(bytes));
  owned.child.stderr.on("data", (bytes: Buffer) => diagnostics.append(bytes));
  let success = false;
  try {
    await owned.spawned;
    const ready = object(await waitForJson(join(work, "supervisor-ready.json")));
    assert.equal(ready.state, "waiting-for-readiness-admission");
    const innerOwner = positivePid(ready.owner);
    const nested = object(ready.nested);
    const leader = positivePid(nested.pid);
    const descendant = positivePid(nested.descendant);
    const server = object(await waitForJson(join(work, "server.json")));
    assert.equal(server.owner, innerOwner);
    assert.ok(typeof server.port === "number" && Number.isSafeInteger(server.port) && server.port > 0 && server.port <= 65_535);
    const url = `http://127.0.0.1:${String(server.port)}`;
    assert.equal(await (await fetch(url, { signal: requestSignal() })).text(), "owned regression server");
    assert.equal(viteMatrixGroup(innerOwner).probe(), true);
    assert.equal(viteMatrixGroup(leader).probe(), true);
    process.kill(descendant, 0);
    assert.equal(owned.child.kill("SIGTERM"), true);
    const terminal = await matrixDeadline(owned.closed, 55_000, "Cancelled supervisor did not collect its nested owner");
    runnerCustody.check();
    assert.equal(terminal.signal, null, diagnostics.render("stderr").toString("utf8"));
    assert.equal(terminal.code, 143, diagnostics.render("stderr").toString("utf8"));
    for (const pid of [innerOwner, leader]) assert.equal(viteMatrixGroup(pid).probe(), false);
    assert.throws(() => process.kill(descendant, 0), (error: unknown) => (error as NodeJS.ErrnoException).code === "ESRCH");
    await assert.rejects(fetch(url, { signal: requestSignal() }));
    for (const path of ["cancelled.json", "supervisor-cancelled.json"]) {
      const evidence = object(await waitForJson(join(work, path)));
      assert.equal(evidence.state, "cancelled");
      assert.equal(evidence.resources, 0);
      assert.match(String(evidence.cause), /SIGTERM/u);
    }
    await assert.rejects(readFile(join(work, "success.json")), (error: unknown) => (error as NodeJS.ErrnoException).code === "ENOENT");
    runnerCustody.check();
    success = true;
  } finally {
    await owned.close();
    if (success && !runnerCustody.signal.aborted) await rm(work, { recursive: true, force: true });
    else console.error(`Vite supervisor cancellation evidence retained at ${work}\n${diagnostics.render("stderr").toString("utf8")}`);
  }
}, 120_000);

test("durable success receipt survives consumer cleanup and refuses replacement", async () => {
  const repository = await realpath(process.cwd());
  const directory = join(repository, ".stylex-fixtures");
  await mkdir(directory, { recursive: true });
  assert.equal(await realpath(directory), directory);
  const work = await mkdtemp(join(directory, "vite78-receipt-test-"));
  let success = false;
  const custody = createViteMatrixCustody();
  try {
    const consumer = join(work, "consumer");
    await mkdir(consumer);
    const receipt = await writeViteMatrixSuccessReceipt(join(work, "receipts"), "vite78-production-test.json", { state: "complete", inputs: [{ sha256: "proof" }] }, custody);
    await rm(consumer, { recursive: true, force: true });
    assert.deepEqual(JSON.parse(await readFile(receipt.path, "utf8")), { state: "complete", inputs: [{ sha256: "proof" }] });
    assert.equal(receipt.bytes, Buffer.byteLength(await readFile(receipt.path)));
    const replacement = createViteMatrixCustody();
    try {
      await assert.rejects(writeViteMatrixSuccessReceipt(join(work, "receipts"), "vite78-production-test.json", {}, replacement), (error: unknown) => (error as NodeJS.ErrnoException).code === "EEXIST");
    } finally { await replacement.close(); replacement.dispose(); }
    success = true;
  } finally {
    await custody.close();
    custody.dispose();
    if (success) await rm(work, { recursive: true, force: true });
    else console.error(`Vite receipt regression evidence retained at ${work}`);
  }
});
