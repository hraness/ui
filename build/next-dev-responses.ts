/** Private browser request ownership. Response props never publish CSS authority. */
import type { NextDevConsumerDescriptor } from "./next-dev-consumers.js";

declare const responseHandleBrand: unique symbol;
export type NextDevResponseHandle = Readonly<{ [responseHandleBrand]: true }>;
export type NextDevResponseClassification = Readonly<{
  descriptor: NextDevConsumerDescriptor;
  status: "ready" | "unready" | "future" | "stale";
}>;

/** Pure local allocation, safe in an outer component ref before its first commit. */
export function createNextDevResponseHandle(): NextDevResponseHandle {
  return Object.freeze({}) as NextDevResponseHandle;
}

type Instance = { expected: NextDevConsumerDescriptor; floor: number; request: Request | null };
type Request = {
  generation: number;
  instance: Instance;
  parked: boolean;
  signalled: boolean;
  timer: number;
  wake: () => void;
};
type Epoch = { dispatched: boolean; id: number; members: Set<Request> };
type Snapshot = Readonly<{ pending: number; phase: "open" | "restart-required" | "closed"; refreshEpoch: number; version: number }>;
const same = (left: NextDevConsumerDescriptor, right: NextDevConsumerDescriptor): boolean => JSON.stringify(left) === JSON.stringify(right);

/**
 * A non-suspending outer component registers only from a commit effect. Its own
 * inner Suspense may wait without losing this owner or relying on child effects.
 * Request cleanup grants no native DOM, stylesheet or consumer-lease retirement.
 */
export function createNextDevResponseRequests(options: Readonly<{
  classify(value: unknown, committedFloor: number): NextDevResponseClassification;
  clearTimeout(id: number): void;
  restartRequired(): void;
  setTimeout(callback: () => void, milliseconds: number): number;
}>) {
  const instances = new WeakMap<NextDevResponseHandle, Instance>();
  const active = new Set<Request>();
  const listeners = new Set<() => void>();
  let epoch: Epoch | null = null;
  let highestEpoch = 0;
  let refresh: (() => void) | null = null;
  let dispatchQueued = false;
  let state: Snapshot = Object.freeze({ pending: 0, phase: "open", refreshEpoch: 0, version: 0 });

  const update = (): void => {
    state = Object.freeze({ pending: active.size, phase: state.phase, refreshEpoch: epoch?.id ?? 0, version: state.version + 1 });
    let failed = false;
    for (const listener of [...listeners]) { try { listener(); } catch { failed = true; } }
    if (failed && state.phase === "open") stop("restart-required");
  };
  const remove = (request: Request): void => {
    if (!active.delete(request)) return;
    options.clearTimeout(request.timer);
    request.instance.request = null;
    if (epoch?.members.delete(request) && epoch.members.size === 0) epoch = null;
  };
  const stop = (phase: "restart-required" | "closed"): void => {
    if (state.phase === "closed" || state.phase === phase) return;
    state = Object.freeze({ ...state, phase });
    const pending = [...active];
    for (const request of pending) remove(request);
    epoch = null;
    refresh = null;
    update();
    // Wake only to observe the explicit terminal store state. The React bridge
    // keeps its last accepted root/fallback and must never throw an Error here.
    for (const request of pending) { try { request.wake(); } catch { /* every pending owner still receives terminal state */ } }
    listeners.clear();
    if (phase === "restart-required") { try { options.restartRequired(); } catch { /* terminal ownership remains closed */ } }
  };
  const requireOpen = (): void => {
    if (state.phase !== "open") throw new Error(`Next development response owner is ${state.phase}`);
  };
  const classify = (value: unknown, floor: number): NextDevResponseClassification => {
    if (!Number.isSafeInteger(floor) || floor < 0) throw new Error("Next development committed response floor is invalid");
    const result = options.classify(value, floor);
    if (result.status === "ready" && result.descriptor.sequence < floor) throw new Error("Next development ready response violates its committed floor");
    return result;
  };
  const dispatch = (): void => {
    if (dispatchQueued || refresh === null || epoch === null || epoch.dispatched || state.phase !== "open") return;
    dispatchQueued = true;
    queueMicrotask(() => {
      dispatchQueued = false;
      if (refresh === null || epoch === null || epoch.dispatched || state.phase !== "open") return;
      // Mark before the public callback: synchronous reentrancy and Strict Mode
      // binding replay cannot dispatch this refresh epoch twice.
      epoch.dispatched = true;
      try { refresh(); } catch { stop("restart-required"); }
    });
  };
  const observe = (request: Request): boolean => {
    if (!active.has(request) || state.phase !== "open") return false;
    let changed = false;
    const result = classify(request.instance.expected, request.instance.floor);
    if (!same(result.descriptor, request.instance.expected)) throw new Error("Next development response authority changed its exact descriptor");
    if (result.status !== "ready" && request.signalled) { request.signalled = false; changed = true; }
    if (result.status === "stale") {
      if (epoch === null) {
        if (!Number.isSafeInteger(++highestEpoch)) throw new Error("Next development response epoch exhausted");
        epoch = { dispatched: false, id: highestEpoch, members: new Set() };
      }
      changed ||= !epoch.members.has(request);
      epoch.members.add(request);
      dispatch();
    }
    if (result.status === "ready" && !request.signalled) {
      request.signalled = true;
      request.wake();
      changed = true;
    }
    return changed;
  };

  return Object.freeze({
    getSnapshot: (): Snapshot => state,
    subscribe(listener: () => void): () => void {
      requireOpen(); listeners.add(listener); return () => { listeners.delete(listener); };
    },
    /** Called only by the committed, style-free root document's layout effect. */
    bindRefresh(callback: () => void): () => void {
      requireOpen();
      if (refresh !== null) throw new Error("Next development requires one mounted refresh owner");
      refresh = callback;
      dispatch();
      let bound = true;
      return () => { if (bound) { bound = false; refresh = null; } };
    },
    /** Read-only classification is the only operation permitted during render. */
    classify(value: unknown, committedFloor: number): NextDevResponseClassification {
      requireOpen(); return classify(value, committedFloor);
    },
    /** Commit effect: create/update this instance's obligation without extending its deadline. */
    request(handle: NextDevResponseHandle, value: unknown, committedFloor: number, wake: () => void): void {
      requireOpen();
      try {
        const result = classify(value, committedFloor);
        let instance = instances.get(handle);
        let changed = instance === undefined;
        if (instance === undefined) {
          if (typeof handle !== "object" || handle === null || !Object.isFrozen(handle)
            || Object.getPrototypeOf(handle) !== Object.prototype || Reflect.ownKeys(handle).length !== 0) {
            throw new Error("Next development response requires its local opaque handle");
          }
          instance = { expected: result.descriptor, floor: committedFloor, request: null };
          instances.set(handle, instance);
        } else {
          if (instance.expected.source !== result.descriptor.source || instance.expected.session !== result.descriptor.session
            || committedFloor < instance.floor) throw new Error("Next development response instance changed source/session or moved its floor backwards");
          changed = !same(instance.expected, result.descriptor) || instance.floor !== committedFloor;
          if (changed && instance.request !== null) instance.request.signalled = false;
          instance.expected = result.descriptor;
          instance.floor = committedFloor;
        }
        if (instance.request === null && result.status !== "ready") {
          if (active.size >= 64) throw new Error("Next development pending response limit requires restart");
          const request: Request = { generation: 0, instance, parked: false, signalled: false, timer: 0, wake };
          request.timer = options.setTimeout(() => { if (active.has(request)) stop("restart-required"); }, 15_000);
          instance.request = request;
          active.add(request);
          changed = true;
        }
        const request = instance.request;
        if (request === null) return;
        request.generation++;
        request.parked = false;
        request.wake = wake;
        const observed = observe(request);
        if (changed || observed) update();
      } catch (error) { stop("restart-required"); throw error; }
    },
    /** Actual native-root commit, after the independent document ledger accepts that root. */
    responseCommitted(handle: NextDevResponseHandle, value: unknown): void {
      requireOpen();
      try {
        const instance = instances.get(handle);
        if (instance === undefined || (instance.request !== null && instance.request.parked)) throw new Error("Next development response commit has no live instance");
        const result = classify(value, instance.floor);
        if (result.status !== "ready" || !same(instance.expected, result.descriptor)) throw new Error("Next development response commit differs from its exact ready request");
        instance.floor = result.descriptor.sequence;
        if (instance.request !== null) { remove(instance.request); update(); }
      } catch (error) { stop("restart-required"); throw error; }
    },
    /** Strict setup can resume the exact request before this request-only cancellation runs. */
    park(handle: NextDevResponseHandle): void {
      const request = instances.get(handle)?.request;
      if (request == null || state.phase !== "open") return;
      request.parked = true;
      const generation = ++request.generation;
      queueMicrotask(() => {
        if (state.phase !== "open" || !active.has(request) || !request.parked || request.generation !== generation) return;
        remove(request); update();
      });
    },
    /** Only actual producer catalogue/native CSS store changes may signal readiness. */
    changed(): void {
      if (state.phase !== "open") return;
      try { for (const request of active) observe(request); update(); }
      catch { stop("restart-required"); }
    },
    restartRequired: (): void => stop("restart-required"),
    close: (): void => stop("closed"),
  });
}
