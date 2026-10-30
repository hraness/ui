import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { lstatSync, realpathSync } from "node:fs";
import { resolve } from "node:path";

type ProcessOptions = Readonly<{
  args: readonly string[];
  command: string;
  cwd: string;
  env: NodeJS.ProcessEnv;
  signal?: AbortSignal;
}>;

const exportCollectionBrand = Symbol("Next export child collection");
export type StylexNextExportCollection = Readonly<{ [exportCollectionBrand]: true }>;
type ExportCollectionBinding = Readonly<{ attemptId: string; planSha256: string; root: string }>;
const exportCollections = new WeakMap<StylexNextExportCollection, ExportCollectionBinding & { device: number; inode: number }>();

/** This token proves only successful child/group collection, not build or
 * export acceptance. It is process-local, origin-bound and usable once. */
export async function runOwnedStylexNextExportDiscoveryProcess(options: ProcessOptions & Readonly<{
  attemptId: string;
  planSha256: string;
}>): Promise<StylexNextExportCollection> {
  assert.match(options.attemptId, /^[a-z0-9]+(?:-[a-z0-9]+)*$/u);
  assert.match(options.planSha256, /^[a-f0-9]{64}$/u);
  const root = resolve(options.cwd);
  assert.equal(realpathSync(root), root, "Next export process root must be physical");
  const before = lstatSync(root);
  assert.ok(before.isDirectory() && !before.isSymbolicLink());
  const binding = { attemptId: options.attemptId, planSha256: options.planSha256, root, device: before.dev, inode: before.ino };
  await runOwnedStylexNextProcess({ ...options, cwd: root });
  const after = lstatSync(root);
  assert.ok(after.isDirectory() && !after.isSymbolicLink());
  assert.equal(realpathSync(root), root);
  assert.equal(after.dev, before.dev, "Next export process root device changed");
  assert.equal(after.ino, before.ino, "Next export process root identity changed");
  const token: StylexNextExportCollection = Object.freeze({ [exportCollectionBrand]: true });
  exportCollections.set(token, binding);
  return token;
}

export function consumeStylexNextExportCollection(token: StylexNextExportCollection, expected: ExportCollectionBinding): void {
  const binding = exportCollections.get(token);
  assert.ok(binding, "Next export retention requires a fresh collected-child token");
  exportCollections.delete(token);
  assert.equal(binding.attemptId, expected.attemptId, "Next export child belongs to another attempt");
  assert.equal(binding.planSha256, expected.planSha256, "Next export child belongs to another plan");
  assert.equal(binding.root, expected.root, "Next export child belongs to another root");
  const current = lstatSync(expected.root);
  assert.ok(current.isDirectory() && !current.isSymbolicLink());
  assert.equal(realpathSync(expected.root), expected.root);
  assert.equal(current.dev, binding.device);
  assert.equal(current.ino, binding.inode, "Next export root changed after child collection");
}

/** This failure forbids shared-file restoration and lease release. */
export class UncollectedNextProcessError extends Error {}

type GroupOperations = Readonly<{
  probe: () => boolean;
  signal: (signal: NodeJS.Signals) => void;
  wait: () => Promise<void>;
}>;

/** A leader exit alone never proves that its detached workers are gone. */
export async function collectStylexNextProcessGroup(operations: GroupOperations): Promise<boolean> {
  try {
    if (!operations.probe()) return false;
    operations.signal("SIGTERM");
    for (let attempt = 0; attempt < 80 && operations.probe(); attempt += 1) await operations.wait();
    if (operations.probe()) operations.signal("SIGKILL");
    for (let attempt = 0; attempt < 80 && operations.probe(); attempt += 1) await operations.wait();
    if (operations.probe()) throw new Error("The owned process group survived collection");
    return true;
  } catch (cause) {
    throw new UncollectedNextProcessError("Next child collection is unproved; retain output and TypeScript ownership", { cause });
  }
}

/** Run one POSIX process group; settle only after a positive group-absent proof. */
export async function runOwnedStylexNextProcess(options: ProcessOptions): Promise<void> {
  assert.ok(process.platform === "darwin" || process.platform === "linux", "StyleX Next process custody supports macOS and Linux only");
  assert.notEqual(options.signal?.aborted, true, "Next child was cancelled before spawn");
  await new Promise<void>((resolvePromise, reject) => {
    const child = spawn(options.command, [...options.args], {
      cwd: options.cwd, detached: true, env: options.env, shell: false, stdio: "inherit",
    });
    let finished = false;
    let closing = false;
    let cancellation: NodeJS.Signals | undefined;
    let escalation: ReturnType<typeof setTimeout> | undefined;
    let deadline: ReturnType<typeof setTimeout> | undefined;
    const errors: unknown[] = [];
    const group: GroupOperations = {
      probe: () => {
        // An error before spawn has no PID and cannot have created descendants.
        if (child.pid === undefined) return false;
        try { process.kill(-child.pid, 0); return true; }
        catch (error) {
          if ((error as NodeJS.ErrnoException).code === "ESRCH") return false;
          throw error;
        }
      },
      signal: (signal) => {
        if (child.pid === undefined) return;
        try { process.kill(-child.pid, signal); }
        catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
        }
      },
      wait: () => new Promise<void>((done) => setTimeout(done, 25)),
    };
    const safeSignal = (signal: NodeJS.Signals): void => {
      try { group.signal(signal); } catch (error) { errors.push(error); }
    };
    const cleanup = (): void => {
      process.off("SIGINT", interrupt);
      process.off("SIGTERM", terminate);
      options.signal?.removeEventListener("abort", abort);
      if (escalation !== undefined) clearTimeout(escalation);
      if (deadline !== undefined) clearTimeout(deadline);
    };
    const finish = (error?: unknown): void => {
      if (finished) return;
      finished = true;
      cleanup();
      if (error === undefined) resolvePromise(); else reject(error);
    };
    const cancel = (signal: NodeJS.Signals): void => {
      if (cancellation !== undefined || finished) return;
      cancellation = signal;
      safeSignal(signal);
      escalation = setTimeout(() => safeSignal("SIGKILL"), 10_000);
      // Never wait forever after a failed signal or an unobservable leader.
      // The caller retains both leases on this exact uncertainty class.
      deadline = setTimeout(() => finish(new UncollectedNextProcessError(
        `Next process group ${String(child.pid)} did not reach a collected terminal state; retain both leases`,
        { cause: new AggregateError(errors, "Next cancellation diagnostics") },
      )), 15_000);
    };
    const interrupt = (): void => cancel("SIGINT");
    const terminate = (): void => cancel("SIGTERM");
    const abort = (): void => cancel("SIGTERM");
    process.on("SIGINT", interrupt);
    process.on("SIGTERM", terminate);
    options.signal?.addEventListener("abort", abort, { once: true });
    if (options.signal?.aborted === true) abort();
    // Wait for close even after error. An error on an already spawned child is
    // not evidence that its group is absent.
    child.once("error", (error) => { errors.push(error); cancel("SIGTERM"); });
    child.once("close", (code, signal) => {
      if (closing || finished) return;
      closing = true;
      void (async () => {
        const descendants = await collectStylexNextProcessGroup(group);
        if (descendants) errors.push(new Error("Next leader left a descendant process running"));
        if (cancellation !== undefined) errors.push(new Error(`Next build cancelled by ${cancellation}`));
        if (code !== 0 || signal !== null) errors.push(new Error(`Next build failed (code ${String(code)}, signal ${String(signal)})`));
        if (errors.length > 0) throw new AggregateError(errors, "Next child failed after confirmed process-group collection");
      })().then(() => finish(), (error: unknown) => finish(error));
    });
  });
}
