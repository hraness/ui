import { stylexNextVersion, type StylexNextVersion } from "./next-profile.js";
import assert from "node:assert/strict";
import { readFile, readdir, realpath } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";

import type { StylexArtifactV1 } from "./contracts.js";
import {
  artifactForFile,
  auditCssWithoutStandaloneRecipes,
  normalizeLogicalPath,
  readStylexPackageManifest,
  sha256,
} from "./compiler.js";
import {
  STYLEX_NEXT_EMPTY_ENTRY_LOADER,
  compareStylexNextStrings,
  defineStylexNextGraphMap,
  parseStylexNextTarget,
  stylexNextDeliveryCssOwnerNames,
  validateStylexNextModuleReceipt,
  validateStylexNextEmptyEntryGraph,
  validateStylexNextEmptyEntryBootstrap,
  type StylexNextEmptyEntryBootstrapV1,
  type StylexNextEmptyEntryGraphV1,
  type StylexNextEntrypointV1,
  type StylexNextGraphMapV1,
  type StylexNextProductionMode,
  type StylexNextTarget,
} from "./next-contracts.js";
import {
  readStylexNextAttemptPlan,
  verifyStylexNextGeneratedEntry,
  writeStylexNextGraphReceipt,
  proveStylexNextFrameworkAsset,
  proveStylexNextEmptyEntryBootstrap,
  proveStylexNextDelegatedEntryBootstrap,
  type StylexNextAttemptHandle,
} from "./next-generation.js";
import { captureStylexNextAuxiliaryTraceAsset } from "./next-auxiliary.js";
import { captureStylexNextDelegatedEntryGraph } from "./next-delegated-capture.js";
import { validateStylexNextDelegatedEntryBootstrap, validateStylexNextDelegatedEntryOwnerMap, type StylexNextDelegatedEntryBootstrapV1, type StylexNextDelegatedEntryGraphV1 } from "./next-delegated.js";
import { resolveStylexNextOutputPath } from "./next-output.js";
export { resolveStylexNextOutputPath } from "./next-output.js";

export type StylexNextPluginOptions = Readonly<{
  attemptDirectory: string;
  graphMap: StylexNextGraphMapV1;
  mode: StylexNextProductionMode;
  outputDirectory: string;
  packageManifests: readonly string[];
  planSha256: string;
  rootDirectory: string;
  stateDirectory: string;
  target: StylexNextTarget;
}>;

type WebpackAssetSource = Readonly<{
  buffer?: () => Uint8Array;
  source(): string | Uint8Array;
}>;

type WebpackAsset = Readonly<{ name: string; source: WebpackAssetSource; info?: unknown }>;
type WebpackModule = Readonly<{
  buildInfo?: unknown;
  resource?: unknown;
  request?: unknown;
  userRequest?: unknown;
  type?: unknown;
  layer?: unknown;
  loaders?: unknown;
  dependencies?: unknown;
  blocks?: unknown;
  getSourceTypes?: () => ReadonlySet<string>;
  nameForCondition?: () => string | null;
  originalSource?: () => (WebpackAssetSource & Readonly<{ map(): unknown }>) | null;
}>;
export type StylexNextWebpackChunk = Readonly<{
  files: Iterable<string>;
  auxiliaryFiles?: Iterable<string>;
  ids?: unknown;
  id?: unknown;
  hasRuntime?: () => boolean;
}>;
type WebpackChunkGroup = Readonly<{
  chunks: Iterable<StylexNextWebpackChunk>;
  parentsIterable: Iterable<WebpackChunkGroup>;
}>;
type WebpackEntrypoint = WebpackChunkGroup & Readonly<{
  getFiles(): readonly string[];
  getRuntimeChunk(): StylexNextWebpackChunk | null;
}>;
type WebpackCompilation = Readonly<{
  asyncEntrypoints: Iterable<WebpackEntrypoint>;
  chunks: Iterable<StylexNextWebpackChunk>;
  chunkGraph: Readonly<{
    getModuleChunksIterable(module: WebpackModule): Iterable<StylexNextWebpackChunk>;
    getChunkModulesIterable(chunk: StylexNextWebpackChunk): Iterable<WebpackModule>;
    getChunkModulesIterableBySourceType(chunk: StylexNextWebpackChunk, sourceType: string): Iterable<WebpackModule> | undefined;
    getChunkRuntimeModulesIterable(chunk: StylexNextWebpackChunk): Iterable<WebpackModule>;
    getChunkEntryModulesWithChunkGroupIterable(chunk: StylexNextWebpackChunk): Iterable<readonly [WebpackModule, WebpackEntrypoint]>;
    getModuleId(module: WebpackModule): unknown;
  }>;
  entrypoints: ReadonlyMap<string, WebpackEntrypoint>;
  getAssets(): readonly WebpackAsset[];
  hooks: Readonly<{
    processAssets: Readonly<{
      tapPromise(options: Readonly<{ name: string; stage: number }>, callback: () => Promise<void>): void;
    }>;
  }>;
  modules: Iterable<WebpackModule>;
}>;
type WebpackCompiler = Readonly<{
  hooks: Readonly<{
    thisCompilation: Readonly<{
      tap(name: string, callback: (compilation: WebpackCompilation) => void): void;
    }>;
  }>;
  outputPath: string;
  webpack: Readonly<{
    Compilation: Readonly<{ PROCESS_ASSETS_STAGE_REPORT: number }>;
    version: string;
  }>;
}>;

function object(value: unknown, description: string): Record<string, unknown> {
  assert.ok(typeof value === "object" && value !== null && !Array.isArray(value), `${description} must be an object`);
  return value as Record<string, unknown>;
}

function options(value: unknown): StylexNextPluginOptions {
  const record = object(value, "StyleX Next plugin options");
  assert.deepEqual(
    Object.keys(record).sort(),
    ["attemptDirectory", "graphMap", "mode", "outputDirectory", "packageManifests", "planSha256", "rootDirectory", "stateDirectory", "target"],
    "StyleX Next plugin options contain unknown or missing keys",
  );
  assert.ok(record.mode === "delivery" || record.mode === "discovery", "StyleX Next plugin mode is invalid");
  assert.ok(typeof record.attemptDirectory === "string" && isAbsolute(record.attemptDirectory), "StyleX Next attemptDirectory must be absolute");
  assert.ok(typeof record.rootDirectory === "string" && isAbsolute(record.rootDirectory), "StyleX Next rootDirectory must be absolute");
  assert.ok(typeof record.planSha256 === "string" && /^[a-f0-9]{64}$/u.test(record.planSha256), "StyleX Next planSha256 is invalid");
  assert.ok(Array.isArray(record.packageManifests) && record.packageManifests.length > 0, "StyleX Next packageManifests must be a nonempty array");
  const packageManifests = record.packageManifests.map((path, index) => normalizeLogicalPath(path, `StyleX Next packageManifests[${String(index)}]`));
  assert.deepEqual(packageManifests, [...packageManifests].sort(), "StyleX Next packageManifests must be sorted");
  assert.equal(new Set(packageManifests).size, packageManifests.length, "StyleX Next packageManifests must be unique");
  return {
    attemptDirectory: resolve(record.attemptDirectory),
    graphMap: defineStylexNextGraphMap(record.graphMap),
    mode: record.mode,
    outputDirectory: normalizeLogicalPath(record.outputDirectory, "StyleX Next outputDirectory"),
    packageManifests,
    planSha256: record.planSha256,
    rootDirectory: resolve(record.rootDirectory),
    stateDirectory: normalizeLogicalPath(record.stateDirectory, "StyleX Next stateDirectory"),
    target: parseStylexNextTarget(record.target, "StyleX Next plugin target"),
  };
}

export function validateStylexNextPluginPlan(
  plan: Awaited<ReturnType<typeof readStylexNextAttemptPlan>>,
  pluginOptions: StylexNextPluginOptions,
): readonly string[] {
  assert.deepEqual(plan.graphMap, pluginOptions.graphMap, "StyleX Next config graph map differs from the verified attempt plan");
  assert.equal(plan.outputDirectory, pluginOptions.outputDirectory, "StyleX Next config output directory differs from the verified attempt plan");
  assert.deepEqual(
    plan.packageManifests.map(({ artifact }) => artifact.path).sort(),
    pluginOptions.packageManifests,
    "StyleX Next config package manifests differ from the verified attempt plan",
  );
  const expectedStateRoot = resolve(pluginOptions.rootDirectory, ...pluginOptions.stateDirectory.split("/"));
  assert.equal(resolve(pluginOptions.attemptDirectory, ".."), expectedStateRoot, "StyleX Next attempt is outside the configured state directory");
  assert.equal(
    relative(expectedStateRoot, pluginOptions.attemptDirectory).split(sep).join("/"),
    plan.attemptId,
    "StyleX Next attempt directory does not match the verified attempt ID",
  );
  return plan.requiredSources[pluginOptions.target];
}

export function validateStylexNextSourceCensus(
  observed: readonly string[],
  expected: readonly string[],
  target: StylexNextTarget,
): void {
  assert.deepEqual(
    observed,
    expected,
    `Next ${target} loader receipt census differs from the verified attempt plan`,
  );
}

export function validateStylexNextCompilationCoverage(
  compiled: readonly string[],
  transformed: readonly string[],
  target: StylexNextTarget,
): void {
  const transformedSet = new Set(transformed);
  assert.deepEqual(
    compiled.filter((path) => !transformedSet.has(path)),
    [],
    `Next ${target} optimized webpack graph contains repository sources without loader receipts`,
  );
}

function bytes(source: WebpackAssetSource): Buffer {
  if (typeof source.buffer === "function") return Buffer.from(source.buffer());
  const value = source.source();
  return typeof value === "string" ? Buffer.from(value) : Buffer.from(value);
}

function outputArtifact(asset: WebpackAsset, passOutputRoot: string, compilerOutputPath: string): StylexArtifactV1 {
  const path = resolveStylexNextOutputPath(passOutputRoot, compilerOutputPath, asset.name);
  const contents = bytes(asset.source);
  return { bytes: contents.byteLength, path, sha256: sha256(contents) };
}

export function stylexNextJavaScriptChunks(
  chunks: Iterable<StylexNextWebpackChunk>,
  passOutputRoot: string,
  compilerOutputPath: string,
): readonly string[] {
  return [...new Set([...chunks].flatMap((chunk) => [...chunk.files])
    .map((path) => resolveStylexNextOutputPath(passOutputRoot, compilerOutputPath, path))
    .filter((path) => /\.(?:c|m)?js$/u.test(path)))].sort();
}

export function requireStylexNextChunkMaps(chunks: readonly string[], outputs: readonly StylexArtifactV1[], nextVersion: StylexNextVersion, bootstraps: readonly StylexNextEmptyEntryBootstrapV1[] = [], delegated: readonly StylexNextDelegatedEntryBootstrapV1[] = []): void {
  stylexNextVersion(nextVersion);
  for (const value of bootstraps) {
    const record = validateStylexNextEmptyEntryBootstrap(value, nextVersion);
    assert.ok(chunks.includes(record.output.path), "Next empty entry cannot leave the chunk inventory");
    assert.deepEqual(outputs.find(({ path }) => path === record.output.path), record.output);
    assert.ok(!outputs.some(({ path }) => path === `${record.output.path}.map`), "Next mapped chunk cannot use the empty entry category");
  }
  assert.equal(new Set(delegated.map(({ output }) => output.path)).size, delegated.length, "Next delegated output claims repeat");
  for (const value of delegated) {
    const record = validateStylexNextDelegatedEntryBootstrap(value, nextVersion);
    assert.ok(chunks.includes(record.output.path), "Next delegated entry cannot leave the chunk inventory");
    assert.deepEqual(outputs.find(({ path }) => path === record.output.path), record.output);
    assert.ok(!outputs.some(({ path }) => path === `${record.output.path}.map`), "Next mapped chunk cannot use the delegated category");
    assert.ok(!bootstraps.some(({ output }) => output.path === record.output.path), "Next delegated entry cannot use the empty category");
    for (const owner of record.graph.entryOwners) for (const path of owner.files) {
      assert.ok(chunks.includes(path) && outputs.some((output) => output.path === path) && outputs.some((output) => output.path === `${path}.map`), "Next delegated entry requires an inventoried mapped owner");
    }
  }
  for (const path of chunks) {
    assert.ok(outputs.some((output) => output.path === path), `Next JavaScript chunk has no emitted asset: ${path}`);
    assert.ok(outputs.some((output) => output.path === `${path}.map`) || bootstraps.some(({ output }) => output.path === path) || delegated.some(({ output }) => output.path === path), `Next JavaScript chunk omitted its external source map: ${path}`);
  }
}

export function assertStylexNextDelegatedEntryOwnerAssets(
  root: string,
  graph: StylexNextDelegatedEntryGraphV1,
  assets: readonly WebpackAsset[],
  passOutputRoot: string,
  compilerOutputPath: string,
): void {
  for (const owner of graph.entryOwners) for (const ownerPath of owner.files) {
    const ownerAssets = assets.filter((asset) => resolveStylexNextOutputPath(passOutputRoot, compilerOutputPath, asset.name) === ownerPath);
    const mapAssets = assets.filter((asset) => resolveStylexNextOutputPath(passOutputRoot, compilerOutputPath, asset.name) === `${ownerPath}.map`);
    assert.equal(ownerAssets.length, 1, "Next delegated owner must have one genuine JavaScript asset");
    assert.equal(mapAssets.length, 1, "Next delegated owner must have one genuine adjacent map");
    const info = ownerAssets[0]!.info as { related?: { sourceMap?: unknown } } | undefined;
    assert.ok(typeof info?.related?.sourceMap === "string", "Next delegated owner has no registered source map relationship");
    assert.equal(resolveStylexNextOutputPath(passOutputRoot, compilerOutputPath, info.related.sourceMap), `${ownerPath}.map`, "Next delegated owner source map relationship differs from its adjacent output");
    validateStylexNextDelegatedEntryOwnerMap(root, graph, ownerPath, bytes(mapAssets[0]!.source));
  }
}

function isWebpackEntrypoint(group: WebpackChunkGroup): group is WebpackEntrypoint {
  return typeof (group as Partial<WebpackEntrypoint>).getRuntimeChunk === "function";
}

/** An Entrypoint's own getFiles() omits files inherited through dependOn.
 * Use the same registered parent closure as webpack's startup dependency walk,
 * preserving Set insertion order and excluding unrelated chunk groups. */
function stylexNextEntrypointClosure(
  compilation: Pick<WebpackCompilation, "asyncEntrypoints" | "entrypoints">,
  entrypoint: WebpackEntrypoint,
): readonly WebpackEntrypoint[] {
  const initialEntrypoints = [...compilation.entrypoints.values()];
  const asyncEntrypoints = [...compilation.asyncEntrypoints];
  const knownEntrypoints = new Set([...initialEntrypoints, ...asyncEntrypoints]);
  assert.ok(knownEntrypoints.size > 0 && knownEntrypoints.size <= 4096, "Next Entrypoint registry exceeds its bound");
  assert.equal(
    knownEntrypoints.size,
    initialEntrypoints.length + asyncEntrypoints.length,
    "Next initial and async Entrypoint registries overlap",
  );
  assert.ok(knownEntrypoints.has(entrypoint), "Next empty entry startup group is not a registered Entrypoint");
  for (const known of knownEntrypoints) {
    assert.ok(isWebpackEntrypoint(known), "Next compilation Entrypoint identity is invalid");
  }
  const queue = new Set<WebpackEntrypoint>([entrypoint]);
  let edges = 0;
  for (const current of queue) {
    for (const parent of current.parentsIterable) {
      assert.ok(++edges <= 100_000, "Next Entrypoint parent graph exceeds its bound");
      const registered = knownEntrypoints.has(parent as WebpackEntrypoint);
      assert.equal(
        registered,
        isWebpackEntrypoint(parent),
        "Next startup parent Entrypoint differs from the compilation registry",
      );
      if (registered) queue.add(parent as WebpackEntrypoint);
    }
  }
  return [...queue];
}

/** Match webpack 5.98.0 StartupHelpers.generateEntryStartup exactly: exclude
 * only the emitted chunk and the current Entrypoint's resolved runtime chunk. */
function stylexNextStartupChunks(
  compilation: Pick<WebpackCompilation, "asyncEntrypoints" | "entrypoints">,
  entrypoint: WebpackEntrypoint,
  emittedChunk: StylexNextWebpackChunk,
): readonly StylexNextWebpackChunk[] {
  const groups = stylexNextEntrypointClosure(compilation, entrypoint);
  const runtimeChunk = entrypoint.getRuntimeChunk();
  assert.ok(runtimeChunk !== null, "Next empty entry startup Entrypoint has no resolved runtime chunk");
  const chunks = new Set<StylexNextWebpackChunk>();
  for (const current of groups) {
    for (const candidate of current.chunks) {
      if (candidate !== emittedChunk && candidate !== runtimeChunk) chunks.add(candidate);
    }
  }
  return [...chunks];
}

/** Capture public webpack graph facts before sealing any map exception. An empty
 * original source alone is insufficient: the loader, options, module graph,
 * startup group and later emitted AST must all agree. */
export function captureStylexNextEmptyEntryGraph(
  compilation: Pick<WebpackCompilation, "asyncEntrypoints" | "chunkGraph" | "entrypoints">,
  chunk: StylexNextWebpackChunk,
  root: string,
  passOutputRoot: string,
  compilerOutputPath: string,
  outputPath: string,
): StylexNextEmptyEntryGraphV1 {
  assert.ok(typeof chunk.hasRuntime === "function" && chunk.hasRuntime() === false, "Next empty entry must not be a runtime chunk");
  assert.deepEqual([...compilation.chunkGraph.getChunkRuntimeModulesIterable(chunk)], [], "Next empty entry contains unexpected runtime modules");
  const modules = [...compilation.chunkGraph.getChunkModulesIterable(chunk)];
  assert.equal(modules.length, 1, "Next empty entry must contain exactly its empty loader module");
  const module = modules[0]!;
  assert.equal(module.type, "javascript/auto", "Next empty entry module type changed");
  assert.equal(module.layer, "app-pages-browser", "Next empty entry module layer changed");
  assert.ok(module.resource === undefined || module.resource === "", "Next empty entry cannot contain a source resource");
  assert.equal(module.request, `${resolve(root, STYLEX_NEXT_EMPTY_ENTRY_LOADER)}?server=false!`, "Next empty entry request must be the exact resource-free loader");
  assert.ok(Array.isArray(module.loaders) && module.loaders.length === 1, "Next empty entry must use only its pinned loader");
  const loader = object(module.loaders[0], "Next empty entry loader");
  assert.equal(loader.loader, resolve(root, STYLEX_NEXT_EMPTY_ENTRY_LOADER), "Next empty entry loader path changed");
  assert.equal(loader.options, "server=false", "Next empty entry loader options contain imports or changed execution");
  assert.ok(loader.ident === undefined || loader.ident === null, "Next empty entry cannot use indirect loader options");
  assert.deepEqual(module.dependencies, [], "Next empty entry cannot have module dependencies");
  assert.deepEqual(module.blocks, [], "Next empty entry cannot have asynchronous blocks");
  assert.ok(typeof module.originalSource === "function");
  const source = module.originalSource();
  assert.ok(source !== null && typeof source.map === "function");
  const original = bytes(source);
  assert.equal(original.byteLength, 0, "Next empty entry original source is not empty");
  assert.equal(source.map(), null, "Next empty entry cannot discard an original source map");
  const entries = [...compilation.chunkGraph.getChunkEntryModulesWithChunkGroupIterable(chunk)];
  assert.ok(entries.length === 1 && entries[0]![0] === module, "Next empty entry startup module differs from the empty loader");
  const group = entries[0]![1];
  assert.ok([...group.chunks].includes(chunk), "Next empty entry is absent from its startup group");
  const dependencies = stylexNextStartupChunks(compilation, group, chunk).map((item) => {
    const emitted = [...item.files].map((file) => resolveStylexNextOutputPath(passOutputRoot, compilerOutputPath, file));
    const files = emitted.filter((file) => /\.(?:c|m)?js$/u.test(file)).sort();
    const cssFiles = emitted.filter((file) => file.endsWith(".css")).sort();
    assert.equal(files.length + cssFiles.length, emitted.length, "Next empty entry startup dependency contains an unsupported output type");
    if (cssFiles.length > 0) {
      const cssModules = [...compilation.chunkGraph.getChunkModulesIterableBySourceType(item, "css/mini-extract") ?? []];
      assert.ok(cssModules.length > 0 && cssModules.length <= 100_000, "Next startup CSS dependency must contain bounded mini-extract modules");
      const modules = [...compilation.chunkGraph.getChunkModulesIterable(item)];
      assert.ok(modules.length <= 100_000 && new Set(modules).size === modules.length, "Next startup CSS dependency module census is not bounded and unique");
      assert.equal(new Set(cssModules).size, cssModules.length, "Next startup CSS dependency repeats a mini-extract module");
      assert.ok(cssModules.every((module) => modules.includes(module)), "Next startup CSS modules are absent from the dependency chunk");
      for (const module of cssModules) {
        assert.equal(module.type, "css/mini-extract", "Next startup CSS dependency has an unexpected module type");
        assert.ok(typeof module.getSourceTypes === "function", "Next startup CSS module must expose its source types");
        assert.deepEqual([...module.getSourceTypes()], ["css/mini-extract"], "Next startup CSS module contains another source type");
      }
      if (files.length === 0) {
        // Native StartupHelpers retains CSS-only IDs in its onChunksLoaded list.
        // Preserve those IDs, but never use a .css filename to hide executable code.
        assert.ok(typeof item.hasRuntime === "function" && item.hasRuntime() === false, "Next CSS-only startup dependency cannot be a runtime chunk");
        assert.deepEqual([...compilation.chunkGraph.getChunkModulesIterableBySourceType(item, "javascript") ?? []], [], "Next CSS-only startup dependency contains hidden JavaScript");
        assert.deepEqual([...compilation.chunkGraph.getChunkRuntimeModulesIterable(item)], [], "Next CSS-only startup dependency contains runtime modules");
        assert.deepEqual([...compilation.chunkGraph.getChunkEntryModulesWithChunkGroupIterable(item)], [], "Next CSS-only startup dependency contains entry modules");
        assert.equal(modules.length, cssModules.length, "Next CSS-only startup dependency contains non-CSS modules");
        assert.ok(modules.every((module) => cssModules.includes(module)), "Next CSS-only startup module census differs from its source types");
      }
    }
    return { cssFiles, files, id: item.id };
  });
  const entrypoints = [...compilation.entrypoints].filter(([, entry]) => entry.getFiles().some((file) => resolveStylexNextOutputPath(passOutputRoot, compilerOutputPath, file) === outputPath)).map(([name]) => name).sort();
  return validateStylexNextEmptyEntryGraph({
    chunkIds: chunk.ids,
    dependencies,
    entryModuleId: compilation.chunkGraph.getModuleId(module),
    entrypoints,
    loader: STYLEX_NEXT_EMPTY_ENTRY_LOADER,
    loaderOptions: "server=false",
    originalSource: { bytes: original.byteLength, sha256: sha256(original) },
  });
}

function cleanResource(value: string): string {
  const query = value.indexOf("?");
  const fragment = value.indexOf("#");
  const end = query === -1 ? fragment : fragment === -1 ? query : Math.min(query, fragment);
  return end === -1 ? value : value.slice(0, end);
}

function logicalResource(root: string, value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const path = cleanResource(value);
  if (!isAbsolute(path)) return undefined;
  const logical = relative(root, path).split(sep).join("/");
  if (logical.length === 0 || logical === ".." || logical.startsWith("../")) return undefined;
  return normalizeLogicalPath(logical, "StyleX Next compilation resource");
}

export function stylexNextCssInputPaths(
  root: string,
  modules: Iterable<WebpackModule>,
): readonly string[] {
  const paths = new Set<string>();
  let count = 0;
  for (const module of modules) {
    assert.ok(++count <= 100_000, "Next CSS input module census exceeds its bounded limit");
    const resource = logicalResource(root, module.resource);
    if (resource?.endsWith(".css")) paths.add(resource);
    if (module.type !== "css/mini-extract") continue;
    // Cached extraction retains CssModules, but need not recreate the ordinary
    // modules evaluated by its CSS loader. This public source identity survives
    // serialization and is also used to prove generated stylesheet ownership.
    assert.equal(typeof module.nameForCondition, "function", "Next extracted CSS omitted its public source identity");
    assert.equal(typeof module.getSourceTypes, "function", "Next extracted CSS omitted its source types");
    assert.deepEqual([...module.getSourceTypes!()], ["css/mini-extract"], "Next extracted CSS contains another source type");
    const source = module.nameForCondition!();
    assert.ok(
      typeof source === "string" && isAbsolute(source) && resolve(source) === source
        && source.endsWith(".css") && !/[?#\0]/u.test(source),
      "Next extracted CSS must identify an exact absolute stylesheet path",
    );
    const logical = logicalResource(root, source);
    assert.ok(logical !== undefined, "Next extracted CSS source escapes the application root");
    if (module.resource !== undefined) {
      assert.equal(module.resource, source, "Next extracted CSS resource conflicts with its public source identity");
    }
    paths.add(logical);
  }
  return [...paths].sort();
}

async function cssInputs(
  root: string,
  modules: Iterable<WebpackModule>,
): Promise<readonly StylexArtifactV1[]> {
  return await Promise.all(stylexNextCssInputPaths(root, modules).map((path) => artifactForFile(root, path)));
}

function repositorySources(
  root: string,
  stateDirectory: string,
  outputDirectory: string,
  modules: Iterable<WebpackModule>,
): readonly string[] {
  const excluded = [stateDirectory, outputDirectory];
  return [...new Set([...modules]
    .map(({ resource }) => logicalResource(root, resource))
    .filter((path): path is string => path !== undefined)
    .filter((path) => /\.[cm]?[jt]sx?$/u.test(path))
    .filter((path) => !path.split("/").includes("node_modules"))
    .filter((path) => !excluded.some((directory) => path === directory || path.startsWith(`${directory}/`))))]
    .sort();
}

export function assertStylexNextAuxiliaryTraceOwnership(
  compilation: Pick<WebpackCompilation, "chunks" | "modules">,
  asset: Pick<WebpackAsset, "name" | "info">,
  compilerOutputPath: string,
): void {
  const target = resolve(compilerOutputPath, asset.name);
  const matches = (name: unknown): boolean => {
    assert.equal(typeof name, "string", "Webpack asset ownership must use string paths");
    return resolve(compilerOutputPath, name as string) === target;
  };
  if (asset.info !== undefined) {
    const info = object(asset.info, "Next dependency trace asset info");
    assert.equal(info.sourceFilename, undefined, "A module resource cannot become auxiliary dependency metadata");
  }
  // Inspect every chunk, not only synchronous entrypoint.getFiles(). Lazy
  // resource emissions are linked output too, and may not waive byte checks.
  for (const chunk of compilation.chunks) {
    assert.ok(![...chunk.files].some(matches), "A chunk output cannot become auxiliary dependency metadata");
    assert.ok(![...chunk.auxiliaryFiles ?? []].some(matches), "A linked chunk auxiliary asset cannot become dependency metadata");
  }
  for (const module of compilation.modules) {
    if (module.buildInfo === undefined) continue;
    const info = object(module.buildInfo, "Webpack module buildInfo");
    if (info.assets !== undefined) {
      assert.ok(!Object.keys(object(info.assets, "Webpack module emitted assets")).some(matches), "A module-emitted resource cannot become auxiliary dependency metadata");
    }
    if (info.assetsInfo !== undefined) {
      assert.ok(info.assetsInfo instanceof Map, "Webpack module assetsInfo must be a Map");
      assert.ok(![...info.assetsInfo.keys()].some(matches), "Module asset metadata cannot become auxiliary dependency metadata");
    }
  }
}

export function stylexNextEntrypointReceipts(
  compilation: WebpackCompilation,
  passOutputRoot: string,
  compilerOutputPath: string,
  generatedCssResource?: string,
): readonly StylexNextEntrypointV1[] {
  const generatedChunks = new Set<StylexNextWebpackChunk>();
  const generatedOwners = generatedCssResource === undefined
    ? new Set<string>()
    : new Set(stylexNextDeliveryCssOwnerNames([...compilation.entrypoints.keys()]));
  if (generatedCssResource !== undefined) {
    const generatedModules = [...compilation.modules].filter(({ resource }) =>
      typeof resource === "string" && cleanResource(resource) === generatedCssResource
    );
    // Next's pinned MiniCssExtractPlugin imports the remaining CSS loader chain
    // as a build-time JavaScript module. It shares the proxy's physical resource
    // but is not a second stylesheet or a browser chunk owner.
    assert.equal(generatedModules.length, 2, "Next delivery client graph must contain exactly the generated CSS proxy and loader evaluation");
    assert.equal(new Set(generatedModules).size, 2, "Next generated CSS module census repeats a module");
    for (const module of generatedModules) {
      assert.equal(module.resource, generatedCssResource, "Next generated CSS module resource must be exact and query-free");
      assert.equal(module.type, "javascript/auto", "Next generated CSS proxy/evaluation module type changed");
    }
    const proxy = generatedModules.find((module) => module.userRequest === generatedCssResource);
    assert.ok(proxy !== undefined && proxy.layer === "app-pages-browser", "Next generated CSS must have one exact App Router proxy");
    const evaluation = generatedModules.find((module) => module !== proxy)!;
    assert.equal(evaluation.layer, null, "Next generated CSS loader evaluation must be layer-free");
    const request = evaluation.userRequest;
    assert.equal(typeof request, "string", "Next generated CSS loader evaluation must expose its request");
    const prefix = `${generatedCssResource}.webpack[javascript/auto]!=!`;
    assert.ok((request as string).startsWith(prefix), "Next generated CSS loader evaluation match resource changed");
    const requestParts = (request as string).slice(prefix.length).split("!");
    assert.equal(requestParts.pop(), generatedCssResource, "Next generated CSS loader evaluation must read the exact stylesheet");
    assert.equal(requestParts.length, 2, "Next generated CSS loader evaluation must contain only the pinned CSS and PostCSS loaders");
    for (const [index, loader] of ["css-loader", "postcss-loader"].entries()) {
      const part = requestParts[index]!;
      const query = part.indexOf("??");
      assert.ok(query > 0 && isAbsolute(part.slice(0, query)), "Next generated CSS evaluation loader must use an absolute path and bound options");
      assert.ok(part.slice(0, query).endsWith(`/node_modules/next/dist/build/webpack/loaders/${loader}/src/index.js`), "Next generated CSS evaluation loader identity changed");
      assert.match(part.slice(query), /^\?\?ruleSet\[\d+\]\.rules\[\d+\]\.oneOf\[\d+\]\.use\[\d+\]$/u, "Next generated CSS evaluation loader options changed");
    }
    assert.deepEqual([...compilation.chunkGraph.getModuleChunksIterable(evaluation)], [], "Next generated CSS build-time evaluation cannot own emitted chunks");
    for (const chunk of stylexNextExtractedCssChunks(compilation, generatedCssResource)) generatedChunks.add(chunk);
    assert.ok(generatedChunks.size > 0, "Generated StyleX CSS module is not associated with an emitted chunk");
  }
  return [...compilation.entrypoints.entries()].map(([name, entrypoint]) => {
    const closure = stylexNextEntrypointClosure(compilation, entrypoint);
    const files = [...new Set(closure.flatMap((group) => group.getFiles()).map((file) => resolveStylexNextOutputPath(
      passOutputRoot,
      compilerOutputPath,
      file,
    )))].sort();
    const css = files.filter((file) => file.endsWith(".css"));
    const ownsGeneratedCss = generatedOwners.has(name);
    const stylexCss = generatedCssResource === undefined || !ownsGeneratedCss
      ? []
      : stylexCssFilesForEntrypoint(
          entrypoint,
          generatedChunks,
          passOutputRoot,
          compilerOutputPath,
          name,
        );
    return {
      css,
      files,
      javascript: files.filter((file) => /\.(?:c|m)?js$/u.test(file)),
      name,
      stylexCss,
    };
  }).sort((left, right) => compareStylexNextStrings(left.name, right.name));
}

/** MiniCssExtractPlugin keeps a JavaScript proxy at `resource`, but Next's CSS
 * chunking plugin moves the extracted module into a distinct CSS-only chunk.
 * Follow the extracted module's public source identity, not the proxy's chunk. */
export function stylexNextExtractedCssChunks(
  compilation: Readonly<{
    modules: Iterable<WebpackModule>;
    chunkGraph: Pick<WebpackCompilation["chunkGraph"], "getModuleChunksIterable">;
  }>,
  generatedCssResource: string,
): ReadonlySet<StylexNextWebpackChunk> {
  assert.ok(isAbsolute(generatedCssResource) && resolve(generatedCssResource) === generatedCssResource, "Generated StyleX CSS resource must be an exact absolute path");
  const extracted = [...compilation.modules].filter((module) => {
    if (module.type !== "css/mini-extract" || typeof module.nameForCondition !== "function") return false;
    const source = module.nameForCondition();
    return typeof source === "string" && source === generatedCssResource;
  });
  assert.ok(extracted.length > 0 && extracted.length <= 4096, "Generated StyleX CSS must have a nonempty bounded extracted-module census");
  assert.equal(new Set(extracted).size, extracted.length, "Generated StyleX CSS repeats an extracted module");
  const chunks = new Set<StylexNextWebpackChunk>();
  for (const module of extracted) {
    assert.ok(typeof module.getSourceTypes === "function", "Generated StyleX CSS module omitted its source types");
    assert.deepEqual([...module.getSourceTypes()], ["css/mini-extract"], "Generated StyleX CSS module contains another source type");
    const owners = [...compilation.chunkGraph.getModuleChunksIterable(module)];
    assert.ok(owners.length > 0 && owners.length <= 4096, "Generated StyleX CSS extracted module has no bounded chunk owner");
    for (const chunk of owners) {
      assert.ok([...chunk.files].some((file) => file.endsWith(".css")), "Generated StyleX CSS extracted module owner emitted no stylesheet");
      chunks.add(chunk);
    }
  }
  assert.ok(chunks.size <= 4096, "Generated StyleX CSS chunk census exceeds its bound");
  return chunks;
}

export function stylexCssFilesForEntrypoint(
  entrypoint: WebpackEntrypoint,
  generatedChunks: ReadonlySet<StylexNextWebpackChunk>,
  passOutputRoot: string,
  compilerOutputPath: string,
  entrypointName: string,
  closure: readonly WebpackEntrypoint[] = [entrypoint],
): readonly string[] {
  assert.ok(closure.includes(entrypoint), "Next entrypoint closure omitted its owner");
  const entrypointChunks = new Set(closure.flatMap((group) => [...group.chunks]));
  const linkedGeneratedChunks = [...generatedChunks].filter((chunk) => entrypointChunks.has(chunk));
  assert.ok(linkedGeneratedChunks.length > 0, `Next delivery entrypoint ${entrypointName} does not include the generated StyleX CSS chunk`);
  const entrypointFiles = new Set(closure.flatMap((group) => group.getFiles()).map((file) => resolveStylexNextOutputPath(
    passOutputRoot,
    compilerOutputPath,
    file,
  )));
  const css = [...new Set(linkedGeneratedChunks.flatMap((chunk) => [...chunk.files]
    .map((file) => resolveStylexNextOutputPath(passOutputRoot, compilerOutputPath, file))
    .filter((file) => file.endsWith(".css"))))].sort();
  assert.ok(css.length > 0, `Next delivery entrypoint ${entrypointName} generated StyleX chunk emitted no CSS`);
  assert.ok(css.every((file) => entrypointFiles.has(file)), `Next delivery entrypoint ${entrypointName} does not link its generated StyleX CSS files`);
  return css;
}

async function expectedPackageCss(
  root: string,
  attempt: StylexNextAttemptHandle,
): Promise<Readonly<{
  foundations: readonly string[];
  manifests: readonly Awaited<ReturnType<typeof readStylexPackageManifest>>[];
  standalone: readonly string[];
}>> {
  const plan = await readStylexNextAttemptPlan(attempt);
  const manifests = await Promise.all(plan.packageManifests.map(async ({ artifact }) => {
    const manifestPath = resolve(root, ...artifact.path.split("/"));
    return await readStylexPackageManifest(manifestPath, resolve(manifestPath, "../.."));
  }));
  const foundations = plan.packageManifests.map(({ artifact }, index) => {
    const packageRoot = relative(root, resolve(root, ...artifact.path.split("/"), "../..")).split(sep).join("/");
    return normalizeLogicalPath(`${packageRoot}/${manifests[index]!.compilerFoundation}`, "StyleX Next package compiler foundation");
  }).sort();
  const standalone = plan.packageManifests.map(({ artifact }, index) => {
    const packageRoot = relative(root, resolve(root, ...artifact.path.split("/"), "../..")).split(sep).join("/");
    return normalizeLogicalPath(`${packageRoot}/${manifests[index]!.standaloneCss.path}`, "StyleX Next package standalone CSS");
  }).sort();
  return { foundations, manifests, standalone };
}

async function verifyCssGraph(
  root: string,
  attempt: StylexNextAttemptHandle,
  mode: StylexNextProductionMode,
  target: StylexNextTarget,
  inputs: readonly StylexArtifactV1[],
): Promise<void> {
  const packageCss = await expectedPackageCss(root, attempt);
  const paths = inputs.map(({ path }) => path);
  const generated = normalizeLogicalPath(
    relative(root, resolve(attempt.directory, "generated/stylex.css")).split(sep).join("/"),
    "StyleX Next generated CSS",
  );
  const generatedInputs = inputs.filter(({ path }) => path === generated);
  if (mode === "delivery" && target === "client") {
    assert.equal(generatedInputs.length, 1, "Next delivery client graph must contain exactly one generated StyleX CSS input");
  } else {
    assert.equal(generatedInputs.length, 0, "Only the Next delivery client graph may contain generated StyleX CSS");
  }
  assert.ok(!paths.some((path) => packageCss.standalone.includes(path)), "Next compiler graph imported standalone package StyleX CSS");
  for (const input of inputs) {
    if (mode === "delivery" && target === "client" && input.path === generated) continue;
    auditCssWithoutStandaloneRecipes(
      await readFile(resolve(root, ...input.path.split("/")), "utf8"),
      packageCss.manifests,
      `Next ${mode} ${target} CSS input ${input.path}`,
    );
  }
  if (target === "client") {
    for (const foundation of packageCss.foundations) {
      assert.ok(paths.includes(foundation), `Next client graph omitted compiler foundation ${foundation}`);
    }
    if (mode === "delivery") {
      const plan = await readStylexNextAttemptPlan(attempt);
      assert.ok(paths.includes(generated), "Next delivery client graph omitted generated StyleX CSS");
      stylexNextVersion(plan.nextVersion);
    }
  }
}

export class StylexNextWebpackPlugin {
  readonly #options: StylexNextPluginOptions;

  constructor(value: StylexNextPluginOptions) {
    this.#options = options(value);
  }

  apply(compiler: WebpackCompiler): void {
    const pluginName = `HranessStylexNextPlugin:${this.#options.mode}:${this.#options.target}`;
    assert.ok(typeof compiler.webpack?.version === "string" && /^5\./u.test(compiler.webpack.version), "StyleX Next requires webpack 5 and rejects Rspack or an unknown compiler");
    compiler.hooks.thisCompilation.tap(pluginName, (compilation) => {
      compilation.hooks.processAssets.tapPromise(
        { name: pluginName, stage: compiler.webpack.Compilation.PROCESS_ASSETS_STAGE_REPORT },
        async () => {
          const root = await realpath(this.#options.rootDirectory);
          assert.equal(root, this.#options.rootDirectory, "StyleX Next rootDirectory must not traverse a symlink");
          const attempt: StylexNextAttemptHandle = {
            directory: this.#options.attemptDirectory,
            planSha256: this.#options.planSha256,
          };
          const plan = await readStylexNextAttemptPlan(attempt);
          const requiredSources = validateStylexNextPluginPlan(plan, this.#options);
          if (this.#options.mode === "delivery" && this.#options.target === "client") {
            await verifyStylexNextGeneratedEntry(attempt);
          }
          const passOutputDirectory = this.#options.mode === "delivery"
            ? this.#options.outputDirectory
            : normalizeLogicalPath(relative(root, resolve(attempt.directory, "next-discovery")).split(sep).join("/"), "StyleX Next discovery output directory");
          const passOutputRoot = resolve(root, ...passOutputDirectory.split("/"));
          const compilerOutputPath = resolve(compiler.outputPath);
          resolveStylexNextOutputPath(passOutputRoot, compilerOutputPath, "__output-path-probe__");
          const compiledSources = repositorySources(root, this.#options.stateDirectory, this.#options.outputDirectory, compilation.modules);
          const moduleDirectory = resolve(attempt.directory, this.#options.mode, this.#options.target, "modules");
          const moduleNames = (await readdir(moduleDirectory)).filter((name) => name.endsWith(".json"));
          const receiptSources = (await Promise.all(moduleNames.map(async (name) => {
            const raw: unknown = JSON.parse(await readFile(resolve(moduleDirectory, name), "utf8"));
            return validateStylexNextModuleReceipt(raw).input.path;
          }))).sort();
          // Next may remove a transformed module from compilation.modules during
          // production optimization. The per-attempt loader receipts are the exact
          // pre-optimization source census; the settled webpack graph must remain a
          // subset so an untransformed repository source can never enter an output.
          validateStylexNextSourceCensus(receiptSources, requiredSources, this.#options.target);
          validateStylexNextCompilationCoverage(compiledSources, receiptSources, this.#options.target);
          const stylesheets = await cssInputs(root, compilation.modules);
          await verifyCssGraph(root, attempt, this.#options.mode, this.#options.target, stylesheets);
          const assets = compilation.getAssets();
          const outputs = assets.map((asset) => outputArtifact(
            asset,
            passOutputRoot,
            compilerOutputPath,
          )).sort((left, right) => compareStylexNextStrings(left.path, right.path));
          const maps = outputs.filter(({ path }) => path.endsWith(".map"));
          const javascriptChunks = stylexNextJavaScriptChunks(compilation.chunks, passOutputRoot, compilerOutputPath);
          const emptyEntryBootstraps: StylexNextEmptyEntryBootstrapV1[] = [];
          const delegatedEntryBootstraps: StylexNextDelegatedEntryBootstrapV1[] = [];
          for (const path of javascriptChunks.filter((path) => !maps.some((map) => map.path === `${path}.map`))) {
            assert.equal(this.#options.target, "client", `Next non-client JavaScript chunk omitted its map: ${path}`);
            const chunks = [...compilation.chunks].filter((chunk) => [...chunk.files].some((file) => resolveStylexNextOutputPath(passOutputRoot, compilerOutputPath, file) === path));
            assert.ok(chunks.length > 0);
            const output = outputs.find((output) => output.path === path)!;
            const asset = assets.find((asset) => resolveStylexNextOutputPath(passOutputRoot, compilerOutputPath, asset.name) === path)!;
            // Distinct observed topologies, with no fallback between proofs.
            // The old path still requires exactly its original empty loader.
            const moduleFree = chunks.map((chunk) => compilation.chunkGraph.getChunkModulesIterable(chunk)[Symbol.iterator]().next().done === true);
            assert.ok(moduleFree.every((value) => value === moduleFree[0]), "Next mapless asset has conflicting chunk categories");
            if (moduleFree[0]) {
              const graphs = chunks.map((chunk) => captureStylexNextDelegatedEntryGraph(compilation, chunk, root, passOutputRoot, compilerOutputPath, path));
              for (const graph of graphs) assert.deepEqual(graph, graphs[0], "Next delegated asset has conflicting chunk owners");
              const graph = graphs[0]!;
              assertStylexNextDelegatedEntryOwnerAssets(root, graph, assets, passOutputRoot, compilerOutputPath);
              delegatedEntryBootstraps.push(await proveStylexNextDelegatedEntryBootstrap(root, this.#options.target, graph, output, bytes(asset.source), plan.nextVersion));
            } else {
              const graphs = chunks.map((chunk) => captureStylexNextEmptyEntryGraph(compilation, chunk, root, passOutputRoot, compilerOutputPath, path));
              for (const graph of graphs) assert.deepEqual(graph, graphs[0], "Next empty entry asset has conflicting chunk owners");
              emptyEntryBootstraps.push(await proveStylexNextEmptyEntryBootstrap(root, this.#options.target, graphs[0]!, output, bytes(asset.source), plan.nextVersion));
            }
          }
          requireStylexNextChunkMaps(javascriptChunks, outputs, plan.nextVersion, emptyEntryBootstraps, delegatedEntryBootstraps);
          const frameworkAssets = await Promise.all(outputs
            .filter(({ path }) => /\.(?:c|m)?js$/u.test(path) && !javascriptChunks.includes(path) && !maps.some((map) => map.path === `${path}.map`))
            .map(async (output) => {
              const asset = assets.find((asset) => resolveStylexNextOutputPath(passOutputRoot, compilerOutputPath, asset.name) === output.path);
              assert.ok(asset !== undefined);
              return await proveStylexNextFrameworkAsset(root, this.#options.target, output, bytes(asset.source), plan.nextVersion);
            }));
          frameworkAssets.sort((left, right) => compareStylexNextStrings(left.output.path, right.output.path));
          for (const map of maps) {
            assert.ok(outputs.some(({ path }) => path === map.path.slice(0, -4)), `Next source map has no output asset: ${map.path}`);
          }
          const generatedCssResource = this.#options.mode === "delivery" && this.#options.target === "client"
            ? resolve(attempt.directory, "generated/stylex.css")
            : undefined;
          const entries = stylexNextEntrypointReceipts(compilation, passOutputRoot, compilerOutputPath, generatedCssResource);
          // Next settles dependency traces after webpack. They remain in the
          // original output inventory, but are observation-only metadata, not
          // an exemption for transformed code, CSS, maps, or linked assets.
          const auxiliaryTraceAssets = await Promise.all(outputs.filter(({ path }) => path.endsWith(".nft.json")).map(async (output) => {
            assert.equal(this.#options.target, "node-rsc", "Only a registered Node server entry may own auxiliary dependency metadata");
            const entry = entries.find(({ name, files }) => output.path === `server/${name}.js.nft.json` && files.includes(`server/${name}.js`));
            assert.ok(entry !== undefined && javascriptChunks.includes(`server/${entry.name}.js`), `Next dependency trace has no registered server JavaScript entry: ${output.path}`);
            const asset = assets.find((asset) => resolveStylexNextOutputPath(passOutputRoot, compilerOutputPath, asset.name) === output.path);
            assert.ok(asset !== undefined);
            assertStylexNextAuxiliaryTraceOwnership(compilation, asset, compilerOutputPath);
            return await captureStylexNextAuxiliaryTraceAsset(root, entry.name, output, bytes(asset.source), plan.nextVersion);
          }));
          await writeStylexNextGraphReceipt({
            attempt,
            auxiliaryTraceAssets,
            cssInputs: stylesheets,
            delegatedEntryBootstraps,
            entrypoints: entries,
            emptyEntryBootstraps,
            frameworkAssets,
            javascriptChunks,
            mode: this.#options.mode,
            outputDirectory: passOutputDirectory,
            outputs,
            rootDirectory: root,
            sourceMaps: maps,
            target: this.#options.target,
            webpackVersion: compiler.webpack.version,
          });
        },
      );
    });
  }
}
