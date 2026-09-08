import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { closeSync, constants, fsyncSync, linkSync, lstatSync, openSync, realpathSync, unlinkSync } from "node:fs";
import { lstat, mkdir, open, realpath } from "node:fs/promises";
import { dirname, join } from "node:path";
import { createBoundedDiagnostics } from "./diagnostics.ts";

export class UncollectedViteMatrixResourceError extends Error {}

type GroupOperations = Readonly<{
  probe(): boolean;
  signal(signal: NodeJS.Signals): void;
  wait(): Promise<void>;
}>;

/** Collection requires a positive absent-group observation, including on errors. */
export async function collectViteMatrixGroup(operations: GroupOperations): Promise<boolean> {
  try {
    if (!operations.probe()) return false;
    operations.signal("SIGTERM");
    for (let attempt = 0; attempt < 80 && operations.probe(); attempt += 1) await operations.wait();
    if (operations.probe()) operations.signal("SIGKILL");
    for (let attempt = 0; attempt < 200 && operations.probe(); attempt += 1) await operations.wait();
    assert.equal(operations.probe(), false, "The owned Vite matrix process group survived collection");
    return true;
  } catch (cause) {
    throw new UncollectedViteMatrixResourceError("Vite matrix process collection is unproved; retain its evidence", { cause });
  }
}

export function viteMatrixGroup(pid: number | undefined): GroupOperations {
  assert.ok(pid === undefined || (Number.isSafeInteger(pid) && pid > 1), "Process-group identity must be a spawned positive PID");
  return {
    probe() {
      if (pid === undefined) return false;
      try { process.kill(-pid, 0); return true; }
      catch (error) { if ((error as NodeJS.ErrnoException).code === "ESRCH") return false; throw error; }
    },
    signal(signal) {
      if (pid === undefined) return;
      try { process.kill(-pid, signal); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error; }
    },
    wait: () => new Promise<void>((resolve) => setTimeout(resolve, 25)),
  };
}

export async function matrixDeadline<T>(operation: Promise<T>, milliseconds: number, description: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([operation, new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new UncollectedViteMatrixResourceError(description)), milliseconds);
    })]);
  } finally { if (timer !== undefined) clearTimeout(timer); }
}

/** Register before the first await after acquiring a resource. Closing is sticky. */
type MatrixSignal = "SIGINT" | "SIGTERM";
type SignalSource = Readonly<{
  on(signal: MatrixSignal, listener: () => void): unknown;
  off(signal: MatrixSignal, listener: () => void): unknown;
}>;

export function createViteMatrixCustody(options: Readonly<{
  signals?: SignalSource;
  onCancel?: (signal: MatrixSignal) => void;
}> = {}) {
  const signals = options.signals ?? process;
  const controller = new AbortController();
  const resources = new Set<Readonly<{ name: string; close(): Promise<void> }>>();
  const failures: unknown[] = [];
  let committed = false;
  let draining: Promise<void> | undefined;
  const drain = () => {
    // Context -> connection -> native server is a dependency chain, not a set
    // of independent closers. Concurrent drains share this reverse-order pass.
    draining ??= Promise.resolve().then(async () => {
      const attempted = new Set<unknown>();
      for (;;) {
        const resource = [...resources].reverse().find((entry) => !attempted.has(entry));
        if (resource === undefined) return;
        attempted.add(resource);
        // A failed closer stays registered, but must not prevent attempts to
        // collect its parents. Its sticky failure still forbids a receipt.
        await resource.close().catch(() => undefined);
      }
    }).finally(() => { draining = undefined; });
    return draining;
  };
  const cancel = (signal: MatrixSignal) => {
    if (committed || controller.signal.aborted) return;
    if (options.onCancel !== undefined) options.onCancel(signal);
    else process.exitCode = signal === "SIGINT" ? 130 : 143;
    controller.abort(new Error(`Vite compatibility matrix cancelled by ${signal}`));
    // Closing the context interrupts in-flight Playwright waits before its
    // connection and server close. Late acquisitions join the same drain.
    void drain();
  };
  const interrupt = () => cancel("SIGINT");
  const terminate = () => cancel("SIGTERM");
  signals.on("SIGINT", interrupt);
  signals.on("SIGTERM", terminate);
  return {
    signal: controller.signal,
    check() { controller.signal.throwIfAborted(); },
    get activeResources(): number { return resources.size; },
    /** A synchronous publication is the final success linearization point.
     * Signal callbacks cannot interleave it; signals after it cannot revoke proof. */
    commit<T>(publish: () => T): T {
      controller.signal.throwIfAborted();
      assert.equal(committed, false, "Matrix success can be committed only once");
      assert.equal(resources.size, 0, "Matrix success requires collected resources");
      assert.equal(failures.length, 0, "Matrix success cannot follow failed collection");
      const result = publish();
      committed = true;
      return result;
    },
    own(name: string, close: () => Promise<void>) {
      assert.equal(committed, false, "Cannot acquire resources after matrix success");
      let closing: Promise<void> | undefined;
      const resource = { name, close() {
        closing ??= Promise.resolve().then(close).then(() => { resources.delete(resource); }, (cause: unknown) => {
          failures.push(cause);
          throw cause;
        });
        return closing;
      } };
      resources.add(resource);
      if (controller.signal.aborted) void drain();
      return resource.close;
    },
    async close() {
      await drain();
      if (resources.size !== 0 || failures.length !== 0) {
        throw new UncollectedViteMatrixResourceError("Vite matrix resources remain uncollected; preserve failed evidence", {
          cause: new AggregateError(failures, [...resources].map(({ name }) => name).join(", ")),
        });
      }
    },
    dispose() {
      assert.equal(resources.size, 0, "Cannot dispose matrix custody with uncollected resources");
      signals.off("SIGINT", interrupt);
      signals.off("SIGTERM", terminate);
    },
  };
}

export type ViteMatrixCustody = ReturnType<typeof createViteMatrixCustody>;

/** Own an acquisition before awaiting it, including resources arriving after cancellation. */
export async function acquireViteMatrixResource<T>(
  custody: ViteMatrixCustody, name: string, acquire: () => Promise<T>, release: (value: T) => Promise<void>,
): Promise<Readonly<{ value: T; close(): Promise<void> }>> {
  custody.check();
  const pending = Promise.resolve().then(() => { custody.check(); return acquire(); });
  const close = custody.own(name, async () => {
    // A rejected acquisition supplied no resource. Successfully acquired values
    // must be closed even if cancellation happened while awaiting them.
    const acquired = await pending.then((value) => ({ value }), () => undefined);
    if (acquired !== undefined) await release(acquired.value);
  });
  try {
    const value = await pending;
    custody.check();
    return { value, close };
  } catch (cause) {
    try { await close(); }
    catch (collection) { throw new AggregateError([cause, collection], `Failed to collect ${name} after acquisition failed`); }
    throw cause;
  }
}

export function childClosed(child: ChildProcess): Promise<Readonly<{ code: number | null; signal: NodeJS.Signals | null }>> {
  return new Promise((resolve) => child.once("close", (code, signal) => resolve({ code, signal })));
}

/** A cooperative owner may itself own detached children. Let its signal handler
 * finish those children, including a pending 30-second browser acquisition,
 * before collecting its group. Never KILL it early and strand an unknown child. */
export function ownViteMatrixCancellationOwner(
  command: readonly string[], cwd: string, custody: ViteMatrixCustody,
  verifyCollected?: (child: ChildProcess) => Promise<void>,
) {
  custody.check();
  assert.ok(process.platform === "darwin" || process.platform === "linux");
  assert.ok(command[0] !== undefined);
  const child = spawn(command[0], command.slice(1), { cwd, detached: true, stdio: ["ignore", "pipe", "pipe"] });
  const closed = childClosed(child);
  let terminal = false;
  void closed.then(() => { terminal = true; });
  const spawned = new Promise<void>((resolve, reject) => { child.once("spawn", resolve); child.once("error", reject); });
  // Cancellation may precede the caller awaiting spawn. Retain the rejection
  // for that caller without allowing an unhandled rejection during collection.
  void spawned.catch(() => undefined);
  const group = viteMatrixGroup(child.pid);
  const close = custody.own(`cooperative cancellation owner ${String(child.pid)}`, async () => {
    await spawned.catch(() => undefined);
    if (!terminal && group.probe()) group.signal("SIGTERM");
    await matrixDeadline(closed, 55_000, "Cooperative owner did not collect its nested resources; retain ownership evidence");
    await collectViteMatrixGroup(group);
    // A browser worker's detached Chromium group is not part of this owner
    // group. Its request-bound receipt is mandatory even on terminal failure.
    await verifyCollected?.(child);
  });
  return { child, closed, spawned, group, close };
}

export async function waitForViteMatrixJson(path: string, signal: AbortSignal): Promise<unknown> {
  const { readFile } = await import("node:fs/promises");
  for (let attempt = 0; attempt < 1_200; attempt += 1) {
    signal.throwIfAborted();
    try {
      const source = await readFile(path, { encoding: "utf8", signal });
      signal.throwIfAborted();
      return JSON.parse(source) as unknown;
    } catch (error) {
      signal.throwIfAborted();
      if ((error as NodeJS.ErrnoException).code !== "ENOENT" && !(error instanceof SyntaxError)) throw error;
    }
    await new Promise<void>((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`Regression owner did not publish ${path}`);
}

export async function runViteMatrixCommand(
  command: readonly string[], cwd: string, environment: NodeJS.ProcessEnv, custody: ViteMatrixCustody,
  timeoutMs = 300_000,
): Promise<void> {
  assert.ok(process.platform === "darwin" || process.platform === "linux", "The Vite matrix requires POSIX process groups");
  custody.check();
  const executable = command[0];
  assert.ok(executable !== undefined);
  const child = spawn(executable, command.slice(1), { cwd, env: environment, detached: true, stdio: ["ignore", "pipe", "pipe"] });
  const closed = childClosed(child);
  const stdout = createBoundedDiagnostics();
  const stderr = createBoundedDiagnostics();
  child.stdout.on("data", (bytes: Buffer) => stdout.append(bytes));
  child.stderr.on("data", (bytes: Buffer) => stderr.append(bytes));
  const group = viteMatrixGroup(child.pid);
  const close = custody.own(`command process group ${String(child.pid)}`, async () => {
    await collectViteMatrixGroup(group);
    await matrixDeadline(closed, 5_000, "Vite command streams did not close after group collection");
  });
  let abort: (() => void) | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const interrupted = new Promise<never>((_, reject) => {
      abort = () => reject(custody.signal.reason);
      custody.signal.addEventListener("abort", abort, { once: true });
      if (custody.signal.aborted) abort();
      child.once("error", reject);
      timer = setTimeout(() => reject(new Error(`Vite command timed out: ${command.join(" ")}`)), timeoutMs);
    });
    const result = await Promise.race([closed, interrupted]);
    custody.check();
    assert.equal(group.probe(), false, "Vite command leader exited with a surviving process group");
    assert.equal(result.signal, null);
    assert.equal(result.code, 0, `Vite command failed: ${command.join(" ")}`);
  } finally {
    if (abort !== undefined) custody.signal.removeEventListener("abort", abort);
    if (timer !== undefined) clearTimeout(timer);
    try { await close(); }
    finally {
      process.stdout.write(stdout.render("stdout"));
      process.stderr.write(stderr.render("stderr"));
    }
  }
}

/** This file survives disposable consumers and is durable before their removal. */
export async function writeViteMatrixSuccessReceipt(
  directory: string, name: string, value: unknown, custody: ViteMatrixCustody,
  beforeCommit?: () => Promise<void>,
) {
  custody.check();
  assert.match(name, /^vite78-production-[A-Za-z0-9_-]+\.json$/u);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  assert.equal(await realpath(directory), directory);
  assert.ok((await lstat(directory)).isDirectory());
  const source = `${JSON.stringify(value)}\n`;
  assert.ok(Buffer.byteLength(source) <= 4 * 1024 * 1024, "Matrix receipt exceeds its 4 MiB bound");
  const path = join(directory, name);
  const pending = join(directory, `.${name}.${randomUUID()}.pending`);
  const handle = await open(pending, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
  let identity = await handle.stat();
  try { await handle.writeFile(source, "utf8"); await handle.sync(); identity = await handle.stat(); }
  finally { await handle.close(); }
  // Failed/cancelled staging stays private and retained. The final name is never
  // visible with partial bytes, and link's exclusive semantics forbid replacement.
  await beforeCommit?.();
  return custody.commit(() => {
    assert.equal(realpathSync(directory), directory);
    const staged = lstatSync(pending);
    assert.ok(staged.isFile() && staged.nlink === 1);
    const fileIdentity = (stat: typeof staged) => [stat.dev, stat.ino, stat.mode, stat.nlink, stat.size, stat.mtimeMs, stat.ctimeMs];
    assert.deepEqual(fileIdentity(staged), fileIdentity(identity), "Staged receipt identity changed before commit");
    assert.equal(staged.size, Buffer.byteLength(source));
    // Persist a newly created receipt directory in its already-owned parent.
    const container = openSync(dirname(directory), constants.O_RDONLY | constants.O_NOFOLLOW);
    try { fsyncSync(container); } finally { closeSync(container); }
    const parent = openSync(directory, constants.O_RDONLY | constants.O_NOFOLLOW);
    let published = false;
    try {
      linkSync(pending, path);
      published = true;
      fsyncSync(parent);
    } catch (cause) {
      if (published) {
        const current = lstatSync(path);
        assert.ok(current.dev === staged.dev && current.ino === staged.ino, "Receipt publication identity changed; preserve evidence");
        unlinkSync(path);
        fsyncSync(parent);
      }
      throw cause;
    } finally { closeSync(parent); }
    // Keep the private staged link as failure-independent evidence. No fallible
    // cleanup follows the commit or can turn a committed proof into failure.
    return { path, bytes: Buffer.byteLength(source), sha256: createHash("sha256").update(source).digest("hex") };
  });
}
