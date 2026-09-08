import assert from "node:assert/strict";
import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { createHash } from "node:crypto";
import { closeSync, constants, fsyncSync, linkSync, lstatSync, openSync, realpathSync, unlinkSync } from "node:fs";
import { cp, lstat, mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile } from "node:fs/promises";
import { createConnection, createServer } from "node:net";
import { delimiter, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { verifyNextDevAdopter, verifyNextDevStableRestarts } from "../fixtures/next-dev-adopter/verify.ts";
import { viteMatrixBrowserEndpoint } from "../fixtures/vite8-adopter/browser-endpoint.ts";
import { prepareViteBrowserServer, writeViteBrowserJson } from "../fixtures/vite8-adopter/browser-control.ts";
import {
  acquireViteMatrixResource, childClosed, collectViteMatrixGroup, createViteMatrixCustody,
  matrixDeadline, ownViteMatrixCancellationOwner, viteMatrixGroup, type ViteMatrixCustody,
} from "../fixtures/vite8-adopter/custody.ts";
import { resolveFirstBrowserExecutable } from "./browser-executable.ts";
import { createNextDevDiagnostics, createNextStartupErrorReader } from "./next-dev-diagnostics.ts";
import { retainStoppedNextLog, syncNextEvidenceDirectory } from "./next-dev-restart.ts";
import { snapshotNextFile, snapshotNextPackage } from "./next-dev-inputs.ts";

const NEXT_VERSION = "16.2.12";
const MAX_SOURCE_FILES = 64;
const delay = (milliseconds: number) => new Promise<void>((done) => setTimeout(done, milliseconds));
const sha256 = (bytes: string | Uint8Array) => createHash("sha256").update(bytes).digest("hex");
type OwnedProcess = Readonly<{
  child: ChildProcess;
  exited: Promise<Readonly<{ code: number | null; signal: NodeJS.Signals | null }>>;
  diagnostics: () => string;
  close(): Promise<void>;
}>;

function startProcess(command: readonly string[], cwd: string, env: NodeJS.ProcessEnv, custody: ViteMatrixCustody, groups: number[]): OwnedProcess {
  custody.check();
  assert.ok(command.length > 0 && command[0] !== undefined);
  const log = createNextDevDiagnostics();
  const child = spawn(command[0], command.slice(1), { cwd, env, detached: true, shell: false, stdio: ["ignore", "pipe", "pipe"] });
  const exited = childClosed(child);
  const group = viteMatrixGroup(child.pid);
  if (child.pid !== undefined) groups.push(child.pid);
  child.stdout!.on("data", (chunk: Buffer) => log.append(chunk));
  child.stderr!.on("data", (chunk: Buffer) => log.append(chunk));
  const close = custody.own("Next fixture process " + String(child.pid), async () => {
    await collectViteMatrixGroup(group);
    await matrixDeadline(exited, 5_000, "Next fixture process streams did not close after group collection");
  });
  const spawned = new Promise<void>((done, reject) => { child.once("spawn", done); child.once("error", reject); });
  const observedExit = spawned.then(() => exited);
  void observedExit.catch(() => undefined);
  return { child, exited: observedExit, diagnostics: log.take, close };
}

function groupExists(processHandle: OwnedProcess): boolean {
  return viteMatrixGroup(processHandle.child.pid).probe();
}

async function stop(processHandle: OwnedProcess): Promise<void> {
  await processHandle.close();
  assert.equal(groupExists(processHandle), false, "Next development fixture retained an owned process-group survivor");
}

async function runCommand(command: readonly string[], cwd: string, env: NodeJS.ProcessEnv, custody: ViteMatrixCustody, groups: number[], timeoutMs = 300_000): Promise<void> {
  const owned = startProcess(command, cwd, env, custody, groups);
  let timer: ReturnType<typeof setTimeout> | undefined;
  let abort: (() => void) | undefined;
  try {
    const result = await Promise.race([
      owned.exited,
      new Promise<never>((_, reject) => {
        abort = () => reject(custody.signal.reason);
        custody.signal.addEventListener("abort", abort, { once: true });
        if (custody.signal.aborted) abort();
        timer = setTimeout(() => reject(new Error("Fixture command exceeded " + String(timeoutMs) + "ms")), timeoutMs);
      }),
    ]);
    custody.check();
    assert.equal(groupExists(owned), false, "Fixture command leader exited before collecting its process group");
    assert.equal(result.signal, null, "Next fixture command was signalled");
    assert.equal(result.code, 0, "Next fixture command failed");
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    if (abort !== undefined) custody.signal.removeEventListener("abort", abort);
    try { await stop(owned); }
    finally { process.stdout.write(owned.diagnostics()); }
  }
}

function node24(): string {
  for (const path of (process.env.PATH ?? "").split(delimiter).filter(Boolean)) {
    const candidate = resolve(path, "node");
    try {
      execFileSync(candidate, ["--eval", 'if(typeof Bun!=="undefined" || !process.versions.node.startsWith("24.")) process.exit(1)'], { stdio: "ignore", timeout: 2_000 });
      return candidate;
    } catch { /* Continue to the next installed genuine Node executable. */ }
  }
  throw new Error("Next development smoke requires genuine Node 24 on PATH");
}

async function listenerReachable(origin: string): Promise<boolean> {
  const url = new URL(origin);
  assert.ok(/^http:\/\/127\.0\.0\.1:[1-9][0-9]{0,4}$/u.test(origin) && Number(url.port) <= 65_535);
  return new Promise((done, reject) => {
    const socket = createConnection({ host: "127.0.0.1", port: Number(url.port) });
    let connected = false;
    let failure: unknown;
    socket.once("connect", () => { connected = true; socket.destroy(); });
    socket.once("error", (error: NodeJS.ErrnoException) => { if (error.code !== "ECONNREFUSED") failure = error; });
    socket.setTimeout(1_000, () => { failure = new Error("Loopback listener collection probe timed out"); socket.destroy(); });
    socket.once("close", () => failure === undefined ? done(connected) : reject(failure));
  });
}

async function unusedLoopbackPort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolveListen, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolveListen); });
  const address = server.address();
  assert.ok(address !== null && typeof address !== "string");
  await new Promise<void>((resolveClose, reject) => server.close((error) => error ? reject(error) : resolveClose()));
  return address.port;
}

async function ready(origin: string, owned: OwnedProcess, consumer: string, custody: ViteMatrixCustody): Promise<void> {
  // Initial clean startup has no expected failures. HMR negative cases run only
  // after this function returns and never pass through this error monitor.
  const readStartupFailure = createNextStartupErrorReader(join(consumer, ".next/dev/logs/next-development.log"));
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    custody.check();
    const priorError = await readStartupFailure();
    assert.equal(priorError, null, `Next initial startup server error: ${priorError ?? ""}`);
    const outcome = await Promise.race([
      fetch(origin, { redirect: "error", signal: AbortSignal.timeout(2_000) }).then(async (response) => { await response.body?.cancel(); return { kind: "http" as const, status: response.status, ok: response.ok }; }, () => ({ kind: "wait" as const })),
      owned.exited.then(() => ({ kind: "exit" as const })),
    ]);
    assert.notEqual(outcome.kind, "exit", "Next development child exited before readiness");
    const error = await readStartupFailure();
    assert.equal(error, null, `Next initial startup server error: ${error ?? ""}`);
    if (outcome.kind === "http") {
      assert.ok(outcome.status < 400, `Next initial route returned HTTP ${String(outcome.status)}`);
      if (outcome.ok) return;
    }
    await delay(100);
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

type WorkerRequest = Readonly<{
  schemaVersion: 1;
  bunExecutable: string;
  browserExecutable: string;
  evidenceRoot: string;
  repository: string;
  work: string;
  archiveSeal: Awaited<ReturnType<typeof snapshotNextFile>>["seal"];
  packageInputs: Awaited<ReturnType<typeof snapshotNextPackage>>;
}>;

function object(value: unknown): Record<string, unknown> {
  assert.ok(typeof value === "object" && value !== null && !Array.isArray(value));
  return value as Record<string, unknown>;
}

async function readRequest(inputPath: string): Promise<WorkerRequest> {
  assert.equal(await realpath(inputPath), inputPath);
  const info = await lstat(inputPath);
  assert.ok(info.isFile() && info.nlink === 1 && info.size <= 262_144);
  const request = object(JSON.parse(await readFile(inputPath, "utf8")) as unknown);
  assert.deepEqual(Object.keys(request).sort(), ["archiveSeal", "browserExecutable", "bunExecutable", "evidenceRoot", "packageInputs", "repository", "schemaVersion", "work"]);
  assert.equal(request.schemaVersion, 1);
  for (const key of ["browserExecutable", "bunExecutable", "evidenceRoot", "repository", "work"] as const) {
    const path = request[key];
    assert.ok(typeof path === "string" && path.length <= 4096 && resolve(path) === path);
    assert.equal(await realpath(path), path);
    const stat = await lstat(path);
    assert.ok(key.endsWith("Executable") ? stat.isFile() : stat.isDirectory());
  }
  const parsed = request as WorkerRequest;
  const fixtures = join(parsed.repository, ".stylex-fixtures");
  assert.equal(dirname(parsed.work), fixtures);
  assert.equal(dirname(parsed.evidenceRoot), fixtures);
  assert.ok(parsed.work.startsWith(join(fixtures, "next-dev-adopter-")));
  assert.ok(parsed.evidenceRoot.startsWith(join(fixtures, "next-dev-evidence-")));
  assert.equal(inputPath, join(parsed.evidenceRoot, "worker-request.json"));
  assert.deepEqual(await snapshotNextPackage(parsed.repository), parsed.packageInputs);
  assert.deepEqual((await snapshotNextFile(join(parsed.work, "hraness-ui.tgz"))).seal, parsed.archiveSeal);
  return parsed;
}

async function acquireBrowser(custody: ViteMatrixCustody, request: WorkerRequest, browserPids: number[]) {
  const { chromium } = await import("playwright-core");
  const ownedServer = await acquireViteMatrixResource(custody, "Next native browser acquisition", async () => {
    const server = await chromium.launchServer({
      executablePath: request.browserExecutable, host: "127.0.0.1", headless: true, timeout: 30_000,
      handleSIGINT: false, handleSIGTERM: false, handleSIGHUP: false,
    });
    let closed: ReturnType<typeof childClosed> | undefined;
    let group: ReturnType<typeof viteMatrixGroup> | undefined;
    const prepared = await prepareViteBrowserServer(custody, async () => {
      let failure: unknown;
      try { await matrixDeadline(server.close(), 5_000, "Next native browser server did not close"); }
      catch (error) { failure = error; }
      if (group !== undefined) await collectViteMatrixGroup(group);
      assert.ok(closed !== undefined, "Next native browser child closure is unproved");
      await matrixDeadline(closed, 5_000, "Next native browser process streams did not close");
      if (failure !== undefined) throw failure;
    }, async () => {
      closed = childClosed(server.process());
      const pid = server.process().pid;
      assert.ok(pid !== undefined && Number.isSafeInteger(pid) && pid > 1);
      const identity = execFileSync("/bin/ps", ["-p", String(pid), "-o", "pid=,ppid=,pgid="], { encoding: "utf8", timeout: 2_000 }).trim().split(/\s+/u).map(Number);
      assert.deepEqual(identity, [pid, process.pid, pid], "Next browser did not establish its owned process group");
      group = viteMatrixGroup(pid);
      browserPids.push(pid);
      await writeViteBrowserJson(join(request.evidenceRoot, "browser-launch.json"), { owner: process.pid, pid });
      return server;
    });
    return { server: prepared.value, closeNative: prepared.close };
  }, ({ closeNative }) => closeNative());
  const connection = await acquireViteMatrixResource(custody, "Next browser connection",
    () => chromium.connect(viteMatrixBrowserEndpoint(ownedServer.value.server.wsEndpoint()), { timeout: 30_000 }),
    async (browser) => {
      await matrixDeadline(browser.close(), 5_000, "Next browser connection did not close");
      assert.equal(browser.isConnected(), false);
    });
  return { browser: connection.value, async close() {
    try { await connection.close(); } finally { await ownedServer.close(); }
  } };
}

async function runWorker(inputPath: string): Promise<void> {
  assert.ok(process.versions.bun === undefined && !("Bun" in globalThis) && /^24\./u.test(process.versions.node), "Next browser worker requires genuine Node 24");
  const custody = createViteMatrixCustody();
  const request = await readRequest(inputPath);
  const requestSha256 = sha256(await readFile(inputPath));
  const { repository, work, evidenceRoot: restartEvidenceRoot } = request;
  const node = process.execPath;
  const temporary = join(work, "tmp");
  const env = { ...process.env, BUN_TMPDIR: temporary, TMPDIR: temporary, NEXT_TELEMETRY_DISABLED: "1", NODE_ENV: "development" };
  const sourceBefore = await sourceInventory(join(repository, "fixtures/next-dev-adopter"));
  const processGroups: number[] = [];
  const browserPids: number[] = [];
  const listeners: string[] = [];
  const run = (command: readonly string[], cwd: string, environment: NodeJS.ProcessEnv) => runCommand(command, cwd, environment, custody, processGroups);
  let evidence: unknown = null;
  let failure: unknown;
  try {
    assert.equal(execFileSync(request.bunExecutable, ["--version"], { encoding: "utf8", timeout: 2_000 }).trim(), "1.3.14");
    await mkdir(temporary, { mode: 0o700 });
    const archive = join(work, "hraness-ui.tgz");
    assert.deepEqual((await snapshotNextFile(archive)).seal, request.archiveSeal);
    const ownedBrowser = await acquireBrowser(custody, request, browserPids);
    const browser = ownedBrowser.browser;
    try {
      const receipts = [];
      for (const variant of ["edge", "no-edge"] as const) {
        custody.check();
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
            "@hraness/ui": `file:${archive}`, "@babel/core": "7.29.7", "@types/babel__core": "7.20.5", "@stylexjs/babel-plugin": "0.19.0", "@stylexjs/stylex": "0.19.0",
            "@types/node": "24.13.3", "@types/react": "19.2.14", "@types/react-dom": "19.2.3", lightningcss: "1.33.0",
            next: NEXT_VERSION, react: "19.2.3", "react-dom": "19.2.3", typescript: "6.0.3",
          },
        }, null, 2)}\n`, { flag: "wx" });
        await run([request.bunExecutable, "install", "--ignore-scripts"], consumer, env);
        const lock = await readFile(join(consumer, "bun.lock"));
        await run([request.bunExecutable, "install", "--frozen-lockfile", "--ignore-scripts"], consumer, env);
        assert.ok((await readFile(join(consumer, "bun.lock"))).equals(lock));
        assert.deepEqual((await snapshotNextFile(archive)).seal, request.archiveSeal);
        assert.deepEqual(await snapshotNextPackage(join(consumer, "node_modules/@hraness/ui")), request.packageInputs,
          "Installed fixture package differs from the coordinator's exact packed sources");
        const installed: unknown = JSON.parse(await readFile(join(consumer, "node_modules/next/package.json"), "utf8"));
        assert.ok(typeof installed === "object" && installed !== null && "version" in installed && installed.version === NEXT_VERSION);
        const port = await unusedLoopbackPort();
        const origin = `http://127.0.0.1:${String(port)}`;
        const command = [node, "./node_modules/next/dist/bin/next", "dev", "--webpack", "--hostname", "127.0.0.1", "--port", String(port)];
        listeners.push(origin);
        let server = startProcess(command, consumer, env, custody, processGroups);
        const restartLogs: Awaited<ReturnType<typeof retainStoppedNextLog>>[] = [];
        try {
          await ready(origin, server, consumer, custody);
          const ownedContext = await acquireViteMatrixResource(custody, "Next browser context",
            () => browser.newContext({ serviceWorkers: "block", viewport: { width: 1280, height: 900 } }),
            (context) => matrixDeadline(context.close(), 5_000, "Next browser context did not close"));
          const context = ownedContext.value;
          try {
            const external: string[] = [];
            await context.route("**/*", async (route) => {
              const request = new URL(route.request().url());
              if (request.origin === origin) await route.continue();
              else { external.push(request.origin); await route.abort(); }
            });
            await context.routeWebSocket("**/*", (socket) => {
              const url = new URL(socket.url());
              if (url.protocol === "ws:" && url.host === new URL(origin).host && url.pathname === "/_next/webpack-hmr"
                && url.username === "" && url.password === "" && url.hash === "") socket.connectToServer();
              else { external.push(url.origin); socket.close({ code: 1008, reason: "Outside the owned HMR endpoint" }); }
            });
            const hotPage = await context.newPage();
            let proof: Awaited<ReturnType<typeof verifyNextDevAdopter>>;
            try { proof = await verifyNextDevAdopter(hotPage, origin, consumer, variant === "edge"); }
            finally { await hotPage.close(); }
            const restart = async (beforeStart?: () => Promise<void>): Promise<void> => {
              try { await stop(server); } finally { process.stdout.write(server.diagnostics()); }
              const reachable = await listenerReachable(origin);
              assert.equal(reachable, false, "Next restart retained its prior listener");
              // Retain prior process evidence outside the disposable consumer's
              // success-cleanup subtree, before Next can truncate its log.
              const log = await retainStoppedNextLog(consumer, restartEvidenceRoot, () => {
                assert.equal(groupExists(server), false, "Cannot rotate a live Next process log");
              });
              restartLogs.push(log);
              process.stdout.write(`${JSON.stringify({ kind: "next-dev-retained-restart-log", variant, restart: restartLogs.length, evidenceRoot: restartEvidenceRoot, ...log })}\n`);
              await beforeStart?.();
              server = startProcess(command, consumer, env, custody, processGroups);
              await ready(origin, server, consumer, custody);
            };
            // The hot-update verifier restores its disposable edits. Start clean
            // before the distinct token-restart contract; never assert state
            // preservation across an explicitly required process restart.
            await restart();
            const stableRestarts = await verifyNextDevStableRestarts(await context.newPage(), origin, consumer, variant === "edge", restart);
            assert.deepEqual(external, [], "Next development fixture attempted a non-loopback request");
            assert.deepEqual(await sourceInventory(join(consumer, "app")), before, "Next development verifier failed to restore exact disposable sources");
            receipts.push({ variant, ...proof, stableRestarts, restartLogs });
          } finally { await ownedContext.close(); }
        } finally {
          try { await stop(server); }
          finally { process.stdout.write(server.diagnostics()); }
        }
        const reachable = await listenerReachable(origin);
        assert.equal(reachable, false, "Next development fixture left its listener reachable");
      }
      assert.deepEqual(await sourceInventory(join(repository, "fixtures/next-dev-adopter")), sourceBefore, "Next development smoke modified authored fixture sources");
      assert.deepEqual(await snapshotNextPackage(repository), request.packageInputs);
      assert.deepEqual((await snapshotNextFile(archive)).seal, request.archiveSeal);
      evidence = { kind: "hraness-next-development-browser-matrix", next: NEXT_VERSION, node: process.versions.node, browser: browser.version(), archiveSha256: sha256(await readFile(archive)), receipts };
    } finally { await ownedBrowser.close(); }
  } catch (error) {
    failure = error;
  } finally {
    // An uncertain close retains the worker and all evidence without a terminal
    // record. The Bun owner independently probes every reported process group.
    await custody.close();
    assert.equal(custody.activeResources, 0);
    for (const pid of [...processGroups, ...browserPids]) assert.equal(viteMatrixGroup(pid).probe(), false);
    for (const origin of listeners) assert.equal(await listenerReachable(origin), false);
    assert.equal(sha256(await readFile(inputPath)), requestSha256);
    const cancelled = custody.signal.aborted;
    await writeViteBrowserJson(join(restartEvidenceRoot, "worker-result.json"), {
      schemaVersion: 1, kind: "hraness-next-development-worker",
      state: cancelled ? "cancelled" : failure === undefined ? "complete" : "failed",
      owner: process.pid, node: process.versions.node, requestSha256,
      resources: 0, processGroups, browserPids, listeners,
      evidence: failure === undefined && !cancelled ? evidence : null,
    });
    custody.dispose();
  }
  if (failure !== undefined && !custody.signal.aborted) throw failure;
}

async function readWorkerResult(request: WorkerRequest, requestSha256: string, ownerPid: number) {
  const path = join(request.evidenceRoot, "worker-result.json");
  assert.equal(await realpath(path), path);
  const stat = await lstat(path);
  assert.ok(stat.isFile() && stat.nlink === 1 && stat.size <= 1024 * 1024);
  const value = object(JSON.parse(await readFile(path, "utf8")) as unknown);
  assert.deepEqual(Object.keys(value).sort(), ["browserPids", "evidence", "kind", "listeners", "node", "owner", "processGroups", "requestSha256", "resources", "schemaVersion", "state"]);
  assert.equal(value.schemaVersion, 1);
  assert.equal(value.kind, "hraness-next-development-worker");
  assert.equal(value.owner, ownerPid);
  assert.equal(value.requestSha256, requestSha256);
  assert.equal(value.resources, 0);
  assert.ok(typeof value.node === "string" && /^24\./u.test(value.node));
  assert.ok(value.state === "complete" || value.state === "failed" || value.state === "cancelled");
  const processGroups = value.processGroups;
  const browserPids = value.browserPids;
  const listeners = value.listeners;
  assert.ok(Array.isArray(processGroups) && processGroups.length <= 32);
  assert.ok(Array.isArray(browserPids) && browserPids.length <= 1);
  assert.ok(Array.isArray(listeners) && listeners.length <= 2);
  for (const pid of [...processGroups, ...browserPids]) {
    assert.ok(typeof pid === "number" && Number.isSafeInteger(pid) && pid > 1 && pid !== ownerPid && pid !== process.pid);
    assert.equal(viteMatrixGroup(pid).probe(), false, "Next worker returned with a surviving process group");
  }
  for (const origin of listeners) {
    assert.ok(typeof origin === "string");
    assert.equal(await listenerReachable(origin), false, "Next worker returned with a reachable listener");
  }
  if (value.state === "complete") {
    assert.equal(browserPids.length, 1);
    assert.equal(listeners.length, 2);
    assert.ok(processGroups.length >= 9);
    const evidence = object(value.evidence);
    assert.equal(evidence.kind, "hraness-next-development-browser-matrix");
    assert.equal(evidence.next, NEXT_VERSION);
    assert.equal(evidence.archiveSha256, request.archiveSeal.sha256);
    assert.ok(Array.isArray(evidence.receipts) && evidence.receipts.length === 2);
    assert.deepEqual(evidence.receipts.map((receipt: unknown) => object(receipt).variant), ["edge", "no-edge"]);
  } else assert.equal(value.evidence, null);
  return value;
}

async function commitSuccess(request: WorkerRequest, result: unknown, custody: ViteMatrixCustody): Promise<string> {
  const path = join(request.evidenceRoot, "matrix.json");
  const pending = join(request.evidenceRoot, "matrix.pending.json");
  await writeViteBrowserJson(pending, result);
  const before = await lstat(pending);
  return custody.commit(() => {
    assert.equal(realpathSync(request.evidenceRoot), request.evidenceRoot);
    const stat = lstatSync(pending);
    assert.ok(stat.isFile() && stat.nlink === 1);
    assert.deepEqual([stat.dev, stat.ino, stat.size, stat.mode, stat.mtimeMs, stat.ctimeMs],
      [before.dev, before.ino, before.size, before.mode, before.mtimeMs, before.ctimeMs]);
    const directory = openSync(request.evidenceRoot, constants.O_RDONLY | constants.O_NOFOLLOW);
    let linked = false;
    try {
      linkSync(pending, path);
      linked = true;
      fsyncSync(directory);
    } catch (error) {
      if (linked) {
        const output = lstatSync(path);
        assert.ok(output.dev === stat.dev && output.ino === stat.ino, "Matrix receipt identity changed during publication");
        unlinkSync(path);
        fsyncSync(directory);
      }
      throw error;
    } finally { closeSync(directory); }
    return path;
  });
}

async function runCoordinator(): Promise<void> {
  assert.equal(Bun.version, "1.3.14");
  assert.ok(process.platform === "darwin" || process.platform === "linux", "Next development custody requires POSIX process groups");
  const custody = createViteMatrixCustody();
  const repository = await realpath(process.cwd());
  const fixtures = join(repository, ".stylex-fixtures");
  await mkdir(fixtures, { recursive: true });
  assert.equal(await realpath(fixtures), fixtures);
  const work = await realpath(await mkdtemp(join(fixtures, "next-dev-adopter-")));
  const evidenceRoot = await realpath(await mkdtemp(join(fixtures, "next-dev-evidence-")));
  await syncNextEvidenceDirectory(fixtures);
  await syncNextEvidenceDirectory(repository);
  let success = false;
  try {
    const node = node24();
    const browserExecutable = await resolveFirstBrowserExecutable([
      ...(process.env.CHROMIUM_EXECUTABLE_PATH ? [process.env.CHROMIUM_EXECUTABLE_PATH] : []),
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
      "/Applications/Chromium.app/Contents/MacOS/Chromium",
      "/usr/bin/google-chrome", "/usr/bin/google-chrome-stable", "/usr/bin/chromium", "/usr/bin/chromium-browser",
    ], "Next development smoke requires an installed Chrome or Chromium executable");
    const bunExecutable = await realpath(process.execPath);
    const packageInputs = await snapshotNextPackage(repository);
    const archive = join(work, "hraness-ui.tgz");
    await runCommand([bunExecutable, "pm", "pack", "--filename", archive, "--ignore-scripts", "--quiet"], repository,
      { ...process.env, NEXT_TELEMETRY_DISABLED: "1" }, custody, []);
    const archiveSeal = (await snapshotNextFile(archive)).seal;
    assert.deepEqual(await snapshotNextPackage(repository), packageInputs, "Package changed while packing");
    const request: WorkerRequest = { schemaVersion: 1, repository, work, evidenceRoot, bunExecutable, browserExecutable, packageInputs, archiveSeal };
    const inputPath = join(evidenceRoot, "worker-request.json");
    await writeViteBrowserJson(inputPath, request);
    const requestSha256 = sha256(await readFile(inputPath));
    const sourceBefore = await sourceInventory(join(repository, "fixtures/next-dev-adopter"));
    const ownedInputs = [
      "package.json", "bun.lock", "dist/stylex-manifest.json",
      "scripts/next-dev-adopter-smoke.ts", "scripts/next-dev-diagnostics.ts", "scripts/next-dev-restart.ts", "scripts/next-dev-inputs.ts", "scripts/browser-executable.ts",
      "fixtures/vite8-adopter/custody.ts", "fixtures/vite8-adopter/diagnostics.ts",
      "fixtures/vite8-adopter/browser-control.ts", "fixtures/vite8-adopter/browser-endpoint.ts",
      "build/next-dev.ts", "build/next-dev-session.ts", "build/next-dev-css-loader.cjs", "build/next-dev-loader.cjs",
    ];
    const snapshotInputs = () => Promise.all(ownedInputs.map(async (path) => ({ path, sha256: sha256(await readFile(join(repository, path))) })));
    const inputs = await snapshotInputs();
    const runtimes = { bun: sha256(await readFile(request.bunExecutable)), node: sha256(await readFile(node)), browser: sha256(await readFile(browserExecutable)) };
    const owned = ownViteMatrixCancellationOwner([node, fileURLToPath(import.meta.url), "--node-worker", inputPath], repository, custody,
      async (child) => { assert.ok(child.pid !== undefined); await readWorkerResult(request, requestSha256, child.pid); });
    const diagnostics = createNextDevDiagnostics();
    owned.child.stdout.on("data", (chunk: Buffer) => diagnostics.append(chunk));
    owned.child.stderr.on("data", (chunk: Buffer) => diagnostics.append(chunk));
    let result: unknown;
    try {
      await owned.spawned;
      process.stdout.write(JSON.stringify({ kind: "next-dev-worker-started", owner: owned.child.pid, evidenceRoot, work }) + "\n");
      const terminal = await matrixDeadline(owned.closed, 900_000, "Next development worker exceeded its finite matrix deadline");
      custody.check();
      assert.equal(terminal.signal, null);
      assert.equal(terminal.code, 0, "Next development worker failed");
      assert.equal(owned.group.probe(), false);
      assert.ok(owned.child.pid !== undefined);
      result = await readWorkerResult(request, requestSha256, owned.child.pid);
      assert.equal(object(result).state, "complete");
    } finally {
      try { await owned.close(); } finally { process.stdout.write(diagnostics.take()); }
    }
    await custody.close();
    custody.check();
    assert.equal(custody.activeResources, 0);
    assert.equal(sha256(await readFile(inputPath)), requestSha256);
    assert.deepEqual(await sourceInventory(join(repository, "fixtures/next-dev-adopter")), sourceBefore);
    assert.deepEqual(await snapshotInputs(), inputs, "Next development matrix inputs changed during verification");
    assert.deepEqual(await snapshotNextPackage(repository), packageInputs);
    assert.deepEqual((await snapshotNextFile(archive)).seal, archiveSeal);
    assert.deepEqual({ bun: sha256(await readFile(request.bunExecutable)), node: sha256(await readFile(node)), browser: sha256(await readFile(browserExecutable)) }, runtimes);
    const path = await commitSuccess(request, {
      schemaVersion: 1, kind: "hraness-next-development-browser-matrix", state: "complete",
      requestSha256, inputs, runtimes, fixtureSources: sourceBefore, worker: result,
      custody: "all-owned-resources-collected",
    }, custody);
    success = true;
    process.stdout.write(JSON.stringify({ successReceipt: path }) + "\n");
  } finally {
    await custody.close();
    custody.dispose();
    if (success) {
      assert.equal(await realpath(work), work);
      assert.ok(work.startsWith(join(fixtures, "next-dev-adopter-")) && (await lstat(work)).isDirectory());
      try { await rm(work, { recursive: true }); }
      catch { process.stderr.write("Next matrix passed; disposable fixture cleanup was incomplete at " + work + "\n"); }
    } else process.stderr.write("Retained failed Next development fixture: " + work + "\n");
    process.stdout.write("Retained Next development evidence: " + evidenceRoot + "\n");
  }
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  if (args.length === 0) await runCoordinator();
  else {
    assert.ok(args.length === 2 && args[0] === "--node-worker" && args[1] !== undefined, "Next development smoke accepts only its exact worker invocation");
    await runWorker(args[1]);
  }
}
