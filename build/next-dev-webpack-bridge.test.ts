import { expect, test } from "bun:test";
import { createContext, runInContext, type Context } from "node:vm";
import {
  annotateNextDevWebpackManifest,
  parseNextDevWebpackCatalogue,
  parseNextDevWebpackUpdateMetadata,
  renderNextDevWebpackBootstrap,
  renderNextDevWebpackManifestGate,
  renderNextDevWebpackStartup,
  type NextDevWebpackBridgeOwner,
  type NextDevWebpackCatalogue,
  type NextDevWebpackUpdateMetadata,
} from "./next-dev-webpack-bridge.js";

// Executing generated code in a VM proves ordering/protocol behavior only.
// These doubles do not prove native CSS, Next HMR, or real React commits.
const hash = (value: number): string => value.toString(16).padStart(64, "0");
const nativeHash = (value: number): string => value.toString(16).padStart(16, "0");
const session = "a".repeat(32);
const snapshot = (sequence: number) => ({ includedRevisions: [hash(sequence)], revision: hash(sequence),
  sequence, stylesheetSha256: hash(sequence + 100) });
const catalogue = (sequence = 1): NextDevWebpackCatalogue => ({
  consumers: [{ source: "app/client.tsx", target: "client" }, { source: "app/page.tsx", target: "server" }],
  currentSequence: sequence,
  session,
  snapshots: [snapshot(sequence)],
});
const metadata = (from = 1, to = 2): NextDevWebpackUpdateMetadata => ({
  catalogue: catalogue(to), fromHash: nativeHash(from), kind: "hraness-stylex-next-dev-hot-update",
  schemaVersion: 1, session, toHash: nativeHash(to),
});
const native = () => ({ c: ["app/layout", "webpack"], r: [] as string[], m: [12] });
function deferred<T = void>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((done, failed) => { resolve = done; reject = failed; });
  return { promise, resolve, reject };
}
const flush = async (): Promise<void> => { for (let index = 0; index < 24; index++) await Promise.resolve(); };
const localCopy = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

function harness() {
  const startup = deferred();
  const hydration = deferred();
  const css = deferred();
  const activation = deferred();
  const events: string[] = [];
  const failures: string[] = [];
  const observed: NextDevWebpackCatalogue[] = [];
  const updates: NextDevWebpackUpdateMetadata[] = [];
  let nativeCalls = 0;
  let factoryCalls = 0;
  let nativeWork = 1;
  let activeCss = "last-good";
  let nextManifest: unknown;
  let nativeError: Error | null = null;
  const owner: NextDevWebpackBridgeOwner = {
    startupReady: startup.promise,
    hydrationReady: hydration.promise,
    adopt(input) {
      // The production factory uses this same ledger-backed parser. VM values
      // are copied to the host realm for this deliberately separate double.
      const parsed = parseNextDevWebpackCatalogue(localCopy(input));
      observed.push(parsed);
      events.push(`adopt:${parsed.currentSequence}`);
      return css.promise;
    },
    updateReady(input) {
      updates.push(parseNextDevWebpackUpdateMetadata(localCopy(input)));
      events.push(`update-ready:${input.catalogue.currentSequence}`);
      return activation.promise.then(() => { activeCss = `accepted:${input.catalogue.currentSequence}`; });
    },
    restartRequired(reason) { failures.push(reason); events.push("restart-required"); nativeWork = 0; },
  };
  const context: Context = createContext({ events,
    createOwner(input: unknown) { factoryCalls++; parseNextDevWebpackCatalogue(localCopy(input)); return owner; },
    fetchNative() {
      nativeCalls++;
      events.push("native-manifest");
      if (nativeError !== null) return Promise.reject(nativeError);
      return Promise.resolve(nextManifest);
    },
  });
  runInContext(`globalThis.currentHash = ${JSON.stringify(nativeHash(1))};
    globalThis.__webpack_require__ = { h: () => currentHash,
      hmrM: function () { return fetchNative.apply(this, arguments); } };`, context);
  const evaluate = (source: string): unknown => runInContext(source, context);
  const bootstrap = (input = catalogue()) => evaluate(renderNextDevWebpackBootstrap(input, "createOwner"));
  bootstrap();
  evaluate(renderNextDevWebpackManifestGate());
  function manifest(value: unknown) {
    nextManifest = value === undefined ? undefined : evaluate(`JSON.parse(${JSON.stringify(JSON.stringify(value))})`);
    return nextManifest;
  }
  manifest(annotateNextDevWebpackManifest(native(), metadata()));
  const check = (): Promise<unknown> => evaluate("__webpack_require__.hmrM()") as Promise<unknown>;
  const inspect = () => localCopy(evaluate("__webpack_require__.__hranessStylexNextDev.inspect()")) as {
    phase: string; reason: string | null; startupCount: number; pendingManifest: boolean; terminalContinuations: number;
  };
  return { startup, hydration, css, activation, events, failures, observed, updates, owner, context,
    evaluate, bootstrap, manifest, check, inspect,
    nativeCalls: () => nativeCalls, factoryCalls: () => factoryCalls, nativeWork: () => nativeWork, activeCss: () => activeCss,
    failFetch(error: Error) { nativeError = error; },
    setHash(value: number) { evaluate(`currentHash = ${JSON.stringify(nativeHash(value))}`); },
  };
}

test("catalogue parser copies captured authority and binds hash reuse to ledger semantics", () => {
  const input = { ...localCopy(catalogue()), snapshots: [snapshot(1)] };
  const parsed = parseNextDevWebpackCatalogue(input);
  expect(parsed).toEqual(input);
  expect(Object.isFrozen(parsed.snapshots[0]!.includedRevisions)).toBe(true);
  input.snapshots[0]!.includedRevisions = [hash(10)];
  expect(parsed.snapshots[0]!.includedRevisions).toEqual([hash(1)]);
  expect(() => parseNextDevWebpackCatalogue({ ...catalogue(), snapshots: [snapshot(1), {
    ...snapshot(2), stylesheetSha256: snapshot(1).stylesheetSha256,
  }] })).toThrow("conflicting revision coverage");
  expect(() => parseNextDevWebpackCatalogue({ ...catalogue(), currentSequence: 9 })).toThrow("selected sequence");
});

test("catalogue parser rejects spoofing, malformed finite censuses and accessors without invoking them", () => {
  let getterCalls = 0;
  const accessor = { ...catalogue() };
  Object.defineProperty(accessor, "snapshots", { enumerable: true, get() { getterCalls++; return []; } });
  const inherited = Object.setPrototypeOf([snapshot(1)], { ...Array.prototype });
  const sparse = new Array(1);
  for (const value of [
    { ...catalogue(), extra: true }, accessor,
    { ...catalogue(), session: session.toUpperCase() },
    { ...catalogue(), consumers: [...catalogue().consumers].reverse() },
    { ...catalogue(), consumers: [{ source: "app/../page.tsx", target: "server" }] },
    { ...catalogue(), consumers: [{ source: "app/child.tsx", target: "server" }] },
    { ...catalogue(), consumers: [] },
    { ...catalogue(), snapshots: inherited }, { ...catalogue(), snapshots: sparse },
    { ...catalogue(), snapshots: Array.from({ length: 33 }, (_, index) => snapshot(index + 1)) },
    { ...catalogue(), snapshots: [snapshot(1), snapshot(1)] },
    { ...catalogue(), snapshots: [{ ...snapshot(1), includedRevisions: [hash(2)] }] },
  ]) expect(() => parseNextDevWebpackCatalogue(value)).toThrow();
  expect(getterCalls).toBe(0);
});

test("metadata and native manifest schemas are closed while preserving native arrays", () => {
  const input = native();
  const serialized = JSON.stringify(input);
  const output = annotateNextDevWebpackManifest(input, metadata());
  expect(JSON.stringify(input)).toBe(serialized);
  expect(output.c).toEqual(input.c);
  expect(output.r).toEqual(input.r);
  expect(output.m).toEqual(input.m);
  for (const invalid of [
    { ...metadata(), fromHash: "1".repeat(20) },
    { ...metadata(), toHash: metadata().fromHash },
    { ...metadata(), session: "b".repeat(32) },
    { ...metadata(), schemaVersion: 2 },
    { ...metadata(), latest: "/mutable-index.json" },
  ]) expect(() => parseNextDevWebpackUpdateMetadata(invalid)).toThrow();
  for (const invalid of [null, { c: [], r: [] }, { ...native(), h: "obsolete-schema" },
    { ...native(), c: ["same", "same"] }, { ...native(), m: [NaN] },
    { ...native(), m: Array.from({ length: 4097 }, (_, index) => index) }]) {
    expect(() => annotateNextDevWebpackManifest(invalid, metadata())).toThrow();
  }
});

test("wire key permutations canonicalize deterministically", () => {
  const input = metadata();
  const entries = Object.entries(input);
  const expected = JSON.stringify(parseNextDevWebpackUpdateMetadata(input));
  for (let rotation = 0; rotation < entries.length; rotation++) {
    const rotated = entries.slice(rotation).concat(entries.slice(0, rotation));
    expect(JSON.stringify(parseNextDevWebpackUpdateMetadata(Object.fromEntries(rotated)))).toBe(expected);
  }
});

test("entry startup waits native CSS and preserves original export/library assignments in order", async () => {
  const subject = harness();
  const first = subject.evaluate(renderNextDevWebpackStartup(
    "events.push('entry-one'); var __webpack_exports__ = { id: 1 }; globalThis.library = __webpack_exports__; return __webpack_exports__;",
  )) as Promise<unknown>;
  const second = subject.evaluate(renderNextDevWebpackStartup("events.push('entry-two'); globalThis.observedLibrary = library.id;")) as Promise<unknown>;
  await flush();
  expect(subject.events).toEqual([]);
  expect(subject.evaluate("typeof library")).toBe("undefined");
  subject.startup.resolve();
  expect(localCopy(await first)).toEqual({ id: 1 });
  await second;
  expect(subject.events).toEqual(["entry-one", "entry-two"]);
  expect(subject.evaluate("observedLibrary")).toBe(1);
  expect(subject.inspect().startupCount).toBe(0);
  // Startup cannot wait for hydration, since startup creates that hydration.
  expect(subject.updates).toHaveLength(0);
});

test("actual manifest gates update JavaScript until adoption, hydration and native activation finish", async () => {
  const subject = harness();
  const original = subject.manifest(annotateNextDevWebpackManifest(native(), metadata()));
  let updateJs = false;
  const pending = subject.check().then((value) => { updateJs = true; return value; });
  await flush();
  expect(subject.events).toEqual(["native-manifest", "adopt:2"]);
  expect(subject.observed[0]?.currentSequence).toBe(2);
  expect(updateJs).toBe(false);
  subject.css.resolve();
  await flush();
  expect(subject.updates).toHaveLength(0);
  subject.hydration.resolve();
  await flush();
  expect(subject.events).toContain("update-ready:2");
  expect(updateJs).toBe(false);
  subject.activation.resolve();
  expect(await pending).toBe(original);
  expect(updateJs).toBe(true);
  expect(subject.activeCss()).toBe("accepted:2");
  expect(subject.failures).toEqual([]);
});

test("two native updates and repeated runtime installation remain idempotent", async () => {
  const subject = harness();
  subject.startup.resolve(); subject.hydration.resolve(); subject.css.resolve(); subject.activation.resolve();
  const firstWrapper = subject.evaluate("__webpack_require__.hmrM");
  subject.evaluate(renderNextDevWebpackManifestGate());
  expect(subject.evaluate("__webpack_require__.hmrM")).toBe(firstWrapper);
  const first = subject.check();
  expect(subject.check()).toBe(first);
  await first;
  expect(subject.nativeCalls()).toBe(1);
  subject.setHash(2);
  subject.bootstrap(catalogue(2));
  // A native JSONP runtime replacement must be wrapped too, once.
  subject.evaluate("__webpack_require__.hmrM = function () { return fetchNative.apply(this, arguments); }");
  subject.evaluate(renderNextDevWebpackManifestGate());
  const secondWrapper = subject.evaluate("__webpack_require__.hmrM");
  expect(secondWrapper).not.toBe(firstWrapper);
  subject.evaluate(renderNextDevWebpackManifestGate());
  expect(subject.evaluate("__webpack_require__.hmrM")).toBe(secondWrapper);
  const secondManifest = subject.manifest(annotateNextDevWebpackManifest(native(), metadata(2, 3)));
  expect(await subject.check()).toBe(secondManifest);
  expect(subject.factoryCalls()).toBe(1);
  expect(subject.nativeCalls()).toBe(2);
  expect(subject.updates.map((update) => update.toHash)).toEqual([nativeHash(2), nativeHash(3)]);
  expect(subject.inspect().phase).toBe("open");
});

test("missing or forged actual manifest metadata freezes without invoking update handlers", async () => {
  for (const malformed of [
    native(), null,
    { ...native(), hranessStylexNextDev: { ...metadata(), session: "b".repeat(32) } },
    { ...native(), hranessStylexNextDev: { ...metadata(), fromHash: nativeHash(7) } },
    { ...native(), hranessStylexNextDev: { ...metadata(), catalogue: { ...catalogue(2),
      consumers: [{ source: "app/forged.tsx", target: "client" }] } } },
  ]) {
    const subject = harness();
    subject.manifest(malformed);
    let resolved = false;
    let rejected = false;
    void subject.check().then(() => { resolved = true; }, () => { rejected = true; });
    await flush();
    expect(subject.inspect().phase).toBe("restart-required");
    expect(subject.updates).toHaveLength(0);
    expect(subject.nativeWork()).toBe(0);
    expect(subject.activeCss()).toBe("last-good");
    expect(subject.failures).toHaveLength(1);
    expect(resolved).toBe(false);
    expect(rejected).toBe(false);
  }
});

test("CSS failure owns one terminal freeze, collects work and never becomes empty success", async () => {
  const subject = harness();
  let continued = false;
  void subject.check().then(() => { continued = true; }, () => { continued = true; });
  await flush();
  subject.css.reject(new Error("native CSS error"));
  await flush();
  const terminal = subject.check();
  expect(subject.check()).toBe(terminal);
  expect(subject.evaluate("__webpack_require__.__hranessStylexNextDev.fail('again')")).toBe(terminal);
  subject.hydration.resolve(); subject.activation.resolve(); subject.startup.resolve();
  await flush();
  expect(continued).toBe(false);
  expect(subject.nativeCalls()).toBe(1);
  expect(subject.nativeWork()).toBe(0);
  expect(subject.activeCss()).toBe("last-good");
  expect(subject.inspect()).toMatchObject({ phase: "restart-required", startupCount: 0, terminalContinuations: 1 });
  expect(subject.failures).toEqual(["native-update-gate-failed"]);
});

test("startup failure also freezes newly replaced native loaders without bypassing the gate", async () => {
  const subject = harness();
  void subject.evaluate(renderNextDevWebpackStartup("events.push('unsafe-entry')"));
  subject.startup.reject(new Error("initial stylesheet deadline"));
  await flush();
  subject.evaluate("__webpack_require__.hmrM = function () { return fetchNative.apply(this, arguments); }");
  subject.evaluate(renderNextDevWebpackManifestGate());
  void subject.check();
  await flush();
  expect(subject.nativeCalls()).toBe(0);
  expect(subject.events).not.toContain("unsafe-entry");
  expect(subject.failures).toEqual(["startup-stylesheet-failed"]);
});

test("native fetch errors freeze, while a genuine native 404 no-update remains undefined", async () => {
  const idle = harness();
  idle.manifest(undefined);
  expect(await idle.check()).toBeUndefined();
  expect(idle.inspect().phase).toBe("open");
  expect(idle.observed).toHaveLength(0);
  const failed = harness();
  failed.failFetch(new Error("HTTP 500"));
  void failed.check();
  await flush();
  expect(failed.inspect().phase).toBe("restart-required");
  expect(failed.nativeWork()).toBe(0);
});

test("manifest mutation, runtime hash drift and replay never release a CSS gate", async () => {
  for (const mutation of ["manifest", "runtime"] as const) {
    const subject = harness();
    const original = subject.manifest(annotateNextDevWebpackManifest(native(), metadata())) as { c: string[] };
    let released = false;
    void subject.check().then(() => { released = true; });
    await flush();
    if (mutation === "manifest") original.c.push("not-captured");
    else subject.setHash(9);
    subject.css.resolve(); subject.hydration.resolve(); subject.activation.resolve();
    await flush();
    expect(released).toBe(false);
    expect(subject.inspect().phase).toBe("restart-required");
  }
  const replay = harness();
  replay.css.resolve(); replay.hydration.resolve(); replay.activation.resolve();
  await replay.check();
  // No native application advanced h() to the accepted update's toHash.
  void replay.check();
  await flush();
  expect(replay.inspect().reason).toBe("native-runtime-hash-mismatch");
  expect(replay.nativeCalls()).toBe(1);
});

test("ledger authority rejects a manifest with conflicting captured stylesheet coverage", async () => {
  const subject = harness();
  subject.manifest({ ...native(), hranessStylexNextDev: { ...metadata(), catalogue: { ...catalogue(2),
    snapshots: [snapshot(1), { ...snapshot(2), stylesheetSha256: snapshot(1).stylesheetSha256 }],
  } } });
  void subject.check();
  await flush();
  expect(subject.inspect().phase).toBe("restart-required");
  expect(subject.updates).toHaveLength(0);
});

test("generated runtime bytes bind captured metadata and bound the startup queue", async () => {
  const first = renderNextDevWebpackBootstrap(catalogue(), "createOwner");
  const second = renderNextDevWebpackBootstrap(catalogue(2), "createOwner");
  expect(first).not.toBe(second);
  expect(first).toContain(snapshot(1).stylesheetSha256);
  expect(second).toContain(snapshot(2).stylesheetSha256);
  expect(() => renderNextDevWebpackBootstrap(catalogue(), " ")).toThrow("factory is empty");
  expect(() => renderNextDevWebpackStartup(" ")).toThrow("startup is empty");
  const subject = harness();
  for (let index = 0; index < 129; index++) void subject.evaluate(renderNextDevWebpackStartup("events.push('unsafe-entry')"));
  subject.startup.resolve();
  await flush();
  expect(subject.events).not.toContain("unsafe-entry");
  expect(subject.inspect()).toMatchObject({ phase: "restart-required", reason: "startup-queue-exceeded", terminalContinuations: 1 });
});
