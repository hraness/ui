import assert from "node:assert/strict";
import { test } from "bun:test";
import { compilerSha256, sha256, stylexRulesSha256 } from "./compiler.js";
import { STYLEX_NEXT_ADAPTER_VERSION, validateStylexNextGraphReceipt } from "./next-contracts.js";
import { stylexNextProfile } from "./next-profile.js";
import { stylexNextDelegatedEntrySource } from "./next-delegated.js";

function fixture() {
  const artifact = (path: string, source: string) => ({ path, bytes: Buffer.byteLength(source), sha256: sha256(source) });
  const imports = [{ request: "app/client.tsx", ids: ["ClientProof"] }];
  const source = stylexNextDelegatedEntrySource("/fixture", imports);
  const output = artifact("static/delegated.js", "(self.webpackChunk_N_E=self.webpackChunk_N_E||[]).push([[342],{},_=>{_.O(0,[474],()=>_(_.s=2474)),_N_E=_.O()}]);");
  const owner = artifact("static/shared.js", "mapped-owner");
  const map = artifact("static/shared.js.map", "native-map");
  const modules = [{ path: "app/client.tsx", receiptSha256: sha256("client-source-receipt") }];
  const proof = {
    graph: {
      chunkIds: [342], dependencies: [{ id: 474, files: [owner.path], cssFiles: [] }],
      entryModuleId: 2474, entryOwners: [{ id: 474, files: [owner.path] }],
      entrypoints: ["app/delegated/page"], imports,
      loader: "node_modules/next/dist/build/webpack/loaders/next-flight-client-entry-loader.js",
      originalSource: { bytes: Buffer.byteLength(source), sha256: sha256(source) },
    },
    inputs: stylexNextProfile("16.2.12").emptyEntryInputs.map(([path, sha256]) => ({ path: `node_modules/next/${path}`, bytes: 1, sha256 })),
    output,
  };
  const javascript = [output.path, owner.path];
  return {
    adapterVersion: STYLEX_NEXT_ADAPTER_VERSION, attemptId: "delegated-fixture", auxiliaryTraceAssets: [], compilerSha256,
    cssInputs: [], delegatedEntryBootstraps: [proof], emptyEntryBootstraps: [],
    entrypoints: [{ css: [], files: javascript, javascript, name: "app/delegated/page", stylexCss: [] }],
    frameworkAssets: [], graphId: "client", javascriptChunks: javascript, kind: "hraness-stylex-next-graph",
    mode: "discovery", modules, nextVersion: "16.2.12", outputDirectory: ".next", outputs: [output, owner, map],
    packages: [], rules: [], rulesSha256: stylexRulesSha256([]), schemaVersion: 1,
    sourceMaps: [map], sourcesSha256: sha256(JSON.stringify(modules)), target: "client", webpackVersion: "5.98.0",
  };
}

test("Next graph admits a delegated bootstrap only with registered mapped startup ownership", () => {
  const graph = fixture();
  assert.deepEqual(validateStylexNextGraphReceipt(graph), graph);
});

test("Next graph rejects missing, detached or changed delegated owner/map inventories", () => {
  const graph = fixture();
  const proof = graph.delegatedEntryBootstraps[0]!;
  for (const changed of [
    { ...graph, delegatedEntryBootstraps: [] },
    { ...graph, sourceMaps: [] },
    { ...graph, outputs: graph.outputs.filter(({ path }) => !path.endsWith(".map")) },
    { ...graph, outputs: graph.outputs.filter(({ path }) => path !== "static/shared.js") },
    { ...graph, sourceMaps: [{ ...graph.sourceMaps[0]!, sha256: sha256("changed") }] },
    { ...graph, javascriptChunks: [proof.output.path] },
    { ...graph, entrypoints: [{ ...graph.entrypoints[0]!, files: [proof.output.path], javascript: [proof.output.path] }] },
    { ...graph, delegatedEntryBootstraps: [proof, proof] },
    { ...graph, delegatedEntryBootstraps: [{ ...proof, output: { ...proof.output, sha256: sha256("changed") } }] },
    { ...graph, delegatedEntryBootstraps: [{ ...proof, graph: { ...proof.graph, entrypoints: ["app/other/page"] } }] },
    { ...graph, target: "node-rsc" },
    { ...graph, adapterVersion: "hraness-stylex-next-v2" },
  ]) assert.throws(() => validateStylexNextGraphReceipt(changed));
  const missing = { ...graph } as Record<string, unknown>;
  delete missing.delegatedEntryBootstraps;
  assert.throws(() => validateStylexNextGraphReceipt(missing), "Next v3 requires a fresh receipt, not an implicit old-record conversion");
});
