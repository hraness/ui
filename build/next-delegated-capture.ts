import assert from "node:assert/strict";
import { resolve } from "node:path";
import { sha256 } from "./compiler.js";
import { resolveStylexNextOutputPath } from "./next-output.js";
import { parseStylexNextDelegatedEntryLoader, validateStylexNextDelegatedEntryGraph, type StylexNextDelegatedEntryGraphV1 } from "./next-delegated.js";

type Source = Readonly<{ source(): string | Uint8Array }>;
type Module = Readonly<{
  resource?: unknown; request?: unknown; type?: unknown; layer?: unknown;
  dependencies?: unknown; blocks?: unknown;
  loaders?: unknown; originalSource?: () => Source | null;
  getSourceTypes?: () => ReadonlySet<string>;
}>;
type Chunk = Readonly<{ id?: unknown; ids?: unknown; files: Iterable<string>; hasRuntime?: () => boolean }>;
type Group = Readonly<{ chunks: Iterable<Chunk>; parentsIterable: Iterable<Group> }>;
type Entrypoint = Group & Readonly<{ getFiles(): readonly string[]; getRuntimeChunk(): Chunk | null }>;
type Compilation = Readonly<{
  chunks: Iterable<Chunk>;
  entrypoints: ReadonlyMap<string, Entrypoint>;
  asyncEntrypoints: Iterable<Entrypoint>;
  chunkGraph: Readonly<{
    getModuleId(module: Module): unknown;
    getModuleChunksIterable(module: Module): Iterable<Chunk>;
    getChunkModulesIterable(chunk: Chunk): Iterable<Module>;
    getChunkRuntimeModulesIterable(chunk: Chunk): Iterable<Module>;
    getChunkEntryModulesWithChunkGroupIterable(chunk: Chunk): Iterable<readonly [Module, Entrypoint]>;
    getChunkModulesIterableBySourceType(chunk: Chunk, sourceType: string): Iterable<Module> | undefined;
  }>;
}>;
const LOADER = "node_modules/next/dist/build/webpack/loaders/next-flight-client-entry-loader.js" as const;

function bounded<T>(items: Iterable<T>, maximum: number, description: string): T[] {
  const result: T[] = [];
  for (const item of items) {
    assert.ok(result.length < maximum, `${description} exceeds its bound`);
    result.push(item);
  }
  assert.equal(new Set(result).size, result.length, `${description} repeats an item`);
  return result;
}

/** This is the pinned StartupHelpers traversal, including inherited dependOn
 * groups. Exclude only the emitted chunk and the entrypoint's resolved runtime. */
function startupChunks(compilation: Compilation, group: Entrypoint, chunk: Chunk): readonly Chunk[] {
  const initial = bounded(compilation.entrypoints.values(), 4096, "Delegated initial entrypoints");
  const asynchronous = bounded(compilation.asyncEntrypoints, 4096, "Delegated async entrypoints");
  const known = new Set([...initial, ...asynchronous]);
  assert.ok(known.size > 0 && known.size <= 4096 && known.size === initial.length + asynchronous.length);
  assert.ok(known.has(group), "Delegated startup group is not registered");
  for (const entrypoint of known) assert.equal(typeof entrypoint.getRuntimeChunk, "function");
  const groups = new Set<Entrypoint>([group]);
  let edges = 0;
  for (const current of groups) for (const parent of current.parentsIterable) {
    assert.ok(++edges <= 100_000, "Delegated startup parent graph exceeds its bound");
    const registered = known.has(parent as Entrypoint);
    assert.equal(registered, typeof (parent as Partial<Entrypoint>).getRuntimeChunk === "function", "Delegated startup parent registration disagrees");
    if (registered) groups.add(parent as Entrypoint);
  }
  const runtime = group.getRuntimeChunk();
  assert.ok(runtime !== null, "Delegated entry requires its registered runtime chunk");
  const result = new Set<Chunk>();
  for (const current of groups) for (const candidate of bounded(current.chunks, 4096, "Delegated startup chunks")) {
    if (candidate !== chunk && candidate !== runtime) result.add(candidate);
    assert.ok(result.size <= 4096, "Delegated startup closure exceeds its bound");
  }
  return [...result];
}

/** Capture module-free startup code without treating its import-bearing entry
 * module as empty. Final graph validation separately binds real owner maps. */
export function captureStylexNextDelegatedEntryGraph(
  compilation: Compilation,
  chunk: Chunk,
  root: string,
  passOutputRoot: string,
  compilerOutputPath: string,
  outputPath: string,
): StylexNextDelegatedEntryGraphV1 {
  const graph = compilation.chunkGraph;
  assert.ok(typeof chunk.hasRuntime === "function" && chunk.hasRuntime() === false, "Delegated entry cannot be a runtime chunk");
  assert.deepEqual(bounded(graph.getChunkModulesIterable(chunk), 1, "Delegated local modules"), [], "Delegated entry cannot contain local modules");
  assert.deepEqual(bounded(graph.getChunkRuntimeModulesIterable(chunk), 1, "Delegated runtime modules"), [], "Delegated entry cannot contain runtime modules");
  const entries = bounded(graph.getChunkEntryModulesWithChunkGroupIterable(chunk), 1, "Delegated entry modules");
  assert.equal(entries.length, 1, "Delegated entry requires one startup module");
  const [module, group] = entries[0]!;
  assert.ok(bounded(group.chunks, 4096, "Delegated entry group chunks").includes(chunk), "Delegated entry is absent from its startup group");
  assert.equal(module.type, "javascript/auto");
  assert.equal(module.layer, "app-pages-browser");
  assert.ok(module.resource === undefined || module.resource === "", "Delegated entry must be a resource-free loader");
  assert.ok(Array.isArray(module.loaders) && module.loaders.length === 1, "Delegated entry requires only its pinned loader");
  const loader = module.loaders[0] as { loader?: unknown; options?: unknown; ident?: unknown } | null;
  assert.ok(loader !== null && typeof loader === "object" && !Array.isArray(loader));
  assert.equal(loader.loader, resolve(root, LOADER));
  assert.ok(loader.ident === undefined || loader.ident === null, "Delegated entry cannot redirect loader options");
  const parsed = parseStylexNextDelegatedEntryLoader(loader.options, root);
  assert.equal(module.request, `${resolve(root, LOADER)}?${String(loader.options)}!`, "Delegated entry request differs from its direct loader options");
  assert.ok(typeof module.originalSource === "function");
  const source = module.originalSource();
  assert.ok(source !== null);
  const sourceValue = source.source();
  assert.ok(typeof sourceValue === "string" || sourceValue instanceof Uint8Array, "Delegated entry original source must be bytes or text");
  if (typeof sourceValue === "string") assert.ok(!/[\ud800-\udfff]/u.test(sourceValue), "Delegated entry original source contains malformed text");
  assert.ok(Buffer.byteLength(sourceValue) <= 256 * 1024, "Delegated entry original source exceeds its bound");
  const original = Buffer.from(sourceValue);
  assert.deepEqual(original, Buffer.from(parsed.source), "Delegated entry loader source differs from its exact eager import grammar");
  assert.deepEqual(module.blocks, [], "Delegated entry cannot add asynchronous dependency blocks");
  assert.ok(Array.isArray(module.dependencies) && module.dependencies.length === parsed.imports.length, "Delegated entry dependency census differs from its eager imports");
  for (const [index, value] of module.dependencies.entries()) {
    assert.ok(value !== null && typeof value === "object" && !Array.isArray(value));
    const dependency = value as { type?: unknown; category?: unknown; request?: unknown };
    assert.equal(dependency.type, "import() eager", "Delegated entry contains another dependency type");
    assert.equal(dependency.category, "esm");
    assert.equal(dependency.request, resolve(root, parsed.imports[index]!.request), "Delegated entry dependency differs from its loader import");
  }

  const registered = bounded(compilation.chunks, 4096, "Delegated registered chunks");
  assert.ok(registered.includes(chunk), "Delegated entry chunk is not registered");
  const startup = startupChunks(compilation, group, chunk);
  const dependencies = startup.map((candidate) => {
    assert.ok(registered.includes(candidate), "Delegated startup dependency is not registered");
    const emitted = bounded(candidate.files, 4096, "Delegated startup files").map((path) => resolveStylexNextOutputPath(passOutputRoot, compilerOutputPath, path));
    const files = emitted.filter((path) => /\.(?:c|m)?js$/u.test(path)).sort();
    const cssFiles = emitted.filter((path) => path.endsWith(".css")).sort();
    assert.ok(emitted.length > 0 && files.length + cssFiles.length === emitted.length, "Delegated startup contains unsupported output types");
    if (cssFiles.length > 0) {
      const css = bounded(graph.getChunkModulesIterableBySourceType(candidate, "css/mini-extract") ?? [], 100_000, "Delegated startup CSS modules");
      const modules = bounded(graph.getChunkModulesIterable(candidate), 100_000, "Delegated startup module census");
      assert.ok(css.length > 0 && css.every((module) => modules.includes(module)));
      for (const module of css) {
        assert.equal(module.type, "css/mini-extract");
        assert.equal(typeof module.getSourceTypes, "function");
        assert.deepEqual([...module.getSourceTypes!()], ["css/mini-extract"]);
      }
      if (files.length === 0) {
        assert.ok(typeof candidate.hasRuntime === "function" && candidate.hasRuntime() === false);
        assert.deepEqual(bounded(graph.getChunkModulesIterableBySourceType(candidate, "javascript") ?? [], 1, "Delegated CSS JavaScript census"), []);
        assert.deepEqual(bounded(graph.getChunkRuntimeModulesIterable(candidate), 1, "Delegated CSS runtime census"), []);
        assert.deepEqual(bounded(graph.getChunkEntryModulesWithChunkGroupIterable(candidate), 1, "Delegated CSS entry census"), []);
        assert.equal(modules.length, css.length);
        assert.ok(modules.every((module) => css.includes(module)));
      }
    }
    return { cssFiles, files, id: candidate.id };
  });
  const owners = bounded(graph.getModuleChunksIterable(module), 4096, "Delegated entry owner census");
  assert.ok(owners.length > 0, "Delegated entry must have a mapped startup owner");
  const entryOwners = owners.map((owner) => {
    assert.ok(registered.includes(owner) && startup.includes(owner) && owner !== chunk, "Delegated entry owner is outside the registered startup closure");
    assert.ok(bounded(graph.getChunkModulesIterable(owner), 100_000, "Delegated owner module census").includes(module), "Delegated entry ownership is not reciprocal");
    const dependency = dependencies.find(({ id }) => id === owner.id);
    assert.ok(dependency !== undefined && dependency.files.length > 0, "Delegated entry owner must emit JavaScript");
    assert.ok(Number.isSafeInteger(dependency.id) && (dependency.id as number) >= 0);
    return { files: dependency.files, id: dependency.id as number };
  }).sort((left, right) => left.id - right.id);
  const entrypoints = [...compilation.entrypoints].filter(([, entry]) => entry.getFiles().some((file) => resolveStylexNextOutputPath(passOutputRoot, compilerOutputPath, file) === outputPath)).map(([name]) => name).sort();
  return validateStylexNextDelegatedEntryGraph({
    chunkIds: chunk.ids, dependencies, entryModuleId: graph.getModuleId(module), entryOwners, entrypoints,
    imports: parsed.imports, loader: LOADER, originalSource: { bytes: original.byteLength, sha256: sha256(original) },
  });
}
