import assert from "node:assert/strict";
import { test } from "bun:test";
import { captureStylexNextDelegatedEntryGraph } from "./next-delegated-capture.js";
import { parseStylexNextDelegatedEntryLoader } from "./next-delegated.js";

const root = "/fixture";
const loaderPath = "/fixture/node_modules/next/dist/build/webpack/loaders/next-flight-client-entry-loader.js";
type Chunk = { id: number; ids: number[]; files: string[]; hasRuntime(): boolean };
type Group = { chunks: Chunk[]; parentsIterable: Group[]; getFiles(): string[]; getRuntimeChunk(): Chunk | null };

function fixture() {
  const options = new URLSearchParams([["modules", JSON.stringify({ request: "/fixture/app/client.tsx", ids: ["ClientProof"] })], ["server", "false"]]).toString();
  const state = { source: parseStylexNextDelegatedEntryLoader(options, root).source };
  const module = {
    type: "javascript/auto", layer: "app-pages-browser", resource: "",
    request: `${loaderPath}?${options}!`, loaders: [{ loader: loaderPath, options, ident: null as string | null }],
    dependencies: [{ type: "import() eager", category: "esm", request: "/fixture/app/client.tsx" }], blocks: [] as unknown[],
    originalSource: () => ({ source: () => state.source }),
  };
  const entry: Chunk = { id: 342, ids: [342], files: ["static/delegated.js"], hasRuntime: () => false };
  const owner: Chunk = { id: 474, ids: [474], files: ["static/shared.js"], hasRuntime: () => false };
  const runtime: Chunk = { id: 441, ids: [441], files: ["static/runtime.js"], hasRuntime: () => true };
  const css: Chunk = { id: 500, ids: [500], files: ["static/recipes.css"], hasRuntime: () => false };
  const cssModule = { type: "css/mini-extract", getSourceTypes: () => new Set(["css/mini-extract"]) };
  const parent: Group = { chunks: [runtime, owner], parentsIterable: [], getFiles: () => ["static/runtime.js", "static/shared.js"], getRuntimeChunk: () => runtime };
  const group: Group = { chunks: [runtime, entry], parentsIterable: [parent], getFiles: () => ["static/runtime.js", "static/delegated.js"], getRuntimeChunk: () => runtime };
  const compilation = {
    chunks: [runtime, owner, entry], asyncEntrypoints: [] as Group[],
    entrypoints: new Map([["app/delegated/page", group], ["shared", parent]]),
    chunkGraph: {
      getModuleId: () => 2474,
      getModuleChunksIterable: () => [owner],
      getChunkModulesIterable: (chunk: Chunk): (typeof module | typeof cssModule)[] => chunk === owner ? [module] : chunk === css ? [cssModule] : [],
      getChunkRuntimeModulesIterable: (_chunk: Chunk): unknown[] => [],
      getChunkEntryModulesWithChunkGroupIterable: (chunk: Chunk) => chunk === entry ? [[module, group] as const] : [],
      getChunkModulesIterableBySourceType: (chunk: Chunk, type: string): (typeof module | typeof cssModule)[] | undefined => chunk === css && type === "css/mini-extract" ? [cssModule] : undefined,
    },
  };
  return { compilation, css, cssModule, entry, group, module, owner, parent, runtime, state };
}
const capture = (value: ReturnType<typeof fixture>) => captureStylexNextDelegatedEntryGraph(value.compilation as never, value.entry, root, "/fixture/.next", "/fixture/.next", "static/delegated.js");

test("delegated capture proves reciprocal inherited startup ownership and exact loader source", () => {
  const value = fixture();
  const graph = capture(value);
  assert.deepEqual(graph.dependencies, [{ cssFiles: [], files: ["static/shared.js"], id: 474 }]);
  assert.deepEqual(graph.entryOwners, [{ files: ["static/shared.js"], id: 474 }]);
  assert.deepEqual(graph.imports, [{ request: "app/client.tsx", ids: ["ClientProof"] }]);
  assert.equal(graph.entryModuleId, 2474);
  assert.deepEqual(graph.entrypoints, ["app/delegated/page"]);
  assert.equal(graph.originalSource.bytes, Buffer.byteLength(value.state.source));
});

test("delegated capture rejects nonempty, unregistered, ambiguous and nonreciprocal owners", () => {
  const attacks: ((value: ReturnType<typeof fixture>) => void)[] = [
    ({ entry }) => { entry.hasRuntime = () => true; },
    ({ compilation, module }) => { compilation.chunkGraph.getChunkModulesIterable = () => [module]; },
    ({ compilation }) => { compilation.chunkGraph.getChunkRuntimeModulesIterable = () => [{}]; },
    ({ compilation }) => { compilation.chunkGraph.getChunkEntryModulesWithChunkGroupIterable = () => []; },
    ({ compilation, module, group }) => { compilation.chunkGraph.getChunkEntryModulesWithChunkGroupIterable = () => [[module, group], [module, group]]; },
    ({ group, owner }) => { group.chunks = [owner]; },
    ({ compilation }) => { compilation.entrypoints.clear(); },
    ({ compilation }) => { compilation.entrypoints.delete("shared"); },
    ({ compilation, group }) => { compilation.asyncEntrypoints.push(group); },
    ({ group }) => { group.getRuntimeChunk = () => null; },
    ({ compilation }) => { compilation.chunkGraph.getModuleChunksIterable = () => []; },
    ({ compilation }) => { compilation.chunkGraph.getChunkModulesIterable = () => []; },
    ({ compilation, entry }) => { compilation.chunkGraph.getModuleChunksIterable = () => [entry]; },
    ({ compilation, owner }) => { compilation.chunkGraph.getModuleChunksIterable = () => [owner, owner]; },
    ({ compilation, owner }) => { compilation.chunks = compilation.chunks.filter((chunk) => chunk !== owner); },
    ({ parent, runtime }) => { parent.chunks = [runtime]; },
    ({ owner }) => { owner.files = []; },
    ({ owner }) => { owner.files = ["static/shared.js", "static/code.wasm"]; },
    ({ owner }) => { owner.files = ["../../escape.js"]; },
    ({ module }) => { module.resource = "/fixture/app/client.tsx"; },
    ({ module }) => { module.type = "javascript/esm"; },
    ({ module }) => { module.layer = "rsc"; },
    ({ module }) => { module.loaders[0]!.ident = "redirect"; },
    ({ module }) => { module.loaders[0]!.loader = "/other/loader.js"; },
    ({ module }) => { module.request += "other-loader!"; },
    ({ module }) => { module.blocks.push({}); },
    ({ module }) => { module.dependencies = []; },
    ({ module }) => { module.dependencies[0]!.type = "import()"; },
    ({ module }) => { module.dependencies[0]!.category = "commonjs"; },
    ({ module }) => { module.dependencies[0]!.request = "/fixture/app/other.tsx"; },
    ({ state }) => { state.source += "fetch('/extra');"; },
    ({ state }) => { state.source = ""; },
    ({ state }) => { state.source = state.source.replace("eager", "lazy"); },
    ({ state }) => { state.source = "x".repeat(256 * 1024 + 1); },
    ({ state }) => { state.source += "\ud800"; },
  ];
  for (const attack of attacks) { const value = fixture(); attack(value); assert.throws(() => capture(value)); }
});

test("delegated startup CSS cannot hide executable modules or runtime", () => {
  const fixtureWithCss = () => {
    const value = fixture();
    value.compilation.chunks.push(value.css);
    value.group.chunks.splice(1, 0, value.css);
    return value;
  };
  assert.deepEqual(capture(fixtureWithCss()).dependencies.map(({ id }) => id), [500, 474]);
  const attacks: ((value: ReturnType<typeof fixture>) => void)[] = [
    ({ css }) => { css.hasRuntime = () => true; },
    ({ cssModule }) => { cssModule.type = "javascript/auto"; },
    ({ cssModule }) => { cssModule.getSourceTypes = () => new Set(["css/mini-extract", "javascript"]); },
    ({ compilation, css, module }) => { const original = compilation.chunkGraph.getChunkModulesIterable; compilation.chunkGraph.getChunkModulesIterable = (chunk) => chunk === css ? [module] : original(chunk); },
    ({ compilation, css, module }) => { compilation.chunkGraph.getChunkRuntimeModulesIterable = (chunk) => chunk === css ? [module] : []; },
    ({ compilation, css, module, group }) => { const original = compilation.chunkGraph.getChunkEntryModulesWithChunkGroupIterable; compilation.chunkGraph.getChunkEntryModulesWithChunkGroupIterable = (chunk) => chunk === css ? [[module, group]] : original(chunk); },
  ];
  for (const attack of attacks) { const value = fixtureWithCss(); attack(value); assert.throws(() => capture(value)); }
});
