import assert from "node:assert/strict";
import { describe, test } from "bun:test";

import { sha256 } from "./compiler.js";
import { validateStylexNextDelegatedEntryOwnerMap } from "./next-delegated.js";

const root = "/fixture";
const ownerPath = "static/shared.js";
const source = 'import(/* webpackMode: "eager", webpackExports: ["État"] */ "/fixture/app/é😀.tsx");\n';
const graph = {
  chunkIds: [342],
  dependencies: [{ id: 474, files: [ownerPath], cssFiles: [] }],
  entryModuleId: 2474,
  entryOwners: [{ id: 474, files: [ownerPath] }],
  entrypoints: ["app/delegated/page"],
  imports: [{ request: "app/é😀.tsx", ids: ["État"] }],
  loader: "node_modules/next/dist/build/webpack/loaders/next-flight-client-entry-loader.js",
  originalSource: { bytes: Buffer.byteLength(source), sha256: sha256(source) },
} as const;

const map = {
  version: 3,
  file: ownerPath,
  sources: ["webpack://_N_E/./app/é😀.tsx", "webpack://_N_E/next-flight-client-entry-loader"],
  sourcesContent: [null, source],
  names: ["État", "状态"],
  mappings: "AAAA;ACAA",
};
const bytes = (value: unknown) => Buffer.from(JSON.stringify(value));
const validate = (value: unknown) => validateStylexNextDelegatedEntryOwnerMap(root, graph, ownerPath, bytes(value));

describe("delegated entry owner map", () => {
  test("accepts a mapped owner with the exact eager source and well-formed Unicode", () => {
    assert.doesNotThrow(() => validate(map));
    assert.doesNotThrow(() => validate({ ...map, sourceRoot: "", ignoreList: [0] }));
  });

  test("rejects an unregistered owner and a map naming another output", () => {
    assert.throws(() => validateStylexNextDelegatedEntryOwnerMap(root, graph, "static/unrelated.js", bytes(map)), /registered entry owner/u);
    assert.throws(() => validate({ ...map, file: "static/unrelated.js" }), /another JavaScript output/u);
    assert.throws(() => validate({ ...map, file: `${ownerPath}.map` }), /another JavaScript output/u);
  });

  test("rejects wrong map versions, absent mapping data and non-object maps", () => {
    for (const value of [null, [], "map"]) assert.throws(() => validate(value), /must be an object/u);
    for (const version of [2, "3", null]) assert.throws(() => validate({ ...map, version }), /version 3/u);
    for (const mappings of ["", null, [], "AAAA=", "AAAA\n"]) {
      assert.throws(() => validate({ ...map, mappings }), /mapping data/u);
    }
  });

  test("requires the exact reconstructed source, not merely some loader source", () => {
    for (const sourcesContent of [
      [null, null],
      [null, source.replace("État", "Other")],
      [null, source.replace("/fixture/", "/another-root/")],
      [null, `${source}globalThis.changed = true;\n`],
    ]) assert.throws(() => validate({ ...map, sourcesContent }), /exact eager entry source/u);
    assert.throws(() => validateStylexNextDelegatedEntryOwnerMap("/another-root", graph, ownerPath, bytes(map)), /exact eager entry source/u);
  });

  test("rejects missing, mismatched and malformed source inventories", () => {
    for (const sources of [[], null, [1, "loader"], new Array(100_001).fill("source")]) {
      assert.throws(() => validate({ ...map, sources }), /native source inventory/u);
    }
    for (const sourcesContent of [undefined, [source], [null, source, "extra"], [false, source]]) {
      assert.throws(() => validate({ ...map, sourcesContent }), /embedded sources/u);
    }
    for (const names of [null, [1], new Array(1_000_001).fill("name")]) {
      assert.throws(() => validate({ ...map, names }), /names are invalid/u);
    }
  });

  test("rejects malformed UTF-8 and lone surrogates without losing valid pairs", () => {
    const malformed = Buffer.concat([bytes(map), Buffer.from([0xff])]);
    assert.throws(() => validateStylexNextDelegatedEntryOwnerMap(root, graph, ownerPath, malformed), /exact UTF-8/u);
    for (const surrogate of ["\ud800", "\udc00"]) {
      assert.throws(() => validate({ ...map, sources: [surrogate, "loader"] }), /native source inventory/u);
      assert.throws(() => validate({ ...map, sourcesContent: [surrogate, source] }), /embedded sources/u);
      assert.throws(() => validate({ ...map, names: [surrogate] }), /names are invalid/u);
    }
    assert.throws(() => validateStylexNextDelegatedEntryOwnerMap(root, graph, ownerPath, Buffer.alloc(0)), /byte bound/u);
  });
});
