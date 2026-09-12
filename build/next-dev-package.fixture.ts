/** Genuine Node, actual packaged bytes, constructed Webpack/DOM hooks. Not native Next acceptance. */
import assert from "node:assert/strict";
import { constants } from "node:fs";
import { lstat, mkdir, mkdtemp, open, readFile, realpath, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createContext, runInContext } from "node:vm";
import { parseSync, types as t } from "@babel/core";
import { canonicalJson, readStylexPackageManifest, sha256 } from "./compiler.js";
import type { StylexArtifactV1 } from "./contracts.js";
import type { NextDevNativeCompilation, NextDevNativeWebpack } from "./next-dev-native-plugin.js";
import { NEXT_DEV_CLIENT_IMPORT } from "./next-dev-markers.js";
import { NEXT_DEV_PACKAGE_DOCUMENT } from "./next-dev-package-dom.fixture.js";
import { parseNextDevWebpackCatalogue } from "./next-dev-webpack-bridge.js";

type Tap = Readonly<{ name: string; stage?: number }>;
class Hook<Args extends unknown[], Result = void> {
  readonly taps: (Tap & { callback: (...args: Args) => Result })[] = [];
  tap(options: Tap, callback: (...args: Args) => Result): void {
    this.taps.push({ ...options, callback }); this.taps.sort((a, b) => (a.stage ?? 0) - (b.stage ?? 0));
  }
  run(...args: Args): Result | undefined {
    let result: Result | undefined;
    for (const { callback } of this.taps) result = callback(...args);
    return result;
  }
}
type Source = Readonly<{ source(): string | Uint8Array }>;
class RawSource implements Source { constructor(readonly value: string) {} source(): string { return this.value; } }
class ConcatSource implements Source {
  readonly parts: (string | Source)[];
  constructor(...parts: (string | Source)[]) { this.parts = parts; }
  source(): string { return this.parts.map(value => typeof value === "string" ? value : value.source()).join(""); }
}
class RuntimeModule {
  static STAGE_BASIC = 5; static STAGE_TRIGGER = 20;
  constructor(readonly name: string, readonly stage: number) {}
  generate(): string | null { return null; }
}
type Module = { resource: string; resourceResolveData: { path: string; query: string; fragment: string } };
type Compilation = NextDevNativeCompilation & {
  contextDependencies: Set<string>; fileDependencies: Set<string>; missingDependencies: Set<string>; errors: Error[];
  hooks: NextDevNativeCompilation["hooks"] & { finishModules: { tap(name: string, callback: (modules: Module[]) => void): void } };
};
type Target = "client" | "server" | "edge-server";
type LoaderContext = Record<symbol, unknown> & { resourcePath: string; resourceQuery: string; resourceFragment: string;
  cacheable(value: boolean): void; async(): (error: Error | null, code?: string, map?: unknown) => void };
type Loader = (this: LoaderContext, source: Buffer, map: unknown) => void;
type WebpackCallback = (input: object, context: object) => {
  plugins: { apply(compiler: object): void }[];
  module: { rules: { use: { loader: string }[] }[] };
  resolve: { alias: Record<string, string> };
};

function nativeCompilation(hash: string, previous?: string) {
  const requirements = new Set<string>();
  const chunk = { getEntryOptions: () => undefined, hasRuntime: () => true };
  const runtime = new Hook<[typeof chunk, Set<string>]>();
  const processAssets = new Hook<[]>();
  const startup = new Hook<[Source, unknown, { chunk: typeof chunk }], Source>();
  const modules: RuntimeModule[] = [];
  const assets = new Map<string, { name: string; source: RawSource; info: { hotModuleReplacement?: boolean } }>();
  const compilation: NextDevNativeCompilation = {
    addRuntimeModule: (_chunk, module) => { modules.push(module as RuntimeModule); },
    chunkGraph: { getChunkRuntimeRequirements: () => requirements, getTreeRuntimeRequirements: () => requirements }, chunks: [chunk],
    emitAsset: (name, source) => { assets.set(name, { name, source: new RawSource(String(source.source())), info: {} }); },
    errors: [], getAsset: name => assets.get(name), getAssets: () => [...assets.values()], hash,
    hooks: { additionalTreeRuntimeRequirements: runtime, processAssets },
    outputOptions: { library: { type: "assign", name: "_N_E" }, module: false, chunkFormat: "array-push", chunkLoading: "jsonp",
      publicPath: "/_next/", hashDigestLength: 16, hotUpdateMainFilename: "static/webpack/[fullhash].[runtime].hot-update.json" },
    records: previous === undefined ? {} : { hash: previous },
    updateAsset: (name, source) => { assets.get(name)!.source = new RawSource(String(source.source())); },
  };
  const webpack: NextDevNativeWebpack = {
    Compilation: { PROCESS_ASSETS_STAGE_ADDITIONAL: -2000, PROCESS_ASSETS_STAGE_SUMMARIZE: 1000 },
    RuntimeGlobals: { getFullHash: "__webpack_require__.h", hmrDownloadManifest: "__webpack_require__.hmrM",
      require: "__webpack_require__", returnExportsFromRuntime: "return-exports-from-runtime" },
    RuntimeModule, javascript: { JavascriptModulesPlugin: { getCompilationHooks: () => ({ renderStartup: startup }) } },
    sources: { RawSource, ConcatSource },
  };
  if (previous !== undefined) processAssets.tap({ name: "ConstructedNativeHmr", stage: -2000 }, () => {
    const name = `static/webpack/${previous}.webpack.hot-update.json`;
    assets.set(name, { name, source: new RawSource(JSON.stringify({ c: ["app/layout", "webpack"], r: [], m: [12] })), info: { hotModuleReplacement: true } });
  });
  return { compilation, webpack, assets, modules, emit() {
    runtime.run(chunk, requirements);
    const original = new RawSource("globalThis.nativeStartup++; globalThis._N_E = 'ordinary-native-export';");
    const result = startup.run(original, undefined, { chunk }); assert.ok(result instanceof ConcatSource);
    // A concat node must retain the original Source object, not flatten its map.
    assert.equal(result.parts[1], original);
    processAssets.run();
    return String(result.source());
  } };
}

async function ordinaryBytes(root: string, path: string): Promise<Buffer> {
  assert.match(path, /^(?:[a-zA-Z0-9_-][a-zA-Z0-9._-]*\/)*[a-zA-Z0-9_-][a-zA-Z0-9._-]*$/u);
  const file = resolve(root, path);
  assert.equal(await realpath(file), file, "Artifact copy traverses a symlink");
  const handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const before = await handle.stat({ bigint: true });
    assert.ok(before.isFile() && before.size > 0n && before.size <= 8n * 1024n * 1024n);
    assert.ok([0o644n, 0o755n].includes(before.mode & 0o777n));
    const bytes = await handle.readFile();
    for (const current of [await handle.stat({ bigint: true }), await lstat(file, { bigint: true })]) {
      assert.ok(current.isFile() && !current.isSymbolicLink() && current.dev === before.dev && current.ino === before.ino
        && current.size === before.size && current.mode === before.mode && current.mtimeNs === before.mtimeNs && current.ctimeNs === before.ctimeNs);
    }
    return bytes;
  } finally { await handle.close(); }
}
async function writeFresh(path: string, bytes: string | Buffer, mode = 0o644): Promise<void> {
  await mkdir(dirname(path), { recursive: true }); await writeFile(path, bytes, { flag: "wx", mode });
}
function literal(node: t.Node): unknown {
  if (t.isStringLiteral(node) || t.isNumericLiteral(node) || t.isBooleanLiteral(node)) return node.value;
  if (t.isNullLiteral(node)) return null;
  if (t.isArrayExpression(node)) return node.elements.map(item => { assert.ok(item !== null && !t.isSpreadElement(item)); return literal(item); });
  assert.ok(t.isObjectExpression(node));
  const output: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  for (const property of node.properties) {
    assert.ok(t.isObjectProperty(property) && !property.computed && !property.shorthand);
    const key = t.isIdentifier(property.key) ? property.key.name : t.isStringLiteral(property.key) ? property.key.value : null;
    assert.ok(key !== null && !Object.hasOwn(output, key)); output[key] = literal(property.value);
  }
  return output;
}
function capturedCatalogue(source: string) {
  const ast = parseSync(source, { babelrc: false, configFile: false, sourceType: "script" });
  assert.ok(ast !== null && ast.program.body.length === 1);
  const statement = ast.program.body[0]; assert.ok(t.isExpressionStatement(statement) && t.isCallExpression(statement.expression));
  const argument = statement.expression.arguments[1]; assert.ok(argument !== undefined && !t.isArgumentPlaceholder(argument) && !t.isSpreadElement(argument));
  return parseNextDevWebpackCatalogue(JSON.parse(JSON.stringify(literal(argument))) as unknown);
}

export async function runNextDevPackageFixture(repository: string) {
  assert.equal(typeof (globalThis as { Bun?: unknown }).Bun, "undefined"); assert.match(process.version, /^v24\./u);
  assert.equal(await realpath(repository), repository);
  const ignore = await readFile(join(repository, ".gitignore"), "utf8"); assert.ok(ignore.split(/\r?\n/u).includes("/.stylex-fixtures/"));
  const parent = join(repository, ".stylex-fixtures"); await mkdir(parent, { recursive: true }); assert.equal(await realpath(parent), parent);
  const root = await mkdtemp(join(parent, "next-dev-private-"));
  const packageRoot = join(root, "node_modules/@hraness/ui");
  const manifest = await readStylexPackageManifest(join(repository, "dist/stylex-manifest.json"), repository);
  const artifacts: readonly StylexArtifactV1[] = [...manifest.runtime, ...manifest.buildTools, manifest.standaloneCss, ...manifest.stylesheets];
  assert.ok(artifacts.length > 0 && artifacts.length <= 2048 && artifacts.reduce((sum, item) => sum + item.bytes, 0) <= 64 * 1024 * 1024);
  const retained = new Map<string, Buffer>();
  for (const path of ["package.json", "dist/stylex-manifest.json", ...artifacts.map(item => item.path)]) {
    assert.ok(!retained.has(path)); const bytes = await ordinaryBytes(repository, path); retained.set(path, bytes);
    const mode = (await lstat(join(repository, path))).mode & 0o777;
    await writeFresh(join(packageRoot, path), bytes, mode);
  }
  const copied = await readStylexPackageManifest(join(packageRoot, "dist/stylex-manifest.json"), packageRoot); assert.deepEqual(copied, manifest);
  const sourceHashes = (): string => sha256(canonicalJson([...retained].map(([path, bytes]) => ({ path, bytes: bytes.length, sha256: sha256(bytes) }))));
  const seal = sourceHashes();
  const boundary = `import {StylexNextDevConsumer as Boundary,stylexNextDevRevision as revision} from "${NEXT_DEV_CLIENT_IMPORT}";`;
  const recipe = (offset: number, edge = false) => `${boundary} import * as stylex from "@stylexjs/stylex";
    ${edge ? 'export const runtime="edge";' : ""} const styles=stylex.create({root:{outlineOffset:${offset}}});
    export default function Page(){return <Boundary as="main" revision={revision()} {...stylex.props(styles.root)}>Page</Boundary>;}`;
  await writeFresh(join(root, "package.json"), '{"type":"module"}\n');
  await writeFresh(join(root, "app/layout.tsx"), `import type {ReactNode} from "react";import {StylexNextDevDocument} from "${NEXT_DEV_CLIENT_IMPORT}";import "./stylex-dev.css";
    export default function Layout({children}:{children:ReactNode}){return <html><body><StylexNextDevDocument>{children}</StylexNextDevDocument></body></html>;}`);
  await writeFresh(join(root, "app/client.tsx"), `"use client";${boundary} export default function Client(){return <Boundary as="section" revision={revision()}>Client</Boundary>;}`);
  await writeFresh(join(root, "app/page.tsx"), recipe(38.375));
  await writeFresh(join(root, "app/unvisited/page.tsx"), recipe(62.625, true));
  const adapterPath = join(packageRoot, "dist/build/next-dev.js");
  const adapter = await import(pathToFileURL(adapterPath).href) as typeof import("./next-dev.js");
  await writeFresh(join(root, "app/stylex-dev.css"), adapter.STYLEX_NEXT_DEV_CSS_ENTRY);
  const config = adapter.withStylexNextDev({}, { rootDirectory: root, cssEntry: "app/stylex-dev.css", sourceDirectories: ["app"],
    packageManifests: ["node_modules/@hraness/ui/dist/stylex-manifest.json"] }) as { webpack: WebpackCallback };
  const require = createRequire(join(packageRoot, "package.json"));
  const sourceLoader = require("./dist/build/next-dev-loader.cjs") as Loader;
  const cssLoader = require("./dist/build/next-dev-css-loader.cjs") as Loader;
  let checks = 0;
  const check = (callback: () => void): void => { callback(); checks++; };
  const harness = (target: Target) => {
    const value = config.webpack({ optimization: { emitOnErrors: false } }, { dev: true, isServer: target !== "client",
      ...(target === "client" ? {} : { nextRuntime: target === "server" ? "nodejs" : "edge" }), webpack: { version: "5.0.0" } });
    check(() => assert.equal(value.resolve.alias[`${NEXT_DEV_CLIENT_IMPORT}$`], join(packageRoot, "dist/build/next-dev-client.js")));
    check(() => assert.deepEqual(value.module.rules.map(rule => rule.use[0]!.loader), ["next-dev-loader.cjs", "next-dev-css-loader.cjs"].map(path => join(packageRoot, "dist/build", path))));
    let before: (() => Promise<void>) | undefined, compile: ((input: Compilation) => void) | undefined;
    let done: ((input: { compilation: Compilation; hasErrors(): boolean }) => void) | undefined;
    let failed: ((error: Error) => void) | undefined, loader: ((context: LoaderContext) => void) | undefined;
    const compiler = { name: target, options: { name: target, optimization: { emitOnErrors: false } }, watching: { invalidate() {} },
      hooks: {
        beforeCompile: { tapPromise(_name: string, callback: typeof before) { before = callback; } },
        thisCompilation: { tap(_name: string, callback: typeof compile) { compile = callback; } },
        done: { tap(_name: string, callback: typeof done) { done = callback; } },
        failed: { tap(_name: string, callback: typeof failed) { failed = callback; } },
      },
      webpack: { ...nativeCompilation("a".repeat(16)).webpack,
        NormalModule: { getCompilationHooks() { return { loader: { tap(_name: string, callback: typeof loader) { loader = callback; } } }; } } },
    };
    assert.equal(value.plugins.length, 1); value.plugins[0]!.apply(compiler);
    return { async start(hash: string, previous?: string) {
      assert.ok(before !== undefined && compile !== undefined && done !== undefined && failed !== undefined);
      const fail = failed, complete = done;
      try { await before(); } catch (error) { fail(error as Error); throw error; }
      const native = nativeCompilation(hash, previous);
      let finish: ((input: Module[]) => void) | undefined;
      const compilation: Compilation = { ...native.compilation, errors: [], contextDependencies: new Set(), fileDependencies: new Set(), missingDependencies: new Set(),
        hooks: { ...native.compilation.hooks, finishModules: { tap(_name, callback) { finish = callback; } } } };
      compiler.webpack = { ...compiler.webpack, ...native.webpack };
      try { compile(compilation); } catch (error) { fail(error as Error); throw error; }
      return { native, async load(path: string, css = false) {
        const resourcePath = join(root, path), input = await readFile(resourcePath);
        // The source pre-loader is deliberately first, so it receives no map.
        // Ordinary CSS retains the upstream native-loader map by identity.
        const inputMap = css ? { source: "owned-input-map" } : undefined;
        let callbacks = 0; const cache: boolean[] = [];
        const result = await new Promise<{ code: string; map: unknown }>((resolveOutput, rejectOutput) => {
          const context: LoaderContext = { resourcePath, resourceQuery: "", resourceFragment: "", cacheable(value) { cache.push(value); },
            async: () => (error, code, map) => { callbacks++; if (error !== null) rejectOutput(error); else { assert.ok(typeof code === "string"); resolveOutput({ code, map }); } } };
          assert.ok(loader !== undefined); loader(context); (css ? cssLoader : sourceLoader).call(context, input, inputMap);
        });
        check(() => assert.equal(callbacks, 1)); check(() => assert.deepEqual(cache, [false]));
        return { ...result, input, inputMap };
      }, finish(paths: string[]) {
        assert.ok(finish !== undefined);
        try {
          finish(paths.map(path => ({ resource: join(root, path), resourceResolveData: { path: join(root, path), query: "", fragment: "" } })));
          assert.deepEqual(compilation.errors, []);
          const startup = target === "client" ? native.emit() : null;
          complete({ compilation, hasErrors: () => compilation.errors.length > 0 }); assert.deepEqual(compilation.errors, []);
          return startup;
        } catch (error) { fail(error as Error); throw error; }
      } };
    } };
  };
  const client = harness("client"), server = harness("server"), edge = harness("edge-server");
  const first = await client.start("a".repeat(16));
  const initialClient = await first.load("app/client.tsx");
  check(() => assert.doesNotMatch(initialClient.code, /revision\(\)/u));
  check(() => assert.deepEqual((initialClient.map as { sources: unknown }).sources, ["app/client.tsx"]));
  const privateClient = await first.load("node_modules/@hraness/ui/dist/build/next-dev-client.js");
  check(() => assert.equal(privateClient.code, privateClient.input.toString("utf8")));
  const marker = await first.load("app/stylex-dev.css", true);
  check(() => assert.equal(marker.code, "/* StyleX Next development native stylesheet marker. */\n")); check(() => assert.equal(marker.map, null));
  const foundation = await first.load("node_modules/@hraness/ui/src/compiler-foundation.css", true);
  check(() => assert.equal(foundation.code, foundation.input.toString("utf8"))); check(() => assert.equal(foundation.map, foundation.inputMap));
  const startup = first.finish(["app/client.tsx", "app/stylex-dev.css", "node_modules/@hraness/ui/dist/build/next-dev-client.js"]);
  assert.ok(startup !== null);
  check(() => assert.deepEqual(first.native.modules.map(module => module.stage), [5, 20]));
  const bootstrap = first.native.modules[0]!.generate()!, gate = first.native.modules[1]!.generate()!;
  const catalogue = capturedCatalogue(bootstrap);
  check(() => assert.equal(catalogue.consumers.length, 3));
  for (const [target, path] of [[server, "app/page.tsx"], [edge, "app/unvisited/page.tsx"]] as const) {
    const active = await target.start("a".repeat(16)); const output = await active.load(path);
    check(() => assert.ok(output.code.includes(catalogue.session) && output.code.includes(catalogue.snapshots[0]!.revision)));
    check(() => assert.deepEqual((output.map as { sources: unknown }).sources, [path])); active.finish([path]);
  }
  await writeFile(join(root, "app/page.tsx"), recipe(39.375)); // This exact synthetic input is owned by this fixture.
  const second = await client.start("b".repeat(16), "a".repeat(16));
  await second.load("app/client.tsx"); await second.load("app/stylex-dev.css", true);
  second.finish(["app/client.tsx", "app/stylex-dev.css"]);
  const hot = second.native.assets.get(`static/webpack/${"a".repeat(16)}.webpack.hot-update.json`)!;
  const annotated: unknown = JSON.parse(hot.source.source());
  assert.ok(typeof annotated === "object" && annotated !== null && "hranessStylexNextDev" in annotated);
  const metadata = annotated.hranessStylexNextDev as { catalogue: unknown };
  const next = parseNextDevWebpackCatalogue(metadata.catalogue);
  check(() => assert.equal(next.session, catalogue.session)); check(() => assert.ok(next.currentSequence > catalogue.currentSequence));
  const context = createContext({ URL });
  const run = (code: string): unknown => runInContext(code, context, { timeout: 1000 });
  const flush = async (): Promise<void> => { for (let index = 0; index < 64; index++) await Promise.resolve(); };
  const plain = (code: string): unknown => JSON.parse(JSON.stringify(run(code))) as unknown;
  let primary: unknown;
  try {
    run(`globalThis.initialCatalogue = JSON.parse(${JSON.stringify(JSON.stringify(catalogue))});`);
    run(NEXT_DEV_PACKAGE_DOCUMENT); run(bootstrap); run(gate); run(startup);
    await flush(); check(() => assert.equal(run("nativeStartup"), 0));
    check(() => assert.deepEqual(plain("__webpack_require__.__hranessStylexNextDev.inspect()"), {
      phase: "open", reason: null, startupCount: 1, pendingManifest: false, terminalContinuations: 0 }));
    run(`globalThis.owner = document[Symbol.for("@hraness/ui/stylex-next-dev/document-owner-v1")];`);
    check(() => assert.equal(run("Object.isFrozen(owner)"), true));
    run("for (const link of [...document.links]) link.load(); document.loaded();");
    await flush(); check(() => assert.equal(run("nativeStartup"), 1)); check(() => assert.equal(run("_N_E"), "ordinary-native-export"));
    run(`globalThis.unsubscribe = owner.documentOwner.subscribeDocument(() => {});
      for (const root of document.roots) owner.documentOwner.committed(root, JSON.parse(root.getAttribute("data-hraness-stylex-descriptor")));`);
    await flush(); check(() => assert.equal(run("owner.documentOwner.getSnapshot().phase"), "ready"));
    run(bootstrap); run(gate); await flush();
    check(() => assert.equal(run('document[Symbol.for("@hraness/ui/stylex-next-dev/document-owner-v1")] === owner'), true));
    run(`globalThis.nativeManifest=JSON.parse(${JSON.stringify(JSON.stringify(annotated))}); globalThis.accepted=false;
      globalThis.manifestPromise=__webpack_require__.hmrM(); manifestPromise.then(value => { globalThis.returned=value; accepted=true; });`);
    await flush(); check(() => assert.equal(run("accepted"), false)); check(() => assert.equal(run("nativeCalls"), 1));
    check(() => assert.equal(run("__webpack_require__.hmrM() === manifestPromise"), true));
    run("for (const link of [...document.links]) if (link.sheet === null) link.load();");
    await flush(); check(() => assert.equal(run("accepted"), true));
    check(() => assert.equal(run("returned === nativeManifest && returned.c === nativeManifest.c && returned.r === nativeManifest.r && returned.m === nativeManifest.m"), true));
    check(() => assert.equal(run("owner.documentOwner.getSnapshot().phase"), "ready"));
    // No new consumer commit has retired the original stylesheet. Both the
    // original sheet and its covering transition union remain last-good.
    run("globalThis.lastGoodLinks=document.links.filter(link=>link.media==='all'); globalThis.lastGoodSnapshot=owner.documentOwner.getSnapshot().active;");
    check(() => assert.deepEqual(plain("lastGoodLinks.map(link=>link.getAttribute('href')).sort()"), [catalogue.snapshots[0]!.stylesheetSha256,
      next.snapshots.find(snapshot => snapshot.sequence === next.currentSequence)!.stylesheetSha256].map(hash => `/_next/static/css/hraness-stylex/${hash}.css`).sort()));
    run(`globalThis.currentHash="bbbbbbbbbbbbbbbb"; globalThis.nativeManifest={c:[],r:[],m:[]}; globalThis.unownedAccepted=false;
      __webpack_require__.hmrM().then(() => { unownedAccepted=true; });`);
    await flush(); check(() => assert.equal(run("unownedAccepted"), false));
    check(() => assert.equal(run("__webpack_require__.__hranessStylexNextDev.inspect().phase"), "restart-required"));
    check(() => assert.equal(run("owner.documentOwner.getSnapshot().phase"), "restart-required"));
    check(() => assert.equal(run("owner.documentOwner.getSnapshot().active === lastGoodSnapshot"), true));
    check(() => assert.equal(run("document.links.filter(link=>link.media==='all').length === lastGoodLinks.length && lastGoodLinks.every(link=>link.isConnected && document.links.includes(link) && link.media==='all')"), true));
  } catch (error) { primary = error; }
  const cleanup: unknown[] = [];
  for (const code of ["globalThis.unsubscribe?.();", 'document[Symbol.for("@hraness/ui/stylex-next-dev/document-owner-v1")]?.documentOwner.close();']) {
    try { run(code); } catch (error) { cleanup.push(error); }
  }
  await flush();
  try { check(() => assert.deepEqual(plain("census()"), { timers: 0, observers: 0, listeners: 0 })); }
  catch (error) { cleanup.push(error); }
  for (const [path, bytes] of retained) {
    try {
      check(() => assert.ok(bytes.length > 0));
      assert.deepEqual(await ordinaryBytes(repository, path), bytes); assert.deepEqual(await ordinaryBytes(packageRoot, path), bytes);
    } catch (error) { cleanup.push(error); }
  }
  try { assert.deepEqual(await readStylexPackageManifest(join(repository, "dist/stylex-manifest.json"), repository), manifest); }
  catch (error) { cleanup.push(error); }
  // Preserve both the original execution failure and all independent collection failures.
  if (primary !== undefined || cleanup.length > 0) throw new AggregateError([...(primary === undefined ? [] : [primary]), ...cleanup], "Private emitted-byte probe failed");
  check(() => assert.equal(sourceHashes(), seal));
  const receipt = { kind: "constructed-packaged-next-dev-probe", schemaVersion: 1, nativeAcceptance: false, checks,
    node: process.versions.node, packageIdentity: seal, manifestSha256: sha256(retained.get("dist/stylex-manifest.json")!),
    adapterSha256: sha256(retained.get("dist/build/next-dev.js")!), bootstrapSha256: sha256(bootstrap), manifestGateSha256: sha256(gate),
    updateSha256: sha256(hot.source.source()), sourceMaps: ["app/client.tsx", "app/page.tsx", "app/unvisited/page.tsx"],
    runtimeStages: [5, 20], copiedArtifacts: retained.size, census: { timers: 0, observers: 0, listeners: 0 } };
  await writeFresh(join(root, "probe-result.json"), JSON.stringify(receipt) + "\n");
  return receipt;
}
