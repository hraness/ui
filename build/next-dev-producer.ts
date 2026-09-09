/** Private development producer. Compiler publication is not a browser acknowledgement. */
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { canonicalJson, sha256 } from "./compiler.js";
import { materializeNextDevNativeCss } from "./next-dev-assets.js";
import { createNextDevConsumerLedger, type NextDevConsumerSource, type NextDevConsumerTarget } from "./next-dev-consumers.js";
import { assertNextDevRuntime, nextDevLogicalPath, type NextDevSnapshot } from "./next-dev-session.js";
import { parseNextDevWebpackCatalogue, type NextDevWebpackCatalogue } from "./next-dev-webpack-bridge.js";

declare const candidateBrand: unique symbol;
export type NextDevProducerCandidate = Readonly<{ [candidateBrand]: true }>;
type NativeAsset = Awaited<ReturnType<typeof materializeNextDevNativeCss>>;
type Candidate = {
  asset: NativeAsset;
  catalogue: NextDevWebpackCatalogue;
  handle: NextDevProducerCandidate;
  identity: string;
  phase: "prepared" | "published" | "failed";
};
const MAX_SNAPSHOTS = 32;
const MAX_RESIDENT_CSS_BYTES = 32 * 1024 * 1024;

/** The descriptor authority includes the exact transformed source census. */
function identity(snapshot: NextDevSnapshot): string {
  assert.ok(Object.isFrozen(snapshot) && Object.isFrozen(snapshot.sources) && Object.isFrozen(snapshot.stylesheets),
    "Next development producer requires an immutable captured snapshot");
  return canonicalJson({
    cssEntry: nextDevLogicalPath(snapshot.rootDirectory, snapshot.cssEntry),
    cssSha256: sha256(snapshot.css),
    foundations: snapshot.foundations,
    includedRevisions: snapshot.includedRevisions,
    manifestsSha256: sha256(canonicalJson(snapshot.manifests)),
    packageInputs: snapshot.packageInputs,
    revision: snapshot.revision,
    rootDirectory: snapshot.rootDirectory,
    rulesSha256: sha256(canonicalJson(snapshot.rules)),
    sources: snapshot.sources.map(({ code, logicalPath, map, sourceSha256 }) => ({
      codeSha256: sha256(code), logicalPath, mapSha256: sha256(canonicalJson(map)), sourceSha256,
    })),
    stylesheets: snapshot.stylesheets.map(({ path, sha256: digest, source }) => {
      assert.equal(sha256(source), digest, "Next development producer captured CSS differs from its digest");
      return { path, sha256: digest };
    }),
  });
}

/**
 * One owner spans Next's serial client/Node/Edge compilers. Only successful
 * client emission publishes authority for subsequent server compilation.
 * Prepared runtime bytes can describe their own candidate, but a failed
 * compilation cannot add it to the next catalogue. Historical assets stay
 * resident for older live responses/documents; reaching the finite session
 * bound requires restart, never a guessed browser- or RSC-retirement signal.
 */
export function createNextDevNativeProducer(options: Readonly<{ consumers: readonly NextDevConsumerSource[] }>) {
  assertNextDevRuntime();
  const session = randomBytes(16).toString("hex");
  // Use the wire/ledger parser to capture the finite registry, without exposing
  // any caller-supplied session or sequence assignment API.
  const registry = createNextDevConsumerLedger({ consumers: options.consumers, session });
  registry.close();
  const consumers = Object.freeze(options.consumers.map(({ source, target }) => Object.freeze({ source, target }))
    .sort((left, right) => left.source < right.source ? -1 : left.source > right.source ? 1 : 0));
  const handles = new WeakMap<NextDevProducerCandidate, Candidate>();
  const published = new Map<string, Candidate>();
  const history: Candidate[] = [];
  const publishedAssets = new Map<string, NativeAsset>();
  let active: Candidate | null = null;
  let pending: Readonly<{ identity: string; promise: Promise<NextDevProducerCandidate> }> | null = null;
  let highestSequence = 0;
  let residentBytes = 0;

  const captured = (handle: NextDevProducerCandidate): Candidate => {
    const value = handles.get(handle);
    assert.ok(value !== undefined && value.phase !== "failed", "Next development producer candidate is unknown or failed");
    return value;
  };
  const prepare = async (snapshot: NextDevSnapshot, key: string): Promise<NextDevProducerCandidate> => {
    assert.ok(history.length < MAX_SNAPSHOTS, "Next development producer snapshot limit requires restart");
    for (const consumer of consumers) {
      assert.equal(snapshot.sources.filter(({ logicalPath }) => logicalPath === consumer.source).length, 1,
        "Next development registered consumer is absent from the captured source census");
    }
    const asset = await materializeNextDevNativeCss({ entryPath: nextDevLogicalPath(snapshot.rootDirectory, snapshot.cssEntry),
      manifests: snapshot.manifests, source: snapshot.css, stylesheets: snapshot.stylesheets });
    assert.equal(identity(snapshot), key, "Next development source snapshot changed during native materialization");
    const existingAsset = publishedAssets.get(asset.sha256);
    assert.ok(existingAsset === undefined || existingAsset.css === asset.css, "Next development native asset digest collision");
    const addedBytes = existingAsset === undefined ? Buffer.byteLength(asset.css) : 0;
    assert.ok(residentBytes + addedBytes <= MAX_RESIDENT_CSS_BYTES, "Next development producer CSS residency limit requires restart");
    const sequence = highestSequence + 1;
    assert.ok(Number.isSafeInteger(sequence), "Next development producer sequence exhausted; restart next dev");
    const catalogue = parseNextDevWebpackCatalogue({ consumers, currentSequence: sequence, session,
      snapshots: history.map(({ catalogue }) => catalogue.snapshots.at(-1)!).concat([{
        includedRevisions: snapshot.includedRevisions, revision: snapshot.revision, sequence, stylesheetSha256: asset.sha256,
      }]),
    });
    highestSequence = sequence;
    const handle = Object.freeze({}) as NextDevProducerCandidate;
    active = { asset, catalogue, handle, identity: key, phase: "prepared" };
    handles.set(handle, active);
    return handle;
  };

  return Object.freeze({
    prepare(snapshot: NextDevSnapshot): Promise<NextDevProducerCandidate> {
      const key = identity(snapshot);
      if (pending !== null) {
        assert.equal(key, pending.identity, "Next development producer already has another materialization in flight");
        return pending.promise;
      }
      if (active !== null) {
        assert.equal(key, active.identity, "Next development producer already has an uncompleted client candidate");
        return Promise.resolve(active.handle);
      }
      const existing = history.at(-1);
      if (existing?.identity === key) return Promise.resolve(existing.handle);
      const promise = prepare(snapshot, key);
      pending = { identity: key, promise };
      // Consume both settlement branches. A failed native preparation must not
      // poison the next compilation or create an unhandled finally rejection.
      void promise.then(() => { pending = null; }, () => { pending = null; });
      return promise;
    },
    /** The adapter emits ALL returned immutable assets using public Webpack APIs. */
    compilation(handle: NextDevProducerCandidate): Readonly<{ assets: readonly NativeAsset[]; catalogue: NextDevWebpackCatalogue }> {
      const candidate = captured(handle);
      const assets = new Map(publishedAssets);
      assets.set(candidate.asset.sha256, candidate.asset);
      return Object.freeze({ assets: Object.freeze([...assets.values()].sort((left, right) => left.path < right.path ? -1 : 1)),
        catalogue: candidate.catalogue });
    },
    descriptor(handle: NextDevProducerCandidate, source: string, target: NextDevConsumerTarget) {
      const candidate = captured(handle);
      assert.ok(consumers.some((consumer) => consumer.source === source && consumer.target === target),
        "Next development producer descriptor does not match its registered source and target");
      const ledger = createNextDevConsumerLedger({ consumers, session });
      for (const snapshot of candidate.catalogue.snapshots) ledger.publish(snapshot);
      const result = ledger.descriptor(source, candidate.catalogue.currentSequence);
      ledger.close();
      return result;
    },
    /** Called only after the actual client compilation's terminal emission result. */
    complete(handle: NextDevProducerCandidate, succeeded: boolean, emitted: readonly Readonly<{ path: string; css: string }>[] = []): void {
      const candidate = captured(handle);
      assert.equal(typeof succeeded, "boolean", "Next development emission result must be a boolean");
      assert.ok(Array.isArray(emitted) && emitted.length <= MAX_SNAPSHOTS, "Next development emitted asset census exceeds its finite bound");
      if (succeeded) {
        const expected = new Map(publishedAssets);
        expected.set(candidate.asset.sha256, candidate.asset);
        assert.deepEqual([...emitted].sort((left, right) => left.path < right.path ? -1 : 1),
          [...expected.values()].map(({ path, css }) => ({ path, css })).sort((left, right) => left.path < right.path ? -1 : 1),
          "Next development terminal emitted CSS differs from its complete captured asset census");
      } else assert.equal(emitted.length, 0, "Next development failed emission cannot supply a successful asset census");
      // A native cached rebuild may re-emit an already-published snapshot. It
      // cannot retract that authority, including if the rebuild later fails.
      if (candidate.phase === "published") return;
      assert.equal(candidate, active, "Next development completion is not the active client candidate");
      active = null;
      if (!succeeded) { candidate.phase = "failed"; return; }
      candidate.phase = "published";
      published.set(candidate.identity, candidate);
      history.push(candidate);
      if (!publishedAssets.has(candidate.asset.sha256)) {
        publishedAssets.set(candidate.asset.sha256, candidate.asset);
        residentBytes += Buffer.byteLength(candidate.asset.css);
      }
    },
    /** Node/Edge compilation cannot independently publish or select new CSS. */
    published(snapshot: NextDevSnapshot): NextDevProducerCandidate {
      const candidate = published.get(identity(snapshot));
      assert.ok(candidate !== undefined, "Next development server snapshot has no exact published native CSS authority");
      return candidate.handle;
    },
    inspect: () => Object.freeze({ active: active !== null, materializing: pending !== null,
      published: history.length, residentAssets: publishedAssets.size, residentBytes, highestSequence }),
  });
}
