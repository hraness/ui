/** Private emitted Webpack development bridge. Not a native acceptance receipt. */
import {
  createNextDevConsumerLedger,
  type NextDevConsumerSnapshot,
  type NextDevConsumerSource,
} from "./next-dev-consumers.js";

export const NEXT_DEV_WEBPACK_BRIDGE_PROPERTY = "__hranessStylexNextDev";
export const NEXT_DEV_WEBPACK_MANIFEST_PROPERTY = "hranessStylexNextDev";

export type NextDevWebpackCatalogue = Readonly<{
  consumers: readonly NextDevConsumerSource[];
  currentSequence: number;
  session: string;
  snapshots: readonly NextDevConsumerSnapshot[];
}>;
export type NextDevWebpackUpdateMetadata = Readonly<{
  catalogue: NextDevWebpackCatalogue;
  fromHash: string;
  kind: "hraness-stylex-next-dev-hot-update";
  schemaVersion: 1;
  session: string;
  toHash: string;
}>;
export type NextDevWebpackNativeManifest = Readonly<{
  c: readonly (string | number)[];
  r: readonly (string | number)[];
  m: readonly (string | number)[];
}>;

/** Supplied by the bundled browser owner, before any entry module can execute. */
export interface NextDevWebpackBridgeOwner {
  /** Must parse the catalogue with parseNextDevWebpackCatalogue before adoption. */
  adopt(catalogue: NextDevWebpackCatalogue): Promise<void>;
  readonly startupReady: Promise<void>;
  readonly hydrationReady: Promise<void>;
  updateReady(metadata: NextDevWebpackUpdateMetadata): Promise<void>;
  /** Collect pending native work, retaining the document's last accepted CSS. */
  restartRequired(reason: string): void;
}

/**
 * Self-contained wire reader, also embedded verbatim into the Webpack runtime.
 * It copies only finite enumerable data properties. Catalogue authority remains
 * the consumer ledger; the bootstrap owner runs its parser before adopting.
 */
function readWire(value: unknown, mode: "catalogue" | "metadata" | "native" | "annotated"): unknown {
  function requireValue(condition: unknown, message: string): asserts condition {
    if (!condition) throw new Error(`Next development Webpack bridge: ${message}`);
  }
  function record(input: unknown, keys: readonly string[]): Record<string, unknown> {
    requireValue(typeof input === "object" && input !== null && !Array.isArray(input), "expected an object");
    requireValue(Object.getPrototypeOf(input) === Object.prototype || Object.getPrototypeOf(input) === null, "object must be plain");
    requireValue(Reflect.ownKeys(input).length === keys.length, "unknown or missing object keys");
    const properties = Object.getOwnPropertyDescriptors(input);
    const output: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
    for (const key of keys) {
      const property = properties[key];
      requireValue(property?.enumerable === true && Object.hasOwn(property, "value"), "expected enumerable data properties");
      output[key] = property.value;
    }
    return output;
  }
  function array(input: unknown, limit: number): readonly unknown[] {
    requireValue(Array.isArray(input) && Object.getPrototypeOf(input) === Array.prototype && input.length <= limit, "array exceeds its finite bound or has a foreign prototype");
    requireValue(Reflect.ownKeys(input).length === input.length + 1, "array has extra properties");
    return Object.freeze(Array.from({ length: input.length }, (_, index) => {
      const property = Object.getOwnPropertyDescriptor(input, String(index));
      requireValue(property?.enumerable === true && Object.hasOwn(property, "value"), "array must be dense data properties");
      return property.value as unknown;
    }));
  }
  function hex(input: unknown, length: number): string {
    requireValue(typeof input === "string" && input.length === length && /^[a-f0-9]+$/u.test(input), "hash or session is not canonical");
    return input;
  }
  function positive(input: unknown): number {
    requireValue(typeof input === "number" && Number.isSafeInteger(input) && input > 0, "sequence is not a positive safe integer");
    return input;
  }
  function catalogue(input: unknown): NextDevWebpackCatalogue {
    const item = record(input, ["consumers", "currentSequence", "session", "snapshots"]);
    const session = hex(item.session, 32);
    const currentSequence = positive(item.currentSequence);
    const consumers = array(item.consumers, 64).map((entry) => {
      const consumer = record(entry, ["source", "target"]);
      requireValue(typeof consumer.source === "string" && /^app\/(?:[a-zA-Z0-9_-]+\/)*[a-zA-Z0-9_-]+\.tsx$/u.test(consumer.source), "consumer source is unsupported");
      requireValue(consumer.target === "client" || consumer.target === "server" || consumer.target === "edge-server", "consumer target is unsupported");
      requireValue(consumer.target === "client" || consumer.source.endsWith("/page.tsx"), "server consumer must be a page");
      return Object.freeze({ source: consumer.source, target: consumer.target });
    });
    requireValue(consumers.length > 0 && consumers.every((entry, index) => index === 0 || consumers[index - 1]!.source < entry.source), "consumer census must be nonempty, sorted and unique");
    const snapshots = array(item.snapshots, 32).map((entry) => {
      const snapshot = record(entry, ["includedRevisions", "revision", "sequence", "stylesheetSha256"]);
      const revision = hex(snapshot.revision, 64);
      const includedRevisions = array(snapshot.includedRevisions, 32).map((included) => hex(included, 64));
      requireValue(includedRevisions.includes(revision) && includedRevisions.every((included, index) => index === 0 || includedRevisions[index - 1]! < included), "revision coverage must contain its source and be sorted and unique");
      return Object.freeze({ includedRevisions: Object.freeze(includedRevisions), revision,
        sequence: positive(snapshot.sequence), stylesheetSha256: hex(snapshot.stylesheetSha256, 64) });
    });
    requireValue(snapshots.some((snapshot) => snapshot.sequence === currentSequence)
      && snapshots.every((snapshot, index) => index === 0 || snapshots[index - 1]!.sequence < snapshot.sequence), "snapshot census must include the selected sequence and be sorted and unique");
    return Object.freeze({ consumers: Object.freeze(consumers), currentSequence, session, snapshots: Object.freeze(snapshots) });
  }
  function metadata(input: unknown): NextDevWebpackUpdateMetadata {
    const item = record(input, ["catalogue", "fromHash", "kind", "schemaVersion", "session", "toHash"]);
    requireValue(item.kind === "hraness-stylex-next-dev-hot-update" && item.schemaVersion === 1, "hot update kind or schema is unsupported");
    const session = hex(item.session, 32);
    const fromHash = hex(item.fromHash, 16);
    const toHash = hex(item.toHash, 16);
    requireValue(fromHash !== toHash, "native compilation hash did not advance");
    const captured = catalogue(item.catalogue);
    requireValue(captured.session === session, "catalogue session differs from the update");
    return Object.freeze({ catalogue: captured, fromHash, kind: "hraness-stylex-next-dev-hot-update", schemaVersion: 1, session, toHash });
  }
  if (mode === "catalogue") return catalogue(value);
  if (mode === "metadata") return metadata(value);
  const native = record(value, mode === "native" ? ["c", "r", "m"] : ["c", "r", "m", "hranessStylexNextDev"]);
  function ids(input: unknown): readonly (string | number)[] {
    const values = array(input, 4096);
    requireValue(values.every((id) => (typeof id === "string" && id.length > 0 && id.length <= 1024)
      || (typeof id === "number" && Number.isSafeInteger(id) && id >= 0)), "native module or chunk identifier is unsupported");
    requireValue(new Set(values).size === values.length, "native identifiers must be unique within each array");
    return values as readonly (string | number)[];
  }
  const parsed = { c: ids(native.c), r: ids(native.r), m: ids(native.m) };
  return Object.freeze(mode === "native" ? parsed : { ...parsed, hranessStylexNextDev: metadata(native.hranessStylexNextDev) });
}

export function parseNextDevWebpackCatalogue(value: unknown): NextDevWebpackCatalogue {
  const parsed = readWire(value, "catalogue") as NextDevWebpackCatalogue;
  // Keep the browser owner and build-time parser bound to exactly the ledger's
  // semantics, including conflicting coverage for a reused stylesheet hash.
  const ledger = createNextDevConsumerLedger({ consumers: parsed.consumers, session: parsed.session });
  for (const snapshot of parsed.snapshots) ledger.publish(snapshot);
  ledger.close();
  return parsed;
}

export function parseNextDevWebpackUpdateMetadata(value: unknown): NextDevWebpackUpdateMetadata {
  const parsed = readWire(value, "metadata") as NextDevWebpackUpdateMetadata;
  return Object.freeze({ ...parsed, catalogue: parseNextDevWebpackCatalogue(parsed.catalogue) });
}

/** Input must be the actual emitted JSON asset, not a separately fetched index. */
export function annotateNextDevWebpackManifest(native: unknown, metadata: unknown): NextDevWebpackNativeManifest & Readonly<{
  hranessStylexNextDev: NextDevWebpackUpdateMetadata;
}> {
  const parsed = readWire(native, "native") as NextDevWebpackNativeManifest;
  return Object.freeze({ ...parsed, hranessStylexNextDev: parseNextDevWebpackUpdateMetadata(metadata) });
}

type RuntimeRequire = {
  h: () => string;
  hmrM?: (...args: unknown[]) => Promise<unknown>;
  __hranessStylexNextDev?: NextDevWebpackRuntime;
};
type NextDevWebpackRuntime = Readonly<{
  adoptRuntime(value: NextDevWebpackCatalogue): void;
  startup(callback: () => unknown): Promise<unknown>;
  wrapManifest(): void;
  fail(reason: string): Promise<never>;
  inspect(): Readonly<{ phase: "open" | "restart-required"; reason: string | null; startupCount: number;
    pendingManifest: boolean; terminalContinuations: number }>;
}>;

/** Self-contained emitted owner of all startup/update continuations. */
function installRuntime(webpack: RuntimeRequire, initial: NextDevWebpackCatalogue,
  createOwner: (catalogue: NextDevWebpackCatalogue) => NextDevWebpackBridgeOwner,
  read: typeof readWire): NextDevWebpackRuntime {
  const previous = webpack.__hranessStylexNextDev;
  if (previous !== undefined) {
    previous.adoptRuntime(initial);
    return previous;
  }
  let phase: "open" | "restart-required" = "open";
  let reason: string | null = null;
  // One intentionally unresolved continuation owns terminal startup/HMR work.
  // It owns no timer, retry, native listener, network operation or success path.
  const terminal = new Promise<never>(() => {});
  let owner: NextDevWebpackBridgeOwner | undefined;
  let startupCount = 0;
  let startupTail: Promise<unknown> = Promise.resolve();
  let pendingManifest: Promise<unknown> | null = null;
  let acceptedHash: string | null = null;
  const wrappers = new WeakSet<(...args: unknown[]) => Promise<unknown>>();
  const session = initial.session;
  const sources = JSON.stringify(initial.consumers);
  function fail(failure: string): Promise<never> {
    if (phase === "open") {
      phase = "restart-required";
      reason = failure;
      startupCount = 0;
      try { owner?.restartRequired(failure); } catch { /* terminal remains closed */ }
    }
    return terminal;
  }
  function catalogue(value: NextDevWebpackCatalogue): void {
    if (value.session !== session || JSON.stringify(value.consumers) !== sources) throw new Error("document session or consumer census changed");
  }
  try { owner = createOwner(initial); } catch { fail("bootstrap-owner-failed"); }
  const startupReady = Promise.resolve(owner?.startupReady).then((): Promise<never> | undefined => {
    if (owner === undefined || phase !== "open") return fail("bootstrap-owner-unavailable");
    return undefined;
  }, () => fail("startup-stylesheet-failed"));
  // Observe early hydration failure even when the first HMR check is later.
  void Promise.resolve(owner?.hydrationReady).catch(() => { fail("hydration-failed"); });
  const runtime = Object.freeze({
    /** BASIC runs again on a hot runtime update without replacing the owner. */
    adoptRuntime(value: NextDevWebpackCatalogue): void {
      if (phase !== "open") return;
      try {
        const next = read(value, "catalogue") as NextDevWebpackCatalogue;
        catalogue(next);
        void Promise.resolve(owner!.adopt(next)).catch(() => { fail("runtime-catalogue-failed"); });
      } catch { fail("runtime-catalogue-failed"); }
    },
    /** Wrap all original startup code, including its export/library assignment. */
    startup(callback: () => unknown): Promise<unknown> {
      if (phase !== "open") return terminal;
      if (++startupCount > 128) return fail("startup-queue-exceeded");
      const pending = startupTail.then(() => startupReady).then(() => {
        if (phase !== "open") return terminal;
        startupCount--;
        // Application exceptions retain their native path, not a CSS ack.
        return callback();
      });
      startupTail = pending.then(() => {}, () => {});
      return pending;
    },
    /** TRIGGER runs after JSONP installs/replaces the native hmrM function. */
    wrapManifest(): void {
      const native = webpack.hmrM;
      if (typeof native !== "function") { fail("native-manifest-loader-missing"); return; }
      if (wrappers.has(native)) return;
      const wrapped = function (this: unknown, ...args: unknown[]): Promise<unknown> {
        if (phase !== "open") return terminal;
        if (pendingManifest !== null) return pendingManifest;
        let fromHash: string;
        try { fromHash = webpack.h(); } catch { return fail("native-runtime-hash-unavailable"); }
        if (!/^[a-f0-9]{16}$/u.test(fromHash) || (acceptedHash !== null && fromHash !== acceptedHash)) return fail("native-runtime-hash-mismatch");
        const context = this;
        pendingManifest = Promise.resolve().then(() => native.apply(context, args)).then((value) => {
          // The pinned native fetcher returns undefined only for an HTTP 404.
          // Preserve that real no-update result; never synthesize one on error.
          if (value === undefined) return value;
          const parsed = read(value, "annotated") as NextDevWebpackNativeManifest & { hranessStylexNextDev: NextDevWebpackUpdateMetadata };
          const metadata = parsed.hranessStylexNextDev;
          if (metadata.session !== session || metadata.fromHash !== fromHash) throw new Error("native manifest does not match this document/update");
          catalogue(metadata.catalogue);
          // Adoption must run synchronously BEFORE waiting for hydration: an
          // early Flight descriptor may itself need this captured catalogue.
          const adopted = owner!.adopt(metadata.catalogue);
          return Promise.all([adopted, owner!.hydrationReady]).then(() => owner!.updateReady(metadata)).then(() => {
            if (phase !== "open") return terminal;
            if (webpack.h() !== fromHash) return fail("runtime-changed-before-css-ready");
            if (JSON.stringify(read(value, "annotated")) !== JSON.stringify(parsed)) return fail("native-manifest-changed-before-css-ready");
            acceptedHash = metadata.toHash;
            // Preserve the actual native object and arrays, not parsed copies.
            return value;
          });
        }).catch(() => fail("native-update-gate-failed")).then((value) => {
          pendingManifest = null;
          return value;
        });
        return pendingManifest;
      };
      wrappers.add(wrapped);
      webpack.hmrM = wrapped;
    },
    fail,
    inspect: () => Object.freeze({ phase, reason, startupCount, pendingManifest: pendingManifest !== null,
      terminalContinuations: phase === "restart-required" ? 1 : 0 }),
  });
  webpack.__hranessStylexNextDev = runtime;
  return runtime;
}

/** STAGE_BASIC (5). The supplied expression must be a self-contained bundle. */
export function renderNextDevWebpackBootstrap(catalogue: unknown, factoryExpression: string): string {
  const parsed = parseNextDevWebpackCatalogue(catalogue);
  if (factoryExpression.trim().length === 0) throw new Error("Next development bootstrap factory is empty");
  // JSON escapes avoid accidentally ending an inline script if source strings
  // become less restricted in a future schema. No runtime eval is used.
  const captured = JSON.stringify(parsed).replaceAll("<", "\\u003c");
  return `(${installRuntime.toString()})(__webpack_require__,${captured},(${factoryExpression}),(${readWire.toString()}));`;
}

/** STAGE_TRIGGER (20), after the native JSONP runtime's STAGE_ATTACH (10). */
export function renderNextDevWebpackManifestGate(): string {
  return "__webpack_require__.__hranessStylexNextDev.wrapManifest();";
}

/** Apply after AssignLibraryPlugin's renderStartup tap; pass its entire source. */
export function renderNextDevWebpackStartup(originalSource: string): string {
  if (originalSource.trim().length === 0) throw new Error("Next development entry startup is empty");
  return `__webpack_require__.__hranessStylexNextDev.startup(function () {\n${originalSource}\n});`;
}
