import { expect, test } from "bun:test";
import { createNextDevNativeStylesheets, nextDevStylesheetIdentity } from "./next-dev-native-css.js";

// Deterministic DOM doubles test ownership logic only. They are not native
// stylesheet, browser event, Next HMR or emitted-bridge acceptance evidence.
class LinkDouble {
  readonly attributes = new Map<string, string>();
  readonly listeners = new Map<string, Set<(event: Event) => void>>();
  rel = "";
  type = "";
  media = "";
  crossOrigin = "";
  disabled = false;
  parentNode: DocumentDouble["head"] | null = null;
  sheet: { href: string; ownerNode: LinkDouble } | null = null;
  constructor(readonly ownerDocument: DocumentDouble) {}
  get isConnected(): boolean { return this.parentNode === this.ownerDocument.head; }
  get href(): string { return new URL(this.attributes.get("href") ?? "", this.ownerDocument.location).href; }
  compareDocumentPosition(other: LinkDouble): number {
    return this.ownerDocument.links.indexOf(this) < this.ownerDocument.links.indexOf(other) ? 4 : 2;
  }
  getAttribute(name: string): string | null { return this.attributes.get(name) ?? null; }
  setAttribute(name: string, value: string): void { this.attributes.set(name, value); }
  addEventListener(name: string, callback: (event: Event) => void): void {
    const listeners = this.listeners.get(name) ?? new Set();
    listeners.add(callback);
    this.listeners.set(name, listeners);
  }
  removeEventListener(name: string, callback: (event: Event) => void): void { this.listeners.get(name)?.delete(callback); }
  emit(name: string, trusted = true, target: unknown = this): void {
    for (const callback of this.listeners.get(name) ?? []) callback({ isTrusted: trusted, target } as Event);
  }
  load(): void { this.sheet = { href: this.href, ownerNode: this }; this.emit("load"); }
  listenerCount(): number { return [...this.listeners.values()].reduce((sum, callbacks) => sum + callbacks.size, 0); }
}

class DocumentDouble {
  readonly location = new URL("http://127.0.0.1:43210/");
  readonly links: LinkDouble[] = [];
  readonly head = {
    appendChild: (link: LinkDouble) => { link.parentNode = this.head; this.links.push(link); return link; },
    insertBefore: (link: LinkDouble, before: LinkDouble) => {
      const previous = this.links.indexOf(link);
      if (previous >= 0) this.links.splice(previous, 1);
      const index = this.links.indexOf(before);
      if (index < 0) throw new Error("not owned");
      this.links.splice(index, 0, link);
      link.parentNode = this.head;
      return link;
    },
    removeChild: (link: LinkDouble) => {
      const index = this.links.indexOf(link);
      if (index < 0 || link.parentNode !== this.head) throw new Error("not owned");
      this.links.splice(index, 1);
      link.parentNode = null;
      return link;
    },
  };
  createElement(tag: string): LinkDouble {
    if (tag !== "link") throw new Error("Only native stylesheet links are permitted");
    return new LinkDouble(this);
  }
}

function fixture(limit = 32) {
  const document = new DocumentDouble();
  const timers = new Map<number, () => void>();
  const durations: number[] = [];
  let nextTimer = 0;
  const owner = createNextDevNativeStylesheets(document as unknown as Document, { limit, timeoutMs: 1234, clock: {
    clear(handle) { timers.delete(handle as number); },
    set(callback, milliseconds) { durations.push(milliseconds); const handle = ++nextTimer; timers.set(handle, callback); return handle; },
  } });
  return { document, owner, timers, durations };
}
const hash = (value: number): string => value.toString(16).padStart(64, "0");
const rejection = (pending: Promise<void>): Promise<unknown> => pending.then(
  () => { throw new Error("Expected the native acquisition to fail"); },
  (error: unknown) => error,
);

test("hash-derived native URL and SRI match the same exact bytes without an arbitrary URL seam", () => {
  for (const value of [hash(0), hash(1), "f".repeat(64), "0123456789abcdef".repeat(4)]) {
    expect(nextDevStylesheetIdentity(value)).toEqual({ href: `/_next/static/css/hraness-stylex/${value}.css`,
      integrity: `sha256-${Buffer.from(value, "hex").toString("base64")}`, sha256: value });
  }
  for (const value of [null, hash(1).toUpperCase().replace("1", "A"), "../sheet.css", "https://example.com", "f".repeat(63)]) {
    expect(() => nextDevStylesheetIdentity(value)).toThrow("canonical SHA-256");
  }
});

test("startup and new acquisitions wait for their own real load boundary, not Next promise completion", async () => {
  const { document, owner, timers, durations } = fixture();
  const pending = owner.acquire(hash(1));
  let settled = false;
  void pending.then(() => { settled = true; });
  const link = document.links[0]!;
  expect(link.getAttribute("integrity")).toBe(nextDevStylesheetIdentity(hash(1)).integrity);
  expect(link.rel).toBe("stylesheet");
  expect(link.media).toBe("not all");
  expect(() => owner.activate(hash(1))).toThrow("pending");
  expect(link.crossOrigin).toBe("anonymous");
  expect(durations).toEqual([1234]);
  await Promise.resolve(); // Models immediate _N_E_STYLE_LOAD completion only.
  expect(settled).toBeFalse();
  expect(owner.loaded(hash(1))).toBeFalse();
  link.sheet = { href: link.href, ownerNode: link };
  link.emit("load", false);
  link.emit("load", true, {});
  await Promise.resolve();
  expect(settled).toBeFalse();
  link.emit("load");
  await pending;
  expect(owner.loaded(hash(1))).toBeTrue();
  expect(link.media).toBe("not all");
  owner.activate(hash(1));
  expect(link.media).toBe("all");
  expect(timers.size).toBe(0);
  expect(link.listenerCount()).toBe(0);
  const second = owner.acquire(hash(2));
  expect(owner.loaded(hash(2))).toBeFalse();
  expect(document.links).toContain(link);
  document.links[0]!.load();
  await second;
  expect(document.links).toHaveLength(2);
  expect(document.links[0]!.media).toBe("not all");
  owner.activate(hash(2));
  expect(document.links[0]!.getAttribute("href")).toBe(nextDevStylesheetIdentity(hash(2)).href);
  // Loading a replacement does not remove an old stylesheet.
  owner.retire(hash(1));
  expect(document.links).toHaveLength(1);
  expect(document.links[0]!.getAttribute("href")).toBe(nextDevStylesheetIdentity(hash(2)).href);
});

test("out-of-order loads remain bound to each exact candidate", async () => {
  const { document, owner } = fixture();
  const first = owner.acquire(hash(1));
  const firstLink = document.links[0]!;
  const second = owner.acquire(hash(2));
  expect(owner.acquire(hash(1))).toBe(first);
  document.links[0]!.load();
  await second;
  expect(owner.loaded(hash(1))).toBeFalse();
  expect(owner.loaded(hash(2))).toBeTrue();
  expect(() => owner.retire(hash(1))).toThrow("pending");
  firstLink.load();
  await first;
  expect(owner.loaded(hash(1))).toBeTrue();
});

test("errors and deadlines remove only the failed candidate and preserve loaded old CSS", async () => {
  for (const failure of ["error", "deadline"] as const) {
    const { document, owner, timers } = fixture();
    const initial = owner.acquire(hash(1));
    const old = document.links[0]!;
    old.load();
    await initial;
    owner.activate(hash(1));
    const next = owner.acquire(hash(2));
    const rejected = rejection(next);
    const candidate = document.links[0]!;
    if (failure === "error") candidate.emit("error");
    else [...timers.values()][0]!();
    expect(await rejected).toBeInstanceOf(Error);
    expect((await rejected as Error).message).toMatch(/failed to load|deadline exceeded/u);
    candidate.load(); // A late event cannot change the terminal failure.
    expect(document.links).toEqual([old]);
    expect(owner.loaded(hash(1))).toBeTrue();
    expect(owner.loaded(hash(2))).toBeFalse();
    expect(timers.size).toBe(0);
    expect(candidate.listenerCount()).toBe(0);
    expect(owner.inspect()).toEqual({ stopped: false, loaded: 1, active: 1, pending: 0, failed: 1 });
  }
});

test("a load event without its exact native sheet cannot acknowledge readiness", async () => {
  for (const modify of [
    (_link: LinkDouble) => {},
    (link: LinkDouble) => { link.sheet = { href: `${link.href}?wrong=1`, ownerNode: link }; },
    (link: LinkDouble) => { link.sheet = { href: link.href, ownerNode: new LinkDouble(link.ownerDocument) }; },
  ]) {
    const { document, owner } = fixture();
    const pending = owner.acquire(hash(1));
    const rejected = rejection(pending);
    const link = document.links[0]!;
    modify(link);
    link.emit("load");
    expect(await rejected).toBeInstanceOf(Error);
    expect((await rejected as Error).message).toContain("exact attached CSS sheet");
    expect(owner.loaded(hash(1))).toBeFalse();
    expect(document.links).toEqual([]);
  }
});

test("ownership drift fails closed and does not remove an altered or relocated tag", async () => {
  for (const modify of [
    (link: LinkDouble) => { link.setAttribute("href", `${link.getAttribute("href")}?v=1`); },
    (link: LinkDouble) => { link.setAttribute("integrity", "sha256-wrong"); },
    (link: LinkDouble) => { link.rel = "preload"; },
    (link: LinkDouble) => { link.disabled = true; },
  ]) {
    const { document, owner, timers } = fixture();
    const pending = owner.acquire(hash(1));
    const rejected = rejection(pending);
    const link = document.links[0]!;
    modify(link);
    link.load();
    expect(await rejected).toBeInstanceOf(Error);
    expect((await rejected as Error).message).toContain("ownership changed");
    expect(document.links).toContain(link);
    expect(timers.size).toBe(0);
    expect(link.listenerCount()).toBe(0);
  }
});

test("stopping collects pending listeners and timers but leaves last-good CSS active", async () => {
  const { document, owner, timers } = fixture();
  const initial = owner.acquire(hash(1));
  const old = document.links[0]!;
  old.load();
  await initial;
  owner.activate(hash(1));
  const pending = owner.acquire(hash(2));
  const rejected = rejection(pending);
  const candidate = document.links[0]!;
  owner.stop();
  owner.stop();
  expect(await rejected).toBeInstanceOf(Error);
  expect((await rejected as Error).message).toContain("acquisition stopped");
  expect(document.links).toEqual([old]);
  expect(timers.size).toBe(0);
  expect(candidate.listenerCount()).toBe(0);
  await expect(owner.acquire(hash(3))).rejects.toThrow("stopped");
  expect(() => owner.retire(hash(1))).toThrow("stopped");
});

test("finite native asset bounds reject extra work without evicting an existing sheet", async () => {
  const { document, owner } = fixture(1);
  const initial = owner.acquire(hash(1));
  document.links[0]!.load();
  await initial;
  owner.activate(hash(1));
  await expect(owner.acquire(hash(2))).rejects.toThrow("limit requires restart");
  expect(document.links).toHaveLength(1);
  expect(owner.loaded(hash(1))).toBeTrue();
  document.links[0]!.setAttribute("integrity", "changed");
  await expect(owner.acquire(hash(1))).rejects.toThrow("ownership changed");
  expect(() => owner.retire(hash(1))).toThrow("ownership changed");
  expect(document.links).toHaveLength(1);
});

test("post-load null or replaced CSSStyleSheet identities invalidate readiness and activation", async () => {
  for (const replace of [
    (link: LinkDouble) => { link.sheet = null; },
    (link: LinkDouble) => { link.sheet = { href: link.href, ownerNode: link }; },
  ]) {
    const { document, owner } = fixture();
    const loaded = owner.acquire(hash(1));
    const link = document.links[0]!;
    link.load();
    await loaded;
    expect(owner.loaded(hash(1))).toBeTrue();
    replace(link);
    expect(owner.loaded(hash(1))).toBeFalse();
    expect(() => owner.activate(hash(1))).toThrow("ownership changed");
    await expect(owner.acquire(hash(1))).rejects.toThrow("ownership changed");
    expect(() => owner.retire(hash(1))).toThrow("ownership changed");
    expect(document.links).toContain(link);
  }
});

test("activation never reparents an accepted sheet and rejects a changed final order", async () => {
  const { document, owner } = fixture();
  const initial = owner.acquire(hash(1));
  const old = document.links[0]!;
  old.load();
  await initial;
  owner.activate(hash(1));
  const pending = owner.acquire(hash(2));
  const candidate = document.links[0]!;
  expect(document.links).toEqual([candidate, old]);
  candidate.load();
  await pending;
  const accepted = candidate.sheet;
  document.links.splice(0, 2, old, candidate);
  expect(() => owner.activate(hash(2))).toThrow("final order changed");
  expect(candidate.media).toBe("not all");
  expect(old.media).toBe("all");
  expect(candidate.sheet).toBe(accepted);
  document.links.splice(0, 2, candidate, old);
  document.head.insertBefore = () => { throw new Error("Activation must never reparent"); };
  owner.activate(hash(2));
  expect(candidate.media).toBe("all");
  expect(candidate.sheet).toBe(accepted);
  expect(owner.loaded(hash(2))).toBeTrue();
  expect(owner.loaded(hash(1))).toBeTrue();
});

test("cancelling one pending native acquisition collects its resources and invalidates late load", async () => {
  const { document, owner, timers } = fixture();
  const initial = owner.acquire(hash(1));
  const old = document.links[0]!;
  old.load();
  await initial;
  owner.activate(hash(1));
  const cancelled = owner.acquire(hash(2));
  const rejected = rejection(cancelled);
  const candidate = document.links[0]!;
  const other = owner.acquire(hash(3));
  const otherLink = document.links[0]!;
  owner.cancel(hash(2));
  expect((await rejected as Error).message).toContain("acquisition cancelled");
  expect(document.links).toEqual([otherLink, old]);
  expect(candidate.listenerCount()).toBe(0);
  expect(timers.size).toBe(1);
  candidate.load();
  expect(owner.loaded(hash(2))).toBeFalse();
  expect(() => owner.cancel(hash(1))).toThrow("settled");
  otherLink.load();
  await other;
  const retry = owner.acquire(hash(2));
  const retryLink = document.links[0]!;
  expect(retryLink).not.toBe(candidate);
  expect(owner.loaded(hash(2))).toBeFalse();
  retryLink.load();
  await retry;
  expect(owner.loaded(hash(2))).toBeTrue();
  expect(timers.size).toBe(0);
  expect(owner.loaded(hash(1))).toBeTrue();
});

test("foreign ownership is rejected before insertion or activation without moving an old sheet", async () => {
  const { document, owner, timers } = fixture();
  const first = owner.acquire(hash(1));
  const old = document.links[0]!;
  old.load(); await first; owner.activate(hash(1));
  const second = owner.acquire(hash(2));
  const candidate = document.links[0]!;
  candidate.load(); await second;
  const ownedParent = candidate.parentNode;
  candidate.parentNode = { ...document.head };
  expect(() => owner.activate(hash(2))).toThrow("ownership changed");
  expect(candidate.media).toBe("not all");
  expect(old.media).toBe("all");
  candidate.parentNode = ownedParent;
  old.setAttribute("integrity", "changed");
  await expect(owner.acquire(hash(3))).rejects.toThrow("could not be attached");
  expect(document.links).toEqual([candidate, old]);
  expect(timers.size).toBe(0);
});
