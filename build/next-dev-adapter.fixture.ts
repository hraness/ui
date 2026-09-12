/** Genuine Node with constructed public hooks; not a native Next/browser receipt. */
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { artifactForFile, canonicalJson, compilerContract, compilerSha256, serializeStylexPackageRules, sha256, stylexRulesSha256 } from "./compiler.js";
import type { StylexPackageManifestV1, StylexRuleV1 } from "./contracts.js";
import { createNextDevAdapter } from "./next-dev-adapter.js";
import type { NextDevCompilationContext } from "./next-dev-compilation.js";
import type { NextDevNativeCompilation, NextDevNativeWebpack } from "./next-dev-native-plugin.js";
import { NEXT_DEV_CLIENT_IMPORT } from "./next-dev-markers.js";
import { loadNextDevModule, requireNextDevSnapshot, STYLEX_NEXT_DEV_CONTEXT, STYLEX_NEXT_DEV_CSS_ENTRY, type StylexNextDevOptions } from "./next-dev-session.js";

type Tap = Readonly<{ name: string; stage?: number }>;
class Hook<Args extends unknown[], Result = void> {
  readonly taps: (Tap & Readonly<{ callback: (...args: Args) => Result }>)[] = [];
  tap(options: Tap, callback: (...args: Args) => Result): void {
    this.taps.push({ ...options, callback });
    this.taps.sort((left, right) => (left.stage ?? 0) - (right.stage ?? 0));
  }
  run(...args: Args): Result | undefined {
    let result: Result | undefined;
    for (const { callback } of this.taps) result = callback(...args);
    return result;
  }
}
class RawSource {
  constructor(readonly value: string) {}
  source(): string { return this.value; }
}
class ConcatSource {
  readonly parts: (Readonly<{ source(): string | Uint8Array }> | string)[];
  constructor(...parts: (Readonly<{ source(): string | Uint8Array }> | string)[]) { this.parts = parts; }
  source(): string { return this.parts.map((part) => typeof part === "string" ? part : part.source()).join(""); }
}
class RuntimeModule {
  static STAGE_BASIC = 5;
  static STAGE_TRIGGER = 20;
  constructor(readonly name: string, readonly stage: number) {}
  generate(): string | null { return null; }
}
function nativeCompilation() {
  const requirements = new Set<string>();
  const chunk = { getEntryOptions: () => undefined, hasRuntime: () => true };
  const runtime = new Hook<[typeof chunk, Set<string>]>();
  const processAssets = new Hook<[]>();
  const startup = new Hook<[Readonly<{ source(): string | Uint8Array }>, unknown, Readonly<{ chunk: typeof chunk }>], Readonly<{ source(): string | Uint8Array }>>();
  const assets = new Map<string, { name: string; source: RawSource; info: { hotModuleReplacement?: unknown } }>();
  const compilation: NextDevNativeCompilation = {
    addRuntimeModule: () => {},
    chunkGraph: { getChunkRuntimeRequirements: () => requirements, getTreeRuntimeRequirements: () => requirements },
    chunks: [chunk], emitAsset: (name, source) => { assets.set(name, { name, source: new RawSource(String(source.source())), info: {} }); },
    errors: [], getAsset: (name) => assets.get(name), getAssets: () => [...assets.values()], hash: "b".repeat(16),
    hooks: { additionalTreeRuntimeRequirements: runtime, processAssets },
    outputOptions: { library: { type: "assign", name: "_N_E" }, module: false, chunkFormat: "array-push", chunkLoading: "jsonp",
      publicPath: "/_next/", hashDigestLength: 16, hotUpdateMainFilename: "static/webpack/[fullhash].[runtime].hot-update.json" },
    records: {}, updateAsset: (name, source) => { assets.get(name)!.source = new RawSource(String(source.source())); },
  };
  const webpack: NextDevNativeWebpack = {
    Compilation: { PROCESS_ASSETS_STAGE_ADDITIONAL: -2000, PROCESS_ASSETS_STAGE_SUMMARIZE: 1000 },
    RuntimeGlobals: { getFullHash: "__webpack_require__.h", hmrDownloadManifest: "__webpack_require__.hmrM",
      require: "__webpack_require__", returnExportsFromRuntime: "return-exports-from-runtime" },
    RuntimeModule, javascript: { JavascriptModulesPlugin: { getCompilationHooks: () => ({ renderStartup: startup }) } },
    sources: { RawSource, ConcatSource },
  };
  return { compilation, webpack, emit() {
    runtime.run(chunk, requirements);
    startup.run(new RawSource("ordinaryStartup();"), undefined, { chunk });
    processAssets.run();
  } };
}

const roots: string[] = [];
async function write(path: string, contents: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, contents);
}
const boundary = `import { StylexNextDevConsumer as Boundary, stylexNextDevRevision as revision } from "${NEXT_DEV_CLIENT_IMPORT}";`;
function recipe(value: number, edge = false): string {
  return `${boundary}\nimport * as stylex from "@stylexjs/stylex";\n${edge ? 'export const runtime = "edge";' : ""}
const styles = stylex.create({ root: { outlineOffset: ${value} } });
export default function Page() { return <Boundary as="main" revision={revision()} {...stylex.props(styles.root)}>Page</Boundary>; }\n`;
}
type FixtureTarget = "client" | "edge-server" | "server";
function webpackContext(target: FixtureTarget): Readonly<{ dev: boolean; isServer: boolean; nextRuntime?: "edge" | "nodejs"; webpack: { version: string } }> {
  return target === "client" ? { dev: true, isServer: false, webpack: { version: "5.0.0" } }
    : { dev: true, isServer: true, nextRuntime: target === "edge-server" ? "edge" : "nodejs", webpack: { version: "5.0.0" } };
}
function artifact(path: string, contents: string) { return { bytes: Buffer.byteLength(contents), path, sha256: sha256(contents) }; }
async function fixture(): Promise<StylexNextDevOptions> {
  const root = await mkdtemp(join(await realpath(tmpdir()), "ui-next-dev-adapter-")); roots.push(root);
  const packageRoot = join(root, "node_modules/@hraness/ui");
  const rules: readonly StylexRuleV1[] = [["x-fixture-package", { ltr: ".x-fixture-package{color:red}" }, 1000]];
  const standaloneSerializer = { before: ["components.fixture-ui.legacy"], prefix: "components.fixture-ui" };
  await write(join(root, "package.json"), '{"type":"module"}\n');
  await write(join(root, "node_modules/next/package.json"), '{"name":"next","version":"16.2.12"}\n');
  await write(join(packageRoot, "package.json"), '{"name":"@hraness/ui","version":"1.0.0","type":"module"}\n');
  await write(join(packageRoot, "dist/index.js"), "export const packageRuntime = 1;\n");
  await write(join(packageRoot, "src/compiler-foundation.css"), "@layer base{body{margin:0}}\n");
  await write(join(packageRoot, "dist/stylex.css"), serializeStylexPackageRules(rules, standaloneSerializer));
  const manifest: StylexPackageManifestV1 = {
    buildTools: [], compiler: compilerContract, compilerFoundation: "src/compiler-foundation.css", compilerSha256,
    kind: "hraness-stylex-package-manifest", package: { name: "@hraness/ui", version: "1.0.0" }, rules,
    rulesSha256: stylexRulesSha256(rules), runtime: [await artifactForFile(packageRoot, "dist/index.js")], schemaVersion: 1,
    standaloneCss: await artifactForFile(packageRoot, "dist/stylex.css"), standaloneSerializer,
    stylesheets: [await artifactForFile(packageRoot, "src/compiler-foundation.css")],
  };
  await write(join(packageRoot, "dist/stylex-manifest.json"), canonicalJson(manifest) + "\n");
  await write(join(root, "app/layout.tsx"), `import type {ReactNode} from "react"; import {StylexNextDevDocument} from "${NEXT_DEV_CLIENT_IMPORT}"; import "./stylex-dev.css";
export default function Layout({children}:{children:ReactNode}) { return <html><body><StylexNextDevDocument>{children}</StylexNextDevDocument></body></html>; }`);
  await write(join(root, "app/client.tsx"), `"use client"; ${boundary} export default function Client() { return <Boundary as="section" revision={revision()}>Client</Boundary>; }`);
  await write(join(root, "app/page.tsx"), recipe(38.375));
  await write(join(root, "app/unvisited/page.tsx"), recipe(62.625, true));
  await write(join(root, "app/stylex-dev.css"), STYLEX_NEXT_DEV_CSS_ENTRY);
  return { cssEntry: "app/stylex-dev.css", packageManifests: ["node_modules/@hraness/ui/dist/stylex-manifest.json"], rootDirectory: root, sourceDirectories: ["app"] };
}
export async function runNextDevAdapterFixture() {
  let checks = 0;
  const verify = (run: () => void): void => { run(); checks++; };
  const verifyAsync = async (result: Promise<void>): Promise<void> => { await result; checks++; };
  try {
  const options = await fixture();
  const clientPath = join(options.rootDirectory, "node_modules/@hraness/ui/dist/build/next-dev-client.js");
  const config = createNextDevAdapter({ webpack(value: Record<string, unknown>) { return value; } }, options, {
    clientPath, sourceLoader: "constructed-source-loader", cssLoader: "constructed-css-loader",
    async read() {
      const packageRoot = join(options.rootDirectory, "node_modules/@hraness/ui");
      const manifest = JSON.parse(await readFile(join(packageRoot, "dist/stylex-manifest.json"), "utf8"));
      return { clientPath, packageRoot, identity: "constructed-private-artifacts", manifestSha256: sha256(canonicalJson(manifest)),
        factoryExpression: "function () { throw new Error('Constructed compiler hooks, not a browser'); }" };
    },
  });
  const callback = config.webpack as unknown as (value: Record<string, unknown>, context: ReturnType<typeof webpackContext>) => Record<string, unknown>;
  type CompilationModule = { resource: string; resourceResolveData?: { fragment: string; path: string; query: string } };
  type Compilation = NextDevNativeCompilation & {
    contextDependencies: Set<string>;
    errors: Error[];
    fileDependencies: Set<string>;
    hooks: NextDevNativeCompilation["hooks"] & { finishModules: { tap(name: string, run: (modules: Iterable<CompilationModule>) => void): void } };
    missingDependencies: Set<string>;
  };
  type Stats = { compilation: Compilation; hasErrors(): boolean };
  const harness = (target: FixtureTarget, configuredTarget: FixtureTarget = target, emitOnErrors = false) => {
    const wrapped = callback({ optimization: { emitOnErrors: false } }, webpackContext(target));
    const plugins = wrapped.plugins as readonly { apply(compiler: unknown): void }[];
    const plugin = plugins[plugins.length - 1];
    assert.ok(plugin !== undefined);
    let before: (() => Promise<void>) | null = null;
    let compile: ((compilation: Compilation) => void) | null = null;
    let done: ((stats: Stats) => void) | null = null;
    let failed: ((error: Error) => void) | null = null;
    const native = new WeakMap<Compilation, ReturnType<typeof nativeCompilation>>();
    let loader: ((context: Record<symbol, unknown> & { resourceFragment?: string; resourcePath: string; resourceQuery?: string }) => void) | null = null;
    let invalidations = 0;
    const finishModules = new WeakMap<Compilation, (modules: Iterable<CompilationModule>) => void>();
    const compiler = {
      name: undefined as FixtureTarget | undefined,
      options: { name: configuredTarget, optimization: { emitOnErrors } },
      watching: { invalidate() { invalidations += 1; } },
      hooks: {
        beforeCompile: { tapPromise(_name: string, run: () => Promise<void>) { before = run; } },
        done: { tap(_name: string, run: (stats: Stats) => void) { done = run; } },
        failed: { tap(_name: string, run: (error: Error) => void) { failed = run; } },
        thisCompilation: { tap(_name: string, run: (compilation: Compilation) => void) { compile = run; } },
      },
      webpack: { ...nativeCompilation().webpack, NormalModule: { getCompilationHooks() { return { loader: { tap(_name: string, run: typeof loader) { loader = run; } } }; } } },
    };
    plugin.apply(compiler);
    return {
      async start(actualTarget: FixtureTarget = target) {
        assert.ok(before !== null && compile !== null);
        compiler.name = actualTarget;
        try { await before(); } catch (error) { failed?.(error as Error); throw error; }
        const input = nativeCompilation();
        const compilation: Compilation = {
          ...input.compilation,
          contextDependencies: new Set(),
          errors: [],
          fileDependencies: new Set(),
          hooks: { ...input.compilation.hooks, finishModules: { tap(_name, run) { finishModules.set(compilation, run); } } },
          missingDependencies: new Set(),
        };
        native.set(compilation, input);
        compiler.webpack = { ...compiler.webpack, ...input.webpack };
        try { compile(compilation); } catch (error) { failed?.(error as Error); throw error; }
        return compilation;
      },
      context(resourcePath = join(options.rootDirectory, "app/page.tsx"), resourceQuery = "", resourceFragment = "") {
        assert.ok(loader !== null);
        const context: Record<symbol, unknown> & { resourceFragment: string; resourcePath: string; resourceQuery: string } = { resourceFragment, resourcePath, resourceQuery };
        loader(context);
        return (context[Symbol.for(STYLEX_NEXT_DEV_CONTEXT)] as NextDevCompilationContext).preparation;
      },
      finish(compilation: Compilation, succeeded = compilation.errors.length === 0, resources: readonly (string | CompilationModule)[] = target === "client"
        ? [join(options.rootDirectory, options.cssEntry), join(options.rootDirectory, "app/client.tsx")]
        : [join(options.rootDirectory, target === "edge-server" ? "app/unvisited/page.tsx" : "app/page.tsx")]) {
        assert.ok(done !== null);
        const finish = finishModules.get(compilation);
        assert.ok(finish !== undefined);
        try {
        finish(resources.map((resource) => typeof resource === "string"
          ? { resource, resourceResolveData: { fragment: "", path: resource, query: "" } }
          : resource));
        if (target === "client" && succeeded && compilation.errors.length === 0) native.get(compilation)!.emit();
        done({ compilation, hasErrors: () => !succeeded || compilation.errors.length > 0 });
        } catch (error) { failed?.(error as Error); throw error; }
      },
      invalidations() { return invalidations; },
      setEmitOnErrors(value: boolean) { compiler.options.optimization.emitOnErrors = value; },
    };
  };
  verify(() => assert.throws(() => harness("client", "server"), new RegExp("configured identity differs")));
  for (const target of ["client", "server", "edge-server"] as const) {
    verify(() => assert.throws(() => harness(target, target, true), new RegExp("optimization\\.emitOnErrors=false")));
    const driftedEmission = harness(target);
    driftedEmission.setEmitOnErrors(true);
    await verifyAsync(assert.rejects(driftedEmission.start(), new RegExp("optimization\\.emitOnErrors=false")));
  }
  const forgedServer = harness("server");
  await verifyAsync(assert.rejects(forgedServer.start("client"), new RegExp("compiler identity differs")));
  const client = harness("client");
  const server = harness("server");
  const edge = harness("edge-server");

  // Next starts with framework-only compiler graphs before the first on-demand
  // application route. Those successful passes publish and attest nothing.
  const frameworkClient = await client.start();
  verify(() => assert.equal(client.context().error, null));
  client.finish(frameworkClient, true, []);
  verify(() => assert.deepEqual(frameworkClient.errors, []));
  const frameworkServer = await server.start();
  server.finish(frameworkServer, true, []);
  verify(() => assert.deepEqual(frameworkServer.errors, []));
  verify(() => assert.equal(client.invalidations(), 0));

  // Pinned Next's metadata/discover loader imports this native fixture asset
  // with ?__next_metadata__. Assets cannot contribute a StyleX source revision
  // or satisfy the client CSS marker, regardless of their native loader query.
  const nativeAsset = join(options.rootDirectory, "app/icon.svg");
  const metadataModule: CompilationModule = {
    resource: `${nativeAsset}?__next_metadata__`,
    resourceResolveData: { fragment: "", path: nativeAsset, query: "?__next_metadata__" },
  };
  for (const compiler of [client, server, edge]) {
    const assetsOnly = await compiler.start();
    compiler.finish(assetsOnly, true, [metadataModule, { resource: `${nativeAsset}?native-asset#fragment` }]);
    verify(() => assert.deepEqual(assetsOnly.errors, []));
  }
  verify(() => assert.equal(client.invalidations(), 0));
  const assetWithoutMarker = await client.start();
  client.finish(assetWithoutMarker, true, [metadataModule, join(options.rootDirectory, "app/page.tsx")]);
  verify(() => assert.ok((assetWithoutMarker.errors.map(({ message }) => message)).includes("Next development client source graph omitted its owned StyleX stylesheet entry")));

  // Cached modules can omit a loader visit or resolve metadata. Neither raw
  // resource spelling nor a framework-looking query may bypass JS/CSS checks.
  for (const path of [
    join(options.rootDirectory, "app/page.tsx"),
    join(options.rootDirectory, "app/icon.tsx"),
    join(options.rootDirectory, options.cssEntry),
    join(options.rootDirectory, "node_modules/@hraness/ui/dist/index.js"),
  ]) {
    for (const query of ["?raw", "?__next_metadata__", "?__next_metadata_image_meta__", "?__next_edge_ssr_entry__"]) {
      for (const resource of [
        { resource: `${path}${query}`, resourceResolveData: { path, query, fragment: "" } },
        { resource: `${path}${query}` },
        { resource: path, resourceResolveData: { path, query, fragment: "" } },
      ]) {
        const queried = await client.start();
        verify(() => assert.throws(() => client.finish(queried, true, [resource]), new RegExp("resource query")));
      }
      verify(() => assert.throws(() => client.context(path, query), new RegExp("must not contain a query")));
    }
    const fragmented = await client.start();
    verify(() => assert.throws(() => client.finish(fragmented, true, [{ resource: `${path}#fragment` }]), new RegExp("resource fragment")));
  }
  const mismatchedPath = await client.start();
  verify(() => assert.throws(() => client.finish(mismatchedPath, true, [{
    resource: nativeAsset,
    resourceResolveData: { fragment: "", path: join(options.rootDirectory, "app/page.tsx"), query: "" },
  }]), new RegExp("resource path differs")));
  for (const rawPath of [join(options.rootDirectory, "app/page.tsx"), join(options.rootDirectory, options.cssEntry)]) {
    for (const path of [nativeAsset, "app/icon.svg"]) {
      for (const suffix of ["", "?raw", "#fragment"]) {
        const maskedSource = await client.start();
        verify(() => assert.throws(() => client.finish(maskedSource, true, [{
          resource: `${rawPath}${suffix}`,
          resourceResolveData: { fragment: "", path, query: "" },
        }]), new RegExp("resource path differs")));
      }
    }
  }
  const edgeQuery = "?__next_edge_ssr_entry__";
  const edgeSource = join(options.rootDirectory, "app/unvisited/page.tsx");
  for (const [compiler, path] of [
    [server, edgeSource],
    [edge, join(options.rootDirectory, options.cssEntry)],
    [edge, join(options.rootDirectory, "node_modules/@hraness/ui/dist/index.js")],
  ] as const) {
    verify(() => assert.throws(() => compiler.context(path, edgeQuery), new RegExp("exact Edge SSR entry contract")));
    const queriedGraph = await compiler.start();
    verify(() => assert.throws(() => compiler.finish(queriedGraph, true, [{
      resource: `${path}${edgeQuery}`,
      resourceResolveData: { fragment: "", path, query: edgeQuery },
    }]), new RegExp("exact Edge SSR entry contract")));
  }
  verify(() => assert.throws(() => edge.context(edgeSource, edgeQuery, "#fragment"), new RegExp("contain a fragment")));
  for (const resource of [
    { resource: `${edgeSource}${edgeQuery}`, resourceResolveData: { fragment: "", path: edgeSource, query: "" } },
    { resource: edgeSource, resourceResolveData: { fragment: "", path: edgeSource, query: edgeQuery } },
    { resource: `${edgeSource}${edgeQuery}` },
    { resource: `${edgeSource}${edgeQuery}#fragment`, resourceResolveData: { fragment: "#fragment", path: edgeSource, query: edgeQuery } },
  ]) {
    const malformedEdgeEntry = await edge.start();
    verify(() => assert.throws(() => edge.finish(malformedEdgeEntry, true, [resource]), /resource (?:fragment|query)/u));
  }

  // A real server graph cannot emit a source revision until the matching
  // browser stylesheet has been published by a relevant client graph.
  const blockedServer = await server.start();
  server.context();
  server.finish(blockedServer);
  verify(() => assert.equal(blockedServer.errors.length, 1));
  verify(() => assert.match(blockedServer.errors[0]!.message, /no exact published native CSS authority/u));
  verify(() => assert.equal(client.invalidations(), 1));

  const clientCompilation = await client.start();
  const clientPreparation = client.context();
  client.finish(clientCompilation);

  // Cached modules do not rerun loaders, but remain present in the completed
  // compilation module graph and therefore retain client participation.
  const cachedClientCompilation = await client.start();
  client.finish(cachedClientCompilation);
  verify(() => assert.deepEqual(cachedClientCompilation.errors, []));

  // Seeing owned source without the exact marker would otherwise publish CSS
  // that the browser graph can never load.
  const missingStylesheet = await client.start();
  client.context();
  client.finish(missingStylesheet, true, [join(options.rootDirectory, "app/page.tsx")]);
  verify(() => assert.deepEqual(missingStylesheet.errors.map(({ message }) => message), [
    "Next development client source graph omitted its owned StyleX stylesheet entry",
  ]));

  const initialServerCompilation = await server.start();
  const initialServerPreparation = server.context();
  server.finish(initialServerCompilation);
  verify(() => assert.equal(requireNextDevSnapshot(initialServerPreparation).revision, requireNextDevSnapshot(clientPreparation).revision));
  const cachedServerCompilation = await server.start();
  server.finish(cachedServerCompilation);
  verify(() => assert.deepEqual(cachedServerCompilation.errors, []));
  const initialEdgeCompilation = await edge.start();
  const initialEdgePreparation = edge.context(edgeSource, edgeQuery);
  const transformedEdgeSource = await loadNextDevModule(initialEdgePreparation, edgeSource, await readFile(edgeSource, "utf8"));
  verify(() => assert.ok(!(transformedEdgeSource.code).includes("stylex.create")));
  verify(() => assert.deepEqual((transformedEdgeSource.map as { sources: unknown }).sources, ["app/unvisited/page.tsx"]));
  edge.finish(initialEdgeCompilation, true, [{
    resource: `${edgeSource}${edgeQuery}`,
    resourceResolveData: { fragment: "", path: edgeSource, query: edgeQuery },
  }]);
  verify(() => assert.deepEqual(initialEdgeCompilation.errors, []));
  verify(() => assert.equal(requireNextDevSnapshot(initialEdgePreparation).revision, requireNextDevSnapshot(clientPreparation).revision));

  // A successful graph census with no owned modules retires prior client
  // participation without replacing its last published stylesheet.
  const removedClientCompilation = await client.start();
  client.finish(removedClientCompilation, true, []);
  verify(() => assert.deepEqual(removedClientCompilation.errors, []));

  await write(join(options.rootDirectory, "app/page.tsx"), recipe(39.375));
  const transitioningClientCompilation = await client.start();
  const transitioningClient = client.context();
  verify(() => assert.ok((requireNextDevSnapshot(transitioningClient).css).includes("38.375px")));
  verify(() => assert.ok((requireNextDevSnapshot(transitioningClient).css).includes("39.375px")));
  client.finish(transitioningClientCompilation);
  verify(() => assert.equal(client.invalidations(), 1));

  // A repeat client compilation before the active server and Edge compiler
  // attest the revision must retain both sides without self-invalidating.
  const earlyPruneCompilation = await client.start();
  const earlyPrune = client.context();
  verify(() => assert.ok((requireNextDevSnapshot(earlyPrune).css).includes("38.375px")));
  verify(() => assert.ok((requireNextDevSnapshot(earlyPrune).css).includes("39.375px")));
  client.finish(earlyPruneCompilation);
  verify(() => assert.equal(client.invalidations(), 1));

  // This edit occurs between Next's serial client and server starts. The server
  // cannot expose N+2 JavaScript while the browser still has the N+1 sheet.
  await write(join(options.rootDirectory, "app/page.tsx"), recipe(40.375));
  const driftedServerCompilation = await server.start();
  const driftedServer = server.context();
  verify(() => assert.equal(driftedServer.error === null, false));
  server.finish(driftedServerCompilation);
  verify(() => assert.equal(driftedServerCompilation.errors.length, 1));
  verify(() => assert.match(driftedServerCompilation.errors[0]!.message, /no exact published native CSS authority/u));
  verify(() => assert.equal(client.invalidations(), 2));

  const recoveryClientCompilation = await client.start();
  const recoveryClient = client.context();
  const recoveryCss = requireNextDevSnapshot(recoveryClient).css;
  verify(() => assert.ok((recoveryCss).includes("38.375px")));
  verify(() => assert.ok((recoveryCss).includes("39.375px")));
  verify(() => assert.ok((recoveryCss).includes("40.375px")));
  client.finish(recoveryClientCompilation);
  const recoveryServerCompilation = await server.start();
  const recoveryServer = server.context();
  verify(() => assert.equal(requireNextDevSnapshot(recoveryServer).revision, requireNextDevSnapshot(recoveryClient).revision));
  server.finish(recoveryServerCompilation);
  verify(() => assert.equal(client.invalidations(), 2));

  // Edge still attests only the original revision. An unsuccessful empty graph
  // cannot retire that participant or release the current revision's barrier.
  verify(() => assert.notEqual(requireNextDevSnapshot(initialEdgePreparation).revision, requireNextDevSnapshot(recoveryClient).revision));
  const failedIrrelevantEdgeCompilation = await edge.start();
  edge.finish(failedIrrelevantEdgeCompilation, false, []);
  verify(() => assert.equal(client.invalidations(), 2));

  // A successful empty graph proves the route is absent. No owned Edge module
  // or new Edge source attestation is needed before the client can prune.
  const irrelevantEdgeCompilation = await edge.start();
  edge.finish(irrelevantEdgeCompilation, true, []);
  verify(() => assert.deepEqual(irrelevantEdgeCompilation.errors, []));
  verify(() => assert.equal(client.invalidations(), 3));

  const pruneCompilation = await client.start();
  const pruned = client.context();
  verify(() => assert.deepEqual(requireNextDevSnapshot(pruned).includedRevisions, [requireNextDevSnapshot(recoveryClient).revision]));
  verify(() => assert.ok(!(requireNextDevSnapshot(pruned).css).includes("38.375px")));
  verify(() => assert.ok(!(requireNextDevSnapshot(pruned).css).includes("39.375px")));
  verify(() => assert.ok((requireNextDevSnapshot(pruned).css).includes("40.375px")));
  verify(() => assert.equal(requireNextDevSnapshot(initialEdgePreparation).revision, requireNextDevSnapshot(clientPreparation).revision));
  client.finish(pruneCompilation);
  verify(() => assert.equal(client.invalidations(), 3));

  verify(() => assert.equal(clientCompilation.contextDependencies.has(join(options.rootDirectory, "app")), true));
  verify(() => assert.equal(clientCompilation.fileDependencies.has(join(options.rootDirectory, "app/unvisited/page.tsx")), true));
  await write(join(options.rootDirectory, "app/unvisited/page.tsx"), "export const broken = ;");
  const failedFrameworkClient = await client.start();
  verify(() => assert.deepEqual(failedFrameworkClient.errors, []));
  client.finish(failedFrameworkClient, true, []);
  verify(() => assert.deepEqual(failedFrameworkClient.errors, []));
  const failedFrameworkServer = await server.start();
  verify(() => assert.deepEqual(failedFrameworkServer.errors, []));
  server.finish(failedFrameworkServer, true, []);
  verify(() => assert.deepEqual(failedFrameworkServer.errors, []));
  const failedMissingStylesheet = await client.start();
  const failedMissingPreparation = client.context();
  const missingPreparationError = failedMissingPreparation.error;
  assert.ok(missingPreparationError !== null);
  client.finish(failedMissingStylesheet, true, [join(options.rootDirectory, "app/page.tsx")]);
  verify(() => assert.ok((failedMissingStylesheet.errors.map(({ message }) => message)).includes("Next development client source graph omitted its owned StyleX stylesheet entry")));
  verify(() => assert.ok((failedMissingStylesheet.errors).includes(missingPreparationError)));
  const failed = await client.start();
  verify(() => assert.deepEqual(failed.errors, []));
  const failedPreparation = client.context();
  verify(() => assert.equal(failedPreparation.lastGood?.revision, requireNextDevSnapshot(pruned).revision));
  verify(() => assert.ok((failedPreparation.attemptedFiles).includes(join(options.rootDirectory, "app/unvisited/page.tsx"))));
  verify(() => assert.equal(failed.contextDependencies.has(join(options.rootDirectory, "app")), true));
  client.finish(failed);
  verify(() => assert.equal((failed.errors).length, 1));
  await write(join(options.rootDirectory, "node_modules/@fixture/unregistered/dist/stylex-manifest.json"), "{}");
  verify(() => assert.throws(() => client.context(join(options.rootDirectory, "node_modules/@fixture/unregistered/dist/index.js")), new RegExp("unregistered StyleX package")));
  verify(() => assert.throws(() => client.context("/outside/source.ts"), new RegExp("outside its owned root")));
  verify(() => assert.throws(() => client.context(join(options.rootDirectory, "app/page.tsx"), "?raw"), new RegExp("must not contain a query")));

  await write(join(options.rootDirectory, "app/unvisited/page.tsx"), recipe(62.625, true));
  const manifestPath = join(options.rootDirectory, options.packageManifests[0]!);
  const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as StylexPackageManifestV1;
  const missingLogical = "dist/watched-after-failure.js";
  await write(manifestPath, `${canonicalJson({ ...manifest, runtime: [artifact(missingLogical, "export const watched = true;\n")] })}\n`);
  const missingCompilation = await client.start();
  const missingAbsolute = join(options.rootDirectory, "node_modules/@hraness/ui", missingLogical);
  verify(() => assert.deepEqual(missingCompilation.errors, []));
  verify(() => assert.equal(missingCompilation.missingDependencies.has(missingAbsolute), true));
  verify(() => assert.equal(missingCompilation.fileDependencies.has(join(options.rootDirectory, "node_modules/@hraness/ui/dist/index.js")), true));
  verify(() => assert.ok((client.context().attemptedMissing).includes(missingAbsolute)));
  client.finish(missingCompilation);
  verify(() => assert.equal((missingCompilation.errors).length, 1));
    return { checks, node: process.versions.node };
  } finally { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); }
}
