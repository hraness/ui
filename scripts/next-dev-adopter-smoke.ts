import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { createHash } from "node:crypto";
import { cp, lstat, mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { delimiter, join, resolve } from "node:path";
import { chromium } from "playwright-core";

import { verifyNextDevAdopter, verifyNextDevStableRestarts } from "../fixtures/next-dev-adopter/verify.ts";
import { resolveFirstBrowserExecutable } from "./browser-executable.ts";
import { createNextDevDiagnostics, createNextStartupErrorReader } from "./next-dev-diagnostics.ts";
import { retainStoppedNextLog } from "./next-dev-restart.ts";

const NEXT_VERSION = "16.2.12";
const MAX_SOURCE_FILES = 64;
type OwnedProcess = Readonly<{
  child: ChildProcess;
  exited: Promise<Readonly<{ code: number | null; signal: NodeJS.Signals | null }>>;
  diagnostics: () => string;
}>;

function start(command: readonly string[], cwd: string, env: NodeJS.ProcessEnv): OwnedProcess {
  assert.ok(command.length > 0);
  const log = createNextDevDiagnostics();
  const child = spawn(command[0]!, command.slice(1), { cwd, env, detached: process.platform !== "win32", stdio: ["ignore", "pipe", "pipe"] });
  child.stdout!.on("data", (chunk: Buffer) => log.append(chunk));
  child.stderr!.on("data", (chunk: Buffer) => log.append(chunk));
  const exited = new Promise<Readonly<{ code: number | null; signal: NodeJS.Signals | null }>>((resolveExit, reject) => {
    child.once("error", reject);
    child.once("close", (code, signal) => resolveExit({ code, signal }));
  });
  // Readiness and termination race this promise; attach a rejection handler
  // immediately so spawn failure cannot become an unhandled rejection.
  void exited.catch(() => undefined);
  return { child, exited, diagnostics: log.take };
}

function signalOwned(processHandle: OwnedProcess, signal: NodeJS.Signals): void {
  const pid = processHandle.child.pid;
  if (pid === undefined) return;
  try {
    if (process.platform === "win32") processHandle.child.kill(signal);
    else process.kill(-pid, signal);
  } catch (error) {
    if (!(typeof error === "object" && error !== null && "code" in error && error.code === "ESRCH")) throw error;
  }
}

function groupExists(processHandle: OwnedProcess): boolean {
  const pid = processHandle.child.pid;
  if (pid === undefined) return false;
  if (process.platform === "win32") return processHandle.child.exitCode === null && processHandle.child.signalCode === null;
  try { process.kill(-pid, 0); return true; }
  catch (error) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "ESRCH") return false;
    throw error;
  }
}

async function stop(processHandle: OwnedProcess): Promise<void> {
  if (groupExists(processHandle)) signalOwned(processHandle, "SIGTERM");
  const deadline = Date.now() + 5_000;
  while (groupExists(processHandle) && Date.now() < deadline) await Bun.sleep(50);
  if (groupExists(processHandle)) signalOwned(processHandle, "SIGKILL");
  await processHandle.exited;
  const settle = Date.now() + 5_000;
  while (groupExists(processHandle) && Date.now() < settle) await Bun.sleep(50);
  assert.equal(groupExists(processHandle), false, "Next development fixture retained an owned process-group survivor");
}

async function run(command: readonly string[], cwd: string, env: NodeJS.ProcessEnv, timeoutMs = 300_000): Promise<void> {
  const owned = start(command, cwd, env);
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const result = await Promise.race([
      owned.exited,
      new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error(`Fixture command exceeded ${String(timeoutMs)}ms`)), timeoutMs); }),
    ]);
    assert.equal(result.signal, null, "Next fixture command was signalled");
    assert.equal(result.code, 0, "Next fixture command failed");
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    try { await stop(owned); }
    finally { process.stdout.write(owned.diagnostics()); }
  }
}

function node24(): string {
  const executable = process.platform === "win32" ? "node.exe" : "node";
  for (const path of (process.env.PATH ?? "").split(delimiter).filter(Boolean)) {
    const candidate = resolve(path, executable);
    try {
      const probe = Bun.spawnSync([candidate, "--eval", 'if(typeof Bun!=="undefined" || !process.versions.node.startsWith("24.")) process.exit(1)'], { stdout: "ignore", stderr: "ignore", stdin: "ignore" });
      if (probe.exitCode === 0) return candidate;
    } catch { /* Continue to the next installed genuine Node executable. */ }
  }
  throw new Error("Next development smoke requires genuine Node 24 on PATH");
}

async function unusedLoopbackPort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolveListen, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolveListen); });
  const address = server.address();
  assert.ok(address !== null && typeof address !== "string");
  await new Promise<void>((resolveClose, reject) => server.close((error) => error ? reject(error) : resolveClose()));
  return address.port;
}

async function ready(origin: string, owned: OwnedProcess, consumer: string): Promise<void> {
  // Initial clean startup has no expected failures. HMR negative cases run only
  // after this function returns and never pass through this error monitor.
  const readStartupFailure = createNextStartupErrorReader(join(consumer, ".next/dev/logs/next-development.log"));
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    const priorError = await readStartupFailure();
    assert.equal(priorError, null, `Next initial startup server error: ${priorError ?? ""}`);
    const outcome = await Promise.race([
      fetch(origin, { signal: AbortSignal.timeout(2_000) }).then(async (response) => { await response.body?.cancel(); return { kind: "http" as const, status: response.status, ok: response.ok }; }, () => ({ kind: "wait" as const })),
      owned.exited.then(() => ({ kind: "exit" as const })),
    ]);
    assert.notEqual(outcome.kind, "exit", "Next development child exited before readiness");
    const error = await readStartupFailure();
    assert.equal(error, null, `Next initial startup server error: ${error ?? ""}`);
    if (outcome.kind === "http") {
      assert.ok(outcome.status < 400, `Next initial route returned HTTP ${String(outcome.status)}`);
      if (outcome.ok) return;
    }
    await Bun.sleep(100);
  }
  throw new Error("Next development fixture did not become ready within 120000ms");
}

async function sourceInventory(root: string): Promise<Readonly<Record<string, string>>> {
  const entries: Record<string, string> = {};
  const visit = async (directory: string, prefix: string): Promise<void> => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      assert.ok(!entry.isSymbolicLink(), "Next development fixture source must not contain symlinks");
      const logical = prefix.length === 0 ? entry.name : `${prefix}/${entry.name}`;
      if (entry.isDirectory()) await visit(join(directory, entry.name), logical);
      else {
        assert.ok(entry.isFile());
        assert.ok(Object.keys(entries).length < MAX_SOURCE_FILES, "Next development fixture source exceeded its file bound");
        const absolute = join(directory, entry.name);
        assert.ok((await lstat(absolute)).size <= 1024 * 1024);
        entries[logical] = createHash("sha256").update(await readFile(absolute)).digest("hex");
      }
    }
  };
  await visit(root, "");
  return Object.fromEntries(Object.entries(entries).sort(([left], [right]) => left.localeCompare(right, "en")));
}

assert.equal(Bun.version, "1.3.14");
assert.notEqual(process.platform, "win32", "This browser fixture requires owned POSIX process-group cleanup");
const repository = await realpath(process.cwd());
const fixtures = resolve(repository, ".stylex-fixtures");
await mkdir(fixtures, { recursive: true });
assert.equal(await realpath(fixtures), fixtures);
assert.ok((await lstat(fixtures)).isDirectory());
const node = node24();
const browserPath = await resolveFirstBrowserExecutable([
  ...(process.env.CHROMIUM_EXECUTABLE_PATH ? [process.env.CHROMIUM_EXECUTABLE_PATH] : []),
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
  "/usr/bin/google-chrome",
  "/usr/bin/google-chrome-stable",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
], "Next development smoke requires an installed Chrome or Chromium executable");
const work = await realpath(await mkdtemp(join(fixtures, "next-dev-adopter-")));
const temporary = join(work, "tmp");
await mkdir(temporary, { mode: 0o700 });
const env = { ...process.env, BUN_TMPDIR: temporary, TMPDIR: temporary, NEXT_TELEMETRY_DISABLED: "1", NODE_ENV: "development" };
const sourceBefore = await sourceInventory(join(repository, "fixtures/next-dev-adopter"));
let success = false;
let restartEvidenceRoot: string | undefined;
try {
  const archive = join(work, "hraness-ui.tgz");
  await run([process.execPath, "pm", "pack", "--filename", archive, "--ignore-scripts", "--quiet"], repository, env);
  const browser = await chromium.launch({ executablePath: browserPath, headless: true });
  try {
    const receipts = [];
    for (const variant of ["edge", "no-edge"] as const) {
      const consumer = join(work, variant);
      await mkdir(consumer);
      await cp(join(repository, "fixtures/next-dev-adopter/app"), join(consumer, "app"), { recursive: true });
      await cp(join(repository, "fixtures/next-dev-adopter/next.config.mjs"), join(consumer, "next.config.mjs"));
      if (variant === "no-edge") {
        const path = join(consumer, "app/unvisited/page.tsx");
        const source = await readFile(path, "utf8");
        const declaration = 'export const runtime = "edge";\n';
        assert.equal(source.split(declaration).length, 2, "No-Edge fixture must remove exactly one Edge declaration");
        await writeFile(path, source.replace(declaration, ""));
      }
      const before = await sourceInventory(join(consumer, "app"));
      await writeFile(join(consumer, "package.json"), `${JSON.stringify({
        name: `hraness-packed-next-dev-${variant}`, private: true, type: "module",
        dependencies: {
          "@hraness/ui": `file:${archive}`, "@babel/core": "7.29.7", "@stylexjs/babel-plugin": "0.19.0", "@stylexjs/stylex": "0.19.0",
          "@types/node": "24.13.3", "@types/react": "19.2.14", "@types/react-dom": "19.2.3", lightningcss: "1.33.0",
          next: NEXT_VERSION, react: "19.2.3", "react-dom": "19.2.3", typescript: "6.0.3",
        },
      }, null, 2)}\n`, { flag: "wx" });
      await run([process.execPath, "install", "--ignore-scripts"], consumer, env);
      const lock = await readFile(join(consumer, "bun.lock"));
      await run([process.execPath, "install", "--frozen-lockfile", "--ignore-scripts"], consumer, env);
      assert.ok((await readFile(join(consumer, "bun.lock"))).equals(lock));
      const installed: unknown = JSON.parse(await readFile(join(consumer, "node_modules/next/package.json"), "utf8"));
      assert.ok(typeof installed === "object" && installed !== null && "version" in installed && installed.version === NEXT_VERSION);
      const port = await unusedLoopbackPort();
      const origin = `http://127.0.0.1:${String(port)}`;
      const command = [node, "./node_modules/next/dist/bin/next", "dev", "--webpack", "--hostname", "127.0.0.1", "--port", String(port)];
      let server = start(command, consumer, env);
      const restartLogs: Awaited<ReturnType<typeof retainStoppedNextLog>>[] = [];
      try {
        await ready(origin, server, consumer);
        const context = await browser.newContext({ serviceWorkers: "block", viewport: { width: 1280, height: 900 } });
        try {
          const external: string[] = [];
          await context.route("**/*", async (route) => {
            const request = new URL(route.request().url());
            if (request.origin === origin) await route.continue();
            else { external.push(request.origin); await route.abort(); }
          });
          const hotPage = await context.newPage();
          let proof: Awaited<ReturnType<typeof verifyNextDevAdopter>>;
          try { proof = await verifyNextDevAdopter(hotPage, origin, consumer, variant === "edge"); }
          finally { await hotPage.close(); }
          const restart = async (beforeStart?: () => Promise<void>): Promise<void> => {
            try { await stop(server); } finally { process.stdout.write(server.diagnostics()); }
            const reachable = await fetch(origin, { signal: AbortSignal.timeout(1_000) }).then(async (response) => { await response.body?.cancel(); return true; }, () => false);
            assert.equal(reachable, false, "Next restart retained its prior listener");
            // Retain prior process evidence outside the disposable consumer's
            // success-cleanup subtree, before Next can truncate its log.
            restartEvidenceRoot ??= await realpath(await mkdtemp(join(fixtures, "next-dev-restart-logs-")));
            const log = await retainStoppedNextLog(consumer, restartEvidenceRoot, () => {
              assert.equal(groupExists(server), false, "Cannot rotate a live Next process log");
            });
            restartLogs.push(log);
            process.stdout.write(`${JSON.stringify({ kind: "next-dev-retained-restart-log", variant, restart: restartLogs.length, evidenceRoot: restartEvidenceRoot, ...log })}\n`);
            await beforeStart?.();
            server = start(command, consumer, env);
            await ready(origin, server, consumer);
          };
          // The hot-update verifier restores its disposable edits. Start clean
          // before the distinct token-restart contract; never assert state
          // preservation across an explicitly required process restart.
          await restart();
          const stableRestarts = await verifyNextDevStableRestarts(await context.newPage(), origin, consumer, variant === "edge", restart);
          assert.deepEqual(external, [], "Next development fixture attempted a non-loopback request");
          assert.deepEqual(await sourceInventory(join(consumer, "app")), before, "Next development verifier failed to restore exact disposable sources");
          receipts.push({ variant, ...proof, stableRestarts, restartLogs });
        } finally { await context.close(); }
      } finally {
        try { await stop(server); }
        finally { process.stdout.write(server.diagnostics()); }
      }
      const reachable = await fetch(origin, { signal: AbortSignal.timeout(1_000) }).then(async (response) => { await response.body?.cancel(); return true; }, () => false);
      assert.equal(reachable, false, "Next development fixture left its listener reachable");
    }
    assert.deepEqual(await sourceInventory(join(repository, "fixtures/next-dev-adopter")), sourceBefore, "Next development smoke modified authored fixture sources");
    const evidence = { kind: "hraness-next-development-browser-matrix", next: NEXT_VERSION, node: Bun.spawnSync([node, "--version"]).stdout.toString().trim(), browser: browser.version(), receipts, restartEvidenceRoot, survivors: 0 };
    assert(restartEvidenceRoot !== undefined, "Restart matrix must retain its exact prior log evidence");
    await writeFile(join(restartEvidenceRoot, "matrix.json"), JSON.stringify(evidence, null, 2) + "\n", { flag: "wx", mode: 0o600 });
    process.stdout.write(`${JSON.stringify(evidence)}\n`);
    success = true;
  } finally { await browser.close(); }
} finally {
  if (success) {
    assert.equal(await realpath(work), work);
    assert.ok(work.startsWith(`${fixtures}/next-dev-adopter-`) && (await lstat(work)).isDirectory());
    await rm(work, { recursive: true });
  } else process.stderr.write(`Retained failed Next development fixture: ${work}\n`);
  if (restartEvidenceRoot !== undefined) process.stdout.write(`Retained Next restart log evidence: ${restartEvidenceRoot}\n`);
}
