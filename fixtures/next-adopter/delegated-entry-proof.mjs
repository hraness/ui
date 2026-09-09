import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { basename, resolve } from "node:path";

const routes = ["app/delegated-one/page", "app/delegated-two/page"];
const sha256 = (value) => createHash("sha256").update(value).digest("hex");

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
        const topology = routes.map((name) => {
          const group = compilation.entrypoints.get(name);
          return { name, chunks: chunks.filter((chunk) => [...compilation.chunkGraph.getChunkEntryModulesWithChunkGroupIterable(chunk)].some(([, entrypoint]) => entrypoint === group)).map((chunk) => ({
            id: chunk.id,
            modules: [...compilation.chunkGraph.getChunkModulesIterable(chunk)].map((module) => ({
              id: compilation.chunkGraph.getModuleId(module),
              identifier: module.identifier(),
              size: module.size(),
              owners: [...compilation.chunkGraph.getModuleChunksIterable(module)].map((owner) => owner.id),
              type: module.type,
            })),
          })) };
        });
        await writeFile(resolve(directory, `${attemptId}-${mode}-topology.json`), `${JSON.stringify({ attemptId, mode, topology }, null, 2)}\n`, { flag: "wx" });
        const observations = routes.map((name) => {
          const group = compilation.entrypoints.get(name);
          assert.ok(group, `Missing delegated fixture route ${name}`);
          const candidates = chunks.filter((chunk) => [...compilation.chunkGraph.getChunkEntryModulesWithChunkGroupIterable(chunk)].some(([, entrypoint]) => entrypoint === group));
          assert.equal(candidates.length, 1, `Expected one startup chunk for ${name}`);
          const [chunk] = candidates;
          const modules = [...compilation.chunkGraph.getChunkModulesIterable(chunk)];
          assert.equal(modules.length, 0, `Native fixture did not produce a zero-module delegated chunk for ${name}`);
          assert.equal(chunk.hasRuntime(), false);
          assert.deepEqual([...compilation.chunkGraph.getChunkRuntimeModulesIterable(chunk)], []);
          const entries = [...compilation.chunkGraph.getChunkEntryModulesWithChunkGroupIterable(chunk)];
          assert.equal(entries.length, 1);
          const [[entry, entryGroup]] = entries;
          assert.equal(entryGroup, group);
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
          return { name, chunkId: chunk.id, entryModuleId: compilation.chunkGraph.getModuleId(entry), output: files[0], source, owners: ownerProofs };
        });
        const path = resolve(directory, `${attemptId}-${mode}.json`);
        await writeFile(path, `${JSON.stringify({ attemptId, compiler: compilation.name, mode, observations }, null, 2)}\n`, { flag: "wx" });
        console.log(`Native delegated entry ownership proven for ${String(observations.length)} routes: ${path}`);
      });
    });
  }
}
