import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, realpath, rm, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, test } from "bun:test";

import { artifactForFile, sha256 } from "./compiler.js";
import {
  proveStylexNextDelegatedEntryBootstrap,
  verifySettledStylexNextDelegatedEntryBootstrap,
} from "./next-generation.js";
import { STYLEX_NEXT_EMPTY_ENTRY_INPUTS } from "./next-profile.js";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function createFixture() {
  const root = await realpath(await mkdtemp(join(tmpdir(), "ui-next-delegated-settlement-")));
  roots.push(root);
  for (const [path, hash] of STYLEX_NEXT_EMPTY_ENTRY_INPUTS) {
    const original = await readFile(new URL(`../node_modules/next/${path}`, import.meta.url));
    assert.equal(sha256(original), hash, "fixture must use the installed pinned Next creator bytes");
    const destination = join(root, "node_modules/next", path);
    await mkdir(dirname(destination), { recursive: true });
    await writeFile(destination, original);
  }
  await writeFile(join(root, "node_modules/next/package.json"), '{"name":"next","version":"16.2.12"}');
  const original = `import(/* webpackMode: "eager", webpackExports: ["ClientProof"] */ ${JSON.stringify(join(root, "app/client.tsx"))});\n`;
  const ownerFiles = ["static/shared-a.js", "static/shared-b.js"];
  const graph = {
    chunkIds: [342],
    dependencies: [{ id: 474, files: ownerFiles, cssFiles: [] }],
    entryModuleId: 2474,
    entryOwners: [{ id: 474, files: ownerFiles }],
    entrypoints: ["app/delegated/page"],
    imports: [{ request: "app/client.tsx", ids: ["ClientProof"] }],
    loader: "node_modules/next/dist/build/webpack/loaders/next-flight-client-entry-loader.js",
    originalSource: { bytes: Buffer.byteLength(original), sha256: sha256(original) },
  } as const;
  const source = Buffer.from("(self.webpackChunk_N_E=self.webpackChunk_N_E||[]).push([[342],{},_=>{_.O(0,[474],()=>_(_.s=2474)),_N_E=_.O()}]);");
  const path = "static/delegated.js";
  const outputRoot = join(root, ".next");
  await mkdir(join(outputRoot, "static"), { recursive: true });
  await writeFile(join(outputRoot, path), source);
  const ownerMap = (file: string) => ({
    version: 3, file, mappings: "AAAA", names: [],
    sources: ["webpack://_N_E/next-flight-client-entry-loader"], sourcesContent: [original],
  });
  for (const file of ownerFiles) {
    await writeFile(join(outputRoot, file), "/* synthetic mapped owner; native execution is a separate gate */\n");
    await writeFile(join(outputRoot, `${file}.map`), JSON.stringify(ownerMap(file)));
  }
  const output = await artifactForFile(outputRoot, path);
  const record = await proveStylexNextDelegatedEntryBootstrap(root, "client", graph, output, source);
  const verify = () => verifySettledStylexNextDelegatedEntryBootstrap(root, outputRoot, "client", record);
  return { root, outputRoot, graph, source, path, output, record, ownerFiles, ownerMap, verify };
}

describe("delegated entry proof settlement", () => {
  test("proves exact output and installed creator bytes, then revalidates every adjacent owner map", async () => {
    const fixture = await createFixture();
    assert.deepEqual(fixture.record.graph, fixture.graph);
    assert.deepEqual(fixture.record.output, fixture.output);
    assert.deepEqual(fixture.record.inputs.map(({ path, sha256 }) => [path, sha256]), STYLEX_NEXT_EMPTY_ENTRY_INPUTS.map(([path, hash]) => [`node_modules/next/${path}`, hash]));
    assert.ok(fixture.record.inputs.every(({ bytes }) => bytes > 0));
    await fixture.verify();
  });

  test("rejects non-client targets, another version and false output or loader source identities", async () => {
    const { root, graph, output, source } = await createFixture();
    for (const target of ["node-rsc", "edge-rsc"] as const) {
      await assert.rejects(proveStylexNextDelegatedEntryBootstrap(root, target, graph, output, source), /Only Next client/u);
    }
    await assert.rejects(proveStylexNextDelegatedEntryBootstrap(root, "client", graph, output, source, "16.3.3"), /package version changed/u);
    for (const changed of [{ ...output, sha256: sha256("wrong") }, { ...output, bytes: output.bytes + 1 }]) {
      await assert.rejects(proveStylexNextDelegatedEntryBootstrap(root, "client", graph, changed, source), /output bytes changed/u);
    }
    await assert.rejects(proveStylexNextDelegatedEntryBootstrap(root, "client", { ...graph, originalSource: { ...graph.originalSource, sha256: sha256("arbitrary loader") } }, output, source), /pinned eager loader grammar/u);
    await assert.rejects(proveStylexNextDelegatedEntryBootstrap(root, "client", { ...graph, imports: [{ request: "app/another.tsx", ids: ["ClientProof"] }] }, output, source), /pinned eager loader grammar/u);
  });

  test("rejects bootstrap drift even if its artifact is rehashed", async () => {
    const fixture = await createFixture();
    const changed = Buffer.concat([fixture.source, Buffer.from("globalThis.changed = true;")]);
    await writeFile(join(fixture.outputRoot, fixture.path), changed);
    await assert.rejects(fixture.verify(), /output changed after compilation/u);
    const forged = { ...fixture.record, output: await artifactForFile(fixture.outputRoot, fixture.path) };
    await assert.rejects(verifySettledStylexNextDelegatedEntryBootstrap(fixture.root, fixture.outputRoot, "client", forged));
    await writeFile(join(fixture.outputRoot, fixture.path), fixture.source);
    await fixture.verify();
  });

  test("rejects malformed UTF-8 before accepting a correctly hashed payload", async () => {
    const { root, graph, output, source } = await createFixture();
    const malformed = Buffer.concat([source, Buffer.from([0xff])]);
    const changed = { ...output, bytes: malformed.byteLength, sha256: sha256(malformed) };
    await assert.rejects(proveStylexNextDelegatedEntryBootstrap(root, "client", graph, changed, malformed), /exact UTF-8/u);
  });

  test("rechecks each pinned creator and its recorded byte count at settlement", async () => {
    const fixture = await createFixture();
    for (const creator of fixture.record.inputs) {
      const path = join(fixture.root, creator.path);
      const original = await readFile(path);
      await writeFile(path, Buffer.concat([original, Buffer.from("\n/* drift */\n")]));
      await assert.rejects(fixture.verify(), /creator differs from pinned original bytes/u);
      await writeFile(path, original);
      const inputs = fixture.record.inputs.map((input) => input.path === creator.path ? { ...input, bytes: input.bytes + 1 } : input);
      await assert.rejects(verifySettledStylexNextDelegatedEntryBootstrap(fixture.root, fixture.outputRoot, "client", { ...fixture.record, inputs }), /provenance changed after compilation/u);
    }
    await fixture.verify();
    await writeFile(join(fixture.root, "node_modules/next/package.json"), '{"name":"next","version":"16.3.3"}');
    await assert.rejects(fixture.verify(), /package version changed/u);
  });

  test("rejects missing creators and missing or misnamed owner maps", async () => {
    const fixture = await createFixture();
    const creator = fixture.record.inputs[0]!;
    const creatorPath = join(fixture.root, creator.path);
    const original = await readFile(creatorPath);
    await unlink(creatorPath);
    await assert.rejects(fixture.verify(), /ENOENT/u);
    await writeFile(creatorPath, original);
    for (const file of fixture.ownerFiles) {
      const path = join(fixture.outputRoot, `${file}.map`);
      const originalMap = await readFile(path);
      await unlink(path);
      await assert.rejects(fixture.verify(), /ENOENT/u);
      await writeFile(path, JSON.stringify({ ...fixture.ownerMap(file), file: "static/another.js" }));
      await assert.rejects(fixture.verify(), /another JavaScript output/u);
      await writeFile(path, originalMap);
    }
    await fixture.verify();
  });

  test("rejects owner source and encoding drift after an initially valid proof", async () => {
    const fixture = await createFixture();
    for (const file of fixture.ownerFiles) {
      const path = join(fixture.outputRoot, `${file}.map`);
      const original = await readFile(path);
      await writeFile(path, JSON.stringify({ ...fixture.ownerMap(file), sourcesContent: ["import('/unregistered');"] }));
      await assert.rejects(fixture.verify(), /exact eager entry source/u);
      await writeFile(path, Buffer.concat([original, Buffer.from([0xff])]));
      await assert.rejects(fixture.verify(), /exact UTF-8/u);
      await writeFile(path, original);
    }
    await fixture.verify();
  });
});
