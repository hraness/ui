/** Private dev-only native <link> ownership. No CSS text, CSSOM writes or Next globals. */

const HASH = /^[a-f0-9]{64}$/u;
const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

export function nextDevStylesheetIdentity(value: unknown): Readonly<{ href: string; integrity: string; sha256: string }> {
  if (typeof value !== "string" || !HASH.test(value)) throw new Error("Next development stylesheet requires a canonical SHA-256");
  const bytes = Array.from({ length: 32 }, (_, index) => Number.parseInt(value.slice(index * 2, index * 2 + 2), 16));
  let encoded = "";
  for (let index = 0; index < bytes.length; index += 3) {
    const remaining = bytes.length - index;
    const word = (bytes[index]! << 16) | ((bytes[index + 1] ?? 0) << 8) | (bytes[index + 2] ?? 0);
    encoded += ALPHABET[(word >>> 18) & 63]! + ALPHABET[(word >>> 12) & 63]!
      + (remaining > 1 ? ALPHABET[(word >>> 6) & 63]! : "=") + (remaining > 2 ? ALPHABET[word & 63]! : "=");
  }
  return Object.freeze({ href: `/_next/static/css/hraness-stylex/${value}.css`, integrity: `sha256-${encoded}`, sha256: value });
}

type Clock = Readonly<{ clear(handle: unknown): void; set(callback: () => void, milliseconds: number): unknown }>;
type Entry = {
  active: boolean;
  acceptedSheet: CSSStyleSheet | null;
  identity: ReturnType<typeof nextDevStylesheetIdentity>;
  link: HTMLLinkElement;
  promise: Promise<void>;
  reject(error: Error): void;
  resolve(): void;
  state: "pending" | "loaded" | "failed";
  stopWatching(): void;
};

/**
 * A fulfilled acquisition means an actual trusted load event on this exact
 * attached, inactive native stylesheet, including browser SRI validation. It is not a
 * React-commit acknowledgement and never makes an old asset removable.
 */
export function createNextDevNativeStylesheets(document: Document, options: Readonly<{
  clock?: Clock;
  limit?: number;
  timeoutMs?: number;
}> = {}) {
  const limit = options.limit ?? 32;
  const timeoutMs = options.timeoutMs ?? 15_000;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 32) throw new Error("Next development native stylesheet limit is unsupported");
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 30_000) throw new Error("Next development native stylesheet deadline is unsupported");
  const clock = options.clock ?? { clear: (handle: unknown) => clearTimeout(handle as ReturnType<typeof setTimeout>), set: (callback: () => void, milliseconds: number) => setTimeout(callback, milliseconds) };
  const origin = document.location.origin;
  if (!/^https?:$/u.test(document.location.protocol)) throw new Error("Next development native stylesheets require an HTTP document");
  const entries = new Map<string, Entry>();
  let stopped = false;

  const intact = (entry: Entry): boolean => entry.link.ownerDocument === document
    && entry.link.parentNode === document.head && entry.link.isConnected
    && entry.link.getAttribute("href") === entry.identity.href
    && entry.link.href === `${origin}${entry.identity.href}`
    && entry.link.getAttribute("integrity") === entry.identity.integrity
    && entry.link.crossOrigin === "anonymous" && entry.link.rel === "stylesheet"
    && entry.link.type === "text/css" && entry.link.media === (entry.active ? "all" : "not all") && !entry.link.disabled
    && (entry.state !== "loaded" || (entry.acceptedSheet !== null && entry.link.sheet === entry.acceptedSheet
      && entry.acceptedSheet.ownerNode === entry.link && entry.acceptedSheet.href === `${origin}${entry.identity.href}`));
  const removeIntact = (entry: Entry): void => {
    if (!intact(entry)) throw new Error("Next development native stylesheet ownership changed; retain the document");
    document.head.removeChild(entry.link);
  };
  const fail = (entry: Entry, message: string): void => {
    if (entry.state !== "pending") return;
    entry.state = "failed";
    entry.stopWatching();
    // Only the failed candidate may be collected. Older loaded sheets remain.
    try { removeIntact(entry); }
    catch {
      entry.reject(new Error("Next development native stylesheet ownership changed; retain the document"));
      return;
    }
    entry.reject(new Error(message));
  };

  return Object.freeze({
    acquire(value: unknown): Promise<void> {
      if (stopped) return Promise.reject(new Error("Next development native stylesheet owner is stopped"));
      const identity = nextDevStylesheetIdentity(value);
      const existing = entries.get(identity.sha256);
      if (existing !== undefined) {
        if (existing.state === "loaded" && !intact(existing)) return Promise.reject(new Error("Next development native stylesheet ownership changed; retain the document"));
        return existing.promise;
      }
      if (entries.size >= limit) return Promise.reject(new Error("Next development native stylesheet limit requires restart"));
      const link = document.createElement("link");
      link.rel = "stylesheet";
      link.type = "text/css";
      // Availability is not activation. A pruned candidate must not change the
      // cascade while an older consumer still needs the transition union.
      link.media = "not all";
      link.crossOrigin = "anonymous";
      link.setAttribute("integrity", identity.integrity);
      link.setAttribute("href", identity.href);
      let resolve!: () => void;
      let reject!: (error: Error) => void;
      const promise = new Promise<void>((success, failure) => { resolve = success; reject = failure; });
      let timer: unknown;
      const entry: Entry = { active: false, acceptedSheet: null, identity, link, promise, resolve, reject, state: "pending", stopWatching() {
        link.removeEventListener("load", loaded);
        link.removeEventListener("error", errored);
        clock.clear(timer);
      } };
      const loaded = (event: Event): void => {
        if (!event.isTrusted || event.target !== link || entry.state !== "pending") return;
        if (!intact(entry) || link.sheet === null || link.sheet.ownerNode !== link || link.sheet.href !== `${origin}${identity.href}`) {
          fail(entry, "Next development stylesheet load did not produce its exact attached CSS sheet");
          return;
        }
        entry.acceptedSheet = link.sheet;
        entry.state = "loaded";
        entry.stopWatching();
        entry.resolve();
      };
      const errored = (event: Event): void => {
        if (!event.isTrusted || event.target !== link) return;
        fail(entry, "Next development native stylesheet failed to load; restart required");
      };
      link.addEventListener("load", loaded);
      link.addEventListener("error", errored);
      timer = clock.set(() => fail(entry, "Next development native stylesheet load deadline exceeded; restart required"), timeoutMs);
      // Always make an owned acquisition, including startup. An existing React
      // tag, a resolved _N_E_STYLE_LOAD promise, or sheet presence alone is not
      // promoted into a trusted load event for this owner.
      try {
        const attached = [...entries.values()].filter((candidate) => candidate.state !== "failed");
        for (const candidate of attached) if (!intact(candidate)) throw new Error("existing native stylesheet ownership changed");
        const first = attached.map(({ link }) => link).sort((left, right) => left.compareDocumentPosition(right) & 4 ? -1 : 1)[0];
        // Establish final cascade order BEFORE native loading. Reparenting an
        // already accepted link can asynchronously reset its CSS resource.
        if (first === undefined) document.head.appendChild(link);
        else document.head.insertBefore(link, first);
      }
      catch {
        entry.state = "failed";
        entry.stopWatching();
        entry.reject(new Error("Next development native stylesheet could not be attached"));
      }
      entries.set(identity.sha256, entry);
      return promise;
    },
    loaded(value: unknown): boolean {
      const entry = entries.get(nextDevStylesheetIdentity(value).sha256);
      return !stopped && entry?.state === "loaded" && intact(entry);
    },
    /** Caller must first prove that this union covers every live/pending revision. */
    activate(value: unknown): void {
      if (stopped) throw new Error("Next development native stylesheet owner is stopped");
      const entry = entries.get(nextDevStylesheetIdentity(value).sha256);
      if (entry === undefined || entry.state !== "loaded") throw new Error("Next development cannot activate an unknown or pending native stylesheet");
      if (!intact(entry)) throw new Error("Next development native stylesheet ownership changed; retain the document");
      if (entry.active) return;
      const older = [...entries.values()].filter((candidate) => candidate.active);
      for (const candidate of older) if (!intact(candidate)) throw new Error("Next development native stylesheet ownership changed; retain the document");
      // The complete new layer prelude must already precede older unions. A
      // reordered or foreign tag cannot be repaired by moving a loaded link.
      if (older.some((candidate) => (entry.link.compareDocumentPosition(candidate.link) & 4) === 0)) {
        throw new Error("Next development native stylesheet final order changed; retain the document");
      }
      entry.link.media = "all";
      entry.active = true;
    },
    /** Caller must supply independent consumer-retirement authority. */
    retire(value: unknown): void {
      if (stopped) throw new Error("Next development native stylesheet owner is stopped");
      const identity = nextDevStylesheetIdentity(value);
      const entry = entries.get(identity.sha256);
      if (entry === undefined || entry.state !== "loaded") throw new Error("Next development cannot retire an unknown or pending native stylesheet");
      if (!intact(entry)) throw new Error("Next development native stylesheet ownership changed; retain the document");
      if (entry.active && [...entries.values()].filter((candidate) => candidate.active).length === 1) throw new Error("Next development cannot retire its last active stylesheet");
      removeIntact(entry);
      entries.delete(identity.sha256);
    },
    /** Cancel one unready candidate without affecting any other acquisition. */
    cancel(value: unknown): void {
      if (stopped) throw new Error("Next development native stylesheet owner is stopped");
      const identity = nextDevStylesheetIdentity(value);
      const entry = entries.get(identity.sha256);
      if (entry === undefined || entry.state !== "pending") throw new Error("Next development cannot cancel an unknown or settled native stylesheet");
      fail(entry, "Next development native stylesheet acquisition cancelled");
      if (entry.link.parentNode !== null) throw new Error("Next development native stylesheet cancellation could not collect its owned tag");
      entries.delete(identity.sha256);
    },
    /** Stop pending work without removing any loaded last-good stylesheet. */
    stop(): void {
      if (stopped) return;
      stopped = true;
      let changed = false;
      for (const entry of entries.values()) {
        if (entry.state === "pending") fail(entry, "Next development native stylesheet acquisition stopped");
        else if (entry.state === "loaded" && !entry.active) {
          try { removeIntact(entry); entry.state = "failed"; }
          catch { changed = true; }
        }
      }
      if (changed) throw new Error("Next development native stylesheet ownership changed; retain the document");
    },
    inspect() {
      return Object.freeze({ stopped, loaded: [...entries.values()].filter(({ state }) => state === "loaded").length,
        active: [...entries.values()].filter((entry) => entry.state === "loaded" && entry.active).length,
        pending: [...entries.values()].filter(({ state }) => state === "pending").length,
        failed: [...entries.values()].filter(({ state }) => state === "failed").length });
    },
  });
}
