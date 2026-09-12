import { act, StrictMode, Suspense, useState, type ReactNode } from "react";
import { createRoot, hydrateRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server.browser";
import { StylexNextDevConsumer, StylexNextDevDocument, stylexNextDevRevision } from "./next-dev-client.js";
import { installNextDevBrowserOwner } from "./next-dev-browser-owner.js";
import { createNextDevConsumerLedger, parseNextDevConsumerDescriptor, type NextDevConsumerDescriptor } from "./next-dev-consumers.js";
import { createNextDevResponseRequests, type NextDevResponseClassification } from "./next-dev-responses.js";
import { NEXT_DEV_CONSUMER_ATTRIBUTE, NEXT_DEV_DESCRIPTOR_ATTRIBUTE, type NextDevDocumentSnapshot } from "./next-dev-document.js";
import type { NextDevBootstrapOwner } from "./next-dev-bootstrap.js";

// Real React/DOM lifecycle evidence with deterministic authority and timer
// doubles. This does not qualify native stylesheets, Webpack, Flight or HMR.
declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
  var nextDevTestRefresh: () => void;
  var runNextDevClientScenario: (scenario: string) => Promise<{ scenario: string; assertions: number }>;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const hash = (value: number): string => value.toString(16).padStart(64, "0");
const sources = [{ source: "app/page.tsx", target: "server" }, { source: "app/client.tsx", target: "client" }] as const;
const session = "a".repeat(32);

function fixture() {
  let assertions = 0;
  const check = (value: unknown, message: string): void => { assertions++; if (!value) throw new Error(message); };
  const events: string[] = [];
  const timers = new Map<number, { callback: () => void; milliseconds: number }>();
  let timerId = 0;
  const ledger = createNextDevConsumerLedger({ consumers: sources, session });
  for (let sequence = 1; sequence <= 4; sequence++) ledger.publish({ sequence, revision: hash(sequence),
    includedRevisions: Array.from({ length: sequence }, (_, index) => hash(index + 1)), stylesheetSha256: hash(sequence + 100) });
  const descriptor = (sequence: number, index = 0) => ledger.descriptor(sources[index]!.source, sequence);
  const statuses = new Map<number, NextDevResponseClassification["status"]>([[1, "ready"], [2, "future"], [3, "future"], [4, "future"]]);
  const listeners = new Set<() => void>();
  const mounts = new Map<HTMLElement, { descriptor: NextDevConsumerDescriptor; parked: boolean }>();
  let documentSubscribers = 0;
  let refreshes = 0;
  let state: NextDevDocumentSnapshot = Object.freeze({ active: null, availableSequence: 1, phase: "ready" });
  let responses: ReturnType<typeof createNextDevResponseRequests>;
  const restart = (): void => {
    if (state.phase === "restart-required") return;
    state = Object.freeze({ ...state, phase: "restart-required" });
    responses.restartRequired();
    for (const listener of listeners) listener();
  };
  responses = createNextDevResponseRequests({
    classify(value, floor) {
      const parsed = ledger.captured(value);
      return { descriptor: parsed, status: parsed.sequence < floor ? "stale" : statuses.get(parsed.sequence)! };
    },
    setTimeout(callback, milliseconds) { const id = ++timerId; timers.set(id, { callback, milliseconds }); return id; },
    clearTimeout(id) { timers.delete(id); },
    restartRequired: restart,
  });
  const documentOwner = Object.freeze({
    getSnapshot: () => state,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    subscribeDocument(listener: () => void) {
      events.push("document:subscribe"); documentSubscribers++; listeners.add(listener);
      let active = true;
      return () => { if (active) { active = false; documentSubscribers--; listeners.delete(listener); } };
    },
    committed(root: HTMLElement, value: unknown) {
      const parsed = ledger.captured(value);
      check(root.isConnected && root.ownerDocument === document, "commit must own a connected physical root");
      check(["MAIN", "SECTION", "P"].includes(root.tagName), "commit must own a finite native tag");
      check(root.getAttribute(NEXT_DEV_CONSUMER_ATTRIBUTE) === parsed.source, "source attribute mismatch");
      check(root.getAttribute(NEXT_DEV_DESCRIPTOR_ATTRIBUTE) === JSON.stringify(parsed), "descriptor attribute mismatch");
      check(responses.getSnapshot().phase === "open", "response registration must precede native commit");
      events.push(`commit:${parsed.source}:${parsed.sequence}`);
      mounts.set(root, { descriptor: parsed, parked: false });
    },
    parked(root: HTMLElement) {
      const mount = mounts.get(root);
      check(mount !== undefined, "cleanup must park an actually committed root");
      mount!.parked = true; events.push("root:park");
      queueMicrotask(() => { if (!root.isConnected) mounts.delete(root); });
    },
  });
  const responseOwner = Object.freeze({ ...responses,
    request(...args: Parameters<typeof responses.request>) { events.push("request"); responses.request(...args); },
    responseCommitted(...args: Parameters<typeof responses.responseCommitted>) { events.push("response:commit"); responses.responseCommitted(...args); },
  });
  const bridge = Object.freeze({ documentOwner, responseOwner, restartRequired: restart });
  const install = (): void => installNextDevBrowserOwner(document, bridge as unknown as NextDevBootstrapOwner);
  globalThis.nextDevTestRefresh = () => { events.push("refresh"); refreshes++; };
  const flush = async (action: () => void | Promise<void>): Promise<void> => { await act(async () => { await action(); }); };
  return { check, events, timers, mounts, responses, descriptor, statuses, install, flush, restart,
    assertions: () => assertions, subscribers: () => documentSubscribers, refreshes: () => refreshes,
    phase: () => state.phase };
}

globalThis.runNextDevClientScenario = async (scenario) => {
  const f = fixture();
  const container = document.getElementById("root")!;
  const suspended = new Set<number>();
  const gates = new Map<number, { promise: Promise<void>; resolve(): void }>();
  const suspend = (sequence: number): void => {
    suspended.add(sequence);
    let resolve!: () => void;
    const promise = new Promise<void>((done) => { resolve = done; });
    gates.set(sequence, { promise, resolve });
  };
  const release = (sequence: number): void => { suspended.delete(sequence); gates.get(sequence)!.resolve(); };
  function Probe({ sequence, index }: Readonly<{ sequence: number; index: number }>): ReactNode {
    const [count, setCount] = useState(0);
    if (suspended.has(sequence)) throw gates.get(sequence)!.promise;
    return <button data-probe={index} onClick={() => setCount((value) => value + 1)}>{sequence}:{count}</button>;
  }
  const consumer = (sequence: number, index = 0, value = f.descriptor(sequence, index)): ReactNode =>
    <StylexNextDevConsumer as={index === 0 ? "main" : "section"} revision={value}>
      <Probe sequence={sequence} index={index} />
    </StylexNextDevConsumer>;
  const tree = (first: number, second?: number, value?: NextDevConsumerDescriptor): ReactNode =>
    <StrictMode><StylexNextDevDocument>{consumer(first, 0, value)}{second === undefined ? null : consumer(second, 1)}</StylexNextDevDocument></StrictMode>;
  const button = (index = 0): HTMLButtonElement | null => container.querySelector(`[data-probe="${String(index)}"]`);
  const sequence = (index = 0): number | null => {
    const root = container.querySelector(index === 0 ? "main" : "section");
    return root === null ? null : parseNextDevConsumerDescriptor(JSON.parse(root.getAttribute(NEXT_DEV_DESCRIPTOR_ATTRIBUTE)!)).sequence;
  };
  let root: Root | undefined;
  let failure: unknown;
  try {
    if (scenario === "ssr-strict") {
      let markerRejected = false;
      try { stylexNextDevRevision(); } catch { markerRejected = true; }
      f.check(markerRejected, "untransformed marker must fail closed");
      const html = renderToString(tree(1, 1)); // no document owner exists yet
      f.check(f.events.length === 0 && f.timers.size === 0, "SSR must allocate no effects or request resources");
      container.innerHTML = html;
      const original = button();
      f.install();
      await f.flush(() => { root = hydrateRoot(container, tree(1, 1)); });
      f.check(button() === original, "hydration must retain the exact server-rendered button");
      const requestIndex = f.events.indexOf("request");
      const commitIndex = f.events.indexOf("commit:app/page.tsx:1");
      f.check(requestIndex >= 0 && commitIndex > requestIndex, "child native commit requires a registered response");
      f.check(f.subscribers() === 1 && f.mounts.size === 2 && f.phase() === "ready", "selective hydration must join one document and both live roots");
      f.check([...f.mounts.values()].every((mount) => !mount.parked && mount.descriptor.sequence === 1), "every server root must complete its actual ready native commit");
    } else {
      f.install(); root = createRoot(container);
      if (scenario === "abandoned") {
        suspend(4);
        await f.flush(() => { root!.render(<Suspense fallback={<span>outer fallback</span>}>{tree(1)}<Probe sequence={4} index={1} /></Suspense>); });
        f.check(f.events.length === 0 && f.timers.size === 0 && f.mounts.size === 0, "discarded render must not allocate leases, timers or refresh bindings");
        f.check(container.textContent === "outer fallback", "outer suspense must really prevent the consumer commit");
      } else if (scenario === "initial-unready") {
        await f.flush(() => { root!.render(tree(2)); });
        f.check(container.innerHTML === "" && f.mounts.size === 0, "initial unavailable response must keep a style-free empty fallback");
        f.check(f.responses.getSnapshot().pending === 1 && f.timers.size === 1, "non-suspending outer owner must commit its request");
        await f.flush(() => { [...f.timers.values()][0]!.callback(); });
        f.check(f.phase() === "restart-required" && container.innerHTML === "", "deadline keeps initial fallback without throwing");
      } else {
        if (scenario === "stale-siblings") f.statuses.set(2, "ready");
        await f.flush(() => { root!.render(scenario === "stale-siblings" ? tree(2, 2) : tree(1)); });
        const initialSequence = scenario === "stale-siblings" ? 2 : 1;
        const initialRoots = scenario === "stale-siblings" ? 2 : 1;
        const commitIndex = f.events.indexOf(`commit:app/page.tsx:${String(initialSequence)}`);
        f.check(commitIndex >= 0 && commitIndex < f.events.indexOf("document:subscribe"),
          "ordinary createRoot child layout setup must precede the document effect");
        f.check(f.events.filter((event) => event === "root:park").length >= initialRoots, "Strict createRoot effects must replay actual cleanup/setup");
        f.check(f.subscribers() === 1 && f.mounts.size === initialRoots && [...f.mounts.values()].every((mount) => !mount.parked),
          "Strict replay must keep one document and every connected native root resumed");
        const original = button()!;
        await f.flush(() => { original.click(); original.click(); });
        f.check(original.textContent?.endsWith(":2"), "real React state must change before the update");
        if (scenario === "stale-siblings") {
          await f.flush(() => { root!.render(tree(1, 1)); });
          const ids = [...f.timers.keys()];
          f.check(sequence() === 2 && sequence(1) === 2 && f.responses.getSnapshot().pending === 2, "stale siblings retain both last-good roots");
          f.check(f.refreshes() === 1 && ids.length === 2, "stale siblings share exactly one public refresh epoch");
          f.statuses.set(3, "ready");
          await f.flush(() => { root!.render(tree(3, 1)); });
          f.check(sequence() === 3 && sequence(1) === 2 && f.responses.getSnapshot().pending === 1, "one accepted sibling cannot discharge another request");
          f.check([...f.timers.keys()][0] === ids[1] && f.refreshes() === 1, "updates cannot extend the remaining deadline or repeat its epoch");
        } else if (scenario === "future" || scenario === "suspension") {
          if (scenario === "suspension") suspend(2);
          await f.flush(() => { root!.render(tree(2)); });
          const [id, timer] = [...f.timers.entries()][0]!;
          f.check(sequence() === 1 && button() === original && f.responses.getSnapshot().pending === 1, "future metadata must not publish CSS authority or replace the accepted root");
          f.check(timer.milliseconds === 15_000, "request uses the original finite owner deadline");
          f.statuses.set(2, "unready");
          await f.flush(() => { f.responses.changed(); });
          f.check(sequence() === 1 && f.timers.get(id) === timer, "uncaptured/unloaded transitions cannot replace or extend custody");
          f.statuses.set(2, "ready");
          await f.flush(() => { f.responses.changed(); });
          if (scenario === "suspension") {
            f.check(sequence() === 1 && button() === original && original.checkVisibility(), "ready but suspended children keep the actual visible accepted subtree");
            f.check(f.responses.getSnapshot().pending === 1 && f.timers.get(id) === timer, "retained old root cannot acknowledge the new suspended response");
            await f.flush(() => { release(2); });
          }
          f.check(sequence() === 2 && button() === original && original.textContent === "2:2", "replacement must preserve both native identity and React client state");
          f.check(f.responses.getSnapshot().pending === 0 && f.timers.size === 0, "only the actual ready native commit discharges its request");
          await f.flush(() => { root!.render(tree(3)); });
          await f.flush(() => { [...f.timers.values()][0]!.callback(); });
          f.check(f.phase() === "restart-required" && sequence() === 2 && button() === original, "terminal state retains last-good UI without a reload/error path");
          await f.flush(() => { root!.render(tree(4, undefined, { ...f.descriptor(4), session: "b".repeat(32) })); });
          f.check(sequence() === 2 && original.textContent === "2:2", "terminal props cannot replace accepted content");
        } else if (scenario === "foreign") {
          await f.flush(() => { root!.render(tree(2, undefined, { ...f.descriptor(2), session: "b".repeat(32) })); });
          f.check(f.phase() === "restart-required" && sequence() === 1 && button() === original, "foreign captured metadata fails closed while preserving last-good UI");
        } else throw new Error("Unknown finite React bridge scenario");
      }
    }
  } catch (error) { failure = error; }
  try {
    if (root !== undefined) await f.flush(() => { root!.unmount(); });
    f.check(f.subscribers() === 0, "unmount must release the sole document subscription");
    f.check(f.responses.getSnapshot().pending === 0 && f.timers.size === 0, "unmount or terminal state must collect all request-only resources");
    if (f.phase() === "ready") f.check(f.mounts.size === 0, "physical detachment, not Strict cleanup, retires native roots");
  } catch (cleanup) { failure = failure === undefined ? cleanup : new AggregateError([failure, cleanup], "React assertions and cleanup failed"); }
  if (failure !== undefined) throw failure;
  return { scenario, assertions: f.assertions() };
};
