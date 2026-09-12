import { expect, test } from "bun:test";
import {
  createNextDevConsumerLedger,
  type NextDevConsumerHandle,
  type NextDevConsumerSnapshot,
  type NextDevConsumerTransition,
  type NextDevStylesheetAcquisition,
} from "./next-dev-consumers.js";

const revision = (value: number): string => value.toString(16).padStart(64, "0");
const session = "0123456789abcdef0123456789abcdef";
const sources = [
  { source: "app/client.tsx", target: "client" },
  { source: "app/page.tsx", target: "server" },
  { source: "app/unvisited/page.tsx", target: "edge-server" },
] as const;
const makeSnapshot = (sequence: number, included: number[] = [sequence], own = sequence, stylesheet = sequence + 100): NextDevConsumerSnapshot => ({
  includedRevisions: included.map(revision).sort(), revision: revision(own), sequence, stylesheetSha256: revision(stylesheet),
});
const ledger = (limits?: { consumers: number; revisions: number }) => createNextDevConsumerLedger({
  consumers: sources, session, ...(limits === undefined ? {} : { limits }),
});
type Ledger = ReturnType<typeof ledger>;

function load(subject: Ledger, sequence: number): void {
  subject.stylesheetLoaded(subject.acquireStylesheet(sequence));
}

function commit(subject: Ledger, consumer: NextDevConsumerHandle, source: string, sequence: number): void {
  const descriptor = subject.descriptor(source, sequence);
  const transition = subject.prepare(consumer, descriptor);
  if (!subject.ready(transition)) {
    if (!subject.inspect().loadedStylesheets.includes(descriptor.stylesheetSha256)) load(subject, sequence);
    subject.activated(sequence);
  }
  subject.committed(transition);
}

test("native load readiness and actual consumer commit are separate from publication and each other", () => {
  const subject = ledger();
  subject.publish(makeSnapshot(1));
  const consumer = subject.open("app/page.tsx");
  const transition = subject.prepare(consumer, subject.descriptor("app/page.tsx", 1));
  expect(subject.ready(transition)).toBeFalse();
  expect(() => subject.committed(transition)).toThrow("before native CSS readiness");
  expect(subject.inspect().pending).toBe(1);
  load(subject, 1);
  expect(subject.ready(transition)).toBeFalse();
  expect(() => subject.committed(transition)).toThrow("before native CSS readiness");
  subject.activated(1);
  expect(subject.ready(transition)).toBeTrue();
  expect(subject.inspect().pending).toBe(1);
  subject.committed(transition);
  expect(subject.inspect().pending).toBe(0);
  expect(subject.inspect().requiredRevisions).toEqual([revision(1)]);
  expect(() => subject.committed(transition)).toThrow("completed transition");
  expect(() => subject.acquireStylesheet(1)).toThrow("already acknowledged");
});

test("client, Node and Edge leases retain old CSS until each exact consumer commits", () => {
  for (const order of [[0, 1, 2], [0, 2, 1], [1, 0, 2], [1, 2, 0], [2, 0, 1], [2, 1, 0]]) {
    const subject = ledger();
    subject.publish(makeSnapshot(1));
    const consumers = sources.map(({ source }) => subject.open(source));
    consumers.forEach((consumer, index) => commit(subject, consumer, sources[index]!.source, 1));
    subject.publish(makeSnapshot(2, [1, 2]));
    const transitions = consumers.map((consumer, index) => subject.prepare(consumer, subject.descriptor(sources[index]!.source, 2)));
    load(subject, 2);
    subject.activated(2);
    expect(subject.retire().snapshots).toEqual([]);
    for (const [position, index] of order.entries()) {
      subject.committed(transitions[index]!);
      if (position < order.length - 1) {
        expect(subject.inspect().requiredRevisions).toEqual([revision(1), revision(2)]);
        expect(subject.retire().snapshots).toEqual([]);
      }
    }
    expect(subject.inspect().requiredRevisions).toEqual([revision(2)]);
    expect(subject.retire()).toEqual({ snapshots: [makeSnapshot(1)], stylesheets: [revision(101)] });
    // A second publication removes prior-only rules only after all leases moved.
    subject.publish(makeSnapshot(3, [2], 2));
    expect(subject.descriptor("app/page.tsx", 3).includedRevisions).toEqual([revision(2)]);
  }
});

test("an ancestor commit cannot release a deferred descendant and cleanup only parks its lease", () => {
  const subject = ledger();
  subject.publish(makeSnapshot(1));
  const parent = subject.open("app/page.tsx");
  const child = subject.open("app/client.tsx");
  commit(subject, parent, "app/page.tsx", 1);
  commit(subject, child, "app/client.tsx", 1);
  subject.publish(makeSnapshot(2, [1, 2]));
  commit(subject, parent, "app/page.tsx", 2);
  subject.park(child);
  subject.park(child);
  expect(subject.inspect().parked).toBe(1);
  expect(subject.retire().snapshots).toEqual([]);
  subject.publish(makeSnapshot(3, [2], 2));
  load(subject, 3);
  expect(subject.canActivate(3)).toBeFalse();
  expect(() => subject.activated(3)).toThrow("omits a live consumer");
  expect(subject.inspect().highestSequence).toBe(3);
  subject.resume(child);
  commit(subject, child, "app/client.tsx", 2);
  expect(subject.canActivate(3)).toBeTrue();
  subject.activated(3);
  expect(subject.retire().snapshots.map(({ sequence }) => sequence)).toEqual([1]);
});

test("verified physical retirement releases only that mount and invalidates its pending or late handles", () => {
  const subject = ledger();
  subject.publish(makeSnapshot(1));
  const removed = subject.open("app/page.tsx");
  const live = subject.open("app/client.tsx");
  commit(subject, removed, "app/page.tsx", 1);
  commit(subject, live, "app/client.tsx", 1);
  expect(() => subject.detached(removed)).toThrow("must be parked");
  subject.publish(makeSnapshot(2, [1, 2]));
  commit(subject, live, "app/client.tsx", 2);
  const pending = subject.prepare(removed, subject.descriptor("app/page.tsx", 2));
  subject.park(removed);
  expect(subject.retire().stylesheets).toEqual([]);
  // Only the real mount owner may supply this observation; an effect cleanup
  // is deliberately insufficient in the preceding control.
  subject.detached(removed);
  expect(subject.inspect()).toMatchObject({ consumers: 1, pending: 0, requiredRevisions: [revision(2)] });
  expect(() => subject.resume(removed)).toThrow("unknown or closed consumer");
  expect(() => subject.committed(pending)).toThrow("completed transition");
  expect(subject.retire().stylesheets).toEqual([revision(101)]);
});

test("abandoned render, parked readiness and failed CSS never commit or retire the last accepted revision", () => {
  for (const failure of ["stylesheet-error", "stylesheet-timeout"] as const) {
    const subject = ledger();
    subject.publish(makeSnapshot(1));
    const consumer = subject.open("app/page.tsx");
    commit(subject, consumer, "app/page.tsx", 1);
    subject.publish(makeSnapshot(2, [1, 2]));
    const abandoned = subject.prepare(consumer, subject.descriptor("app/page.tsx", 2));
    load(subject, 2);
    subject.activated(2);
    subject.park(consumer);
    expect(() => subject.committed(abandoned)).toThrow("while parked");
    subject.resume(consumer);
    subject.cancel(abandoned);
    expect(() => subject.committed(abandoned)).toThrow("completed transition");
    expect(subject.inspect().requiredRevisions).toEqual([revision(1)]);
    subject.publish(makeSnapshot(3, [1, 3]));
    const pending = subject.prepare(consumer, subject.descriptor("app/page.tsx", 3));
    subject.stylesheetFailed(subject.acquireStylesheet(3), failure);
    expect(subject.inspect()).toMatchObject({ state: "restart-required", reason: failure, pending: 0, acquiring: 0, requiredRevisions: [revision(1)], residentSequences: [1, 2, 3] });
    expect(() => subject.ready(pending)).toThrow("restart-required");
    expect(() => subject.retire()).toThrow("restart-required");
    expect(() => subject.publish(makeSnapshot(3, [1, 3]))).toThrow("restart-required");
    subject.close();
    subject.close();
    expect(subject.inspect()).toMatchObject({ state: "closed", consumers: 0, pending: 0, requiredRevisions: [], residentSequences: [] });
  }
});

test("captured authority rejects revision, source, target, session, hash, URL and coverage spoofing", () => {
  const subject = ledger();
  subject.publish(makeSnapshot(1));
  const consumer = subject.open("app/page.tsx");
  const valid = subject.descriptor("app/page.tsx", 1);
  const invalid = [
    { ...valid, revision: revision(9), includedRevisions: [revision(9)] },
    { ...valid, source: "app/unvisited/page.tsx", target: "edge-server" },
    { ...valid, target: "client" },
    { ...valid, session: "f".repeat(32) },
    { ...valid, stylesheetSha256: revision(999), href: `/_next/static/css/hraness-stylex/${revision(999)}.css` },
    { ...valid, href: `${valid.href}?v=2` },
    { ...valid, href: `https://example.com${valid.href}` },
    { ...valid, includedRevisions: [revision(1), revision(2)] },
    { ...valid, sequence: 2 },
    { ...valid, extra: true },
    { ...valid, schemaVersion: 2 },
    { ...valid, kind: "next-client-success" },
  ];
  for (const value of invalid) {
    expect(() => subject.prepare(consumer, value)).toThrow();
    expect(subject.inspect().pending).toBe(0);
  }
  const reversed = Object.fromEntries(Object.entries(valid).reverse());
  const accepted = subject.prepare(consumer, reversed);
  expect(subject.ready(accepted)).toBeFalse();
  expect(() => subject.prepare(consumer, valid)).toThrow("pending transition");
});

test("descriptors reject getters, prototypes, malformed arrays and noncanonical hashes without executing accessors", () => {
  const subject = ledger();
  subject.publish(makeSnapshot(1));
  const consumer = subject.open("app/page.tsx");
  const valid = subject.descriptor("app/page.tsx", 1);
  let accesses = 0;
  const accessor = { ...valid };
  Object.defineProperty(accessor, "revision", { enumerable: true, get() { accesses++; return revision(1); } });
  const sparse = new Array(1);
  const foreign = [revision(1)];
  Object.setPrototypeOf(foreign, { ...Array.prototype, map() { accesses++; return [revision(9)]; } });
  for (const value of [accessor, Object.assign(Object.create({ inherited: true }), valid),
    { ...valid, includedRevisions: foreign }, { ...valid, includedRevisions: sparse }, { ...valid, includedRevisions: [revision(1), revision(1)] },
    { ...valid, includedRevisions: [revision(2), revision(1)] }, { ...valid, revision: "A".repeat(64) },
    { ...valid, sequence: Number.MAX_SAFE_INTEGER + 1 }]) {
    expect(() => subject.prepare(consumer, value)).toThrow();
  }
  expect(accesses).toBe(0);
});

test("an old response cannot roll a live consumer backwards or resurrect a retired descriptor", () => {
  const subject = ledger();
  subject.publish(makeSnapshot(1));
  const old = subject.descriptor("app/page.tsx", 1);
  const consumer = subject.open("app/page.tsx");
  commit(subject, consumer, "app/page.tsx", 1);
  subject.publish(makeSnapshot(2, [1, 2]));
  commit(subject, consumer, "app/page.tsx", 2);
  expect(() => subject.prepare(consumer, old)).toThrow("older response");
  subject.retire();
  const newMount = subject.open("app/page.tsx");
  expect(() => subject.prepare(newMount, old)).toThrow("retired stylesheet");
  expect(() => subject.descriptor("app/page.tsx", 1)).toThrow("retired stylesheet");
});

test("retiring an older descriptor does not authorize removal of a CSS asset shared by a newer descriptor", () => {
  const subject = ledger();
  subject.publish(makeSnapshot(1));
  subject.publish(makeSnapshot(2, [1], 1, 101));
  expect(subject.retire()).toEqual({ snapshots: [makeSnapshot(1)], stylesheets: [] });
  expect(subject.inspect().residentSequences).toEqual([2]);
});

test("late or forged capability handles cannot affect another document or a closed one", () => {
  const subject = ledger();
  const other = ledger();
  subject.publish(makeSnapshot(1));
  other.publish(makeSnapshot(1));
  const consumer = subject.open("app/page.tsx");
  const transition = subject.prepare(consumer, subject.descriptor("app/page.tsx", 1));
  expect(() => other.prepare(consumer, other.descriptor("app/page.tsx", 1))).toThrow("unknown or closed consumer");
  expect(() => other.ready(transition)).toThrow("unknown or completed transition");
  expect(() => subject.prepare({} as NextDevConsumerHandle, subject.descriptor("app/page.tsx", 1))).toThrow("unknown or closed consumer");
  expect(() => subject.ready({} as NextDevConsumerTransition)).toThrow("unknown or completed transition");
  expect(() => subject.acquireStylesheet(999)).toThrow("unknown or retired stylesheet");
  const acquisition = subject.acquireStylesheet(1);
  expect(() => other.stylesheetLoaded(acquisition)).toThrow("unknown or completed stylesheet acquisition");
  expect(() => subject.stylesheetLoaded({} as NextDevStylesheetAcquisition)).toThrow("unknown or completed stylesheet acquisition");
  subject.close();
  expect(() => subject.stylesheetLoaded(acquisition)).toThrow("closed");
  expect(() => subject.committed(transition)).toThrow("closed");
});

test("finite bounds stop the document without evicting live or parked revisions", () => {
  const subject = ledger({ consumers: 2, revisions: 2 });
  subject.publish(makeSnapshot(1));
  const consumer = subject.open("app/page.tsx");
  commit(subject, consumer, "app/page.tsx", 1);
  subject.park(consumer);
  subject.publish(makeSnapshot(2, [1, 2]));
  expect(subject.retire().snapshots).toEqual([]);
  expect(() => subject.publish(makeSnapshot(3, [1, 3]))).toThrow("revision limit requires restart");
  expect(subject.inspect()).toMatchObject({ state: "restart-required", reason: "revision-limit", residentSequences: [1, 2], requiredRevisions: [revision(1)] });
  const crowded = ledger({ consumers: 1, revisions: 2 });
  crowded.open("app/page.tsx");
  expect(() => crowded.open("app/client.tsx")).toThrow("consumer limit requires restart");
  expect(crowded.inspect()).toMatchObject({ state: "restart-required", reason: "consumer-limit", consumers: 1 });
});

test("registration and publication reject arbitrary markers, ambiguous targets and mutable authority", () => {
  for (const consumers of [[], [sources[0], sources[0]], [{ source: "../app/page.tsx", target: "server" }],
    [{ source: "app/[slug]/page.tsx", target: "server" }], [{ source: "app/layout.tsx", target: "server" }],
    [{ source: "app/page.tsx", target: "unknown" }]]) {
    expect(() => createNextDevConsumerLedger({ consumers: consumers as unknown as typeof sources, session })).toThrow();
  }
  const mutable = { consumers: [...sources], session, limits: { consumers: 2, revisions: 2 } };
  const subject = createNextDevConsumerLedger(mutable);
  mutable.session = "f".repeat(32);
  mutable.consumers.length = 0;
  mutable.limits.revisions = 999;
  const input = { ...makeSnapshot(1), includedRevisions: [revision(1)] };
  subject.publish(input);
  input.includedRevisions[0] = revision(9);
  expect(subject.descriptor("app/page.tsx", 1).session).toBe(session);
  expect(subject.descriptor("app/page.tsx", 1).includedRevisions).toEqual([revision(1)]);
  expect(() => subject.descriptor("unregistered-marker", 1)).toThrow("unregistered");
  expect(() => subject.publish(makeSnapshot(1))).toThrow("advance monotonically");
  subject.publish(makeSnapshot(7));
  expect(() => subject.publish(makeSnapshot(6))).toThrow("advance monotonically");
  expect(() => subject.publish(makeSnapshot(8))).toThrow("revision limit");
});

test("an available pruned artifact cannot deadlock a same-source RSC commit or prune an older live consumer", () => {
  const subject = ledger();
  subject.publish(makeSnapshot(1));
  const client = subject.open("app/client.tsx");
  const server = subject.open("app/page.tsx");
  commit(subject, client, "app/client.tsx", 1);
  commit(subject, server, "app/page.tsx", 1);
  subject.publish(makeSnapshot(2, [1, 2]));
  commit(subject, client, "app/client.tsx", 2);
  subject.publish(makeSnapshot(3, [2], 2));
  load(subject, 3);
  expect(subject.canActivate(3)).toBeFalse();
  expect(subject.retire().stylesheets).toEqual([]);
  // The actual RSC compilation may reference the eager prune artifact. The
  // already loaded, producer-bound transition union also proves exact revision
  // 2's CSS. This does not relabel either artifact's digest or coverage.
  const transition = subject.prepare(server, subject.descriptor("app/page.tsx", 3));
  expect(subject.ready(transition)).toBeTrue();
  expect(subject.inspect().activeSequence).toBe(2);
  expect(subject.retire().stylesheets).toEqual([]);
  subject.committed(transition);
  expect(subject.canActivate(3)).toBeTrue();
  subject.activated(3);
  const retirement = subject.retire();
  expect(retirement.stylesheets).toEqual([revision(101), revision(102)]);
  // Planning is not proof that physical tags were removed.
  expect(subject.inspect().loadedStylesheets).toEqual([revision(101), revision(102), revision(103)]);
  retirement.stylesheets.forEach((stylesheet) => subject.stylesheetRetired(stylesheet));
  expect(subject.inspect().loadedStylesheets).toEqual([revision(103)]);
  expect(() => subject.stylesheetRetired(revision(103))).toThrow("no consumer-retirement authority");
  // Client-local state may render the same accepted source descriptor after its
  // transitional asset was removed; the exact pruned union still covers it.
  const rerender = subject.prepare(client, subject.descriptor("app/client.tsx", 2));
  expect(subject.ready(rerender)).toBeTrue();
  subject.committed(rerender);
});

test("in-flight native acquisitions pin metadata until their exact load or physical cancellation", () => {
  for (const outcome of ["load", "cancel"] as const) {
    const subject = ledger();
    subject.publish(makeSnapshot(1));
    const initial = subject.acquireStylesheet(1);
    expect(() => subject.acquireStylesheet(1)).toThrow("already pending");
    subject.publish(makeSnapshot(2, [1, 2]));
    expect(subject.retire().snapshots).toEqual([]);
    expect(subject.inspect()).toMatchObject({ acquiring: 1, residentSequences: [1, 2] });
    if (outcome === "load") {
      subject.stylesheetLoaded(initial);
      subject.activated(1);
      expect(subject.retire().snapshots).toEqual([]);
      expect(() => subject.stylesheetCancelled(initial)).toThrow("completed stylesheet acquisition");
    } else {
      // The native owner must first cancel its exact link, listeners and timer.
      subject.stylesheetCancelled(initial);
      expect(subject.retire().snapshots).toEqual([makeSnapshot(1)]);
      expect(() => subject.stylesheetLoaded(initial)).toThrow("completed stylesheet acquisition");
      expect(() => subject.acquireStylesheet(1)).toThrow("retired stylesheet");
    }
    expect(subject.inspect().acquiring).toBe(0);
  }
});

test("bootstrap retains initial SSR CSS until the actual document hydration census has committed", () => {
  const subject = ledger();
  subject.publish(makeSnapshot(1));
  subject.pinInitial(1);
  subject.pinInitialConsumers([subject.descriptor("app/page.tsx", 1)]);
  const consumer = subject.open("app/page.tsx");
  commit(subject, consumer, "app/page.tsx", 1);
  subject.publish(makeSnapshot(2, [1, 2]));
  commit(subject, consumer, "app/page.tsx", 2);
  subject.publish(makeSnapshot(3, [2], 2));
  load(subject, 3);
  expect(subject.inspect().requiredRevisions).toEqual([revision(1), revision(2)]);
  expect(subject.canActivate(3)).toBeFalse();
  expect(subject.retire().stylesheets).toEqual([]);
  expect(subject.activeSnapshot()).toBe(subject.activeSnapshot());
  expect(subject.activeSnapshot()).toEqual(makeSnapshot(2, [1, 2]));
  subject.initialHydrated();
  expect(subject.canActivate(3)).toBeTrue();
  subject.activated(3);
  expect(subject.retire().stylesheets).toEqual([revision(101), revision(102)]);
  expect(() => subject.initialHydrated()).toThrow("absent or completed");
  expect(() => subject.pinInitial(3)).toThrow("once before later publications");
});

test("a bootstrap transition keeps every captured SSR descriptor before its first hydration commit", () => {
  const subject = ledger();
  subject.publish(makeSnapshot(1));
  subject.publish(makeSnapshot(2, [1, 2]));
  const olderServer = subject.descriptor("app/page.tsx", 1);
  subject.pinInitial(2);
  subject.pinInitialConsumers([olderServer]);
  load(subject, 2);
  subject.activated(2);
  subject.publish(makeSnapshot(3, [2], 2));
  load(subject, 3);
  expect(subject.retire().snapshots).toEqual([]);
  expect(subject.captured(olderServer)).toEqual(olderServer);
  expect(subject.canActivate(3)).toBeFalse();
  const server = subject.open("app/page.tsx");
  commit(subject, server, "app/page.tsx", 1);
  subject.initialHydrated();
  expect(subject.canActivate(3)).toBeFalse();
  commit(subject, server, "app/page.tsx", 3);
  expect(subject.canActivate(3)).toBeTrue();
});

test("native initial census is required before activation and rejects spoofed or accessor-based descriptors", () => {
  const subject = ledger();
  subject.publish(makeSnapshot(1));
  subject.pinInitial(1);
  load(subject, 1);
  expect(subject.canActivate(1)).toBeFalse();
  expect(() => subject.activated(1)).toThrow("native initial consumer census");
  let getterCalls = 0;
  const accessor: unknown[] = [];
  Object.defineProperty(accessor, "0", { enumerable: true, get() { getterCalls++; return subject.descriptor("app/page.tsx", 1); } });
  expect(() => subject.pinInitialConsumers(accessor)).toThrow("dense data properties");
  expect(getterCalls).toBe(0);
  expect(() => subject.pinInitialConsumers(new Array(1))).toThrow("dense");
  expect(() => subject.pinInitialConsumers([{ ...subject.descriptor("app/page.tsx", 1), revision: revision(99) }])).toThrow();
  subject.pinInitialConsumers([subject.descriptor("app/page.tsx", 1)]);
  expect(subject.canActivate(1)).toBeTrue();
  expect(() => subject.pinInitialConsumers([subject.descriptor("app/page.tsx", 1)])).toThrow("once before activation");
  subject.activated(1);
  subject.close();
});
