/** Private browser integration. The adapter must capture and emit its catalogue. */
import {
  createNextDevConsumerLedger,
  type NextDevConsumerDescriptor,
  type NextDevConsumerHandle,
  type NextDevConsumerSnapshot,
  type NextDevConsumerSource,
} from "./next-dev-consumers.js";
import { createNextDevNativeStylesheets } from "./next-dev-native-css.js";

export const NEXT_DEV_CONSUMER_ATTRIBUTE = "data-hraness-stylex-consumer";
export const NEXT_DEV_DESCRIPTOR_ATTRIBUTE = "data-hraness-stylex-descriptor";

type Mount = {
  descriptor: NextDevConsumerDescriptor;
  handle: NextDevConsumerHandle;
  parked: boolean;
  root: HTMLElement;
};
export type NextDevDocumentSnapshot = Readonly<{
  active: NextDevConsumerSnapshot | null;
  availableSequence: number;
  phase: "bootstrap" | "ready" | "restart-required" | "closed";
}>;

/**
 * This owner observes real links, DOM roots and mutation delivery. React calls
 * committed() only from its layout commit effect; effect cleanup only parks a
 * mount. A compiler, HMR apply callback or ancestor cannot acknowledge a child.
 * Nothing here authorizes an unregistered descriptor received over Flight.
 */
export function createNextDevDocumentOwner(document: Document, options: Readonly<{
  consumers: readonly NextDevConsumerSource[];
  initial: NextDevConsumerSnapshot;
  session: string;
  snapshots?: readonly NextDevConsumerSnapshot[];
}>) {
  const view = document.defaultView;
  if (view === null) throw new Error("Next development document requires a native window");
  const ledger = createNextDevConsumerLedger({ consumers: options.consumers, session: options.session });
  const firstSource = options.consumers[0]!.source;
  for (const snapshot of options.snapshots ?? [options.initial]) ledger.publish(snapshot);
  const initial = ledger.descriptor(firstSource, options.initial.sequence);
  ledger.captured({ ...initial, ...options.initial });
  ledger.pinInitial(options.initial.sequence);
  const stylesheets = createNextDevNativeStylesheets(document);
  const available = new Map<number, NextDevConsumerSnapshot>(ledger.inspect().residentSequences.map((sequence) =>
    [sequence, ledger.descriptor(firstSource, sequence)]));
  const historyRevisions = new Set([...available.values()].flatMap(({ includedRevisions }) => includedRevisions));
  const bootstrapUnion = [...available.values()].reverse().find((snapshot) => [...historyRevisions].every((revision) => snapshot.includedRevisions.includes(revision)));
  if (bootstrapUnion === undefined) throw new Error("Next development bootstrap lacks a retained-history union; restart required");
  const acquisitions = new Map<string, Promise<void>>();
  const mounts = new Map<HTMLElement, Mount>();
  const listeners = new Set<() => void>();
  let documentSubscribers = 0;
  let censusComplete = document.readyState !== "loading";
  let censusPinned = false;
  const initialRoots = new Map<HTMLElement, NextDevConsumerDescriptor>();
  let initialLoaded = false;
  let started = false;
  let start!: () => void;
  let rejectStart!: (error: Error) => void;
  const startupReady = new Promise<void>((resolve, reject) => { start = resolve; rejectStart = reject; });
  void startupReady.catch(() => {});
  let startupTimer: number | null = null;
  let queued = false;
  let state: NextDevDocumentSnapshot = Object.freeze({ active: null, availableSequence: initial.sequence, phase: "bootstrap" });
  let ready!: () => void;
  let rejectReady!: (error: Error) => void;
  const hydrationReady = new Promise<void>((resolve, reject) => { ready = resolve; rejectReady = reject; });
  // A failure may precede the HMR runtime's first wait. Retain the rejection for
  // that owner without creating an unhandled browser rejection in the interim.
  void hydrationReady.catch(() => {});

  const notify = (): void => { for (const listener of [...listeners]) listener(); };
  const update = (phase: NextDevDocumentSnapshot["phase"]): void => {
    const active = phase === "closed" ? null : ledger.activeSnapshot();
    const availableSequence = ledger.inspect().highestSequence;
    if (state.active === active && state.phase === phase && state.availableSequence === availableSequence) return;
    state = Object.freeze({ active, availableSequence, phase });
    notify();
  };
  const terminal = (): void => {
    if (state.phase === "closed" || state.phase === "restart-required") return;
    // Keep the last accepted store snapshot and active CSS. Do not trigger a
    // React error boundary or Next's automatic full-reload error path.
    state = Object.freeze({ active: state.active, availableSequence: state.availableSequence, phase: "restart-required" });
    observer.disconnect();
    document.removeEventListener("DOMContentLoaded", contentLoaded);
    if (startupTimer !== null) { view.clearTimeout(startupTimer); startupTimer = null; }
    try { stylesheets.stop(); } catch { /* altered ownership is retained */ }
    rejectReady(new Error("Next development document requires restart"));
    rejectStart(new Error("Next development document requires restart"));
    notify();
  };
  const requireOpen = (): void => {
    if (state.phase === "closed" || state.phase === "restart-required") throw new Error(`Next development document is ${state.phase}`);
  };
  const rootDescriptor = (root: HTMLElement): NextDevConsumerDescriptor => {
    if (root.ownerDocument !== document || !root.isConnected || !["MAIN", "SECTION", "P"].includes(root.tagName)) {
      throw new Error("Next development consumer lost its exact native root");
    }
    const encoded = root.getAttribute(NEXT_DEV_DESCRIPTOR_ATTRIBUTE);
    if (encoded === null || encoded.length > 4096) throw new Error("Next development native root descriptor is absent or exceeds its bound");
    const parsed = ledger.captured(JSON.parse(encoded) as unknown);
    if (root.getAttribute(NEXT_DEV_CONSUMER_ATTRIBUTE) !== parsed.source) throw new Error("Next development native root source differs from its captured descriptor");
    return parsed;
  };
  const same = (left: NextDevConsumerDescriptor, right: NextDevConsumerDescriptor): boolean => JSON.stringify(left) === JSON.stringify(right);
  const roots = (): readonly HTMLElement[] => {
    const observed = [...document.querySelectorAll(`[${NEXT_DEV_CONSUMER_ATTRIBUTE}], [${NEXT_DEV_DESCRIPTOR_ATTRIBUTE}]`)];
    if (observed.length === 0 || observed.length > 64) throw new Error("Next development document consumer census is empty or exceeds its bound");
    return observed.map((node) => {
      if (!(node instanceof view.HTMLElement)) throw new Error("Next development consumer census includes a non-native root");
      rootDescriptor(node);
      return node;
    });
  };
  const reconcile = (): void => {
    queued = false;
    if (state.phase === "closed" || state.phase === "restart-required") return;
    try {
      // The browser parser's EOF event is independent of the gated application
      // startup. No React subscriber or consumer commit is required to pin the
      // already-delivered SSR roots and select their covering initial union.
      if (state.phase === "bootstrap" && censusComplete && !censusPinned) {
        for (const root of roots()) initialRoots.set(root, rootDescriptor(root));
        ledger.pinInitialConsumers([...initialRoots.values()]);
        censusPinned = true;
      }
      if (censusPinned && !started) {
        const currentRoots = roots();
        if (currentRoots.length !== initialRoots.size || currentRoots.some((root) => {
          const initial = initialRoots.get(root);
          return initial === undefined || !same(initial, rootDescriptor(root));
        })) throw new Error("Next development initial DOM census changed before application startup");
      }
      for (const [root, mount] of mounts) {
        if (!root.isConnected) {
          if (!mount.parked) throw new Error("Next development root disappeared without its commit cleanup");
          ledger.detached(mount.handle);
          mounts.delete(root);
        } else if (!same(rootDescriptor(root), mount.descriptor)) {
          throw new Error("Next development native root changed outside its accepted commit");
        }
      }
      if (state.phase === "bootstrap" && censusComplete && documentSubscribers > 0 && state.active !== null) {
        const census = roots();
        if (census.every((root) => mounts.has(root) && !mounts.get(root)!.parked)) {
          ledger.initialHydrated();
          update("ready");
          ready();
        }
      }
      // Mutation delivery and this microtask occur after all layout effects.
      // In particular, a Strict Mode cleanup/setup pair never releases a lease.
      const candidate = [...available.values()].reverse().find((snapshot) => ledger.canActivate(snapshot.sequence));
      if (candidate !== undefined && candidate.sequence !== state.active?.sequence) {
        stylesheets.activate(candidate.stylesheetSha256);
        ledger.activated(candidate.sequence);
        update(state.phase);
      }
      if (!started && censusPinned && initialLoaded && state.active !== null
        && stylesheets.loaded(state.active.stylesheetSha256)
        && ledger.inspect().requiredRevisions.every((revision) => state.active!.includedRevisions.includes(revision))) {
        started = true;
        initialRoots.clear();
        if (startupTimer !== null) { view.clearTimeout(startupTimer); startupTimer = null; }
        start();
      }
      const retirement = ledger.retire();
      for (const snapshot of retirement.snapshots) available.delete(snapshot.sequence);
      for (const hash of retirement.stylesheets) {
        stylesheets.retire(hash);
        ledger.stylesheetRetired(hash);
        acquisitions.delete(hash);
      }
    } catch { terminal(); }
  };
  const schedule = (): void => {
    if (queued || state.phase === "closed" || state.phase === "restart-required") return;
    queued = true;
    queueMicrotask(reconcile);
  };
  const contentLoaded = (): void => {
    // A dispatched event cannot prove parser EOF. Keep listening after an
    // early synthetic event so the actual native readiness transition wins.
    if (document.readyState === "loading") return;
    censusComplete = true;
    document.removeEventListener("DOMContentLoaded", contentLoaded);
    schedule();
  };
  const observer = new view.MutationObserver(schedule);
  observer.observe(document.documentElement, { childList: true, subtree: true, attributes: true,
    attributeFilter: [NEXT_DEV_CONSUMER_ATTRIBUTE, NEXT_DEV_DESCRIPTOR_ATTRIBUTE] });
  if (!censusComplete) document.addEventListener("DOMContentLoaded", contentLoaded);

  const acquire = (snapshot: NextDevConsumerSnapshot): Promise<void> => {
    const existing = acquisitions.get(snapshot.stylesheetSha256);
    if (existing !== undefined) return existing;
    const handle = ledger.acquireStylesheet(snapshot.sequence);
    const pending = stylesheets.acquire(snapshot.stylesheetSha256).then(() => {
      requireOpen();
      ledger.stylesheetLoaded(handle);
      // Publication and a successful load do not imply eligibility. The actual
      // native activation is delayed until every current lease is covered.
      schedule();
    }, (error: unknown) => {
      if (state.phase !== "closed" && state.phase !== "restart-required") {
        ledger.stylesheetFailed(handle, error instanceof Error && error.message.includes("deadline") ? "stylesheet-timeout" : "stylesheet-error");
        terminal();
      }
      throw new Error("Next development native stylesheet acquisition failed; restart required");
    });
    acquisitions.set(snapshot.stylesheetSha256, pending);
    void pending.catch(() => {});
    return pending;
  };
  // Acquire in sequence order before any load. The newer pruned tag therefore
  // already precedes the historical union and never needs to be moved later.
  // The exact initial trusted load remains mandatory even when older SSR needs
  // the historical union active until its real replacement commits.
  startupTimer = view.setTimeout(terminal, 15_000);
  for (const snapshot of [...new Map([bootstrapUnion, initial].map((snapshot) => [snapshot.sequence, snapshot])).values()]
    .sort((left, right) => left.sequence - right.sequence)) {
    const pending = acquire(snapshot);
    void pending.then(() => {
      if (snapshot.sequence === initial.sequence) initialLoaded = true;
      schedule();
    }, terminal);
  }
  schedule();

  const close = (): void => {
    if (state.phase === "closed") return;
    observer.disconnect();
    document.removeEventListener("DOMContentLoaded", contentLoaded);
    if (startupTimer !== null) { view.clearTimeout(startupTimer); startupTimer = null; }
    view.removeEventListener("pagehide", pageHidden);
    try { stylesheets.stop(); } catch { /* preserve foreign ownership */ }
    ledger.close();
    mounts.clear();
    initialRoots.clear();
    acquisitions.clear();
    available.clear();
    rejectReady(new Error("Next development document closed"));
    rejectStart(new Error("Next development document closed"));
    update("closed");
    listeners.clear();
  };
  const pageHidden = (event: PageTransitionEvent): void => {
    // A BFCache document still owns live consumers and stylesheets. The narrow
    // native profile must reject it instead of pretending destruction occurred.
    if (event.persisted) terminal();
    else close();
  };
  view.addEventListener("pagehide", pageHidden);

  return Object.freeze({
    startupReady,
    hydrationReady,
    getSnapshot: (): NextDevDocumentSnapshot => state,
    subscribe(listener: () => void): () => void {
      requireOpen();
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    subscribeDocument(listener: () => void): () => void {
      requireOpen();
      documentSubscribers++;
      listeners.add(listener);
      schedule();
      let subscribed = true;
      return () => {
        if (!subscribed) return;
        subscribed = false;
        documentSubscribers--;
        listeners.delete(listener);
      };
    },
    captured(value: unknown): NextDevConsumerDescriptor { requireOpen(); return ledger.captured(value); },
    available(value: unknown): Promise<void> {
      requireOpen();
      try {
        ledger.publish(value);
        const snapshot = ledger.descriptor(firstSource, ledger.inspect().highestSequence);
        available.set(snapshot.sequence, snapshot);
        // Catalogue authority can unblock a same-source RSC descriptor while
        // its eagerly pruned stylesheet is still loading or ineligible.
        update(state.phase);
        return acquire(snapshot);
      } catch (error) {
        terminal();
        throw error;
      }
    },
    /** Render-time selection has no effects and creates no speculative lease. */
    canRender(value: unknown): boolean {
      requireOpen();
      const descriptor = ledger.captured(value);
      return state.active !== null && stylesheets.loaded(state.active.stylesheetSha256)
        && state.active.includedRevisions.includes(descriptor.revision);
    },
    /** Called only by the exact native root's layout commit effect. */
    committed(root: HTMLElement, value: unknown): void {
      requireOpen();
      const descriptor = ledger.captured(value);
      if (!same(rootDescriptor(root), descriptor)) throw new Error("Next development commit differs from its physical root descriptor");
      let mount = mounts.get(root);
      if (mount === undefined) {
        mount = { descriptor, handle: ledger.open(descriptor.source), parked: false, root };
        mounts.set(root, mount);
      } else {
        if (mount.descriptor.source !== descriptor.source) throw new Error("Next development native root cannot change its registered source");
        if (mount.parked) ledger.resume(mount.handle);
      }
      const transition = ledger.prepare(mount.handle, descriptor);
      ledger.committed(transition);
      mount.descriptor = descriptor;
      mount.parked = false;
      schedule();
    },
    parked(root: HTMLElement): void {
      requireOpen();
      const mount = mounts.get(root);
      if (mount === undefined) throw new Error("Next development cleanup has no committed native root");
      ledger.park(mount.handle);
      mount.parked = true;
      schedule();
    },
    restartRequired: terminal,
    close,
    inspect: () => Object.freeze({ phase: state.phase, documentSubscribers, censusComplete, mounts: mounts.size,
      ledger: ledger.inspect(), native: stylesheets.inspect() }),
  });
}
