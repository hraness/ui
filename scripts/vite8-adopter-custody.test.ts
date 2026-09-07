import { test } from "bun:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdtemp, readFile, readdir, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { viteMatrixBrowserEndpoint } from "../fixtures/vite8-adopter/browser-endpoint.ts";
import { assertViteBrowserNodeRuntime, parseViteBrowserRequest, parseViteBrowserResult, prepareViteBrowserServer } from "../fixtures/vite8-adopter/browser-control.ts";
import {
  acquireViteMatrixResource, collectViteMatrixGroup, createViteMatrixCustody,
  matrixDeadline, UncollectedViteMatrixResourceError, viteMatrixGroup,
  writeViteMatrixSuccessReceipt,
} from "../fixtures/vite8-adopter/custody.ts";

test("browser control requires genuine Node 24 rather than Bun's compatible Node version", () => {
  assert.doesNotThrow(() => assertViteBrowserNodeRuntime({ node: "24.18.1" }));
  for (const versions of [{ node: "24.18.1", bun: "1.3.14" }, { node: "22.20.0" }, { node: "24.18.1-extra" }, { node: "24" }]) {
    assert.throws(() => assertViteBrowserNodeRuntime(versions), /genuine Node 24/u);
  }
});

test("native acquisition identity or journal failure cannot erase unproved collection", async () => {
  for (const boundary of ["identity", "journal"]) for (const failedCollection of [false, true]) {
    const signals = new EventEmitter();
    const custody = createViteMatrixCustody({ signals, onCancel() {} });
    let closeCalls = 0;
    await assert.rejects(prepareViteBrowserServer(custody, async () => {
      closeCalls += 1;
      if (failedCollection) throw new Error("Native close or group collection is unproved");
    }, async () => {
      assert.equal(custody.activeResources, 1, "Native ownership must precede every setup operation");
      throw new Error(`${boundary} setup failed`);
    }), failedCollection ? AggregateError : new RegExp(`${boundary} setup failed`, "u"));
    assert.equal(closeCalls, 1);
    if (failedCollection) {
      assert.equal(custody.activeResources, 1);
      await assert.rejects(custody.close(), UncollectedViteMatrixResourceError);
      assert.equal(closeCalls, 1);
      assert.throws(() => custody.commit(() => ({ state: "complete", resources: 0 })), /requires collected resources/u);
      assert.throws(() => custody.dispose(), /uncollected/u);
      signals.removeAllListeners();
    } else {
      assert.equal(custody.activeResources, 0);
      await custody.close(); custody.dispose();
    }
  }
});

test("cancellation during native setup collects once before rejecting the late resource", async () => {
  const signals = new EventEmitter();
  const custody = createViteMatrixCustody({ signals, onCancel() {} });
  let closes = 0;
  await assert.rejects(prepareViteBrowserServer(custody, async () => { closes += 1; }, async () => {
    signals.emit("SIGTERM");
    await Promise.resolve();
    return "native server";
  }), /cancelled by SIGTERM/u);
  await custody.close(); custody.dispose();
  assert.equal(closes, 1);
  assert.equal(custody.activeResources, 0);
});

test("browser worker requests keep a closed local origin and exact finite mode", () => {
  const input = { schemaVersion: 1, mode: "acceptance", origin: "http://127.0.0.1:57255", executablePath: "/browser/chrome", foundationHref: "/graphs/client/nested/foundation.css" };
  assert.deepEqual(parseViteBrowserRequest(input), input);
  for (const mode of ["cancel-connected", "cancel-during-launch"]) assert.equal(parseViteBrowserRequest({ ...input, mode }).mode, mode);
  for (const patch of [
    { mode: "skip-assertions" }, { schemaVersion: 2 }, { extra: true }, { executablePath: "chrome" },
    { origin: "http://localhost:57255" }, { origin: "http://127.0.0.1:0" }, { origin: "http://127.0.0.1:65536" },
    { origin: "http://127.0.0.1:57255/path" }, { origin: "https://example.com" },
    { foundationHref: "/graphs/client/../outside.css" }, { foundationHref: "/unowned.css" },
  ]) assert.throws(() => parseViteBrowserRequest({ ...input, ...patch }));
});

test("browser worker completion binds request, owner, Node runtime and one collected browser", () => {
  const requestSha256 = "a".repeat(64);
  const result = { schemaVersion: 1, state: "complete", owner: 23, node: "24.18.1", requestSha256, resources: 0, browserPids: [29], evidence: { count: "1" } };
  assert.deepEqual(parseViteBrowserResult(result, requestSha256, 23), result);
  const cancelled = { ...result, state: "cancelled", evidence: null };
  assert.deepEqual(parseViteBrowserResult(cancelled, requestSha256, 23), cancelled);
  for (const patch of [
    { state: "ready" }, { schemaVersion: 2 }, { owner: 31 }, { requestSha256: "b".repeat(64) },
    { node: "22.20.0" }, { bun: "1.3.14" }, { resources: 1 }, { evidence: null },
    { browserPids: [] }, { browserPids: [0] }, { browserPids: [23] }, { browserPids: [29, 31] },
  ]) assert.throws(() => parseViteBrowserResult({ ...result, ...patch }, requestSha256, 23));
  assert.throws(() => parseViteBrowserResult({ ...cancelled, evidence: {} }, requestSha256, 23));
  assert.throws(() => parseViteBrowserResult({ ...cancelled, browserPids: [] }, requestSha256, 23));
});

test("browser endpoints retain the emitted IPv4 transport, port, and opaque path exactly", () => {
  const token = "0123456789abcdef0123456789abcdef";
  for (const port of [1, 80, 57255, 65_535]) {
    const endpoint = `ws://127.0.0.1:${port}/${token}`;
    assert.equal(viteMatrixBrowserEndpoint(endpoint), endpoint);
  }
});

test("browser endpoints reject other origins, transports, normalization, and malformed authority without leaking tokens", () => {
  const token = "0123456789abcdef0123456789abcdef";
  const valid = `ws://127.0.0.1:57255/${token}`;
  const endpoints: unknown[] = [
    undefined, null, {}, 57255,
    ...["localhost", "[::1]", "0.0.0.0", "192.0.2.1", "127.1", "2130706433", "127.0.0.1.", "user@127.0.0.1"]
      .map((host) => valid.replace("127.0.0.1", host)),
    ...["http:", "https:", "wss:", "WS:"].map((protocol) => valid.replace("ws:", protocol)),
    ...["0", "65536", "057255", "-1", "1.5"].map((port) => valid.replace("57255", port)),
    valid.replace(":57255", ""), `${valid}?token=extra`, `${valid}#fragment`, `${valid}/`,
    ` ${valid}`, `${valid}\n`, valid.replace(token, ""), valid.replace(token, "guessable"),
    valid.replace(token, token.toUpperCase()), valid.replace(token, `%30${token.slice(1)}`),
    valid.replace(token, `../${token}`), "x".repeat(100_000),
  ];
  for (const endpoint of endpoints) {
    assert.throws(() => viteMatrixBrowserEndpoint(endpoint), (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.equal(error.message, "Vite matrix browser endpoint must be an exact local IPv4 Playwright WebSocket endpoint");
      assert.ok(!error.message.includes(token));
      return true;
    });
  }
});

test("positive group absence requires no signal", async () => {
  const signals: string[] = [];
  assert.equal(await collectViteMatrixGroup({ probe: () => false, signal: (signal) => signals.push(signal), wait: async () => {} }), false);
  assert.deepEqual(signals, []);
});

test("invalid process-group identities are rejected before signaling", () => {
  for (const pid of [0, 1, -1, -23, 2.5, NaN, Infinity]) assert.throws(() => viteMatrixGroup(pid), /positive PID/u);
});

test("collection escalates only while the group remains present", async () => {
  for (const exitsOn of ["SIGTERM", "SIGKILL"] as const) {
    const signals: string[] = [];
    let present = true;
    let waits = 0;
    assert.equal(await collectViteMatrixGroup({
      probe: () => present,
      signal(signal) { signals.push(signal); if (signal === exitsOn) present = false; },
      async wait() { waits += 1; },
    }), true);
    assert.deepEqual(signals, exitsOn === "SIGTERM" ? ["SIGTERM"] : ["SIGTERM", "SIGKILL"]);
    assert.equal(waits, exitsOn === "SIGTERM" ? 0 : 80);
  }
});

test("unknown probes, failed signals, and survivors fail closed", async () => {
  for (const mode of ["probe", "signal", "survivor"] as const) {
    await assert.rejects(collectViteMatrixGroup({
      probe() { if (mode === "probe") throw new Error("probe failure"); return true; },
      signal() { if (mode === "signal") throw new Error("signal failure"); },
      async wait() {},
    }), UncollectedViteMatrixResourceError);
  }
});

test("signal cancellation is sticky and closes each resource once", async () => {
  const signals = new EventEmitter();
  const cancellations: string[] = [];
  const custody = createViteMatrixCustody({ signals, onCancel: (signal) => cancellations.push(signal) });
  let count = 0;
  const close = custody.own("resource", async () => { count += 1; });
  signals.emit("SIGTERM");
  signals.emit("SIGINT");
  await Promise.all([close(), custody.close(), custody.close()]);
  assert.equal(count, 1);
  assert.deepEqual(cancellations, ["SIGTERM"]);
  assert.throws(() => custody.check(), /cancelled by SIGTERM/u);
  assert.equal(custody.activeResources, 0);
  custody.dispose();
  assert.equal(signals.listenerCount("SIGINT"), 0);
  assert.equal(signals.listenerCount("SIGTERM"), 0);
});

test("late acquisitions are collected before cancellation returns", async () => {
  const signals = new EventEmitter();
  const custody = createViteMatrixCustody({ signals, onCancel() {} });
  let finish: ((value: number) => void) | undefined;
  let released = 0;
  const acquired = acquireViteMatrixResource(custody, "pending", () => new Promise<number>((resolve) => { finish = resolve; }), async (value) => { released += value; });
  const rejected = assert.rejects(acquired, /cancelled by SIGINT/u);
  await Promise.resolve();
  signals.emit("SIGINT");
  assert.equal(custody.activeResources, 1);
  assert.ok(finish !== undefined);
  finish(23);
  await rejected;
  await custody.close();
  assert.equal(released, 23);
  custody.dispose();
});

test("dependent browser resources drain in reverse acquisition order on close and cancellation", async () => {
  for (const cancel of [false, true]) {
    const signals = new EventEmitter();
    const custody = createViteMatrixCustody({ signals, onCancel() {} });
    const events: string[] = [];
    let finishContext!: () => void;
    let contextStarted!: () => void;
    const pendingContext = new Promise<void>((resolve) => { finishContext = resolve; });
    const started = new Promise<void>((resolve) => { contextStarted = resolve; });
    custody.own("native server", async () => {
      assert.equal(events.at(-1), "connection:closed");
      events.push("server:closed");
    });
    custody.own("browser connection", async () => {
      assert.equal(events.at(-1), "context:closed");
      events.push("connection:closed");
    });
    custody.own("browser context", async () => {
      events.push("context:closing");
      contextStarted();
      await pendingContext;
      events.push("context:closed");
    });
    if (cancel) signals.emit("SIGINT");
    const closing = Promise.all([custody.close(), custody.close()]);
    void closing.catch(() => undefined);
    await started;
    assert.deepEqual(events, ["context:closing"]);
    finishContext();
    await closing;
    assert.deepEqual(events, ["context:closing", "context:closed", "connection:closed", "server:closed"]);
    assert.equal(custody.activeResources, 0);
    custody.dispose();
  }
});

test("an acquisition cannot start after cancellation", async () => {
  const signals = new EventEmitter();
  const custody = createViteMatrixCustody({ signals, onCancel() {} });
  signals.emit("SIGTERM");
  let started = false;
  await assert.rejects(acquireViteMatrixResource(custody, "late", async () => { started = true; }, async () => {}), /cancelled/u);
  assert.equal(started, false);
  await custody.close();
  custody.dispose();
});

test("failed collection remains sticky and prevents custody disposal", async () => {
  const signals = new EventEmitter();
  const custody = createViteMatrixCustody({ signals, onCancel() {} });
  let attempts = 0;
  custody.own("uncollected", async () => { attempts += 1; throw new Error("uncertain collection"); });
  await assert.rejects(custody.close(), UncollectedViteMatrixResourceError);
  await assert.rejects(custody.close(), UncollectedViteMatrixResourceError);
  assert.equal(attempts, 1);
  assert.equal(custody.activeResources, 1);
  assert.throws(() => custody.dispose(), /uncollected/u);
});

test("deadline errors retain collection uncertainty", async () => {
  await assert.rejects(matrixDeadline(new Promise(() => {}), 1, "uncollected"), UncollectedViteMatrixResourceError);
  assert.equal(await matrixDeadline(Promise.resolve(23), 1_000, "unexpected"), 23);
});

test("a signal before receipt commit retains staged evidence without publishing success", async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "vite-matrix-receipt-race-")));
  const signals = new EventEmitter();
  const custody = createViteMatrixCustody({ signals, onCancel() {} });
  const directory = join(root, "receipts");
  const name = "vite78-production-cancelled.json";
  try {
    await assert.rejects(writeViteMatrixSuccessReceipt(directory, name, { state: "complete" }, custody, async () => {
      assert.equal((await readdir(directory)).some((path) => path.endsWith(".pending")), true);
      await assert.rejects(readFile(join(directory, name)), (error: unknown) => (error as NodeJS.ErrnoException).code === "ENOENT");
      signals.emit("SIGTERM");
    }), /cancelled by SIGTERM/u);
    await assert.rejects(readFile(join(directory, name)), (error: unknown) => (error as NodeJS.ErrnoException).code === "ENOENT");
    assert.equal((await readdir(directory)).filter((path) => path.endsWith(".pending")).length, 1);
    assert.throws(() => custody.commit(() => {}), /cancelled/u);
  } finally {
    await custody.close(); custody.dispose();
    await rm(root, { recursive: true, force: true });
  }
});

test("a durable commit wins over later signals and forbids later acquisitions", async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "vite-matrix-receipt-commit-")));
  const signals = new EventEmitter();
  const cancellations: string[] = [];
  const custody = createViteMatrixCustody({ signals, onCancel: (signal) => cancellations.push(signal) });
  try {
    const value = { state: "complete", custody: "all-owned-resources-collected" };
    const receipt = await writeViteMatrixSuccessReceipt(join(root, "receipts"), "vite78-production-complete.json", value, custody);
    signals.emit("SIGINT"); signals.emit("SIGTERM");
    custody.check();
    assert.deepEqual(cancellations, []);
    assert.equal(custody.signal.aborted, false);
    assert.deepEqual(JSON.parse(await readFile(receipt.path, "utf8")), value);
    assert.equal(receipt.bytes, Buffer.byteLength(await readFile(receipt.path)));
    assert.throws(() => custody.own("too late", async () => {}), /after matrix success/u);
    assert.throws(() => custody.commit(() => {}), /only once/u);
  } finally {
    await custody.close(); custody.dispose();
    await rm(root, { recursive: true, force: true });
  }
});

test("uncollected resources and failed publication cannot commit success", async () => {
  const signals = new EventEmitter();
  const custody = createViteMatrixCustody({ signals, onCancel() {} });
  const close = custody.own("pending collection", async () => {});
  assert.throws(() => custody.commit(() => {}), /requires collected resources/u);
  await close();
  assert.throws(() => custody.commit(() => { throw new Error("publication failed"); }), /publication failed/u);
  signals.emit("SIGTERM");
  assert.throws(() => custody.check(), /cancelled/u);
  await custody.close(); custody.dispose();
});

test("exclusive receipt publication preserves an existing proof", async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "vite-matrix-receipt-exclusive-")));
  const signals = new EventEmitter();
  const first = createViteMatrixCustody({ signals, onCancel() {} });
  const second = createViteMatrixCustody({ signals, onCancel() {} });
  try {
    const directory = join(root, "receipts");
    const name = "vite78-production-original.json";
    const receipt = await writeViteMatrixSuccessReceipt(directory, name, { state: "complete", proof: "original" }, first);
    const bytes = await readFile(receipt.path);
    await assert.rejects(writeViteMatrixSuccessReceipt(directory, name, { proof: "replacement" }, second),
      (error: unknown) => (error as NodeJS.ErrnoException).code === "EEXIST");
    assert.deepEqual(await readFile(receipt.path), bytes);
    signals.emit("SIGTERM");
    first.check();
    assert.throws(() => second.check(), /cancelled/u);
  } finally {
    await first.close(); first.dispose(); await second.close(); second.dispose();
    await rm(root, { recursive: true, force: true });
  }
});
