/**
 * Private development protocol model. Nothing in this module observes a browser,
 * proves a native load/React commit, or authorizes compiler publication. The
 * eventual native integration must supply those observations at their real
 * boundaries; this model must not be exported as an accepted Next adapter.
 */

const HASH = /^[a-f0-9]{64}$/u;
const SESSION = /^[a-f0-9]{32}$/u;
const SOURCE = /^app\/(?:[a-zA-Z0-9_-]+\/)*[a-zA-Z0-9_-]+\.tsx$/u;
const MAX_CONSUMERS = 64;
const MAX_REVISIONS = 32;

export type NextDevConsumerTarget = "client" | "edge-server" | "server";
export type NextDevConsumerSource = Readonly<{ source: string; target: NextDevConsumerTarget }>;
export type NextDevConsumerSnapshot = Readonly<{
  includedRevisions: readonly string[];
  revision: string;
  sequence: number;
  stylesheetSha256: string;
}>;
export type NextDevConsumerDescriptor = NextDevConsumerSnapshot & NextDevConsumerSource & Readonly<{
  href: string;
  kind: "hraness-stylex-next-dev-consumer";
  schemaVersion: 1;
  session: string;
}>;

declare const consumerBrand: unique symbol;
declare const transitionBrand: unique symbol;
declare const acquisitionBrand: unique symbol;
export type NextDevConsumerHandle = Readonly<{ [consumerBrand]: true }>;
export type NextDevConsumerTransition = Readonly<{ [transitionBrand]: true }>;
export type NextDevStylesheetAcquisition = Readonly<{ [acquisitionBrand]: true }>;

type Consumer = {
  current: NextDevConsumerSnapshot | null;
  parked: boolean;
  pending: Transition | null;
  source: NextDevConsumerSource;
};
type Transition = {
  consumer: Consumer;
  descriptor: NextDevConsumerDescriptor;
  state: "pending" | "cancelled" | "committed";
};
type Acquisition = { snapshot: NextDevConsumerSnapshot; state: "pending" | "loaded" | "cancelled" };

function requireValue(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`Next development consumer protocol: ${message}`);
}

function record(value: unknown, keys: readonly string[], description: string): Record<string, unknown> {
  requireValue(typeof value === "object" && value !== null && !Array.isArray(value), `${description} must be an object`);
  requireValue(Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null, `${description} must be plain`);
  requireValue(Reflect.ownKeys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key)), `${description} has unknown or missing keys`);
  const properties = Object.getOwnPropertyDescriptors(value);
  requireValue(keys.every((key) => properties[key]?.enumerable === true && Object.hasOwn(properties[key]!, "value")), `${description} must contain only enumerable data properties`);
  return value as Record<string, unknown>;
}

function hash(value: unknown, description: string): string {
  requireValue(typeof value === "string" && HASH.test(value), `${description} must be a canonical SHA-256`);
  return value;
}

function snapshot(value: unknown): NextDevConsumerSnapshot {
  const input = record(value, ["includedRevisions", "revision", "sequence", "stylesheetSha256"], "snapshot");
  const revision = hash(input.revision, "revision");
  const stylesheetSha256 = hash(input.stylesheetSha256, "stylesheet hash");
  requireValue(Number.isSafeInteger(input.sequence) && (input.sequence as number) > 0, "sequence must be a positive safe integer");
  const included = input.includedRevisions;
  requireValue(Array.isArray(included) && included.length > 0 && included.length <= MAX_REVISIONS, "included revisions exceed their finite bound");
  requireValue(Object.getPrototypeOf(included) === Array.prototype, "included revisions must have the ordinary array prototype");
  requireValue(Reflect.ownKeys(included).length === included.length + 1
    && Array.from({ length: included.length }, (_, index) => Object.getOwnPropertyDescriptor(included, String(index)))
      .every((property) => property?.enumerable === true && Object.hasOwn(property, "value")), "included revisions must be an ordinary dense array");
  const includedRevisions = Array.from({ length: included.length }, (_, index) =>
    hash(Object.getOwnPropertyDescriptor(included, String(index))!.value, "included revision"));
  requireValue(includedRevisions.every((entry, index) => index === 0 || includedRevisions[index - 1]! < entry), "included revisions must be strictly sorted and unique");
  requireValue(includedRevisions.includes(revision), "stylesheet omits its own revision");
  return Object.freeze({ includedRevisions: Object.freeze(includedRevisions), revision, sequence: input.sequence as number, stylesheetSha256 });
}

function source(value: unknown): NextDevConsumerSource {
  const input = record(value, ["source", "target"], "consumer source");
  requireValue(typeof input.source === "string" && SOURCE.test(input.source), "consumer source must be a finite ordinary app TSX path");
  requireValue(input.target === "client" || input.target === "server" || input.target === "edge-server", "consumer target is unsupported");
  requireValue(input.target === "client" || input.source.endsWith("/page.tsx"), "server consumers must be registered pages");
  return Object.freeze({ source: input.source, target: input.target });
}

function descriptor(value: unknown): NextDevConsumerDescriptor {
  const input = record(value, ["href", "includedRevisions", "kind", "revision", "schemaVersion", "sequence", "session", "source", "stylesheetSha256", "target"], "descriptor");
  requireValue(input.kind === "hraness-stylex-next-dev-consumer" && input.schemaVersion === 1, "descriptor kind or schema is unsupported");
  requireValue(typeof input.session === "string" && SESSION.test(input.session), "session must be a canonical nonce");
  const parsed = snapshot({ includedRevisions: input.includedRevisions, revision: input.revision, sequence: input.sequence, stylesheetSha256: input.stylesheetSha256 });
  requireValue(input.href === stylesheetHref(parsed.stylesheetSha256), "stylesheet URL differs from its immutable hash");
  return Object.freeze({ ...parsed, ...source({ source: input.source, target: input.target }), href: input.href,
    kind: "hraness-stylex-next-dev-consumer", schemaVersion: 1, session: input.session });
}

function stylesheetHref(stylesheetSha256: string): string {
  return `/_next/static/css/hraness-stylex/${stylesheetSha256}.css`;
}

/** A document-local, conservative ledger. Compiler completion is not an input. */
export function createNextDevConsumerLedger(options: Readonly<{
  consumers: readonly NextDevConsumerSource[];
  limits?: Readonly<{ consumers: number; revisions: number }>;
  session: string;
}>) {
  requireValue(typeof options.session === "string" && SESSION.test(options.session), "session must be a canonical nonce");
  const session = options.session;
  const limits = options.limits ?? { consumers: MAX_CONSUMERS, revisions: MAX_REVISIONS };
  requireValue(Number.isSafeInteger(limits.consumers) && limits.consumers > 0 && limits.consumers <= MAX_CONSUMERS, "consumer limit is unsupported");
  requireValue(Number.isSafeInteger(limits.revisions) && limits.revisions > 0 && limits.revisions <= MAX_REVISIONS, "revision limit is unsupported");
  const consumerLimit = limits.consumers;
  const revisionLimit = limits.revisions;
  requireValue(Array.isArray(options.consumers) && options.consumers.length > 0 && options.consumers.length <= MAX_CONSUMERS, "registered consumers exceed their finite bound");
  const sources = new Map<string, NextDevConsumerSource>();
  for (const value of options.consumers) {
    const registered = source(value);
    requireValue(!sources.has(registered.source), "consumer sources must be unique");
    sources.set(registered.source, registered);
  }
  const consumers = new Set<Consumer>();
  const handles = new WeakMap<NextDevConsumerHandle, Consumer>();
  const transitions = new WeakMap<NextDevConsumerTransition, Transition>();
  const snapshots = new Map<number, NextDevConsumerSnapshot>();
  const loadedStylesheets = new Map<string, NextDevConsumerSnapshot>();
  const pendingStylesheets = new Map<string, Acquisition>();
  const acquisitions = new WeakMap<NextDevStylesheetAcquisition, Acquisition>();
  let activeSequence: number | null = null;
  let initialSequence: number | null = null;
  let initialPinned = false;
  let highestSequence = 0;
  let state: "open" | "restart-required" | "closed" = "open";
  let reason: "consumer-limit" | "revision-limit" | "stylesheet-error" | "stylesheet-timeout" | null = null;

  const requireOpen = (): void => requireValue(state === "open", `document is ${state}`);
  const getConsumer = (handle: NextDevConsumerHandle): Consumer => {
    const current = handles.get(handle);
    requireValue(current !== undefined && consumers.has(current), "unknown or closed consumer handle");
    return current;
  };
  const getTransition = (handle: NextDevConsumerTransition): Transition => {
    const current = transitions.get(handle);
    requireValue(current !== undefined && current.state === "pending" && current.consumer.pending === current, "unknown or completed transition handle");
    return current;
  };
  const getAcquisition = (handle: NextDevStylesheetAcquisition): Acquisition => {
    const current = acquisitions.get(handle);
    requireValue(current !== undefined && current.state === "pending"
      && pendingStylesheets.get(current.snapshot.stylesheetSha256) === current, "unknown or completed stylesheet acquisition");
    return current;
  };
  const requiredRevisions = (): readonly string[] => Object.freeze([...new Set([
    ...(initialSequence === null ? [] : snapshots.get(initialSequence)!.includedRevisions),
    ...[...consumers].flatMap((consumer) => [
    ...(consumer.current === null ? [] : [consumer.current.revision]),
    ...(consumer.pending === null ? [] : [consumer.pending.descriptor.revision]),
    ]),
  ])].sort());
  const fail = (failure: NonNullable<typeof reason>): void => {
    state = "restart-required";
    reason = failure;
    for (const consumer of consumers) {
      if (consumer.pending !== null) consumer.pending.state = "cancelled";
      consumer.pending = null;
    }
    for (const acquisition of pendingStylesheets.values()) acquisition.state = "cancelled";
    pendingStylesheets.clear();
  };
  const expectedDescriptor = (registered: NextDevConsumerSource, sequence: number): NextDevConsumerDescriptor => {
    const published = snapshots.get(sequence);
    requireValue(published !== undefined, "unknown or retired stylesheet revision");
    return Object.freeze({ ...published, ...registered, href: stylesheetHref(published.stylesheetSha256),
      kind: "hraness-stylex-next-dev-consumer", schemaVersion: 1, session });
  };
  const capturedDescriptor = (value: unknown): NextDevConsumerDescriptor => {
    const parsed = descriptor(value);
    const registered = sources.get(parsed.source);
    requireValue(registered !== undefined, "unregistered consumer source");
    requireValue(JSON.stringify(parsed) === JSON.stringify(expectedDescriptor(registered, parsed.sequence)), "descriptor differs from captured producer authority");
    return parsed;
  };
  const activeStylesheet = (): NextDevConsumerSnapshot | null => activeSequence === null ? null : snapshots.get(activeSequence)!;
  const coversLiveConsumers = (published: NextDevConsumerSnapshot): boolean => requiredRevisions().every((revision) => published.includedRevisions.includes(revision));
  const isReady = (transition: Transition): boolean => {
    const active = activeStylesheet();
    return active !== null && loadedStylesheets.has(active.stylesheetSha256) && active.includedRevisions.includes(transition.descriptor.revision);
  };
  const removableStylesheets = (): readonly string[] => {
    const active = activeStylesheet();
    if (active === null || !coversLiveConsumers(active)) return [];
    const latest = snapshots.get(highestSequence)!;
    const required = new Set(requiredRevisions());
    return [...loadedStylesheets.values()].filter((published) => published.stylesheetSha256 !== active.stylesheetSha256
      && published.stylesheetSha256 !== latest.stylesheetSha256
      // Preserve the prior tag while a consumer still runs the prior source
      // revision. A same-source pruned replacement is different: all consumers
      // have already transitioned, and the new exact union covers them.
      && (published.revision === active.revision || !required.has(published.revision)))
      .map((published) => published.stylesheetSha256).sort();
  };

  return Object.freeze({
    /** Register captured producer authority, not values supplied by an RSC caller. */
    publish(value: unknown): void {
      requireOpen();
      const next = snapshot(value);
      // A document can start after earlier compilations, or skip failed builds.
      // Sequence gaps are valid; replay and regression are not.
      requireValue(next.sequence > highestSequence, "publication sequence must advance monotonically");
      for (const previous of snapshots.values()) {
        requireValue(previous.stylesheetSha256 !== next.stylesheetSha256
          || JSON.stringify(previous.includedRevisions) === JSON.stringify(next.includedRevisions), "one stylesheet hash has conflicting revision coverage");
      }
      if (snapshots.size >= revisionLimit) {
        fail("revision-limit");
        throw new Error("Next development consumer protocol: revision limit requires restart");
      }
      snapshots.set(next.sequence, next);
      highestSequence = next.sequence;
    },
    /** A compiler marker may select only a registered source and published snapshot. */
    descriptor(sourcePath: string, sequence: number): NextDevConsumerDescriptor {
      requireOpen();
      const registered = sources.get(sourcePath);
      requireValue(registered !== undefined, "unregistered consumer source");
      return expectedDescriptor(registered, sequence);
    },
    /** Validate during render without creating an abandoned-render lease. */
    captured(value: unknown): NextDevConsumerDescriptor {
      requireOpen();
      return capturedDescriptor(value);
    },
    /** Whole immutable union identity, suitable for a synchronous React store. */
    activeSnapshot(): NextDevConsumerSnapshot | null {
      requireOpen();
      return activeStylesheet();
    },
    /** Bootstrap owns already-painted SSR roots until their hydration census commits. */
    pinInitial(sequence: number): void {
      requireOpen();
      requireValue(!initialPinned && consumers.size === 0 && activeSequence === null && loadedStylesheets.size === 0
        && pendingStylesheets.size === 0 && sequence === highestSequence && snapshots.has(sequence), "initial pin must be established once before later publications");
      initialPinned = true;
      initialSequence = sequence;
    },
    /** Only the native document owner may acknowledge its completed hydration census. */
    initialHydrated(): void {
      requireOpen();
      requireValue(initialSequence !== null, "initial hydration pin is absent or completed");
      initialSequence = null;
    },
    open(sourcePath: string): NextDevConsumerHandle {
      requireOpen();
      const registered = sources.get(sourcePath);
      requireValue(registered !== undefined, "unregistered consumer source");
      if (consumers.size >= consumerLimit) {
        fail("consumer-limit");
        throw new Error("Next development consumer protocol: consumer limit requires restart");
      }
      const consumer: Consumer = { current: null, parked: false, pending: null, source: registered };
      const handle = Object.freeze({}) as NextDevConsumerHandle;
      consumers.add(consumer);
      handles.set(handle, consumer);
      return handle;
    },
    prepare(handle: NextDevConsumerHandle, value: unknown): NextDevConsumerTransition {
      requireOpen();
      const consumer = getConsumer(handle);
      requireValue(!consumer.parked && consumer.pending === null, "consumer is parked or already has a pending transition");
      const next = capturedDescriptor(value);
      const expected = expectedDescriptor(consumer.source, next.sequence);
      requireValue(JSON.stringify(next) === JSON.stringify(expected), "descriptor differs from captured producer authority");
      requireValue(consumer.current === null || next.sequence >= consumer.current.sequence, "older response cannot replace a committed consumer");
      const transition: Transition = { consumer, descriptor: next, state: "pending" };
      const token = Object.freeze({}) as NextDevConsumerTransition;
      consumer.pending = transition;
      transitions.set(token, transition);
      return token;
    },
    /** Register the actual acquisition before creating its native link. */
    acquireStylesheet(sequence: number): NextDevStylesheetAcquisition {
      requireOpen();
      const published = snapshots.get(sequence);
      requireValue(published !== undefined, "unknown or retired stylesheet revision");
      requireValue(!loadedStylesheets.has(published.stylesheetSha256), "stylesheet load was already acknowledged");
      requireValue(!pendingStylesheets.has(published.stylesheetSha256), "stylesheet acquisition is already pending");
      if (loadedStylesheets.size + pendingStylesheets.size >= revisionLimit) {
        fail("revision-limit");
        throw new Error("Next development consumer protocol: stylesheet limit requires restart");
      }
      const acquisition: Acquisition = { snapshot: published, state: "pending" };
      const handle = Object.freeze({}) as NextDevStylesheetAcquisition;
      pendingStylesheets.set(published.stylesheetSha256, acquisition);
      acquisitions.set(handle, acquisition);
      return handle;
    },
    /** Native load is asset-scoped and does not activate CSS or release a lease. */
    stylesheetLoaded(handle: NextDevStylesheetAcquisition): void {
      requireOpen();
      const acquisition = getAcquisition(handle);
      acquisition.state = "loaded";
      pendingStylesheets.delete(acquisition.snapshot.stylesheetSha256);
      loadedStylesheets.set(acquisition.snapshot.stylesheetSha256, acquisition.snapshot);
    },
    /** Called only after that pending native acquisition was cancelled/collected. */
    stylesheetCancelled(handle: NextDevStylesheetAcquisition): void {
      requireOpen();
      const acquisition = getAcquisition(handle);
      acquisition.state = "cancelled";
      pendingStylesheets.delete(acquisition.snapshot.stylesheetSha256);
    },
    canActivate(sequence: number): boolean {
      requireOpen();
      const published = snapshots.get(sequence);
      requireValue(published !== undefined, "unknown or retired stylesheet revision");
      return (activeSequence === null || sequence >= activeSequence)
        && loadedStylesheets.has(published.stylesheetSha256) && coversLiveConsumers(published);
    },
    /** Called after the native owner synchronously activates this eligible union. */
    activated(sequence: number): void {
      requireOpen();
      const published = snapshots.get(sequence);
      requireValue(published !== undefined && loadedStylesheets.has(published.stylesheetSha256), "stylesheet cannot activate before native CSS readiness");
      requireValue(activeSequence === null || sequence >= activeSequence, "stylesheet activation cannot move backwards");
      requireValue(coversLiveConsumers(published), "candidate stylesheet omits a live consumer revision");
      activeSequence = sequence;
    },
    /** A readiness query grants no retirement authority and changes no state. */
    ready(handle: NextDevConsumerTransition): boolean {
      requireOpen();
      return isReady(getTransition(handle));
    },
    /** Called after this exact consumer's React commit, never at hot.apply/idle. */
    committed(handle: NextDevConsumerTransition): void {
      requireOpen();
      const transition = getTransition(handle);
      requireValue(isReady(transition) && !transition.consumer.parked, "consumer cannot commit before native CSS readiness or while parked");
      transition.consumer.current = snapshots.get(transition.descriptor.sequence)!;
      transition.consumer.pending = null;
      transition.state = "committed";
    },
    cancel(handle: NextDevConsumerTransition): void {
      requireOpen();
      const transition = getTransition(handle);
      transition.consumer.pending = null;
      transition.state = "cancelled";
    },
    /** Strict Mode cleanup/hiding cannot establish permanent DOM disappearance. */
    park(handle: NextDevConsumerHandle): void {
      requireOpen();
      getConsumer(handle).parked = true;
    },
    resume(handle: NextDevConsumerHandle): void {
      requireOpen();
      getConsumer(handle).parked = false;
    },
    /**
     * Called only after the native mount owner proves its exact physical root
     * disconnected. Cleanup/hiding alone must call park(), never this method.
     */
    detached(handle: NextDevConsumerHandle): void {
      requireOpen();
      const consumer = getConsumer(handle);
      requireValue(consumer.parked, "consumer must be parked before physical retirement");
      if (consumer.pending !== null) consumer.pending.state = "cancelled";
      consumer.pending = null;
      consumers.delete(consumer);
    },
    /** Retirement of a descriptor does not imply retirement of a shared CSS asset. */
    retire(): Readonly<{ snapshots: readonly NextDevConsumerSnapshot[]; stylesheets: readonly string[] }> {
      requireOpen();
      const referenced = new Set([...consumers].flatMap((consumer) => [
        ...(consumer.current === null ? [] : [consumer.current.sequence]),
        ...(consumer.pending === null ? [] : [consumer.pending.descriptor.sequence]),
      ]));
      for (const acquisition of pendingStylesheets.values()) referenced.add(acquisition.snapshot.sequence);
      const retired: NextDevConsumerSnapshot[] = [];
      for (const [sequence, published] of snapshots) {
        // Streaming SSR roots can carry an earlier captured descriptor before
        // their first React commit registers a mount. Keep the finite bootstrap
        // catalogue, not merely the newest CSS snapshot, until that census ends.
        if (initialSequence !== null || sequence === highestSequence || sequence === activeSequence || referenced.has(sequence)) continue;
        snapshots.delete(sequence);
        retired.push(published);
      }
      return Object.freeze({ snapshots: Object.freeze(retired), stylesheets: Object.freeze(removableStylesheets()) });
    },
    /** Forget native ownership only after the eligible physical tag was removed. */
    stylesheetRetired(stylesheetSha256: string): void {
      requireOpen();
      requireValue(removableStylesheets().includes(stylesheetSha256), "stylesheet has no consumer-retirement authority");
      loadedStylesheets.delete(stylesheetSha256);
    },
    stylesheetFailed(handle: NextDevStylesheetAcquisition, failure: "stylesheet-error" | "stylesheet-timeout"): void {
      requireOpen();
      getAcquisition(handle);
      requireValue(failure === "stylesheet-error" || failure === "stylesheet-timeout", "unknown stylesheet failure");
      fail(failure);
    },
    /** Document destruction is explicit; an ordinary effect cleanup cannot call this. */
    close(): void {
      if (state === "closed") return;
      for (const consumer of consumers) {
        if (consumer.pending !== null) consumer.pending.state = "cancelled";
        consumer.pending = null;
      }
      consumers.clear();
      snapshots.clear();
      loadedStylesheets.clear();
      for (const acquisition of pendingStylesheets.values()) acquisition.state = "cancelled";
      pendingStylesheets.clear();
      activeSequence = null;
      initialSequence = null;
      state = "closed";
    },
    inspect() {
      return Object.freeze({ highestSequence, activeSequence, initialSequence, state, reason, consumers: consumers.size,
        parked: [...consumers].filter((consumer) => consumer.parked).length,
        pending: [...consumers].filter((consumer) => consumer.pending !== null).length,
        acquiring: pendingStylesheets.size,
        requiredRevisions: requiredRevisions(), residentSequences: Object.freeze([...snapshots.keys()]),
        loadedStylesheets: Object.freeze([...loadedStylesheets.keys()].sort()) });
    },
  });
}
