import { expect, test } from "bun:test";
import { createNextDevConsumerLedger } from "./next-dev-consumers.js";
import { createNextDevBridgeOwner } from "./next-dev-bootstrap.js";
import { createNextDevDocumentOwner, NEXT_DEV_CONSUMER_ATTRIBUTE, NEXT_DEV_DESCRIPTOR_ATTRIBUTE } from "./next-dev-document.js";

// Deterministic document doubles exercise lifecycle wiring, not native CSS,
// React, HMR or emitted-browser acceptance.
class ElementDouble {
  readonly attributes = new Map<string, string>();
  isConnected = true;
  constructor(readonly ownerDocument: DocumentDouble, readonly tagName = "MAIN") {}
  getAttribute(name: string): string | null { return this.attributes.get(name) ?? null; }
  setAttribute(name: string, value: string): void { this.attributes.set(name, value); }
}
class LinkDouble extends ElementDouble {
  readonly listeners = new Map<string, Set<(event: Event) => void>>();
  rel = ""; type = ""; media = ""; crossOrigin = ""; disabled = false;
  parentNode: DocumentDouble["head"] | null = null;
  sheet: { href: string; ownerNode: LinkDouble } | null = null;
  constructor(document: DocumentDouble) { super(document, "LINK"); }
  get href(): string { return new URL(this.getAttribute("href") ?? "", this.ownerDocument.location).href; }
  compareDocumentPosition(other: LinkDouble): number { return this.ownerDocument.links.indexOf(this) < this.ownerDocument.links.indexOf(other) ? 4 : 2; }
  addEventListener(name: string, callback: (event: Event) => void): void {
    const listeners = this.listeners.get(name) ?? new Set(); listeners.add(callback); this.listeners.set(name, listeners);
  }
  removeEventListener(name: string, callback: (event: Event) => void): void { this.listeners.get(name)?.delete(callback); }
  emit(name: string): void { for (const callback of this.listeners.get(name) ?? []) callback({ isTrusted: true, target: this } as unknown as Event); }
  load(): void { this.sheet = { href: this.href, ownerNode: this }; this.emit("load"); }
}
class DocumentDouble {
  readonly location = new URL("http://127.0.0.1:43210/");
  readonly documentElement = {};
  readonly links: LinkDouble[] = [];
  readonly roots: ElementDouble[] = [];
  readonly listeners = new Map<string, Set<() => void>>();
  readonly windowListeners = new Map<string, Set<(event: unknown) => void>>();
  readonly observers = new Set<() => void>();
  readyState = "loading";
  readonly defaultView;
  constructor() {
    const observers = this.observers;
    this.defaultView = {
      HTMLElement: ElementDouble,
      MutationObserver: class {
        constructor(readonly callback: () => void) {}
        observe(): void { observers.add(this.callback); }
        disconnect(): void { observers.delete(this.callback); }
      },
      addEventListener: (name: string, callback: (event: unknown) => void) => {
        const listeners = this.windowListeners.get(name) ?? new Set(); listeners.add(callback); this.windowListeners.set(name, listeners);
      },
      removeEventListener: (name: string, callback: (event: unknown) => void) => { this.windowListeners.get(name)?.delete(callback); },
    };
  }
  readonly head = {
    appendChild: (link: LinkDouble) => { link.parentNode = this.head; this.links.push(link); return link; },
    insertBefore: (link: LinkDouble, before: LinkDouble) => {
      const previous = this.links.indexOf(link);
      if (previous >= 0) this.links.splice(previous, 1);
      this.links.splice(this.links.indexOf(before), 0, link); link.parentNode = this.head; return link;
    },
    removeChild: (link: LinkDouble) => {
      if (link.parentNode !== this.head) throw new Error("foreign tag");
      this.links.splice(this.links.indexOf(link), 1); link.parentNode = null; link.isConnected = false; return link;
    },
  };
  createElement(tag: string): LinkDouble { if (tag !== "link") throw new Error("only links"); return new LinkDouble(this); }
  querySelectorAll(): readonly ElementDouble[] { return this.roots.filter((root) => root.isConnected); }
  addEventListener(name: string, callback: () => void): void {
    const listeners = this.listeners.get(name) ?? new Set(); listeners.add(callback); this.listeners.set(name, listeners);
  }
  removeEventListener(name: string, callback: () => void): void { this.listeners.get(name)?.delete(callback); }
  loaded(): void { this.readyState = "complete"; for (const callback of this.listeners.get("DOMContentLoaded") ?? []) callback(); }
  mutation(): void { for (const callback of this.observers) callback(); }
}
const hash = (value: number): string => value.toString(16).padStart(64, "0");
const snapshot = (sequence: number, revisions = [sequence], revision = sequence) => ({
  sequence, revision: hash(revision), includedRevisions: revisions.map(hash), stylesheetSha256: hash(sequence + 100),
});
const consumers = [{ source: "app/page.tsx", target: "server" }, { source: "app/client.tsx", target: "client" }] as const;
const session = "0123456789abcdef0123456789abcdef";
const tick = async (): Promise<void> => { await Promise.resolve(); await Promise.resolve(); };
function fixture(withBridge = false) {
  const document = new DocumentDouble();
  const authority = createNextDevConsumerLedger({ consumers, session });
  authority.publish(snapshot(1));
  const options = { consumers: [...consumers], session, initial: snapshot(1) };
  const bridge = withBridge ? createNextDevBridgeOwner(document as unknown as Document, {
    consumers: [...consumers].sort((left, right) => left.source.localeCompare(right.source)), session, currentSequence: 1, snapshots: [snapshot(1)],
  }) : null;
  const owner = bridge?.documentOwner ?? createNextDevDocumentOwner(document as unknown as Document, options);
  const render = (root: ElementDouble, source: string, sequence: number): void => {
    root.setAttribute(NEXT_DEV_CONSUMER_ATTRIBUTE, source);
    root.setAttribute(NEXT_DEV_DESCRIPTOR_ATTRIBUTE, JSON.stringify(authority.descriptor(source, sequence)));
  };
  const roots = consumers.map(({ source }, index) => {
    const root = new ElementDouble(document, index === 0 ? "MAIN" : "SECTION");
    document.roots.push(root); render(root, source, 1); return root;
  });
  const commit = (index: number, sequence: number): void => {
    const root = roots[index]!;
    render(root, consumers[index]!.source, sequence);
    owner.committed(root as unknown as HTMLElement, authority.descriptor(consumers[index]!.source, sequence));
  };
  const publish = (sequence: number, revisions = [sequence], revision = sequence): Promise<void> => {
    const value = snapshot(sequence, revisions, revision); authority.publish(value); return owner.available(value);
  };
  const bootstrap = async (): Promise<void> => {
    owner.subscribeDocument(() => {});
    document.links[0]!.load(); await owner.startupReady;
    commit(0, 1); commit(1, 1); document.loaded(); await owner.hydrationReady;
  };
  return { document, authority, owner, roots, render, commit, publish, bootstrap, options, bridge };
}

test("entry readiness requires native load and activation; hydration requires every root and a subscribed document", async () => {
  const { document, owner, commit } = fixture();
  let startup = false;
  void owner.startupReady.then(() => { startup = true; });
  await tick(); expect(startup).toBeFalse();
  document.links[0]!.load(); await owner.startupReady;
  expect(document.links[0]!.media).toBe("all");
  commit(0, 1); commit(1, 1); document.loaded(); await tick();
  expect(owner.getSnapshot().phase).toBe("bootstrap");
  const unsubscribe = owner.subscribeDocument(() => {});
  unsubscribe(); await tick();
  expect(owner.getSnapshot().phase).toBe("bootstrap");
  owner.subscribeDocument(() => {}); await owner.hydrationReady;
  expect(owner.getSnapshot().phase).toBe("ready");
  expect(owner.inspect().ledger.initialSequence).toBeNull();
  owner.close();
  expect(document.observers.size).toBe(0);
  expect(document.windowListeners.get("pagehide")?.size).toBe(0);
});

test("native document retains old server CSS through client commit and eager pruning until the server commits", async () => {
  const { document, owner, bootstrap, publish, commit } = fixture();
  await bootstrap();
  const old = document.links[0]!;
  const changed = publish(2, [1, 2]);
  await tick(); expect(owner.getSnapshot().active?.sequence).toBe(1);
  document.links[0]!.load(); await changed; await tick();
  commit(1, 2); await tick();
  expect(document.links).toContain(old);
  const pruned = publish(3, [2], 2);
  document.links.find((link) => link.getAttribute("href")?.includes(hash(103)))!.load(); await pruned; await tick();
  expect(owner.getSnapshot().active?.sequence).toBe(2);
  expect(owner.inspect().ledger.requiredRevisions).toEqual([hash(1), hash(2)]);
  commit(0, 3); await tick();
  expect(owner.getSnapshot().active?.sequence).toBe(3);
  expect(document.links).not.toContain(old);
  expect(document.links).toHaveLength(1);
  expect(owner.inspect().native).toMatchObject({ loaded: 1, active: 1, pending: 0 });
  owner.close();
});

test("Strict Mode cleanup cannot retire a connected root; actual removal retires only its parked lease", async () => {
  const { document, owner, roots, bootstrap, publish, commit } = fixture();
  await bootstrap();
  const changed = publish(2, [1, 2]); document.links[0]!.load(); await changed;
  commit(1, 2);
  owner.parked(roots[0] as unknown as HTMLElement);
  await tick();
  expect(owner.inspect().ledger.requiredRevisions).toEqual([hash(1), hash(2)]);
  commit(0, 1); await tick();
  expect(owner.inspect().ledger.parked).toBe(0);
  owner.parked(roots[0] as unknown as HTMLElement);
  roots[0]!.isConnected = false; document.mutation(); await tick();
  expect(owner.inspect().ledger.requiredRevisions).toEqual([hash(2)]);
  expect(owner.inspect().mounts).toBe(1);
  expect(owner.getSnapshot().phase).toBe("ready");
  owner.close();
});

test("a failed real acquisition stops native work and keeps the last accepted document and CSS", async () => {
  const { document, owner, bootstrap, publish } = fixture();
  await bootstrap();
  const old = document.links[0]!;
  const changed = publish(2, [1, 2]);
  const failed = changed.then(() => "unexpected success", (error: unknown) => error);
  document.links[0]!.emit("error");
  expect(await failed).toBeInstanceOf(Error);
  expect(owner.getSnapshot()).toMatchObject({ phase: "restart-required", active: snapshot(1) });
  expect(document.links).toEqual([old]);
  expect(owner.inspect().native).toMatchObject({ active: 1, pending: 0, stopped: true });
  expect(document.observers.size).toBe(0);
  expect(() => owner.available(snapshot(3))).toThrow("restart-required");
  owner.close();
});

test("unacknowledged native-root changes cannot become a retirement proof", async () => {
  for (const change of ["descriptor", "unmount"] as const) {
    const { document, owner, roots, bootstrap } = fixture();
    await bootstrap();
    if (change === "descriptor") roots[0]!.setAttribute(NEXT_DEV_CONSUMER_ATTRIBUTE, "app/client.tsx");
    else roots[0]!.isConnected = false;
    document.mutation(); await tick();
    expect(owner.getSnapshot().phase).toBe("restart-required");
    expect(owner.inspect().ledger.requiredRevisions).toEqual([hash(1)]);
    expect(document.links).toHaveLength(1);
    expect(document.links[0]!.media).toBe("all");
    owner.close();
  }
});

test("producer source registration is captured before caller input mutation", async () => {
  const { document, owner, options, bootstrap, publish } = fixture();
  await bootstrap();
  options.consumers.length = 0;
  options.session = "f".repeat(32);
  const next = publish(2, [1, 2]);
  document.links[0]!.load(); await next; await tick();
  expect(owner.getSnapshot().active?.sequence).toBe(2);
  expect(owner.getSnapshot().phase).toBe("ready");
  owner.close();
});

const catalogue = (values = [snapshot(1)]) => ({ consumers: [...consumers].sort((left, right) => left.source.localeCompare(right.source)),
  currentSequence: values.at(-1)!.sequence, session, snapshots: values });
const metadata = (values = [snapshot(1), snapshot(2, [1, 2])]) => ({ catalogue: catalogue(values), fromHash: "1".repeat(16), toHash: "2".repeat(16),
  kind: "hraness-stylex-next-dev-hot-update" as const, schemaVersion: 1 as const, session });

test("the browser factory adopts authority before waiting for hydration and gates updates on actual active CSS", async () => {
  const { document, owner, bridge, authority, commit } = fixture(true);
  const update = metadata();
  const adopted = bridge!.adopt(update.catalogue);
  expect(owner.getSnapshot().availableSequence).toBe(2);
  expect(owner.getSnapshot().phase).toBe("bootstrap");
  expect(owner.getSnapshot().active).toBeNull();
  document.links[1]!.load(); await owner.startupReady;
  authority.publish(snapshot(2, [1, 2]));
  expect(owner.canRender(authority.descriptor("app/page.tsx", 2))).toBeFalse();
  document.links[0]!.load(); await adopted; await tick();
  expect(owner.canRender(authority.descriptor("app/page.tsx", 2))).toBeTrue();
  await expect(bridge!.updateReady(update)).rejects.toThrow("active native CSS");
  owner.subscribeDocument(() => {}); commit(0, 2); commit(1, 2); document.loaded();
  await owner.hydrationReady;
  await bridge!.updateReady(update);
  expect(owner.getSnapshot().phase).toBe("ready");
  owner.close();
});

test("the browser factory rejects changed authority before allocating any candidate link", async () => {
  for (const drift of ["snapshot", "session", "source"] as const) {
    const { document, owner, bridge, bootstrap } = fixture(true);
    await bootstrap();
    const input = catalogue([snapshot(1), snapshot(2, [1, 2])]);
    if (drift === "snapshot") input.snapshots[0] = { ...snapshot(1), stylesheetSha256: hash(999) };
    else if (drift === "session") input.session = "f".repeat(32);
    else input.consumers.pop();
    expect(() => bridge!.adopt(input)).toThrow();
    expect(owner.getSnapshot().phase).toBe("restart-required");
    expect(document.links).toHaveLength(1);
    expect(document.links[0]!.media).toBe("all");
    owner.close();
  }
});

test("repeated catalogue delivery reuses ownership while a historical selected revision cannot roll it back", async () => {
  const { document, owner, bridge, bootstrap } = fixture(true);
  await bootstrap();
  await bridge!.adopt(catalogue());
  expect(document.links).toHaveLength(1);
  const update = catalogue([snapshot(1), snapshot(2, [1, 2])]);
  const pending = bridge!.adopt(update);
  const repeated = bridge!.adopt(update);
  expect(document.links).toHaveLength(2);
  document.links[0]!.load(); await pending; await repeated;
  expect(() => bridge!.adopt(catalogue())).toThrow("backwards");
  expect(owner.getSnapshot().phase).toBe("restart-required");
  owner.close();
});

test("a newer native union loading first cannot reject bootstrap, but never substitutes for the initial trusted load", async () => {
  const { document, owner, bridge, commit } = fixture(true);
  let started = false;
  void owner.startupReady.then(() => { started = true; });
  const initialLink = document.links[0]!;
  const changed = bridge!.adopt(catalogue([snapshot(1), snapshot(2, [1, 2])]));
  const newerLink = document.links[0]!;
  newerLink.load(); await changed; await tick();
  expect(owner.getSnapshot().active?.sequence).toBe(2);
  expect(newerLink.media).toBe("all");
  expect(started).toBeFalse();
  expect(initialLink.sheet).toBeNull();
  initialLink.load(); await owner.startupReady;
  expect(started).toBeTrue();
  expect(owner.getSnapshot().phase).toBe("bootstrap");
  expect(owner.inspect().ledger.requiredRevisions).toEqual([hash(1)]);
  owner.subscribeDocument(() => {}); commit(0, 1); commit(1, 1); document.loaded();
  await owner.hydrationReady;
  expect(owner.getSnapshot().phase).toBe("ready");
  expect(document.links).toContain(initialLink);
  owner.close();
});
