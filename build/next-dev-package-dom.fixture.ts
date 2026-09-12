/** Deterministic DOM double for emitted-byte protocol checks, never native evidence. */
export const NEXT_DEV_PACKAGE_DOCUMENT = String.raw`
class ElementDouble {
  attributes = new Map(); isConnected = true;
  constructor(ownerDocument, tagName = "MAIN") { this.ownerDocument = ownerDocument; this.tagName = tagName; }
  getAttribute(name) { return this.attributes.get(name) ?? null; }
  setAttribute(name, value) { this.attributes.set(name, value); }
}
class LinkDouble extends ElementDouble {
  listeners = new Map(); rel = ""; type = ""; media = ""; crossOrigin = ""; disabled = false; parentNode = null; sheet = null;
  constructor(document) { super(document, "LINK"); }
  get href() { return new URL(this.getAttribute("href") ?? "", this.ownerDocument.location).href; }
  compareDocumentPosition(other) { return this.ownerDocument.links.indexOf(this) < this.ownerDocument.links.indexOf(other) ? 4 : 2; }
  addEventListener(name, callback) {
    const listeners = this.listeners.get(name) ?? new Set(); listeners.add(callback); this.listeners.set(name, listeners);
  }
  removeEventListener(name, callback) { this.listeners.get(name)?.delete(callback); }
  load() {
    this.sheet = { href: this.href, ownerNode: this };
    for (const callback of [...this.listeners.get("load") ?? []]) callback({ isTrusted: true, target: this });
  }
}
class DocumentDouble {
  location = new URL("http://127.0.0.1:43210/"); documentElement = {}; links = []; allLinks = []; roots = [];
  listeners = new Map(); onceListeners = new Map(); windowListeners = new Map(); observers = new Set(); timers = new Map();
  nextTimer = 0; readyState = "loading";
  constructor() {
    const observers = this.observers;
    this.defaultView = {
      HTMLElement: ElementDouble,
      setTimeout: callback => { const id = ++this.nextTimer; this.timers.set(id, callback); return id; },
      clearTimeout: id => { this.timers.delete(id); },
      MutationObserver: class {
        constructor(callback) { this.callback = callback; }
        observe() { observers.add(this.callback); }
        disconnect() { observers.delete(this.callback); }
      },
      addEventListener: (name, callback) => {
        const listeners = this.windowListeners.get(name) ?? new Set(); listeners.add(callback); this.windowListeners.set(name, listeners);
      },
      removeEventListener: (name, callback) => { this.windowListeners.get(name)?.delete(callback); },
    };
  }
  head = {
    appendChild: link => { link.parentNode = this.head; this.links.push(link); return link; },
    insertBefore: (link, before) => {
      const previous = this.links.indexOf(link); if (previous >= 0) this.links.splice(previous, 1);
      this.links.splice(this.links.indexOf(before), 0, link); link.parentNode = this.head; return link;
    },
    removeChild: link => {
      if (link.parentNode !== this.head) throw new Error("foreign link");
      this.links.splice(this.links.indexOf(link), 1); link.parentNode = null; link.isConnected = false; return link;
    },
  };
  createElement(tag) {
    if (tag !== "link" || this.allLinks.length >= 32) throw new Error("unexpected element acquisition");
    const link = new LinkDouble(this); this.allLinks.push(link); return link;
  }
  querySelectorAll(selector) {
    if (selector !== "[data-hraness-stylex-consumer], [data-hraness-stylex-descriptor]") throw new Error("unexpected root selector");
    return this.roots.filter(root => root.isConnected);
  }
  addEventListener(name, callback, options) {
    const listeners = this.listeners.get(name) ?? new Set(); listeners.add(callback); this.listeners.set(name, listeners);
    if (options?.once) { const once = this.onceListeners.get(name) ?? new Set(); once.add(callback); this.onceListeners.set(name, once); }
  }
  removeEventListener(name, callback) { this.listeners.get(name)?.delete(callback); this.onceListeners.get(name)?.delete(callback); }
  loaded() {
    this.readyState = "complete";
    for (const callback of [...this.listeners.get("DOMContentLoaded") ?? []]) {
      if (this.onceListeners.get("DOMContentLoaded")?.has(callback)) this.removeEventListener("DOMContentLoaded", callback);
      callback();
    }
  }
}
globalThis.document = new DocumentDouble();
globalThis.setTimeout = document.defaultView.setTimeout;
globalThis.clearTimeout = document.defaultView.clearTimeout;
globalThis.queueMicrotask = callback => { Promise.resolve().then(callback); };
globalThis.descriptor = (consumer, catalogue) => {
  const snapshot = catalogue.snapshots.find(item => item.sequence === catalogue.currentSequence);
  return { ...snapshot, ...consumer, href: "/_next/static/css/hraness-stylex/" + snapshot.stylesheetSha256 + ".css",
    kind: "hraness-stylex-next-dev-consumer", schemaVersion: 1, session: catalogue.session };
};
for (const consumer of initialCatalogue.consumers) {
  const root = new ElementDouble(document, consumer.target === "client" ? "SECTION" : "MAIN");
  root.setAttribute("data-hraness-stylex-consumer", consumer.source);
  root.setAttribute("data-hraness-stylex-descriptor", JSON.stringify(descriptor(consumer, initialCatalogue)));
  document.roots.push(root);
}
globalThis.nativeStartup = 0;
globalThis.nativeCalls = 0;
globalThis.currentHash = "aaaaaaaaaaaaaaaa";
globalThis.__webpack_require__ = { h: () => currentHash, hmrM: function () { nativeCalls++; return Promise.resolve(nativeManifest); } };
globalThis.census = () => ({
  timers: document.timers.size, observers: document.observers.size,
  listeners: [...document.listeners.values(), ...document.windowListeners.values(), ...document.allLinks.flatMap(link => [...link.listeners.values()])]
    .reduce((sum, set) => sum + set.size, 0),
});
`;
