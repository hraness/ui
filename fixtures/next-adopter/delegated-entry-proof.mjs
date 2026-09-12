import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { basename, resolve } from "node:path";

const routes = ["app/delegated-one/page", "app/delegated-two/page"];
const sha256 = (value) => createHash("sha256").update(value).digest("hex");

function boundedList(iterable, limit, label) {
  const values = [];
  for (const value of iterable) {
    assert.ok(values.length < limit, `${label} exceeds its bound`);
    values.push(value);
  }
  return values;
}

function boundedText(value, limit, label) {
  assert.ok(typeof value === "string" && !/[\ud800-\udfff]/u.test(value)
    && Buffer.byteLength(value) <= limit, `${label} must be bounded exact text`);
  return value;
}

/** Diagnostic facts only. Preserve native concatenation and dependency reasons
 * before the strict zero-module assertion, without retaining source bodies. */
export function captureFixtureTopology(compilation, routeNames, requestShortener) {
  const graph = compilation.chunkGraph;
  const chunks = boundedList(compilation.chunks, 4096, "Native chunks");
  const facts = new Map();
  let sourceBytes = 0;
  function moduleFacts(module) {
    if (facts.has(module)) return facts.get(module);
    assert.ok(facts.size < 4096, "Diagnostic module inventory exceeds its bound");
    const source = module.originalSource();
    let originalSource = null;
    if (source !== null) {
      const declaredSize = source.size();
      assert.ok(Number.isSafeInteger(declaredSize) && declaredSize >= 0 && declaredSize <= 4 * 1024 * 1024);
      const bytes = source.source();
      assert.ok(typeof bytes === "string" || bytes instanceof Uint8Array);
      const length = Buffer.byteLength(bytes);
      assert.ok(length <= 4 * 1024 * 1024 && (sourceBytes += length) <= 64 * 1024 * 1024);
      originalSource = { bytes: length, sha256: sha256(bytes) };
    }
    const size = module.size();
    assert.ok(Number.isFinite(size) && size >= 0);
    const result = {
      id: graph.getModuleId(module),
      identifier: boundedText(module.identifier(), 256 * 1024, "Native module identifier"),
      resource: module.resource === undefined ? null : boundedText(module.resource, 4096, "Native module resource"),
      size, type: module.type, constructor: module.constructor.name,
      owners: boundedList(graph.getModuleChunksIterable(module), 4096, "Native module owners").map((owner) => owner.id),
      originalSource,
      bailouts: boundedList(compilation.moduleGraph.getOptimizationBailout(module), 128, "Concatenation bailouts")
        .map((reason) => boundedText(typeof reason === "function" ? reason(requestShortener) : reason, 16384, "Concatenation bailout")),
      sourceBailout: module.buildInfo?.moduleConcatenationBailout === undefined ? null
        : boundedText(module.buildInfo.moduleConcatenationBailout, 16384, "Source concatenation bailout"),
    };
    facts.set(module, result);
    return result;
  }
  function withRelations(module) {
    return {
      ...moduleFacts(module),
      nestedModules: boundedList(module.modules ?? [], 4096, "Concatenated members").map(moduleFacts),
      dependencies: boundedList(compilation.moduleGraph.getOutgoingConnections(module), 4096, "Native outgoing connections")
        .filter(({ resolvedModule }) => resolvedModule !== null && resolvedModule !== undefined)
        .map(({ resolvedModule, dependency }) => ({
          type: dependency?.type ?? null,
          module: moduleFacts(resolvedModule),
        })),
      loaders: boundedList(module.loaders ?? [], 16, "Native loaders").map(({ loader, options }) => ({
        loader: boundedText(loader, 4096, "Native loader path"),
        options: typeof options === "string" ? boundedText(options, 256 * 1024, "Native loader options") : null,
      })),
    };
  }
  const topology = boundedList(routeNames, 64, "Diagnostic route names").map((name) => {
    const group = compilation.entrypoints.get(name);
    return { name, present: group !== undefined, chunks: chunks.filter((chunk) => boundedList(graph.getChunkEntryModulesWithChunkGroupIterable(chunk), 4096, "Native entries").some(([, entrypoint]) => entrypoint === group)).map((chunk) => ({
      id: chunk.id,
      startupChunks: boundedList(group.chunks, 4096, "Native startup chunks").map((owner) => owner.id),
      modules: boundedList(graph.getChunkModulesIterable(chunk), 4096, "Native local modules").map(withRelations),
      entries: boundedList(graph.getChunkEntryModulesWithChunkGroupIterable(chunk), 4096, "Native entries").map(([entry]) => withRelations(entry)),
      runtimeModules: boundedList(graph.getChunkRuntimeModulesIterable(chunk), 4096, "Native runtime modules").map(moduleFacts),
    })) };
  });
  return topology;
}

/** Fixture coverage only: the production adapter independently validates the
 * complete pinned loader grammar and graph. A nested client import is not a
 * substitute for any of these original server-visible client boundaries. */
export function assertFixtureClientBoundaryImports(entry, root) {
  assert.ok(Array.isArray(entry.loaders) && entry.loaders.length === 1);
  const [loader] = entry.loaders;
  assert.equal(loader.loader, resolve(root, "node_modules/next/dist/build/webpack/loaders/next-flight-client-entry-loader.js"));
  assert.ok(typeof loader.options === "string" && loader.options.length <= 262144);
  const options = new URLSearchParams(loader.options);
  assert.deepEqual(options.getAll("server"), ["false"]);
  assert.ok([...options.keys()].every((key) => key === "modules" || key === "server"));
  const encodedImports = options.getAll("modules");
  assert.ok(encodedImports.length > 0 && encodedImports.length <= 4096);
  const imports = encodedImports.map((value) => {
    const item = JSON.parse(value);
    assert.ok(item !== null && typeof item === "object" && !Array.isArray(item));
    assert.equal(typeof item.request, "string");
    assert.ok(Array.isArray(item.ids) && item.ids.every((id) => typeof id === "string"));
    return item;
  });
  const expected = [
    ["app/shared-history/category-icon.tsx", "HistoryCategoryIcon"],
    ["app/shared-history/history-measure-rail.tsx", "HistoryMeasureRail"],
    ["app/shared-history/history-sticky-offset-sync.tsx", "HistoryStickyOffsetSync"],
  ];
  const local = imports.filter(({ request }) => request.startsWith(`${resolve(root, "app/shared-history")}/`));
  assert.deepEqual(local.map(({ request }) => request).sort(), expected.map(([path]) => resolve(root, path)), "Native fixture entry omitted or changed a direct server-visible client boundary");
  for (const [path, name] of expected) {
    assert.ok(local.find(({ request }) => request === resolve(root, path)).ids.includes(name), `Native fixture entry omitted the named client export ${name}`);
  }
  return expected.map(([path]) => path);
}

/** Independent observation before adapter admission. This plugin never changes
 * webpack modules, optimization, assets or source maps. Missing topology fails. */
export class DelegatedEntryFixtureProof {
  apply(compiler) {
    compiler.hooks.thisCompilation.tap("DelegatedEntryFixtureProof", (compilation) => {
      compilation.hooks.processAssets.tapPromise({
        name: "DelegatedEntryFixtureProof",
        stage: compiler.webpack.Compilation.PROCESS_ASSETS_STAGE_REPORT - 1,
      }, async () => {
        const chunks = [...compilation.chunks];
        assert.ok(chunks.length > 0 && chunks.length <= 4096);
        const attempt = process.env.HRANESS_STYLEX_NEXT_ATTEMPT_DIRECTORY;
        const mode = process.env.HRANESS_STYLEX_NEXT_MODE;
        assert.ok(typeof attempt === "string" && attempt.startsWith(`${resolve(process.cwd(), ".stylex-next")}/`));
        assert.ok(mode === "discovery" || mode === "delivery");
        const attemptId = basename(attempt);
        const directory = resolve(process.cwd(), ".delegated-entry-proof");
        await mkdir(directory, { recursive: true });
        // Preserve actual retained-module facts before a topology assertion can
        // fail. This observation never authorizes a nonempty bootstrap.
        const topology = captureFixtureTopology(compilation, routes, compiler.requestShortener);
        const raw = `${JSON.stringify({ attemptId, mode, topology }, null, 2)}\n`;
        assert.ok(Buffer.byteLength(raw) <= 8 * 1024 * 1024, "Raw diagnostic exceeds its byte bound");
        await writeFile(resolve(directory, `${attemptId}-${mode}-topology.json`), raw, { flag: "wx" });
        const observations = routes.map((name) => {
          const group = compilation.entrypoints.get(name);
          assert.ok(group, `Missing delegated fixture route ${name}`);
          const candidates = chunks.filter((chunk) => [...compilation.chunkGraph.getChunkEntryModulesWithChunkGroupIterable(chunk)].some(([, entrypoint]) => entrypoint === group));
          assert.equal(candidates.length, 1, `Expected one startup chunk for ${name}`);
          const [chunk] = candidates;
          const entries = [...compilation.chunkGraph.getChunkEntryModulesWithChunkGroupIterable(chunk)];
          assert.equal(entries.length, 1);
          const [[entry, entryGroup]] = entries;
          assert.equal(entryGroup, group);
          const clientBoundaryImports = assertFixtureClientBoundaryImports(entry, process.cwd());
          const modules = [...compilation.chunkGraph.getChunkModulesIterable(chunk)];
          assert.equal(modules.length, 0, `Native fixture did not produce a zero-module delegated chunk for ${name}`);
          assert.equal(chunk.hasRuntime(), false);
          assert.deepEqual([...compilation.chunkGraph.getChunkRuntimeModulesIterable(chunk)], []);
          const owners = [...compilation.chunkGraph.getModuleChunksIterable(entry)];
          assert.ok(owners.length > 0 && owners.length <= 4096);
          const ownerProofs = owners.map((owner) => {
            assert.ok(chunks.includes(owner) && owner !== chunk);
            assert.ok([...group.chunks].includes(owner), "Delegated entry owner is absent from the native startup group");
            assert.ok([...compilation.chunkGraph.getChunkModulesIterable(owner)].includes(entry), "Delegated entry ownership is not reciprocal");
            const files = [...owner.files].filter((path) => path.endsWith(".js"));
            assert.ok(files.length > 0);
            return { id: owner.id, files: files.map((path) => {
              const output = compilation.getAsset(path);
              const map = compilation.getAsset(`${path}.map`);
              assert.ok(output && map, "Delegated entry owner must retain its native adjacent source map");
              return { path, sha256: sha256(output.source.source()), mapSha256: sha256(map.source.source()) };
            }) };
          });
          const files = [...chunk.files].filter((path) => path.endsWith(".js"));
          assert.equal(files.length, 1);
          assert.equal(compilation.getAsset(`${files[0]}.map`), undefined);
          const source = compilation.getAsset(files[0]).source.source().toString();
          assert.ok(Buffer.byteLength(source) < 4096);
          return { name, chunkId: chunk.id, entryModuleId: compilation.chunkGraph.getModuleId(entry), clientBoundaryImports, output: files[0], source, owners: ownerProofs };
        });
        const path = resolve(directory, `${attemptId}-${mode}.json`);
        await writeFile(path, `${JSON.stringify({ attemptId, compiler: compilation.name, mode, observations }, null, 2)}\n`, { flag: "wx" });
        console.log(`Native delegated entry ownership proven for ${String(observations.length)} routes: ${path}`);
      });
    });
  }
}
