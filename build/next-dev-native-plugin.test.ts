import { expect, test } from "bun:test";
import { sha256 } from "./compiler.js";
import { installNextDevNativeCompilation, type NextDevNativeCompilation, type NextDevNativeWebpack } from "./next-dev-native-plugin.js";
import { renderNextDevWebpackStartup } from "./next-dev-webpack-bridge.js";

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
  constructor(...parts: (Readonly<{ source(): string | Uint8Array }> | string)[]) { this.parts = parts; }
  readonly parts: (Readonly<{ source(): string | Uint8Array }> | string)[];
  source(): string { return this.parts.map((part) => typeof part === "string" ? part : part.source()).join(""); }
}
class RuntimeModule {
  static STAGE_BASIC = 5;
  static STAGE_TRIGGER = 20;
  constructor(readonly name: string, readonly stage: number) {}
  generate(): string | null { return null; }
}

/** Public-hook doubles only. These are not emitted Next or browser evidence. */
function fixture() {
  const requirements = new Set<string>();
  const treeRequirements = new Set<string>();
  const chunk = { getEntryOptions: () => undefined, hasRuntime: () => true };
  const modules: { generate(): string | null }[] = [];
  const runtime = new Hook<[typeof chunk, Set<string>]>();
  const processAssets = new Hook<[]>();
  const startup = new Hook<[Readonly<{ source(): string | Uint8Array }>, unknown, Readonly<{ chunk: typeof chunk }>], Readonly<{ source(): string | Uint8Array }>>();
  const assets = new Map<string, { name: string; source: RawSource | ConcatSource; info: { hotModuleReplacement?: unknown } }>();
  const output: Record<string, unknown> = { library: { type: "assign", name: "_N_E" }, module: false,
    chunkFormat: "array-push", chunkLoading: "jsonp", publicPath: "/_next/", hashDigestLength: 16,
    hotUpdateMainFilename: "static/webpack/[fullhash].[runtime].hot-update.json" };
  const records: { hash?: string } = {};
  const errors: Error[] = [];
  const compilation: NextDevNativeCompilation = {
    addRuntimeModule: (_chunk, module) => { modules.push(module); },
    chunkGraph: { getChunkRuntimeRequirements: () => requirements, getTreeRuntimeRequirements: () => treeRequirements },
    chunks: [chunk], emitAsset: (name, source) => { assets.set(name, { name, source: new RawSource(String(source.source())), info: {} }); },
    errors, getAsset: (name) => assets.get(name), getAssets: () => [...assets.values()], hash: "b".repeat(16),
    hooks: { additionalTreeRuntimeRequirements: runtime, processAssets }, outputOptions: output, records,
    updateAsset: (name, source) => { assets.get(name)!.source = new RawSource(String(source.source())); },
  };
  const webpack: NextDevNativeWebpack = {
    Compilation: { PROCESS_ASSETS_STAGE_ADDITIONAL: -2000, PROCESS_ASSETS_STAGE_SUMMARIZE: 1000 },
    RuntimeGlobals: { getFullHash: "__webpack_require__.h", hmrDownloadManifest: "__webpack_require__.hmrM",
      require: "__webpack_require__", returnExportsFromRuntime: "return-exports-from-runtime" },
    RuntimeModule, javascript: { JavascriptModulesPlugin: { getCompilationHooks: () => ({ renderStartup: startup }) } },
    sources: { RawSource, ConcatSource },
  };
  const css = "@layer components.hraness-stylex.priority1 { .x-native { margin-left: 38.375px; } }";
  const digest = sha256(css);
  const path = `static/css/hraness-stylex/${digest}.css`;
  const delivery = { assets: [{ css, inputs: [], path, sha256: digest }], catalogue: {
    consumers: [{ source: "app/page.tsx", target: "server" as const }], currentSequence: 1, session: "a".repeat(32),
    snapshots: [{ includedRevisions: ["c".repeat(64)], revision: "c".repeat(64), sequence: 1, stylesheetSha256: digest }],
  } };
  let relevant = true;
  const owner = installNextDevNativeCompilation({ compilation, delivery, factoryExpression: "function () { throw new Error('No native owner in this pure hook control'); }",
    relevant: () => relevant, webpack });
  return { assets, chunk, compilation, css, delivery, errors, modules, output, owner, path, processAssets, records,
    requirements, runtime, startup, treeRequirements, irrelevant: () => { relevant = false; },
    ready() { runtime.run(chunk, requirements); startup.run(new RawSource("ordinaryStartup();"), undefined, { chunk }); } };
}

test("public hooks install ordered runtime gates and preserve the entire native startup Source", () => {
  const f = fixture();
  f.runtime.run(f.chunk, f.requirements);
  f.runtime.run(f.chunk, f.requirements);
  expect(f.modules).toHaveLength(2);
  expect((f.modules as RuntimeModule[]).map(({ stage }) => stage)).toEqual([5, 20]);
  expect(f.requirements).toEqual(new Set(["__webpack_require__", "__webpack_require__.h", "__webpack_require__.hmrM"]));
  expect(f.modules[0]!.generate()).toContain(f.delivery.catalogue.snapshots[0]!.stylesheetSha256);
  expect(f.modules[1]!.generate()).toBe("__webpack_require__.__hranessStylexNextDev.wrapManifest();");
  const source = new RawSource("var __webpack_exports__ = __webpack_require__('app');\n_N_E = __webpack_exports__;");
  const wrapped = f.startup.run(source, undefined, { chunk: f.chunk });
  expect(wrapped).toBeInstanceOf(ConcatSource);
  expect((wrapped as ConcatSource).parts[1]).toBe(source);
  expect(wrapped!.source()).toBe(renderNextDevWebpackStartup(source.source()));
  f.processAssets.run();
  expect(f.owner.terminalAssets()).toEqual([{ path: f.path, css: f.css }]);
  expect(f.owner.inspect()).toEqual({ emitted: true, summarized: true, runtimeChunks: 1, startups: 1, hotManifests: 0 });
  expect(() => f.processAssets.run()).toThrow("emitted more than once");
});

test("only the actual native c/r/m manifest is annotated after its emission stage", () => {
  const f = fixture();
  f.ready();
  f.records.hash = "a".repeat(16);
  const name = `static/webpack/${f.records.hash}.webpack.hot-update.json`;
  const native = { c: ["app/client", 7], r: ["removed"], m: [11] };
  f.processAssets.tap({ name: "HotModuleReplacementPlugin", stage: -2000 }, () => {
    f.assets.set(name, { name, source: new RawSource(JSON.stringify(native)), info: { hotModuleReplacement: true } });
    f.assets.set("ordinary.json", { name: "ordinary.json", source: new RawSource('{"untouched":true}'), info: {} });
  });
  f.processAssets.run();
  const annotated = JSON.parse(String(f.assets.get(name)!.source.source()));
  expect(annotated).toEqual({ ...native, hranessStylexNextDev: { catalogue: f.delivery.catalogue,
    fromHash: f.records.hash, toHash: f.compilation.hash, session: f.delivery.catalogue.session,
    kind: "hraness-stylex-next-dev-hot-update", schemaVersion: 1 } });
  expect(f.assets.get("ordinary.json")!.source.source()).toBe('{"untouched":true}');
  expect(f.owner.inspect().hotManifests).toBe(1);
  expect(f.owner.terminalAssets()).toEqual([{ path: f.path, css: f.css }]);
  f.assets.get(name)!.source = new RawSource(JSON.stringify(native));
  expect(() => f.owner.terminalAssets()).toThrow("native HMR manifest changed after summary");
});

test("unsupported module, library, asset prefix, chunk delivery and hash profiles fail closed", () => {
  for (const [key, value] of [["module", true], ["library", { type: "module" }], ["library", { type: "assign", name: "_N_E", export: "default" }],
    ["chunkFormat", "module"], ["chunkLoading", "import"], ["publicPath", "https://example.com/_next/"],
    ["hashDigestLength", 20], ["hotUpdateMainFilename", "custom.json"]] as const) {
    const f = fixture();
    f.output[key] = value;
    expect(() => f.runtime.run(f.chunk, f.requirements)).toThrow();
    expect(f.modules).toHaveLength(0);
  }
});

test("outer export returns and a later startup transform cannot escape the owned gate", () => {
  for (const phase of ["before", "late"]) {
    const f = fixture();
    if (phase === "before") {
      f.requirements.add("return-exports-from-runtime");
      expect(() => f.runtime.run(f.chunk, f.requirements)).toThrow("escapes its startup boundary");
    } else {
      f.ready();
      f.treeRequirements.add("return-exports-from-runtime");
      expect(() => f.processAssets.run()).toThrow("escapes its startup boundary");
    }
  }
  const f = fixture();
  f.ready();
  f.startup.tap({ name: "LaterStartup", stage: Infinity }, (source) => source);
  expect(() => f.processAssets.run()).toThrow("no longer the final public hook");
});

test("foreign or malformed native HMR assets cannot produce a successful summary", () => {
  for (const [name, body] of [
    ["static/webpack/wrong.webpack.hot-update.json", { c: [], r: [], m: [] }],
    [`static/webpack/${"a".repeat(16)}.webpack.hot-update.json`, { c: [1, 1], r: [], m: [] }],
    [`static/webpack/${"a".repeat(16)}.webpack.hot-update.json`, { c: [], r: [], m: [], extra: true }],
  ] as const) {
    const f = fixture();
    f.ready();
    f.records.hash = "a".repeat(16);
    f.assets.set(name, { name, source: new RawSource(JSON.stringify(body)), info: { hotModuleReplacement: true } });
    expect(() => f.processAssets.run()).toThrow();
    expect(f.owner.inspect().summarized).toBeFalse();
    expect(() => f.owner.terminalAssets()).toThrow("successful summarized emission");
  }
});

test("asset collisions, extra owned assets and post-summary mutation block terminal publication", () => {
  const collision = fixture();
  collision.ready();
  collision.assets.set(collision.path, { name: collision.path, source: new RawSource("changed"), info: {} });
  expect(() => collision.processAssets.run()).toThrow("collides with an existing output");
  const extra = fixture();
  extra.ready();
  const path = `static/css/hraness-stylex/${"0".repeat(64)}.css`;
  extra.assets.set(path, { name: path, source: new RawSource("foreign"), info: {} });
  expect(() => extra.processAssets.run()).toThrow("final native CSS census changed");
  const late = fixture();
  late.ready();
  late.processAssets.run();
  late.assets.get(late.path)!.source = new RawSource("changed after summary");
  expect(() => late.owner.terminalAssets()).toThrow("final native CSS census changed");
  const extraManifest = fixture();
  extraManifest.ready();
  extraManifest.processAssets.run();
  const manifestPath = `static/webpack/${"a".repeat(16)}.other.hot-update.json`;
  extraManifest.assets.set(manifestPath, { name: manifestPath, source: new RawSource('{"c":[],"r":[],"m":[]}'), info: { hotModuleReplacement: true } });
  expect(() => extraManifest.owner.terminalAssets()).toThrow("native HMR asset census changed after summary");
});

test("a stylesheet or empty runtime startup alone cannot attest the application startup gate", () => {
  const missing = fixture();
  expect(() => missing.processAssets.run()).toThrow("omitted its runtime or application startup gate");
  const empty = fixture();
  empty.runtime.run(empty.chunk, empty.requirements);
  for (const value of ["", "\n"]) {
    const source = new RawSource(value);
    expect(empty.startup.run(source, undefined, { chunk: empty.chunk })).toBe(source);
    expect(() => empty.startup.run(source, { actualEntry: true }, { chunk: empty.chunk })).toThrow("entry startup is empty");
  }
  expect(empty.owner.inspect().startups).toBe(0);
  expect(() => empty.processAssets.run()).toThrow("omitted its runtime or application startup gate");
});

test("irrelevant or failed graphs do not acquire a native completion claim", () => {
  const irrelevant = fixture();
  irrelevant.irrelevant();
  const source = new RawSource("ordinaryStartup();");
  expect(irrelevant.startup.run(source, undefined, { chunk: irrelevant.chunk })).toBe(source);
  irrelevant.runtime.run(irrelevant.chunk, irrelevant.requirements);
  irrelevant.processAssets.run();
  expect(irrelevant.assets.size).toBe(0);
  expect(irrelevant.modules).toHaveLength(0);
  expect(() => irrelevant.owner.terminalAssets()).toThrow("successful summarized emission");
  const failed = fixture();
  failed.errors.push(new Error("actual compiler failure"));
  failed.processAssets.run();
  expect(failed.assets.size).toBe(0);
  expect(() => failed.owner.terminalAssets()).toThrow("successful summarized emission");
});
