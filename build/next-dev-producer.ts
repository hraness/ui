/** Private development producer. Compiler publication is not a browser acknowledgement. */
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { canonicalJson, sha256 } from "./compiler.js";
import { materializeNextDevNativeCss } from "./next-dev-assets.js";
import { createNextDevConsumerLedger, type NextDevConsumerSnapshot, type NextDevConsumerSource, type NextDevConsumerTarget } from "./next-dev-consumers.js";
import { assertNextDevRuntime, composeNextDevSnapshot, nextDevLogicalPath, type NextDevRetainedCoverage, type NextDevSnapshot } from "./next-dev-session.js";
import { parseNextDevWebpackCatalogue, type NextDevWebpackCatalogue } from "./next-dev-webpack-bridge.js";

declare const candidateBrand: unique symbol;
export type NextDevProducerCandidate = Readonly<{ [candidateBrand]: true }>;
type NativeAsset = Awaited<ReturnType<typeof materializeNextDevNativeCss>>;
type Candidate = {
  assets: readonly NativeAsset[];
  catalogue: NextDevWebpackCatalogue;
  coverage: NextDevRetainedCoverage | null;
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
  let publishedSnapshots: readonly NextDevConsumerSnapshot[] = [];
  let retainedCoverage: NextDevRetainedCoverage | null = null;
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
    assert.ok(publishedSnapshots.length < MAX_SNAPSHOTS, "Next development producer snapshot limit requires restart");
    for (const consumer of consumers) {
      assert.equal(snapshot.sources.filter(({ logicalPath }) => logicalPath === consumer.source).length, 1,
        "Next development registered consumer is absent from the captured source census");
    }
    const aggregate = retainedCoverage === null ? snapshot : composeNextDevSnapshot(snapshot, [retainedCoverage]);
    const materialize = (value: NextDevSnapshot): Promise<NativeAsset> => materializeNextDevNativeCss({
      entryPath: nextDevLogicalPath(value.rootDirectory, value.cssEntry), manifests: value.manifests, source: value.css, stylesheets: value.stylesheets,
    });
    const asset = await materialize(snapshot);
    const unionAsset = aggregate.css === snapshot.css ? asset : await materialize(aggregate);
    const assets = [...new Map([unionAsset, asset].map((asset) => [asset.sha256, asset])).values()];
    assert.equal(identity(snapshot), key, "Next development source snapshot changed during native materialization");
    let addedBytes = 0;
    for (const asset of assets) {
      const existing = publishedAssets.get(asset.sha256);
      assert.ok(existing === undefined || existing.css === asset.css, "Next development native asset digest collision");
      if (existing === undefined) addedBytes += Buffer.byteLength(asset.css);
    }
    assert.ok(residentBytes + addedBytes <= MAX_RESIDENT_CSS_BYTES, "Next development producer CSS residency limit requires restart");
    let sequence = highestSequence;
    const additions: NextDevConsumerSnapshot[] = [];
    const append = (value: NextDevSnapshot, asset: NativeAsset): void => {
      assert.ok(Number.isSafeInteger(++sequence), "Next development producer sequence exhausted; restart next dev");
      additions.push({ includedRevisions: value.includedRevisions, revision: value.revision, sequence, stylesheetSha256: asset.sha256 });
    };
    // A loaded historical union must be available before the newer/pruned tag.
    // Reuse an exactly captured union when only its pruned successor changes.
    if (unionAsset.sha256 !== asset.sha256 && !publishedSnapshots.some((value) => value.stylesheetSha256 === unionAsset.sha256
      && canonicalJson(value.includedRevisions) === canonicalJson(aggregate.includedRevisions))) append(aggregate, unionAsset);
    append(snapshot, asset);
    assert.ok(publishedSnapshots.length + additions.length <= MAX_SNAPSHOTS, "Next development producer snapshot limit requires restart");
    const catalogue = parseNextDevWebpackCatalogue({ consumers, currentSequence: sequence, session, snapshots: [...publishedSnapshots, ...additions] });
    highestSequence = sequence;
    const handle = Object.freeze({}) as NextDevProducerCandidate;
    const { cssEntry, includedRevisions, manifests, revision, rootDirectory, rules, stylesheets } = aggregate;
    active = { assets: Object.freeze(assets), catalogue, handle, identity: key, phase: "prepared",
      coverage: Object.freeze({ cssEntry, includedRevisions, manifests, revision, rootDirectory, rules, stylesheets }) };
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
      for (const asset of candidate.assets) assets.set(asset.sha256, asset);
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
        for (const asset of candidate.assets) expected.set(asset.sha256, asset);
        assert.deepEqual([...emitted].sort((left, right) => left.path < right.path ? -1 : 1),
          [...expected.values()].map(({ path, css }) => ({ path, css })).sort((left, right) => left.path < right.path ? -1 : 1),
          "Next development terminal emitted CSS differs from its complete captured asset census");
      } else assert.equal(emitted.length, 0, "Next development failed emission cannot supply a successful asset census");
      // A native cached rebuild may re-emit an already-published snapshot. It
      // cannot retract that authority, including if the rebuild later fails.
      if (candidate.phase === "published") return;
      assert.equal(candidate, active, "Next development completion is not the active client candidate");
      active = null;
      if (!succeeded) { candidate.phase = "failed"; candidate.coverage = null; return; }
      candidate.phase = "published";
      published.set(candidate.identity, candidate);
      history.push(candidate);
      publishedSnapshots = candidate.catalogue.snapshots;
      retainedCoverage = candidate.coverage;
      candidate.coverage = null;
      for (const asset of candidate.assets) {
        if (publishedAssets.has(asset.sha256)) continue;
        publishedAssets.set(asset.sha256, asset);
        residentBytes += Buffer.byteLength(asset.css);
      }
    },
    /** Node/Edge compilation cannot independently publish or select new CSS. */
    published(snapshot: NextDevSnapshot): NextDevProducerCandidate {
      const candidate = published.get(identity(snapshot));
      assert.ok(candidate !== undefined, "Next development server snapshot has no exact published native CSS authority");
      return candidate.handle;
    },
    inspect: () => Object.freeze({ active: active !== null, materializing: pending !== null,
      published: history.length, capturedSnapshots: publishedSnapshots.length, residentAssets: publishedAssets.size, residentBytes, highestSequence }),
  });
}
