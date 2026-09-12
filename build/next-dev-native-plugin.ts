/** Private public-hook wiring; not connected to the accepted adapter yet. */
import assert from "node:assert/strict";
import { sha256 } from "./compiler.js";
import type { createNextDevNativeProducer } from "./next-dev-producer.js";
import { annotateNextDevWebpackManifest, renderNextDevWebpackBootstrap, renderNextDevWebpackManifestGate } from "./next-dev-webpack-bridge.js";

type Delivery = ReturnType<ReturnType<typeof createNextDevNativeProducer>["compilation"]>;
type Source = Readonly<{ source(): string | Uint8Array }>;
type Chunk = Readonly<{ getEntryOptions(): Readonly<{ library?: unknown }> | undefined; hasRuntime(): boolean }>;
type Tap = Readonly<{ name: string; stage?: number }>;
type Hook<Callback> = Readonly<{ tap(options: Tap, callback: Callback): void }>;
type StartupHook = Hook<(source: Source, entry: unknown, context: Readonly<{ chunk: Chunk }>) => Source>
  & Readonly<{ taps: readonly Tap[] }>;
export type NextDevNativeWebpack = Readonly<{
  Compilation: Readonly<{ PROCESS_ASSETS_STAGE_ADDITIONAL: number; PROCESS_ASSETS_STAGE_SUMMARIZE: number }>;
  RuntimeGlobals: Readonly<{ getFullHash: string; hmrDownloadManifest: string; require: string; returnExportsFromRuntime: string }>;
  RuntimeModule: (new (name: string, stage: number) => { generate(): string | null })
    & Readonly<{ STAGE_BASIC: number; STAGE_TRIGGER: number }>;
  javascript: Readonly<{ JavascriptModulesPlugin: Readonly<{ getCompilationHooks(compilation: NextDevNativeCompilation): Readonly<{ renderStartup: StartupHook }> }> }>;
  sources: Readonly<{ RawSource: new (value: string) => Source; ConcatSource: new (...values: (Source | string)[]) => Source }>;
}>;
export type NextDevNativeCompilation = Readonly<{
  addRuntimeModule(chunk: Chunk, module: { generate(): string | null }): void;
  chunkGraph: Readonly<{
    getChunkRuntimeRequirements(chunk: Chunk): ReadonlySet<string>;
    getTreeRuntimeRequirements(chunk: Chunk): ReadonlySet<string> | null;
  }>;
  chunks: Iterable<Chunk>;
  emitAsset(path: string, source: Source, info: Readonly<{ immutable: boolean }>): void;
  errors: readonly Error[];
  getAsset(path: string): Readonly<{ source: Source }> | undefined;
  getAssets(): readonly Readonly<{ name: string; source: Source; info: Readonly<{ hotModuleReplacement?: unknown }> }>[];
  hash?: string;
  hooks: Readonly<{
    additionalTreeRuntimeRequirements: Hook<(chunk: Chunk, requirements: Set<string>) => void>;
    processAssets: Hook<() => void>;
  }>;
  outputOptions: Readonly<Record<string, unknown>>;
  records?: Readonly<{ hash?: unknown }>;
  updateAsset(path: string, source: Source): void;
}>;
const NAME = "HranessStylexNextDevNative";
const PREFIX = "static/css/hraness-stylex/";
const MAX_CHUNKS = 4096;
const MAX_ASSETS = 100_000;
const MAX_STARTUP_BYTES = 2 * 1024 * 1024;
const installed = new WeakSet<NextDevNativeCompilation>();

function text(source: Source, maxBytes: number, allowEmpty = false): string {
  const raw = source.source();
  assert.ok(typeof raw === "string" || raw instanceof Uint8Array, "Next development native asset must expose ordinary source bytes");
  const bytes = typeof raw === "string" ? Buffer.from(raw) : Buffer.from(raw);
  assert.ok((allowEmpty || bytes.byteLength > 0) && bytes.byteLength <= maxBytes, "Next development native source exceeds its finite byte bound");
  const result = bytes.toString("utf8");
  assert.ok(Buffer.from(result).equals(bytes), "Next development native source must be valid UTF-8");
  return result;
}

function library(value: unknown): void {
  assert.ok(typeof value === "object" && value !== null && !Array.isArray(value), "Next development requires the native _N_E assign library");
  const options = value as Readonly<Record<string, unknown>>;
  assert.equal(options.type, "assign", "Next development requires the native _N_E assign library");
  assert.equal(options.name, "_N_E", "Next development requires the native _N_E assign library");
  for (const [key, field] of Object.entries(options)) {
    assert.ok(key === "type" || key === "name" || field === undefined, "Next development library export/wrapper options are unsupported");
  }
}

/** Install during thisCompilation, before runtime requirements/code generation. */
export function installNextDevNativeCompilation(options: Readonly<{
  compilation: NextDevNativeCompilation;
  delivery: Delivery;
  factoryExpression: string;
  relevant(): boolean;
  webpack: NextDevNativeWebpack;
}>) {
  const { compilation, delivery, webpack } = options;
  assert.ok(!installed.has(compilation), "Next development native compilation already has a bridge owner");
  installed.add(compilation);
  assert.equal(webpack.RuntimeModule.STAGE_BASIC, 5, "Next development Webpack BASIC stage changed");
  assert.equal(webpack.RuntimeModule.STAGE_TRIGGER, 20, "Next development Webpack TRIGGER stage changed");
  assert.equal(webpack.Compilation.PROCESS_ASSETS_STAGE_ADDITIONAL, -2000, "Next development native HMR emission stage changed");
  assert.equal(webpack.Compilation.PROCESS_ASSETS_STAGE_SUMMARIZE, 1000, "Next development native asset summary stage changed");
  assert.deepEqual({ getFullHash: webpack.RuntimeGlobals.getFullHash, hmrDownloadManifest: webpack.RuntimeGlobals.hmrDownloadManifest,
    require: webpack.RuntimeGlobals.require, returnExportsFromRuntime: webpack.RuntimeGlobals.returnExportsFromRuntime },
  { getFullHash: "__webpack_require__.h", hmrDownloadManifest: "__webpack_require__.hmrM",
    require: "__webpack_require__", returnExportsFromRuntime: "return-exports-from-runtime" },
  "Next development Webpack runtime globals changed");
  assert.ok(typeof options.factoryExpression === "string" && Buffer.byteLength(options.factoryExpression) <= 1024 * 1024,
    "Next development bootstrap factory exceeds its finite bound");
  const bootstrap = renderNextDevWebpackBootstrap(delivery.catalogue, options.factoryExpression);
  assert.deepEqual(delivery.assets.map(({ sha256 }) => sha256).sort(),
    [...new Set(delivery.catalogue.snapshots.map(({ stylesheetSha256 }) => stylesheetSha256))].sort(),
    "Next development native asset set differs from its captured catalogue");
  const startup = webpack.javascript.JavascriptModulesPlugin.getCompilationHooks(compilation).renderStartup;
  const runtimeChunks = new Set<Chunk>();
  let startupCount = 0;
  let manifestCount = 0;
  let emitted = false;
  let summarized = false;
  let summarizedHash: string | null = null;
  const manifests = new Map<string, string>();
  const profile = (): void => {
    const output = compilation.outputOptions;
    library(output.library);
    assert.equal(output.module, false, "Next development module output cannot be startup-gated");
    assert.equal(output.chunkFormat, "array-push", "Next development requires native array-push chunks");
    assert.equal(output.chunkLoading, "jsonp", "Next development requires native JSONP chunk loading");
    assert.equal(output.publicPath, "/_next/", "Next development requires the ordinary same-origin asset path");
    assert.equal(output.hashDigestLength, 16, "Next development requires native 16-character hashes");
    assert.equal(output.hotUpdateMainFilename, "static/webpack/[fullhash].[runtime].hot-update.json", "Next development native HMR manifest path changed");
  };
  const compatibleChunk = (chunk: Chunk, requirements?: ReadonlySet<string>): void => {
    const entry = chunk.getEntryOptions();
    if (entry?.library !== undefined) library(entry.library);
    const escape = webpack.RuntimeGlobals.returnExportsFromRuntime;
    assert.ok(!requirements?.has(escape) && !compilation.chunkGraph.getChunkRuntimeRequirements(chunk).has(escape)
      && !compilation.chunkGraph.getTreeRuntimeRequirements(chunk)?.has(escape),
      "Next development returnExportsFromRuntime escapes its startup boundary");
  };
  const finalCensus = (): readonly Readonly<{ path: string; css: string }>[] => {
    const assets = compilation.getAssets();
    assert.ok(assets.length <= MAX_ASSETS, "Next development native asset inventory exceeds its finite bound");
    const result = assets.filter(({ name }) => name.startsWith(PREFIX)).map(({ name, source }) => ({ path: name, css: text(source, 8 * 1024 * 1024 + 256) }));
    assert.deepEqual(result.sort((left, right) => left.path < right.path ? -1 : 1),
      delivery.assets.map(({ path, css }) => ({ path, css })).sort((left, right) => left.path < right.path ? -1 : 1),
      "Next development final native CSS census changed after capture");
    return Object.freeze(result.map((asset) => Object.freeze(asset)));
  };

  compilation.hooks.additionalTreeRuntimeRequirements.tap({ name: NAME }, (chunk, requirements) => {
    if (!options.relevant()) return;
    profile();
    compatibleChunk(chunk, requirements);
    assert.ok(chunk.hasRuntime(), "Next development tree-runtime hook received a non-runtime chunk");
    if (runtimeChunks.has(chunk)) return;
    assert.ok(runtimeChunks.size < MAX_CHUNKS, "Next development runtime chunk census exceeds its finite bound");
    runtimeChunks.add(chunk);
    requirements.add(webpack.RuntimeGlobals.require);
    requirements.add(webpack.RuntimeGlobals.getFullHash);
    requirements.add(webpack.RuntimeGlobals.hmrDownloadManifest);
    compilation.addRuntimeModule(chunk, new class extends webpack.RuntimeModule {
      constructor() { super(`${NAME}/bootstrap`, webpack.RuntimeModule.STAGE_BASIC); }
      override generate(): string { return bootstrap; }
    }());
    compilation.addRuntimeModule(chunk, new class extends webpack.RuntimeModule {
      constructor() { super(`${NAME}/manifest-gate`, webpack.RuntimeModule.STAGE_TRIGGER); }
      override generate(): string { return renderNextDevWebpackManifestGate(); }
    }());
  });
  // Tapable's public stage ordering puts the complete AssignLibraryPlugin
  // startup (including _N_E assignment) inside the gate. Keep the original
  // Source node in ConcatSource so its native source-map identity survives.
  startup.tap({ name: NAME, stage: Number.MAX_SAFE_INTEGER }, (source, entry, context) => {
    if (!options.relevant()) return source;
    profile();
    compatibleChunk(context.chunk);
    const body = text(source, MAX_STARTUP_BYTES, true);
    // Runtime-only chunks can have no entry startup. They do not count as an
    // observed application boundary merely because Webpack invokes this hook.
    if (entry === undefined && body.trim().length === 0) return source;
    assert.ok(body.trim().length > 0, "Next development entry startup is empty");
    assert.ok(++startupCount <= MAX_CHUNKS, "Next development startup census exceeds its finite bound");
    return new webpack.sources.ConcatSource("__webpack_require__.__hranessStylexNextDev.startup(function () {\n", source, "\n});");
  });
  compilation.hooks.processAssets.tap({ name: NAME, stage: webpack.Compilation.PROCESS_ASSETS_STAGE_ADDITIONAL - 1 }, () => {
    if (!options.relevant() || compilation.errors.length > 0) return;
    profile();
    assert.equal(emitted, false, "Next development native assets were emitted more than once");
    assert.ok(delivery.assets.length > 0 && delivery.assets.length <= 32, "Next development native delivery exceeds its finite asset bound");
    for (const asset of delivery.assets) {
      assert.equal(asset.path, `${PREFIX}${asset.sha256}.css`, "Next development native asset path differs from its digest");
      assert.equal(sha256(asset.css), asset.sha256, "Next development native asset bytes differ from their digest");
      const existing = compilation.getAsset(asset.path);
      if (existing === undefined) compilation.emitAsset(asset.path, new webpack.sources.RawSource(asset.css), { immutable: true });
      else assert.equal(text(existing.source, 8 * 1024 * 1024 + 256), asset.css, "Next development native asset collides with an existing output");
    }
    emitted = true;
  });
  // Native HotModuleReplacementPlugin emits its own c/r/m JSON at ADDITIONAL.
  // Annotate that exact asset after emission; never synthesize an empty update.
  compilation.hooks.processAssets.tap({ name: NAME, stage: webpack.Compilation.PROCESS_ASSETS_STAGE_SUMMARIZE }, () => {
    if (!options.relevant() || compilation.errors.length > 0) return;
    profile();
    assert.equal(emitted, true, "Next development native summary omitted asset emission");
    assert.equal(summarized, false, "Next development native assets were summarized more than once");
    assert.equal(startup.taps.at(-1)?.name, NAME, "Next development startup transform is no longer the final public hook");
    let count = 0;
    for (const chunk of compilation.chunks) {
      assert.ok(++count <= MAX_CHUNKS, "Next development chunk inventory exceeds its finite bound");
      compatibleChunk(chunk);
    }
    assert.ok(runtimeChunks.size > 0 && startupCount > 0, "Next development compilation omitted its runtime or application startup gate");
    assert.ok(typeof compilation.hash === "string" && /^[a-f0-9]{16}$/u.test(compilation.hash), "Next development native compilation hash is unsupported");
    finalCensus();
    const assets = compilation.getAssets();
    assert.ok(assets.length <= MAX_ASSETS, "Next development native asset inventory exceeds its finite bound");
    for (const asset of assets) {
      if (asset.info.hotModuleReplacement !== true || !asset.name.endsWith(".json")) continue;
      const match = /^static\/webpack\/([a-f0-9]{16})\.([A-Za-z0-9_-]{1,128})\.hot-update\.json$/u.exec(asset.name);
      assert.ok(match !== null && match[1] === compilation.records?.hash, "Next development native HMR asset does not match its recorded predecessor hash");
      const native: unknown = JSON.parse(text(asset.source, 1024 * 1024));
      const annotated = annotateNextDevWebpackManifest(native, { catalogue: delivery.catalogue,
        fromHash: compilation.records?.hash, toHash: compilation.hash, session: delivery.catalogue.session,
        kind: "hraness-stylex-next-dev-hot-update", schemaVersion: 1 });
      const source = JSON.stringify(annotated);
      compilation.updateAsset(asset.name, new webpack.sources.RawSource(source));
      manifests.set(asset.name, sha256(source));
      manifestCount++;
    }
    summarized = true;
    summarizedHash = compilation.hash;
  });
  return Object.freeze({
    /** Invoke only at successful native compiler completion, after all writers. */
    terminalAssets(): readonly Readonly<{ path: string; css: string }>[] {
      assert.ok(options.relevant() && emitted && summarized && compilation.errors.length === 0,
        "Next development native completion lacks a successful summarized emission");
      profile();
      assert.equal(compilation.hash, summarizedHash, "Next development native hash changed after summary");
      const finalAssets = compilation.getAssets();
      assert.ok(finalAssets.length <= MAX_ASSETS, "Next development terminal asset inventory exceeds its finite bound");
      assert.deepEqual(finalAssets.filter(({ name, info }) => info.hotModuleReplacement === true && name.endsWith(".json"))
        .map(({ name }) => name).sort(), [...manifests.keys()].sort(), "Next development native HMR asset census changed after summary");
      for (const [path, digest] of manifests) {
        const asset = compilation.getAsset(path);
        assert.ok(asset !== undefined && sha256(text(asset.source, 1024 * 1024)) === digest,
          "Next development native HMR manifest changed after summary");
      }
      return finalCensus();
    },
    inspect: () => Object.freeze({ emitted, summarized, runtimeChunks: runtimeChunks.size, startups: startupCount, hotManifests: manifestCount }),
  });
}
