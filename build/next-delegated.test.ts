import assert from "node:assert/strict";
import { test } from "bun:test";
import { sha256 } from "./compiler.js";
import { STYLEX_NEXT_PRODUCTION_VERSIONS, stylexNextProfile } from "./next-profile.js";
import {
  parseStylexNextDelegatedEntryLoader,
  stylexNextDelegatedEntrySource,
  validateStylexNextDelegatedEntryBootstrap,
  validateStylexNextDelegatedEntryGraph,
  validateStylexNextDelegatedEntryPayload,
} from "./next-delegated.js";

const options = new URLSearchParams([
  ["modules", JSON.stringify({ request: "/fixture/app/client.tsx", ids: ["ClientProof"] })],
  ["server", "false"],
]).toString();
const source = 'import(/* webpackMode: "eager", webpackExports: ["ClientProof"] */ "/fixture/app/client.tsx");\n';
const graph = {
  chunkIds: [342],
  dependencies: [{ id: 474, files: ["static/shared.js"], cssFiles: [] }],
  entryModuleId: 2474,
  entryOwners: [{ id: 474, files: ["static/shared.js"] }],
  entrypoints: ["app/delegated/page"],
  imports: [{ request: "app/client.tsx", ids: ["ClientProof"] }],
  loader: "node_modules/next/dist/build/webpack/loaders/next-flight-client-entry-loader.js",
  originalSource: { bytes: Buffer.byteLength(source), sha256: sha256(source) },
} as const;
const code = "(self.webpackChunk_N_E=self.webpackChunk_N_E||[]).push([[342],{},_=>{_.O(0,[474],()=>_(_.s=2474)),_N_E=_.O()}]);";

test("delegated loader parser preserves eager import semantics and canonical logical identities", () => {
  assert.deepEqual(parseStylexNextDelegatedEntryLoader(options, "/fixture"), { imports: graph.imports, source });
  assert.equal(stylexNextDelegatedEntrySource("/fixture", graph.imports), source);
  const unicode = new URLSearchParams([["modules", JSON.stringify({ request: "/fixture/app/é😀.tsx", ids: ["État", "状态"] })], ["server", "false"]]).toString();
  assert.deepEqual(parseStylexNextDelegatedEntryLoader(unicode, "/fixture").imports, [{ request: "app/é😀.tsx", ids: ["État", "状态"] }]);
  for (const ids of [[], ["*"], ["*", "ClientProof"], ["default"], ["$name", "_name"]]) {
    const value = new URLSearchParams([["modules", JSON.stringify({ request: "/fixture/app/client.tsx", ids })], ["server", "false"]]).toString();
    const actual = parseStylexNextDelegatedEntryLoader(value, "/fixture");
    assert.deepEqual(actual.imports, [{ request: "app/client.tsx", ids }]);
    assert.equal(actual.source.includes("webpackExports"), ids.length > 0 && !ids.includes("*"));
  }
});

test("delegated loader parser rejects ambiguous options, escaping requests and malformed exports", () => {
  for (const value of ["", "server=false", options + "&server=false", options + "&extra=true", options.replace("false", "true"), options + "&modules=%GG", options + "&modules=%FF", "x".repeat(256 * 1024 + 1)]) {
    assert.throws(() => parseStylexNextDelegatedEntryLoader(value, "/fixture"));
  }
  for (const import_ of [
    { request: "app/client.tsx", ids: [] }, { request: "/elsewhere/client.tsx", ids: [] },
    { request: "/fixture/app/../client.tsx", ids: [] }, { request: "/fixture/app/client.tsx?other", ids: [] },
    { request: "/fixture/app/client.tsx", ids: ["x", "x"] }, { request: "/fixture/app/client.tsx", ids: ["x.y"] },
    { request: "/fixture/app/client.tsx", ids: [""] }, { request: "/fixture/app/client.tsx", ids: "*" },
    { request: "/fixture/app/client.tsx", ids: [], extra: true },
  ]) {
    const value = new URLSearchParams([["modules", JSON.stringify(import_)], ["server", "false"]]).toString();
    assert.throws(() => parseStylexNextDelegatedEntryLoader(value, "/fixture"));
  }
  for (const surrogate of ["\ud800", "\udc00"]) {
    assert.throws(() => parseStylexNextDelegatedEntryLoader(`modules={"request":"/fixture/app/${surrogate}.tsx","ids":[]}&server=false`, "/fixture"));
    assert.throws(() => validateStylexNextDelegatedEntryGraph({ ...graph, imports: [{ request: `app/${surrogate}.tsx`, ids: [] }] }));
  }
  const repeated = new URLSearchParams([["modules", '{"request":"/fixture/app/hidden.tsx","request":"/fixture/app/client.tsx","ids":[]}'], ["server", "false"]]).toString();
  assert.throws(() => parseStylexNextDelegatedEntryLoader(repeated, "/fixture"));
});

test("delegated graph requires mapped-owner topology distinct from an empty loader", () => {
  assert.deepEqual(validateStylexNextDelegatedEntryGraph(graph), graph);
  for (const changed of [
    { ...graph, chunkIds: [] }, { ...graph, chunkIds: [342, 342] },
    { ...graph, entryOwners: [] }, { ...graph, entryOwners: [graph.entryOwners[0], graph.entryOwners[0]] },
    { ...graph, entryOwners: [{ id: 999, files: ["static/shared.js"] }] },
    { ...graph, entryOwners: [{ id: 474, files: ["static/other.js"] }] },
    { ...graph, dependencies: [{ ...graph.dependencies[0], id: 342 }] },
    { ...graph, dependencies: [] }, { ...graph, entrypoints: [] },
    { ...graph, imports: [] }, { ...graph, originalSource: { bytes: 0, sha256: sha256("") } },
    { ...graph, loaderOptions: "server=false" },
  ]) assert.throws(() => validateStylexNextDelegatedEntryGraph(changed));
});

test("delegated payload accepts only exact module-free startup grammar", () => {
  assert.doesNotThrow(() => validateStylexNextDelegatedEntryPayload(graph, code));
  assert.doesNotThrow(() => validateStylexNextDelegatedEntryPayload(graph, code.replaceAll("_=>", "r=>").replaceAll("_.", "r.").replaceAll("()=>_(", "()=>r(")));
  for (const changed of [
    code.replace("{},", "{2474:()=>{}},"), code.replace("[342]", "[343]"),
    code.replace("[474]", "[475]"), code.replace("s=2474", "s=2475"),
    code.replace("s=2474", "s=fetch('/')"), code.replace("_N_E=", "globalThis.changed=true,_N_E="),
    `${code}fetch('/');`, `${code}\n//# sourceMappingURL=fake.js.map`,
    " ".repeat(256 * 1024 + 1),
  ]) assert.throws(() => validateStylexNextDelegatedEntryPayload(graph, changed));
});

test("delegated proof binds every exact profile creator without accepting another profile", () => {
  for (const nextVersion of STYLEX_NEXT_PRODUCTION_VERSIONS) {
    const record = {
      graph,
      inputs: stylexNextProfile(nextVersion).emptyEntryInputs.map(([path, sha256]) => ({ path: `node_modules/next/${path}`, sha256, bytes: 1 })),
      output: { path: "static/delegated.js", bytes: Buffer.byteLength(code), sha256: sha256(code) },
    };
    assert.deepEqual(validateStylexNextDelegatedEntryBootstrap(record, nextVersion), record);
    assert.throws(() => validateStylexNextDelegatedEntryBootstrap({ ...record, inputs: record.inputs.slice(1) }, nextVersion));
    assert.throws(() => validateStylexNextDelegatedEntryBootstrap(record, nextVersion === "16.2.12" ? "16.3.3" : "16.2.12"));
    assert.throws(() => validateStylexNextDelegatedEntryBootstrap({ ...record, output: { ...record.output, path: "static/proof.css" } }, nextVersion));
  }
});
